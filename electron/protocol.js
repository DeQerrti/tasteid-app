// ══════════════════════════════════════════════
//  ЛОКАЛЬНАЯ СХЕМА app:// – то же самое, но без сервера
//
//  До этого файла окно грузилось через http://127.0.0.1:<порт> – тот же
//  адрес, что был у сайта, только локальный: настоящий TCP-сокет,
//  настоящий слушающий порт. Он был нужен по одной причине: по file://
//  не работают ни абсолютные пути (/js/theme.js), ни fetch за своими же
//  файлами (core/api.js, VAULT_FILES) – с ними страницу пришлось бы
//  переписывать.
//
//  Кастомная схема, зарегистрированная как privileged standard-scheme
//  (см. registerScheme ниже, вызывается до app.whenReady), даёт то же
//  самое – абсолютные пути и fetch по /... работают один в один, как на
//  http://, – но запросы разбирает сам Electron внутри процесса,
//  напрямую вызывая обработчик, без открытого порта и без сетевого
//  стека. Разницы для страницы почти нет: тот же fetch("/reviews.json"),
//  тот же <img src="/chars/...">. Разница снаружи – приложению негде
//  постучаться самому себе по сети, потому что стучаться уже не во что.
//
//  Кроме одного: Chromium не даёт протокольному обработчику ставить
//  Set-Cookie (Set-Cookie в списке forbidden response header names для
//  Response, который отдаёт fetch-подобный обработчик, – то же
//  ограничение, что у Service Worker'ов). Признак «админ» и язык, которые
//  на сайте ставила кука на каждый ответ, поэтому здесь – не кука, а
//  строка window.__TASTEID, вписанная прямо в HTML перед первым же
//  <script> (см. injectEnv): это тоже синхронно и тоже до разбора
//  остальной страницы, но не требует сетевого механизма, которого у
//  этой схемы просто нет.
//
//  Маршрутизация – прямой перенос electron/server.js (см. его же
//  комментарий о том, зачем HTTP-версия вообще осталась). Общие куски
//  импортируются оттуда, а не дублируются, чтобы регексы VAULT_FILES/
//  VAULT_DIRS не могли разъехаться между двумя файлами.
// ══════════════════════════════════════════════

import { protocol } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES, ApiError } from "../core/api.js";
import { MIME, VAULT_FILES, VAULT_DIRS, resolveInside } from "./server.js";
import { compressImage } from "./image.js";

export const SCHEME = "app";

// Регистрирует схему как «обычную» – с относительными путями и
// fetch/CORS, как у http(s) (см. привилегии ниже; Set-Cookie из ответа
// сюда не входит – см. комментарий в начале файла). Обязательно до
// app.whenReady(): после него Chromium уже не даёт менять список
// привилегированных схем.
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

// Изменяющие запросы – строго по одному, та же причина, что в server.js:
// два параллельных «прочитать → поправить → записать» иначе теряют
// правку того, кто записал первым.
let queue = Promise.resolve();
function inQueue(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

function json(data, { status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// Вставляется сразу после <head>, до любого другого <script> на
// странице – i18n.js читает lang уже во время разбора (см. её же
// комментарий), а config.js читает admin оттуда же, а не из куки.
const HEAD_TAG = /<head[^>]*>/i;

function injectEnv(html, env) {
  const script = `<script>window.__TASTEID=${JSON.stringify(env)};</script>`;
  return HEAD_TAG.test(html) ? html.replace(HEAD_TAG, (m) => m + script) : script + html;
}

async function serveFile(filePath, { store = true, lang } = {}) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const isHtml = path.extname(filePath).toLowerCase() === ".html";
  let body = await fs.readFile(filePath, isHtml ? "utf8" : undefined);
  if (isHtml) body = injectEnv(body, { admin: true, lang });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": store ? "no-cache" : "no-store",
    },
  });
}

// Тот же предел, что и в server.js: картинки приходят base64, и
// безграничное тело значит, что одна кривая отправка съест память.
const MAX_BODY = 64 * 1024 * 1024;

async function readJsonBody(request) {
  const text = await request.text();
  if (!text) return {};
  if (text.length > MAX_BODY) throw new ApiError("Слишком большой запрос", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("Bad JSON");
  }
}

export function createHandler({ appDir, getVault, appRoutes = {}, getLang }) {
  return async function handle(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const lang = (getLang && getLang()) || "ru";

    try {
      // ── API самого приложения ──
      const appHandler = appRoutes[`${request.method} ${pathname}`];
      if (appHandler) {
        const body = request.method === "POST" ? await readJsonBody(request) : {};
        return json((await appHandler({ body, query: url.searchParams })) || { ok: true });
      }

      // ── API данных ──
      if (pathname.startsWith("/api/")) {
        const handler = ROUTES[`${request.method} ${pathname}`];
        if (!handler) return json({ error: "Not Found" }, { status: 404 });

        const vault = getVault();
        if (!vault) return json({ error: "Хранилище не выбрано" }, { status: 503 });

        const body = request.method === "POST" ? await readJsonBody(request) : {};
        const run = () => handler({ vault, body, query: url.searchParams, compressImage });
        const result = request.method === "POST" ? await inQueue(run) : await run();
        return json(result);
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: "Method Not Allowed" }, { status: 405 });
      }

      const vault = getVault();

      // ── Данные и картинки – из хранилища ──
      if (vault && (VAULT_FILES.test(pathname) || VAULT_DIRS.test(pathname))) {
        const target = resolveInside(vault.root, pathname);
        if (target) {
          const res = await serveFile(target, { store: false, lang });
          if (res) return res;
        }
        if (VAULT_FILES.test(pathname)) {
          return json(pathname.includes("site-settings") ? {} : []);
        }
      }

      // ── Экран приветствия ──
      if (pathname === "/welcome" || pathname === "/welcome.html") {
        const res = await serveFile(path.join(UI_DIR, "welcome.html"), { store: false, lang });
        if (res) return res;
      }

      // ── Страницы и скрипты – из состава приложения ──
      const clean = pathname === "/" ? "/index.html" : pathname;
      const direct = resolveInside(appDir, clean);
      if (direct) {
        const res = await serveFile(direct, { lang });
        if (res) return res;
      }
      // Красивые адреса вида /add – так же, как их разворачивал хостинг.
      const asPage = resolveInside(appDir, `${clean}.html`);
      if (asPage) {
        const res = await serveFile(asPage, { lang });
        if (res) return res;
      }

      return new Response("Не найдено", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      return json({ error: e.message }, { status });
    }
  };
}
