import axios, { type AxiosInstance } from "axios";
import type { ModLoader } from "../createPackArchive.js";

const CURSEFORGE_API = "https://api.curseforge.com/v1";
const PLACEHOLDER_KEY = "СЮДА_Я_ВСТАВЛЮ_КЛЮЧ";

// Числа из справочника CurseForge: Forge = 1, Fabric = 4.
const LOADER_TYPE = {
  forge: 1,
  fabric: 4,
} as const;

const LOADER_LABEL = {
  forge: "Forge",
  fabric: "Fabric",
} as const;

const REQUIRED_DEPENDENCY = 3;

export class CurseForgeError extends Error {
  readonly kind: "missing" | "fatal";

  constructor(message: string, kind: "missing" | "fatal" = "fatal") {
    super(message);
    this.name = "CurseForgeError";
    this.kind = kind;
  }
}

export type DownloadedMod = {
  modId: number;
  fileName: string;
  data: Buffer;
};

export type MissingMod = {
  id: number;
  reason: string;
};

export type DownloadBatch = {
  downloaded: DownloadedMod[];
  missingMods: MissingMod[];
};

export type ResolvedModFile = {
  modId: number;
  file: CurseFile;
};

export type DependencyPlan = {
  files: ResolvedModFile[];
  missingMods: MissingMod[];
};

type CurseDependency = {
  modId?: number;
  dependencyModId?: number;
  relationType?: number;
};

type CurseFile = {
  id: number;
  modId: number;
  fileName: string;
  downloadUrl: string | null;
  fileDate: string;
  releaseType: number;
  isAvailable?: boolean;
  gameVersions?: string[];
  dependencies?: CurseDependency[];
};

type CurseMod = {
  id?: number;
  dependencies?: CurseDependency[];
};

export async function resolveAllDependencies(
  modIds: number[],
  gameVersion: string,
  modLoader: ModLoader,
): Promise<DependencyPlan> {
  const api = createApi();
  const selected = new Set<number>();
  const processed = new Set<number>();
  const queue: number[] = [];
  const resolved = new Map<number, CurseFile>();
  const missingMods: MissingMod[] = [];

  for (const modId of modIds) {
    if (!Number.isInteger(modId) || modId <= 0 || selected.has(modId)) {
      continue;
    }
    selected.add(modId);
    queue.push(modId);
  }

  console.log(
    `CurseForge: начинаю обход зависимостей. В очереди ${queue.length}, версия ${gameVersion}, лоадер ${LOADER_LABEL[modLoader]}.`,
  );

  while (queue.length > 0) {
    const modId = queue.shift();
    if (modId === undefined) {
      break;
    }
    if (processed.has(modId)) {
      continue;
    }
    processed.add(modId);

    console.log(`CurseForge: проверяю мод ${modId}. В очереди ещё ${queue.length}.`);

    let file: CurseFile | undefined;
    try {
      file = await findMatchingFile(api, modId, gameVersion, modLoader);
      resolved.set(modId, file);
    } catch (error) {
      if (error instanceof CurseForgeError && error.kind === "fatal") {
        throw error;
      }
      const reason =
        error instanceof Error ? error.message : "Не удалось найти файл мода.";
      console.log(`CurseForge: мод ${modId} без подходящего jar. ${reason}`);
      missingMods.push({ id: modId, reason });
    }

    const dependencyIds = await collectRequiredDependencyIds(
      api,
      modId,
      file,
    );
    for (const dependencyId of dependencyIds) {
      console.log(
        `Обнаружена обязательная библиотека ${dependencyId} для мода ${modId}`,
      );
      if (selected.has(dependencyId) || processed.has(dependencyId)) {
        continue;
      }
      selected.add(dependencyId);
      queue.push(dependencyId);
    }
  }

  console.log(
    `CurseForge: обход закончен. К скачиванию ${resolved.size} файлов, без jar ${missingMods.length}.`,
  );

  return {
    files: [...resolved.entries()].map(([modId, file]) => ({ modId, file })),
    missingMods,
  };
}

