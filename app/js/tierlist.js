// ══════════════════════════════════════════════
//  TIERLIST — вкладка Тир-лист
//  Режим "Тайтлы" — из reviews.json по оценкам
//  Режим "Персонажи" — из characters-tier.json
//  Зависит от: config.js, api.js, cards.js
// ══════════════════════════════════════════════

// Здесь раньше лежал жёсткий список типов. Из-за него в фильтрах
// висели «Ранобэ» и «Маньхуа», даже когда с такой оценкой ничего не
// было, — кнопка открывала заведомо пустой тир-лист. Теперь типы
// берутся из самих данных, как это давно сделано на вкладке «Отзывы»,
// а здесь остаётся только желаемый порядок: знакомые типы идут в
// привычной последовательности, новые (в том числе добавленные через
// настройки) — следом, по алфавиту.
const TL_TYPE_ORDER = [
  "anime", "manga", "manhwa", "manhua", "novel",
  "movie", "show", "dorama", "book", "game", "gacha",
];

function tlInferType(r) { return r.type || "anime"; }
function tlTypeLabel(type) { return TYPE_LABELS[type] || type || "—"; }

// Высота постеров персонажей — сохраняется между переключениями
let tlCharHeight = parseInt(localStorage.getItem("tl-char-height") || "200");

const tlState = {
  mode:        "titles",
  filter:      "all",
  yearFilter:  "all",
  gameId:      null,
  listId:      null,
  items:       [],
  collections: {}, // { [collectionId]: { games: [...], loaded: bool } }
  loaded:      false,
};

// Список коллекций (кроме "Тайтлы") — по умолчанию только встроенная
// "Персонажи", остальное настраивается в /settings-edit.
function activeTierCollections() {
  const configured = window.SITE_TIER_COLLECTIONS;
  // Именно Array.isArray, а не проверка длины: пустой список означает,
  // что все коллекции удалили, и подставлять взамен встроенную нельзя —
  // она бы возвращалась сама после каждого удаления.
  return Array.isArray(configured) ? configured : [{ id: "characters", label: i18n("Персонажи") }];
}

// Коллекции, у которых снята галочка в настройках, в переключатель не
// попадают. Список для подписей и файлов остаётся полным: скрытая
// коллекция всё ещё может оказаться текущим режимом.
function visibleTierCollections() {
  return activeTierCollections().filter(c => isTierModeVisible(c.id));
}

function collectionFileFor(id) {
  return id === "characters" ? "characters-tier.json" : `tier-${id}.json`;
}

// ── Модалка: новый тир-лист (коллекция) — только для админа ────
function tlSlugify(name) {
  return name.toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) + "-" + Date.now().toString(36).slice(-4);
}

function openCollectionModal() {
  document.getElementById("cm-collection-name").value = "";
  const statusEl = document.getElementById("collection-modal-status");
  statusEl.textContent = "";
  statusEl.className = "status-msg";
  document.getElementById("collection-modal-overlay").classList.remove("hidden");
}
function closeCollectionModal() {
  document.getElementById("collection-modal-overlay").classList.add("hidden");
}
function closeCollectionModalOnOverlay(e) {
  if (e.target === document.getElementById("collection-modal-overlay")) closeCollectionModal();
}

async function submitNewCollection() {
  const name = document.getElementById("cm-collection-name").value.trim();
  const statusEl = document.getElementById("collection-modal-status");
  if (!name) { statusEl.textContent = i18n("Введи название"); statusEl.className = "status-msg err"; return; }

  const newCollection = { id: tlSlugify(name), label: name };
  const btn = document.getElementById("cm-collection-save");
  btn.disabled = true;
  statusEl.textContent = i18n("Сохраняем…");
  statusEl.className = "status-msg";
  try {
    await patchSiteSettings((settings) => {
      settings.tierCollections = Array.isArray(settings.tierCollections)
        ? settings.tierCollections
        : activeTierCollections(); // сохраняем встроенную i18n("Персонажи"), если настроек ещё не было
      settings.tierCollections.push(newCollection);
    });
    window.SITE_TIER_COLLECTIONS = (Array.isArray(window.SITE_TIER_COLLECTIONS)
      ? window.SITE_TIER_COLLECTIONS
      : activeTierCollections()).concat([newCollection]);
    closeCollectionModal();
    tlState.mode = newCollection.id;
    tlState.gameId = null;
    tlState.listId = null;
    const box = document.getElementById("tab-tierlist");
    box.innerHTML = tlModeToggleHtml()
      + `<div class="state-box"><div class="spinner"></div>Загружаем «${esc(name)}»…</div>`;
    await loadCharGames(newCollection.id);
    tlRender();
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg err";
  } finally {
    btn.disabled = false;
  }
}

