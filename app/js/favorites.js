// ══════════════════════════════════════════════
//  FAVORITES – вкладка Любимое
//  Зависит от: config.js, api.js, cards.js
//  Тайтлы – из reviews.json по флагу favorite: true
//  Персонажи и персоны – из favorites.json
// ══════════════════════════════════════════════

let favExportData = null;
let favExportSections = [];

// Текущая выбранная вкладка-переключатель (favTitles/favCharacters/
// favPersons или id своей коллекции) – см. её же комментарий у
// renderFavorites() ниже. Сбрасывается на первую по порядку при каждой
// загрузке страницы, как и режим тир-листа (tlState.mode).
const favState = { mode: null };

// Снимок уже нарисованного – та же причина, что у nowLastSnapshot в
// js/now.js: reviews.json/favorites.json перечитываются заново при
// каждом заходе на вкладку, а на телефоне это идёт через нативный мост
// Capacitor Filesystem, заметно медленнее локального fetch на
// компьютере. Без этой проверки каждый заход пересобирал всю разметку
// заново, даже когда ничего не изменилось, – карточки заметно мигали.
let favLastSnapshot = null;

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

    // Разделы «Любимого» (свои – SITE_FAV_COLLECTIONS, их порядок и
    // видимость – тоже SITE_*) заводятся, переименовываются и
    // переставляются в /settings-edit, а не через reviews.json/
    // favorites.json – без них в снимке пустой новый раздел (в этих
    // двух файлах после его создания ничего не меняется вообще) не
    // отличался от снимка ДО создания, и вкладка молча не показывала
    // его, пока в нём не появлялась хотя бы одна запись.
    const snapshot = JSON.stringify({
      titles,
      characters,
      persons,
      favData,
      collections: window.SITE_FAV_COLLECTIONS,
      order: window.SITE_FAV_SECTION_ORDER,
      hidden: window.SITE_HIDDEN_FAV_SECTIONS && [...window.SITE_HIDDEN_FAV_SECTIONS],
      labels: window.SITE_LABELS,
    });
    if (snapshot === favLastSnapshot) return;
    favLastSnapshot = snapshot;

    renderFavorites({ titles, characters, persons, favData });

  } catch (err) {
    favLastSnapshot = null; // при следующей успешной загрузке перерисовать точно
    document.getElementById("tab-favorites").innerHTML =
      `<div class="state-box">
        <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
        ${i18n("Ошибка:")} ${esc(err.message)}
      </div>`;
  } finally {
    loading.fav = false;
  }
}

// Один общий порядок на встроенные разделы (Тайтлы/Персонажи/Персоны) и
// свои (заводятся в /settings-edit) – window.SITE_FAV_SECTION_ORDER
// хранит вперемешку ключи встроенных и id своих (см. её же комментарий
// у favSectionOrderedKeys() в settings-tabs.js).
function favOrderedKeys(collections) {
  const knownKeys = ["favTitles", "favCharacters", "favPersons", ...collections.map((c) => c.id)];
  const savedOrder = Array.isArray(window.SITE_FAV_SECTION_ORDER) ? window.SITE_FAV_SECTION_ORDER : [];
  return [
    ...savedOrder.filter((k) => knownKeys.includes(k)),
    ...knownKeys.filter((k) => !savedOrder.includes(k)),
  ];
}

