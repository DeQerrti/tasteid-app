// ══════════════════════════════════════════════
//  FAVORITES — вкладка Любимое
//  Зависит от: config.js, api.js, cards.js
//  Тайтлы — из reviews.json по флагу favorite: true
//  Персонажи и персоны — из favorites.json
// ══════════════════════════════════════════════

async function loadFavorites() {
  if (cache.fav) { renderFavorites(cache.fav); return; }
  if (loading.fav) return;
  loading.fav = true;

  try {
    await fetchReviews();

    const favData = await fetch("/favorites.json")
      .then(r => r.ok ? r.json() : [])
      .catch(() => []);

    const titles = (cache.reviews || [])
      .filter(r => r.favorite === true)
      .sort((a, b) => (a.fav_order ?? 9999) - (b.fav_order ?? 9999));

    const characters = favData.filter(r => r.type === "character");
    const persons    = favData.filter(r => r.type === "person");

    cache.fav = { titles, characters, persons, favData };
    renderFavorites(cache.fav);

  } catch (err) {
    document.getElementById("tab-favorites").innerHTML =
      `<div class="state-box">
        <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
        ${i18n("Ошибка:")} ${esc(err.message)}
      </div>`;
  } finally {
    loading.fav = false;
  }
}

function renderFavorites({ titles, characters, persons, favData }) {
  const box   = document.getElementById("tab-favorites");
  const admin = isAdmin();
  let html    = "";

  // ── Тайтлы ──────────────────────────────────
  if (isFavSectionVisible("favTitles")) html += `<section class="group">
    <div class="section-header">
      <h2 class="section-title">${esc(siteLabel("sections", "favTitles", i18n("Тайтлы")))}</h2>
      ${admin ? `<a href="#/reviews-order" class="admin-add-btn">${i18n("Порядок")}</a>` : ""}
    </div>
    <div class="grid-now">
      ${titles.length
        ? titles.map((r, i) => favTitleCard(r, i)).join("")
        : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
    </div>
  </section>`;

  // ── Персонажи ────────────────────────────────
  if (isFavSectionVisible("favCharacters")) html += `<section class="group">
    <div class="section-header">
      <h2 class="section-title">${esc(siteLabel("sections", "favCharacters", i18n("Персонажи")))}</h2>
      ${admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : ""}
    </div>
    <div class="grid-chars">
      ${characters.length
        ? characters.map((r, i) => favPersonCard(r, i)).join("")
        : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
    </div>
  </section>`;

  // ── Персоны ──────────────────────────────────
  if (isFavSectionVisible("favPersons")) html += `<section class="group">
    <div class="section-header">
      <h2 class="section-title">${esc(siteLabel("sections", "favPersons", i18n("Персоны")))}</h2>
      ${admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : ""}
    </div>
    <div class="grid-chars">
      ${persons.length
        ? persons.map((r, i) => favPersonCard(r, i)).join("")
        : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
    </div>
  </section>`;

  // ── Свои разделы (сверх Тайтлов/Персонажей/Персон) ─
  // Данные — те же записи favorites.json, отфильтрованные по своему
  // type; список самих разделов заводится в /settings-edit.
  (window.SITE_FAV_COLLECTIONS || []).forEach(c => {
    if (!isFavSectionVisible(c.id)) return;
    const entries = favData.filter(r => r.type === c.id);
    html += `<section class="group">
      <div class="section-header">
        <h2 class="section-title">${esc(c.label)}</h2>
        ${admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : ""}
      </div>
      <div class="grid-chars">
        ${entries.length
          ? entries.map((r, i) => favPersonCard(r, i)).join("")
          : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
      </div>
    </section>`;
  });

  box.innerHTML = html || `<div class="state-box">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`;
}

// Карточка тайтла (из reviews.json с favorite: true)
function favTitleCard(r, index) {
  const info     = findReviewForTitle(r.title, r.type);
  const tagLabel = TYPE_LABELS[r.type] || r.type || "—";
  const tagClass = ["anime","manga","novel","movie","show"].includes(r.type)
    ? `tag-${r.type}` : "tag-manual";

  const editId  = r.id ?? encodeURIComponent(r.title);
  const editBtn = isAdmin()
    ? `<a href="/add.html?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  return `<div class="review-card-wrap" style="animation-delay:${Math.min(index * 25, 600)}ms">
    ${editBtn}
    <div class="card" style="animation-delay:0ms">
      <span class="type-tag ${tagClass}">${esc(tagLabel)}</span>
      <img src="${esc(r.cover || PH_TALL)}" alt="${esc(r.title)}" loading="lazy" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        ${r.year || info
          ? `<div class="card-meta">
              ${r.year ? `<span>${esc(String(r.year))}</span>` : ""}
              ${gradeInlineHtml(info)}
            </div>`
          : ""}
      </div>
    </div>
  </div>`;
}

// Карточка персонажа или персоны (из favorites.json).
// Лейблы ролей — из общего SUBTYPE_LABELS (js/config.js).
function favPersonCard(r, index) {
  const img = r.image || r.image_backup || PH_SQ;

  const subLine = r.type === "person"
    ? (SUBTYPE_LABELS[r.subtype] || i18n("Персона"))
    : (r.from || "");

  const sub = subLine
    ? `<div class="card-meta"><span>${esc(subLine)}</span></div>`
    : "";

  return `<div class="card card-char"
      style="animation-delay:${Math.min(index * 25, 500)}ms">
    <img src="${esc(img)}" alt="${esc(r.name)}" loading="lazy" ${imgFallbackAttrs(r.image, r.image_backup, PH_SQ)}>
    <div class="card-body">
      <div class="card-title">${esc(r.name)}</div>
      ${sub}
    </div>
  </div>`;
}
