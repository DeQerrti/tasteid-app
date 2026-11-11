// ══════════════════════════════════════════════
//  NOW – вкладка Главная
//  Читает только из reviews.json – без API
//  Зависит от: config.js, api.js, cards.js
// ══════════════════════════════════════════════
const loading = {};

// Раньше здесь стояла проверка cache.now – если "Сейчас" успела
// отрисоваться до того, как подгрузились подписи/цвета, перерисовать
// готовый кэш заново. Кэша больше нет, но гонка та же: эта вкладка
// открыта по умолчанию при старте и могла отрендериться раньше, чем
// сюда пришло событие. Признак "уже отрисована" теперь – что вкладка
// сейчас видна; loadNow() просто перечитает reviews.json (это дёшево)
// и перерисует уже с правильными подписями.
document.addEventListener("site-labels-ready", () => {
  const tab = document.getElementById("tab-now");
  if (tab && !tab.classList.contains("hidden")) loadNow();
});

// Снимок того, что уже нарисовано – см. её же комментарий выше про
// "кэша больше нет": reviews.json перечитывается заново при КАЖДОМ
// заходе на вкладку, и на компьютере это правда дёшево (локальный
// fetch), а на телефоне идёт через нативный мост Capacitor Filesystem
// – заметно медленнее. Без этой проверки каждый заход пересобирал всю
// разметку заново, даже когда данные не изменились ни на йоту: все
// <img> оказывались новыми узлами, и карточки заметно мигали при
// каждом переключении вкладки. Перерисовываем только когда снимок
// (данные + подписи статусов) и правда стал другим.
let nowLastSnapshot = null;

// Текущая выбранная вкладка-переключатель (ключ статуса или "archive") –
// см. её же комментарий у nowModeToggleHtml() ниже. Сбрасывается на
// первую по порядку при каждой загрузке страницы, не запоминается
// между сеансами – так же, как режим самого тир-листа (tlState.mode).
const nowState = { buckets: [], completed: [], mode: null };

// Поиск, фильтр по типу и сортировка над сеткой. Живут до перезагрузки
// страницы, как и выбранная вкладка: при переключении статуса поиск и
// сортировка остаются, а тип сбрасывается на «Все», только если в новом
// статусе такого типа нет вовсе.
const nowFilter = { type: "all", q: "", sort: "date" };

function nowModeItems() {
  if (nowState.mode === "archive") return nowState.completed;
  return nowState.buckets.find((b) => b.key === nowState.mode)?.items || [];
}

// "date" – порядок как в файле (свежее сверху, так сортирует сервер);
// остальное – копия, исходный список не трогаем.
function nowSorted(items) {
  if (nowFilter.sort === "title") {
    return [...items].sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" })
    );
  }
  if (nowFilter.sort === "year") {
    return [...items].sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
  }
  return items;
}

// Чипы типов – только те типы, что есть в открытом статусе, с числом
// записей; самые частые первыми. Один тип на весь статус – фильтровать
// нечего, ряд не показываем.
function renderNowChips() {
  const box = document.getElementById("now-chips");
  if (!box) return;
  const items = nowModeItems();
  const counts = new Map();
  for (const r of items) {
    const key = r.type || "";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (nowFilter.type !== "all" && !counts.has(nowFilter.type)) nowFilter.type = "all";
  if (counts.size < 2) {
    box.innerHTML = "";
    return;
  }
  const chip = (key, label, n) =>
    `<button type="button" class="now-chip${nowFilter.type === key ? " active" : ""}" data-type="${esc(key)}" aria-pressed="${nowFilter.type === key}">${esc(label)} <span class="section-count">${n}</span></button>`;
  box.innerHTML =
    chip("all", i18n("Все"), items.length) +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => chip(key, TYPE_LABELS[key] || key || "–", n))
      .join("");
}