// Переключатель вкладок сверху (то же самое, чем в статистике
// переключают год, а в тир-листе – коллекцию: быстрее найти нужный
// раздел, чем бесконечно листать вниз через все сразу). Каждый раздел
// сам по себе не меняется – меняется только то, что видно на экране;
// экспорт картинкой (favExportData/favExportSections ниже) по-прежнему
// собирает данные ВСЕХ разделов разом, не только открытого сейчас –
// favExport() строит свою независимую разметку из этих данных, а не
// из того, что нарисовано на экране.
function renderFavorites({ titles, characters, persons, favData }) {
  const box = document.getElementById("tab-favorites");
  const admin = isAdmin();

  favExportData = { titles, characters, persons, favData };
  favExportSections = [];

  const builtinMeta = {
    favTitles: { title: siteLabel("sections", "favTitles", i18n("Тайтлы")), items: titles },
    favCharacters: { title: siteLabel("sections", "favCharacters", i18n("Персонажи")), items: characters },
    favPersons: { title: siteLabel("sections", "favPersons", i18n("Персоны")), items: persons },
  };
  const collections = window.SITE_FAV_COLLECTIONS || [];
  const collectionById = Object.fromEntries(collections.map((c) => [c.id, c]));

  const visibleKeys = favOrderedKeys(collections).filter((key) =>
    builtinMeta[key] ? isFavSectionVisible(key) : collectionById[key] && isFavSectionVisible(key)
  );
  visibleKeys.forEach((key) => {
    favExportSections.push({
      id: key,
      label: builtinMeta[key] ? builtinMeta[key].title : collectionById[key].label,
    });
  });

  if (!visibleKeys.includes(favState.mode)) favState.mode = visibleKeys[0] ?? null;

  if (!favState.mode) {
    box.innerHTML = `<div class="state-box">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`;
    return;
  }

  const cameraBtn = cameraButton("openFavExportModal()", "fav-camera-btn");
  const toggleBtns = visibleKeys
    .map((key) => {
      const label = builtinMeta[key] ? builtinMeta[key].title : collectionById[key].label;
      const count = builtinMeta[key] ? builtinMeta[key].items.length : favData.filter((r) => r.type === key).length;
      return `<button class="tl-mode-btn${favState.mode === key ? " active" : ""}" data-mode="${esc(key)}">${esc(label)} <span class="section-count">${count}</span></button>`;
    })
    .join("");
  const actionLink =
    favState.mode === "favTitles"
      ? admin
        ? `<a href="#/reviews-order" class="admin-add-btn">${i18n("Порядок")}</a>`
        : ""
      : admin
        ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>`
        : "";

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:1.8rem">
      <div class="tl-mode-toggle" style="margin-bottom:0">${toggleBtns}</div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-shrink:0">${cameraBtn}${actionLink}</div>
    </div>
    <div id="fav-mode-body">${favModeBodyHtml()}</div>`;
  bindFavModeToggle();
}

function favModeBodyHtml() {
  const key = favState.mode;
  const { titles, characters, persons, favData } = favExportData;
  const empty = `<div class="state-box" style="padding:2rem 1rem">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`;

  if (key === "favTitles") {
    return `<div class="grid-now">${titles.length ? titles.map((r, i) => favTitleCard(r, i)).join("") : empty}</div>`;
  }
  if (key === "favCharacters") {
    return `<div class="grid-chars">${characters.length ? characters.map((r, i) => favPersonCard(r, i)).join("") : empty}</div>`;
  }
  if (key === "favPersons") {
    return `<div class="grid-chars">${persons.length ? persons.map((r, i) => favPersonCard(r, i)).join("") : empty}</div>`;
  }
  const entries = favData.filter((r) => r.type === key);
  return `<div class="grid-chars">${entries.length ? entries.map((r, i) => favPersonCard(r, i)).join("") : empty}</div>`;
}

function bindFavModeToggle() {
  document.querySelectorAll("#tab-favorites .tl-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === favState.mode) return;
      favState.mode = btn.dataset.mode;
      renderFavorites(favExportData);
    });
  });
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
      <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="${esc(r.title)}" loading="lazy" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
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
  let restoreAnim = () => {};
  let restoreShadows = () => {};
  try {
    if (typeof html2canvas === "undefined") await loadHtml2Canvas();

    const imgs = Array.from(wrap.querySelectorAll("img"));
    // loading="lazy" (карточки унаследовали его от обычного показа на
    // вкладке) в контейнере, специально отодвинутом за экран, браузер
    // решает не грузить вовсе – ждать load/error тогда бессмысленно,
    // они никогда не придут. Снимок «Любимого» из-за этого крутился
    // бесконечно; принудительная "eager" запускает загрузку сразу, а
    // waitForImages всё равно не виснет насовсем, если что-то не ответит.
    imgs.forEach((img) => {
      img.loading = "eager";
    });
    await waitForImages(imgs);

    restoreImages = await proxyImagesToDataUrls(wrap);
    restoreAnim = disableAnimations(wrap);
    // Неоморфизм (и любая другая тема с рельефными карточками) иначе
    // вышел бы на снимке плоским – см. bakeNeoShadows() в config.js.
    restoreShadows = bakeNeoShadows(wrap);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

    const canvas = await withTimeout(
      html2canvas(wrap, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
        scale: safeCaptureScale(wrap, 2),
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
      }),
      20000,
      i18n("Не удалось создать картинку за разумное время.")
    );

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
    restoreAnim();
    restoreShadows();
    wrap.remove();
    restoreBtn();
  }
}
