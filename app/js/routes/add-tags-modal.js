// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.
//
// ── Теги и категории ───────────────────────────
// Две части, по частоте дела:
//
//   1. Создать тег прямо из поиска «Найти или создать тег» в разделе
//      «Теги» редактора: такого тега нет – под полем чипы категорий,
//      клик создаёт тег и сразу отмечает его у отзыва (Enter – в первую
//      категорию); там же «+ новая категория». Это самое частое действие
//      – раньше ради него открывалось окно с формой из трёх полей.
//   2. Окно «Теги и категории» (кнопка «Управлять тегами»): все теги
//      чипами по категориям, у каждого – в скольких отзывах он стоит; клик
//      по тегу – правка прямо под его категорией, ✎ у категории – её имя,
//      цвет и удаление; «Выбрать несколько» – массовое удаление (с кнопкой
//      «Выбрать неиспользуемые»).
//
// Раньше это было окно 520px с вкладками «Тег / Категория», списком в
// прокрутке на 260px, и две кнопки в редакторе («Новый тег», «Все теги»)
// открывали одно и то же. Плюс затемнение было колонкой 860px: на
// оверлее стоял класс страницы .add-view (ради стилей полей), а вместе с
// ним – max-width страницы. Теперь .add-view – на самой панели, ширина и
// поля страницы с неё сняты (index.html, .tm-panel.add-view).
//
// Сохранение (tmSaveTag, tmDeleteTags, tmSaveCategory, tmDeleteCategory)
// не зависит от разметки: встроенные теги и категории лежат в
// js/config.js и из объекта их не вычеркнуть, поэтому удаление встроенного
// тега – запись его имени в settings.hiddenTags, переименование –
// hiddenTags + новая запись в customTags; встроенная категория
// переименовывается через labels.categories, удаляется через
// hiddenCategories. См. BUILTIN_TAG_NAMES / BUILTIN_CAT_KEYS. Отзывы
// хранят теги строками – переименование и удаление правят и reviews.json
// (applyTagToReviews).

// Палитра цветов категории – свой цвет тоже можно (пипетка рядом).
const TM_SWATCHES = ["#8b1a1a", "#c0392b", "#d4a017", "#4a8c5c", "#2e86ab", "#3d5a98", "#7b3fa0", "#a0526d", "#6b6b6b"];

let tmState = tmFreshState();
let tmUsage = {}; // тег → в скольких сохранённых отзывах стоит
let tmCreateNewCat = false; // в строке создания открыта «новая категория»
const tmPickedColor = {}; // выбранный цвет в каждой палитре (по id)

function tmFreshState() {
  return { q: "", editTag: null, editCat: null, newCat: false, bulk: false, picked: new Set(), catDelete: null };
}

// Сброс при открытии другой записи в редакторе (add.js, initAddPage).
function tmResetState() {
  tmState = tmFreshState();
  tmCreateNewCat = false;
}

function tmStatus(text, kind) {
  const el = document.getElementById("tag-modal-status");
  if (!el) return;
  el.textContent = text || "";
  el.className = "status-msg" + (kind ? " " + kind : "");
}

// Цвет приходит из site-settings.json, а подставляется в атрибут style –
// пропускаем только настоящий hex, чтобы туда нельзя было дописать своё.
function tmSafeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : "";
}

// Тег «используется», если стоит хотя бы в одном сохранённом отзыве или
// отмечен в открытом сейчас: только что созданный для этого отзыва тег
// иначе выглядел бы неиспользуемым и ушёл бы под «Выбрать неиспользуемые»
// раньше, чем отзыв сохранят.
function tmIsUsed(name) {
  return (tmUsage[name] || 0) > 0 || selectedTags.has(name);
}

async function tmLoadUsage() {
  try {
    const list = await (await fetch("/reviews.json?_=" + Date.now())).json();
    tmUsage = {};
    for (const r of Array.isArray(list) ? list : []) {
      for (const t of r.tags || []) tmUsage[t] = (tmUsage[t] || 0) + 1;
    }
  } catch {
    // без счётчиков окно всё равно работает – просто без чисел
  }
}

