// ══════════════════════════════════════════════
//  МОБИЛЬНАЯ ОБВЯЗКА
//
//  На компьютере страницы говорят с диском через локальный HTTP-сервер
//  на 127.0.0.1. На телефоне поднять его негде — но переписывать из-за
//  этого фронтенд не нужно: страница по-прежнему делает
//  fetch("/api/save-review") и fetch("/reviews.json"), а здесь эти
//  запросы перехватываются и уходят в файловую систему телефона.
//
//  Логика при этом та же самая: core/api.js делят настольная версия и
//  мобильная, отличается только реализация хранилища под ним.
//
//  Собирается в один обычный скрипт (app/js/mobile.bundle.js) — не
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
import { ROUTES, ApiError } from "../../core/api.js";
import { MobileVault } from "./vault.js";
import { version as APP_VERSION } from "../../package.json";

const NATIVE = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();

// Файлы данных, которые страница читает напрямую, как читала на сайте.
const VAULT_FILES = /^\/(reviews|favorites|characters-tier|site-settings|tier-[^/]+)\.json$/i;

// Папки хранилища: covers, chars и папки коллекций тир-листа.
const VAULT_DIRS = /^\/(covers|covers-backup|chars|[^/]+)\/.+\.(png|jpe?g|webp|gif)$/i;

let vault = new MobileVault(currentVaultId());

// ── Несколько хранилищ ──────────────────────────
// На компьютере список {name, path} живёт в конфиге и путь выбирают
// проводником. На телефоне своего проводника нет: список — просто
// {id, name} в localStorage, а путь на диске всегда выводится из id
// (см. rootFor в vault.js). Поэтому здесь нет «выбрать папку» — есть
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
    // было одно без имени и без id — заводим список из одной записи,
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

// Пути картинок кэшируются по имени файла — общий на все хранилища,
// поэтому при переключении его обязательно чистить, иначе после
// смены хранилища будут какое-то время показываться обложки из
// прошлого.
function clearImageCache() {
  srcCache.clear();
}

// ── Настройки самого приложения ────────────────
// На компьютере это /api/app/* в electron/main.js. Здесь тот же набор,
// но короче: масштаб задаёт сама система, а вместо выбора папки —
// выбор хранилища из списка (или создание нового по имени).
const LANG_KEY = "tasteid_lang";

async function appRoutes(pathname, body) {
  if (pathname === "/api/app/info") {
    return {
      vaultPath: vault.root,
      vaults: listVaults(),
      currentVaultId: currentVaultId(),
      lang: currentLang(),
      platform: window.Capacitor?.getPlatform?.() || "mobile",
      version: APP_VERSION,
      mobile: true,
    };
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
    // В отличие от компьютера — тут это настоящее удаление файлов, а
    // не просто снятие с полки: заново открыть отвязанную папку на
    // телефоне нечем, проводника нет.
    await new MobileVault(entry.id).remove();
    saveVaults(list.filter((v) => v.id !== entry.id));
    return { ok: true };
  }
  // Полоса состояния наверху экрана — то же, что рамка окна на
  // компьютере: страница шлёт сюда цвета при смене темы, и электронная
  // версия красит ими окно, а телефон — эту полосу. Запрос один и тот
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
  // Остальное с телефона неприменимо, но отвечать надо: страница
  // проверяет наличие этих адресов, чтобы понять, что она в приложении.
  if (pathname.startsWith("/api/app/")) return { ok: true };
  return null;
}

// Цвет полосы состояния и — отдельно — цвет её значков: на светлой
// теме белые часы на белом фоне пропали бы совсем.
function paintStatusBar(bg) {
  const color = /^#[0-9a-f]{6}$/i.test(bg || "") ? bg : null;
  if (!color) return;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * b > 140;
  StatusBar.setBackgroundColor({ color }).catch(() => {});
  StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
}

