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
import { findUpdate, openDownload } from "./update.js";
// Именно так, а не `import { autoUpdater } from "electron-updater"`:
// electron-updater — модуль CommonJS, и в исходниках (npm start) Node
// достаточно снисходителен, чтобы сам разобрать его на именованные
// экспорты. Внутри упакованного app.asar (уже собранный .exe) он на это
// не идёт — падает с SyntaxError "Named export 'autoUpdater' not found"
// прямо при старте, до открытия окна. Через default-импорт и
// деструктуризацию работает в обоих случаях одинаково.
import pkg from "electron-updater";
const { autoUpdater } = pkg;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

// Без замка на один экземпляр двойной клик по .exe при уже открытом
// окне (в том числе автозапуск после скачивания, за которым человек не
// уследил и запустил файл сам) заводит второй процесс поверх первого.
// Видимое окно закрывают — а первый, невидимый, остаётся висеть; отсюда
// и «TasteID запущено» при попытке удалить, когда с виду всё закрыто.
//
// app.quit() сам по себе этого не гарантирует: он просит завершиться,
// но не останавливает выполнение скрипта немедленно — процесс вполне
// успевает дойти до whenReady() раньше, чем реально закроется. Дальше
// он натыкается на занятый порт (electron/server.js), тихо откатывается
// на случайный, поднимает свой собственный сервер и своё собственное
// окно — то есть проигравший гонку процесс не исчезает, а становится
// ещё одним, лишним. Отсюда разом и «нужно нажать несколько раз, чтобы
// открылось» (по одному лишнему процессу на каждый клик), и «TasteID
// запущено» при удалении — эти процессы никуда не делись, просто без
// видимого окна. process.exit() останавливает модуль на этом же месте,
// без всякой гонки.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Путь к хранилищу и настройки самого окна. Живут не в хранилище —
// иначе их негде было бы прочитать до того, как оно выбрано.
const configFile = () => path.join(app.getPath("userData"), "config.json");

// Масштаб — проценты, а не «уровни» setZoomLevel: тот множит на 1.2 за
// шаг, поэтому от 100% сразу прыгает на 120%, потом на 144% — с таким
// шагом не попасть ни на 110%, ни на 140%. setZoomFactor принимает
// множитель напрямую (1.4 = 140%), отсюда и везде проценты. Предел в
// обе стороны — чтобы нельзя было довести окно до нечитаемого и не
// суметь вернуть обратно.
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

let vault = null;
let win = null;
let port = null;
let config = {};

async function readConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(configFile(), "utf8"));
    // До этой версии zoom хранился «уровнем» setZoomLevel (-3..5, шаг
    // ×1.2 за step) — теперь это готовый процент для setZoomFactor
    // (50..200, см. комментарий у ZOOM_MIN). Уровень всегда меньше
    // ZOOM_MIN, живой процент — никогда, этим и отличаем старое
    // значение от нового; пересчитываем на лету, чтобы у тех, кто уже
    // подгонял масштаб под себя, он не сбросился молча на 100%.
    if (typeof cfg.zoom === "number" && cfg.zoom < ZOOM_MIN) {
      cfg.zoom = Math.round(100 * Math.pow(1.2, cfg.zoom));
    }
    return cfg;
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
  "Где находится хранилище": "Where the vault is",
  "Где создать хранилище": "Where to create the vault",
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
  "Хранилище не найдено": "Vault not found",
  "Нельзя убрать последнее хранилище.": "Can't remove the last vault.",
  "Сначала переключись на другое хранилище.": "Switch to another vault first.",
  "Доступно обновление": "Update available",
  "Обновление готово": "Update ready",
  Перезапустить: "Restart",
  Скачать: "Download",
  Позже: "Later",
};
const tr = (ru) => (appLanguage() === "en" ? NATIVE_EN[ru] || ru : ru);

// ── Хранилище ──────────────────────────────────

async function askForVault({ mode, previous } = {}) {
  const suggested = previous || path.join(app.getPath("documents"), "TasteID");
  const { canceled, filePaths } = await dialog.showOpenDialog(win ?? undefined, {
    title: mode === "open" ? tr("Где находится хранилище") : tr("Где создать хранилище"),
    defaultPath: suggested,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: tr("Выбрать папку"),
  });
  return canceled ? null : filePaths[0];
}

async function useVault(root) {
  vault = new Vault(root);
  await vault.ensure();
}

