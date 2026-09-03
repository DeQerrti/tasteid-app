// ══════════════════════════════════════════════
//  МОБИЛЬНАЯ ОБВЯЗКА
//
//  На компьютере страницы говорят с диском через локальный HTTP-сервер
//  на 127.0.0.1. На телефоне поднять его негде – но переписывать из-за
//  этого фронтенд не нужно: страница по-прежнему делает
//  fetch("/api/save-review") и fetch("/reviews.json"), а здесь эти
//  запросы перехватываются и уходят в файловую систему телефона.
//
//  Логика при этом та же самая: core/api.js делят настольная версия и
//  мобильная, отличается только реализация хранилища под ним.
//
//  Собирается в один обычный скрипт (app/js/mobile.bundle.js) – не
//  модуль: модули откладываются до конца разбора страницы, а theme.js
//  запрашивает site-settings.json уже во время разбора, и перехват
//  опоздал бы.
//
//  Вне телефона файл не делает ничего: на компьютере и на сайте есть
//  настоящий сервер, и подменять ему fetch незачем.
// ══════════════════════════════════════════════

import { Filesystem, Directory } from "@capacitor/filesystem";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Share } from "@capacitor/share";
import { App } from "@capacitor/app";
import { FileOpener } from "@capawesome-team/capacitor-file-opener";
import { registerPlugin, CapacitorHttp } from "@capacitor/core";
import { ROUTES, ApiError } from "../../core/api.js";
import { MobileVault } from "./vault.js";
// Свой маленький нативный плагин (android/app/src/main/java/ru/tasteid/
// app/InstallPermissionPlugin.java) – не из npm, регистрируется прямо в
// MainActivity.java. "Установка неизвестных приложений" начиная с
// Android 8 – не runtime-разрешение вроде камеры, которое система сама
// спрашивает, а отдельный тумблер в настройках на каждое приложение;
// готовых Capacitor-плагинов под него нет.
const InstallPermission = registerPlugin("InstallPermission");
// Версию спрашиваем у самого приложения, а не вшиваем из package.json
// на сборке. Так уже делает Gradle (android/app/build.gradle читает ту
// же package.json и кладёт её в versionName), и вторая копия того же
// числа внутри собранного бандла – ровно та лишняя сущность, которая
// однажды и разъехалась: bundle остался на 0.3.13, когда приложение
// уже было 0.3.20, и проверка обновлений на телефоне сравнивала себя
// со старым номером, то есть предлагала обновиться бесконечно.
// Заодно сам bundle перестаёт меняться от одного лишь поднятия версии.
let appVersionCache = null;
async function appVersion() {
  if (appVersionCache !== null) return appVersionCache;
  try {
    appVersionCache = (await App.getInfo()).version || "";
  } catch {
    appVersionCache = ""; // не нативная среда – там этот код и не работает
  }
  return appVersionCache;
}

const NATIVE = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();

// Файлы данных, которые страница читает напрямую, как читала на сайте.
const VAULT_FILES = /^\/(reviews|favorites|characters-tier|site-settings|tier-[^/]+)\.json$/i;

// Папки хранилища: covers, chars и папки коллекций тир-листа.
const VAULT_DIRS = /^\/(covers|covers-backup|chars|[^/]+)\/.+\.(png|jpe?g|webp|gif)$/i;

let vault = new MobileVault(currentVaultId());

// ── Несколько хранилищ ──────────────────────────
// На компьютере список {name, path} живёт в конфиге и путь выбирают
// проводником. На телефоне своего проводника нет: список – просто
// {id, name} в localStorage, а путь на диске всегда выводится из id
// (см. rootFor в vault.js). Поэтому здесь нет «выбрать папку» – есть
// только «дать имя», всё остальное берёт на себя MobileVault.
const VAULTS_KEY = "tasteid_vaults";
const CURRENT_VAULT_KEY = "tasteid_current_vault";