export async function downloadMods(
  modIds: number[],
  gameVersion: string,
  modLoader: ModLoader,
): Promise<DownloadBatch> {
  const plan = await resolveAllDependencies(modIds, gameVersion, modLoader);
  const api = createApi();
  const usedNames = new Set<string>();
  const downloaded: DownloadedMod[] = [];
  const missingMods = [...plan.missingMods];

  console.log(
    `CurseForge: список полный, скачиваю ${plan.files.length} jar.`,
  );

  for (const item of plan.files) {
    try {
      const downloadUrl = await resolveDownloadUrl(api, item.modId, item.file);
      const data = await downloadJar(downloadUrl);
      const fileName = uniqueJarName(item.file.fileName, item.modId, usedNames);
      console.log(
        `CurseForge: мод ${item.modId} → ${fileName} (${data.length} байт)`,
      );
      downloaded.push({ modId: item.modId, fileName, data });
    } catch (error) {
      if (error instanceof CurseForgeError && error.kind === "fatal") {
        throw error;
      }
      const reason =
        error instanceof Error ? error.message : "Не удалось скачать мод.";
      console.log(`CurseForge: мод ${item.modId} пропущен. ${reason}`);
      missingMods.push({ id: item.modId, reason });
    }
  }

  return { downloaded, missingMods };
}

function createApi(): AxiosInstance {
  const apiKey = process.env.CURSEFORGE_API_KEY?.trim();
  if (!apiKey || apiKey === PLACEHOLDER_KEY) {
    throw new CurseForgeError(
      "Вставьте CURSEFORGE_API_KEY в backend/.env и перезапустите бэкенд.",
    );
  }

  return axios.create({
    baseURL: CURSEFORGE_API,
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
    timeout: 30_000,
  });
}

async function collectRequiredDependencyIds(
  api: AxiosInstance,
  modId: number,
  file: CurseFile | undefined,
): Promise<number[]> {
  const fromMod = await readModDependencies(api, modId);
  const fromFile = file ? await readFileDependencies(api, modId, file) : [];
  const ids = new Set<number>();

  for (const dependency of [...fromMod, ...fromFile]) {
    if (Number(dependency.relationType) !== REQUIRED_DEPENDENCY) {
      continue;
    }
    const dependencyId = dependency.modId ?? dependency.dependencyModId ?? 0;
    if (!Number.isInteger(dependencyId) || dependencyId <= 0) {
      continue;
    }
    ids.add(dependencyId);
  }

  return [...ids];
}

async function readModDependencies(
  api: AxiosInstance,
  modId: number,
): Promise<CurseDependency[]> {
  try {
    const response = await api.get<{ data: CurseMod }>(`/mods/${modId}`);
    const dependencies = response.data.data?.dependencies;
    return Array.isArray(dependencies) ? dependencies : [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new CurseForgeError(
          "CurseForge отклонил ключ. Проверьте CURSEFORGE_API_KEY.",
          "fatal",
        );
      }
    }
    console.log(`CurseForge: не удалось прочитать карточку мода ${modId}.`);
    return [];
  }
}

async function readFileDependencies(
  api: AxiosInstance,
  modId: number,
  file: CurseFile,
): Promise<CurseDependency[]> {
  try {
    const response = await api.get<{ data: CurseFile }>(
      `/mods/${modId}/files/${file.id}`,
    );
    const dependencies = response.data.data?.dependencies;
    if (Array.isArray(dependencies)) {
      return dependencies;
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new CurseForgeError(
          "CurseForge отклонил ключ. Проверьте CURSEFORGE_API_KEY.",
          "fatal",
        );
      }
    }
    console.log(
      `CurseForge: не удалось прочитать файл ${file.id} мода ${modId}.`,
    );
  }

  return Array.isArray(file.dependencies) ? file.dependencies : [];
}

