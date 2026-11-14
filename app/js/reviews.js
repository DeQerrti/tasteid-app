// ══════════════════════════════════════════════
//  REVIEWS – вкладка Отзывы
//  Зависит от: config.js, api.js
// ══════════════════════════════════════════════

// ── Состояние фильтров ─────────────────────────
// Переживает уход со вкладки и перезаход на сайт – раньше фильтры
// сбрасывались каждый раз, хотя вкладка и так помнит, какая она
// последняя открытая (site-settings.json: mainTab). Ключ и значения –
// то же rvState, просто зеркалится в localStorage при каждой правке.
//
// Тип, оценка и ссылки – списки: можно выбрать несколько сразу («Аниме +
// Манга», «Эталон + Резонанс»). Раньше каждый ряд принимал одно значение.
// Теги – тоже список, а tagMode говорит, как их сочетать: «all» – у
// отзыва есть КАЖДЫЙ выбранный тег (чем больше тегов, тем меньше
// отзывов), «any» – хотя бы один (больше тегов – больше отзывов).
const RV_FILTERS_KEY = "tasteid-rv-filters";
const RV_SORTS = ["date", "date-asc", "grade", "title", "year"];
const rvState = {
  types: [],
  grades: [],
  sources: [],
  tags: [],
  tagMode: "all",
  search: "",
  sort: "date",
  years: true,
};
try {
  const saved = JSON.parse(localStorage.getItem(RV_FILTERS_KEY)) || {};
  // Старый вид (до выбора нескольких значений): type/grade/source – одна
  // строка, "all" значило «без фильтра». Переносим, чтобы выбранный
  // раньше фильтр не пропал после обновления.
  const list = (many, one) =>
    Array.isArray(many) ? many.filter((v) => typeof v === "string") : typeof one === "string" && one !== "all" ? [one] : [];
  rvState.types = list(saved.types, saved.type);
  rvState.grades = list(saved.grades, saved.grade);
  rvState.sources = list(saved.sources, saved.source);
  rvState.tags = list(saved.tags);
  if (saved.tagMode === "any") rvState.tagMode = "any";
  if (typeof saved.search === "string") rvState.search = saved.search;
  if (RV_SORTS.includes(saved.sort)) rvState.sort = saved.sort;
  if (typeof saved.years === "boolean") rvState.years = saved.years;
} catch {}
function rvPersistFilters() {
  try {
    localStorage.setItem(RV_FILTERS_KEY, JSON.stringify(rvState));
  } catch {}
}

let rvLastFiltered = [];
// Полный (нефильтрованный) список – обработчикам, которые вешаются один
// раз на документ (закрытие выпадающих списков, «Сбросить»), он нужен без
// доступа к reviews из замыкания renderReviews().
let rvAllReviews = [];

// Вкладка «Отзывы» – всё законченное: записи со статусом «завершено» (даже
// без оценки и текста – в «Статусах» их больше нет, «Архив» оттуда убран,
// и без этого условия такая запись не показывалась бы нигде) и любые, у
// кого уже есть отзыв (текст или оценка). «В процессе»/«планирую» без
// того и другого сюда не попадают. Общая функция для loadReviews() и
// обработчика tags-map-updated ниже: раньше он подставлял в сетку
// cache.reviews целиком, без этого фильтра – стоило поправить теги на
// открытом где-то отзыве (add.js шлёт tags-map-updated на каждое
// изменение), и на вкладке «Отзывы» на миг показывались все карточки
// подряд, включая «в процессе» без отзыва.
function reviewsWithReview(list) {
  return list.filter((r) => r.review_full || r.preview || r.grade || r.status === "completed");
}

document.addEventListener("tags-map-updated", () => {
  if (cache.reviews && document.getElementById("rv-grid")) applyRvFilters(reviewsWithReview(cache.reviews));
});

// Снимок уже нарисованного – та же причина, что у nowLastSnapshot в
// js/now.js: reviews.json перечитывается заново при каждом заходе на
// вкладку, а на телефоне это идёт через нативный мост Capacitor
// Filesystem, заметно медленнее локального fetch на компьютере. Без
// этой проверки каждый заход пересобирал всю сетку карточек и фильтры
// заново, даже когда ничего не изменилось, – карточки заметно мигали.
let reviewsLastSnapshot = null;

async function loadReviews() {
  const data = await fetchReviews();
  const withReview = reviewsWithReview(data);
  const snapshot = JSON.stringify(withReview);
  if (snapshot === reviewsLastSnapshot) return;
  reviewsLastSnapshot = snapshot;
  if (withReview.length) {
    renderReviews(withReview);
  } else {
    document.getElementById("tab-reviews").innerHTML =
      `<div class="state-box">
        ${esc(siteLabel("empty", "reviews", i18n("Отзывов пока нет.")))}
        ${isAdmin() ? `<div style="margin-top:1.5rem"><a href="#/add" class="admin-add-btn">${i18n("Добавить")}</a></div>` : ""}
      </div>`;
  }
}

// ── Порядок фильтров ───────────────────────────
const TYPE_FILTER_ORDER   = ["anime","manga","manhwa","manhua","movie","show","dorama","game","gacha","book","novel"];
const SOURCE_FILTER_ORDER = ["teletype"];

