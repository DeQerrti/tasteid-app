// ══════════════════════════════════════════════
//  REVIEWS — вкладка Отзывы
//  Зависит от: config.js, api.js
// ══════════════════════════════════════════════

// ── Состояние фильтров ─────────────────────────
// Переживает уход со вкладки и перезаход на сайт — раньше фильтры
// сбрасывались каждый раз, хотя вкладка и так помнит, какая она
// последняя открытая (site-settings.json: mainTab). Ключ и значения —
// то же rvState, просто зеркалится в localStorage при каждой правке.
const RV_FILTERS_KEY = "tasteid-rv-filters";
const rvState = {
  type:   "all",
  grade:  "all",
  source: "all",
  search: "",
  tagSearch: "",
};
try {
  Object.assign(rvState, JSON.parse(localStorage.getItem(RV_FILTERS_KEY)) || {});
} catch {}
function rvPersistFilters() {
  try {
    localStorage.setItem(RV_FILTERS_KEY, JSON.stringify(rvState));
  } catch {}
}

let rvLastFiltered = [];

document.addEventListener("tags-map-updated", () => {
  if (cache.reviews && document.getElementById("rv-grid")) applyRvFilters(cache.reviews);
});

async function loadReviews() {
  const data = await fetchReviews();
  const withReview = data.filter(r => r.preview || r.grade);
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

function renderReviews(reviews) {
  const types   = sortByOrder([...new Set(reviews.map(r => r.type).filter(Boolean))],   TYPE_FILTER_ORDER);
  const grades  = sortByOrder([...new Set(reviews.map(r => gradeToShelf(r.grade)).filter(Boolean))],  GRADE_ORDER);
  const sources = sortByOrder([...new Set(
    reviews.flatMap(r => [r.source, r.source2]).filter(Boolean)
  )], SOURCE_FILTER_ORDER);

  const adminBtn = isAdmin()
    ? `<a href="#/add" class="admin-add-btn">${i18n("Добавить")}</a>`
    : "";

  const box = document.getElementById("tab-reviews");
  box.innerHTML = `
    <div class="rv-toolbar">
      <div class="rv-filters">
        <div class="rv-filter-group">
          <span class="rv-filter-label">${esc(siteLabel("filters", "search", i18n("Поиск")))}</span>
          <input
            type="text"
            id="rv-search"
            class="rv-search-input"
            placeholder="${i18n("Название…")}"
            autocomplete="off"
            value="${esc(rvState.search)}"
          >
        </div>
        <div class="rv-filter-group">
          <span class="rv-filter-label">${esc(siteLabel("filters", "tags", i18n("Теги")))}</span>
          <input
            type="text"
            id="rv-tag-search"
            class="rv-search-input"
            placeholder="${i18n("Название тега…")}"
            autocomplete="off"
            value="${esc(rvState.tagSearch)}"
          >
        </div>
        ${renderRvFilterGroup("type",   siteLabel("filters", "type", i18n("Тип")),     types,   TYPE_LABELS,   rvState.type)}
        ${renderRvFilterGroup("grade",  siteLabel("filters", "grade", i18n("Оценка")), grades,  gradeLabels(), rvState.grade)}
        ${renderRvFilterGroup("source", siteLabel("filters", "source", i18n("Ссылки")), sources, SOURCE_LABELS, rvState.source)}
      </div>
      ${adminBtn}
    </div>
    <section class="group">
      <div class="reviews-grid" id="rv-grid"></div>
    </section>`;

  // Поиск
  const searchInput = document.getElementById("rv-search");
  searchInput.addEventListener("input", () => {
    rvState.search = searchInput.value.trim().toLowerCase();
    rvPersistFilters();
    applyRvFilters(reviews);
  });
  const tagSearchInput = document.getElementById("rv-tag-search");
  tagSearchInput.addEventListener("input", () => {
    rvState.tagSearch = tagSearchInput.value.trim().toLowerCase();
    rvPersistFilters();
    applyRvFilters(reviews);
  });

  bindRvFilters(reviews);
  applyRvFilters(reviews);
}

// Лейблы оценок для фильтра
function gradeLabels() {
  const out = {};
  for (const [key, g] of Object.entries(GRADES)) out[key] = g.name;
  return out;
}

// Рендер одной группы кнопок-фильтров
function renderRvFilterGroup(field, title, values, labelsMap, active) {
  if (!values.length) return "";
  const btns = [
    `<button class="rv-filter-btn${active === "all" ? " active" : ""}" data-field="${field}" data-val="all">${esc(siteLabel("filters", "all", i18n("Все")))}</button>`,
    ...values.map(v => {
      const label = labelsMap[v] || v;
      return `<button class="rv-filter-btn${active === v ? " active" : ""}" data-field="${field}" data-val="${esc(v)}">${esc(label)}</button>`;
    })
  ].join("");
  return `<div class="rv-filter-group">
    <span class="rv-filter-label">${esc(title)}</span>
    ${btns}
  </div>`;
}

function bindRvFilters(reviews) {
  document.querySelectorAll(".rv-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.field;
      const val   = btn.dataset.val;
      rvState[field] = val;
      rvPersistFilters();

      document.querySelectorAll(`.rv-filter-btn[data-field="${field}"]`)
        .forEach(b => b.classList.toggle("active", b.dataset.val === val));

      applyRvFilters(reviews);
    });
  });
}