async function loadTierlist() {
  if (loading.tierlist) return;
  loading.tierlist = true;
  const box = document.getElementById("tab-tierlist");
  try {
    if (!tlState.loaded) {
      box.innerHTML = `<div class="state-box"><div class="spinner"></div>${i18n("Загружаем…")}</div>`;
      await fetchReviews();
      const reviews  = (cache.reviews || []).filter(r => r.grade);
      tlState.items  = reviews.map(r => ({ review: r, poster: r.cover || null, posterBackup: r.cover_backup || null }));
      tlState.loaded = true;
      tlEnsureVisibleMode();
    }
    if (tlState.mode !== "titles" && !tlState.collections[tlState.mode]?.loaded) {
      await loadCharGames(tlState.mode);
    }
    tlRender();
  } catch (err) {
    box.innerHTML = `<div class="state-box">Ошибка: ${esc(err.message)}</div>`;
  } finally {
    loading.tierlist = false;
  }
}

async function loadCharGames(collectionId) {
  const existing = tlState.collections[collectionId];
  if (existing?.loaded) return;

  let games = [];
  try {
    const res = await fetch(collectionFileFor(collectionId));
    if (res.ok) games = await res.json();
  } catch {}

  tlState.collections[collectionId] = { games, loaded: true };

  if (games.length && !tlState.gameId) {
    tlState.gameId = games[0].id;
    tlState.listId = games[0].tierlists?.[0]?.id || null;
  }
}

function tlRender() {
  const box = document.getElementById("tab-tierlist");
  box.innerHTML = tlModeToggleHtml()
    + (tlState.mode === "titles" ? tlTitlesHtml() : tlCharsHtml(tlState.mode));
  tlBindAll();
}

function tlModeToggleHtml() {
  // c.label || c.id — как в tlCharsHtml и в обработчике переключения
  // чуть ниже. Коллекция без подписи (запись, пришедшая из чужой
  // резервной копии или поправленная руками в site-settings.json)
  // давала пустую кнопку: нажимать вроде и есть на что, а что это —
  // непонятно. Id хотя бы читается.
  const collectionBtns = visibleTierCollections().map(c =>
    `<button class="tl-mode-btn${tlState.mode === c.id ? " active" : ""}" data-mode="${esc(c.id)}">${esc(c.label || c.id)}</button>`
  ).join("");
  const addBtn = isAdmin()
    ? `<button class="tl-mode-add-btn" id="tl-add-collection-btn" type="button" title="${i18n("Новый тир-лист")}">${i18n("Создать")}</button>`
    : "";
  const titlesBtn = isTierModeVisible("titles")
    ? `<button class="tl-mode-btn${tlState.mode === "titles" ? " active" : ""}" data-mode="titles">${esc(siteLabel("sections", "tierTitles", i18n("Тайтлы")))}</button>`
    : "";
  return `<div class="tl-mode-toggle">
    ${titlesBtn}
    ${collectionBtns}
    ${addBtn}
  </div>`;
}

// Если режим "Тайтлы" скрыт в настройках, а текущий/дефолтный режим
// как раз он — переключаемся на первую доступную коллекцию, иначе
// вкладка откроется на кнопке, которой нет.
function tlEnsureVisibleMode() {
  if (isTierModeVisible(tlState.mode)) return;
  const first = visibleTierCollections()[0];
  if (first) tlState.mode = first.id;
  else if (isTierModeVisible("titles")) tlState.mode = "titles";
}

// ══ РЕЖИМ ТАЙТЛОВ ═════════════════════════════