// Прячет не подходящие под поиск и тип карточки в уже нарисованном
// разделе, а не пересобирает разметку: узлы <img> остаются теми же, и
// сетка не мигает на каждую набранную букву (та же причина, что у
// nowModeBodies ниже). Класс, а не атрибут hidden: у .grid-now и
// .year-divider свой display, и он сильнее атрибута.
function nowApplyFilter() {
  const el = nowModeBodies[nowState.mode];
  if (!el) return;
  const q = normTitle(nowFilter.q);
  let visible = 0;
  el.querySelectorAll(".grid-now").forEach((grid) => {
    let inGrid = 0;
    grid.querySelectorAll(".review-card-wrap").forEach((wrap) => {
      const ok =
        (nowFilter.type === "all" || wrap.dataset.type === nowFilter.type) &&
        (!q || (wrap.dataset.title || "").includes(q));
      wrap.classList.toggle("now-hidden", !ok);
      if (ok) inGrid++;
    });
    grid.classList.toggle("now-hidden", !inGrid);
    // Год архива без единой подходящей карточки – вместе с заголовком.
    const divider = grid.previousElementSibling;
    if (divider?.classList.contains("year-divider")) {
      divider.classList.toggle("now-hidden", !inGrid);
      divider.querySelector(".year-count").textContent = inGrid;
    }
    visible += inGrid;
  });
  let empty = el.querySelector(".now-filter-empty");
  const hasCards = !!el.querySelector(".review-card-wrap");
  if (!empty && hasCards) {
    empty = document.createElement("div");
    empty.className = "state-box now-filter-empty";
    empty.textContent = i18n("Ничего не нашлось – измените запрос или сбросьте фильтр.");
    el.appendChild(empty);
  }
  empty?.classList.toggle("now-hidden", visible > 0);
  nowSyncYearJump();
}

function bindNowTools() {
  const chips = document.getElementById("now-chips");
  chips?.addEventListener("click", (e) => {
    const btn = e.target.closest(".now-chip");
    if (!btn) return;
    nowFilter.type = btn.dataset.type;
    renderNowChips();
    nowApplyFilter();
  });
  document.getElementById("now-search")?.addEventListener("input", (e) => {
    nowFilter.q = e.target.value;
    nowApplyFilter();
  });
  // Выбор года прокручивает и тут же возвращается к «Перейти к году…» –
  // иначе повторно выбрать тот же год было бы нельзя.
  document.getElementById("now-year-jump")?.addEventListener("change", (e) => {
    scrollToNowYear(e.target.value);
    e.target.value = "";
  });
  // Сортировка меняет порядок, а не видимость, – уже нарисованные разделы
  // сбрасываем и строим заново (в «Архиве» другая сортировка ещё и
  // убирает разбивку по годам, см. archiveBodyHtml).
  document.getElementById("now-sort")?.addEventListener("change", (e) => {
    nowFilter.sort = e.target.value;
    nowModeBodies = {};
    const container = document.getElementById("now-mode-body");
    if (container) container.replaceChildren();
    renderNowBody();
  });
}

function nowToolsHtml() {
  const opt = (value, label) =>
    `<option value="${value}"${nowFilter.sort === value ? " selected" : ""}>${esc(label)}</option>`;
  return `<div class="now-tools">
    <div class="now-chips" id="now-chips"></div>
    <div class="now-tools-right">
      <input type="search" id="now-search" class="now-search" value="${esc(nowFilter.q)}" placeholder="${esc(i18n("Поиск по названию"))}" aria-label="${esc(i18n("Поиск по названию"))}">
      <select id="now-year-jump" class="now-sort" data-no-dirty aria-label="${esc(i18n("Перейти к году…"))}" hidden></select>
      <select id="now-sort" class="now-sort" aria-label="${esc(i18n("Сортировка"))}">
        ${opt("date", i18n("Сначала недавние"))}
        ${opt("title", i18n("По названию"))}
        ${opt("year", i18n("По году выхода"))}
      </select>
    </div>
  </div>`;
}