// ── Несколько хранилищ ──────────────────────────
// Список живёт в конфиге рядом с currentVaultId. Раньше был только
// один vaultPath — при первом запуске после обновления он переезжает
// сюда единственной записью и дальше не используется.
//
// Путь остаётся ключом: одна и та же папка не заводит вторую запись,
// даже если её выбрали заново через «Сменить папку» на старом экране
// настроек — тот код ничего не знает про список и просто просит
// открыть путь, а useVaultPath сам решает, новая это запись или уже
// существующая.

function genVaultId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function migrateVaults() {
  if (config.vaults || !config.vaultPath) return;
  const id = genVaultId();
  await saveConfig({
    vaults: [
      { id, name: path.basename(config.vaultPath) || tr("Хранилище"), path: config.vaultPath },
    ],
    currentVaultId: id,
  });
}

function currentVaultEntry() {
  return (config.vaults || []).find((v) => v.id === config.currentVaultId) || null;
}

async function addVaultEntry(root, name) {
  const id = genVaultId();
  const entry = { id, name: name || path.basename(root) || tr("Хранилище"), path: root };
  await useVault(root);
  await saveConfig({ vaults: [...(config.vaults || []), entry], currentVaultId: id });
  return entry;
}

async function switchVaultTo(id) {
  const entry = (config.vaults || []).find((v) => v.id === id);
  if (!entry) throw new Error(tr("Хранилище не найдено"));
  await useVault(entry.path);
  await saveConfig({ currentVaultId: id });
  return entry;
}

// Тот же путь мог уже быть в списке под своим именем — тогда просто
// переключаемся на запись, а не заводим дубликат с тем же адресом на
// диске. Используется и первым запуском (список ещё пуст), и старой
// кнопкой «Сменить папку» на экране приложения.
async function useVaultPath(root, name) {
  const existing = (config.vaults || []).find((v) => path.resolve(v.path) === path.resolve(root));
  if (existing) return switchVaultTo(existing.id);
  return addVaultEntry(root, name);
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
      vaults: (config.vaults || []).map(({ id, name, path: p }) => ({ id, name, path: p })),
      currentVaultId: config.currentVaultId || null,
      zoom: config.zoom ?? 100,
      lang: appLanguage(),
      platform: process.platform,
      version: app.getVersion(),
    }),

    "POST /api/app/check-update": async () => checkForUpdatesManual(),

    "POST /api/app/pick-vault": async ({ body }) => ({
      path: await askForVault({ mode: body.mode, previous: vault?.root }),
    }),

    "POST /api/app/use-vault": async ({ body }) => {
      if (!body.path) throw new Error(tr("Не указана папка"));
      const entry = await useVaultPath(body.path, body.name);
      return { ok: true, vault: entry };
    },

    "POST /api/app/switch-vault": async ({ body }) => {
      if (!body.id) throw new Error(tr("Хранилище не найдено"));
      const entry = await switchVaultTo(body.id);
      return { ok: true, vault: entry };
    },

    "POST /api/app/rename-vault": async ({ body }) => {
      const name = String(body.name || "").trim();
      if (!body.id || !name) throw new Error(tr("Хранилище не найдено"));
      const vaults = (config.vaults || []).map((v) => (v.id === body.id ? { ...v, name } : v));
      await saveConfig({ vaults });
      return { ok: true };
    },

    "POST /api/app/remove-vault": async ({ body }) => {
      const vaults = config.vaults || [];
      if (vaults.length <= 1) throw new Error(tr("Нельзя убрать последнее хранилище."));
      if (body.id === config.currentVaultId)
        throw new Error(tr("Сначала переключись на другое хранилище."));
      if (!vaults.some((v) => v.id === body.id)) throw new Error(tr("Хранилище не найдено"));
      await saveConfig({ vaults: vaults.filter((v) => v.id !== body.id) });
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
      const percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(body.percent) || 100));
      applyZoom(percent);
      await saveConfig({ zoom: percent });
      return { zoom: percent };
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

function applyZoom(percent) {
  win?.webContents.setZoomFactor(percent / 100);
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

async function bumpZoom(deltaPercent) {
  const percent = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (config.zoom ?? 100) + deltaPercent));
  applyZoom(percent);
  await saveConfig({ zoom: percent });
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
          {
            label: tr("Крупнее"),
            accelerator: "CommandOrControl+=",
            click: () => bumpZoom(ZOOM_STEP),
          },
          {
            label: tr("Мельче"),
            accelerator: "CommandOrControl+-",
            click: () => bumpZoom(-ZOOM_STEP),
          },
          {
            label: tr("Обычный размер"),
            accelerator: "CommandOrControl+0",
            click: () => bumpZoom(100 - (config.zoom ?? 100)),
          },
          { role: "togglefullscreen", label: tr("Во весь экран") },
        ],
      },
    ])
  );
}