function genVaultId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function listVaults() {
  let list;
  try {
    list = JSON.parse(localStorage.getItem(VAULTS_KEY) || "null");
  } catch {
    list = null;
  }
  if (!Array.isArray(list) || !list.length) {
    // Первый запуск или обновление со старой версии, где хранилище
    // было одно без имени и без id – заводим список из одной записи,
    // указывающей на те же файлы, что уже лежат на диске.
    list = [{ id: "default", name: "TasteID" }];
    saveVaults(list);
  }
  return list;
}

function saveVaults(list) {
  localStorage.setItem(VAULTS_KEY, JSON.stringify(list));
}

function currentVaultId() {
  return localStorage.getItem(CURRENT_VAULT_KEY) || "default";
}

// Пути картинок кэшируются по имени файла – общий на все хранилища,
// поэтому при переключении его обязательно чистить, иначе после
// смены хранилища будут какое-то время показываться обложки из
// прошлого.
function clearImageCache() {
  srcCache.clear();
}

// ── Настройки самого приложения ────────────────
// На компьютере это /api/app/* в electron/main.js. Здесь тот же набор,
// но короче: вместо выбора папки – выбор хранилища из списка (или
// создание нового по имени).
//
// Масштаб раньше тоже считался «только для компьютера» (там это
// win.webContents.setZoomFactor, отдельный от страницы уровень
// нативного окна) – кнопки на телефоне были декорацией без всякого
// эффекта. Но системный масштаб экрана далеко не то же самое, что
// увеличить именно эту страницу, не трогая остальные приложения, а
// system-виджеты вроде мелких кнопок-иконок в настройках всё равно
// не растут. Android WebView (тот же движок, что Chrome) понимает CSS
// zoom не хуже компьютерного браузера – applyMobileZoom() ниже его и
// использует, персистентность – localStorage, а не файл настроек
// (это свойство самого устройства/установки, не данных хранилища,
// которое можно перенести на другой телефон).
const LANG_KEY = "tasteid_lang";
const ZOOM_KEY = "tasteid_zoom";

function getMobileZoom() {
  const saved = Number(localStorage.getItem(ZOOM_KEY));
  return saved >= 50 && saved <= 200 ? saved : 100;
}

function applyMobileZoom(percent) {
  // zoom, а не transform: scale – после transform пришлось бы вручную
  // пересчитывать ширину/высоту, чтобы контент не обрезался и не
  // оставлял пустых полей, а zoom честно меняет раскладку, как будто
  // окно физически другого размера (то же самое, что делает
  // webContents.setZoomFactor на компьютере).
  document.documentElement.style.zoom = percent + "%";
}