function tlTitlesHtml() {
  const byType = tlState.filter === "all"
    ? tlState.items
    : tlState.items.filter(item => tlInferType(item.review) === tlState.filter);

  const filtered = tlState.yearFilter === "all"
    ? byType
    : byType.filter(item => String(statsCompletedYear(item.review) || "") === String(tlState.yearFilter));

  const byGrade = {};
  for (const item of filtered) {
    const g = gradeToShelf(item.review.grade);
    if (!byGrade[g]) byGrade[g] = [];
    byGrade[g].push(item);
  }

  const hasAny = TIER_ROWS.some(t => byGrade[t.key]?.length);
  let html = tlFiltersHtml() + tlYearFiltersHtml(byType);

  if (!hasAny) {
    return html + `<div class="state-box" style="padding-top:2rem">${i18n("Ничего не найдено")}</div>`;
  }

  html += `<div class="tl-rows" id="tl-titles-rows">`;
  for (let ti = 0; ti < TIER_ROWS.length; ti++) {
    const tier  = TIER_ROWS[ti];
    const items = byGrade[tier.key] || [];

    html += `<div class="tl-row" style="--tl-color:${tier.color};animation-delay:${ti * 50}ms">
      <div class="tl-label">
        <div class="tl-label-dot"></div>
        <div class="tl-label-name">${esc(tier.label)}</div>
        ${items.length ? `<div class="tl-label-count">${items.length}</div>` : ""}
      </div>
      <div class="tl-cards">`;

    if (!items.length) {
      html += `<div class="tl-empty">—</div>`;
    } else {
      for (let i = 0; i < items.length; i++) {
        const { review: r, poster, posterBackup } = items[i];
        const placeholder = imagePlaceholder(72, 108, r.title.slice(0, 2));
        const src = poster || posterBackup || placeholder;
        html += `<div class="tl-poster"
            data-tl-title="${esc(r.title)}"
            data-tl-grade="${esc(tier.label)}"
            data-tl-color="${esc(tier.color)}"
            data-tl-desc="${esc(GRADES[tier.key]?.desc || "")}"
            data-tl-year="${esc(String(r.year || ""))}"
            data-tl-type="${esc(tlTypeLabel(tlInferType(r)))}"
            style="animation-delay:${Math.min(i * 18, 400)}ms">
          <img src="${esc(src)}" alt="${esc(r.title)}" loading="lazy"
            ${imgFallbackAttrs(poster, posterBackup, placeholder)}>
        </div>`;
      }
    }
    html += `</div></div>`;
  }
  html += `</div>` + tlTooltipHtml();

  return html;
}

// Типы, которые реально встречаются среди оценённого. Подписи берём из
// TYPE_LABELS, поэтому переименование типа в настройках подхватывается
// здесь само, как и появление нового.
function tlPresentTypes() {
  const present = [...new Set(tlState.items.map((item) => tlInferType(item.review)))];
  const known = TL_TYPE_ORDER.filter((t) => present.includes(t));
  const rest = present
    .filter((t) => !TL_TYPE_ORDER.includes(t))
    .sort((a, b) => tlTypeLabel(a).localeCompare(tlTypeLabel(b), "ru"));
  return [...known, ...rest];
}

function tlFiltersHtml() {
  const types = tlPresentTypes();

  // Один-единственный тип — выбирать не из чего, панель только мешает
  if (types.length < 2) return "";

  const all = siteLabel("filters", "all", i18n("Всё"));
  const btns = [["all", all], ...types.map((t) => [t, tlTypeLabel(t)])]
    .map(
      ([val, label]) =>
        `<button class="tl-filter${tlState.filter === val ? " active" : ""}" data-tl-type="${esc(val)}">${esc(label)}</button>`
    )
    .join("");
  return `<div class="tl-filters">${btns}</div>`;
}

function tlYearFiltersHtml(itemsForYearScope) {
  const years = [...new Set(
    itemsForYearScope.map(item => statsCompletedYear(item.review)).filter(Boolean)
  )].sort((a, b) => b - a);

  if (!years.length) return "";

  const options = [`<option value="all">${i18n("Все года")}</option>`]
    .concat(years.map(y =>
      `<option value="${y}"${String(tlState.yearFilter) === String(y) ? " selected" : ""}>${y}</option>`
    )).join("");

  return `<div class="tl-year-select-wrap">
    <select class="tl-year-select" id="tl-year-select">${options}</select>
  </div>`;
}

// ══ РЕЖИМ ПЕРСОНАЖЕЙ ══════════════════════════

