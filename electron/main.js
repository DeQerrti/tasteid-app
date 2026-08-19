// ══════════════════════════════════════════════
//  ОКНО ПРИЛОЖЕНИЯ
//
//  Здесь только то, что умеет система и не умеет страница: выбрать
//  папку, нарисовать окно, запомнить масштаб. Вся логика паспорта — во
//  фронтенде, который переехал с сайта без правок, и в electron/api.js.
//
//  Порядок запуска:
//    папка известна и на месте  → сразу главная
//    папки нет или пропала      → экран приветствия
// ══════════════════════════════════════════════

import { app, BrowserWindow, dialog, shell, Menu, nativeTheme } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "./vault.js";
import { createServer, listen } from "./server.js";
import { titleBarOptions, titleBarCss, overlayColors } from "./chrome.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

// Путь к хранилищу и настройки самого окна. Живут не в хранилище —
// иначе их негде было бы прочитать до того, как оно выбрано.
const configFile = () => path.join(app.getPath("userData"), "config.json");

// Масштаб как у браузера: шаг примерно 10%, предел в обе стороны, чтобы
// нельзя было довести окно до нечитаемого и не суметь вернуть обратно.
const ZOOM_MIN = -3;
const ZOOM_MAX = 5;

let vault = null;
let win = null;
let port = null;
let config = {};

async function readConfig() {
  try {
    return JSON.parse(await fs.readFile(configFile(), "utf8"));
  } catch {
    return {};
  }
}

async function saveConfig(patch) {
  config = { ...config, ...patch };
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  await fs.writeFile(configFile(), JSON.stringify(config, null, 2));
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Хранилище ──────────────────────────────────

async function askForVault({ mode, previous } = {}) {
  const suggested = previous || path.join(app.getPath("documents"), "TasteID");
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: mode === "open" ? "Где лежит паспорт" : "Где хранить паспорт",
    defaultPath: suggested,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Выбрать папку",
  });
  return canceled ? null : filePaths[0];
}

async function useVault(root) {
  vault = new Vault(root);
  await vault.ensure();
  await saveConfig({ vaultPath: root });
}

// ── Мост для страницы ──────────────────────────
// Страница живёт в песочнице и до системы дотянуться не может — всё, что
// ей нужно от неё, проходит через эти обработчики. Список нарочно
// короткий: чем меньше страница умеет за пределами своей папки, тем
// меньше поводов об этом думать.

function appRoutes() {
  return {
    "GET /api/app/info": async () => ({
      vaultPath: vault?.root || null,
      zoom: config.zoom ?? 0,
      platform: process.platform,
      version: app.getVersion(),
    }),

    "POST /api/app/pick-vault": async ({ body }) => ({
      path: await askForVault({ mode: body.mode, previous: vault?.root }),
    }),

    "POST /api/app/use-vault": async ({ body }) => {
      if (!body.path) throw new Error("Не указана папка");
      await useVault(body.path);
      return { ok: true };
    },

    "POST /api/app/open-vault-folder": async () => {
      if (vault) await shell.openPath(vault.root);
      return { ok: true };
    },

    // Экран приветствия закончил работу — показываем сам паспорт.
    "POST /api/app/finish-setup": async () => {
      // Из компактного окна приветствия — в рабочее, и по центру экрана.
      // Разворачивание тоже возвращаем: это уже не мастер из одной
      // карточки, а обычное окно приложения.
      win?.setMaximizable(true);
      win?.setFullScreenable(true);
      win?.setBounds({ width: 1280, height: 900 });
      win?.center();
      openMain();
      return { ok: true };
    },

    "POST /api/app/zoom": async ({ body }) => {
      const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(body.level) || 0));
      applyZoom(level);
      await saveConfig({ zoom: level });
      return { zoom: level };
    },
  };
}

// ── Окно ───────────────────────────────────────

function applyZoom(level) {
  win?.webContents.setZoomLevel(level);
}

async function bumpZoom(delta) {
  const level = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (config.zoom ?? 0) + delta));
  applyZoom(level);
  await saveConfig({ zoom: level });
}

