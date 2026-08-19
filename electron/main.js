// ══════════════════════════════════════════════
//  ОКНО ПРИЛОЖЕНИЯ
//
//  Всё, что здесь происходит: выбрать папку хранилища, поднять локальный
//  сервер и показать окно с нашими же страницами. Никакой логики сайта
//  тут нет и быть не должно — она вся во фронтенде, который переехал без
//  правок, и в electron/api.js.
// ══════════════════════════════════════════════

import { app, BrowserWindow, dialog, shell, Menu } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./vault.js";
import { createServer, listen } from "./server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

// Где лежит путь к хранилищу. Сам он живёт не в хранилище (иначе его
// негде было бы прочитать), а рядом с настройками приложения.
const configFile = () => path.join(app.getPath("userData"), "config.json");

let vault = null;
let win = null;
let port = null;

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configFile(), "utf8"));
  } catch {
    return {};
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2));
}

// Папку выбирает человек, и по умолчанию предлагаем ту, что рядом с
// документами: хранилище должно лежать там, где его видно и откуда его
// подхватит любое облако, а не в недрах системных папок приложения.
async function askForVault(previous) {
  const suggested = previous || path.join(app.getPath("documents"), "TasteID");
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Где хранить данные TasteID",
    defaultPath: suggested,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Выбрать папку",
  });
  return canceled ? null : filePaths[0];
}

async function useVault(root) {
  vault = new Vault(root);
  await vault.ensure();
  await writeConfig({ ...(await readConfig()), vaultPath: root });
}

function buildMenu() {
  const template = [
    {
      label: "Файл",
      submenu: [
        {
          label: "Открыть папку с данными",
          click: () => vault && shell.openPath(vault.root),
        },
        {
          label: "Сменить папку с данными…",
          click: async () => {
            const picked = await askForVault(vault?.root);
            if (!picked) return;
            await useVault(picked);
            win?.reload();
          },
        },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    },
    {
      label: "Вид",
      submenu: [
        { role: "reload", label: "Обновить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
        { type: "separator" },
        { role: "resetZoom", label: "Обычный размер" },
        { role: "zoomIn", label: "Крупнее" },
        { role: "zoomOut", label: "Мельче" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Во весь экран" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 360,
    // Окно показываем не сразу, а по ready-to-show: иначе первым кадром
    // мелькает белый прямоугольник поверх тёмной темы.
    show: false,
    backgroundColor: "#0a0a0c",
    webPreferences: {
      // Странице не нужны ни Node, ни доступ в обход песочницы: она
      // общается с диском только через локальный сервер, как раньше
      // общалась с сайтом.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  // Внешние ссылки — в браузер, а не поверх приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(async () => {
  const config = await readConfig();
  let root = config.vaultPath;

  // Проверяем, что папка всё ещё на месте: хранилище могли унести на
  // флешке или переименовать, и молча завести новое пустое было бы
  // худшим вариантом — человек решил бы, что данные пропали.
  if (root) {
    try {
      await fs.access(root);
    } catch {
      const answer = await dialog.showMessageBox({
        type: "warning",
        title: "Папка с данными не найдена",
        message: `Папки «${root}» больше нет по этому пути.`,
        detail:
          "Если она переехала — укажи, куда. Ничего не удалено: данные лежат в той папке, где бы она ни была.",
        buttons: ["Указать папку", "Выйти"],
        defaultId: 0,
        cancelId: 1,
      });
      root = answer.response === 0 ? await askForVault() : null;
      if (!root) return app.quit();
    }
  }

  if (!root) {
    root = await askForVault();
    if (!root) return app.quit();
  }

  await useVault(root);

  const server = createServer({ appDir: APP_DIR, getVault: () => vault });
  port = await listen(server);

  buildMenu();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
