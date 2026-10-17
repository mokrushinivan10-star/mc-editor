import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

const API_URL = "https://mc-editor.onrender.com";

const fieldClass =
  "mt-2 w-full border-4 border-t-zinc-800 border-r-zinc-600 border-b-zinc-500 border-l-zinc-700 bg-black px-4 py-3 text-zinc-300 outline-none placeholder:text-zinc-500 focus:border-[#55FF55]";

const buttonClass =
  "w-full border-4 border-t-zinc-400 border-r-zinc-600 border-b-zinc-700 border-l-zinc-500 bg-zinc-600 px-4 py-3 text-zinc-100 enabled:hover:border-green-400 enabled:hover:bg-zinc-500 enabled:hover:text-[#55FF55] disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-500";

type StatusResponse = {
  status: string;
  message: string;
};

type ModLoader = "forge" | "fabric";
type Step = "input" | "edit";

type GeneratedMod = {
  id: number;
  name: string;
  summary: string;
};

type ListResponse = {
  status: string;
  message?: string;
  mods: GeneratedMod[];
  loaderVersion?: string;
};

function App() {
  const [message, setMessage] = useState("Запрашиваю бэкенд...");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Моя сборка");
  const [gameVersion, setGameVersion] = useState("1.20.1");
  const [modLoader, setModLoader] = useState<ModLoader>("forge");
  const [prompt, setPrompt] = useState(
    "Стимпанк, поезда, сложные монстры ночами",
  );
  const [step, setStep] = useState<Step>("input");
  const [generatedMods, setGeneratedMods] = useState<GeneratedMod[]>([]);
  const [loaderVersion, setLoaderVersion] = useState<string | null>(null);
  const [addWish, setAddWish] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [buildWarning, setBuildWarning] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/status`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Сервер ответил кодом ${response.status}`);
        }

        return (await response.json()) as StatusResponse;
      })
      .then((data) => {
        setStatus(data.status);
        setMessage(data.message);
      })
      .catch(() => {
        setError(
          "Не удалось связаться с бэкендом. Запущен ли сервер на порту 5000?",
        );
      });
  }, []);

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Клиент Supabase не настроен.");
      return;
    }

    setSendingLink(true);
    setAuthError(null);
    setAuthMessage(null);
    const address = email.trim();

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: window.location.origin },
      });
      if (otpError) {
        throw otpError;
      }
      setAuthMessage(
        `Письмо со ссылкой отправлено на ${address}. Открой его в этом же браузере.`,
      );
    } catch (linkError) {
      setAuthError(
        linkError instanceof Error
          ? linkError.message
          : "Не удалось отправить письмо.",
      );
    } finally {
      setSendingLink(false);
    }
  }

  async function signInWithDiscord() {
    if (!supabase) {
      setAuthError("Клиент Supabase не настроен.");
      return;
    }

    setAuthError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setAuthError(oauthError.message);
    }
  }

  async function generateList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGenerating(true);
    setBuildError(null);
    setBuildMessage(null);
    setBuildWarning(null);

    try {
      const response = await fetch(`${API_URL}/api/generate-list`, {
        method: "POST",
        headers: authHeaders(session?.access_token),
        body: JSON.stringify({
          name,
          gameVersion,
          modLoader,
          prompt,
        }),
      });

      const data = await readJson<ListResponse>(
        response,
        "Сервер не смог подобрать моды.",
      );
      if (!Array.isArray(data.mods) || data.mods.length === 0) {
        throw new Error("ИИ не вернул список модов.");
      }

      setGeneratedMods(data.mods);
      setLoaderVersion(data.loaderVersion ?? null);
      setStep("edit");
    } catch (generateError) {
      setBuildError(
        generateError instanceof Error
          ? generateError.message
          : "Не удалось получить список модов.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function requestExtraMod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuggesting(true);
    setBuildError(null);

    try {
      const response = await fetch(`${API_URL}/api/add-mod-suggestion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: addWish,
          currentMods: generatedMods,
          gameVersion,
          modLoader,
        }),
      });

      const data = await readJson<{ mod?: GeneratedMod; message?: string }>(
        response,
        "Сервер не смог подобрать мод.",
      );
      const newMod = data.mod;
      if (!newMod || typeof newMod.id !== "number" || !newMod.name) {
        throw new Error("ИИ не вернул мод.");
      }

      setGeneratedMods((mods) =>
        mods.some((mod) => mod.id === newMod.id) ? mods : [...mods, newMod],
      );
      setAddWish("");
    } catch (suggestError) {
      setBuildError(
        suggestError instanceof Error
          ? suggestError.message
          : "Не удалось добавить мод.",
      );
    } finally {
      setSuggesting(false);
    }
  }

  function removeMod(index: number) {
    setGeneratedMods((mods) => mods.filter((_, itemIndex) => itemIndex !== index));
  }

  async function downloadPack() {
    setBuilding(true);
    setBuildError(null);
    setBuildMessage(null);
    setBuildWarning(null);

    try {
      const response = await fetch(`${API_URL}/api/build-pack`, {
        method: "POST",
        headers: authHeaders(session?.access_token),
        body: JSON.stringify({
          name,
          gameVersion,
          modLoader,
          mods: generatedMods,
        }),
      });

      const blob = await response.blob();
      if (!(await blobLooksLikeZip(blob))) {
        throw new Error(await readServerMessage(blob, response.ok));
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFromDisposition(
        response.headers.get("Content-Disposition"),
        `${name.trim() || "modpack"}.zip`,
      );
      link.click();
      URL.revokeObjectURL(url);
      setBuildMessage("Архив собран и передан браузеру.");
      if (response.headers.get("X-Pack-Status") === "warning") {
        const encoded = response.headers.get("X-Pack-Message");
        if (encoded) {
          setBuildWarning(decodeURIComponent(encoded));
        }
      }
    } catch (downloadError) {
      setBuildError(
        downloadError instanceof Error
          ? downloadError.message
          : "Не удалось скачать архив.",
      );
    } finally {
      setBuilding(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-900 bg-[linear-gradient(rgba(0,0,0,0.35)_2px,transparent_2px),linear-gradient(90deg,rgba(0,0,0,0.35)_2px,transparent_2px)] bg-size-[32px_32px] px-4 py-12 text-zinc-200">
      <section className="w-full max-w-2xl border-4 border-t-zinc-500 border-r-zinc-900 border-b-zinc-950 border-l-zinc-600 bg-zinc-800 p-8 sm:p-10">
        <p className="text-center font-pixel text-sm tracking-wide text-[#D6B56A]">
          AI Minecraft Modpack Generator
        </p>
        <h1 className="mt-4 text-center font-pixel text-2xl leading-relaxed text-[#8FB58A] sm:text-3xl">
          Сборка для Prism Launcher
        </h1>
        {error ? (
          <p className="mt-6 text-center text-[#FF5555]">{error}</p>
        ) : (
          <p className="mt-4 text-center text-sm text-zinc-400">
            {message}
            {status ? (
              <>
                {" "}
                · status:{" "}
                <span className="font-mono text-[#55FF55]">{status}</span>
              </>
            ) : null}
          </p>
        )}

        {session ? (
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <p className="text-zinc-400">{session.user.email ?? "Вход выполнен"}</p>
            <button
              className="border-4 border-t-zinc-400 border-r-zinc-600 border-b-zinc-700 border-l-zinc-500 bg-zinc-700 px-3 py-2 text-zinc-100 hover:border-red-400 hover:text-[#FF5555]"
              type="button"
              onClick={() => void supabase?.auth.signOut()}
            >
              Выйти
            </button>
          </div>
        ) : null}

        {!authReady ? (
          <p className="mt-8 text-center text-zinc-400">Проверяю вход...</p>
        ) : !session ? (
          <form className="mt-8 space-y-5" onSubmit={sendMagicLink}>
            <p className="text-center text-sm text-zinc-300">
              Войди, чтобы собирать модпаки. Бесплатно доступно 3 генерации в неделю.
            </p>
            {!supabase ? (
              <p className="text-center text-[#FF5555]">
                В фронтенде нет адреса и публичного ключа Supabase.
              </p>
            ) : null}
            <label className="block text-sm text-zinc-300">
              Email
              <input
                className={fieldClass}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="player@example.com"
                autoComplete="email"
                required
              />
            </label>
            <button className={buttonClass} type="submit" disabled={sendingLink || !supabase}>
              {sendingLink ? "Отправляю письмо..." : "Войти по почте"}
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={() => void signInWithDiscord()}
              disabled={!supabase}
            >
              Войти через Discord
            </button>
            {authMessage ? (
              <p className="text-center text-sm text-[#8FB58A]">{authMessage}</p>
            ) : null}
            {authError ? (
              <p className="text-center text-sm text-[#FF5555]">{authError}</p>
            ) : null}
          </form>
        ) : step === "input" ? (
        <form className="mt-8 space-y-5" onSubmit={generateList}>
          <label className="block text-sm text-zinc-300">
            Название сборки
            <input
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Версия Minecraft
            <input
              className={fieldClass}
              value={gameVersion}
              onChange={(event) => setGameVersion(event.target.value)}
              placeholder="1.20.1"
              required
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Загрузчик
            <select
              className={fieldClass}
              value={modLoader}
              onChange={(event) => setModLoader(event.target.value as ModLoader)}
            >
              <option value="forge">Forge</option>
              <option value="fabric">Fabric</option>
            </select>
          </label>

          <label className="block text-sm text-zinc-300">
            Опиши сборку своей мечты (ИИ подберет моды)
            <textarea
              className={`${fieldClass} min-h-36 resize-y`}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Стимпанк, поезда, сложные монстры ночами"
              required
              minLength={3}
              maxLength={2000}
            />
          </label>

          <button className={buttonClass} type="submit" disabled={generating || error !== null}>
            {generating ? "ИИ подбирает моды..." : "Сгенерировать"}
          </button>
        </form>
        ) : (
          <div className="mt-8">
            <p className="text-center text-sm text-zinc-400">
              Модов в сборке: {generatedMods.length}. Уберите лишнее до скачивания.
              {loaderVersion
                ? ` Загрузчик для ${gameVersion}: ${modLoader === "forge" ? "Forge" : "Fabric"} ${loaderVersion}.`
                : ""}
            </p>
            <ul className="mt-5 space-y-3">
              {generatedMods.map((mod, index) => (
                <li
                  key={`${mod.id}-${index}`}
                  className="border-4 border-t-zinc-600 border-r-zinc-950 border-b-black border-l-zinc-700 bg-black px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-pixel text-sm text-[#D6B56A]">{mod.name}</p>
                      <p className="mt-2 text-sm leading-5 text-zinc-300">{mod.summary}</p>
                      <p className="mt-1 font-mono text-xs text-zinc-500">#{mod.id}</p>
                    </div>
                    <button
                      className="shrink-0 border-4 border-t-zinc-400 border-r-zinc-600 border-b-zinc-700 border-l-zinc-500 bg-zinc-700 px-3 py-2 text-sm text-zinc-100 enabled:hover:border-red-400 enabled:hover:text-[#FF5555]"
                      type="button"
                      onClick={() => removeMod(index)}
                    >
                      ❌ Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="mt-6 border-4 border-t-zinc-600 border-r-zinc-950 border-b-black border-l-zinc-700 bg-zinc-900 p-4"
              onSubmit={requestExtraMod}
            >
              <p className="text-sm text-zinc-300">Добавить мод в сборку</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  className={`${fieldClass} mt-0 sm:flex-1`}
                  value={addWish}
                  onChange={(event) => setAddWish(event.target.value)}
                  placeholder="добавь мод на декоративные поезда"
                  minLength={3}
                  maxLength={300}
                  required
                />
                <button
                  className="shrink-0 border-4 border-t-zinc-400 border-r-zinc-600 border-b-zinc-700 border-l-zinc-500 bg-zinc-600 px-4 py-3 text-zinc-100 enabled:hover:border-green-400 enabled:hover:text-[#55FF55] disabled:cursor-wait disabled:bg-zinc-700 disabled:text-zinc-500"
                  type="submit"
                  disabled={suggesting || building || addWish.trim().length < 3}
                >
                  {suggesting ? "ИИ думает..." : "➕ Запросить у ИИ"}
                </button>
              </div>
            </form>
            <button
              className={`${buttonClass} mt-6`}
              type="button"
              onClick={() => void downloadPack()}
              disabled={building || generatedMods.length === 0}
            >
              {building ? "Собираю архив..." : "⛏️ Собрать и Скачать готовый ZIP"}
            </button>
            <button
              className="mt-3 w-full px-4 py-2 text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
              type="button"
              onClick={() => setStep("input")}
              disabled={building}
            >
              Вернуться к описанию
            </button>
          </div>
        )}

        {buildMessage && (
          <p className="mt-5 text-center text-[#55FF55]">{buildMessage}</p>
        )}
        {buildWarning && (
          <p className="mt-3 text-center text-[#FFFF55]">{buildWarning}</p>
        )}
        {buildError && (
          <p className="mt-5 text-center text-[#FF5555]">{buildError}</p>
        )}
        {session ? (
          <p className="mt-6 text-center text-xs leading-5 text-zinc-500">
            Сначала ИИ показывает список. После правки CurseForge добирает
            библиотеки и кладёт jar в .minecraft/mods внутри ZIP.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function authHeaders(accessToken: string | undefined): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function readJson<T extends { message?: string }>(
  response: Response,
  fallback: string,
): Promise<T> {
  const text = await response.text();
  if (text.startsWith("PK")) {
    throw new Error("Сервер прислал архив вместо списка модов.");
  }

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(response.ok ? "Сервер прислал не JSON." : fallback);
  }

  if (!response.ok) {
    throw new Error(data.message ?? fallback);
  }

  return data;
}

async function blobLooksLikeZip(blob: Blob): Promise<boolean> {
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  return header.length === 2 && header[0] === 0x50 && header[1] === 0x4b;
}

async function readServerMessage(blob: Blob, ok: boolean): Promise<string> {
  try {
    const data = JSON.parse(await blob.text()) as Partial<StatusResponse>;
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // Тело ответа не JSON: пустой ответ или чужой формат.
  }

  return ok ? "Сервер не вернул архив." : "Сервер не смог собрать архив.";
}

function fileNameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  const encoded = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encoded) {
    return fallback;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return fallback;
  }
}

export default App;