function tlCharsHtml(collectionId) {
  const collectionLabel = activeTierCollections().find(c => c.id === collectionId)?.label || collectionId;
  const state = tlState.collections[collectionId];

  if (!state?.loaded) {
    return `<div class="state-box"><div class="spinner"></div>Загружаем «${esc(collectionLabel)}»…</div>`;
  }
  if (!state.games.length) {
    // Кнопка редактора есть не всегда, а тире стояло всегда — у гостя
    // на пустой коллекции висело «Нет данных —» с висячим прочерком.
    const adminBtn = isAdmin()
      ? `<div style="margin-top:1.5rem"><a href="#/chars-edit?collection=${esc(collectionId)}" class="admin-add-btn">${i18n("Редактор")}</a></div>`
      : "";
    return `<div class="state-box" style="padding-top:2rem">${esc(siteLabel("empty", "search", i18n("Ничего не найдено")))}${adminBtn}</div>`;
  }

  const games = state.games;
  const game = games.find(g => g.id === tlState.gameId) || games[0];
  // ?? [] — файл коллекции открытый и правится руками (см. README), а
  // ещё приезжает из чужих резервных копий: запись без tierlists роняла
  // всю вкладку, вместо того чтобы просто показать пустую коллекцию.
  const lists = Array.isArray(game.tierlists) ? game.tierlists : [];
  const list = lists.find(l => l.id === tlState.listId) || lists[0];

  const gameButtons = games.map(g =>
    `<button class="tl-filter${g.id === game.id ? " active" : ""}" data-char-game="${esc(g.id)}">${esc(g.title)}</button>`
  ).join("");

  const listButtons = lists.length > 1
    ? `<div class="tl-char-lists">
        ${lists.map(l =>
          `<button class="tl-list-btn${l.id === list?.id ? " active" : ""}" data-char-list="${esc(l.id)}">${esc(l.label)}</button>`
        ).join("")}
      </div>`
    : "";

  // list может не быть вовсе — у записи без tierlists (см. выше).
  const tiers = Array.isArray(list?.tiers) ? list.tiers : [];
  let tiersHtml = `<div class="tl-rows" id="tl-chars-rows">`;
  for (let ti = 0; ti < tiers.length; ti++) {
    const tier  = tiers[ti];
    const chars = tier.chars || [];

    tiersHtml += `<div class="tl-row" style="--tl-color:${esc(tier.color)};animation-delay:${ti * 50}ms">
      <div class="tl-label">
        <div class="tl-label-dot"></div>
        <div class="tl-label-name">${esc(tier.name)}</div>
        ${chars.length ? `<div class="tl-label-count">${chars.length}</div>` : ""}
      </div>
      <div class="tl-cards">`;

    if (!chars.length) {
      tiersHtml += `<div class="tl-empty">—</div>`;
    } else {
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        tiersHtml += `<div class="tl-char-poster"
            data-tl-title="${esc(ch.name)}"
            data-tl-grade="${esc(tier.name)}"
            data-tl-color="${esc(tier.color)}"
            data-tl-desc=""
            data-tl-year=""
            data-tl-type="${esc(game.title)}"
            style="height:${tlCharHeight}px;animation-delay:${Math.min(i * 18, 400)}ms">
          <img src="${esc(ch.img || ch.img_backup || "")}" alt="${esc(ch.name)}" loading="lazy"
            ${imgFallbackAttrs(ch.img, ch.img_backup, imagePlaceholder(100, 150))}>
        </div>`;
      }
    }
    tiersHtml += `</div></div>`;
  }
  tiersHtml += `</div>`;

  const adminBtn = isAdmin()
    ? `<a href="#/chars-edit?collection=${esc(collectionId)}" class="admin-add-btn">${i18n("Редактор")}</a>`
    : "";

  const exportBtn = `<button class="admin-add-btn" id="tl-export-btn" onclick="tlExport('tl-chars-rows', '${esc(game.title)}')">${i18n("Сохранить как картинку")}</button>`;

  // Ползунок размера — теперь до 1000px
  const slider = `<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1.2rem">
    <span style="font-family:'DM Sans',sans-serif;font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);flex-shrink:0">${i18n("Размер")}</span>
    <input type="range" min="80" max="1000" value="${tlCharHeight}" step="10"
      id="tl-char-size-slider"
      style="flex:1;max-width:200px;accent-color:var(--red);cursor:pointer">
    <span id="tl-char-size-val" style="font-family:'DM Sans',sans-serif;font-size:.65rem;color:var(--text-dim);min-width:42px">${tlCharHeight}px</span>
  </div>`;

  return `<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.5rem;flex-wrap:wrap">
    <div class="tl-filters" style="margin-bottom:0">${gameButtons}</div>
    <div style="display:flex;gap:.5rem;flex-shrink:0">${adminBtn}${exportBtn}</div>
  </div>
  ${listButtons}
  ${slider}
  ${tiersHtml}
  ${tlTooltipHtml()}`;
}

