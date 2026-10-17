import "dotenv/config";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  buildPackZip,
  parseAddModRequest,
  parseBuildRequest,
  parsePackRequest,
  zipFileName,
  type ModLoader,
  type PackRequest,
} from "./createPackArchive.js";
import {
  AiServiceError,
  suggestOneMod,
  suggestMods,
  suggestReplacements,
  type ReplacementMod,
  type SuggestedMod,
} from "./services/aiService.js";
import {
  CurseForgeError,
  downloadMods,
  type DownloadedMod,
  type MissingMod,
} from "./services/curseforgeService.js";
import { dbService, DbServiceError } from "./services/dbService.js";

const app = express();
const PORT = 5000;

logSecret("CURSEFORGE_API_KEY", process.env.CURSEFORGE_API_KEY);
logSecret("AI_SERVICE_API_KEY", process.env.AI_SERVICE_API_KEY);
logSecret("SUPABASE_URL", process.env.SUPABASE_URL);
logSecret("SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY);

// Фронтенд откроется на другом порту (обычно 5173).
// Без этого разрешения браузер заблокирует ответ как «чужой».
app.use(cors({ exposedHeaders: ["Content-Disposition"] }));
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    status: "ok",
    message: "Бэкэнд на связи!",
  });
});

app.post("/api/generate-list", requireUser, async (req, res) => {
  const parsed = parsePackRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ status: "error", message: parsed.message });
    return;
  }

  const userId = String(res.locals.userId);

  try {
    const allowed = await dbService.checkUserLimit(userId);
    if (!allowed) {
      res.status(403).json({
        status: "error",
        message:
          "Вы исчерпали бесплатные лимиты на эту неделю. Перейдите на Premium!",
      });
      return;
    }
  } catch (error) {
    console.error(
      "Не удалось проверить лимит:",
      error instanceof Error ? error.message : error,
    );
    const message =
      error instanceof DbServiceError
        ? error.message
        : "Не удалось проверить лимит генераций.";
    res.status(503).json({ status: "error", message });
    return;
  }

  try {
    const mods = await suggestMods(parsed.pack);
    console.log(
      `ИИ (claude-5.5-sonnet) подобрал моды для «${parsed.pack.name}»:`,
    );
    console.log(JSON.stringify(mods, null, 2));
    res.json({ status: "ok", mods });
  } catch (error) {
    console.error(
      "ИИ не вернул список модов:",
      error instanceof Error ? error.message : error,
    );
    const message =
      error instanceof AiServiceError
        ? error.message
        : "Не удалось получить список модов от ИИ.";
    res.status(502).json({ status: "error", message });
  }
});

app.post("/api/add-mod-suggestion", async (req, res) => {
  const parsed = parseAddModRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ status: "error", message: parsed.message });
    return;
  }

  try {
    const mod = await suggestOneMod(parsed.request);
    console.log(
      `ИИ предложил добавить ${mod.id} ${mod.name} к сборке из ${parsed.request.currentMods.length} модов.`,
    );
    res.json({ status: "ok", mod });
  } catch (error) {
    console.error(
      "ИИ не предложил мод:",
      error instanceof Error ? error.message : error,
    );
    const message =
      error instanceof AiServiceError
        ? error.message
        : "Не удалось подобрать мод.";
    res.status(502).json({ status: "error", message });
  }
});

app.post("/api/build-pack", requireUser, async (req, res) => {
  const parsed = parseBuildRequest(req.body);
  if (!parsed.ok) {
    res.status(400).json({ status: "error", message: parsed.message });
    return;
  }

  const userId = String(res.locals.userId);

  const pack: PackRequest = {
    name: parsed.build.name,
    gameVersion: parsed.build.gameVersion,
    modLoader: parsed.build.modLoader,
    prompt: "сборка",
  };
  const mods = parsed.build.mods;

  console.log(
    `Собираю «${pack.name}» из ${mods.length} модов, которые оставил пользователь.`,
  );

  let collected;
  try {
    collected = await collectJars(mods, pack);
  } catch (error) {
    console.error(
      "CurseForge не отдал моды:",
      error instanceof Error ? error.message : error,
    );
    const message =
      error instanceof CurseForgeError
        ? error.message
        : "Не удалось скачать моды с CurseForge.";
    res.status(502).json({ status: "error", message });
    return;
  }

  const fileName = zipFileName(pack.name);
  const loaderLabel = pack.modLoader === "forge" ? "Forge" : "Fabric";
  const warning =
    collected.replaced.length > 0 || collected.excluded.length > 0;

  let zip: Buffer;
  try {
    zip = await buildPackZip(
      pack,
      collected.jars,
      warning
        ? renderWarnings(collected.replaced, collected.excluded)
        : undefined,
    );
  } catch (error) {
    console.error(
      "Не удалось собрать архив:",
      error instanceof Error ? error.message : error,
    );
    res.status(502).json({
      status: "error",
      message: "Список модов получен, но архив собрать не удалось.",
    });
    return;
  }

  try {
    await dbService.decrementUserLimit(userId);
  } catch (error) {
    console.error(
      "Не удалось уменьшить лимит после сборки ZIP:",
      error instanceof Error ? error.message : error,
    );
  }

  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.json({
    status: warning ? "warning" : "ok",
    message: warning
      ? `Некоторые моды были заменены или пропущены из-за отсутствия версии под ${pack.gameVersion} ${loaderLabel}. Подробности внутри архива!`
      : null,
    fileName,
    zipBase64: zip.toString("base64"),
  });
});