// Заставка на время старта. До этого места окно не появлялось вообще,
// пока не отработают config/vault/сервер (обычно доля секунды, но на
// медленном диске или под антивирусом, который сканирует каждый файл
// на чтение, это способно растянуться на несколько секунд без единого
// признака жизни на экране — ровно то самое «нажал — курсор
// покрутился — и тишина», из-за которого нажимают ещё раз). Ей нечего
// грузить с сервера (тот ещё не поднят) и незачем знать тему (конфиг
// ещё не прочитан) — чистый data:, ноль сетевых обращений, поэтому и
// появляется почти мгновенно. Настоящее окно (createWindow ниже)
// создаётся следом и подменяет её, как только всё готово.
const SPLASH_HTML = `data:text/html,${encodeURIComponent(
  `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0a0a0c;display:flex;align-items:center;justify-content:center;}
.wordmark{font-family:Georgia,serif;font-style:italic;font-weight:700;font-size:1.6rem;color:#d9d5c9;opacity:.85;letter-spacing:.02em;}
</style></head><body><div class="wordmark">TasteID</div></body></html>`
)}`;

function createSplashWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 560,
    show: false,
    backgroundColor: "#0a0a0c",
    ...titleBarOptions(process.platform, overlayColors(undefined)),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(SPLASH_HTML);
  return win;
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
  //
  // Именно на dom-ready, а не на did-finish-load: did-finish-load
  // срабатывает поздно, уже после того как страница успела нарисоваться
  // без отступа сверху (body получает padding-top только вместе с этим
  // CSS) — и когда insertCSS наконец отрабатывал, весь контент резко
  // отъезжал вниз на высоту полосы. При быстрой повторной навигации (два
  // клика по логотипу подряд) это окно рассинхронизации растягивалось и
  // становилось заметно глазом: страница на секунду «прыгала» вверх, к
  // самому краю окна, а потом обратно вниз. dom-ready наступает сразу
  // после построения DOM, до отрисовки, — CSS успевает встать на место
  // раньше первого кадра.
  win.webContents.on("dom-ready", () => {
    win.webContents.insertCSS(titleBarCss()).catch(() => {});
  });

  win.webContents.on("did-finish-load", async () => {
    applyZoom(config.zoom ?? 100);
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

// ── Обновления ─────────────────────────────────
// На Windows и Linux — тихо: electron-updater сам качает файл в фоне,
// спрашиваем только когда всё уже готово и осталось лишь перезапустить.
// На macOS так не выходит — Gatekeeper блокирует подмену приложения в
// фоне без платной подписи (Apple Developer, $99/год) и нотаризации, а
// её здесь нет и не планируется. Поэтому мак остаётся на прежнем
// пути: диалог с версией и кнопка «Скачать», которая просто открывает
// страницу загрузки — установка вручную, как и раньше.
//
// Отказ («Позже») запоминается в конфиге по номеру версии, чтобы про
// одну и ту же версию не спрашивать на каждом запуске подряд — общее
// для обоих путей.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;

// Раньше здесь стоял dialog.showMessageBox — системная коробка Windows
// поверх тёмной страницы приложения, безо всякой связи с выбранной
// темой. Вместо неё — confirmDialog() из app/js/utils.js: та же
// модалка, что и везде в приложении (удаление полки, отката версии и
// т.д.), сама подхватывает тему и палитру. Зовём её из renderer'а через
// executeJavaScript — тем же приёмом, что уже работает для
// __syncBeforeQuit перед закрытием окна и для чтения цветов темы после
// загрузки страницы (см. чуть ниже).
// strict — см. confirmDialog() в app/js/utils.js: подложка и Escape
// диалог не закрывают, нужен явный клик по кнопке. Без этого диалог
// обновления, всплывший как раз в момент клика по вкладке где-то ещё
// на странице, засчитывал этот клик как «Позже» — человек ничего не
// нажимал, а уведомление уже пропадало.
async function showThemedUpdateDialog(message, actionLabel) {
  if (!win || win.webContents.isDestroyed()) return false;
  try {
    return await win.webContents.executeJavaScript(
      `window.confirmDialog(${JSON.stringify(message)}, ${JSON.stringify(actionLabel)}, ${JSON.stringify(tr("Позже"))}, {strict:true})`
    );
  } catch {
    // Страница ещё не загрузила utils.js (маловероятно, но не повод падать).
    return false;
  }
}

// Держим готовое к установке обновление отдельно от dismissedUpdate:
// человек мог один раз нажать «Позже», а потом передумать и нажать
// «Проверить обновления» в настройках — тогда файл уже скачан и
// диалог можно показать заново сразу, не дожидаясь следующего цикла
// autoUpdater.
let pendingUpdateInfo = null;

async function promptRestart(info) {
  const restart = await showThemedUpdateDialog(
    `${tr("Обновление готово")}: ${info.version}`,
    tr("Перезапустить")
  );
  // Второй аргумент — isForceRunAfter: без него electron-updater не
  // гарантирует перезапуск после тихой (oneClick) установки на Windows,
  // и приложение просто закрывалось, не открываясь обратно само.
  if (restart) autoUpdater.quitAndInstall(false, true);
  else await saveConfig({ dismissedUpdate: info.version });
}

autoUpdater.on("update-downloaded", async (info) => {
  pendingUpdateInfo = info;
  if (config.dismissedUpdate === info.version) return;
  await promptRestart(info);
});

async function checkForUpdatesMac() {
  try {
    const update = await findUpdate(app.getVersion());
    if (!update || config.dismissedUpdate === update.version) return;
    const download = await showThemedUpdateDialog(
      `${tr("Доступно обновление")}: ${update.version}`,
      tr("Скачать")
    );
    if (download) openDownload(update);
    else await saveConfig({ dismissedUpdate: update.version });
  } catch {
    // Нет сети или GitHub недоступен — не повод тревожить человека.
  }
}

// Ручная проверка — кнопка «Проверить обновления» в настройках.
// В отличие от автоматической, всегда снимает прошлый отказ: если
// человек однажды нажал «Позже», а потом сам попросил проверить снова,
// молчать в ответ на dismissedUpdate было бы странно.
async function checkForUpdatesManual() {
  if (!app.isPackaged) return { status: "dev" };

  if (process.platform === "darwin") {
    try {
      const update = await findUpdate(app.getVersion());
      if (!update) return { status: "latest" };
      const download = await showThemedUpdateDialog(
        `${tr("Доступно обновление")}: ${update.version}`,
        tr("Скачать")
      );
      if (download) openDownload(update);
      else await saveConfig({ dismissedUpdate: update.version });
      return { status: "available" };
    } catch {
      return { status: "error" };
    }
  }

  if (pendingUpdateInfo) {
    await promptRestart(pendingUpdateInfo);
    return { status: "available" };
  }

  await saveConfig({ dismissedUpdate: null });
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (!version || version === app.getVersion()) return { status: "latest" };
    // Обновление нашлось и качается в фоне — диалог покажет сам
    // обработчик update-downloaded, как только файл будет готов.
    return { status: "downloading" };
  } catch {
    return { status: "error" };
  }
}

async function checkForUpdates() {
  if (!app.isPackaged) return; // при запуске из исходников (npm start) не мешаем
  if (process.platform === "darwin") {
    await checkForUpdatesMac();
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // Нет сети или GitHub недоступен — не повод тревожить человека.
  }
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
  // Заставка сразу, до всего остального асинхронного — см. её же
  // комментарий выше про то, какую тишину она закрывает собой. `win`
  // указывает на неё с этого момента, поэтому second-instance тоже
  // получает что показать/сфокусировать, даже если второй клик пришёлся
  // на этот самый медленный участок, а не только после того, как всё
  // уже готово.
  const splash = createSplashWindow();

  config = await readConfig();
  await migrateVaults();

  // Папка могла уехать на флешке или быть переименована. Молча завести
  // взамен пустую — худшее, что можно сделать: человек решит, что
  // данные пропали. Поэтому просто ведём на экран приветствия, где
  // видно, что папку надо указать.
  const current = currentVaultEntry();
  const known = current && (await exists(current.path));
  if (known) await useVault(current.path);

  const server = createServer({
    appDir: APP_DIR,
    getVault: () => vault,
    appRoutes: appRoutes(),
    getLang: appLanguage,
  });
  port = await listen(server);

  buildMenu();
  await createWindow({ compact: !known });
  splash.close();
  if (known) openMain();
  else openWelcome();
  checkForUpdates();

  // Возрастная чистка .history — по желанию, необязательна (см. её же
  // комментарий в vault.js), не блокирует показ окна: это фоновая
  // уборка, а не то, чего человек ждёт при запуске.
  if (known) {
    vault
      .readJson("site-settings.json", {})
      .then((settings) => vault.pruneHistoryByAge(settings.historyRetentionDays))
      .catch(() => {});
  }

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
