import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PLACEHOLDER_URL = "СЮДА_Я_ВСТАВЛЮ_URL";
const PLACEHOLDER_KEY = "СЮДА_Я_ВСТАВЛЮ_КЛЮЧ";
const FREE_WEEKLY_LIMIT = 3;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Ожидаемая таблица Supabase `profiles`:
// user_id text primary key
// plan text not null default 'free'
// generations_left int not null default 3
// week_start timestamptz not null default now()

type Profile = {
  user_id: string;
  plan: string;
  generations_left: number;
  week_start: string;
};

export class DbServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbServiceError";
  }
}

export class DbService {
  private client: SupabaseClient | null = null;

  async checkUserLimit(userId: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) {
      console.log("Supabase ещё не подключён: лимит генераций пока не проверяю.");
      return true;
    }

    const profile = await this.loadProfile(client, userId);
    if (isPremium(profile.plan)) {
      console.log(`Пользователь ${userId}: план premium, лимит не действует.`);
      return true;
    }

    const current = weekExpired(profile.week_start)
      ? await this.resetWeek(client, userId)
      : profile;

    const allowed = current.generations_left > 0;
    console.log(
      allowed
        ? `Пользователь ${userId}: план free, осталось генераций ${current.generations_left}.`
        : `Пользователь ${userId}: бесплатный лимит на эту неделю закончился.`,
    );
    return allowed;
  }

  async decrementUserLimit(userId: string): Promise<void> {
    const client = this.getClient();
    if (!client) {
      console.log("Supabase ещё не подключён: счётчик генераций не уменьшаю.");
      return;
    }

    const profile = await this.loadProfile(client, userId);
    if (isPremium(profile.plan)) {
      console.log(`Пользователь ${userId}: план premium, счётчик не уменьшаю.`);
      return;
    }

    const current = weekExpired(profile.week_start)
      ? await this.resetWeek(client, userId)
      : profile;
    const generationsLeft = Math.max(0, current.generations_left - 1);

    const { error } = await client
      .from("profiles")
      .update({ generations_left: generationsLeft })
      .eq("user_id", userId);

    if (error) {
      throw new DbServiceError("Не удалось уменьшить число генераций.");
    }

    console.log(
      `Пользователь ${userId}: успешный ZIP, осталось генераций ${generationsLeft}.`,
    );
  }

  authClient(): SupabaseClient | null {
    return this.getClient();
  }

  private getClient(): SupabaseClient | null {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_ANON_KEY?.trim();
    if (
      !url ||
      !key ||
      url === PLACEHOLDER_URL ||
      key === PLACEHOLDER_KEY
    ) {
      return null;
    }

    if (!this.client) {
      this.client = createClient(url, key);
    }
    return this.client;
  }

  private async loadProfile(
    client: SupabaseClient,
    userId: string,
  ): Promise<Profile> {
    const { data, error } = await client
      .from("profiles")
      .select("user_id, plan, generations_left, week_start")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      throw new DbServiceError("Не удалось прочитать лимит пользователя.");
    }

    if (data) {
      return data as Profile;
    }

    const created: Profile = {
      user_id: userId,
      plan: "free",
      generations_left: FREE_WEEKLY_LIMIT,
      week_start: new Date().toISOString(),
    };
    const insert = await client.from("profiles").insert(created);
    if (insert.error) {
      throw new DbServiceError("Не удалось создать профиль пользователя.");
    }

    console.log(
      `Пользователь ${userId}: новый профиль free, генераций ${FREE_WEEKLY_LIMIT}.`,
    );
    return created;
  }

  private async resetWeek(
    client: SupabaseClient,
    userId: string,
  ): Promise<Profile> {
    const refreshed: Pick<Profile, "generations_left" | "week_start"> = {
      generations_left: FREE_WEEKLY_LIMIT,
      week_start: new Date().toISOString(),
    };
    const { data, error } = await client
      .from("profiles")
      .update(refreshed)
      .eq("user_id", userId)
      .select("user_id, plan, generations_left, week_start")
      .single();

    if (error || !data) {
      throw new DbServiceError("Не удалось обновить недельный лимит.");
    }

    console.log(
      `Пользователь ${userId}: началась новая неделя, снова ${FREE_WEEKLY_LIMIT} генерации.`,
    );
    return data as Profile;
  }
}

export const dbService = new DbService();

function isPremium(plan: string): boolean {
  return plan.trim().toLowerCase() === "premium";
}

function weekExpired(weekStart: string): boolean {
  const started = Date.parse(weekStart);
  if (Number.isNaN(started)) {
    return true;
  }
  return Date.now() - started >= WEEK_MS;
}