function sortByOrder(arr, order) {
  return [...arr].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

// Лейблы оценок для фильтра
function gradeLabels() {
  const out = {};
  for (const [key, g] of Object.entries(GRADES)) out[key] = g.name;
  return out;
}

// ── Строка поиска и фильтров ───────────────────
// Одна строка вместо четырёх рядов кнопок: поиск, «Тип», «Оценка»,
// «Теги», «Ссылки» (выпадающие списки с числом отзывов у каждого
// значения) и «Сортировка». Выбранное видно чипами под строкой – их же
// можно снять по одному. Вся эта часть (.rv-sticky) прилипает к верху
// при прокрутке, как строка вкладок у «Статусов»/«Любимого»/«Статистики»:
// раньше после пары экранов вниз, чтобы поменять фильтр, приходилось
// листать обратно. Ссылки строятся из SOURCE_LABELS (встроенные плюс свои
// источники из настроек и «Другое»), а не из одного Teletype.
const rvDateOf = (r) => r.date_end || r.date_start || r.date || "";
const rvDateYearOf = (r) => rvDateOf(r).slice(0, 4) || "–";
const rvReleaseYearOf = (r) => parseInt(r.year, 10) || "–";
const rvGradeIndex = (r) => {
  const i = GRADE_ORDER.indexOf(gradeToShelf(r.grade));
  return i === -1 ? 999 : i;
};

function rvSortLabels() {
  return {
    date: i18n("Сначала новые"),
    "date-asc": i18n("Сначала старые"),
    grade: i18n("По оценке"),
    title: i18n("По названию"),
    year: i18n("По году выхода"),
  };
}

// Сколько отзывов у каждого значения, по всему списку (не по уже
// отфильтрованному): число рядом с пунктом отвечает «сколько их вообще».
function rvCounts(reviews, pick) {
  const out = {};
  for (const r of reviews) {
    const v = pick(r);
    for (const x of Array.isArray(v) ? v : [v]) if (x) out[x] = (out[x] || 0) + 1;
  }
  return out;
}

function rvToggle(arr, value) {
  const i = arr.indexOf(value);
  if (i < 0) arr.push(value);
  else arr.splice(i, 1);
}

function rvOptHtml(kind, on, label, count, { dot = "", attrs = "" } = {}) {
  return `<button type="button" class="rv-opt ${kind}${on ? " on" : ""}" aria-pressed="${on}" ${attrs}>
    <span class="rv-box" aria-hidden="true"></span>${dot}<span>${esc(label)}</span>${count == null ? "" : `<span class="rv-opt-count">${count}</span>`}
  </button>`;
}

function renderReviews(reviews) {
  rvAllReviews = reviews;

  const adminBtn = isAdmin() ? `<a href="#/add" class="admin-add-btn">${i18n("Добавить")}</a>` : "";
  const dd = (key, label, popClass = "") =>
    `<div class="rv-dd" data-dd="${key}">
      <button type="button" class="rv-filter-btn rv-dd-btn" aria-haspopup="true" aria-expanded="false">${esc(label)}<span class="rv-dd-n"></span></button>
      <div class="rv-pop ${popClass} hidden"></div>
    </div>`;

  const box = document.getElementById("tab-reviews");
  // Закрепляемая строка – ПРЯМОЙ ребёнок вкладки, как .tl-mode-toggle/.fav-head у
  // остальных: sticky держится, пока на экране родитель, а обёртка только
  // вокруг этой строки кончилась бы вместе с ней.
  // Заголовка «Отзывы» нет – у остальных вкладок его тоже нет, а название и
  // так видно в боковой панели. «Добавить» – в конце строки фильтров.
  box.innerHTML = `
    <div class="rv-sticky">
      <div class="rv-bar">
        <div class="rv-search">
          <input
            type="text"
            id="rv-search"
            class="rv-search-input"
            placeholder="${esc(i18n("Название, тег или слово из отзыва"))}"
            aria-label="${esc(i18n("Поиск"))}"
            autocomplete="off"
            value="${esc(rvState.search)}"
          >
          <kbd aria-hidden="true">/</kbd>
        </div>
        ${dd("types", siteLabel("filters", "type", i18n("Тип")))}
        ${dd("grades", siteLabel("filters", "grade", i18n("Оценка")))}
        ${dd("tags", siteLabel("filters", "tags", i18n("Теги")), "rv-pop-tags")}
        ${dd("sources", siteLabel("filters", "source", i18n("Ссылки")))}
        <span class="rv-bar-gap"></span>
        <div class="rv-dd" data-dd="sort">
          <button type="button" class="rv-filter-btn rv-dd-btn" aria-haspopup="true" aria-expanded="false"><span id="rv-sort-label"></span></button>
          <div class="rv-pop rv-pop-right hidden"></div>
        </div>
        ${adminBtn}
      </div>
      <div class="rv-sub" id="rv-sub"></div>
    </div>
    <section class="group">
      <div class="reviews-grid" id="rv-grid"></div>
    </section>`;

  const searchInput = document.getElementById("rv-search");
  searchInput.addEventListener("input", () => {
    rvState.search = searchInput.value.trim().toLowerCase();
    rvPersistFilters();
    applyRvFilters(reviews);
  });

  box.querySelectorAll(".rv-dd-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dd = btn.parentElement;
      const wasOpen = !dd.querySelector(".rv-pop").classList.contains("hidden");
      closeRvPops();
      if (wasOpen) return;
      fillRvPop(dd.dataset.dd);
      dd.querySelector(".rv-pop").classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      if (dd.dataset.dd === "tags") dd.querySelector(".rv-tags-search")?.focus();
    });
  });
  // Клик внутри списка не должен закрывать его (обработчик на документе
  // ниже закрывает по клику «снаружи»).
  box.querySelectorAll(".rv-pop").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));

  applyRvFilters(reviews);
}

function closeRvPops() {
  document.querySelectorAll("#tab-reviews .rv-pop").forEach((p) => p.classList.add("hidden"));
  document.querySelectorAll("#tab-reviews .rv-dd-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
}
document.addEventListener("click", closeRvPops);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRvPops();
});

