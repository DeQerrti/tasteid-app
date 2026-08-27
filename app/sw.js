// ══════════════════════════════════════════════
//  SERVICE WORKER
//
//  manifest.json объявляет display: standalone, то есть сайт можно
//  установить как приложение. Без воркера установленное приложение
//  при плохой сети показывало пустой экран.
//
//  ГЛАВНОЕ ПРАВИЛО ЗДЕСЬ: кэш — только запасной аэродром на случай
//  отсутствия сети, а не источник по умолчанию.
//
//  Первая версия работала иначе: оболочка отдавалась из кэша, а
//  обновление подтягивалось фоном к следующему разу. Для сайта, у
//  которого разметка и стили живут в разных файлах, это опасно —
//  достаточно отдать свежий index.html со старым style.css, и страница
//  разъезжается. Ровно это и случилось при первой выкладке, только
//  из-за кэша браузера. Воркер такую рассинхронизацию мог бы сделать
//  постоянной, поэтому теперь всё, из чего собрана страница, берётся
//  из сети, и лишь при её отсутствии — из кэша.
// ══════════════════════════════════════════════

// Версия входит в имена кэшей: смена версии выбрасывает всё старое.
const VERSION = "v5";
const SHELL_CACHE = `tasteid-shell-${VERSION}`;
const DATA_CACHE = `tasteid-data-${VERSION}`;
const IMAGE_CACHE = `tasteid-img-${VERSION}`;

// Страницы админки кэшировать нельзя: доступ к ним решает кука
// tasteid_ui, которую на каждый ответ ставит локальный сервер
// (см. «Админ без входа» в README) — закэшированная копия могла бы
// пережить смену куки и показать чужому то, что видел владелец.
//
// Отдельных адресов у админки почти не осталось: после перехода на SPA
// (фаза 4 — отдельные файлы страниц удалены) редакторы живут хэш-
// маршрутами (#/settings-edit, #/chars-edit, …) внутри index.html, а
// хэш до сервера и до воркера не доходит вовсе — запрос всегда идёт за
// «/». Список ниже держит только то, что до сих пор запрашивается
// отдельным адресом: api и add.html (он остаётся самостоятельным
// документом — грузится в iframe модалки «Добавить из паспорта»).
const NEVER_CACHE = ["/api/", "/add"];

const IMAGE_PREFIXES = ["/chars/", "/covers/", "/title-covers/", "/covers-backup/", "/icons/"];

// Предварительно кладём только главную — чтобы офлайн вообще было что
// показать. Остальное попадёт в кэш само, по мере обращения.
// Списка конкретных файлов здесь намеренно нет: он разъезжался бы с
// адресами в разметке (там теперь ?v=N) и кэшировал бы не то.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // cache: "reload" — обязательно: иначе запрос пойдёт через
      // HTTP-кэш браузера и воркер законсервирует у себя ту самую
      // устаревшую копию, от которой мы уходим.
      .then((cache) => cache.add(new Request("/", { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Картинки — единственное, что берём из кэша сразу: файл под одним
  // именем меняется редко, а весит много. Рассинхронизации разметки
  // и стилей это вызвать не может.
  if (IMAGE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Всё остальное — сеть вперёд, кэш только если сети нет.
  const cacheName = url.pathname.endsWith(".json") ? DATA_CACHE : SHELL_CACHE;
  event.respondWith(networkFirst(request, cacheName));
});

// Кладём в кэш только удавшиеся ответы. Без этой проверки в кэш попал бы
// и 404, и он продолжил бы выдаваться после того, как файл появится.
async function putIfOk(cacheName, request, response) {
  if (!response || !response.ok || response.type === "opaque") return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    return await putIfOk(cacheName, request, await fetch(request));
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Ни сети, ни точного совпадения в кэше. Для перехода по адресу
    // отдаём главную — иначе браузер покажет служебную страницу ошибки.
    if (request.mode === "navigate") {
      const fallback = (await caches.match("/")) || (await caches.match("/index.html"));
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return putIfOk(cacheName, request, await fetch(request));
}
