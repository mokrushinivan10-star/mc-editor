import { ZipArchive } from "archiver";
import { PassThrough, type Writable } from "node:stream";
import type { DownloadedMod } from "./services/curseforgeService.js";

// Версия загрузчика должна совпадать с версией Minecraft, иначе
// Prism Launcher пишет «Экземпляр имеет конфликтующие зависимости».
const FORGE_VERSIONS: Record<string, string> = {
  "1.12.2": "14.23.5.2860",
  "1.16.5": "36.2.34",
  "1.18.2": "40.2.0",
  "1.19.2": "43.3.0",
  "1.19.4": "45.2.0",
  "1.20.1": "47.3.0",
  "1.20.4": "49.1.0",
  "1.21.1": "52.0.16",
};

const FABRIC_VERSIONS: Record<string, string> = {
  "1.12.2": "0.16.10",
  "1.16.5": "0.16.10",
  "1.18.2": "0.16.10",
  "1.19.2": "0.16.10",
  "1.19.4": "0.16.10",
  "1.20.1": "0.16.10",
  "1.20.4": "0.16.10",
  "1.21.1": "0.16.10",
};

const LOADER_UID = {
  forge: "net.minecraftforge",
  fabric: "net.fabricmc.fabric-loader",
} as const;

export type ModLoader = keyof typeof LOADER_UID;

export function loaderVersion(gameVersion: string, modLoader: ModLoader): string {
  const table = modLoader === "forge" ? FORGE_VERSIONS : FABRIC_VERSIONS;
  const version = table[gameVersion];
  if (!version) {
    const loaderName = modLoader === "forge" ? "Forge" : "Fabric";
    throw new Error(
      `Для Minecraft ${gameVersion} нет проверенной версии ${loaderName}. Выберите одну из: ${Object.keys(table).join(", ")}.`,
    );
  }
  return version;
}

export type PackMod = {
  id: number;
  name: string;
  summary: string;
};

export type PackRequest = {
  name: string;
  gameVersion: string;
  modLoader: ModLoader;
  prompt: string;
};

export type BuildRequest = {
  name: string;
  gameVersion: string;
  modLoader: ModLoader;
  mods: PackMod[];
};

export type AddModRequest = {
  prompt: string;
  gameVersion: string;
  modLoader: ModLoader;
  currentMods: PackMod[];
};

type ParseResult =
  | { ok: true; pack: PackRequest }
  | { ok: false; message: string };

type BuildParseResult =
  | { ok: true; build: BuildRequest }
  | { ok: false; message: string };

type AddModParseResult =
  | { ok: true; request: AddModRequest }
  | { ok: false; message: string };

const GAME_VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;

export function parsePackRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  }

  const record = body as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const gameVersion =
    typeof record.gameVersion === "string" ? record.gameVersion.trim() : "";
  const modLoader = record.modLoader;
  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";

  if (name.length === 0 || name.length > 80) {
    return {
      ok: false,
      message: "Название сборки должно быть от 1 до 80 символов.",
    };
  }

  if (name.includes("\n") || name.includes("\r")) {
    return { ok: false, message: "Название сборки не должно содержать переносов строки." };
  }

  if (!GAME_VERSION_PATTERN.test(gameVersion)) {
    return {
      ok: false,
      message: "Версия Minecraft должна быть в виде 1.20.1.",
    };
  }

  if (modLoader !== "forge" && modLoader !== "fabric") {
    return { ok: false, message: "Загрузчик должен быть forge или fabric." };
  }

  if (prompt.length < 3 || prompt.length > 2000) {
    return {
      ok: false,
      message: "Опишите сборку: от 3 до 2000 символов.",
    };
  }

  return {
    ok: true,
    pack: {
      name,
      gameVersion,
      modLoader,
      prompt,
    },
  };
}

export function parseBuildRequest(body: unknown): BuildParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  }

  const record = body as Record<string, unknown>;
  const header = parsePackRequest({
    name: record.name,
    gameVersion: record.gameVersion,
    modLoader: record.modLoader,
    prompt: "сборка",
  });
  if (!header.ok) {
    return header;
  }

  if (!Array.isArray(record.mods) || record.mods.length === 0) {
    return {
      ok: false,
      message: "В сборке должен остаться хотя бы один мод.",
    };
  }

  if (record.mods.length > 40) {
    return { ok: false, message: "В сборке не больше 40 модов." };
  }

  const mods: PackMod[] = [];
  for (const item of record.mods) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, message: "Каждый мод должен быть объектом." };
    }
    const mod = item as { id?: unknown; name?: unknown; summary?: unknown };
    const id = mod.id;
    const name = typeof mod.name === "string" ? mod.name.trim() : "";
    const summary = typeof mod.summary === "string" ? mod.summary.trim() : "";
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      return { ok: false, message: "id мода должен быть целым положительным числом." };
    }
    if (name.length === 0 || name.length > 80) {
      return { ok: false, message: "У каждого мода должно быть название." };
    }
    mods.push({ id, name, summary: summary.slice(0, 180) });
  }

  return {
    ok: true,
    build: {
      name: header.pack.name,
      gameVersion: header.pack.gameVersion,
      modLoader: header.pack.modLoader,
      mods,
    },
  };
}