app.listen(PORT, () => {
  console.log(`Сервер слушает http://localhost:${PORT}`);
});

async function collectJars(
  mods: SuggestedMod[],
  pack: { gameVersion: string; modLoader: ModLoader },
): Promise<{ jars: DownloadedMod[]; replaced: string[]; excluded: string[] }> {
  const first = await downloadMods(
    mods.map((mod) => mod.id),
    pack.gameVersion,
    pack.modLoader,
  );
  const jars = [...first.downloaded];
  const replaced: string[] = [];
  const excluded: string[] = [];

  if (first.missingMods.length === 0) {
    return { jars, replaced, excluded };
  }

  const missing = first.missingMods.map((item) => ({
    id: item.id,
    name: mods.find((mod) => mod.id === item.id)?.name ?? `мод ${item.id}`,
    reason: item.reason,
  }));
  console.log(
    "Нет jar под выбранную версию:",
    missing.map((item) => item.id).join(", "),
  );

  let replacements: ReplacementMod[] = [];
  try {
    replacements = await suggestReplacements({
      missing,
      gameVersion: pack.gameVersion,
      modLoader: pack.modLoader,
    });
    console.log("ИИ предложил замены:", JSON.stringify(replacements, null, 2));
  } catch (error) {
    console.error(
      "ИИ не подобрал замены:",
      error instanceof Error ? error.message : error,
    );
  }

  const already = new Set(jars.map((jar) => jar.modId));
  const pendingIds = [
    ...new Set(
      replacements
        .map((item) => item.id)
        .filter((id) => !already.has(id)),
    ),
  ];

  const secondDownloaded: DownloadedMod[] = [];
  const secondMissing: MissingMod[] = [];
  if (pendingIds.length > 0) {
    const second = await downloadMods(
      pendingIds,
      pack.gameVersion,
      pack.modLoader,
    );
    secondDownloaded.push(...second.downloaded);
    secondMissing.push(...second.missingMods);
  }

  const byId = new Map<number, DownloadedMod>();
  for (const jar of [...jars, ...secondDownloaded]) {
    byId.set(jar.modId, jar);
  }

  const unused = [...replacements];
  const usedReplacementIds = new Set<number>();

  for (const item of missing) {
    const replacement = takeReplacement(unused, item.id);
    if (!replacement) {
      excluded.push(`${item.id} (${item.name}): ${item.reason}`);
      continue;
    }

    const jar = byId.get(replacement.id);
    const replacementMissing = secondMissing.find(
      (miss) => miss.id === replacement.id,
    );
    if (!jar || replacementMissing) {
      const why = replacementMissing?.reason ?? "файл замены не скачался";
      excluded.push(
        `${item.id} (${item.name}): замена ${replacement.id} (${replacement.name}) тоже не подошла. ${why}`,
      );
      continue;
    }

    if (usedReplacementIds.has(replacement.id)) {
      excluded.push(
        `${item.id} (${item.name}): замена ${replacement.id} (${replacement.name}) уже использована для другого мода`,
      );
      continue;
    }

    usedReplacementIds.add(replacement.id);
    if (!jars.some((existing) => existing.modId === jar.modId)) {
      jars.push(jar);
    }
    replaced.push(
      `${item.id} (${item.name}) → ${replacement.id} (${replacement.name}), файл ${jar.fileName}`,
    );
  }

  return { jars, replaced, excluded };
}

function takeReplacement(
  unused: ReplacementMod[],
  missingId: number,
): ReplacementMod | undefined {
  const exactIndex = unused.findIndex((item) => item.replacesId === missingId);
  if (exactIndex >= 0) {
    return unused.splice(exactIndex, 1)[0];
  }

  const looseIndex = unused.findIndex((item) => item.replacesId === undefined);
  if (looseIndex >= 0) {
    return unused.splice(looseIndex, 1)[0];
  }

  return undefined;
}

function renderWarnings(replaced: string[], excluded: string[]): string {
  const lines = [
    "Часть модов не нашлась под выбранную версию Minecraft и загрузчик.",
    "",
  ];

  if (replaced.length > 0) {
    lines.push("Заменены:");
    for (const line of replaced) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }

  if (excluded.length > 0) {
    lines.push("Исключены из-за несовместимости версий:");
    for (const line of excluded) {
      lines.push(`- ${line}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) {
    res.status(401).json({ status: "error", message: "Нужно войти." });
    return;
  }

  const supabase = dbService.authClient();
  if (!supabase) {
    res.status(503).json({
      status: "error",
      message: "Supabase ещё не подключён.",
    });
    return;
  }

  try {
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data.user) {
      res.status(401).json({
        status: "error",
        message: "Сессия недействительна. Войдите снова.",
      });
      return;
    }

    res.locals.userId = data.user.id;
    console.log(`Вход подтверждён, user id ${data.user.id}.`);
    next();
  } catch (error) {
    next(error);
  }
}

function logSecret(name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) {
    console.log(`${name} не найден. Проверьте backend/.env.`);
  } else if (trimmed.startsWith("СЮДА_Я_ВСТАВЛЮ")) {
    console.log(`${name} прочитан. Сейчас там текст-заглушка.`);
  } else {
    console.log(`${name} прочитан из backend/.env.`);
  }
}
