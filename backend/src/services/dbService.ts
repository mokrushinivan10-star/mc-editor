import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PaidTier } from "./paymentService.js";

const PLACEHOLDER_URL = "СЮДА_Я_ВСТАВЛЮ_URL";
const PLACEHOLDER_KEY = "СЮДА_Я_ВСТАВЛЮ_КЛЮЧ";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_COLUMNS =
  "user_id, plan, generations_left, week_start, subscription_tier";
const PROFILE_WITH_UNTIL =
  "user_id, plan, generations_left, week_start, subscription_tier, subscription_until";
const LEGACY_COLUMNS = "user_id, plan, generations_left, week_start";

// Ожидаемая таблица Supabase `profiles`:
// user_id text primary key
// plan text not null default 'free'
// subscription_tier text not null default 'free'
// subscription_until timestamptz
// generations_left int not null default 3
// week_start timestamptz not null default now()

const WEEKLY_LIMITS = {
  free: 3,
  premium: 15,
  ultra: 30,
} as const;

export type SubscriptionTier = "free" | PaidTier;

type Profile = {
  user_id: string;
  plan: string;
  generations_left: number;
  week_start: string;
  subscription_tier?: string | null;
  subscription_until?: string | null;
};

export type LimitCheck = {
  allowed: boolean;
  tier: SubscriptionTier;
};

export class DbServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbServiceError";
  }
}

export class DbService {
  private client: SupabaseClient | null = null;
  private tierColumn: boolean | null = null;
  private untilColumn: boolean | null = null;

  async checkUserLimit(userId: string): Promise<LimitCheck> {
    const client = this.getClient();
    if (!client) {
      console.log("Supabase ещё не подключён: лимит генераций пока не проверяю.");
      return { allowed: true, tier: "free" };
    }

    const profile = await this.applySubscriptionTerm(
      client,
      await this.loadProfile(client, userId),
    );
    const tier = resolveTier(profile);
    if (tier === "max") {
      console.log(`Пользователь ${userId}: тариф max, лимит не действует.`);
      return { allowed: true, tier };
    }

    const current = weekExpired(profile.week_start)
      ? await this.resetWeek(client, userId, tier)
      : profile;
    const allowed = current.generations_left > 0;
    console.log(
      allowed
        ? `Пользователь ${userId}: тариф ${tier}, осталось генераций ${current.generations_left}.`
        : `Пользователь ${userId}: тариф ${tier}, лимит на эту неделю закончился.`,
    );
    return { allowed, tier };
  }

