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

// Без замка на один экземпляр двойной клик по .exe при уже открытом
// окне (в том числе автозапуск после скачивания, за которым человек не
// уследил и запустил файл сам) заводит второй процесс поверх первого.
// Видимое окно закрывают — а первый, невидимый, остаётся висеть; отсюда
// и «TasteID запущено» при попытке удалить, когда с виду всё закрыто.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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

// ── Язык ───────────────────────────────────────
// Выбранный язык живёт в конфиге приложения, а не в хранилище: его надо
// знать на экране приветствия, когда папки ещё нет. Пока человек не
// выбрал сам — берём из локали системы, чтобы английский интерфейс
// достался тому, у кого английская ОС, без единого клика.
function appLanguage() {
  if (config.lang === "ru" || config.lang === "en") return config.lang;
  return /^ru/i.test(app.getLocale() || "") ? "ru" : "en";
}

// Здесь строк наперечёт (меню и один диалог), поэтому словарь свой, а не
// общий с фронтендом: тащить app/js/i18n.js в процесс Electron ради
// десятка подписей значило бы связать две несвязанные части.
const NATIVE_EN = {
  "Где лежит паспорт": "Where the passport is",
  "Где хранить паспорт": "Where to keep the passport",
  "Выбрать папку": "Choose folder",
  Файл: "File",
  Выход: "Quit",
  Обновить: "Reload",
  "Инструменты разработчика": "Developer tools",
  Вид: "View",
  Крупнее: "Zoom in",
  Мельче: "Zoom out",
  "Обычный размер": "Actual size",
  "Во весь экран": "Toggle full screen",
  "Не указана папка": "No folder given",
};
const tr = (ru) => (appLanguage() === "en" ? NATIVE_EN[ru] || ru : ru);

// ── Хранилище ──────────────────────────────────

async function askForVault({ mode, previous } = {}) {
  const suggested = previous || path.join(app.getPath("documents"), "TasteID");
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: mode === "open" ? tr("Где лежит паспорт") : tr("Где хранить паспорт"),
    defaultPath: suggested,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: tr("Выбрать папку"),
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
      lang: appLanguage(),
      platform: process.platform,
      version: app.getVersion(),
    }),

    "POST /api/app/pick-vault": async ({ body }) => ({
      path: await askForVault({ mode: body.mode, previous: vault?.root }),
    }),

    "POST /api/app/use-vault": async ({ body }) => {
      if (!body.path) throw new Error(tr("Не указана папка"));
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

    "POST /api/app/language": async ({ body }) => {
      const lang = body.lang === "en" ? "en" : "ru";
      await saveConfig({ lang });
      // Меню строится на текущем языке — пересобираем, иначе горячие
      // клавиши остались бы под старыми подписями.
      buildMenu();
      return { lang };
    },

    // Тему можно сменить и без перезагрузки страницы — предпросмотром
    // на экране приветствия, палитрой в настройках. did-finish-load
    // тогда не срабатывает, а рамка иначе так и осталась бы в цветах
    // темы, с которой открылось окно.
    "POST /api/app/set-titlebar-colors": async ({ body }) => {
      applyTitleBarColors(body.bg, body.symbol);
      return { ok: true };
    },
  };
}

// ── Окно ───────────────────────────────────────

function applyZoom(level) {
  win?.webContents.setZoomLevel(level);
}

const isHexColor = (v) => /^#[0-9a-f]{6}$/i.test(v || "");

