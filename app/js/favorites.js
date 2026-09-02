// ══════════════════════════════════════════════
//  FAVORITES – вкладка Любимое
//  Зависит от: config.js, api.js, cards.js
//  Тайтлы – из reviews.json по флагу favorite: true
//  Персонажи и персоны – из favorites.json
// ══════════════════════════════════════════════

let favExportData = null;
let favExportSections = [];

// ── Сворачивание разделов ───────────────────────
// Тот же приём, что у «Статусов» (js/now.js, COLLAPSE_KEY) – свой ключ,
// чтобы id разделов (favTitles и т.п.) не путались со статусами при
// случайном совпадении. Без треугольника – он и там оказался лишним
// визуальным шумом (см. её же обсуждение в js/now.js), здесь его
// никогда и не было.
const FAV_COLLAPSE_KEY = "tasteid_fav_collapsed";
function favGetCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAV_COLLAPSE_KEY)) || []);
  } catch {
    return new Set();
  }
}
function favToggleSection(id) {
  const collapsed = favGetCollapsed();
  const section = document.querySelector(`.fav-section[data-fav-section="${CSS.escape(id)}"]`);
  if (!section) return;
  const body = section.querySelector(".fav-section-body");
  if (collapsed.has(id)) {
    collapsed.delete(id);
    body.classList.remove("hidden");
  } else {
    collapsed.add(id);
    body.classList.add("hidden");
  }
  localStorage.setItem(FAV_COLLAPSE_KEY, JSON.stringify([...collapsed]));
}