// ── Сохранение ─────────────────────────────────

// Отзывы хранят теги строками, поэтому имя правится ещё и в reviews.json.
// Пустое `to` означает «убрать тег из всех отзывов».
async function applyTagToReviews(from, to) {
  const res = await fetch("/api/save-review", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _rename_tag: { from, to } }),
  });
  if (!res.ok) {
    let message = i18n("Справочник обновлён, но старые отзывы поправить не удалось");
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message);
  }
}

// Новый тег (from = null) или правка существующего (переименование,
// категория, подсказка). Бросает Error с понятным текстом.
async function tmSaveTag({ from = null, name, cat, tip = "" }) {
  name = String(name || "").trim();
  tip = String(tip || "").trim();
  if (!name) throw new Error(i18n("Введите название тега"));
  if (name !== from && Object.keys(TAGS_MAP).some((t) => t.toLowerCase() === name.toLowerCase() && t !== from)) {
    throw new Error(i18n("Такой тег уже есть"));
  }
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    const hidden = new Set(settings.hiddenTags || []);
    if (from) {
      delete settings.customTags[from];
      if (BUILTIN_TAG_NAMES.has(from) && from !== name) hidden.add(from);
    }
    hidden.delete(name);
    settings.customTags[name] = { cat, tip };
    settings.hiddenTags = [...hidden];
  });
  if (from && from !== name) {
    await applyTagToReviews(from, name);
    delete TAGS_MAP[from];
    if (selectedTags.has(from)) {
      selectedTags.delete(from);
      selectedTags.add(name);
    }
    if (featuredCardTags.has(from)) {
      featuredCardTags.delete(from);
      featuredCardTags.add(name);
    }
    if (tmUsage[from] !== undefined) {
      tmUsage[name] = tmUsage[from];
      delete tmUsage[from];
    }
  }
  TAGS_MAP[name] = { cat, tip };
  document.dispatchEvent(new CustomEvent("tags-map-updated"));
}

// Удаляет теги из справочника и из всех отзывов.
async function tmDeleteTags(names, onProgress) {
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    const hidden = new Set(settings.hiddenTags || []);
    names.forEach((name) => {
      delete settings.customTags[name];
      if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
    });
    settings.hiddenTags = [...hidden];
  });
  for (let i = 0; i < names.length; i++) {
    onProgress?.(i + 1, names.length);
    await applyTagToReviews(names[i], "");
    delete TAGS_MAP[names[i]];
    selectedTags.delete(names[i]);
    featuredCardTags.delete(names[i]);
    delete tmUsage[names[i]];
  }
  document.dispatchEvent(new CustomEvent("tags-map-updated"));
}

// Новая категория (key = null) или правка. color = null – без цвета.
// Возвращает ключ категории.
async function tmSaveCategory({ key = null, name, color = null }) {
  name = String(name || "").trim();
  if (!name) throw new Error(i18n("Введите название категории"));
  const safe = tmSafeColor(color);
  const catKey =
    key ||
    "custom_" +
      name
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/gi, "_")
        .slice(0, 30) +
      "_" +
      Date.now().toString(36).slice(-4);
  const builtin = BUILTIN_CAT_KEYS.has(catKey);
  await patchSiteSettings((settings) => {
    settings.customCategories = settings.customCategories || {};
    settings.categoryColors = settings.categoryColors || {};
    if (builtin) {
      // Встроенный ключ переименовывается через общий механизм подписей,
      // тот же, что и у типов/ролей в настройках.
      settings.labels = settings.labels || {};
      settings.labels.categories = settings.labels.categories || {};
      settings.labels.categories[catKey] = name;
    } else {
      settings.customCategories[catKey] = name;
    }
    if (safe) settings.categoryColors[catKey] = safe;
    else delete settings.categoryColors[catKey];
  });
  CAT_LABELS[catKey] = name;
  if (safe) CAT_COLORS[catKey] = safe;
  else delete CAT_COLORS[catKey];
  document.dispatchEvent(new CustomEvent("tags-map-updated"));
  return catKey;
}

