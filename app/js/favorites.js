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

  favExportData = { titles, characters, persons, favData };
  favExportSections = [];
  favModeBodies = {};

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

  // fav-mode-body начинается пустым – его наполняет renderFavModeBody()
  // сразу следом, тем же путём, что и переключение между разделами (см.
  // её же комментарий у favModeBodies ниже): один источник правды на
  // «как показать раздел», а не два (тут и там).
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:1.8rem">
      <div class="tl-mode-toggle" style="margin-bottom:0">${toggleBtns}</div>
      <div id="fav-action-link" style="display:flex;gap:.5rem;align-items:center;flex-shrink:0">${cameraBtn}</div>
    </div>
    <div id="fav-mode-body"></div>`;
  bindFavModeToggle();
  renderFavModeBody();
}

// Ссылка справа от переключателя разделов зависит от того, какой
// раздел открыт («Порядок» только у «Тайтлов», «Добавить» у остальных) –
// её приходится перерисовывать при каждом переключении отдельно от
// самого содержимого раздела (см. её же комментарий у favModeBodies).
function updateFavActionLink() {
  const el = document.getElementById("fav-action-link");
  if (!el) return;
  const admin = isAdmin();
  const actionLink =
    favState.mode === "favTitles"
      ? admin
        ? `<a href="#/reviews-order" class="admin-add-btn">${i18n("Порядок")}</a>`
        : ""
      : admin
        ? `<a href="#/favorites-edit" class="admin-add-btn">${i18n("Добавить")}</a>`
        : "";
  el.innerHTML = cameraButton("openFavExportModal()", "fav-camera-btn") + actionLink;
}

// Кэш уже отрисованных разделов – та же причина, что решили для
// тир-листа (loadTierlist()/tlLastSnapshot): переключение между
// разделами «Любимого» раньше ВСЕГДА заново строило innerHTML и
// заводило свежие <img>, даже возвращаясь к разделу, который уже
// показывали минуту назад в этом же заходе. Байты картинки при этом
// уже лежали в srcCache (см. её же комментарий у vaultSrc в
// mobile/src/main.js), но самому <img>-узлу всё равно приходится
// заново декодировать картинку для отрисовки – а это не байты, это
// именно узел DOM, и кэш путей его не спасал. Сбрасывается в
// renderFavorites() – там, где данные и правда могли измениться.
let favModeBodies = {}; // { [mode]: HTMLElement }

function renderFavModeBody() {
  const container = document.getElementById("fav-mode-body");
  if (!container) return;
  updateFavActionLink();
  if (!favModeBodies[favState.mode]) {
    const el = document.createElement("div");
    el.innerHTML = favModeBodyHtml();
    container.appendChild(el);
    favModeBodies[favState.mode] = el;
  }
  for (const [mode, el] of Object.entries(favModeBodies)) {
    el.hidden = mode !== favState.mode;
  }
  favBindCardClicks();
}

// Клик по карточке «Любимого» – тайтл открывает ту же модалку отзыва,
// что и обычная сетка отзывов (см. rvBindCardClicks() в reviews.js),
// персонаж/персона ведёт в её редактор (#/favorites-edit?edit=ID),
// где и живёт вся анкета (галерея, био, привязанные тайтлы). Слушатель
// вешается один раз на #fav-mode-body – сам контейнер не пересоздаётся
// при переключении разделов (см. favModeBodies выше), только его
// дети скрываются/показываются.
function favBindCardClicks() {
  const body = document.getElementById("fav-mode-body");
  if (!body || body.dataset.clickBound) return;
  body.dataset.clickBound = "1";
  body.addEventListener("click", (e) => {
    if (e.target.closest(".review-edit-btn")) return;
    const titleWrap = e.target.closest(".review-card-wrap");
    if (titleWrap) {
      const id = titleWrap.dataset.reviewId;
      const review = (favExportData?.titles || []).find(
        (r) => String(r.id ?? encodeURIComponent(r.title)) === id
      );
      if (review) openReviewModal(review);
      return;
    }
    const charCard = e.target.closest(".card-char[data-fav-id]");
    if (charCard) {
      const id = charCard.dataset.favId;
      const entry = (favExportData?.favData || []).find((r) => String(r.id) === id);
      if (entry) openFavPersonModal(entry);
    }
  });
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

// requestAnimationFrame схлопывает быструю серию кликов в один рендер –
// та же причина и тот же приём, что у bindNowModeToggle() в js/now.js
// (см. её же подробный комментарий там): без этого несколько
// перестроений всех карточек подряд копились в одной синхронной
// очереди JS и ощущались как зависание списка на быстром переключении.
let favRenderRaf = null;
function bindFavModeToggle() {
  document.querySelectorAll("#tab-favorites .tl-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === favState.mode) return;
      favState.mode = btn.dataset.mode;
      document.querySelectorAll("#tab-favorites .tl-mode-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === favState.mode);
      });
      if (favRenderRaf) cancelAnimationFrame(favRenderRaf);
      favRenderRaf = requestAnimationFrame(() => {
        favRenderRaf = null;
        renderFavModeBody();
      });
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

  return `<div class="review-card-wrap" data-review-id="${editId}" style="animation-delay:${Math.min(index * 25, 600)}ms">
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

  return `<div class="card card-char" data-fav-id="${r.id}"
      style="animation-delay:${Math.min(index * 25, 500)}ms">
    <img src="${esc(img)}" alt="${esc(r.name)}" loading="lazy" ${imgFallbackAttrs(r.image, r.image_backup, PH_SQ)}>
    <div class="card-body">
      <div class="card-title">${esc(r.name)}</div>
      ${sub}
    </div>
  </div>`;
}