// При открытии страницы тему уже применил theme.js — значит, цвет фона
// можно просто прочитать со страницы, не спрашивая настройки заново.
//
// И следим дальше: тему меняют и без перезагрузки — предпросмотром в
// настройках, — а theme.js делает это через data-skin и свойства на
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
      return jsonResponse((await handler({ vault, body, query })) || { ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, e instanceof ApiError ? e.status : 500);
    }
  }

  if (VAULT_FILES.test(pathname)) {
    const name = pathname.replace(/^\//, "");
    const fallback = name.includes("site-settings") ? {} : [];
    return jsonResponse(await vault.readJson(name, fallback));
  }

  return null; // не наше — пусть идёт обычным путём
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
// <img src="/chars/…"> — не fetch, а загрузка ресурса, и перехватить её
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
      // Файла нет — сработает обычная подмена на заглушку (utils.js).
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
// Паспорт, тир-лист картинкой, версия из истории — всё это страница
// отдаёт одинаково: <a download> со ссылкой на blob. В браузере на
// компьютере такая ссылка кладёт файл в «Загрузки», а внутри
// приложения на телефоне не делает ничего вообще — нажатие просто
// пропадает. Именно этим путём паспорт и переносят на компьютер, так
// что молчаливый отказ здесь недопустим.
//
// Поэтому файл забирается сами и отдаётся системе: дальше человек сам
// выбирает, куда — в мессенджер, в облако, в «Файлы».
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

// ── Проверка обновлений ─────────────────────────
// Тот же принцип, что и на компьютере (electron/update.js): спрашиваем
// GitHub, какой релиз последний, и если он новее — показываем полоску
// внизу экрана. В один клик здесь не поставить: Android всё равно
// попросит подтверждение при установке файла поверх старой версии,
// поэтому кнопка открывает системный шаринг на apk, откуда его удобно
// сохранить и открыть через браузер или «Файлы».
const UPDATE_REPO = "DeQerrti/tasteid-app";
const UPDATE_DISMISSED_KEY = "tasteid_update_dismissed";

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

function showUpdateBanner(version, url) {
  const ru = currentLang() !== "en";
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:99999;display:flex;align-items:center;" +
    "justify-content:space-between;gap:.6rem;padding:.7rem 1rem;background:#2b2318;" +
    "color:#f0e6d2;font:14px system-ui,sans-serif;box-shadow:0 -2px 10px rgba(0,0,0,.3);";

  const text = document.createElement("span");
  text.textContent = ru ? `Доступна версия ${version}` : `Version ${version} available`;

  const updateBtn = document.createElement("button");
  updateBtn.textContent = ru ? "Обновить" : "Update";
  updateBtn.style.cssText =
    "padding:.4rem .8rem;border:none;border-radius:.4rem;background:#c8a24a;" +
    "color:#241d12;font-weight:600;";
  updateBtn.onclick = () => {
    Share.share({ title: "TasteID", url }).catch(() => {});
    bar.remove();
  };

  const laterBtn = document.createElement("button");
  laterBtn.textContent = ru ? "Позже" : "Later";
  laterBtn.style.cssText =
    "padding:.4rem .8rem;border:1px solid #6b5e4a;border-radius:.4rem;" +
    "background:transparent;color:#f0e6d2;";
  laterBtn.onclick = () => {
    localStorage.setItem(UPDATE_DISMISSED_KEY, `v${version}`);
    bar.remove();
  };

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:.5rem;flex-shrink:0;";
  actions.append(updateBtn, laterBtn);
  bar.append(text, actions);
  document.body.appendChild(bar);
}

async function checkForUpdate() {
  try {
    const res = await window.fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return;
    const release = await res.json();
    const tag = release.tag_name || "";
    if (!tag || !isNewerVersion(tag, APP_VERSION)) return;
    if (localStorage.getItem(UPDATE_DISMISSED_KEY) === tag) return;
    const asset = (release.assets || []).find((a) => /\.apk$/i.test(a.name));
    showUpdateBanner(tag.replace(/^v/i, ""), asset?.browser_download_url || release.html_url);
  } catch {
    // Нет сети — молчим, это не ошибка приложения.
  }
}

// ── Запуск ─────────────────────────────────────

if (NATIVE) {
  seedLangCookie();
  installFetch();
  vault.ensure().catch(() => {});
  checkForUpdate().catch(() => {});
  const ready = () => {
    installImages();
    installDownloads();
    watchPageColors();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready, { once: true });
  } else {
    ready();
  }
}
