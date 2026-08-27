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
// Каждый вид — объект { mount(container, params), unmount() },
// подключаемый через registerRoute(hash, view) из своего <script>
// (например, js/routes/reviews-order.js). mount может быть async и
// получает DOM-узел #view-root (весь дальнейший html вида уходит
// внутрь него) и params — URLSearchParams с тем, что шло после «?» в
// хэше (#/chars-edit?collection=X — сама страница раньше читала это
// из location.search, но общий документ на всё приложение адрес не
// меняет, только хэш; параметры пробрасывает роутер). unmount()
// зовётся ПЕРЕД уходом на другой маршрут или на пустой хэш (то есть
// обратно к рельсе/вкладкам) — вид обязан снять там все свои слушатели
// событий и таймеры, иначе они продолжат работать поверх того, что
// откроется дальше (см. пример в js/routes/reviews-order.js — там же
// общий приём для этого, on()/cleanup()).
//
// По возможности верхнеуровневые имена вида не должны становиться
// постоянными глобальными переменными страницы — вид лучше замыкать в
// свою IIFE и объявлять registerRoute() единственным, что видно
// снаружи (см. js/routes/reviews-order.js). Когда это неоправданно
// дорого (десятки инлайновых onclick="..." в разметке, как у
// js/routes/chars-edit.js — см. её же комментарий там, почему для неё
// сделано исключение), верхнеуровневые объявления допустимы, но тогда
// единственная страховка от совпадения имён с остальным index.html —
// scripts/check-duplicate-functions.js (npm run check), и её нужно
// реально гонять после любых таких правок, а не полагаться на «и так
// сойдёт».

const ROUTES = new Map();
let activeCleanup = null;

function registerRoute(hash, view) {
  ROUTES.set(hash, view);
}

async function renderRoute() {
  const raw = location.hash || "";
  const qIdx = raw.indexOf("?");
  const hash = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1));
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
  const result = await view.mount(viewRoot, params);
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