// ── Тултип ─────────────────────────────────────
function tlTooltipHtml() {
  return `<div class="tl-tooltip" id="tl-tooltip">
    <div class="tl-tt-title" id="tl-tt-title"></div>
    <div class="tl-tt-grade" id="tl-tt-grade"></div>
    <div class="tl-tt-desc"  id="tl-tt-desc"></div>
    <div class="tl-tt-meta"  id="tl-tt-meta"></div>
  </div>`;
}

// ── Бинды ──────────────────────────────────────
function tlBindAll() {
  const addBtn = document.getElementById("tl-add-collection-btn");
  if (addBtn) addBtn.addEventListener("click", openCollectionModal);

  document.querySelectorAll(".tl-mode-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const newMode = btn.dataset.mode;
      if (newMode !== "titles" && !tlState.collections[newMode]?.loaded) {
        const label = activeTierCollections().find(c => c.id === newMode)?.label || newMode;
        tlState.mode = newMode;
        tlState.gameId = null;
        tlState.listId = null;
        const box = document.getElementById("tab-tierlist");
        box.innerHTML = tlModeToggleHtml()
          + `<div class="state-box"><div class="spinner"></div>Загружаем «${esc(label)}»…</div>`;
        await loadCharGames(newMode);
      } else {
        tlState.mode = newMode;
      }
      tlRender();
    });
  });

  document.querySelectorAll(".tl-filter[data-tl-type]").forEach(btn => {
    btn.addEventListener("click", () => {
      tlState.filter = btn.dataset.tlType;
      tlState.yearFilter = "all"; // при смене типа список годов меняется — сбрасываем
      tlRender();
    });
  });

  const yearSelect = document.getElementById("tl-year-select");
  if (yearSelect) {
    yearSelect.addEventListener("change", () => {
      tlState.yearFilter = yearSelect.value;
      tlRender();
    });
  }

  document.querySelectorAll("[data-char-game]").forEach(btn => {
    btn.addEventListener("click", () => {
      tlState.gameId = btn.dataset.charGame;
      const games = tlState.collections[tlState.mode]?.games || [];
      const game = games.find(g => g.id === tlState.gameId);
      tlState.listId = game?.tierlists?.[0]?.id || null;
      tlRender();
    });
  });

  document.querySelectorAll("[data-char-list]").forEach(btn => {
    btn.addEventListener("click", () => {
      tlState.listId = btn.dataset.charList;
      tlRender();
    });
  });

  // Ползунок размера
  const slider = document.getElementById("tl-char-size-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      tlCharHeight = parseInt(slider.value);
      localStorage.setItem("tl-char-height", tlCharHeight);
      document.getElementById("tl-char-size-val").textContent = tlCharHeight + "px";
      document.querySelectorAll(".tl-char-poster").forEach(el => {
        el.style.height = tlCharHeight + "px";
      });
    });
  }

  tlBindTooltip();
}

function tlBindTooltip() {
  const tip = document.getElementById("tl-tooltip");
  if (!tip) return;

  document.querySelectorAll(".tl-poster, .tl-char-poster").forEach(card => {
    card.addEventListener("mouseenter", e => { tlShowTip(card, tip); tlMoveTip(e, tip); });
    card.addEventListener("mousemove",  e => tlMoveTip(e, tip));
    card.addEventListener("mouseleave", () => tip.classList.remove("visible"));

    card.addEventListener("touchstart", e => {
      e.preventDefault();
      const already = tip.classList.contains("visible") && tip.dataset.activeCard === card.dataset.tlTitle;
      tip.classList.remove("visible");
      if (!already) {
        tlShowTip(card, tip);
        tip.dataset.activeCard = card.dataset.tlTitle;
        const rect = card.getBoundingClientRect();
        let x = rect.left + rect.width / 2 - 110;
        let y = rect.top - (tip.offsetHeight || 110) - 8;
        x = Math.max(8, Math.min(x, window.innerWidth - 228));
        y = y < 8 ? rect.bottom + 8 : y;
        tip.style.left     = x + "px";
        tip.style.top      = (y + window.scrollY) + "px";
        tip.style.position = "absolute";
      }
    }, { passive: false });
  });

  document.addEventListener("touchstart", e => {
    if (!e.target.closest(".tl-poster") && !e.target.closest(".tl-char-poster") && !e.target.closest(".tl-tooltip")) {
      tip.classList.remove("visible");
    }
  });
}