async function appRoutes(pathname, body) {
  if (pathname === "/api/app/info") {
    return {
      vaultPath: vault.root,
      vaults: listVaults(),
      currentVaultId: currentVaultId(),
      lang: currentLang(),
      platform: window.Capacitor?.getPlatform?.() || "mobile",
      version: await appVersion(),
      zoom: getMobileZoom(),
      mobile: true,
    };
  }
  if (pathname === "/api/app/zoom") {
    const percent = Math.min(200, Math.max(50, Number(body?.percent) || 100));
    localStorage.setItem(ZOOM_KEY, String(percent));
    applyMobileZoom(percent);
    return { zoom: percent };
  }
  if (pathname === "/api/app/switch-vault") {
    const entry = listVaults().find((v) => v.id === body?.id);
    if (!entry) throw new Error("Хранилище не найдено");
    localStorage.setItem(CURRENT_VAULT_KEY, entry.id);
    vault = new MobileVault(entry.id);
    await vault.ensure();
    clearImageCache();
    return { ok: true, vault: entry };
  }
  if (pathname === "/api/app/add-vault") {
    const name = String(body?.name || "").trim() || "TasteID";
    const entry = { id: genVaultId(), name };
    saveVaults([...listVaults(), entry]);
    localStorage.setItem(CURRENT_VAULT_KEY, entry.id);
    vault = new MobileVault(entry.id);
    await vault.ensure();
    clearImageCache();
    return { ok: true, vault: entry };
  }
  if (pathname === "/api/app/rename-vault") {
    const name = String(body?.name || "").trim();
    if (!body?.id || !name) throw new Error("Хранилище не найдено");
    saveVaults(listVaults().map((v) => (v.id === body.id ? { ...v, name } : v)));
    return { ok: true };
  }
  if (pathname === "/api/app/remove-vault") {
    const list = listVaults();
    if (list.length <= 1) throw new Error("Нельзя убрать последнее хранилище.");
    if (body?.id === currentVaultId()) throw new Error("Сначала переключись на другое хранилище.");
    const entry = list.find((v) => v.id === body?.id);
    if (!entry) throw new Error("Хранилище не найдено");
    // В отличие от компьютера – тут это настоящее удаление файлов, а
    // не просто снятие с полки: заново открыть отвязанную папку на
    // телефоне нечем, проводника нет.
    await new MobileVault(entry.id).remove();
    saveVaults(list.filter((v) => v.id !== entry.id));
    return { ok: true };
  }
  // Полоса состояния наверху экрана – то же, что рамка окна на
  // компьютере: страница шлёт сюда цвета при смене темы, и электронная
  // версия красит ими окно, а телефон – эту полосу. Запрос один и тот
  // же, поэтому в настройках ничего дописывать не пришлось.
  if (pathname === "/api/app/set-titlebar-colors") {
    paintStatusBar(body?.bg);
    return { ok: true };
  }
  if (pathname === "/api/app/language") {
    const lang = body?.lang === "en" ? "en" : "ru";
    localStorage.setItem(LANG_KEY, lang);
    document.cookie = `${LANG_KEY}=${lang}; path=/`;
    return { lang };
  }
  if (pathname === "/api/app/check-update") {
    const status = await checkForUpdate(true);
    return { status: status || "latest" };
  }
  // Остальное с телефона неприменимо, но отвечать надо: страница
  // проверяет наличие этих адресов, чтобы понять, что она в приложении.
  if (pathname.startsWith("/api/app/")) return { ok: true };
  return null;
}

// Цвет полосы состояния и – отдельно – цвет её значков: на светлой
// теме белые часы на белом фоне пропали бы совсем.
function paintStatusBar(bg) {
  const color = /^#[0-9a-f]{6}$/i.test(bg || "") ? bg : null;
  if (!color) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  StatusBar.setBackgroundColor({ color }).catch(() => {});
  StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
}

// При открытии страницы тему уже применил theme.js – значит, цвет фона
// можно просто прочитать со страницы, не спрашивая настройки заново.
//
// И следим дальше: тему меняют и без перезагрузки – предпросмотром в
// настройках, – а theme.js делает это через data-skin и свойства на
// <html>. Тот же приём, что на компьютере, где рамку окна перекрашивают
// на лету.
function watchPageColors() {
  const paint = () =>
    paintStatusBar(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  paint();
  new MutationObserver(paint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-skin", "style"],
  });
}

function currentLang() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "ru" || saved === "en") return saved;
  return /^ru/i.test(navigator.language || "") ? "ru" : "en";
}

// Язык страница читает из куки при разборе (см. app/js/i18n.js). На
// компьютере её ставит сервер; здесь ставим сами, и обязательно до
// того, как страница начнёт рисоваться.
function seedLangCookie() {
  document.cookie = `${LANG_KEY}=${currentLang()}; path=/`;
  document.cookie = "tasteid_ui=1; path=/";
}

// ── Сжатие резервных копий обложек ──────────────
// Тот же приём, что уже год как используют add.js/chars-edit.js/
// favorites-edit.js для своих загруженных файлов (canvas → webp, макс.
// 1200px, качество 0.85), только здесь для core/api.js: backupCover(),
// который качает обложку по внешней ссылке сам и раньше сохранял её
// как есть, без сжатия. На компьютере тот же интерфейс собирает sharp
// (нативный модуль, см. electron/image.js) – его нельзя затянуть сюда,
// в мобильный мост, который esbuild собирает в один файл для WebView,
// но здесь и не нужно: то же самое умеет обычный canvas браузера.
async function compressImage(bytes, contentType) {
  const blob = new Blob([bytes], { type: contentType || "image/png" });
  const bitmap = await createImageBitmap(blob);
  try {
    let { width, height } = bitmap;
    const maxSide = Math.max(width, height);
    if (maxSide > 1200) {
      const scale = 1200 / maxSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const outBlob = await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Не удалось сконвертировать"))),
        "image/webp",
        0.85
      )
    );
    return { bytes: new Uint8Array(await outBlob.arrayBuffer()), ext: "webp" };
  } finally {
    bitmap.close();
  }
}

