/**
 * Контракт будущего окна .exe.
 *
 * Сейчас двойной щелчок по run_app.bat делает то же самое вручную:
 * поднимает два локальных процесса и открывает окно на адрес фронтенда.
 * Сборка в один файл повторит эти шаги внутри оболочки окна.
 *
 * Окно не заменяет сервер. Оно только показывает страницу.
 * Мозг приложения остаётся Node-бэкендом на 127.0.0.1:5000.
 * Страница React по-прежнему ходит туда за архивом сборки.
 */

export const desktopHost = {
  api: {
    cwd: "backend",
    devArgs: ["--env-file=.env", "--import", "tsx", "src/index.ts"],
    prodArgs: ["--env-file=.env", "dist/index.js"],
    healthUrl: "http://127.0.0.1:5000/api/status",
  },
  window: {
    devUrl: "http://127.0.0.1:5173/",
    distDir: "frontend/dist",
    width: 960,
    height: 820,
    title: "AI Minecraft Modpack Generator",
  },
};

const isDirectRun = process.argv[1] && process.argv[1].endsWith("host.mjs");
if (isDirectRun) {
  console.log(JSON.stringify(desktopHost, null, 2));
}
