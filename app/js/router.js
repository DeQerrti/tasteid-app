// ══════════════════════════════════════════════
//  ROUTER — минимальный хэш-роутер SPA-оболочки
//  (см. план перехода на SPA, фаза 2)
// ══════════════════════════════════════════════
//
// Хэш (#/имя), а не pushState: на телефоне Capacitor отдаёт файлы из
// app/ по буквальному имени, без сервера и без переписывания путей
// (см. её же комментарий в scripts/check-mobile-links.js) — адрес вида
// #/reviews-order при обновлении страницы или прямой ссылке продолжает
// открывать тот же index.html и просто читает хэш заново, тогда как
// pushState-адрес получил бы 404. Работает одинаково в Electron, на
// телефоне и на сайте — без единой правки на стороне сервера.
//
// Каждый вид — объект { mount(container), unmount() }, подключаемый
// через registerRoute(hash, view) из своего <script> (например,
// js/routes/reviews-order.js). mount может быть async и получает DOM-
// узел #view-root — весь дальнейший html вида уходит внутрь него.
// unmount() зовётся ПЕРЕД уходом на другой маршрут или на пустой хэш
// (то есть обратно к рельсе/вкладкам) — вид обязан снять там все свои
// слушатели событий и таймеры, иначе они продолжат работать поверх
// того, что откроется дальше (см. пример в js/routes/reviews-order.js —
// там же общий приём для этого, on()/cleanup()).
//
// Собственные top-level имена вида НЕ должны становиться глобальными
// переменными страницы — вид должен быть замкнут в свою IIFE и
// объявлять registerRoute() единственным, что видно снаружи. Так он
// не может столкнуться с чем-то из общей области видимости index.html
// (rail, вкладки, js/now.js и т.д.) просто по совпадению имени
// (см. её же предупреждение в scripts/check-duplicate-functions.js).

const ROUTES = new Map();
let activeCleanup = null;

function registerRoute(hash, view) {
  ROUTES.set(hash, view);
}

async function renderRoute() {
  const hash = location.hash || "";
  const view = ROUTES.get(hash);

  if (activeCleanup) {
    try {
      activeCleanup();
    } catch (e) {
      console.error(e);
    }
    activeCleanup = null;
  }

  const shell = document.getElementById("shell-root");
  const viewRoot = document.getElementById("view-root");
  if (!shell || !viewRoot) return;

  if (!view) {
    // Пустой или незнакомый хэш — обычный вид приложения (рельса и вкладки).
    viewRoot.classList.add("hidden");
    viewRoot.innerHTML = "";
    shell.classList.remove("hidden");
    return;
  }

  shell.classList.add("hidden");
  viewRoot.classList.remove("hidden");
  viewRoot.innerHTML = "";
  const result = await view.mount(viewRoot);
  activeCleanup = typeof result === "function" ? result : view.unmount || null;
}

// Уйти с текущего маршрута обратно к рельсе — то, что раньше было
// переходом по ссылке "На главную"/логотип внутри отдельной страницы.
function leaveRoute() {
  if (location.hash) location.hash = "";
  else renderRoute();
}

window.addEventListener("hashchange", renderRoute);
document.addEventListener("DOMContentLoaded", renderRoute);