async function loadNow() {
  if (loading.now) return;
  loading.now = true;
  const box = document.getElementById("tab-now");
  try {
    await fetchReviews();
    const reviews = cache.reviews || [];
    const buckets = activeStatusBuckets().map(b => ({
      key: b.key,
      label: b.label,
      items: reviews.filter(r => r.status === b.key),
    }));
    const completed = reviews.filter(r =>
      r.status === "completed" || (!r.status && (r.review_full || r.preview || r.grade))
    );
    const snapshot = JSON.stringify({ buckets, completed });
    if (snapshot === nowLastSnapshot) return;
    nowLastSnapshot = snapshot;
    renderNow({ buckets, completed });
  } catch (err) {
    nowLastSnapshot = null; // при следующей успешной загрузке перерисовать точно
    box.innerHTML = `<div class="state-box">
      <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
      ${i18n("Ошибка:")} ${esc(err.message)}
    </div>`;
  } finally {
    loading.now = false;
  }
}

// Порядок статусов вместе с «Архивом» – настраивается в /settings-edit
// перетаскиванием (statusOrderState там же): «Архив» раньше был жёстко
// зашит последним, теперь может стоять где угодно. Скрытые статусы
// (SITE_HIDDEN_STATUSES) сюда не попадают вовсе – ни отдельной секцией,
// как раньше, ни вкладкой переключателя.
function nowOrderedKeys() {
  const known = [...nowState.buckets.map((b) => b.key), "archive"].filter(
    (key) => !window.SITE_HIDDEN_STATUSES?.has(key)
  );
  const saved = window.SITE_STATUS_ORDER || [];
  const ordered = saved.filter((k) => known.includes(k));
  const missing = known.filter((k) => !ordered.includes(k));
  return [...ordered, ...missing];
}

// Если текущая вкладка вдруг пропала (статус скрыли/удалили, пока была
// выбрана) или ещё не выбрана вовсе – берём первую по порядку.
function nowEnsureMode() {
  const keys = nowOrderedKeys();
  if (!keys.includes(nowState.mode)) nowState.mode = keys[0] ?? null;
}

// Переключатель вкладок сверху – тот же вид (.tl-mode-toggle/.tl-mode-btn
// в index.html), что уже есть у режимов тир-листа: расчёт был на то,
// что бесконечно листать вниз через все статусы разом медленнее, чем
// сразу переключиться на нужный, – то же самое время от времени
// делает Статистика для годов и Тир-лист для своих коллекций.
function nowModeToggleHtml() {
  const bucketsByKey = Object.fromEntries(nowState.buckets.map((b) => [b.key, b]));
  const btns = nowOrderedKeys()
    .map((key) => {
      if (key === "archive") {
        return `<button class="tl-mode-btn${nowState.mode === "archive" ? " active" : ""}" data-mode="archive">${esc(siteLabel("statuses", "archive", i18n("Архив")))} <span class="section-count">${nowState.completed.length}</span></button>`;
      }
      const b = bucketsByKey[key];
      if (!b) return "";
      return `<button class="tl-mode-btn${nowState.mode === key ? " active" : ""}" data-mode="${esc(key)}">${esc(b.label)} <span class="section-count">${b.items.length}</span></button>`;
    })
    .join("");
  return `<div class="tl-mode-toggle">${btns}</div>`;
}

// Быстрые повторные клики (перебираешь разделы один за другим) раньше
// каждый запускали renderNowBody() немедленно и синхронно – это заново
// строит innerHTML всех карточек текущего раздела и заводит для них
// свежие <img>. Клик отрабатывает быстрее, чем браузер успевает
// отрисовать предыдущий рендер, – несколько таких перестроений подряд
// копятся в одной и той же синхронной очереди JS и на разделах с
// длинным списком ощущаются как настоящее зависание: список не отвечает
// на клики, пока не разберёт всю накопившуюся очередь (само окно при
// этом не блокируется – оно в другом процессе). requestAnimationFrame
// схлопывает несколько кликов подряд в один рендер – на экране всё
// равно останется только последний выбранный раздел.
let nowRenderRaf = null;
function bindNowModeToggle() {
  document.querySelectorAll("#tab-now .tl-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === nowState.mode) return;
      nowState.mode = btn.dataset.mode;
      if (nowRenderRaf) cancelAnimationFrame(nowRenderRaf);
      nowRenderRaf = requestAnimationFrame(() => {
        nowRenderRaf = null;
        renderNowBody();
      });
    });
  });
}