// ── Модалка персонажа/персоны («анкета» из favorites-edit.js: био,
// пол, цитаты, свои поля, галерея картинок и привязанные тайтлы) –
// та же панель, что и у модалки отзыва (см. её же классы
// review-modal-* в index.html), отдельный оверлей #fav-modal-overlay.
let _favModalOpener = null;
let _favModalEntry = null;

function openFavPersonModal(entry) {
  const overlay = document.getElementById("fav-modal-overlay");
  if (!overlay) return;
  _favModalOpener = document.activeElement;
  _favModalEntry = entry;
  document.getElementById("fav-modal-body").innerHTML = favPersonModalBodyHtml(entry);
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  overlay.querySelector(".review-modal-panel")?.focus();
}

function closeFavPersonModal() {
  const overlay = document.getElementById("fav-modal-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  _favModalOpener?.focus?.();
  _favModalOpener = null;
  _favModalEntry = null;
}

// Все картинки, когда-либо привязанные к записи – та же логика, что у
// reviewCoverGalleryImages() в reviews.js.
function favPersonGalleryImages(r) {
  if (r.image_gallery?.length) return r.image_gallery;
  return r.image_backup ? [r.image_backup] : [];
}

function openFavPersonGallery() {
  const r = _favModalEntry;
  if (!r) return;
  const images = favPersonGalleryImages(r);
  if (!images.length) return;
  openGalleryModal({
    images,
    active: r.image_backup || r.image || null,
    canEdit: isAdmin(),
    onSelect: async (url) => {
      r.image = null;
      r.image_backup = url;
      await persistFavPersonChange(r);
    },
    onDelete: async (url) => {
      await deleteMediaFile(url);
      r.image_gallery = images.filter((u) => u !== url);
      if ((r.image_backup || r.image) === url) {
        r.image_backup = r.image_gallery[0] || null;
        r.image = null;
      }
      await persistFavPersonChange(r);
    },
  });
}

async function persistFavPersonChange(r) {
  await fetch("/api/save-favorite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...r, _editId: r.id }),
  });
  favLastSnapshot = null;
  document.getElementById("fav-modal-body").innerHTML = favPersonModalBodyHtml(r);
  refreshOpenReviewsTab();
}