// ── Список с MyAnimeList по нику ────────────────
// core/api.js делает этот запрос обычным fetch по умолчанию – хватает
// на компьютере, где он выполняется в Node (electron/server.js), а не
// в браузере. Здесь же, во WebView, тот же fetch упёрся бы в CORS: у
// ответа MAL нет Access-Control-Allow-Origin. CapacitorHttp делает
// запрос не из WebView, а с телефона напрямую – для него CORS не
// существует, как и для обычного fetch на компьютере.
async function malHttpGet(url) {
  const res = await CapacitorHttp.get({
    url,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    responseType: "text",
  });
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  return { status: res.status, text };
}

// ── Перехват запросов ──────────────────────────

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handle(pathname, search, init) {
  const method = (init?.method || "GET").toUpperCase();
  const body = init?.body ? JSON.parse(init.body) : {};

  if (pathname.startsWith("/api/app/")) {
    try {
      const app = await appRoutes(pathname, body);
      if (app) return jsonResponse(app);
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (pathname.startsWith("/api/")) {
    const handler = ROUTES[`${method} ${pathname}`];
    if (!handler) return jsonResponse({ error: "Not Found" }, 404);
    try {
      const query = new URLSearchParams(search || "");
      return jsonResponse((await handler({ vault, body, query, compressImage, malHttpGet })) || { ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, e instanceof ApiError ? e.status : 500);
    }
  }

  if (VAULT_FILES.test(pathname)) {
    const name = pathname.replace(/^\//, "");
    const fallback = name.includes("site-settings") ? {} : [];
    return jsonResponse(await vault.readJson(name, fallback));
  }

  return null; // не наше – пусть идёт обычным путём
}

function installFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    // Свои адреса всегда начинаются со слеша. Всё внешнее (AniList,
    // TMDB, обложки) уходит в сеть как есть.
    if (url.startsWith("/")) {
      const [pathname, search] = url.split("?");
      const merged = typeof input === "object" && input ? { ...input, ...init } : init;
      const res = await handle(pathname, search, merged);
      if (res) return res;
    }
    return original(input, init);
  };
}

// ── Картинки из хранилища ──────────────────────
// <img src="/chars/…"> – не fetch, а загрузка ресурса, и перехватить её
// подменой fetch нельзя. Capacitor умеет отдавать файл по своему адресу
// (convertFileSrc), поэтому такие пути переписываются на лету.
//
// Пути в данных при этом остаются прежними (/chars/…): паспорт должен
// одинаково читаться и на телефоне, и на компьютере.
const srcCache = new Map();

async function vaultSrc(pathname) {
  if (srcCache.has(pathname)) return srcCache.get(pathname);
  const promise = (async () => {
    const parts = decodeURIComponent(pathname).replace(/^\/+/, "");
    const { uri } = await Filesystem.getUri({
      path: `${vault.root}/${parts}`,
      directory: Directory.Data,
    });
    return window.Capacitor.convertFileSrc(uri);
  })();
  srcCache.set(pathname, promise);
  return promise;
}

function rewriteImage(img) {
  const src = img.getAttribute("src") || "";
  if (!src.startsWith("/") || !VAULT_DIRS.test(src)) return;
  if (img.dataset.vaultSrc === src) return;
  img.dataset.vaultSrc = src;
  vaultSrc(src)
    .then((real) => {
      if (img.dataset.vaultSrc === src) img.src = real;
    })
    .catch(() => {
      // Файла нет – сработает обычная подмена на заглушку (utils.js).
    });
}

function installImages() {
  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.tagName === "IMG") rewriteImage(root);
    root.querySelectorAll?.("img").forEach(rewriteImage);
  };

  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target.tagName === "IMG") rewriteImage(r.target);
      r.addedNodes?.forEach(scan);
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  scan(document.documentElement);
}