// Содержимое выпадающего списка строится при открытии, а не заранее: так
// в нём всегда свежие числа и отметки (данные могли поменяться, пока
// вкладка была закрыта).
function fillRvPop(which) {
  const pop = document.querySelector(`#tab-reviews .rv-dd[data-dd="${which}"] .rv-pop`);
  if (!pop) return;
  const all = rvAllReviews;
  const redraw = () => {
    fillRvPop(which);
    rvPersistFilters();
    applyRvFilters(all);
  };

  if (which === "types") {
    const counts = rvCounts(all, (r) => r.type);
    const keys = sortByOrder(Object.keys(counts), TYPE_FILTER_ORDER);
    pop.innerHTML = keys
      .map((k) => rvOptHtml("", rvState.types.includes(k), TYPE_LABELS[k] || k, counts[k], { attrs: `data-v="${esc(k)}"` }))
      .join("");
    pop.onclick = (e) => {
      const b = e.target.closest(".rv-opt");
      if (!b) return;
      rvToggle(rvState.types, b.dataset.v);
      redraw();
    };
  } else if (which === "grades") {
    const counts = rvCounts(all, (r) => gradeToShelf(r.grade));
    pop.innerHTML = GRADE_ORDER.filter((k) => counts[k])
      .map((k) =>
        rvOptHtml("", rvState.grades.includes(k), GRADES[k].name, counts[k], {
          dot: `<span class="rv-dot" style="--gc:${esc(GRADES[k].color)}"></span>`,
          attrs: `data-v="${esc(k)}"`,
        })
      )
      .join("");
    pop.onclick = (e) => {
      const b = e.target.closest(".rv-opt");
      if (!b) return;
      rvToggle(rvState.grades, b.dataset.v);
      redraw();
    };
  } else if (which === "sources") {
    const counts = rvCounts(all, (r) => [r.source, r.source2]);
    const keys = sortByOrder(Object.keys(counts), SOURCE_FILTER_ORDER);
    pop.innerHTML = keys.length
      ? keys
          .map((k) => rvOptHtml("", rvState.sources.includes(k), SOURCE_LABELS[k] || k, counts[k], { attrs: `data-v="${esc(k)}"` }))
          .join("")
      : `<div class="rv-pop-note">${esc(i18n("Ссылок пока нет."))}</div>`;
    pop.onclick = (e) => {
      const b = e.target.closest(".rv-opt");
      if (!b) return;
      rvToggle(rvState.sources, b.dataset.v);
      redraw();
    };
  } else if (which === "sort") {
    const labels = rvSortLabels();
    const jump = rvYearJumpHtml();
    pop.innerHTML =
      RV_SORTS.map((k) => rvOptHtml("radio", rvState.sort === k, labels[k], null, { attrs: `data-s="${k}"` })).join("") +
      `<div class="rv-pop-sep"></div>` +
      rvOptHtml("", rvState.years, i18n("Группировать по годам"), null, { attrs: `data-years="1"` }) +
      jump;
    pop.onclick = (e) => {
      const y = e.target.closest("[data-jump]");
      if (y) {
        closeRvPops();
        document
          .querySelector(`#rv-grid .year-divider[data-year="${CSS.escape(y.dataset.jump)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      const b = e.target.closest(".rv-opt");
      if (!b) return;
      if (b.dataset.s) rvState.sort = b.dataset.s;
      else rvState.years = !rvState.years;
      redraw();
    };
  } else if (which === "tags") {
    rvFillTagsPop(pop);
  }
}

// «Перейти к году» – внутри сортировки, а не отдельным полем: строка
// и так плотная. Только когда список сейчас разбит по годам и их больше
// одного (после фильтра – по тем годам, что остались на экране).
function rvYearJumpHtml() {
  const years = [...document.querySelectorAll("#rv-grid .year-divider")].map((d) => d.dataset.year);
  if (years.length < 2) return "";
  return `<div class="rv-pop-sep"></div>
    <div class="rv-pop-title">${esc(i18n("Перейти к году…"))}</div>
    <div class="rv-jump">${years
      .map((y) => `<button type="button" class="rv-filter-btn" data-jump="${esc(y)}">${esc(y === "–" ? i18n("Без года") : y)}</button>`)
      .join("")}</div>`;
}

// Теги – по категориям из TAGS_MAP (js/config.js: тот же справочник и
// те же названия категорий, что и при выборе тегов у самого отзыва,
// add.js), самые частые первыми, с числом отзывов; теги, которых нет ни у
// одного отзыва, не показываются. Раньше – один алфавитный список всех
// тегов подряд.
function rvFillTagsPop(pop) {
  const counts = rvCounts(rvAllReviews, (r) => (r.tags || []).filter((t) => TAGS_MAP[t]));
  const byCat = {};
  for (const t of Object.keys(counts)) (byCat[TAGS_MAP[t].cat || "other"] ||= []).push(t);
  const modeAll = rvState.tagMode === "all";
  pop.innerHTML = `
    <div class="rv-tags-top">
      <input type="text" class="rv-search-input rv-tags-search" placeholder="${esc(i18n("Найти тег…"))}" autocomplete="off">
      <span class="rv-seg">
        <button type="button" data-m="all" class="${modeAll ? "on" : ""}">${esc(i18n("Все выбранные"))}</button>
        <button type="button" data-m="any" class="${modeAll ? "" : "on"}">${esc(i18n("Любой из них"))}</button>
      </span>
    </div>
    <div class="rv-pop-note">${modeAll
      ? i18n("Отзывы, где есть <b>каждый</b> выбранный тег. Чем больше тегов, тем <b>меньше</b> отзывов.")
      : i18n("Отзывы, где есть <b>хотя бы один</b> выбранный тег. Чем больше тегов, тем <b>больше</b> отзывов.")}</div>
    <div class="rv-cats"></div>`;
  const cats = pop.querySelector(".rv-cats");
  const paint = () => {
    const needle = pop.querySelector(".rv-tags-search").value.trim().toLowerCase();
    const order = [...Object.keys(CAT_LABELS), ...Object.keys(byCat).filter((k) => !(k in CAT_LABELS))];
    cats.innerHTML =
      order
        .filter((k) => byCat[k])
        .map((k) => {
          const names = byCat[k]
            .filter((t) => !needle || t.toLowerCase().includes(needle))
            .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, "ru"));
          if (!names.length) return "";
          return `<div class="rv-pop-title">${esc(CAT_LABELS[k] || k)}</div>
            <div class="rv-cloud">${names
              .map(
                (t) =>
                  `<button type="button" class="tag-toggle${rvState.tags.includes(t) ? " active" : ""}" data-tag="${esc(t)}" title="${esc(TAGS_MAP[t].tip || "")}">${esc(t)}<i class="rv-tag-n">${counts[t]}</i></button>`
              )
              .join("")}</div>`;
        })
        .join("") || `<div class="rv-pop-note">${esc(i18n("Ничего не найдено"))}</div>`;
  };
  paint();
  pop.querySelector(".rv-tags-search").addEventListener("input", paint);
  pop.onclick = (e) => {
    const m = e.target.closest("[data-m]");
    if (m) {
      rvState.tagMode = m.dataset.m;
      rvPersistFilters();
      const typed = pop.querySelector(".rv-tags-search").value;
      rvFillTagsPop(pop);
      const input = pop.querySelector(".rv-tags-search");
      input.value = typed;
      input.dispatchEvent(new Event("input"));
      applyRvFilters(rvAllReviews);
      return;
    }
    const t = e.target.closest(".tag-toggle");
    if (!t) return;
    rvToggle(rvState.tags, t.dataset.tag);
    t.classList.toggle("active");
    rvPersistFilters();
    applyRvFilters(rvAllReviews);
  };
}

// Возвращает всё к «без фильтра» одной кнопкой – проще, чем снимать
// каждый фильтр по отдельности, когда их накопилось несколько. Поиск и
// сортировку не трогает: это не фильтры, а способ смотреть.
function resetRvFilters() {
  rvState.types = [];
  rvState.grades = [];
  rvState.sources = [];
  rvState.tags = [];
  rvState.search = "";
  rvPersistFilters();
  const input = document.getElementById("rv-search");
  if (input) input.value = "";
  applyRvFilters(rvAllReviews);
}

function rvFiltersActive() {
  return rvState.types.length + rvState.grades.length + rvState.sources.length + rvState.tags.length > 0 || !!rvState.search;
}

function rvMatches(r) {
  if (rvState.types.length && !rvState.types.includes(r.type)) return false;
  if (rvState.grades.length && !rvState.grades.includes(gradeToShelf(r.grade))) return false;
  if (rvState.sources.length && !rvState.sources.some((k) => r.source === k || r.source2 === k)) return false;
  if (rvState.tags.length) {
    const have = r.tags || [];
    const ok =
      rvState.tagMode === "all" ? rvState.tags.every((t) => have.includes(t)) : rvState.tags.some((t) => have.includes(t));
    if (!ok) return false;
  }
  if (rvState.search) {
    const hay = [r.title, r.review_full, r.preview, ...(r.tags || [])].filter(Boolean).join("\n").toLowerCase();
    if (!hay.includes(rvState.search)) return false;
  }
  return true;
}

// Порядок записей без даты/года/оценки – в конец при любой сортировке
// (в «–» они же и группируются), а не где придётся.
function rvSorted(list) {
  const byDateDesc = (a, b) => rvDateOf(b).localeCompare(rvDateOf(a));
  const num = (v) => (typeof v === "number" ? v : null);
  switch (rvState.sort) {
    case "date-asc":
      return [...list].sort((a, b) => {
        const da = rvDateOf(a), db = rvDateOf(b);
        return !da ? (db ? 1 : 0) : !db ? -1 : da.localeCompare(db);
      });
    case "grade":
      return [...list].sort((a, b) => rvGradeIndex(a) - rvGradeIndex(b) || byDateDesc(a, b));
    case "title":
      return [...list].sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, { sensitivity: "base" }));
    case "year":
      return [...list].sort((a, b) => (num(rvReleaseYearOf(b)) ?? -1) - (num(rvReleaseYearOf(a)) ?? -1) || byDateDesc(a, b));
    default:
      return [...list].sort((a, b) => {
        const da = rvDateOf(a), db = rvDateOf(b);
        return !da ? (db ? 1 : 0) : !db ? -1 : db.localeCompare(da);
      });
  }
}

function rvChipsHtml() {
  const chip = (kind, value, label) =>
    `<button type="button" class="now-chip active rv-chip" data-k="${kind}" data-v="${esc(value)}" title="${esc(i18n("Убрать"))}">${esc(label)} <span aria-hidden="true">✕</span></button>`;
  return [
    ...rvState.types.map((v) => chip("types", v, TYPE_LABELS[v] || v)),
    ...rvState.grades.map((v) => chip("grades", v, GRADES[v]?.name || v)),
    ...rvState.tags.map((v) => chip("tags", v, v)),
    ...rvState.sources.map((v) => chip("sources", v, SOURCE_LABELS[v] || v)),
  ].join("");
}

function applyRvFilters(reviews) {
  const list = rvSorted(reviews.filter(rvMatches));
  const total = reviews.length;
  const active = rvFiltersActive();

  // Кнопки в строке: подсвечены и с числом выбранного, когда фильтр включён.
  const mark = (dd, n) => {
    const btn = document.querySelector(`#tab-reviews .rv-dd[data-dd="${dd}"] .rv-dd-btn`);
    if (!btn) return;
    btn.classList.toggle("active", n > 0);
    btn.querySelector(".rv-dd-n").textContent = n ? ` ${n}` : "";
  };
  mark("types", rvState.types.length);
  mark("grades", rvState.grades.length);
  mark("tags", rvState.tags.length);
  mark("sources", rvState.sources.length);
  const sortLabel = document.getElementById("rv-sort-label");
  if (sortLabel) sortLabel.textContent = rvSortLabels()[rvState.sort];

  const sub = document.getElementById("rv-sub");
  if (sub) {
    const countText = active
      ? i18n("Показано {shown} из {total}", { shown: list.length, total })
      : `${total} ${plural(total, [i18n("отзыв"), i18n("отзыва"), i18n("отзывов")])}`;
    sub.innerHTML =
      rvChipsHtml() +
      (rvState.tags.length > 1
        ? `<span class="rv-note">${esc(rvState.tagMode === "all" ? i18n("теги: каждый из выбранных") : i18n("теги: хотя бы один"))}</span>`
        : "") +
      (active ? `<button type="button" class="rv-reset">${esc(i18n("Сбросить всё"))}</button>` : "") +
      `<span class="rv-result">${esc(countText)}</span>`;
    sub.onclick = (e) => {
      if (e.target.closest(".rv-reset")) return resetRvFilters();
      const c = e.target.closest(".rv-chip");
      if (!c) return;
      rvToggle(rvState[c.dataset.k], c.dataset.v);
      rvPersistFilters();
      applyRvFilters(rvAllReviews);
    };
  }

  const grid = document.getElementById("rv-grid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML = `<div class="state-box" style="padding:3rem 1rem;grid-column:1/-1">
      ${esc(siteLabel("empty", "search", i18n("Ничего не найдено")))}
      ${active ? `<div style="margin-top:.8rem"><button type="button" class="rv-reset" onclick="resetRvFilters()">${esc(i18n("Сбросить фильтры"))}</button></div>` : ""}
    </div>`;
    rvLastFiltered = [];
    return;
  }

  // Заголовки годов – как у «Статусов» (.year-divider), но внутри одной
  // сетки: растянуты на все колонки. По дате – год завершения, по «году
  // выхода» – год выхода. По оценке и названию заголовков нет: внутри
  // каждого года был бы свой порядок, и найти что-то стало бы нельзя.
  const grouped = rvState.years && ["date", "date-asc", "year"].includes(rvState.sort);
  const yearOf = rvState.sort === "year" ? rvReleaseYearOf : rvDateYearOf;
  let html = "";
  if (grouped) {
    const counts = {};
    for (const r of list) counts[yearOf(r)] = (counts[yearOf(r)] || 0) + 1;
    let cur = null;
    list.forEach((r, i) => {
      const y = String(yearOf(r));
      if (y !== cur) {
        cur = y;
        html += `<h3 class="year-divider rv-year" data-year="${esc(y)}">
          <span class="year-label">${esc(y === "–" ? i18n("Без года") : y)}</span>
          <span class="year-count">${counts[y]}</span>
        </h3>`;
      }
      html += reviewCard(r, i);
    });
  } else {
    html = list.map((r, i) => reviewCard(r, i)).join("");
  }
  // Анимация появления карточек – только при первой отрисовке. На каждый
  // клик по фильтру она запускалась заново, и вся сетка мигала.
  grid.classList.toggle("rv-noanim", !!grid.dataset.drawn);
  grid.dataset.drawn = "1";
  grid.innerHTML = html;
  rvLastFiltered = list;
  rvBindCardClicks();
}

function rvBindCardClicks() {
  const grid = document.getElementById("rv-grid");
  if (!grid || grid.dataset.clickBound) return;
  grid.dataset.clickBound = "1";

  function openFromEvent(e) {
    if (e.target.closest(".review-edit-btn") || e.target.closest(".review-source-link")) return;
    const wrap = e.target.closest(".review-card-wrap");
    if (!wrap) return;
    const idx = parseInt(wrap.dataset.reviewIdx, 10);
    const review = rvLastFiltered[idx];
    if (review) openReviewModal(review, rvLastFiltered);
  }

  grid.addEventListener("click", openFromEvent);

  // Enter и пробел – то, чего браузер ждёт от role="button".
  // preventDefault на пробеле обязателен, иначе страница проскроллится.
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.classList?.contains("review-card-wrap")) return;
    e.preventDefault();
    openFromEvent(e);
  });
}

// ── Модальное окно с полным текстом отзыва ─────
function reviewModalBodyHtml(r) {
  const grade = GRADES[gradeToShelf(r.grade)] || null;
  const formatYear = [r.format, r.year].filter(Boolean).join(" · ");
  // Полная дата (не короткая, как на бейдже карточки в архиве, –
  // "12 марта", а развёрнутая, "12 марта 2024"). Раньше в развороте
  // отзыва показывался только день завершения – сам период (начал →
  // закончил) был виден только на карточке в архиве, внутри отзыва не
  // было ни того ни другого, если даты различались.
  const fmtLongDate = raw =>
    parseLocalDate(raw).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" });
  // "Ознакомился" не годится сразу по двум причинам: мужской род (см.
  // её же историю в этой сессии – везде убирали) и то, что не подходит
  // ни книге, ни игре, ни фильму разом ("посмотрел"/"прочитал"/"прошёл"
  // пришлось бы выбирать по типу). "Начато"/"Завершено" – страдательный
  // залог, рода не имеет и одинаково годится любому типу. Период (начал
  // → закончил различаются) теперь на двух строках, а не через "→" в
  // одной – так яснее, где какая дата, чем читать одну подпись на обе.
  //
  // Завершённым считается только отзыв со статусом «завершено» (или
  // старый, вовсе без статуса). У того, что ещё «В процессе»,
  // «Отложено» или в любом своём статусе, единственная осмысленная дата –
  // начало: раньше она подписывалась «Завершено», потому что ветка ниже
  // брала первую попавшуюся дату и называла её завершением, не глядя на
  // статус.
  //
  // Даты – одной строкой (.review-dates): «8 ноября → 9 ноября · 2 дня»,
  // «18 января 2024 · завершено», «с 3 марта · в процессе». Раньше –
  // столбиком «Начато: …» / «Завершено: …» из мелких строк; срок
  // приходилось считать в уме.
  const isFinished = !r.status || r.status === "completed";
  let datesHtml = "";
  const note = (text) => `<span class="review-dates-note">· ${esc(text)}</span>`;
  if (!isFinished) {
    if (r.date_start) datesHtml = `<span>${esc(i18n("с {date}", { date: fmtLongDate(r.date_start) }))}</span>${note(i18n("в процессе"))}`;
  } else if (r.date_start && r.date_end && r.date_start !== r.date_end) {
    const days = Math.round((parseLocalDate(r.date_end) - parseLocalDate(r.date_start)) / 86400000) + 1;
    // Оба в одном году – год пишем один раз, в конце («9 ноября → 23 ноября
    // 2024 г.»): иначе строка не влезала рядом с кнопками, и «· 15 дней»
    // уезжало на свою строку с точкой в начале.
    const sameYear = parseLocalDate(r.date_start).getFullYear() === parseLocalDate(r.date_end).getFullYear();
    const fmtNoYear = raw =>
      parseLocalDate(raw).toLocaleDateString(dateLocale(), { day: "numeric", month: "long" });
    datesHtml =
      `<span>${esc(sameYear ? fmtNoYear(r.date_start) : fmtLongDate(r.date_start))}</span><span class="review-dates-arrow">→</span><span>${esc(fmtLongDate(r.date_end))}</span>` +
      (days > 0 ? note(`${days} ${plural(days, [i18n("день"), i18n("дня"), i18n("дней")])}`) : "");
  } else {
    const dateRaw = r.date_end || r.date_start || r.date || null;
    if (dateRaw) {
      const oneDay = r.date_start && r.date_start === r.date_end;
      datesHtml = `<span>${esc(fmtLongDate(dateRaw))}</span>${note(oneDay ? i18n("за один день") : i18n("завершено"))}`;
    }
  }

  const btn1 = sourceBtnHtml(r.url, r.source);
  const btn2 = sourceBtnHtml(r.url2, r.source2);

  // Текст у отзыва один (review_full). r.preview – запасной вариант для
  // записи, которую ещё не успели перенести (см. migratePreview в
  // core/api.js): пришла синхронизацией с необновлённого устройства.
  // Приписка про ссылку – только когда текста нет совсем, а источник
  // указан.
  const fullText = (r.review_full && r.review_full.trim()) || (r.preview && r.preview.trim()) || "";
  // Нет текста и нет ссылок – блока нет вовсе: раньше тут стояла большая
  // строка «Пока без текста» и под неё пустая область (у каждого второго
  // отзыва). Есть только ссылка – одна тихая строка про неё.
  const textHtml = fullText
    ? `<div class="review-modal-fulltext">${esc(fullText).split("\n").map(p => p ? `<p>${p}</p>` : "").join("")}</div>`
    : (btn1 || btn2)
      ? `<div class="review-modal-fulltext review-modal-notext"><p class="review-modal-nofull-hint">${i18n("Развёрнутый текст сюда не перенесён – полный отзыв можно почитать по ссылке ниже.")}</p></div>`
      : "";

  // Карточка режет теги до CARD_TAGS_MAX (reviews.js: reviewCard) – тут,
  // в развороте отзыва, места на всех хватает, показываем полный набор.
  const tagsHtml = (r.tags || []).length
    ? `<div class="card-tags review-modal-tags">${r.tags.map(tag => tagHtml(tag)).join("")}</div>`
    : "";

  // Клик по обложке открывает галерею всех резервных копий, когда-либо
  // сделанных для этого отзыва (см. её же смысл в add-cover.js:
  // coverGallery) – не только текущую. Если ни одной резервной копии
  // ещё нет (например, обложка только по внешней ссылке, без бэкапа) –
  // открывать нечего, курсор/подсказку не показываем вовсе. Одна-
  // единственная картинка – тоже: галерея из той же самой обложки,
  // что уже видна, ничего не показывает и только второй раз затемняет
  // экран. Удалить её можно в редакторе.
  const galleryImgs = reviewCoverGalleryImages(r);
  const coverClickable = galleryImgs.length > 1
    ? ` class="review-modal-cover has-gallery" onclick="openReviewCoverGallery()" title="${i18n("Все обложки ({v0})", { v0: galleryImgs.length })}"`
    : ` class="review-modal-cover"`;

  const editId = r.id ?? encodeURIComponent(r.title);
  const editBtn = isAdmin()
    ? `<a href="#/add?edit=${editId}" class="icon-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  // Тип показываем тоже («Книга · 2013»): в окне его раньше не было вовсе,
  // он был только плашкой на обложке карточки в сетке.
  const typeLabel = TYPE_LABELS[r.type] || "";
  const metaParts = [typeLabel, formatYear].filter(Boolean).map(esc);
  // Пересмотры – тем же текстом в этой строке, а не рамкой отдельной
  // строкой: плашка-«таблетка» на карточках отклонена, и «↻ ×2» без подписи
  // не сразу понятно. Подсказка с полным словом – по наведению.
  if (r.rewatch_count > 0) {
    const tip = i18n("Пересмотров: {v0}", { v0: r.rewatch_count });
    metaParts.push(`<span class="review-rewatch-inline" title="${esc(tip)}">↻ ${esc(i18n("пересмотрено ×{n}", { n: r.rewatch_count }))}</span>`);
  }
  const metaLine = metaParts.join(" · ");

  // Шапка – сетка: обложка слева на две строки, справа название с оценкой
  // и датами, а ТЕГИ под ними, на уровне обложки, – раньше они шли
  // отдельным рядом под всей шапкой, а справа от обложки оставалась
  // пустая колонка. На телефоне теги уходят под обложку (см. CSS,
  // #review-modal-body .review-modal-header). Оценка – сразу под названием
  // и светлым текстом с цветным ромбом, как на карточках в сетке: это
  // главный вывод отзыва, а цветной текст в 1rem на тёмном фоне был
  // самым слабым по контрасту элементом окна.
  return `
    <div class="review-modal-actions">
      ${reviewModalNavHtml()}
      ${cameraButton("reviewExport()", "review-export-btn")}
      ${editBtn}
      <button type="button" class="icon-btn" title="${i18n("Закрыть")}" onclick="closeReviewModal()">✕</button>
    </div>
    <div id="review-modal-capture">
      <div class="review-modal-header">
        <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="${esc(r.title)}"${coverClickable} style="object-position:${esc(r.cover_focus || "50% 50%")}" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
        <div class="review-modal-main">
          <div class="review-modal-title" id="review-modal-title">${esc(r.title)}</div>
          ${metaLine ? `<div class="review-meta-row"><span class="review-format">${metaLine}</span></div>` : ""}
          ${grade ? `<div class="grade-chip" style="--gc:${grade.color}" data-tip="${esc(grade.desc)}">${esc(gradeValueLabel(r.grade))}</div>` : ""}
          ${datesHtml ? `<div class="review-dates">${datesHtml}</div>` : ""}
        </div>
        ${tagsHtml}
      </div>
      ${textHtml}
      <div class="source-buttons">${btn1}${btn2}</div>
    </div>
  `;
}

// Снимок открытого отзыва картинкой – тот же приём, что у тир-листа/
// статистики/любимого (см. её же комментарии в tierlist.js/stats.js):
// html2canvas умеет клонировать только то, что уже нарисовано на
// экране, поэтому картинки/анимации/неоморфные тени готовятся тем же
// набором общих помощников из utils.js/config.js. Кнопка сама вынесена
// ИЗ #review-modal-capture (см. reviewModalBodyHtml выше) – иначе она
// попала бы на собственный же снимок.
async function reviewExport() {
  const btn = document.getElementById("review-export-btn");
  const el = document.getElementById("review-modal-capture");
  if (!el) return;
  let restoreBtn = () => {};
  if (btn) {
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="spinner-sm"></span>`;
    btn.disabled = true;
    restoreBtn = () => {
      btn.innerHTML = original;
      btn.disabled = false;
    };
  }

  let restoreImages = () => {};
  let restoreAnim = () => {};
  let restoreShadows = () => {};
  try {
    if (typeof html2canvas === "undefined") await loadHtml2Canvas();

    const imgs = Array.from(el.querySelectorAll("img"));
    await forceLoadImagesForExport(imgs);

    restoreImages = await proxyImagesToDataUrls(el);
    restoreAnim = disableAnimations(el);
    restoreShadows = bakeNeoShadows(el);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

    const canvas = await withTimeout(
      html2canvas(el, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
        scale: safeCaptureScale(el, 2),
        useCORS: true,
        allowTaint: false,
        logging: false,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.setAttribute("data-skin", document.documentElement.getAttribute("data-skin") || "");
        },
      }),
      captureTimeoutMs(imgs.length),
      i18n("Не удалось создать картинку за разумное время.")
    );

    const link = document.createElement("a");
    const safeName = (_reviewModalTitle || "review").replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, "").trim() || "review";
    link.download = `${safeName}.png`;
    link.href = canvas.toDataURL("image/png");
    // Вставить в документ обязательно – см. тот же приём и тот же
    // комментарий у tlExport() в tierlist.js про перехват на Android.
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    alert("Не удалось создать картинку 😢\n" + err.message);
  } finally {
    restoreImages();
    restoreAnim();
    restoreShadows();
    restoreBtn();
  }
}

// Элемент, с которого модалку открыли: на него надо вернуть фокус при
// закрытии, иначе после Esc фокус улетает в начало страницы и человеку
// с клавиатуры приходится заново идти до той же карточки.
let _reviewModalOpener = null;

// Название открытого отзыва – только для имени файла у reviewExport()
// (снимок отзыва картинкой, js/utils.js делает то же самое для тир-листа/
// статистики/любимого). Сам отзыв r модалке заново спрашивать незачем –
// на момент экспорта разметка уже на экране, нужно только имя файла.
let _reviewModalTitle = null;
// Сам объект открытого отзыва – в отличие от _reviewModalTitle нужен не
// только для подписи: галерея обложек (openReviewCoverGallery ниже)
// меняет cover/cover_backup/cover_gallery прямо на этом же объекте
// (том самом, что лежит в cache.reviews) и пересохраняет его целиком.
let _reviewModalReview = null;

// Список, по которому окно листается (← → , кнопки, свайп): тот же массив,
// что сейчас на экране во вкладке «Отзывы» (с её фильтрами и сортировкой).
// Открыли из «Статусов», «Любимого», статистики или тир-листа – списка нет
// (null), и листать нечего: там «соседний» отзыв ничего не значит.
let _reviewModalList = null;

function reviewModalIndex() {
  if (!_reviewModalList || !_reviewModalReview) return -1;
  return _reviewModalList.indexOf(_reviewModalReview);
}

// Кнопки ‹ счётчик › в верхнем ряду окна. Это часть разметки отзыва
// (reviewModalBodyHtml), а не дописывается после: окно перерисовывается
// целиком при смене обложки в галерее (persistReviewCoverChange), и
// дописанные снаружи кнопки при этом пропадали бы.
function reviewModalNavHtml() {
  const i = reviewModalIndex();
  const n = _reviewModalList?.length || 0;
  if (i < 0 || n < 2) return "";
  return `<span class="review-modal-nav">
    <button type="button" class="icon-btn review-nav-step" ${i === 0 ? "disabled" : ""} title="${i18n("Предыдущий отзыв")} (←)" aria-label="${i18n("Предыдущий отзыв")}" onclick="reviewModalStep(-1)">‹</button>
    <span class="review-nav-count">${i + 1} / ${n}</span>
    <button type="button" class="icon-btn review-nav-step" ${i === n - 1 ? "disabled" : ""} title="${i18n("Следующий отзыв")} (→)" aria-label="${i18n("Следующий отзыв")}" onclick="reviewModalStep(1)">›</button>
  </span>`;
}

// Большие стрелки по бокам окна (широкий экран): сами кнопки лежат в
// index.html внутри оверлея, здесь только показ/недоступность.
function reviewModalSyncSideArrows() {
  const i = reviewModalIndex();
  const n = _reviewModalList?.length || 0;
  const show = i >= 0 && n > 1;
  const prev = document.getElementById("review-side-prev");
  const next = document.getElementById("review-side-next");
  if (!prev || !next) return;
  prev.hidden = next.hidden = !show;
  prev.disabled = i <= 0;
  next.disabled = i >= n - 1;
  prev.setAttribute("aria-label", i18n("Предыдущий отзыв"));
  next.setAttribute("aria-label", i18n("Следующий отзыв"));
}

// dir: -1 – предыдущий, 1 – следующий. Окно остаётся открытым и просто
// показывает соседний отзыв; прокрутка текста – в начало.
function reviewModalStep(dir) {
  const i = reviewModalIndex();
  const next = _reviewModalList?.[i + dir];
  if (i < 0 || !next) return;
  const panel = document.querySelector("#review-modal-overlay .review-modal-panel");
  const list = _reviewModalList;
  openReviewModal(next, list);
  if (panel) {
    panel.scrollTop = 0;
    panel.classList.remove("slide-prev", "slide-next");
    void panel.offsetWidth;
    panel.classList.add(dir < 0 ? "slide-prev" : "slide-next");
  }
}

function openReviewModal(r, list) {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay) return;
  // Повторное открытие при листании: фокус вернуть надо на карточку, с
  // которой окно открыли впервые, а не на уже скрытый элемент.
  if (overlay.classList.contains("hidden")) _reviewModalOpener = document.activeElement;
  _reviewModalTitle = r.title;
  _reviewModalReview = r;
  _reviewModalList = Array.isArray(list) && list.includes(r) ? list : null;
  document.getElementById("review-modal-body").innerHTML = reviewModalBodyHtml(r);
  appendReviewLinkedFavorites(r);
  reviewModalSyncSideArrows();
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Фокус внутрь окна – иначе скринридер продолжит читать страницу
  // под ним, а Tab уведёт за пределы диалога с первого же нажатия.
  // На саму панель, не на кнопку закрытия – той больше нет (Esc и
  // клик в стороне уже закрывают модалку, отдельный крестик был
  // лишним элементом).
  overlay.querySelector(".review-modal-panel")?.focus();
}

// Обратная связь «тайтл → любимое»: персонажи, персоны и записи своих
// разделов, у которых этот отзыв отмечен в «Тайтлах» (linked_review_ids,
// правится в #/favorites-edit). Раньше связь была видна только с одной
// стороны – из модалки персонажа; из отзыва нельзя было узнать, что
// персонаж оттуда у тебя в любимом. favorites.json читается при каждом
// открытии (он небольшой), а блок дописывается в окно уже после показа –
// чтобы модалка не ждала чтения файла. Сами карточки – favPersonCard() и
// группировка по разделам – те же, что у связей в модалке персонажа.
async function appendReviewLinkedFavorites(r) {
  if (r?.id === undefined || r?.id === null || typeof favPersonCard !== "function") return;
  let favData = [];
  try {
    const res = await fetch("/favorites.json?_=" + Date.now());
    favData = res.ok ? await res.json() : [];
  } catch {
    return;
  }
  const linked = (Array.isArray(favData) ? favData : []).filter((e) => (e.linked_review_ids || []).includes(r.id));
  // Модалку могли закрыть или открыть другой отзыв, пока читался файл.
  if (!linked.length || _reviewModalReview !== r) return;
  const capture = document.getElementById("review-modal-capture");
  if (!capture || capture.querySelector(".review-linked-favs")) return;

  const groups = [];
  for (const e of linked) {
    let g = groups.find((x) => x.type === e.type);
    if (!g) groups.push((g = { type: e.type, items: [] }));
    g.items.push(e);
  }
  const overrides = window.SITE_LABEL_OVERRIDES?.favTypes || {};
  const labelFor = (type) => {
    if (type === "character") return overrides.character || i18n("Персонажи");
    if (type === "person") return overrides.person || i18n("Персоны");
    return ((window.SITE_FAV_COLLECTIONS || []).find((c) => c.id === type) || {}).label || type;
  };
  reviewLinkedFavData = favData;
  const box = document.createElement("div");
  box.className = "review-linked-favs";
  box.innerHTML = groups
    .map(
      (g) => `
      <div class="fav-modal-titles-title">${esc(labelFor(g.type))} · ${i18n("в любимом")}</div>
      <div class="grid-chars fav-modal-titles-grid">${g.items.map((e, i) => favPersonCard(e, i)).join("")}</div>`
    )
    .join("");
  // В шапку, в правую колонку под тегами (на уровне обложки), а не отдельным
  // блоком под текстом: большие карточки занимали столько же места, сколько
  // сама обложка, а справа от неё при этом оставалась пустая область. Место
  // под блок в сетке шапки есть всегда (пустая строка сетки не занимает
  // высоты), так что окно не прыгает, когда блок дорисовывается после показа.
  box.classList.add("review-modal-favs");
  capture.querySelector(".review-modal-header")?.appendChild(box);
}
// Записи favorites.json, прочитанные последним appendReviewLinkedFavorites –
// по ним клик по карточке открывает модалку персонажа.
let reviewLinkedFavData = [];

function closeReviewModal() {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  _reviewModalOpener?.focus?.();
  _reviewModalOpener = null;
  _reviewModalTitle = null;
  _reviewModalReview = null;
  _reviewModalList = null;
  reviewModalSyncSideArrows();
}

// ── Галерея обложек (модалка отзыва) ────────────
// images: все резервные копии, что когда-либо были сделаны для этого
// отзыва – cover_gallery, если он есть, иначе только текущая (старые
// отзывы, сохранённые до этой возможности, ей ещё не обзавелись).
function reviewCoverGalleryImages(r) {
  if (r.cover_gallery?.length) return r.cover_gallery;
  return r.cover_backup ? [r.cover_backup] : [];
}

function openReviewCoverGallery() {
  const r = _reviewModalReview;
  if (!r) return;
  const images = reviewCoverGalleryImages(r);
  if (!images.length) return;
  openGalleryModal({
    images,
    active: r.cover_backup || r.cover || null,
    onSelect: (url) => selectGalleryImage(r, url, REVIEW_GALLERY_FIELDS, persistReviewCoverChange),
    onDelete: (url) => removeGalleryImage(r, url, images, REVIEW_GALLERY_FIELDS, persistReviewCoverChange),
  });
}

const REVIEW_GALLERY_FIELDS = { gallery: "cover_gallery", active: "cover_backup", external: "cover" };

// Пересохраняет весь отзыв целиком (тот же приём, что и полный редактор –
// add-save.js: saveReview) сразу же, без захода в редактор – смена
// картинки в галерее не должна требовать открыть форму ради одной этой
// правки. r – сам объект из cache.reviews, уже с обновлёнными полями.
// Бросает исключение, если сервер не записал (postRecordOrThrow в utils.js).
async function persistReviewCoverChange(r) {
  await postRecordOrThrow("/api/save-review", { ...r, _editId: r.id });
  cache.reviews = null;
  document.getElementById("review-modal-body").innerHTML = reviewModalBodyHtml(r);
  appendReviewLinkedFavorites(r);
  refreshOpenReviewsTab();
}

// Удержание фокуса внутри окна, пока оно открыто: Tab с последнего
// элемента возвращает на первый, Shift+Tab с первого – на последний.
function trapReviewModalFocus(e) {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;

  const focusable = overlay.querySelectorAll(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;

  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeReviewModal();
      return;
    }
    // Карточка из блока «… в любимом» (appendReviewLinkedFavorites) –
    // открывает модалку персонажа вместо этой: оба оверлея с одним
    // z-index, поверх были бы видны в порядке разметки, а не открытия.
    const charCard = e.target.closest(".review-linked-favs .card-char[data-fav-id]");
    if (charCard && typeof openFavPersonModal === "function") {
      const entry = reviewLinkedFavData.find((x) => String(x.id) === charCard.dataset.favId);
      if (entry) {
        closeReviewModal();
        openFavPersonModal(entry);
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReviewModal();
    if (e.key === "Tab") trapReviewModalFocus(e);
    // Стрелки – по физической клавише (code), а не по символу, как и
    // остальные горячие клавиши (index.html): работают на любой раскладке.
    // Не трогаем, когда печатают (поле в окне) или открыто что-то поверх
    // (галерея обложек, модалка персонажа).
    if ((e.code === "ArrowLeft" || e.code === "ArrowRight") && !overlay.classList.contains("hidden")) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
      if (document.querySelector(".modal-overlay:not(.hidden), #fav-modal-overlay:not(.hidden)")) return;
      e.preventDefault();
      reviewModalStep(e.code === "ArrowLeft" ? -1 : 1);
    }
  });

  // Свайп пальцем по окну: влево – следующий, вправо – предыдущий. Только
  // заметно горизонтальный жест (иначе это прокрутка текста) и не поверх
  // картинки-галереи/ссылок с прокруткой.
  let sx = 0, sy = 0, tracking = false;
  overlay.addEventListener("touchstart", (e) => {
    tracking = e.touches.length === 1 && !e.target.closest("a, button, input, textarea, select");
    if (tracking) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
  }, { passive: true });
  overlay.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    reviewModalStep(dx < 0 ? 1 : -1);
  }, { passive: true });
});
function sourceBtnHtml(url, source) {
  if (!url) return "";
  // «Другое» ничего не говорит о том, куда ведёт ссылка – подписываем её
  // адресом сайта (youtu.be, t.me). Названия своих источников из настроек и
  // Teletype остаются как есть.
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  const label = (source === "other" && host) || SOURCE_LABELS[source] || source || host || i18n("Подробнее");
  if (source === "teletype") {
    return `<a href="${esc(url)}" target="_blank" rel="noopener" class="review-source-link source-teletype">
      <span class="source-dot-teletype"></span>${esc(label)} →
    </a>`;
  }
  return `<a href="${esc(url)}" target="_blank" rel="noopener" class="review-source-link source-other">
    <span class="source-dot-other"></span>${esc(label)} →
  </a>`;
}

function reviewCard(r, i) {
  const grade = GRADES[gradeToShelf(r.grade)] || null;

  // Верхние 4: карточка – это витрина для беглого взгляда, не место
  // для полного списка тегов. Какие именно – выбирает человек в
  // редакторе (add.html, «Какие теги показывать на карточке»),
  // featured_tags_on_card – явно отмеченные там «избранные» теги
  // этого отзыва. Пусто/нет поля – человек ничего не выбрал, тогда
  // просто первые из массива (старое поведение); hidden_tags_on_card –
  // более старое поле (список того, что скрыть, а не что показать),
  // ещё встречается в несохранённых заново отзывах. no_tags_on_card –
  // флаг конкретного отзыва «теги на карточке не нужны вовсе»,
  // перекрывает всё остальное. Кнопка «Скрыть теги на всех карточках»
  // в настройках (settings-edit.js) не отдельная настройка сверху –
  // она просто расставляет этот же флаг во всех отзывах разом
  // (core/api.js: _hide_all_card_tags), поэтому здесь ничего кроме
  // r.no_tags_on_card проверять не нужно. Все теги по-прежнему видны в
  // модалке при клике (см. reviewModalBodyHtml) – флаг гасит только
  // карточку.
  const featuredOnCard = (r.featured_tags_on_card || []).filter(tag => (r.tags || []).includes(tag));
  const hiddenOnCard = new Set(r.hidden_tags_on_card || []);
  const cardTags = r.no_tags_on_card
    ? []
    : (featuredOnCard.length
        ? featuredOnCard
        : (r.tags || []).filter(tag => !hiddenOnCard.has(tag)));
  const tagsHtml = cardTags.length
    ? `<div class="card-tags">${cardTags.slice(0, 4).map(tag => tagHtml(tag)).join("")}</div>`
    : "";

  const favHtml = r.favorites
    ? `<div class="card-fav">${i18n("Фавориты:")} <span>${esc(r.favorites)}</span></div>`
    : "";

  const dateRaw = r.date_end || r.date_start || r.date || null;
  const dateStr = dateRaw
    ? parseLocalDate(dateRaw).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })
    : "";

  const rewatchHtml = r.rewatch_count > 0
    ? `<span class="rewatch-badge" title="${i18n("Пересмотров: {v0}", { v0: r.rewatch_count })}">↻ ×${r.rewatch_count}</span>`
    : "";

  // Дата на телефоне переезжает бейджем на саму обложку (тот же приём,
  // что и у карточки статусов/архива – js/cards.js: manualCard,
  // watchBadge), освобождая строку .card-meta под обложкой. Только на
  // телефоне: на ПК столбцы шире и .card-meta и так не тесно, а этот же
  // нижний левый угол там уже занят датой в других карточках без
  // счётчика пересмотров – но именно тут, где рядом есть ещё и
  // .rewatch-badge в верхнем левом, безусловный показ бейджа означал бы
  // на широких карточках два бейджа сразу в одном и том же углу
  // (верхний левый – общий top:0;left:0 у .watch-badge и .rewatch-badge
  // вне мобильного переопределения). Поэтому бейдж и текстовая версия
  // ниже существуют оба сразу, а какую из двух показать – решает CSS
  // (.date-badge/.meta-date, index.html) по ширине экрана, а не JS.
  const dateBadgeHtml = dateStr ? `<span class="watch-badge date-badge">${esc(dateStr)}</span>` : "";

  const formatYear = [r.format, r.year].filter(Boolean).join(" · ");
  const typeLabel = TYPE_LABELS[r.type] || r.type || "";

  const editId  = r.id ?? encodeURIComponent(r.title);
  const editBtn = isAdmin()
    ? `<a href="#/add?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  // Ромб рисуется через ту же технику, что и активная вкладка в
  // рельсе (nav#rail, .tab-btn.active::before) и полки тир-листа –
  // не символом из шрифта, чтобы отпечаток не гулял между
  // устройствами (см. комментарий у .tab-btn.active::before).
  const gradeHtml = grade
    ? `<div class="card-grade-row" data-tip="${esc(grade.desc)}"><span class="card-grade-dot" style="--gc:${grade.color}"></span>${esc(gradeValueLabel(r.grade))}</div>`
    : "";

  // tabindex + role: карточка открывает модалку по клику, но до этой
  // правки была обычным <div> – то есть с клавиатуры отзыв нельзя было
  // открыть вообще, и возвращать фокус после закрытия окна тоже было
  // некуда. Ссылки внутри (править, источник) остаются самостоятельными
  // точками фокуса и обрабатываются раньше – см. rvBindCardClicks.
  return `<div class="review-card-wrap" data-review-idx="${i}"
    role="button" tabindex="0" aria-label="${i18n("Открыть отзыв: {v0}", { v0: esc(r.title) })}">
    ${editBtn}
    <div class="card" style="animation-delay:${Math.min(i * 40, 600)}ms${grade ? `;--gc:${esc(grade.color)}` : ""}">
      <div class="card-poster">
        ${typeLabel ? `<span class="type-tag tag-manual">${esc(typeLabel)}</span>` : ""}
        ${rewatchHtml}
        ${dateBadgeHtml}
        <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="${esc(r.title)}" loading="lazy" style="object-position:${esc(r.cover_focus || "50% 50%")}" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        <div class="card-meta">
          ${formatYear ? `<span>${esc(formatYear)}</span>` : ""}
          ${dateStr ? `<span class="meta-date">${esc(dateStr)}</span>` : ""}
        </div>
        ${gradeHtml}
        ${favHtml}
        ${tagsHtml}
      </div>
    </div>
  </div>`;
}