// ── Разделы по годам ───────────────────────────
// Список с заголовками-годами: «Архив» по дате – по году завершения,
// любой статус при сортировке «По году выхода» – по году выхода. Один и
// тот же вид в обоих случаях, поэтому и «Перейти к году» (см.
// nowSyncYearJump) работает одинаково.
//
// Счётчик в заголовке (.year-count) пересчитывает nowApplyFilter() – он
// показывает, сколько карточек года видно сейчас, с учётом фильтра.
function yearGroupsHtml(items, yearOf) {
  const byYear = new Map();
  for (const r of items) {
    const y = yearOf(r);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }
  // Годы по убыванию; записи без года («–») – в самом конце, а не
  // где придётся: раньше сравнение числа с тире давало NaN, и порядок
  // зависел от того, в каком месте списка встретилась такая запись.
  const years = [...byYear.keys()].sort((x, y) => (y === "–" ? -1 : x === "–" ? 1 : y - x));
  return years
    .map(
      (year) => `<h3 class="year-divider" data-year="${esc(String(year))}">
        <span class="year-label">${esc(year === "–" ? i18n("Без года") : String(year))}</span>
        <span class="year-count"></span>
      </h3>
      <div class="grid-now">
        ${byYear
          .get(year)
          .map((r, i) => manualCard(r, i))
          .join("")}
      </div>`
    )
    .join("");
}

const releaseYearOf = (r) => parseInt(r.year, 10) || "–";

