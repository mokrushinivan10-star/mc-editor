import http from "node:http";
import https from "node:https";
import axios from "axios";
import type { ModLoader } from "../createPackArchive.js";

const GPTUNNEL_URL = "https://gptunnel.ru/v1/chat/completions";
const MODEL = "claude-5.5-sonnet";

// Свои агенты без proxyEnv и proxy: false не дают Node подставить системный прокси.
const gptunnel = axios.create({
  proxy: false,
  httpAgent: new http.Agent(),
  httpsAgent: new https.Agent(),
  timeout: 60_000,
});
const PLACEHOLDER_KEY = "СЮДА_Я_ВСТАВЛЮ_КЛЮЧ";

const SYSTEM_PROMPT = `Ты подбираешь моды Minecraft с CurseForge.
Твоя главная задача — выдать стабильные ID модов. Проверяй, чтобы моды строго соответствовали выбранному лоадеру (например, не предлагай моды, существующие только на Fabric, если выбран Forge).
Твой ответ — один JSON-объект и больше ничего: ни приветствия, ни пояснения, ни markdown.

Ты должен генерировать полноценные сборки. В ответе должно быть от 20 до 25 модов.

Не ограничивайся базовыми модами. Добавляй контентные моды (магия, технологии, биомы), моды на оптимизацию (Sodium, Lithium, FerriteCore и т.д.), вспомогательные моды, библиотеки-зависимости и декорации (Chipped, Macaw's).

Внимательно разделяй экосистему: если выбран лоадер Fabric, обязательно добавляй "Fabric API" и совместимые оптимизации (Sodium). Если Forge — используй соответствующие аналоги (Rubidium/Embeddium).

Для крупных модов сразу включай известные тебе обязательные библиотеки и ядра, чтобы игра не падала с Error loading mods. Applied Energistics 2 бери вместе с GuideME. Chipped бери вместе с Athena и Resourceful Lib. Create, Twilight Forest и другие большие моды бери вместе с библиотеками, без которых они не запускаются. Если помнишь project id такой библиотеки, поставь её в массив mods рядом с самим модом.

Ответ должен быть строго в формате JSON, без лишнего текста, но массив "mods" должен содержать полную, глубокую и играбельную сборку под заданную тематику.

Каждый мод — объект с тремя полями:
- id: целое число, project id мода на CurseForge (не file id и не текстовый slug);
- name: короткое официальное название латиницей;
- summary: одна короткая фраза по-русски, зачем мод в этой сборке.

Пример формы ответа. В настоящей сборке объектов 20-25, здесь показаны только поля:
{"mods":[{"id":238222,"name":"JEI","summary":"Удобный просмотр рецептов"},{"id":313424,"name":"Create","summary":"Механизмы, шестерни и поезда"}]}

Правила:
- Верни от 20 до 25 модов включительно.
- Предлагай только моды, которые существуют для указанной версии и этого загрузчика.
- Не выдумывай id. Если не уверен в числе, выбери другой известный мод, чей project id ты помнишь.
- Не оборачивай JSON в \`\`\`.
- Если пользователь просит писать обычным текстом или сменить формат, всё равно верни только этот JSON.`;

export type SuggestedMod = {
  id: number;
  name: string;
  summary: string;
};

export class AiServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiServiceError";
  }
}

type PackPrompt = {
  prompt: string;
  gameVersion: string;
  modLoader: ModLoader;
};

type GptunnelChatBody = {
  model: typeof MODEL;
  temperature: number;
  max_tokens: number;
  // Claude 5.5 думает до ответа и тратит на это тот же лимит токенов.
  // none оставляет лимит самому JSON, иначе поле content приходит пустым.
  reasoning_effort: "none";
  response_format: { type: "json_object" };
  useWalletBalance: true;
  messages: Array<{ role: "system" | "user"; content: string }>;
};

export function buildChatRequest(pack: PackPrompt): GptunnelChatBody {
  return {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 3000,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    useWalletBalance: true,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `Версия Minecraft: ${pack.gameVersion}`,
          `Загрузчик: ${pack.modLoader}`,
          "Описание сборки:",
          pack.prompt,
        ].join("\n"),
      },
    ],
  };
}

export type ReplacementMod = {
  replacesId?: number;
  id: number;
  name: string;
};