function tlShowTip(card, tip) {
  document.getElementById("tl-tt-title").textContent = card.dataset.tlTitle;
  document.getElementById("tl-tt-grade").textContent = card.dataset.tlGrade;
  document.getElementById("tl-tt-grade").style.color = card.dataset.tlColor;
  document.getElementById("tl-tt-desc").textContent  = card.dataset.tlDesc;
  const meta = [card.dataset.tlType, card.dataset.tlYear].filter(Boolean).join(" · ");
  document.getElementById("tl-tt-meta").textContent  = meta;
  tip.classList.add("visible");
}

function tlMoveTip(e, tip) {
  const m = 14;
  let x = e.clientX + m, y = e.clientY + m;
  const tw = tip.offsetWidth || 220, th = tip.offsetHeight || 100;
  if (x + tw > window.innerWidth)  x = e.clientX - tw - m;
  if (y + th > window.innerHeight) y = e.clientY - th - m;
  if (x < 4) x = 4;
  if (y < 4) y = 4;
  tip.style.position = "fixed";
  tip.style.left = x + "px";
  tip.style.top  = y + "px";
}

// ══ ЭКСПОРТ ТИР-ЛИСТА ПЕРСОНАЖЕЙ В КАРТИНКУ ══════════════

async function tlExport(rowsId, label) {
  const btn = document.getElementById("tl-export-btn");
  if (btn) { btn.textContent = i18n("⏳ Создаём…"); btn.disabled = true; }

  const tip = document.getElementById("tl-tooltip");
  if (tip) tip.style.visibility = "hidden";

  let animated = [];
  let prevAnimation = [];
  let restoreImages = () => {};

  try {
    const rows = document.getElementById(rowsId);
    if (!rows) throw new Error(i18n("Тир-лист не найден"));

    if (typeof html2canvas === "undefined") {
      if (btn) btn.textContent = i18n("⏳ Загружаем библиотеку…");
      await loadHtml2Canvas();
      if (btn) btn.textContent = i18n("⏳ Создаём…");
    }

    const imgs = Array.from(rows.querySelectorAll("img"));
    await Promise.all(imgs.map(img =>
      img.complete ? Promise.resolve() : new Promise(res => {
        img.onload = img.onerror = res;
      })
    ));

    restoreImages = await proxyImagesToDataUrls(rows);

    animated = Array.from(rows.querySelectorAll(".tl-row, .tl-poster, .tl-char-poster"));
    prevAnimation = animated.map(el => el.style.animation);
    animated.forEach(el => { el.style.animation = "none"; });
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

    const canvas = await html2canvas(rows, {
      backgroundColor: "#0a0a0c",
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
    });

    const link = document.createElement("a");
    const safeName = label.replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, "").trim() || "tierlist";
    link.download = `${safeName}-tierlist.png`;
    link.href = canvas.toDataURL("image/png");
    // Ссылку обязательно вставить в документ, а не кликать по висящей в
    // воздухе. На телефоне <a download> не скачивает ничего, поэтому
    // нажатие перехватывает mobile/src/main.js — одним слушателем на
    // document. До document событие доходит только от элемента, который
    // в документе и находится: клик по неприсоединённой ссылке всплывать
    // некуда, перехват не срабатывал, и «Сохранить как картинку» на
    // Android молча не делало ничего.
    document.body.appendChild(link);
    link.click();
    link.remove();

  } catch (err) {
    alert("Не удалось создать картинку 😢\n" + err.message);
  } finally {
    restoreImages();
    animated.forEach((el, i) => { el.style.animation = prevAnimation[i]; });
    if (tip) tip.style.visibility = "";
    if (btn) { btn.textContent = i18n("Сохранить как картинку"); btn.disabled = false; }
  }
}