  async decrementUserLimit(userId: string): Promise<void> {
    const client = this.getClient();
    if (!client) {
      console.log("Supabase ещё не подключён: счётчик генераций не уменьшаю.");
      return;
    }

    const profile = await this.applySubscriptionTerm(
      client,
      await this.loadProfile(client, userId),
    );
    const tier = resolveTier(profile);
    if (tier === "max") {
      console.log(`Пользователь ${userId}: тариф max, счётчик не уменьшаю.`);
      return;
    }

    const current = weekExpired(profile.week_start)
      ? await this.resetWeek(client, userId, tier)
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
      `Пользователь ${userId}: успешный ZIP, тариф ${tier}, осталось генераций ${generationsLeft}.`,
    );
  }

  async setSubscriptionTier(userId: string, tier: PaidTier): Promise<void> {
    const client = this.getClient();
    if (!client) {
      throw new DbServiceError("Supabase ещё не подключён.");
    }

    const existing = await this.findProfile(client, userId);
    const until = new Date(Date.now() + SUBSCRIPTION_MS).toISOString();
    const next: Profile = {
      user_id: userId,
      plan: "free",
      generations_left:
        tier === "max" ? (existing?.generations_left ?? 0) : WEEKLY_LIMITS[tier],
      week_start: new Date().toISOString(),
      subscription_tier: tier,
      subscription_until: until,
    };

    if (!existing) {
      const insert = await client.from("profiles").insert(next);
      if (insert.error) {
        throw new DbServiceError(subscriptionWriteError(insert.error.message));
      }
    } else {
      const { error } = await client
        .from("profiles")
        .update({
          plan: "free",
          subscription_tier: tier,
          subscription_until: until,
          generations_left: next.generations_left,
          week_start: next.week_start,
        })
        .eq("user_id", userId);
      if (error) {
        throw new DbServiceError(subscriptionWriteError(error.message));
      }
    }

    console.log(
      `Пользователь ${userId}: тариф ${tier} до ${until}, генераций на неделю ${tier === "max" ? "без лимита" : next.generations_left}.`,
    );
  }

  authClient(): SupabaseClient | null {
    return this.getClient();
  }

  private async applySubscriptionTerm(
    client: SupabaseClient,
    profile: Profile,
  ): Promise<Profile> {
    if (this.untilColumn === false) {
      return profile;
    }

    const tier = resolveTier(profile);
    if (tier === "free") {
      return profile;
    }

    if (!profile.subscription_until) {
      return this.stampSubscriptionEnd(client, profile, tier);
    }

    if (subscriptionEnded(profile.subscription_until)) {
      return this.downgradeToFree(client, profile.user_id);
    }

    return profile;
  }

  private async stampSubscriptionEnd(
    client: SupabaseClient,
    profile: Profile,
    tier: PaidTier,
  ): Promise<Profile> {
    const until = new Date(Date.now() + SUBSCRIPTION_MS).toISOString();
    const { data, error } = await client
      .from("profiles")
      .update({
        plan: "free",
        subscription_tier: tier,
        subscription_until: until,
      })
      .eq("user_id", profile.user_id)
      .select(this.selectColumns())
      .single();

    if (error && missingUntilColumn(error.message)) {
      this.untilColumn = false;
      console.log("Колонки subscription_until нет: срок 30 дней пока не проверяю.");
      return profile;
    }

    if (error || !data) {
      throw new DbServiceError("Не удалось записать срок тарифа.");
    }

    console.log(`Пользователь ${profile.user_id}: тариф ${tier} действует до ${until}.`);
    return data as unknown as Profile;
  }

  private async downgradeToFree(
    client: SupabaseClient,
    userId: string,
  ): Promise<Profile> {
    const refreshed = {
      plan: "free",
      subscription_tier: "free",
      subscription_until: null,
      generations_left: WEEKLY_LIMITS.free,
      week_start: new Date().toISOString(),
    };
    const { data, error } = await client
      .from("profiles")
      .update(refreshed)
      .eq("user_id", userId)
      .select(this.selectColumns())
      .single();

    if (error || !data) {
      throw new DbServiceError("Не удалось вернуть бесплатный тариф.");
    }

    console.log(`Пользователь ${userId}: 30 дней тарифа прошли, план снова free.`);
    return data as unknown as Profile;
  }

  private selectColumns(): string {
    if (this.tierColumn === false) {
      return LEGACY_COLUMNS;
    }
    if (this.untilColumn === false) {
      return PROFILE_COLUMNS;
    }
    return PROFILE_WITH_UNTIL;
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
    const found = await this.findProfile(client, userId);
    if (found) {
      return found;
    }

    const created: Profile = {
      user_id: userId,
      plan: "free",
      generations_left: WEEKLY_LIMITS.free,
      week_start: new Date().toISOString(),
      subscription_tier: "free",
    };
    const payload = this.tierColumn === false
      ? profileWithoutTier(created)
      : created;
    const insert = await client.from("profiles").insert(payload);
    if (insert.error && this.tierColumn !== false && missingTierColumn(insert.error.message)) {
      this.tierColumn = false;
      const retry = await client.from("profiles").insert(profileWithoutTier(created));
      if (retry.error) {
        throw new DbServiceError("Не удалось создать профиль пользователя.");
      }
    } else if (insert.error) {
      throw new DbServiceError("Не удалось создать профиль пользователя.");
    } else if (this.tierColumn === null) {
      this.tierColumn = true;
    }

    console.log(
      `Пользователь ${userId}: новый профиль free, генераций ${WEEKLY_LIMITS.free}.`,
    );
    return created;
  }

  private async findProfile(
    client: SupabaseClient,
    userId: string,
  ): Promise<Profile | null> {
    const columns = this.selectColumns();
    const { data, error } = await client
      .from("profiles")
      .select(columns)
      .eq("user_id", userId)
      .maybeSingle();

    if (error && this.untilColumn !== false && missingUntilColumn(error.message)) {
      this.untilColumn = false;
      return this.findProfile(client, userId);
    }

    if (error && this.tierColumn !== false && missingTierColumn(error.message)) {
      this.tierColumn = false;
      this.untilColumn = false;
      return this.findProfile(client, userId);
    }

    if (error) {
      throw new DbServiceError("Не удалось прочитать лимит пользователя.");
    }

    if (data) {
      this.tierColumn = columns !== LEGACY_COLUMNS;
      if (columns === PROFILE_WITH_UNTIL) {
        this.untilColumn = true;
      }
      return data as unknown as Profile;
    }

    return null;
  }

  private async resetWeek(
    client: SupabaseClient,
    userId: string,
    tier: Exclude<SubscriptionTier, "max">,
  ): Promise<Profile> {
    const allowance = WEEKLY_LIMITS[tier];
    const refreshed = {
      generations_left: allowance,
      week_start: new Date().toISOString(),
    };
    const { data, error } = await client
      .from("profiles")
      .update(refreshed)
      .eq("user_id", userId)
      .select(this.selectColumns())
      .single();

    if (error || !data) {
      throw new DbServiceError("Не удалось обновить недельный лимит.");
    }

    console.log(
      `Пользователь ${userId}: началась новая неделя, тариф ${tier}, снова ${allowance} генераций.`,
    );
    return data as unknown as Profile;
  }
}