// Карточки привязанных тайтлов – по id из reviews.json (linked_review_ids),
// те же данные, что уже лежат в cache.reviews (см. её же fetchReviews()
// в config.js), запрашивать их отдельно незачем.
function favPersonLinkedTitlesHtml(r) {
  const ids = r.linked_review_ids || [];
  if (!ids.length) return "";
  // .map() по ids, а не .filter() по cache.reviews – порядок карточек
  // должен идти по порядку, в котором тайтлы привязали (и можно
  // перетащить в редакторе, см. renderLinkedTitles), а не по тому, в
  // каком они просто лежат в общем списке отзывов.
  const reviews = ids.map((id) => (cache.reviews || []).find((rv) => rv.id === id)).filter(Boolean);
  if (!reviews.length) return "";
  return `
    <div class="fav-modal-titles-title">${i18n("Тайтлы")}</div>
    <div class="grid-now fav-modal-titles-grid">${reviews.map((rv, i) => favTitleCard(rv, i)).join("")}</div>
  `;
}

// Карточки привязанных СУЩНОСТЕЙ «Любимого» (linked_favorite_ids) – в
// отличие от тайтлов это не всегда отзывы: сэйю ↔ персонаж, персонаж ↔
// автор, что угодно из любого раздела, включая свои. Группируем по
// типу целевой записи – один заголовок-раздел на группу, тем же
// порядком, в каком группы впервые встретились в linked_favorite_ids
// (сам он этим же порядком собирается в редакторе, см.
// renderLinkedFavoriteGroups в favorites-edit.js).
function favLinkedFavoritesHtml(r) {
  const ids = r.linked_favorite_ids || [];
  if (!ids.length) return "";
  const favData = favExportData?.favData || [];
  const entries = ids.map((id) => favData.find((e) => e.id === id)).filter(Boolean);
  if (!entries.length) return "";

  const groups = [];
  for (const e of entries) {
    let g = groups.find((x) => x.type === e.type);
    if (!g) {
      g = { type: e.type, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }

  const overrides = window.SITE_LABEL_OVERRIDES?.favTypes || {};
  const labelFor = (type) => {
    if (type === "character") return overrides.character || i18n("Персонажи");
    if (type === "person") return overrides.person || i18n("Персоны");
    return (favCustomCollections().find((c) => c.id === type) || {}).label || type;
  };

  return groups
    .map(
      (g) => `
    <div class="fav-modal-titles-title">${esc(labelFor(g.type))}</div>
    <div class="grid-chars fav-modal-titles-grid">${g.items.map((e, i) => favPersonCard(e, i)).join("")}</div>
  `
    )
    .join("");
}

function favPersonModalBodyHtml(r) {
  const subLine = r.type === "person"
    ? (SUBTYPE_LABELS[r.subtype] || i18n("Персона"))
    : (r.from || "");

  const p = r.profile || {};
  const bioHtml = p.bio
    ? `<div class="review-modal-fulltext">${esc(p.bio).split("\n").map((line) => (line ? `<p>${line}</p>` : "")).join("")}</div>`
    : "";
  const quotesHtml = p.quotes?.length
    ? `<div class="fav-modal-quotes">${p.quotes.map((q) => `<p class="fav-modal-quote">«${esc(q)}»</p>`).join("")}</div>`
    : "";
  const factRows = [];
  if (p.gender) factRows.push({ label: i18n("Пол"), value: p.gender });
  (p.custom || []).forEach((f) => {
    if (f.label || f.value) factRows.push({ label: f.label, value: f.value });
  });
  const factsHtml = factRows.length
    ? `<div class="fav-modal-facts">${factRows.map((f) => `<div class="fav-modal-fact"><span>${esc(f.label)}</span>${esc(f.value)}</div>`).join("")}</div>`
    : "";

  const galleryImgs = favPersonGalleryImages(r);
  const imgClickable = galleryImgs.length
    ? ` class="review-modal-cover has-gallery" onclick="openFavPersonGallery()" title="${i18n("Все картинки ({v0})", { v0: galleryImgs.length })}"`
    : ` class="review-modal-cover"`;

  const editBtn = isAdmin()
    ? `<a href="#/favorites-edit?edit=${r.id}" class="icon-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  return `
    <div class="fav-modal-actions">
      ${cameraButton("favPersonExport()", "fav-person-export-btn")}
      ${editBtn}
      <button type="button" class="icon-btn" title="${i18n("Закрыть")}" onclick="closeFavPersonModal()">✕</button>
    </div>
    <div id="fav-modal-capture">
      <div class="review-modal-header">
        <img src="${esc(r.image || r.image_backup || PH_SQ)}" alt="${esc(r.name)}"${imgClickable} ${imgFallbackAttrs(r.image, r.image_backup, PH_SQ)}>
        <div>
          <div class="review-modal-title" id="fav-modal-title">${esc(r.name)}</div>
          ${subLine ? `<div class="review-meta-row"><span class="review-format">${esc(subLine)}</span></div>` : ""}
        </div>
      </div>
      ${bioHtml}
      ${quotesHtml}
      ${factsHtml}
      ${favPersonLinkedTitlesHtml(r)}
      ${favLinkedFavoritesHtml(r)}
    </div>
  `;
}

// Снимок анкеты картинкой – тот же приём, что у reviewExport() в
// reviews.js (см. её же подробный комментарий там): кнопка сама
// вынесена ИЗ #fav-modal-capture, иначе попала бы на собственный же
// снимок.
async function favPersonExport() {
  const btn = document.getElementById("fav-person-export-btn");
  const el = document.getElementById("fav-modal-capture");
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
          clonedDoc.documentElement.setAttribute(
            "data-skin",
            document.documentElement.getAttribute("data-skin") || ""
          );
        },
      }),
      captureTimeoutMs(imgs.length),
      i18n("Не удалось создать картинку за разумное время.")
    );

    const link = document.createElement("a");
    const safeName =
      (_favModalEntry?.name || "favorite").replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, "").trim() ||
      "favorite";
    link.download = `${safeName}.png`;
    link.href = canvas.toDataURL("image/png");
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

document.addEventListener("DOMContentLoaded", () => {
  const overlay = document.getElementById("fav-modal-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeFavPersonModal();
      return;
    }
    // Привязанные тайтлы (favPersonLinkedTitlesHtml) – те же карточки
    // .review-card-wrap, что и на вкладке «Тайтлы», но здесь, внутри
    // ЭТОЙ модалки, их не достаёт делегирование favBindCardClicks()
    // (оно слушает #fav-mode-body, а не #fav-modal-body) – своё, только
    // на открытие модалки отзыва поверх уже открытой. Саму эту модалку
    // закрываем первой – оба оверлея с одним z-index, поверх были бы
    // видны в порядке их разметки, а не открытия.
    if (e.target.closest(".review-edit-btn")) return;
    const titleWrap = e.target.closest(".review-card-wrap");
    if (titleWrap) {
      const id = titleWrap.dataset.reviewId;
      const review = (cache.reviews || []).find((r) => String(r.id ?? encodeURIComponent(r.title)) === id);
      if (review) {
        closeFavPersonModal();
        openReviewModal(review);
      }
      return;
    }
    // Привязанные сущности «Любимого» (favLinkedFavoritesHtml) – те же
    // карточки .card-char, что и на самих вкладках «Персонажи»/«Персоны»
    // (favBindCardClicks слушает #fav-mode-body, сюда не достаёт) –
    // открывают модалку ДРУГОЙ записи поверх этой же, по той же причине
    // сперва закрывая текущую (см. комментарий про z-index выше).
    const charCard = e.target.closest(".card-char[data-fav-id]");
    if (charCard) {
      const id = charCard.dataset.favId;
      const entry = (favExportData?.favData || []).find((r) => String(r.id) === id);
      if (entry) {
        closeFavPersonModal();
        openFavPersonModal(entry);
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("hidden") && e.key === "Escape") closeFavPersonModal();
  });
});

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
    // бесконечно; forceLoadImagesForExport (js/utils.js) запускает
    // загрузку сразу и не виснет насовсем, если что-то не ответит.
    await forceLoadImagesForExport(imgs);

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
      captureTimeoutMs(imgs.length),
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