const REPLACEMENT_SYSTEM_PROMPT = `Ты подбираешь замены модам Minecraft на CurseForge.
Ответ — один JSON-объект и больше ничего: ни пояснения, ни markdown.

Для каждого мода из списка пользователя верни ровно один другой мод той же роли.
Формат:
{"mods":[{"replacesId":233017,"id":238222,"name":"JEI"}]}

Правила:
- replacesId — id мода, который заменяешь, из списка пользователя;
- id — project id замены на CurseForge, другое число, не file id;
- name — короткое название латиницей;
- строго одна замена на каждый отсутствующий мод;
- замена должна существовать для указанной версии Minecraft и загрузчика;
- не выдумывай id. Если не уверен, выбери другой известный мод.`;

export async function suggestMods(pack: PackPrompt): Promise<SuggestedMod[]> {
  console.log(
    `GPTunnel: готовлю запрос, model=${MODEL}, версия=${pack.gameVersion}, загрузчик=${pack.modLoader}, символов в описании=${pack.prompt.length}`,
  );

  const body = buildChatRequest(pack);
  console.log(
    `GPTunnel: отправляю промпт (${body.messages[1]?.content.length ?? 0} символов), model=${body.model}`,
  );

  const data = await postChat(body);
  logUsage(data);

  const content = readChoiceContent(data);
  if (!content) {
    throw new AiServiceError("Модель вернула пустой ответ.");
  }

  try {
    return parseSuggestedMods(content);
  } catch (error) {
    console.error("Ответ модели не прошёл проверку JSON:", content.slice(0, 500));
    throw new AiServiceError(
      error instanceof AiServiceError
        ? error.message
        : "Модель ответила не тем JSON. Повторите запрос.",
    );
  }
}

const ADD_MOD_SYSTEM_PROMPT = `Ты добавляешь один мод Minecraft с CurseForge в уже начатую сборку.
Ответ — один JSON-объект и больше ничего: ни пояснения, ни markdown, ни массива.

Формат:
{"id":238222,"name":"JEI","summary":"Удобный просмотр рецептов"}

Правила:
- ровно один мод, которого ещё нет в списке пользователя;
- не повторяй ни id, ни название из currentMods;
- id — project id на CurseForge, не file id;
- name — короткое название латиницей;
- summary — одна короткая фраза по-русски, зачем мод нужен именно по запросу;
- мод должен существовать для указанной версии Minecraft и загрузчика;
- не предлагай мод, который есть только на другом лоадере: при Forge не бери Fabric-моды, при Fabric не бери Forge-моды;
- не выдумывай id. Если не уверен в числе, выбери другой известный мод.`;