async function findMatchingFile(
  api: AxiosInstance,
  modId: number,
  gameVersion: string,
  modLoader: ModLoader,
): Promise<CurseFile> {
  const files: CurseFile[] = [];

  try {
    for (let index = 0; index < 200; index += 50) {
      const response = await api.get<{ data: CurseFile[] }>(
        `/mods/${modId}/files`,
        {
          params: {
            gameVersion,
            modLoaderType: LOADER_TYPE[modLoader],
            pageSize: 50,
            index,
          },
        },
      );
      const page = response.data.data ?? [];
      files.push(...page);
      if (page.length < 50) {
        break;
      }
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        throw new CurseForgeError(
          "CurseForge отклонил ключ. Проверьте CURSEFORGE_API_KEY.",
          "fatal",
        );
      }
      if (status === 404) {
        throw new CurseForgeError(
          `Мод ${modId} не найден на CurseForge.`,
          "missing",
        );
      }
    }
    throw new CurseForgeError(
      `Не удалось получить список файлов мода ${modId}.`,
      "missing",
    );
  }

  const match = chooseFile(files, gameVersion, LOADER_LABEL[modLoader]);
  if (!match) {
    throw new CurseForgeError(
      `Для мода ${modId} нет jar под Minecraft ${gameVersion} и ${LOADER_LABEL[modLoader]}.`,
      "missing",
    );
  }

  return match;
}

export function chooseFile(
  files: CurseFile[],
  gameVersion: string,
  loaderLabel: string,
): CurseFile | undefined {
  const suitable = files.filter((file) => {
    if (!file.fileName.toLowerCase().endsWith(".jar")) {
      return false;
    }
    if (file.isAvailable === false) {
      return false;
    }

    const versions = file.gameVersions ?? [];
    if (versions.length === 0) {
      return true;
    }

    const hasGame = versions.some(
      (version) => version.toLowerCase() === gameVersion.toLowerCase(),
    );
    const hasLoader = versions.some(
      (version) => version.toLowerCase() === loaderLabel.toLowerCase(),
    );
    return hasGame && hasLoader;
  });

  const releases = suitable.filter((file) => file.releaseType === 1);
  const pool = releases.length > 0 ? releases : suitable;

  return pool.sort(
    (left, right) => Date.parse(right.fileDate) - Date.parse(left.fileDate),
  )[0];
}

async function resolveDownloadUrl(
  api: AxiosInstance,
  modId: number,
  file: CurseFile,
): Promise<string> {
  if (file.downloadUrl) {
    return file.downloadUrl;
  }

  try {
    const response = await api.get<{ data: string }>(
      `/mods/${modId}/files/${file.id}/download-url`,
    );
    if (response.data.data) {
      return response.data.data;
    }
  } catch {
    // Автор мода мог запретить скачивание через API.
  }

  throw new CurseForgeError(
    `CurseForge не отдал ссылку на файл ${file.fileName} (мод ${modId}).`,
    "missing",
  );
}

async function downloadJar(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 60_000,
    maxContentLength: 80 * 1024 * 1024,
    maxBodyLength: 80 * 1024 * 1024,
  });

  return Buffer.from(response.data);
}

function uniqueJarName(
  fileName: string,
  modId: number,
  usedNames: Set<string>,
): string {
  const baseName = fileName.split(/[/\\]/).pop() ?? "";
  const cleaned = baseName.replace(/[^\w.\-+]+/g, "_");
  const jarName = cleaned.toLowerCase().endsWith(".jar")
    ? cleaned
    : `mod-${modId}.jar`;

  if (!usedNames.has(jarName.toLowerCase())) {
    usedNames.add(jarName.toLowerCase());
    return jarName;
  }

  const unique = `${modId}-${jarName}`;
  usedNames.add(unique.toLowerCase());
  return unique;
}