// Меню не показывается — окно безрамочное, полосы меню у него нет. Но
// сочетания клавиш из него работают, и ради них оно и заводится: без
// меню Ctrl+= и F5 просто перестают существовать.
function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Файл",
        submenu: [
          { role: "quit", label: "Выход" },
          {
            label: "Обновить",
            accelerator: "F5",
            click: () => win?.reload(),
          },
          {
            label: "Инструменты разработчика",
            accelerator: "F12",
            click: () => win?.webContents.toggleDevTools(),
          },
        ],
      },
      {
        label: "Вид",
        submenu: [
          { label: "Крупнее", accelerator: "CommandOrControl+=", click: () => bumpZoom(1) },
          { label: "Мельче", accelerator: "CommandOrControl+-", click: () => bumpZoom(-1) },
          {
            label: "Обычный размер",
            accelerator: "CommandOrControl+0",
            click: () => bumpZoom(-(config.zoom ?? 0)),
          },
          { role: "togglefullscreen", label: "Во весь экран" },
        ],
      },
    ])
  );
}

async function createWindow({ compact = false } = {}) {
  const skin = config.skin || "classic";
  win = new BrowserWindow({
    // Экран приветствия — окно поменьше: на нём один компактный список,
    // и растягивать его на весь монитор незачем. После настройки окно
    // вырастает до рабочего размера.
    width: compact ? 560 : 1280,
    height: compact ? 560 : 900,
    minWidth: compact ? 420 : 420,
    minHeight: compact ? 440 : 520,
    // На экране приветствия разворачивание на весь экран не нужно — как
    // у Обсидиана в его мастере создания хранилища: там тоже только
    // свернуть и закрыть. Кнопка «развернуть» с одной карточкой внутри
    // выглядела бы бессмысленно, а не полезно.
    maximizable: !compact,
    fullscreenable: !compact,
    // Показываем по ready-to-show: иначе первым кадром мелькает белый
    // прямоугольник поверх тёмной темы.
    show: false,
    backgroundColor: overlayColors(skin).bg,
    ...titleBarOptions(process.platform, overlayColors(skin)),
    webPreferences: {
      // Странице не нужны ни Node, ни выход из песочницы: с диском она
      // говорит только через локальный сервер, как раньше — с сайтом.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Полосу для перетаскивания вставляем на каждую загрузку: страниц
  // несколько, и каждая приходит со своим document.
  win.webContents.on("did-finish-load", async () => {
    await win.webContents.insertCSS(titleBarCss());
    applyZoom(config.zoom ?? 0);
    // Тему выбирают внутри приложения, а цвет рамки рисует система —
    // подхватываем его после загрузки, чтобы рамка не осталась тёмной
    // на светлой теме.
    try {
      const currentSkin = await win.webContents.executeJavaScript(
        "document.documentElement.dataset.skin || 'classic'"
      );
      if (currentSkin !== config.skin) await saveConfig({ skin: currentSkin });
      if (process.platform !== "darwin" && win.setTitleBarOverlay) {
        win.setTitleBarOverlay(
          titleBarOptions(process.platform, overlayColors(currentSkin)).titleBarOverlay
        );
      }
      nativeTheme.themeSource = /light|^soft$|^neomorphism$|^doodle$|^brutal$/.test(currentSkin)
        ? "light"
        : "dark";
    } catch {
      // Страница ещё не дочитала тему — рамка останется прежней, и это
      // не повод падать.
    }
  });

  // Внешние ссылки — в браузер, а не поверх приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function openMain() {
  win?.loadURL(`http://127.0.0.1:${port}/`);
}

function openWelcome() {
  win?.loadURL(`http://127.0.0.1:${port}/welcome`);
}

// ── Запуск ─────────────────────────────────────

app.whenReady().then(async () => {
  config = await readConfig();

  // Папка могла уехать на флешке или быть переименована. Молча завести
  // взамен пустую — худшее, что можно сделать: человек решит, что
  // данные пропали. Поэтому просто ведём на экран приветствия, где
  // видно, что папку надо указать.
  const known = config.vaultPath && (await exists(config.vaultPath));
  if (known) await useVault(config.vaultPath);

  const server = createServer({
    appDir: APP_DIR,
    getVault: () => vault,
    appRoutes: appRoutes(),
  });
  port = await listen(server);

  buildMenu();
  await createWindow({ compact: !known });
  if (known) openMain();
  else openWelcome();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length) return;
    await createWindow({ compact: !vault });
    if (vault) openMain();
    else openWelcome();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
