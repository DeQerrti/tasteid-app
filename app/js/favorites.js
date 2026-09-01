// ══════════════════════════════════════════════
//  FAVORITES – вкладка Любимое
//  Зависит от: config.js, api.js, cards.js
//  Тайтлы – из reviews.json по флагу favorite: true
//  Персонажи и персоны – из favorites.json
// ══════════════════════════════════════════════

let favExportData = null;

async function loadFavorites() {
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

    renderFavorites({ titles, characters, persons, favData });

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

  favExportData = { titles, characters, persons, favData };
  html += `<div class="fav-export-bar">
    <button class="admin-add-btn" onclick="openFavExportModal()">${i18n("Сохранить как картинку")}</button>
  </div>`;

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
  // Данные – те же записи favorites.json, отфильтрованные по своему
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
function favTitleCard(r, index, forExport) {
  const info     = findReviewForTitle(r.title, r.type);
  const tagLabel = TYPE_LABELS[r.type] || r.type || "–";
  const tagClass = ["anime","manga","novel","movie","show"].includes(r.type)
    ? `tag-${r.type}` : "tag-manual";

  const editId  = r.id ?? encodeURIComponent(r.title);
  const editBtn = isAdmin() && !forExport
    ? `<a href="#/add?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
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
// Лейблы ролей – из общего SUBTYPE_LABELS (js/config.js).
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

// ══ ЭКСПОРТ «ЛЮБИМОГО» В КАРТИНКУ ═══════════════════════
// Тот же приём, что у тир-листа персонажей (js/tierlist.js, tlExport):
// офскрин-контейнер с готовой вёрсткой отдаётся html2canvas, картинки
// сперва проксируются в data:-URL (см. config.js). Отличие – выбор,
// что именно попадёт на картинку: только тайтлы, только персонажи и
// персоны (вместе со своими разделами – они те же карточки), или всё
// сразу. Карточка тайтла – без карандаша редактирования (см. параметр
// forExport у favTitleCard выше): владелец видит его на самой
// странице, а не на картинке, которой делятся.
let favExportModalEl = null;

function favExportModalEnsure() {
  if (favExportModalEl) return favExportModalEl;
  favExportModalEl = document.createElement("div");
  favExportModalEl.id = "fav-export-overlay";
  favExportModalEl.className = "modal-overlay hidden";
  favExportModalEl.innerHTML = `
    <div class="modal confirm-dialog fav-export-modal">
      <div class="confirm-dialog-text">${i18n("Что показать на картинке?")}</div>
      <label class="fav-export-option"><input type="radio" name="fav-export-mode" value="titles" checked>${i18n("Только тайтлы")}</label>
      <label class="fav-export-option"><input type="radio" name="fav-export-mode" value="chars">${i18n("Только персонажи и персоны")}</label>
      <label class="fav-export-option"><input type="radio" name="fav-export-mode" value="all">${i18n("Всё вместе")}</label>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${i18n("Отмена")}</button>
        <button type="button" class="btn btn-primary" data-act="ok">${i18n("Сохранить")}</button>
      </div>
    </div>`;
  document.body.appendChild(favExportModalEl);
  favExportModalEl.querySelector('[data-act="cancel"]').onclick = closeFavExportModal;
  favExportModalEl.onclick = (e) => {
    if (e.target === favExportModalEl) closeFavExportModal();
  };
  favExportModalEl.querySelector('[data-act="ok"]').onclick = () => {
    const mode = favExportModalEl.querySelector('input[name="fav-export-mode"]:checked')?.value || "all";
    closeFavExportModal();
    favExport(mode);
  };
  return favExportModalEl;
}

function openFavExportModal() {
  if (!favExportData) return;
  favExportModalEnsure().classList.remove("hidden");
}

function closeFavExportModal() {
  favExportModalEl?.classList.add("hidden");
}

async function favExport(mode) {
  const { titles, characters, persons, favData } = favExportData;
  const customCollections = window.SITE_FAV_COLLECTIONS || [];

  let html = "";
  if (mode !== "chars" && titles.length) {
    html += `<section class="group">
      <h2 class="section-title">${esc(siteLabel("sections", "favTitles", i18n("Тайтлы")))}</h2>
      <div class="grid-now">${titles.map((r, i) => favTitleCard(r, i, true)).join("")}</div>
    </section>`;
  }
  if (mode !== "titles") {
    if (characters.length) {
      html += `<section class="group">
        <h2 class="section-title">${esc(siteLabel("sections", "favCharacters", i18n("Персонажи")))}</h2>
        <div class="grid-chars">${characters.map((r, i) => favPersonCard(r, i)).join("")}</div>
      </section>`;
    }
    if (persons.length) {
      html += `<section class="group">
        <h2 class="section-title">${esc(siteLabel("sections", "favPersons", i18n("Персоны")))}</h2>
        <div class="grid-chars">${persons.map((r, i) => favPersonCard(r, i)).join("")}</div>
      </section>`;
    }
    customCollections.forEach((c) => {
      const entries = favData.filter((r) => r.type === c.id);
      if (!entries.length) return;
      html += `<section class="group">
        <h2 class="section-title">${esc(c.label)}</h2>
        <div class="grid-chars">${entries.map((r, i) => favPersonCard(r, i)).join("")}</div>
      </section>`;
    });
  }

  if (!html) {
    alert(i18n("Нечего показывать – в этой группе пока пусто."));
    return;
  }

  const btn = document.querySelector(".fav-export-bar .admin-add-btn");
  if (btn) { btn.textContent = i18n("⏳ Создаём…"); btn.disabled = true; }

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-9999px;top:0;width:900px;padding:1.5rem;";
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  let restoreImages = () => {};
  try {
    if (typeof html2canvas === "undefined") {
      if (btn) btn.textContent = i18n("⏳ Загружаем библиотеку…");
      await loadHtml2Canvas();
      if (btn) btn.textContent = i18n("⏳ Создаём…");
    }

    const imgs = Array.from(wrap.querySelectorAll("img"));
    await Promise.all(
      imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; })))
    );

    restoreImages = await proxyImagesToDataUrls(wrap);

    const canvas = await html2canvas(wrap, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
    });

    const link = document.createElement("a");
    link.download = "favorites.png";
    link.href = canvas.toDataURL("image/png");
    // Ссылку обязательно вставить в документ – см. тот же комментарий у
    // tlExport() в js/tierlist.js про перехват на Android.
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    alert("Не удалось создать картинку 😢\n" + err.message);
  } finally {
    restoreImages();
    wrap.remove();
    if (btn) { btn.textContent = i18n("Сохранить как картинку"); btn.disabled = false; }
  }
}