// «Архив» – не элемент activeStatusBuckets() (это просто все
// завершённые, а не отдельный ручной статус), поэтому своя функция, а
// не ещё одна запись в buckets.
function archiveBodyHtml(completed) {
  if (!completed.length) {
    return `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
  }
  // По названию – одним списком: внутри каждого года был бы свой
  // алфавит, и найти что-то по букве стало бы нельзя.
  if (nowFilter.sort === "title") {
    return `<div class="grid-now">${nowSorted(completed)
      .map((r, i) => manualCard(r, i))
      .join("")}</div>`;
  }
  if (nowFilter.sort === "year") return yearGroupsHtml(nowSorted(completed), releaseYearOf);

  const sorted = [...completed].sort((a, b) => {
    const da = new Date(a.date_end || a.date_start || a.date || 0);
    const db = new Date(b.date_end || b.date_start || b.date || 0);
    return db - da;
  });
  return yearGroupsHtml(sorted, (r) => {
    const raw = r.date_end || r.date_start || r.date;
    return raw ? parseLocalDate(raw).getFullYear() : "–";
  });
}

// «Перейти к году» – в ряду инструментов рядом с сортировкой, а не
// отдельной строкой над списком. Годы берутся из самих заголовков
// открытого раздела, причём только видимых: под фильтром «Фильм» в
// списке нет годов, в которых фильмов не было. Нет заголовков (обычный
// статус по дате, сортировка по названию) или год всего один – прыгать
// некуда, и поля нет.
//
// Прокручивает, а не фильтрует: весь список остаётся как был, просто
// быстрее добраться до места.
function nowSyncYearJump() {
  const select = document.getElementById("now-year-jump");
  if (!select) return;
  const el = nowModeBodies[nowState.mode];
  const dividers = el ? [...el.querySelectorAll(".year-divider:not(.now-hidden)")] : [];
  select.hidden = dividers.length < 2;
  select.innerHTML =
    `<option value="">${esc(i18n("Перейти к году…"))}</option>` +
    dividers
      .map((d) => `<option value="${esc(d.dataset.year)}">${esc(d.querySelector(".year-label").textContent)}</option>`)
      .join("");
}

function scrollToNowYear(year) {
  if (!year) return;
  const el = nowModeBodies[nowState.mode]?.querySelector(`.year-divider[data-year="${CSS.escape(year)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function nowModeBodyHtml() {
  if (nowState.mode === "archive") return archiveBodyHtml(nowState.completed);
  const bucketsByKey = Object.fromEntries(nowState.buckets.map((b) => [b.key, b]));
  const b = bucketsByKey[nowState.mode];
  if (!b || !b.items.length) {
    return `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
  }
  if (nowFilter.sort === "year") return yearGroupsHtml(nowSorted(b.items), releaseYearOf);
  return `<div class="grid-now">${nowSorted(b.items).map((r, i) => manualCard(r, i)).join("")}</div>`;
}

// Кэш уже отрисованных разделов – та же причина, что решили для
// тир-листа (loadTierlist()/tlLastSnapshot): переключение между
// статусами («В процессе»/«Отложено»/«Планирую»/«Архив») раньше ВСЕГДА
// заново строило innerHTML и заводило свежие <img>, даже возвращаясь к
// разделу, который уже показывали минуту назад в этом же заходе. Байты
// картинки при этом уже лежали в srcCache (см. её же комментарий у
// vaultSrc в mobile/src/main.js), но самому <img>-узлу всё равно
// приходится заново декодировать картинку для отрисовки – а это не
// байты, это именно узел DOM, и кэш путей его не спасал. Сбрасывается в
// renderNow() – там, где данные и правда могли измениться.
let nowModeBodies = {}; // { [mode]: HTMLElement }

function renderNowBody() {
  const container = document.getElementById("now-mode-body");
  if (!container) return;
  document.querySelectorAll("#tab-now .tl-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === nowState.mode);
  });
  if (!nowModeBodies[nowState.mode]) {
    const el = document.createElement("div");
    el.innerHTML = nowModeBodyHtml();
    container.appendChild(el);
    nowModeBodies[nowState.mode] = el;
  }
  for (const [mode, el] of Object.entries(nowModeBodies)) {
    el.hidden = mode !== nowState.mode;
  }
  renderNowChips();
  nowApplyFilter();
  nowBindCardClicks();
}

// Клик по карточке в «Сейчас»/«Статусы» и в «Архиве» открывает ту же
// модалку отзыва, что уже есть на вкладке «Отзывы» (rvBindCardClicks в
// reviews.js) и в «Любимом» (favBindCardClicks в favorites.js) – раньше
// эти карточки (manualCard, js/cards.js) вообще ничего не открывали,
// только карандаш редактирования. Слушатель вешается один раз на
// #now-mode-body – сам контейнер не пересоздаётся при переключении
// статусов (см. nowModeBodies выше), только его дети скрываются/
// показываются.
function nowBindCardClicks() {
  const body = document.getElementById("now-mode-body");
  if (!body || body.dataset.clickBound) return;
  body.dataset.clickBound = "1";
  const open = (e) => {
    if (e.target.closest(".review-edit-btn")) return;
    const wrap = e.target.closest(".review-card-wrap");
    if (!wrap) return;
    const id = wrap.dataset.reviewId;
    const review = (cache.reviews || []).find(
      (r) => String(r.id ?? encodeURIComponent(r.title)) === id
    );
    if (review) openReviewModal(review);
  };
  body.addEventListener("click", open);
  // Enter и пробел – то, чего браузер ждёт от role="button" (карточка
  // теперь фокусируема, см. manualCard в cards.js). Только когда фокус
  // на самой карточке: Enter на карандаше внутри неё – это переход по
  // его ссылке, а не открытие отзыва.
  body.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.classList?.contains("review-card-wrap")) return;
    e.preventDefault();
    open(e);
  });
}

function renderNow({ buckets, completed }) {
  const box = document.getElementById("tab-now");
  nowState.buckets = buckets;
  nowState.completed = completed;
  nowEnsureMode();
  nowModeBodies = {};

  if (!nowState.mode) {
    box.innerHTML = `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
    return;
  }

  box.innerHTML = `${nowModeToggleHtml()}${nowToolsHtml()}<div id="now-mode-body"></div>`;
  bindNowModeToggle();
  bindNowTools();
  renderNowBody();
}