function applyRvFilters(reviews) {
  let filtered = reviews;

  if (rvState.type !== "all") {
    filtered = filtered.filter(r => r.type === rvState.type);
  }
  if (rvState.grade !== "all") {
    filtered = filtered.filter(r => gradeToShelf(r.grade) === rvState.grade);
  }
  if (rvState.source !== "all") {
    filtered = filtered.filter(r =>
      r.source === rvState.source || r.source2 === rvState.source
    );
  }
  if (rvState.search) {
    filtered = filtered.filter(r =>
      r.title.toLowerCase().includes(rvState.search)
    );
  }
  if (rvState.tagSearch) {
    filtered = filtered.filter(r =>
      (r.tags || []).some(t => t.toLowerCase().includes(rvState.tagSearch))
    );
  }

  const grid = document.getElementById("rv-grid");
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="state-box" style="padding:3rem 1rem;grid-column:1/-1">
      ${esc(siteLabel("empty", "search", i18n("Ничего не найдено")))}
    </div>`;
    return;
  }

  grid.innerHTML = filtered.map((r, i) => reviewCard(r, i)).join("");
  rvLastFiltered = filtered;
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
    if (review) openReviewModal(review);
  }

  grid.addEventListener("click", openFromEvent);

  // Enter и пробел — то, чего браузер ждёт от role="button".
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
  const dateRaw = r.date_end || r.date_start || r.date || null;
  const dateStr = dateRaw
    ? new Date(dateRaw).toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" })
    : "";

  const btn1 = sourceBtnHtml(r.url, r.source);
  const btn2 = sourceBtnHtml(r.url2, r.source2);

  const hasFullText = r.review_full && r.review_full.trim();
  const textHtml = hasFullText
    ? `<div class="review-modal-fulltext">${esc(r.review_full).split("\n").map(p => p ? `<p>${p}</p>` : "").join("")}</div>`
    : `<div class="review-modal-fulltext">
        <p>${esc(r.preview || i18n("Пока без текста."))}</p>
        ${(btn1 || btn2) ? `<p class="review-modal-nofull-hint">${i18n("Развёрнутый текст сюда не перенесён — полный отзыв можно почитать по ссылке ниже.")}</p>` : ""}
      </div>`;

  // Карточка режет теги до CARD_TAGS_MAX (reviews.js: reviewCard) — тут,
  // в развороте отзыва, места на всех хватает, показываем полный набор.
  const tagsHtml = (r.tags || []).length
    ? `<div class="card-tags review-modal-tags">${r.tags.map(tag => tagHtml(tag)).join("")}</div>`
    : "";

  return `
    <div class="review-modal-header">
      <img src="${esc(r.cover || PH_TALL)}" alt="${esc(r.title)}" class="review-modal-cover" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      <div>
        <div class="review-modal-title" id="review-modal-title">${esc(r.title)}</div>
        <div class="review-meta-row">${formatYear ? `<span class="review-format">${esc(formatYear)}</span>` : ""}</div>
        ${dateStr ? `<div class="review-dateline">${i18n("Ознакомился:")} <span>${esc(dateStr)}</span></div>` : ""}
        ${r.rewatch_count > 0 ? `<div class="review-rewatch" title="${i18n("Пересмотров: {v0}", { v0: r.rewatch_count })}">↻ ×${r.rewatch_count}</div>` : ""}
        ${grade ? `<div class="grade-chip" style="--gc:${grade.color}" data-tip="${esc(grade.desc)}">${esc(grade.name)}</div>` : ""}
      </div>
    </div>
    ${tagsHtml}
    ${textHtml}
    <div class="source-buttons">${btn1}${btn2}</div>
  `;
}

// Элемент, с которого модалку открыли: на него надо вернуть фокус при
// закрытии, иначе после Esc фокус улетает в начало страницы и человеку
// с клавиатуры приходится заново идти до той же карточки.
let _reviewModalOpener = null;

function openReviewModal(r) {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay) return;
  _reviewModalOpener = document.activeElement;
  document.getElementById("review-modal-body").innerHTML = reviewModalBodyHtml(r);
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Фокус внутрь окна — иначе скринридер продолжит читать страницу
  // под ним, а Tab уведёт за пределы диалога с первого же нажатия.
  // На саму панель, не на кнопку закрытия — той больше нет (Esc и
  // клик в стороне уже закрывают модалку, отдельный крестик был
  // лишним элементом).
  overlay.querySelector(".review-modal-panel")?.focus();
}

function closeReviewModal() {
  const overlay = document.getElementById("review-modal-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  _reviewModalOpener?.focus?.();
  _reviewModalOpener = null;
}

// Удержание фокуса внутри окна, пока оно открыто: Tab с последнего
// элемента возвращает на первый, Shift+Tab с первого — на последний.
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
    if (e.target === overlay) closeReviewModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReviewModal();
    if (e.key === "Tab") trapReviewModalFocus(e);
  });
});
function sourceBtnHtml(url, source) {
  if (!url) return "";
  const label = SOURCE_LABELS[source] || source || i18n("Подробнее");
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

  // Верхние 4: карточка — это витрина для беглого взгляда, не место
  // для полного списка тегов. Какие именно — выбирает человек в
  // редакторе (add.html, «Какие теги показывать на карточке»),
  // featured_tags_on_card — явно отмеченные там «избранные» теги
  // этого отзыва. Пусто/нет поля — человек ничего не выбрал, тогда
  // просто первые из массива (старое поведение); hidden_tags_on_card —
  // более старое поле (список того, что скрыть, а не что показать),
  // ещё встречается в несохранённых заново отзывах. Все теги
  // по-прежнему видны в модалке при клике (см. reviewModalBodyHtml).
  const featuredOnCard = (r.featured_tags_on_card || []).filter(tag => (r.tags || []).includes(tag));
  const hiddenOnCard = new Set(r.hidden_tags_on_card || []);
  const cardTags = featuredOnCard.length
    ? featuredOnCard
    : (r.tags || []).filter(tag => !hiddenOnCard.has(tag));
  const tagsHtml = cardTags.length
    ? `<div class="card-tags">${cardTags.slice(0, 4).map(tag => tagHtml(tag)).join("")}</div>`
    : "";

  const favHtml = r.favorites
    ? `<div class="card-fav">${i18n("Фавориты:")} <span>${esc(r.favorites)}</span></div>`
    : "";

  const dateRaw = r.date_end || r.date_start || r.date || null;
  const dateStr = dateRaw
    ? new Date(dateRaw).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" })
    : "";

  const rewatchHtml = r.rewatch_count > 0
    ? `<span class="watch-badge" title="${i18n("Пересмотров: {v0}", { v0: r.rewatch_count })}">↻ ×${r.rewatch_count}</span>`
    : "";

  const formatYear = [r.format, r.year].filter(Boolean).join(" · ");
  const typeLabel = TYPE_LABELS[r.type] || r.type || "";

  const editId  = r.id ?? encodeURIComponent(r.title);
  const editBtn = isAdmin()
    ? `<a href="#/add?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  // Ромб рисуется через ту же технику, что и активная вкладка в
  // рельсе (nav#rail, .tab-btn.active::before) и полки тир-листа —
  // не символом из шрифта, чтобы отпечаток не гулял между
  // устройствами (см. комментарий у .tab-btn.active::before).
  const gradeHtml = grade
    ? `<div class="card-grade-row" data-tip="${esc(grade.desc)}"><span class="card-grade-dot" style="--gc:${grade.color}"></span>${esc(grade.name)}</div>`
    : "";

  // tabindex + role: карточка открывает модалку по клику, но до этой
  // правки была обычным <div> — то есть с клавиатуры отзыв нельзя было
  // открыть вообще, и возвращать фокус после закрытия окна тоже было
  // некуда. Ссылки внутри (править, источник) остаются самостоятельными
  // точками фокуса и обрабатываются раньше — см. rvBindCardClicks.
  return `<div class="review-card-wrap" data-review-idx="${i}"
    role="button" tabindex="0" aria-label="${i18n("Открыть отзыв: {v0}", { v0: esc(r.title) })}">
    ${editBtn}
    <div class="card" style="animation-delay:${Math.min(i * 40, 600)}ms">
      ${typeLabel ? `<span class="type-tag tag-manual">${esc(typeLabel)}</span>` : ""}
      ${rewatchHtml}
      <img src="${esc(r.cover || PH_TALL)}" alt="${esc(r.title)}" loading="lazy" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        <div class="card-meta">
          ${formatYear ? `<span>${esc(formatYear)}</span>` : ""}
          ${dateStr ? `<span>${esc(dateStr)}</span>` : ""}
        </div>
        ${gradeHtml}
        ${favHtml}
        ${tagsHtml}
      </div>
    </div>
  </div>`;
}