// Удаление категории. Если в ней есть теги – либо перенести их в
// moveTo, либо удалить вместе с ними (moveTo = null).
async function tmDeleteCategory(key, { moveTo = null } = {}) {
  const names = Object.keys(TAGS_MAP).filter((n) => TAGS_MAP[n].cat === key);
  if (names.length && moveTo) {
    // Категория у тега (в т.ч. встроенного) переопределяется тем же
    // механизмом, что и правка тега, – записью в customTags по имени.
    await patchSiteSettings((settings) => {
      settings.customTags = settings.customTags || {};
      names.forEach((name) => {
        settings.customTags[name] = { cat: moveTo, tip: TAGS_MAP[name].tip || "" };
      });
    });
    names.forEach((name) => {
      TAGS_MAP[name] = { ...TAGS_MAP[name], cat: moveTo };
    });
  } else if (names.length) {
    await tmDeleteTags(names);
  }
  await patchSiteSettings((settings) => {
    if (settings.customCategories) delete settings.customCategories[key];
    if (settings.categoryColors) delete settings.categoryColors[key];
    const hidden = new Set(settings.hiddenCategories || []);
    if (BUILTIN_CAT_KEYS.has(key)) hidden.add(key);
    settings.hiddenCategories = [...hidden];
    // Переименование встроенной категории живёт в labels.categories –
    // после удаления оно осталось бы висеть мусором.
    if (settings.labels && settings.labels.categories) delete settings.labels.categories[key];
  });
  delete CAT_LABELS[key];
  delete CAT_COLORS[key];
  document.dispatchEvent(new CustomEvent("tags-map-updated"));
}

// ── Палитра ────────────────────────────────────