// ── Сохранение файлов ──────────────────────────
// Паспорт, тир-лист картинкой, версия из истории – всё это страница
// отдаёт одинаково: <a download> со ссылкой на blob. В браузере на
// компьютере такая ссылка кладёт файл в «Загрузки», а внутри
// приложения на телефоне не делает ничего вообще – нажатие просто
// пропадает. Именно этим путём паспорт и переносят на компьютер, так
// что молчаливый отказ здесь недопустим.
//
// Поэтому файл забирается сами и отдаётся системе: дальше человек сам
// выбирает, куда – в мессенджер, в облако, в «Файлы».
function installDownloads() {
  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest?.("a[download]");
      if (!link || !link.href) return;
      e.preventDefault();
      e.stopPropagation();
      // fetch запускаем сразу, не дожидаясь ничего: страница отзывает
      // ссылку на blob в следующей же строке после нажатия.
      const bytes = fetch(link.href).then((r) => r.arrayBuffer());
      shareFile(link.getAttribute("download") || "tasteid", bytes).catch(() => {});
    },
    true
  );
}

async function shareFile(name, bytesPromise) {
  const data = bytesToBase64(new Uint8Array(await bytesPromise));
  // Общая папка, а не хранилище: это не данные приложения, а разовый
  // файл «на вынос».
  await Filesystem.writeFile({ path: name, directory: Directory.Cache, data });
  const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache });
  await Share.share({ title: name, url: uri });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// ── Жест/кнопка «назад» ─────────────────────────
// Без этого обработчика системный жест на Android не умел ничего,
// кроме как закрыть приложение целиком: bridge последних версий
// Capacitor сам за WebView.history больше не следит – это отдано на
// откуп JS через плагин @capacitor/app. Итог по приоритету:
//   1. открыта модалка (карточка отзыва, форма нового тир-листа,
//      редактор тега и т.п.) – закрываем её, а не страницу;
//   2. есть куда возвращаться в истории WebView (например, зашёл в
//      add.html или на маршрут #/settings-edit со главной) – обычный
//      переход назад;
//   3. возвращаться некуда – сворачиваем/закрываем приложение, как
//      и ожидается от жеста на самом первом экране.
function closeVisibleModal() {
  const overlay = document.querySelector(
    ".modal-overlay:not(.hidden), .review-modal-overlay:not(.hidden)"
  );
  if (!overlay) return false;
  // Каждая страница сама решает, как закрыть свою модалку – общий для
  // всех приём: клик по самой подложке overlay воспроизводит клик по
  // фону, на который все они и так реагируют (закрытие по клику мимо
  // карточки), включая review-modal-overlay в reviews.js.
  overlay.click();
  return true;
}

