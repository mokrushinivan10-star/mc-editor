import { randomUUID } from "node:crypto";
import axios from "axios";

const YOOKASSA_API = "https://api.yookassa.ru/v3/payments";
const PLACEHOLDER = "СЮДА_Я_ВСТАВЛЮ";

export type PaidTier = "premium" | "ultra" | "max";

const PRICES: Record<PaidTier, { value: string; description: string }> = {
  premium: { value: "200.00", description: "Premium на 30 дней: 15 генераций в неделю" },
  ultra: { value: "400.00", description: "Ultra на 30 дней: 30 генераций в неделю" },
  max: { value: "1000.00", description: "Максимум на 30 дней: безлимит генераций" },
};

export class PaymentServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "PaymentServiceError";
    this.statusCode = statusCode;
  }
}

type YooPayment = {
  id?: string;
  status?: string;
  paid?: boolean;
  confirmation?: { confirmation_url?: string };
  metadata?: { userId?: string; tier?: string };
};

type Credentials = {
  shopId: string;
  secretKey: string;
};

export function isPaidTier(value: unknown): value is PaidTier {
  return value === "premium" || value === "ultra" || value === "max";
}

export async function createPayment(input: {
  tier: PaidTier;
  userId: string;
  returnUrl: string;
}): Promise<{ confirmationUrl: string; paymentId: string }> {
  const price = PRICES[input.tier];
  const { shopId, secretKey } = credentials();
  const payment = await requestYookassa<YooPayment>({
    method: "post",
    url: YOOKASSA_API,
    shopId,
    secretKey,
    idempotenceKey: randomUUID(),
    data: {
      amount: { value: price.value, currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: input.returnUrl },
      description: price.description,
      metadata: { userId: input.userId, tier: input.tier },
    },
  });

  const confirmationUrl = payment.confirmation?.confirmation_url;
  if (!payment.id || !confirmationUrl) {
    throw new PaymentServiceError("ЮKassa не вернула ссылку на оплату.");
  }

  console.log(
    `ЮKassa: создан платёж ${payment.id}, тариф ${input.tier}, пользователь ${input.userId}.`,
  );
  return { confirmationUrl, paymentId: payment.id };
}

// Уведомление ЮKassa само по себе не доказательство оплаты.
// Берём тот же платёж из API и читаем tier и userId уже из него.
export async function readSucceededPayment(paymentId: string): Promise<{
  userId: string;
  tier: PaidTier;
}> {
  const { shopId, secretKey } = credentials();
  const payment = await requestYookassa<YooPayment>({
    method: "get",
    url: `${YOOKASSA_API}/${encodeURIComponent(paymentId)}`,
    shopId,
    secretKey,
  });

  if (payment.status !== "succeeded" || payment.paid !== true) {
    throw new PaymentServiceError("Платёж ещё не оплачен.", 409);
  }

  const tier = payment.metadata?.tier;
  const userId = payment.metadata?.userId?.trim() ?? "";
  if (!isPaidTier(tier) || userId.length === 0 || userId.length > 128) {
    throw new PaymentServiceError("В платеже нет тарифа или пользователя.", 400);
  }

  return { userId, tier };
}

function credentials(): Credentials {
  const shopId = process.env.YOOKASSA_SHOP_ID?.trim() ?? "";
  const secretKey = process.env.YOOKASSA_SECRET_KEY?.trim() ?? "";
  if (
    !shopId ||
    !secretKey ||
    shopId.startsWith(PLACEHOLDER) ||
    secretKey.startsWith(PLACEHOLDER)
  ) {
    throw new PaymentServiceError(
      "Оплата ещё не подключена. Добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY.",
      503,
    );
  }

  return { shopId, secretKey };
}

async function requestYookassa<T>(options: {
  method: "get" | "post";
  url: string;
  shopId: string;
  secretKey: string;
  idempotenceKey?: string;
  data?: unknown;
}): Promise<T> {
  try {
    const response = await axios.request<T>({
      method: options.method,
      url: options.url,
      data: options.data,
      timeout: 30_000,
      auth: { username: options.shopId, password: options.secretKey },
      headers: {
        "Content-Type": "application/json",
        ...(options.idempotenceKey
          ? { "Idempotence-Key": options.idempotenceKey }
          : {}),
      },
    });
    return response.data;
  } catch (error) {
    if (!axios.isAxiosError(error)) {
      throw new PaymentServiceError("Не удалось связаться с ЮKassa.");
    }

    const status = error.response?.status;
    if (status === 401 || status === 403) {
      throw new PaymentServiceError("ЮKassa отклонила ключи магазина.", 502);
    }

    const description = readYooDescription(error.response?.data);
    throw new PaymentServiceError(description ?? "ЮKassa не приняла запрос.");
  }
}

function readYooDescription(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("description" in data)) {
    return null;
  }

  const description = (data as { description?: unknown }).description;
  if (typeof description !== "string") {
    return null;
  }

  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 300) : null;
}