// headerExtra – кнопки справа от заголовка (камера, «Порядок»,
// «Добавить»); свой onclick со stopPropagation, иначе клик по ним же
// сворачивал бы раздел.
function favSectionHtml(id, title, headerExtra, bodyHtml, collapsed) {
  const isCollapsed = collapsed.has(id);
  return `<section class="group fav-section" data-fav-section="${esc(id)}">
    <div class="section-header" onclick="favToggleSection('${esc(id)}')" style="cursor:pointer;user-select:none">
      <h2 class="section-title" style="margin-bottom:0">${esc(title)}</h2>
      <div style="display:flex;gap:.4rem;align-items:center;flex-shrink:0" onclick="event.stopPropagation()">${headerExtra}</div>
    </div>
    <div class="fav-section-body${isCollapsed ? " hidden" : ""}">${bodyHtml}</div>
  </section>`;
}

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
  const box       = document.getElementById("tab-favorites");
  const admin     = isAdmin();
  const collapsed = favGetCollapsed();
  let html        = "";

  favExportData = { titles, characters, persons, favData };
  // Список разделов, которые сейчас реально на экране – ровно то, что
  // предложит модалка экспорта (openFavExportModal): чекбоксом можно
  // выбрать любой из них по отдельности, включая свои разделы, а не
  // только «всё» / «только тайтлы» / «только персонажи», как было.
  favExportSections = [];

  const cameraBtn = cameraButton("openFavExportModal()", "fav-camera-btn");

  // ── Тайтлы / Персонажи / Персоны ─────────────
  // Порядок этих трёх встроенных разделов настраивается в /settings-edit
  // перетаскиванием (favSectionOrderState) – раньше был зашит намертво.
  // window.SITE_FAV_SECTION_ORDER = null, пока настроек ещё не было.
  const builtinSectionBuilders = {
    favTitles: () => {
      const title = siteLabel("sections", "favTitles", i18n("Тайтлы"));
      favExportSections.push({ id: "favTitles", label: title });
      return favSectionHtml(
        "favTitles",
        title,
        `${cameraBtn}${admin ? `<a href="#/reviews-order" class="admin-add-btn">${i18n("Порядок")}</a>` : ""}`,
        `<div class="grid-now">
          ${titles.length
            ? titles.map((r, i) => favTitleCard(r, i)).join("")
            : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
        </div>`,
        collapsed
      );
    },
    favCharacters: () => {
      const title = siteLabel("sections", "favCharacters", i18n("Персонажи"));
      favExportSections.push({ id: "favCharacters", label: title });
      return favSectionHtml(
        "favCharacters",
        title,
        admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : "",
        `<div class="grid-chars">
          ${characters.length
            ? characters.map((r, i) => favPersonCard(r, i)).join("")
            : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
        </div>`,
        collapsed
      );
    },
    favPersons: () => {
      const title = siteLabel("sections", "favPersons", i18n("Персоны"));
      favExportSections.push({ id: "favPersons", label: title });
      return favSectionHtml(
        "favPersons",
        title,
        admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : "",
        `<div class="grid-chars">
          ${persons.length
            ? persons.map((r, i) => favPersonCard(r, i)).join("")
            : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
        </div>`,
        collapsed
      );
    },
  };
  const sectionOrder = window.SITE_FAV_SECTION_ORDER || Object.keys(builtinSectionBuilders);
  let sawTitlesHeader = false;
  sectionOrder.forEach((key) => {
    if (!builtinSectionBuilders[key] || !isFavSectionVisible(key)) return;
    html += builtinSectionBuilders[key]();
    if (key === "favTitles") sawTitlesHeader = true;
  });

  // ── Свои разделы (сверх Тайтлов/Персонажей/Персон) ─
  // Данные – те же записи favorites.json, отфильтрованные по своему
  // type; список самих разделов заводится в /settings-edit.
  (window.SITE_FAV_COLLECTIONS || []).forEach((c) => {
    if (!isFavSectionVisible(c.id)) return;
    const entries = favData.filter((r) => r.type === c.id);
    favExportSections.push({ id: c.id, label: c.label });
    html += favSectionHtml(
      c.id,
      c.label,
      admin ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>` : "",
      `<div class="grid-chars">
        ${entries.length
          ? entries.map((r, i) => favPersonCard(r, i)).join("")
          : `<div class="state-box" style="padding:2rem 1rem;grid-column:1/-1;font-size:.95rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`}
      </div>`,
      collapsed
    );
  });

  // Раздел «Тайтлы» скрыт/удалён – кнопке камеры некуда встать рядом с
  // «Порядок», но экспорт остальных разделов всё равно должен остаться
  // доступным: отдельная строка с одной только камерой сверху.
  if (!sawTitlesHeader && favExportSections.length) {
    html = `<div style="display:flex;justify-content:flex-end;margin-bottom:.75rem">${cameraBtn}</div>` + html;
  }

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
// сперва проксируются в data:-URL (см. config.js). Выбор, что попадёт
// на картинку, – галочками по каждому разделу отдельно (favExportSections,
// собирается заново при каждом renderFavorites – включает свои разделы
// тоже, под тем именем, какое им дали в /settings-edit), а не жёстким
// «всё / только тайтлы / только персонажи»: если разделов больше двух,
// раньше нельзя было выбрать, скажем, только один свой раздел из трёх.
// Карточка тайтла – без карандаша редактирования (см. параметр
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
      <div id="fav-export-options"></div>
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
    const ids = [...favExportModalEl.querySelectorAll('input[name="fav-export-sec"]:checked')].map((el) => el.value);
    closeFavExportModal();
    favExport(ids);
  };
  return favExportModalEl;
}

function openFavExportModal() {
  if (!favExportData || !favExportSections.length) return;
  const modal = favExportModalEnsure();
  modal.querySelector("#fav-export-options").innerHTML = favExportSections
    .map(
      (s) =>
        `<label class="fav-export-option"><input type="checkbox" name="fav-export-sec" value="${esc(s.id)}" checked>${esc(s.label)}</label>`
    )
    .join("");
  modal.classList.remove("hidden");
}

function closeFavExportModal() {
  favExportModalEl?.classList.add("hidden");
}

async function favExport(sectionIds) {
  if (!sectionIds.length) return;
  const { titles, characters, persons, favData } = favExportData;
  const customCollections = window.SITE_FAV_COLLECTIONS || [];
  const wanted = new Set(sectionIds);

  let html = "";
  if (wanted.has("favTitles") && titles.length) {
    html += `<section class="group">
      <h2 class="section-title">${esc(siteLabel("sections", "favTitles", i18n("Тайтлы")))}</h2>
      <div class="grid-now">${titles.map((r, i) => favTitleCard(r, i, true)).join("")}</div>
    </section>`;
  }
  if (wanted.has("favCharacters") && characters.length) {
    html += `<section class="group">
      <h2 class="section-title">${esc(siteLabel("sections", "favCharacters", i18n("Персонажи")))}</h2>
      <div class="grid-chars">${characters.map((r, i) => favPersonCard(r, i)).join("")}</div>
    </section>`;
  }
  if (wanted.has("favPersons") && persons.length) {
    html += `<section class="group">
      <h2 class="section-title">${esc(siteLabel("sections", "favPersons", i18n("Персоны")))}</h2>
      <div class="grid-chars">${persons.map((r, i) => favPersonCard(r, i)).join("")}</div>
    </section>`;
  }
  customCollections.forEach((c) => {
    if (!wanted.has(c.id)) return;
    const entries = favData.filter((r) => r.type === c.id);
    if (!entries.length) return;
    html += `<section class="group">
      <h2 class="section-title">${esc(c.label)}</h2>
      <div class="grid-chars">${entries.map((r, i) => favPersonCard(r, i)).join("")}</div>
    </section>`;
  });

  if (!html) {
    alert(i18n("Нечего показывать – в этой группе пока пусто."));
    return;
  }

  const btn = document.getElementById("fav-camera-btn");
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

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:fixed;left:-9999px;top:0;width:900px;padding:1.5rem;";
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  let restoreImages = () => {};
  try {
    if (typeof html2canvas === "undefined") await loadHtml2Canvas();

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
      onclone: (clonedDoc) => {
        // html2canvas клонирует документ в отдельный iframe – без явного
        // переноса data-skin переменные темы (themes.css, [data-skin="…"])
        // резолвились бы в клоне к дефолтным (тёмным), а не к текущей
        // теме человека, и картинка выходила заметно темнее реальной
        // страницы.
        clonedDoc.documentElement.setAttribute("data-skin", document.documentElement.getAttribute("data-skin") || "");
      },
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
    restoreBtn();
  }
}