export const dbService = new DbService();

function subscriptionWriteError(message: string): string {
  if (missingUntilColumn(message)) {
    return "Не удалось записать срок тарифа. Добавьте в profiles колонку subscription_until.";
  }
  return "Не удалось обновить тариф. В profiles нужна колонка subscription_tier.";
}

function resolveTier(profile: Profile): SubscriptionTier {
  const column = normalizeTier(profile.subscription_tier);
  if (column && column !== "free") {
    return column;
  }
  // Старый флаг plan = premium означал безлимит, пока не появился магазин.
  if (profile.plan.trim().toLowerCase() === "premium") {
    return "max";
  }
  return "free";
}

function normalizeTier(value: string | null | undefined): SubscriptionTier | null {
  if (typeof value !== "string") {
    return null;
  }
  const tier = value.trim().toLowerCase();
  if (tier === "free" || tier === "premium" || tier === "ultra" || tier === "max") {
    return tier;
  }
  return null;
}

function missingTierColumn(message: string): boolean {
  return /subscription_tier/i.test(message);
}

function missingUntilColumn(message: string): boolean {
  return /subscription_until/i.test(message);
}

function subscriptionEnded(until: string): boolean {
  const ends = Date.parse(until);
  if (Number.isNaN(ends)) {
    return true;
  }
  return Date.now() >= ends;
}

function weekExpired(weekStart: string): boolean {
  const started = Date.parse(weekStart);
  if (Number.isNaN(started)) {
    return true;
  }
  return Date.now() - started >= WEEK_MS;
}

function profileWithoutTier(profile: Profile): Omit<Profile, "subscription_tier"> {
  return {
    user_id: profile.user_id,
    plan: profile.plan,
    generations_left: profile.generations_left,
    week_start: profile.week_start,
  };
}