function tmSwatchesHtml(id, current) {
  tmPickedColor[id] = current || null;
  const custom = current && !TM_SWATCHES.includes(current);
  return `<div class="tm-swatches" data-tm-sw="${id}" role="radiogroup" aria-label="${i18n("Цвет")}">
    ${TM_SWATCHES.map(
      (c) =>
        `<button type="button" class="tm-sw${c === current ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="${c}" aria-pressed="${c === current}"></button>`
    ).join("")}
    <label class="tm-sw tm-sw-custom${custom ? " on" : ""}" title="${i18n("Свой цвет")}"${custom ? ` style="background:${current}"` : ""}><input type="color" value="${custom ? current : "#8b1a1a"}" aria-label="${i18n("Свой цвет")}"></label>
    <button type="button" class="tm-sw tm-sw-none${current ? "" : " on"}" data-c="" title="${i18n("Без цвета")}" aria-label="${i18n("Без цвета")}">⌀</button>
  </div>`;
}

function tmBindSwatches(root) {
  root.querySelectorAll("[data-tm-sw]").forEach((wrap) => {
    const id = wrap.dataset.tmSw;
    const set = (color, el) => {
      tmPickedColor[id] = color || null;
      wrap.querySelectorAll(".tm-sw").forEach((s) => s.classList.toggle("on", s === el));
    };
    wrap.querySelectorAll("button.tm-sw").forEach((b) => b.addEventListener("click", () => set(b.dataset.c, b)));
    const custom = wrap.querySelector(".tm-sw-custom");
    custom.querySelector("input").addEventListener("input", (e) => {
      custom.style.background = e.target.value;
      set(e.target.value, custom);
    });
  });
}

// ── 1. Создание из поиска в редакторе ──────────

function renderTagCreate() {
  const box = document.getElementById("tag-create");
  const input = document.getElementById("tag-q");
  if (!box || !input) return;
  const name = input.value.trim();
  const exists = Object.keys(TAGS_MAP).some((t) => t.toLowerCase() === name.toLowerCase());
  if (!name || exists) {
    box.innerHTML = "";
    tmCreateNewCat = false;
    return;
  }
  const cats = Object.entries(CAT_LABELS);
  // Название тега – жирным внутри переведённой фразы: делим фразу по
  // метке на месте имени, а не ищем имя в готовом тексте.
  const [before, after = ""] = i18n("Тега «{name}» нет – создать в категории:", { name: "\u0001" }).split("\u0001");
  box.innerHTML = `
    <div class="ed-create-label">${esc(before)}<b>${esc(name)}</b>${esc(after)}</div>
    <div class="ed-create-cats">
      ${cats
        .map(
          ([key, label]) =>
            `<button type="button" class="ed-create-cat" data-create-cat="${esc(key)}"><span class="tm-dot" style="background:${tmSafeColor(CAT_COLORS[key]) || "transparent"}"></span>${esc(label)}</button>`
        )
        .join("")}
      <button type="button" class="ed-create-cat ed-create-ghost" id="tag-create-newcat" aria-expanded="${tmCreateNewCat}">${i18n("+ новая категория")}</button>
    </div>
    ${
      tmCreateNewCat
        ? `<div class="ed-create-inline">
            <input type="text" id="tag-create-catname" placeholder="${i18n("Название категории")}" autocomplete="off">
            ${tmSwatchesHtml("create", TM_SWATCHES[0])}
            <button type="button" class="btn-new" id="tag-create-catgo">${i18n("Создать категорию и тег")}</button>
          </div>`
        : ""
    }
    <p class="ed-create-note">${cats.length ? i18n("Тег сразу отметится у этого отзыва. Enter – в первую категорию.") : i18n("Категорий пока нет – заведите первую.")}</p>
    <div class="status-msg" id="tag-create-status"></div>`;
  tmBindSwatches(box);
}

async function tmCreateFromSearch(cat, newCatName) {
  const input = document.getElementById("tag-q");
  const name = input.value.trim();
  const status = document.getElementById("tag-create-status");
  try {
    let key = cat;
    if (newCatName !== undefined) key = await tmSaveCategory({ name: newCatName, color: tmPickedColor.create });
    await tmSaveTag({ name, cat: key });
    selectedTags.add(name);
    markAddDirty();
    input.value = "";
    tmCreateNewCat = false;
    renderTagsGrid();
    renderCardTagsList();
    renderTagCreate();
    input.focus();
  } catch (err) {
    if (status) {
      status.className = "status-msg err";
      status.textContent = err.message || i18n("Ошибка сохранения");
    }
  }
}

function tmBindTagCreate() {
  const box = document.getElementById("tag-create");
  const input = document.getElementById("tag-q");
  input.addEventListener("input", renderTagCreate);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = box.querySelector("[data-create-cat]");
    if (!first) return;
    e.preventDefault();
    tmCreateFromSearch(first.dataset.createCat);
  });
  box.addEventListener("click", (e) => {
    const cat = e.target.closest("[data-create-cat]");
    if (cat) return tmCreateFromSearch(cat.dataset.createCat);
    if (e.target.closest("#tag-create-newcat")) {
      tmCreateNewCat = !tmCreateNewCat;
      renderTagCreate();
      document.getElementById("tag-create-catname")?.focus();
      return;
    }
    if (e.target.closest("#tag-create-catgo")) {
      const catName = document.getElementById("tag-create-catname").value.trim();
      if (!catName) return document.getElementById("tag-create-catname").focus();
      tmCreateFromSearch(null, catName);
    }
  });
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "tag-create-catname") {
      e.preventDefault();
      document.getElementById("tag-create-catgo")?.click();
    }
  });
}

// ── 2. Окно «Теги и категории» ─────────────────

async function openTagModal(opts) {
  tmState = tmFreshState();
  if (opts?.bulk) tmState.bulk = true;
  tmStatus("");
  document.getElementById("tag-modal-overlay").classList.remove("hidden");
  renderTagModal();
  await tmLoadUsage();
  renderTagModal();
  document.getElementById("tm-q")?.focus();
}

function closeTagModal() {
  document.getElementById("tag-modal-overlay")?.classList.add("hidden");
  tmState = tmFreshState();
  renderTagsGrid();
}

function closeTagModalOnOverlay(e) {
  if (e.target === document.getElementById("tag-modal-overlay")) closeTagModal();
}

function tmTagChip(name) {
  const n = tmUsage[name] || 0;
  const cls = [
    "tm-tag",
    tmState.editTag === name ? "active" : "",
    tmState.picked.has(name) ? "picked" : "",
    tmIsUsed(name) ? "" : "unused",
  ]
    .filter(Boolean)
    .join(" ");
  return `<button type="button" class="${cls}" data-tm-tag="${esc(name)}" title="${esc(TAGS_MAP[name]?.tip || "")}" aria-pressed="${tmState.bulk ? tmState.picked.has(name) : tmState.editTag === name}">${
    tmState.bulk ? `<span class="tm-check"></span>` : ""
  }${esc(name)}<span class="tm-n">${n}</span></button>`;
}

function tmTagEditorHtml(name) {
  const info = TAGS_MAP[name] || {};
  const n = tmUsage[name] || 0;
  const usedNote = n
    ? i18n("Стоит в {n} {word} – переименование поправит их все", {
        n,
        word: plural(n, [i18n("отзыве"), i18n("отзывах"), i18n("отзывах")]),
      })
    : selectedTags.has(name)
      ? i18n("Отмечен у этого отзыва")
      : i18n("Пока ни в одном отзыве");
  return `<div class="tm-editor" data-tm-editor="tag">
    <div class="tm-editor-row">
      <label>${i18n("Название")}<input type="text" id="tm-t-name" value="${esc(name)}" autocomplete="off"></label>
      <label>${i18n("Категория")}<div class="select-wrap"><select id="tm-t-cat">${Object.entries(CAT_LABELS)
        .map(([k, l]) => `<option value="${esc(k)}"${k === info.cat ? " selected" : ""}>${esc(l)}</option>`)
        .join("")}</select></div></label>
    </div>
    <label>${i18n("Подсказка – видна при наведении на тег")}<input type="text" id="tm-t-tip" value="${esc(info.tip || "")}" placeholder="${i18n("Что значит этот тег")}" autocomplete="off"></label>
    <div class="tm-editor-foot">
      <span class="tm-dim">${usedNote}</span>
      <button type="button" class="tm-link tm-danger" data-tm-act="tag-delete">${i18n("Удалить")}</button>
      <button type="button" class="tm-link" data-tm-act="tag-cancel">${i18n("Отмена")}</button>
      <button type="button" class="btn-new" data-tm-act="tag-save">${i18n("Сохранить")}</button>
    </div>
  </div>`;
}

function tmCatEditorHtml(key) {
  const isNew = key === null;
  const used = isNew ? 0 : Object.values(TAGS_MAP).filter((t) => t.cat === key).length;
  const choice =
    !isNew && tmState.catDelete === key
      ? `<div class="tm-cat-delete-choice">
          <p class="tm-dim">${i18n("В категории ещё {n} {word}. Перенести их в другую категорию или удалить вместе с категорией?", {
            n: used,
            word: plural(used, [i18n("тег"), i18n("тега"), i18n("тегов")]),
          })}</p>
          <div class="tm-editor-row">
            <label>${i18n("Перенести теги в категорию")}<div class="select-wrap"><select id="tm-c-move">${Object.entries(CAT_LABELS)
              .filter(([k]) => k !== key)
              .map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`)
              .join("")}</select></div></label>
          </div>
          <div class="tm-editor-foot">
            <button type="button" class="tm-link tm-danger" data-tm-act="cat-delete-all">${i18n("Удалить категорию вместе с тегами")}</button>
            <button type="button" class="tm-link" data-tm-act="cat-delete-cancel">${i18n("Отмена")}</button>
            <button type="button" class="btn-new" data-tm-act="cat-delete-move"${Object.keys(CAT_LABELS).length > 1 ? "" : " disabled"}>${i18n("Перенести и удалить категорию")}</button>
          </div>
        </div>`
      : "";
  return `<div class="tm-editor tm-cat-editor" data-tm-editor="cat">
    <label>${isNew ? i18n("Новая категория") : i18n("Название категории")}<input type="text" id="tm-c-name" value="${isNew ? "" : esc(CAT_LABELS[key])}" placeholder="${i18n("Например: Технические детали")}" autocomplete="off"></label>
    <div class="tm-field-label">${i18n("Цвет – им подсвечиваются теги этой категории")}</div>
    ${tmSwatchesHtml("cat", isNew ? TM_SWATCHES[4] : tmSafeColor(CAT_COLORS[key]) || null)}
    ${choice}
    ${
      choice
        ? ""
        : `<div class="tm-editor-foot">
            ${isNew ? "" : `<button type="button" class="tm-link tm-danger" data-tm-act="cat-delete">${i18n("Удалить категорию")}</button>`}
            <button type="button" class="tm-link" data-tm-act="cat-cancel">${i18n("Отмена")}</button>
            <button type="button" class="btn-new" data-tm-act="cat-save">${isNew ? i18n("Создать") : i18n("Сохранить")}</button>
          </div>`
    }
  </div>`;
}