// Красит кнопки окна в переданные цвета, если они и правда цвета —
// вызывается и с посчитанными на did-finish-load, и с тем, что страница
// сама прислала при живой смене темы (без перезагрузки).
function applyTitleBarColors(bg, symbol) {
  if (!win || process.platform === "darwin" || !win.setTitleBarOverlay) return;
  if (!isHexColor(bg) || !isHexColor(symbol)) return;
  win.setTitleBarOverlay(titleBarOptions(process.platform, { bg, symbol }).titleBarOverlay);
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
        label: tr("Файл"),
        submenu: [
          { role: "quit", label: tr("Выход") },
          {
            label: tr("Обновить"),
            accelerator: "F5",
            click: () => win?.reload(),
          },
          {
            label: tr("Инструменты разработчика"),
            accelerator: "F12",
            click: () => win?.webContents.toggleDevTools(),
          },
        ],
      },
      {
        label: tr("Вид"),
        submenu: [
          { label: tr("Крупнее"), accelerator: "CommandOrControl+=", click: () => bumpZoom(1) },
          { label: tr("Мельче"), accelerator: "CommandOrControl+-", click: () => bumpZoom(-1) },
          {
            label: tr("Обычный размер"),
            accelerator: "CommandOrControl+0",
            click: () => bumpZoom(-(config.zoom ?? 0)),
          },
          { role: "togglefullscreen", label: tr("Во весь экран") },
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

  // Синхронизация перед закрытием — если она подключена (app/js/sync.js),
  // дать ей недолго доработать перед закрытием окна: закрыв TasteID,
  // человек с большой вероятностью не откроет его снова в ближайшие
  // минуты, чтобы фоновая автосинхронизация успела сама. Перехватываем
  // именно закрытие ОКНА, а не app.on("before-quit") — к моменту
  // before-quit webContents уже уничтожены (window-all-closed срабатывает
  // после того, как окно закрылось), и звать executeJavaScript было бы
  // некуда. Закрыться нужно в любом случае — сеть может быть недоступна,
  // и зависать из-за этого нельзя.
  const closingWin = win;
  let closingForReal = false;
  closingWin.on("close", (e) => {
    if (closingForReal || closingWin.webContents.isDestroyed()) return;
    e.preventDefault();
    const finish = () => {
      closingForReal = true;
      closingWin.close();
    };
    const timeout = new Promise((resolve) => setTimeout(resolve, 6000));
    const synced = closingWin.webContents
      .executeJavaScript("window.__syncBeforeQuit ? window.__syncBeforeQuit() : null")
      .catch(() => {});
    Promise.race([synced, timeout]).then(finish);
  });

  // Полосу для перетаскивания вставляем на каждую загрузку: страниц
  // несколько, и каждая приходит со своим document.
  win.webContents.on("did-finish-load", async () => {
    await win.webContents.insertCSS(titleBarCss());
    applyZoom(config.zoom ?? 0);
    // Тему выбирают внутри приложения, а цвет рамки рисует система —
    // подхватываем его после загрузки, чтобы рамка не осталась тёмной
    // на светлой теме.
    try {
      // Цвета берём не по названию темы (их всего два варианта, светлый
      // и тёмный), а прямо из вычисленных --bg/--text-dim страницы —
      // так рамка совпадает и с ботанической тёмной (она не чёрная, а
      // тёмно-зелёная), и с любой перекрашенной вручную палитрой, а не
      // только с двумя зашитыми парами цветов.
      const {
        skin: currentSkin,
        bg,
        symbol,
      } = await win.webContents.executeJavaScript(`
        (() => {
          const cs = getComputedStyle(document.documentElement);
          return {
            skin: document.documentElement.dataset.skin || "classic",
            bg: cs.getPropertyValue("--bg").trim(),
            symbol: cs.getPropertyValue("--text-dim").trim(),
          };
        })()
      `);
      if (currentSkin !== config.skin) await saveConfig({ skin: currentSkin });
      if (isHexColor(bg) && isHexColor(symbol)) applyTitleBarColors(bg, symbol);
      else applyTitleBarColors(overlayColors(currentSkin).bg, overlayColors(currentSkin).symbol);
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

// Второй запуск при уже открытом окне — не вторая копия, а повод
// показать первую: тот самый случай, когда человек не заметил, что
// приложение уже открылось, и запустил .exe ещё раз.
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

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
    getLang: appLanguage,
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
