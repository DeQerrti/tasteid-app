// ══════════════════════════════════════════════
//  ЛОКАЛЬНЫЙ СЕРВЕР
//
//  Приложение показывает те же страницы, что и сайт, и делает это через
//  http://127.0.0.1:<порт>, а не file://. Разница принципиальная: по
//  file:// не работают ни абсолютные пути (/js/theme.js), ни fetch за
//  своими же файлами — то есть фронтенд пришлось бы переписывать. Через
//  локальный сервер он работает ровно так, как работал на сайте.
//
//  Порт всегда случайный свободный: фиксированный номер рано или поздно
//  окажется занят чем-то ещё, и приложение просто не откроется.
//
//  Слушаем только 127.0.0.1. Это не паранойя: на 0.0.0.0 хранилище было
//  бы открыто любому в той же сети — без пароля, потому что пароля здесь
//  и не предполагается.
// ══════════════════════════════════════════════

import http from "node:http";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES, ApiError } from "./api.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Папки, которые отдаются из хранилища, а не из состава приложения.
// covers и chars — фиксированные, остальное это коллекции тир-листа,
// у которых папка называется как id коллекции.
const VAULT_DIRS = /^\/(covers|chars|[a-z0-9-]{1,60})\//i;

// Файлы данных фронтенд читает напрямую, как читал их на сайте:
// fetch("/reviews.json"). Отдаём из хранилища.
const VAULT_FILES =
  /^\/(reviews|favorites|characters-tier|site-settings|tier-[a-z0-9-]{1,60})\.json$/i;

// Изменяющие запросы выполняются строго по одному.
//
// Каждый из них читает файл, правит и пишет обратно. Два таких запроса
// внахлёст читают одно и то же состояние, и правка того, кто записал
// первым, теряется — молча, потому что оба ответят «сохранено». Это ровно
// та же беда, что была у настроек на сайте, только здесь она внутри
// одного процесса и лечится очередью.
//
// Стоит это ничего: запросы редкие и короткие, а пользователь один.
let queue = Promise.resolve();
function inQueue(task) {
  const result = queue.then(task, task);
  // Ошибка одного запроса не должна рвать очередь для следующих.
  queue = result.then(
    () => {},
    () => {}
  );
  return result;
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    // Данные меняются под руками — кэшировать их нельзя ни секунды.
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Картинки приходят сюда в base64, и здоровый предел нужен, но
    // безграничный поток означает, что одна кривая отправка съест память.
    if (size > 64 * 1024 * 1024) throw new ApiError("Слишком большой запрос", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("Bad JSON");
  }
}

async function serveFile(res, filePath, { store = true } = {}) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  res.writeHead(200, {
    "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": store ? "no-cache" : "no-store",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

// Путь из запроса приводим к файлу внутри корня и проверяем, что он там
// и остался: «..» в адресе иначе увёл бы за пределы папки.
function resolveInside(root, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const full = path.resolve(root, decoded);
  const rel = path.relative(root, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

// Признак «я админ» фронтенд читает из куки tasteid_ui — на сайте её
// ставил вход по паролю. В приложении входить некому и не от кого: папку
// открыл тот, кому она принадлежит. Поэтому куку ставим сами, на каждый
// ответ, и все админские кнопки просто есть.
//
// Иначе получается то, что и получилось при первом запуске: настройки
// требуют войти, а войти негде.
const ADMIN_COOKIE = "tasteid_ui=1; Path=/; SameSite=Lax";

// Экран приветствия и всё, что относится к самому приложению (папка
// хранилища, масштаб), живёт в electron/ui — отдельно от app/, потому
// что к сайту не имеет отношения и обратно туда не поедет.
const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "ui");

export function createServer({ appDir, getVault, appRoutes = {} }) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    res.setHeader("Set-Cookie", ADMIN_COOKIE);

    try {
      // ── API самого приложения ──
      // Идёт первым и не требует хранилища: этими запросами его как раз
      // и выбирают. Требовать папку до того, как её указали, значило бы
      // запереть человека на экране приветствия.
      const appHandler = appRoutes[`${req.method} ${pathname}`];
      if (appHandler) {
        const body = req.method === "POST" ? await readBody(req) : {};
        return sendJson(res, (await appHandler({ body, query: url.searchParams })) || { ok: true });
      }

      // ── API данных ──
      if (pathname.startsWith("/api/")) {
        const handler = ROUTES[`${req.method} ${pathname}`];
        if (!handler) return sendJson(res, { error: "Not Found" }, 404);

        const vault = getVault();
        if (!vault) return sendJson(res, { error: "Хранилище не выбрано" }, 503);

        const body = req.method === "POST" ? await readBody(req) : {};
        const run = () => handler({ vault, body, query: url.searchParams });
        const result = req.method === "POST" ? await inQueue(run) : await run();
        return sendJson(res, result);
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        return sendJson(res, { error: "Method Not Allowed" }, 405);
      }

      const vault = getVault();

      // ── Данные и картинки — из хранилища ──
      if (vault && (VAULT_FILES.test(pathname) || VAULT_DIRS.test(pathname))) {
        const target = resolveInside(vault.root, pathname);
        if (target && (await serveFile(res, target, { store: false }))) return;
        // Файла нет — для данных это первый запуск, а не ошибка.
        if (VAULT_FILES.test(pathname)) {
          return sendJson(res, pathname.includes("site-settings") ? {} : []);
        }
      }

      // ── Экран приветствия ──
      if (pathname === "/welcome" || pathname === "/welcome.html") {
        if (await serveFile(res, path.join(UI_DIR, "welcome.html"), { store: false })) return;
      }

      // ── Страницы и скрипты — из состава приложения ──
      const clean = pathname === "/" ? "/index.html" : pathname;
      const direct = resolveInside(appDir, clean);
      if (direct && (await serveFile(res, direct))) return;
      // Красивые адреса вида /add — так же, как их разворачивал хостинг.
      const asPage = resolveInside(appDir, `${clean}.html`);
      if (asPage && (await serveFile(res, asPage))) return;

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Не найдено");
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      sendJson(res, { error: e.message }, status);
    }
  });
}

// Сперва пробуем один и тот же порт, и только если он занят — любой
// свободный (порт 0). Не только ради предсказуемости: страница живёт
// по адресу http://127.0.0.1:<порт>, и порт — часть происхождения
// (origin) для localStorage и Service Worker. Со случайным портом на
// каждый запуск то и другое незаметно обнулялось бы при каждом
// перезапуске приложения — TMDB-ключ, отложенный чужой паспорт для
// сравнения, ширина карточек в тир-листе. Заметить это неоткуда:
// ошибки нет, просто настройка «почему-то» не сохранилась.
//
// Число ничем не примечательно — просто редко занятое. Если занято
// (второй экземпляр приложения к этому моменту исключён замком на
// один процесс, так что дело в чём-то постороннем) — откатываемся на
// случайный порт, как раньше, лишь бы приложение открылось.
const PREFERRED_PORT = 47821;

export function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      if (err.code !== "EADDRINUSE") return reject(err);
      server.removeAllListeners("error");
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    server.listen(PREFERRED_PORT, "127.0.0.1", () => resolve(server.address().port));
  });
}
