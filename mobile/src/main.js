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

const NATIVE = typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.();

// Файлы данных, которые страница читает напрямую, как читала на сайте.
const VAULT_FILES = /^\/(reviews|favorites|characters-tier|site-settings|tier-[^/]+)\.json$/i;

// Папки хранилища: covers, chars и папки коллекций тир-листа.
const VAULT_DIRS = /^\/(covers|covers-backup|chars|[^/]+)\/.+\.(png|jpe?g|webp|gif)$/i;

const vault = new MobileVault();

// ── Настройки самого приложения ────────────────
// На компьютере это /api/app/* в electron/main.js. Здесь тот же набор,
// но короче: папку выбирать не дают (на телефоне она одна), масштаб
// задаёт сама система.
const LANG_KEY = "tasteid_lang";

function appRoutes(pathname, body) {
  if (pathname === "/api/app/info") {
    return {
      vaultPath: vault.root,
      lang: currentLang(),
      platform: window.Capacitor?.getPlatform?.() || "mobile",
      mobile: true,
    };
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

  const app = appRoutes(pathname, body);
  if (app) return jsonResponse(app);

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

// ── Запуск ─────────────────────────────────────

if (NATIVE) {
  seedLangCookie();
  installFetch();
  vault.ensure().catch(() => {});
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