export function parseAddModRequest(body: unknown): AddModParseResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, message: "Тело запроса должно быть JSON-объектом." };
  }

  const record = body as Record<string, unknown>;
  const header = parsePackRequest({
    name: "сборка",
    gameVersion: record.gameVersion,
    modLoader: record.modLoader,
    prompt: "сборка",
  });
  if (!header.ok) {
    return header;
  }

  const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 300) {
    return {
      ok: false,
      message: "Опишите, какой мод добавить: от 3 до 300 символов.",
    };
  }

  if (!Array.isArray(record.currentMods) || record.currentMods.length > 40) {
    return { ok: false, message: "Список текущих модов повреждён." };
  }

  const currentMods: PackMod[] = [];
  for (const item of record.currentMods) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, message: "Каждый мод должен быть объектом." };
    }
    const mod = item as { id?: unknown; name?: unknown; summary?: unknown };
    const id = mod.id;
    const name = typeof mod.name === "string" ? mod.name.trim() : "";
    const summary = typeof mod.summary === "string" ? mod.summary.trim() : "";
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      return { ok: false, message: "id мода должен быть целым положительным числом." };
    }
    if (name.length === 0 || name.length > 80) {
      return { ok: false, message: "У каждого мода должно быть название." };
    }
    currentMods.push({ id, name, summary: summary.slice(0, 180) });
  }

  return {
    ok: true,
    request: {
      prompt,
      gameVersion: header.pack.gameVersion,
      modLoader: header.pack.modLoader,
      currentMods,
    },
  };
}

function renderInstanceCfg(pack: PackRequest): string {
  return [
    "[General]",
    "ConfigVersion=1.3",
    "InstanceType=OneSix",
    "iconKey=default",
    `name=${pack.name}`,
    "",
  ].join("\n");
}

function renderMmcPack(pack: PackRequest): string {
  const version = loaderVersion(pack.gameVersion, pack.modLoader);
  const loaderName = pack.modLoader === "forge" ? "Forge" : "Fabric Loader";
  console.log(
    `Prism: Minecraft ${pack.gameVersion}, ${loaderName} ${version}`,
  );

  const document = {
    formatVersion: 1,
    components: [
      {
        cachedName: "Minecraft",
        important: true,
        uid: "net.minecraft",
        version: pack.gameVersion,
      },
      {
        cachedName: loaderName,
        important: true,
        uid: LOADER_UID[pack.modLoader],
        version,
      },
    ],
  };

  return JSON.stringify(document, null, 2);
}

export function zipFileName(name: string): string {
  const cleaned =
    name.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").trim() || "modpack";

  return `${cleaned}.zip`;
}

export async function buildPackZip(
  pack: PackRequest,
  mods: DownloadedMod[],
  warningText?: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const output = new PassThrough();
  output.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });

  const finished = new Promise<void>((resolve, reject) => {
    output.on("finish", () => resolve());
    output.on("error", reject);
  });

  try {
    await streamPackZip(output, pack, mods, warningText);
    await finished;
  } catch (error) {
    output.destroy();
    throw error;
  }

  return Buffer.concat(chunks);
}

export async function streamPackZip(
  output: Writable,
  pack: PackRequest,
  mods: DownloadedMod[],
  warningText?: string,
): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on("error", reject);
    output.on("error", reject);
    archive.on("end", () => resolve());
  });

  // pipe соединяет выход архиватора прямо с HTTP-ответом.
  // Готовые куски ZIP уходят клиенту и не записываются в файл на диске.
  archive.pipe(output);
  archive.append(renderInstanceCfg(pack), { name: "instance.cfg" });
  archive.append(renderMmcPack(pack), { name: "mmc-pack.json" });

  for (const mod of mods) {
    archive.append(mod.data, { name: `.minecraft/mods/${mod.fileName}` });
  }

  if (warningText) {
    archive.append(warningText, { name: "readme_warnings.txt" });
  }

  await archive.finalize();
  await archiveFinished;
}