function renderTagModal() {
  const panel = document.querySelector("#tag-modal-overlay .tm-panel");
  if (!panel) return;
  const q = normTagQuery(tmState.q);
  const groups = new Map(Object.keys(CAT_LABELS).map((k) => [k, []]));
  for (const name of Object.keys(TAGS_MAP).sort((a, b) => a.localeCompare(b, "ru"))) {
    if (q && !normTagQuery(name).includes(q)) continue;
    // Тег смотрит на удалённую категорию – показываем его отдельной
    // группой, чтобы он не пропал из списка.
    const cat = TAGS_MAP[name].cat || "";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(name);
  }
  const names = Object.keys(TAGS_MAP);
  const unused = names.filter((t) => !tmIsUsed(t)).length;
  const catCount = Object.keys(CAT_LABELS).length;
  document.getElementById("tm-meta").textContent = [
    `${names.length} ${plural(names.length, [i18n("тег"), i18n("тега"), i18n("тегов")])}`,
    `${catCount} ${plural(catCount, [i18n("категория"), i18n("категории"), i18n("категорий")])}`,
    unused ? i18n("{n} нигде не стоят", { n: unused }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const bulkBtn = document.getElementById("tm-bulk");
  bulkBtn.textContent = tmState.bulk ? i18n("Готово") : i18n("Выбрать несколько");
  bulkBtn.classList.toggle("on", tmState.bulk);
  bulkBtn.setAttribute("aria-pressed", String(tmState.bulk));

  document.getElementById("tm-newcat-box").innerHTML = tmState.newCat ? tmCatEditorHtml(null) : "";

  const shown = [...groups.entries()].filter(([key, tags]) => tags.length || (!q && CAT_LABELS[key] !== undefined));
  document.getElementById("tm-body").innerHTML = shown.length
    ? shown
        .map(([key, tags]) => {
          const color = tmSafeColor(CAT_COLORS[key]);
          const known = CAT_LABELS[key] !== undefined;
          return `<section class="tm-cat" style="--tm-c:${color || "var(--border2)"}">
            <div class="tm-cat-head">
              <span class="tm-dot" style="background:${color || "transparent"}"></span>
              <span class="tm-cat-name">${esc(CAT_LABELS[key] || key || i18n("Без категории"))}</span>
              <span class="tm-dim">${tags.length}</span>
              ${known ? `<button type="button" class="tm-edit" data-tm-cat="${esc(key)}" title="${i18n("Переименовать, цвет, удалить")}" aria-label="${i18n("Изменить категорию")}">✎</button>` : ""}
            </div>
            ${tmState.editCat === key ? tmCatEditorHtml(key) : ""}
            <div class="tm-tags">${tags.map(tmTagChip).join("") || `<span class="tm-dim">${i18n("Тегов нет")}</span>`}</div>
            ${tmState.editTag && tags.includes(tmState.editTag) ? tmTagEditorHtml(tmState.editTag) : ""}
          </section>`;
        })
        .join("")
    : `<p class="tm-dim tm-empty">${q ? i18n("Ничего не найдено") : i18n("Тегов пока нет")}</p>`;

  const bar = document.getElementById("tm-bulkbar");
  bar.classList.toggle("hidden", !tmState.bulk);
  if (tmState.bulk) {
    bar.innerHTML = `<span>${tmState.picked.size ? i18n("Выбрано: {n}", { n: tmState.picked.size }) : i18n("Нажимайте на теги, чтобы выбрать")}</span>
      <button type="button" class="tm-link" data-tm-act="bulk-unused">${i18n("Выбрать неиспользуемые")}</button>
      <button type="button" class="tm-link tm-danger" data-tm-act="bulk-delete"${tmState.picked.size ? "" : " disabled"}>${i18n("Удалить выбранные")}</button>`;
  }
  tmBindSwatches(panel);
}

// После перерисовки – вернуть фокус туда, где человек был.
function tmRerender(focusSelector) {
  renderTagModal();
  if (focusSelector) document.querySelector(`#tag-modal-overlay ${focusSelector}`)?.focus();
}

async function tmRun(btn, fn, okText) {
  if (btn) btn.disabled = true;
  try {
    await fn();
    if (okText) tmStatus(okText, "ok");
    return true;
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
    return false;
  } finally {
    if (btn && document.contains(btn)) btn.disabled = false;
  }
}

async function tmAction(act, btn) {
  const val = (id) => document.getElementById(id)?.value ?? "";
  switch (act) {
    case "tag-cancel":
      tmState.editTag = null;
      return tmRerender();
    case "tag-save": {
      const from = tmState.editTag;
      const name = val("tm-t-name").trim();
      const ok = await tmRun(
        btn,
        () => tmSaveTag({ from, name, cat: val("tm-t-cat"), tip: val("tm-t-tip") }),
        from === name ? i18n("Тег обновлён") : i18n("Тег переименован в «{name}»", { name })
      );
      if (ok) tmState.editTag = null;
      return tmRerender();
    }
    case "tag-delete": {
      const name = tmState.editTag;
      if (!(await confirmDialog(i18n("Удалить тег «{name}»?\n\nОн пропадёт и из уже сохранённых отзывов.", { name })))) return;
      const ok = await tmRun(btn, () => tmDeleteTags([name]), i18n("Тег удалён"));
      if (ok) tmState.editTag = null;
      return tmRerender();
    }
    case "cat-cancel":
      tmState.editCat = null;
      tmState.newCat = false;
      tmState.catDelete = null;
      return tmRerender();
    case "cat-save": {
      const isNew = tmState.newCat;
      const ok = await tmRun(
        btn,
        () => tmSaveCategory({ key: isNew ? null : tmState.editCat, name: val("tm-c-name"), color: tmPickedColor.cat }),
        isNew ? i18n("Категория добавлена") : i18n("Категория обновлена")
      );
      if (ok) {
        tmState.editCat = null;
        tmState.newCat = false;
      }
      return tmRerender();
    }
    case "cat-delete": {
      const key = tmState.editCat;
      const used = Object.values(TAGS_MAP).filter((t) => t.cat === key).length;
      if (used) {
        tmState.catDelete = key;
        return tmRerender();
      }
      if (!(await confirmDialog(i18n("Удалить категорию «{name}»?", { name: CAT_LABELS[key] })))) return;
      if (await tmRun(btn, () => tmDeleteCategory(key), i18n("Категория удалена"))) tmState.editCat = null;
      return tmRerender();
    }
    case "cat-delete-cancel":
      tmState.catDelete = null;
      return tmRerender();
    case "cat-delete-move": {
      const key = tmState.editCat;
      const to = val("tm-c-move");
      if (!to) return;
      if (
        !(await confirmDialog(
          i18n("Перенести теги категории «{from}» в «{to}» и удалить «{from}»?", { from: CAT_LABELS[key], to: CAT_LABELS[to] })
        ))
      )
        return;
      if (await tmRun(btn, () => tmDeleteCategory(key, { moveTo: to }), i18n("Категория удалена"))) {
        tmState.editCat = null;
        tmState.catDelete = null;
      }
      return tmRerender();
    }
    case "cat-delete-all": {
      const key = tmState.editCat;
      const n = Object.values(TAGS_MAP).filter((t) => t.cat === key).length;
      if (
        !(await confirmDialog(
          i18n("Удалить категорию «{name}» вместе со всеми тегами ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", {
            name: CAT_LABELS[key],
            n,
          })
        ))
      )
        return;
      if (await tmRun(btn, () => tmDeleteCategory(key), i18n("Категория удалена"))) {
        tmState.editCat = null;
        tmState.catDelete = null;
      }
      return tmRerender();
    }
    case "bulk-unused":
      tmState.picked = new Set(Object.keys(TAGS_MAP).filter((t) => !tmIsUsed(t)));
      return tmRerender();
    case "bulk-delete": {
      const names = [...tmState.picked];
      if (!names.length) return;
      if (
        !(await confirmDialog(
          i18n("Удалить выбранные теги ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", { n: names.length })
        ))
      )
        return;
      const ok = await tmRun(
        btn,
        () => tmDeleteTags(names, (i, n) => tmStatus(i18n("Удаляем {i} из {n}…", { i, n }))),
        i18n("Удалено тегов: {n}", { n: names.length })
      );
      if (ok) {
        tmState.picked = new Set();
        tmState.bulk = false;
      }
      return tmRerender();
    }
  }
}

// Обработчики – делегированно на панель: имена тегов приходят от
// пользователя, в inline-onclick их пришлось бы экранировать дважды.
function tmBindPanel() {
  const overlay = document.getElementById("tag-modal-overlay");
  const panel = overlay.querySelector(".tm-panel");
  panel.addEventListener("click", (e) => {
    const tag = e.target.closest("[data-tm-tag]");
    if (tag) {
      const name = tag.dataset.tmTag;
      if (tmState.bulk) {
        if (tmState.picked.has(name)) tmState.picked.delete(name);
        else tmState.picked.add(name);
        return tmRerender(`[data-tm-tag="${CSS.escape(name)}"]`);
      }
      tmState.editTag = tmState.editTag === name ? null : name;
      tmState.editCat = null;
      tmState.newCat = false;
      tmStatus("");
      return tmRerender(tmState.editTag ? "#tm-t-name" : null);
    }
    const cat = e.target.closest("[data-tm-cat]");
    if (cat) {
      tmState.editCat = tmState.editCat === cat.dataset.tmCat ? null : cat.dataset.tmCat;
      tmState.editTag = null;
      tmState.newCat = false;
      tmState.catDelete = null;
      tmStatus("");
      return tmRerender(tmState.editCat ? "#tm-c-name" : null);
    }
    const act = e.target.closest("[data-tm-act]");
    if (act) return tmAction(act.dataset.tmAct, act);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
    const editor = e.target.closest("[data-tm-editor]");
    if (!editor) return;
    e.preventDefault();
    editor.querySelector('[data-tm-act="tag-save"], [data-tm-act="cat-save"]')?.click();
  });
  document.getElementById("tm-close").addEventListener("click", closeTagModal);
  document.getElementById("tm-q").addEventListener("input", (e) => {
    tmState.q = e.target.value;
    renderTagModal();
  });
  document.getElementById("tm-newcat").addEventListener("click", () => {
    tmState.newCat = !tmState.newCat;
    tmState.editCat = null;
    tmState.editTag = null;
    tmRerender(tmState.newCat ? "#tm-c-name" : null);
  });
  document.getElementById("tm-bulk").addEventListener("click", () => {
    tmState.bulk = !tmState.bulk;
    tmState.picked = new Set();
    tmState.editTag = null;
    tmRerender();
  });
}