function installBackButton() {
  App.addListener("backButton", ({ canGoBack }) => {
    if (closeVisibleModal()) return;
    // Если открыт маршрут с несохранёнными правками (см. setLeaveGuard()
    // в js/router.js – регистрируют js/routes/add.js и
    // js/routes/settings-edit.js), спрашиваем как и кнопка "назад" внутри
    // самого маршрута на ПК, вместо того чтобы сразу дёргать историю в
    // обход этой проверки – иначе жест "назад" на телефоне терял правки
    // молча там, где клик по той же кнопке на ПК их сохраняет.
    if (typeof window.getActiveLeaveGuard === "function") {
      const guard = window.getActiveLeaveGuard();
      if (typeof guard === "function") {
        guard();
        return;
      }
    }
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
}

// ── Проверка обновлений ─────────────────────────
// Тот же принцип, что и на компьютере (electron/update.js): спрашиваем
// GitHub, какой релиз последний, и если он новее – показываем полоску
// внизу экрана. Подтверждение установки Android всё равно спросит
// сам поверх старой версии – это его дело, не наше, но до этого шага
// теперь доводим сами: качаем apk внутри приложения и сразу открываем
// системным установщиком, а не выгружаем ссылку в «Поделиться» –
// раньше человеку приходилось самому открывать её в браузере, ждать
// скачивания и потом ещё находить файл в «Загрузках».
const UPDATE_REPO = "DeQerrti/tasteid-app";
const UPDATE_DISMISSED_KEY = "tasteid_update_dismissed";
const UPDATE_APK_NAME = "tasteid-update.apk";

// btoa от всей строки разом на файле в несколько мегабайт может
// упереться в предел одного вызова String.fromCharCode – переводим
// кусками.
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function downloadAndInstall(url) {
  const res = await window.fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = bufferToBase64(await res.arrayBuffer());
  await Filesystem.writeFile({ path: UPDATE_APK_NAME, directory: Directory.Cache, data });
  const { uri } = await Filesystem.getUri({ path: UPDATE_APK_NAME, directory: Directory.Cache });
  await FileOpener.openFile({ path: uri, mimeType: "application/vnd.android.package-archive" });
}

// Причина отказа – а не молчаливый откат на «Поделиться», как было.
// Отличить «нет сети» от «система отказала в установке» можно по
// тексту ошибки (fetch бросает свою, узнаваемую по HTTP/сети), всё
// остальное – это почти всегда Play Защита: она сканирует любой apk,
// поставленный не из Play Store, независимо от тумблера «Установка
// неизвестных приложений» (тот лишь разрешает саму попытку) – и либо
// предупреждает, либо блокирует совсем, в обоих случаях FileOpener
// получает отказ, из которого не вытащить точную причину. Инструкция
// ниже – единственный настоящий способ снять её со счётчиков: она
// не выключается ни разрешением на телефоне, ни кодом самого
// приложения, только в настройках самого Play Store.
function describeUpdateError(e, ru) {
  const msg = (e && (e.message || e.errorMessage)) || (e ? String(e) : "");
  const isNetwork = /HTTP \d|fetch|network|failed to fetch|net::/i.test(msg);

  if (isNetwork) {
    return ru
      ? `Не получилось скачать файл${msg ? ` (${msg})` : ""}. Это не обязательно проблема с интернетом – чаще всего так выглядит, когда телефон или Play Защита не дают приложению самому скачать файл, не входящий в Play Store. Надёжнее нажать «Поделиться» ниже и открыть ссылку в браузере (Chrome и т.п.) – он умеет скачивать такие файлы напрямую, в объяснении в настройках → «Приложение» → «Обновления» расписано по шагам.`
      : `Couldn't download the file${msg ? ` (${msg})` : ""}. This isn't necessarily a connection problem – it usually looks like this when the phone or Play Protect won't let the app download a file that isn't from Play Store itself. It's more reliable to press "Share" below and open the link in a browser (Chrome, etc.) – it can download this kind of file directly; see Settings → "App" → "Updates" for the step-by-step version.`;
  }

  return ru
    ? `Система отказала в установке${msg ? ` (${msg})` : ""}. Чаще всего это Play Защита – она проверяет любое приложение, поставленное не из Play Store, и либо предупреждает о нём, либо блокирует совсем, отдельно от разрешения «Установка неизвестных приложений». Чтобы установить: Play Store → значок профиля → «Play Защита» → шестерёнка настроек → выключите «Сканировать приложения с помощью Play Защиты», затем нажмите «Обновить» ещё раз. Если на телефоне нет Play Store (некоторые модели Huawei) или он всё равно отказывает – поищите похожую настройку в своём фирменном приложении безопасности (обычно называется «Безопасность» или «Диспетчер телефона») и отключите там проверку устанавливаемых приложений. Либо нажмите «Поделиться» ниже и установите apk вручную.`
    : `The system refused to install${msg ? ` (${msg})` : ""}. This is usually Play Protect – it scans any app installed outside Play Store and either warns about it or blocks it outright, separately from the "install unknown apps" permission. To install: Play Store → profile icon → "Play Protect" → settings gear → turn off "Scan apps with Play Protect", then press "Update" again. If your phone has no Play Store (some Huawei models) or it still refuses – look for a similar setting in your phone's own security app (often called "Security" or "Phone Manager") and turn off scanning of installed apps there. Or press "Share" below to install the apk manually.`;
}

function isNewerVersion(latest, current) {
  const a = latest.replace(/^v/i, "").split(".").map(Number);
  const b = current.replace(/^v/i, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Диалог обновления – та же коробка, что и everywhere ещё (см.
// confirmDialog/promptDialog в js/utils.js): классы .modal-overlay/.modal
// берут цвета из :root, который выставляет js/theme.js, поэтому тему
// подхватывают сами, без своих цветов здесь. Раньше это была отдельная
// строка внизу экрана с зашитыми hex-цветами (#2b2318 и т.д.) – она не
// менялась вместе с темой сайта и, что важнее, висела в самом людном
// месте экрана: над нижней панелью вкладок и рядом с плавающей кнопкой
// «Добавить» (#mobile-fab-add, см. index.html). Обычным confirmDialog()
// здесь не обойтись – тому после клика по кнопке нечем показать
// «Загрузка…» на самой кнопке (диалог закрывается сразу же), поэтому
// коробка собирается вручную, но теми же классами и той же вёрсткой
// действий (.confirm-dialog-actions), что и у него.
let updateDialogEl = null;

function showUpdateBanner(version, url) {
  const ru = currentLang() !== "en";

  if (!updateDialogEl) {
    updateDialogEl = document.createElement("div");
    updateDialogEl.id = "update-dialog-overlay";
    updateDialogEl.className = "modal-overlay hidden";
    updateDialogEl.innerHTML =
      '<div class="modal confirm-dialog">' +
      '<div class="confirm-dialog-text" id="update-dialog-text"></div>' +
      '<div class="confirm-dialog-actions">' +
      '<button type="button" class="btn btn-ghost" id="update-dialog-later"></button>' +
      '<button type="button" class="btn btn-primary" id="update-dialog-update"></button>' +
      "</div></div>";
    document.body.appendChild(updateDialogEl);
    // Ни клика по подложке, ни Escape – тот же «strict», что у
    // confirmDialog() для этого же случая (см. её же комментарий в
    // utils.js): диалог о доступном обновлении может всплыть прямо
    // посреди клика по чему-то другому на экране, и такой клик не
    // должен молча посчитаться отказом от обновления.
  }

  const textEl = updateDialogEl.querySelector("#update-dialog-text");
  const updateBtn = updateDialogEl.querySelector("#update-dialog-update");
  const laterBtn = updateDialogEl.querySelector("#update-dialog-later");

  textEl.textContent = ru ? `Доступна версия ${version}` : `Version ${version} available`;
  updateBtn.disabled = false;
  updateBtn.textContent = ru ? "Обновить" : "Update";
  laterBtn.textContent = ru ? "Позже" : "Later";

  const close = () => updateDialogEl.classList.add("hidden");

  updateBtn.onclick = async () => {
    // Ссылка на страницу релиза (а не сам apk) – checkForUpdate() ниже
    // подставляет её запасным вариантом, когда среди файлов релиза apk
    // не нашёлся. Раньше здесь сразу и молча уходили в «Поделиться» –
    // без единого слова объяснения, что случилось. А случиться может
    // самое обычное: релиз собирается тремя параллельными джобами
    // (build.yml – Windows/Mac/Linux и Android отдельно), и apk на
    // GitHub иногда появляется на минуту-другую позже остальных
    // файлов. Если телефон проверяет обновление ровно в эту паузу –
    // apk среди assets ещё не значится, хотя через пару минут появится.
    // Показываем это прямым текстом и оставляем «Поделиться» отдельным
    // осознанным нажатием, а не тем, что срабатывает само.
    if (!/\.apk(\?|$)/i.test(url)) {
      textEl.textContent = ru
        ? "У этого релиза пока нет файла для Android – сборка обычно занимает пару минут после выхода версии. Попробуйте проверить обновление ещё раз чуть позже, либо откройте страницу релиза кнопкой «Поделиться» и установите оттуда вручную, когда файл появится."
        : 'This release doesn\'t have an Android file yet – the build usually takes a couple of minutes after a new version goes out. Try checking for updates again in a bit, or open the release page with "Share" below and install from there once the file shows up.';
      updateBtn.textContent = ru ? "Поделиться" : "Share";
      updateBtn.onclick = () => {
        Share.share({ title: "TasteID", url }).catch(() => {});
        close();
      };
      return;
    }

    // «Установка неизвестных приложений» – отдельный тумблер в
    // настройках на каждое приложение (см. комментарий у
    // InstallPermission выше), а не runtime-разрешение с обычным
    // диалогом «Разрешить». Без него FileOpener.openFile() ниже просто
    // молча падал, и обновление откатывалось на «Поделиться» без
    // единого объяснения – человеку неоткуда было узнать, что вообще
    // произошло и что можно включить нужный тумблер самому.
    try {
      const { value: canInstall } = await InstallPermission.canRequestPackageInstalls();
      if (!canInstall) {
        textEl.textContent = ru
          ? "Нужно разрешить установку из этого источника – сейчас откроются настройки. Включите переключатель, вернитесь и нажмите «Обновить» ещё раз."
          : 'Installing needs permission for this source – opening settings now. Turn it on, come back, and press "Update" again.';
        await InstallPermission.openSettings();
        return; // диалог остаётся открытым – сам close() не зовём
      }
    } catch {
      // Плагина нет (например, apk собран до его появления) – не повод
      // блокировать обновление: просто продолжаем как раньше, а если
      // всё-таки упадёт – откатимся на «Поделиться» в catch ниже.
    }

    updateBtn.disabled = true;
    updateBtn.textContent = ru ? "Загрузка…" : "Downloading…";
    try {
      await downloadAndInstall(url);
      close();
    } catch (e) {
      // Раньше здесь просто молча подставлялось «Поделиться» – причина
      // уходила только в консоль, до которой человеку не добраться.
      // Теперь настоящий текст ошибки и что с ним делать – прямо в
      // диалоге, а «Обновить» превращается в «Поделиться» на этот же
      // клик, чтобы не потерять и старый запасной путь.
      console.error("[update] скачивание/установка не удались:", e);
      textEl.textContent = describeUpdateError(e, ru);
      updateBtn.disabled = false;
      updateBtn.textContent = ru ? "Поделиться" : "Share";
      updateBtn.onclick = () => {
        Share.share({ title: "TasteID", url }).catch(() => {});
        close();
      };
    }
  };

  laterBtn.onclick = () => {
    localStorage.setItem(UPDATE_DISMISSED_KEY, `v${version}`);
    close();
  };

  updateDialogEl.classList.remove("hidden");
}

// force – кнопка «Проверить обновления» в настройках: снимает прошлый
// отказ («Позже») и всегда возвращает статус, а не молчит, как тихая
// проверка при запуске.
async function checkForUpdate(force = false) {
  try {
    const res = await window.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return force ? "error" : undefined;
    const release = await res.json();
    const tag = release.tag_name || "";
    const mine = await appVersion();
    if (!tag || !mine || !isNewerVersion(tag, mine)) return force ? "latest" : undefined;
    if (!force && localStorage.getItem(UPDATE_DISMISSED_KEY) === tag) return;
    if (force) localStorage.removeItem(UPDATE_DISMISSED_KEY);
    const asset = (release.assets || []).find((a) => /\.apk$/i.test(a.name));
    showUpdateBanner(tag.replace(/^v/i, ""), asset?.browser_download_url || release.html_url);
    return "available";
  } catch {
    return force ? "error" : undefined;
  }
}

// ── Запуск ─────────────────────────────────────

if (NATIVE) {
  // До installFetch/seedLangCookie – этот файл выполняется во время
  // разбора страницы (см. её же комментарий в шапке файла), поэтому
  // масштаб успевает примениться раньше первой отрисовки, без мигания
  // «сначала 100%, через мгновение нужный процент».
  applyMobileZoom(getMobileZoom());
  seedLangCookie();
  installFetch();
  vault.ensure().catch(() => {});
  checkForUpdate().catch(() => {});
  // Возрастная чистка .history – по желанию, необязательна (см. её же
  // комментарий в electron/vault.js), фоном, не блокирует запуск.
  vault
    .readJson("site-settings.json", {})
    .then((settings) => vault.pruneHistoryByAge(settings.historyRetentionDays))
    .catch(() => {});
  const ready = () => {
    installImages();
    installDownloads();
    installBackButton();
    watchPageColors();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
}