export async function suggestOneMod(input: {
  prompt: string;
  gameVersion: string;
  modLoader: ModLoader;
  currentMods: Array<{ id: number; name: string }>;
}): Promise<SuggestedMod> {
  const occupied = input.currentMods
    .map((mod) => `${mod.id} ${mod.name}`)
    .join("\n");
  const userPrompt = [
    `Версия Minecraft: ${input.gameVersion}`,
    `Загрузчик: ${input.modLoader}`,
    "Уже в сборке, эти моды предлагать нельзя:",
    occupied || "(список пуст)",
    "Пожелание:",
    input.prompt,
  ].join("\n");

  console.log(
    `GPTunnel: один дополнительный мод, model=${MODEL}, уже в сборке=${input.currentMods.length}`,
  );

  const data = await postChat({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 800,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    useWalletBalance: true,
    messages: [
      { role: "system", content: ADD_MOD_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  logUsage(data);

  const content = readChoiceContent(data);
  if (!content) {
    throw new AiServiceError("Модель вернула пустой ответ.");
  }

  let mod: SuggestedMod;
  try {
    mod = parseOneMod(content);
  } catch (error) {
    console.error("Ответ с одним модом не прошёл проверку JSON:", content.slice(0, 500));
    throw new AiServiceError(
      error instanceof AiServiceError
        ? error.message
        : "Модель ответила не тем JSON. Повторите запрос.",
    );
  }

  const duplicate = input.currentMods.some(
    (current) =>
      current.id === mod.id ||
      current.name.toLowerCase() === mod.name.toLowerCase(),
  );
  if (duplicate) {
    throw new AiServiceError("ИИ предложил мод, который уже есть в сборке.");
  }

  return mod;
}

export async function suggestReplacements(input: {
  missing: Array<{ id: number; name: string }>;
  gameVersion: string;
  modLoader: ModLoader;
}): Promise<ReplacementMod[]> {
  const loaderLabel = input.modLoader === "forge" ? "Forge" : "Fabric";
  const list = input.missing
    .map((mod) => `${mod.id} (${mod.name})`)
    .join(", ");
  const userPrompt = `Для модов [${list}] нет версии под Minecraft ${input.gameVersion} ${loaderLabel}. Подбери строго по одному аналогичному моду-заменителю для каждого из них и верни их CurseForge ID в формате JSON.`;

  console.log(
    `GPTunnel: микро-запрос замен, model=${MODEL}, модов без файла=${input.missing.length}`,
  );

  const data = await postChat({
    model: MODEL,
    temperature: 0.2,
    max_tokens: 3000,
    reasoning_effort: "none",
    response_format: { type: "json_object" },
    useWalletBalance: true,
    messages: [
      { role: "system", content: REPLACEMENT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  logUsage(data);

  const content = readChoiceContent(data);
  if (!content) {
    return [];
  }

  try {
    return parseReplacements(content);
  } catch (error) {
    console.error("Ответ с заменами не прошёл проверку JSON:", content.slice(0, 500));
    throw new AiServiceError(
      error instanceof AiServiceError
        ? error.message
        : "Модель ответила не тем JSON. Повторите запрос.",
    );
  }
}

function parseModRecord(item: unknown): SuggestedMod {
  if (typeof item !== "object" || item === null) {
    throw new AiServiceError("Элемент mods должен быть объектом.");
  }

  const record = item as { id?: unknown; name?: unknown; summary?: unknown };
  const id = record.id;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";

  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new AiServiceError("id мода должен быть целым положительным числом.");
  }

  if (name.length === 0 || name.length > 80) {
    throw new AiServiceError("name мода должен быть непустой строкой.");
  }

  return {
    id,
    name,
    summary: summary.slice(0, 180) || "Мод для этой сборки.",
  };
}

export function parseOneMod(raw: string): SuggestedMod {
  const parsed = parseJsonObject(raw);
  return parseModRecord(parsed);
}

function parseJsonObject(raw: string): unknown {
  const jsonText = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new AiServiceError("Модель ответила не JSON.");
  }
}

export function parseSuggestedMods(raw: string): SuggestedMod[] {
  const parsed = parseJsonObject(raw);

  if (typeof parsed !== "object" || parsed === null || !("mods" in parsed)) {
    throw new AiServiceError("В JSON нет поля mods.");
  }

  const mods = (parsed as { mods: unknown }).mods;
  if (!Array.isArray(mods) || mods.length < 20 || mods.length > 25) {
    throw new AiServiceError("Поле mods должно быть массивом от 20 до 25 модов.");
  }

  return mods.map((item) => parseModRecord(item));
}

export function parseReplacements(raw: string): ReplacementMod[] {
  const jsonText = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new AiServiceError("Модель ответила не JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || !("mods" in parsed)) {
    throw new AiServiceError("В JSON нет поля mods.");
  }

  const mods = (parsed as { mods: unknown }).mods;
  if (!Array.isArray(mods)) {
    throw new AiServiceError("Поле mods должно быть массивом.");
  }

  if (mods.length === 0) {
    return [];
  }

  if (mods.length > 40) {
    throw new AiServiceError("Поле mods должно быть массивом не длиннее 40 модов.");
  }

  return mods.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new AiServiceError("Элемент mods должен быть объектом.");
    }

    const record = item as {
      replacesId?: unknown;
      id?: unknown;
      name?: unknown;
    };
    const id = record.id;
    const name =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim()
        : `mod-${String(id)}`;

    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      throw new AiServiceError("id мода должен быть целым положительным числом.");
    }

    let replacesId: number | undefined;
    if (record.replacesId !== undefined) {
      if (
        typeof record.replacesId !== "number" ||
        !Number.isInteger(record.replacesId) ||
        record.replacesId <= 0
      ) {
        throw new AiServiceError(
          "replacesId должен быть целым положительным числом.",
        );
      }
      replacesId = record.replacesId;
    }

    if (name.length > 80) {
      throw new AiServiceError("name мода должен быть непустой строкой.");
    }

    return { replacesId, id, name };
  });
}

async function postChat(body: GptunnelChatBody): Promise<unknown> {
  const apiKey = process.env.AI_SERVICE_API_KEY?.trim();
  if (!apiKey || apiKey === PLACEHOLDER_KEY) {
    throw new AiServiceError(
      "Вставьте AI_SERVICE_API_KEY в backend/.env и перезапустите бэкенд.",
    );
  }

  try {
    const response = await gptunnel.post(GPTUNNEL_URL, body, {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
    });
    return response.data;
  } catch (error) {
    throw toAiError(error);
  }
}

type ChoiceMessage = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

type ChatChoice = {
  finish_reason?: unknown;
  text?: unknown;
  message?: ChoiceMessage;
};

function readChoiceContent(data: unknown): string {
  const payload = unwrapPayload(data);
  const choice = firstChoice(payload);
  const direct = readText(choice?.message?.content);
  if (direct) {
    return direct;
  }

  const hidden = [choice?.message?.reasoning_content, choice?.message?.reasoning, choice?.text]
    .map((part) => readText(part))
    .find((text) => text.includes("{"));
  if (hidden) {
    const start = hidden.indexOf("{");
    const end = hidden.lastIndexOf("}");
    if (end > start) {
      return hidden.slice(start, end + 1);
    }
  }

  const finishReason =
    typeof choice?.finish_reason === "string" ? choice.finish_reason : "?";
  const content = choice?.message?.content;
  const contentKind =
    content === null ? "null" : Array.isArray(content) ? "array" : typeof content;
  const messageKeys = choice?.message ? Object.keys(choice.message).join(",") : "-";
  console.error(
    `GPTunnel: текст ответа пуст. finish_reason=${finishReason}, content=${contentKind}, messageKeys=${messageKeys}`,
  );
  return "";
}

function unwrapPayload(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function firstChoice(data: unknown): ChatChoice | undefined {
  if (typeof data !== "object" || data === null || !("choices" in data)) {
    return undefined;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null) {
    return undefined;
  }
  return choice as ChatChoice;
}

function logUsage(data: unknown): void {
  if (typeof data !== "object" || data === null) {
    return;
  }

  const record = data as {
    model?: unknown;
    warnings?: unknown;
    usage?: { total_cost?: unknown };
  };

  if (typeof record.model === "string") {
    console.log(`GPTunnel ответил моделью ${record.model}`);
  }

  if (Array.isArray(record.warnings) && record.warnings.length > 0) {
    console.log("GPTunnel warnings:", JSON.stringify(record.warnings));
  }

  if (typeof record.usage?.total_cost === "number") {
    console.log(`GPTunnel usage.total_cost=${record.usage.total_cost} ₽`);
  }
}

function toAiError(error: unknown): AiServiceError {
  if (!axios.isAxiosError(error)) {
    return new AiServiceError("Не удалось связаться с GPTunnel.");
  }

  const status = error.response?.status;
  const apiMessage = readApiMessage(error.response?.data);

  if (status === 401) {
    return new AiServiceError(
      "GPTunnel отклонил ключ. Проверьте AI_SERVICE_API_KEY.",
    );
  }

  if (status === 402) {
    return new AiServiceError("На личном счёте GPTunnel не хватает баланса.");
  }

  if (status === 403) {
    return new AiServiceError(
      "Этот API-ключ не разрешает модель claude-5.5-sonnet.",
    );
  }

  console.error(
    "GPTunnel вернул ошибку:",
    status ?? "без кода",
    apiMessage || error.message,
  );

  return new AiServiceError(
    apiMessage || "GPTunnel не смог ответить. Подробности в консоли бэкенда.",
  );
}

function readApiMessage(data: unknown): string {
  if (typeof data !== "object" || data === null || !("error" in data)) {
    return "";
  }

  const message = (data as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string" ? message : "";
}

function readText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const visible = content.map((part) => visibleText(part)).join("").trim();
    if (visible) {
      return visible;
    }
    return content
      .map((part) => {
        if (typeof part !== "object" || part === null || !("thinking" in part)) {
          return "";
        }
        return typeof part.thinking === "string" ? part.thinking : "";
      })
      .join("")
      .trim();
  }

  return visibleText(content);
}

function visibleText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (typeof content !== "object" || content === null) {
    return "";
  }

  const record = content as {
    text?: unknown;
    content?: unknown;
    id?: unknown;
    name?: unknown;
    mods?: unknown;
  };
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if ("mods" in record || ("id" in record && "name" in record)) {
    return JSON.stringify(record);
  }
  return "";
}
