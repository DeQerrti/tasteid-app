// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

// ── Модалка: теги и категории ──────────────────
//    Раньше правка тегов жила в настройках; её убрали оттуда, а сюда
//    добавить забыли – теперь и создание, и редактирование в одном месте:
//    форма сверху работает в двух режимах, режим задаётся выбором строки
//    в списке под ней.
//
//    Встроенные теги и категории лежат в js/config.js и из объекта их не
//    вычеркнуть, поэтому удаление встроенного тега – это запись его имени
//    в settings.hiddenTags, а переименование – hiddenTags + новая запись
//    в customTags. Для встроенных категорий удаления нет вовсе: на них
//    завязаны встроенные теги. См. BUILTIN_TAG_NAMES / BUILTIN_CAT_KEYS.

let tmTagEdit = null; // имя редактируемого тега или null – тогда режим создания
let tmCatEdit = null; // ключ редактируемой категории или null
let tmCatColorSet = true; // задан ли цвет у категории в форме

function tmStatus(text, kind) {
  const el = document.getElementById("tag-modal-status");
  el.textContent = text || "";
  el.className = "status-msg" + (kind ? " " + kind : "");
}

function openTagModal(opts) {
  document.getElementById("tm-tag-search").value = "";
  resetTagForm();
  resetCatForm();
  switchTagModalTab("tag");
  tmStatus("");
  if (opts?.bulk) tmBulkStart();
  else tmBulkCancel();
  document.getElementById("tag-modal-overlay").classList.remove("hidden");
}

function closeTagModal() {
  document.getElementById("tag-modal-overlay").classList.add("hidden");
  tmBulkCancel();
}

function closeTagModalOnOverlay(e) {
  if (e.target === document.getElementById("tag-modal-overlay")) closeTagModal();
}

function switchTagModalTab(tab) {
  document.querySelectorAll(".tag-modal-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tag-modal-tag-panel").style.display = tab === "tag" ? "" : "none";
  document.getElementById("tag-modal-cat-panel").style.display = tab === "cat" ? "" : "none";
  document.getElementById("tag-modal-overlay").dataset.tab = tab;
  tmSyncTitle();
}

function tmSyncTitle() {
  const tab = document.getElementById("tag-modal-overlay").dataset.tab || "tag";
  const title =
    tab === "tag"
      ? tmTagEdit
        ? "Правка тега"
        : i18n("Новый тег")
      : tmCatEdit
        ? "Правка категории"
        : i18n("Новая категория");
  document.getElementById("tag-modal-title").textContent = title;
}

function populateTagModalCatSelect() {
  const select = document.getElementById("tm-tag-cat");
  const current = select.value;
  select.innerHTML = Object.entries(CAT_LABELS)
    .map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`)
    .join("");
  if (current && CAT_LABELS[current] !== undefined) select.value = current;
}

// ── Массовое удаление тегов ─────────────────────
// Тот же список, что и всегда, – просто клик по строке выбирает её
// вместо того, чтобы открывать правку, а форма добавления/правки и
// переключатель вкладок спрятаны CSS-классом .bulk-mode (см. стили).
let tmBulkMode = false;
let tmBulkSelected = new Set();

function tmBulkStart() {
  tmBulkMode = true;
  tmBulkSelected = new Set();
  document.getElementById("tag-modal-tag-panel").classList.add("bulk-mode");
  document.getElementById("tag-modal-overlay").classList.add("bulk-mode");
  document.getElementById("tm-bulk-bar").classList.remove("hidden");
  tmBulkSyncBar();
  renderTmTagList();
}

function tmBulkCancel() {
  tmBulkMode = false;
  tmBulkSelected = new Set();
  document.getElementById("tag-modal-tag-panel").classList.remove("bulk-mode");
  document.getElementById("tag-modal-overlay").classList.remove("bulk-mode");
  document.getElementById("tm-bulk-bar").classList.add("hidden");
  renderTmTagList();
}

function tmBulkToggle(name) {
  if (tmBulkSelected.has(name)) tmBulkSelected.delete(name);
  else tmBulkSelected.add(name);
  tmBulkSyncBar();
  renderTmTagList();
}

function tmBulkSyncBar() {
  const n = tmBulkSelected.size;
  document.getElementById("tm-bulk-count").textContent = n
    ? i18n("Выбрано: {n}", { n })
    : i18n("Ничего не выбрано");
  document.getElementById("tm-bulk-delete-btn").disabled = !n;
}

async function tmBulkDeleteConfirm() {
  const names = [...tmBulkSelected];
  if (!names.length) return;
  if (
    !(await confirmDialog(
      i18n("Удалить выбранные теги ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", { n: names.length })
    ))
  )
    return;

  const btn = document.getElementById("tm-bulk-delete-btn");
  btn.disabled = true;
  try {
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
      tmStatus(i18n("Удаляем {i} из {n}…", { i: i + 1, n: names.length }));
      await applyTagToReviews(names[i], "");
      delete TAGS_MAP[names[i]];
      selectedTags.delete(names[i]);
    }
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    tmStatus(i18n("Удалено тегов: {n}", { n: names.length }), "ok");
    tmBulkCancel();
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
    btn.disabled = false;
  }
}

// ── Списки существующих ────────────────────────
function renderTmTagList() {
  const box = document.getElementById("tm-tag-list");
  const q = document.getElementById("tm-tag-search").value.trim().toLowerCase();

  const byCat = {};
  Object.keys(TAGS_MAP)
    .filter((name) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .forEach((name) => {
      const cat = TAGS_MAP[name].cat || "special";
      (byCat[cat] = byCat[cat] || []).push(name);
    });

  // Сначала категории в их обычном порядке, затем осиротевшие (категорию
  // удалили, а тег на неё ещё смотрит) – чтобы такой тег не пропал из списка.
  const order = Object.keys(CAT_LABELS).filter((key) => byCat[key]);
  Object.keys(byCat).forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });

  if (!order.length) {
    box.innerHTML = `<div class="tm-empty">${q ? "Ничего не найдено" : i18n("Тегов пока нет")}</div>`;
    return;
  }

  box.innerHTML = order
    .map((key) => {
      const rows = byCat[key]
        .map((name) => {
          const selected = tmBulkMode && tmBulkSelected.has(name);
          const active = !tmBulkMode && name === tmTagEdit;
          const marker = tmBulkMode ? `<span class="tm-row-check"></span>` : `<span class="tm-row-note">✎</span>`;
          return `
      <button type="button" class="tm-row${active ? " active" : ""}${selected ? " selected" : ""}" data-name="${esc(name)}">
        <span class="tm-row-name">${esc(name)}</span>
        ${marker}
      </button>`;
        })
        .join("");
      return `<div class="tm-group">${esc(CAT_LABELS[key] || key)}</div>${rows}`;
    })
    .join("");
}

function renderTmCatList() {
  const box = document.getElementById("tm-cat-list");
  const counts = {};
  Object.values(TAGS_MAP).forEach((info) => {
    const key = info.cat || "special";
    counts[key] = (counts[key] || 0) + 1;
  });

  box.innerHTML = Object.keys(CAT_LABELS)
    .map((key) => {
      const color = tmSafeColor(CAT_COLORS[key]);
      const dot = `<span class="tm-dot" style="background:${color || "transparent"}"></span>`;
      const used = counts[key] || 0;
      return `<button type="button" class="tm-row${key === tmCatEdit ? " active" : ""}" data-key="${esc(key)}">
      ${dot}<span class="tm-row-name">${esc(CAT_LABELS[key])}</span>
      <span class="tm-row-note">${used}</span>
      <span class="tm-row-note">✎</span>
    </button>`;
    })
    .join("");
}

// Цвет приходит из site-settings.json, а подставляется в атрибут style –
// пропускаем только настоящий hex, чтобы туда нельзя было дописать своё.
function tmSafeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : "";
}

// ── Теги: форма ────────────────────────────────
function tmSyncTagForm() {
  const editing = tmTagEdit !== null;
  document.getElementById("tm-tag-save").textContent = editing ? "Сохранить тег" : i18n("Добавить тег");
  document.getElementById("tm-tag-cancel").hidden = !editing;
  document.getElementById("tm-tag-del").hidden = !editing;
  tmSyncTitle();
}

function resetTagForm() {
  tmTagEdit = null;
  document.getElementById("tm-tag-name").value = "";
  document.getElementById("tm-tag-tip").value = "";
  populateTagModalCatSelect();
  tmSyncTagForm();
  renderTmTagList();
}

function editTag(name) {
  const info = TAGS_MAP[name];
  if (!info) return;
  tmTagEdit = name;
  document.getElementById("tm-tag-name").value = name;
  document.getElementById("tm-tag-tip").value = info.tip || "";
  populateTagModalCatSelect();
  if (CAT_LABELS[info.cat] !== undefined) document.getElementById("tm-tag-cat").value = info.cat;
  tmSyncTagForm();
  renderTmTagList();
  tmStatus("");
}

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

async function submitTag() {
  const name = document.getElementById("tm-tag-name").value.trim();
  const cat = document.getElementById("tm-tag-cat").value;
  const tip = document.getElementById("tm-tag-tip").value.trim();
  const from = tmTagEdit;

  if (!name) {
    tmStatus(i18n("Введите название тега"), "err");
    return;
  }
  if (name !== from && TAGS_MAP[name]) {
    tmStatus(i18n("Такой тег уже есть"), "err");
    return;
  }

  const btn = document.getElementById("tm-tag-save");
  btn.disabled = true;
  tmStatus(i18n("Сохраняем…"));
  try {
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

    if (from && from !== name) await applyTagToReviews(from, name);

    if (from && from !== name) {
      delete TAGS_MAP[from];
      if (selectedTags.has(from)) {
        selectedTags.delete(from);
        selectedTags.add(name);
      }
    }
    TAGS_MAP[name] = { cat, tip };
    if (!from) selectedTags.add(name);
    document.dispatchEvent(new CustomEvent("tags-map-updated"));

    if (from) {
      resetTagForm();
      tmStatus(from === name ? "Тег обновлён" : `Тег переименован в «${name}»`, "ok");
    } else {
      closeTagModal();
    }
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  } finally {
    btn.disabled = false;
  }
}

async function deleteTag() {
  const name = tmTagEdit;
  if (!name) return;
  if (!(await confirmDialog(i18n("Удалить тег «{name}»?\n\nОн пропадёт и из уже сохранённых отзывов.", { name }))))
    return;

  const btn = document.getElementById("tm-tag-del");
  btn.disabled = true;
  tmStatus(i18n("Удаляем…"));
  try {
    await patchSiteSettings((settings) => {
      settings.customTags = settings.customTags || {};
      delete settings.customTags[name];
      const hidden = new Set(settings.hiddenTags || []);
      if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
      settings.hiddenTags = [...hidden];
    });
    await applyTagToReviews(name, "");

    delete TAGS_MAP[name];
    selectedTags.delete(name);
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    resetTagForm();
    tmStatus(i18n("Тег удалён"), "ok");
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  } finally {
    btn.disabled = false;
  }
}

// ── Категории: форма ───────────────────────────
function markCatColorSet() {
  tmCatColorSet = true;
  tmSyncCatForm();
}

function clearCatColor() {
  tmCatColorSet = false;
  tmSyncCatForm();
}

function tmSyncCatForm() {
  const editing = tmCatEdit !== null;
  document.getElementById("tm-cat-save").textContent = editing ? "Сохранить категорию" : i18n("Добавить категорию");
  document.getElementById("tm-cat-cancel").hidden = !editing;
  // Встроенную категорию удалить нельзя: на ней висят встроенные теги
  // из config.js, и после удаления они остались бы без категории.
  document.getElementById("tm-cat-del").hidden = !editing;
  document.getElementById("tm-cat-nocolor").hidden = !tmCatColorSet;
  document.getElementById("tm-cat-colornote").hidden = tmCatColorSet;
  tmSyncTitle();
}

function resetCatForm() {
  tmCatEdit = null;
  tmCatColorSet = true;
  document.getElementById("tm-cat-name").value = "";
  document.getElementById("tm-cat-color").value = "#8b1a1a";
  document.getElementById("tm-cat-delete-choice").classList.add("hidden");
  tmSyncCatForm();
  renderTmCatList();
}

function editCategory(key) {
  if (CAT_LABELS[key] === undefined) return;
  tmCatEdit = key;
  const color = tmSafeColor(CAT_COLORS[key]);
  tmCatColorSet = !!color;
  document.getElementById("tm-cat-name").value = CAT_LABELS[key];
  document.getElementById("tm-cat-color").value = color || "#8b1a1a";
  tmSyncCatForm();
  renderTmCatList();
  tmStatus("");
}

async function submitCategory() {
  const name = document.getElementById("tm-cat-name").value.trim();
  const color = document.getElementById("tm-cat-color").value;
  const editKey = tmCatEdit;

  if (!name) {
    tmStatus(i18n("Введите название категории"), "err");
    return;
  }

  const key =
    editKey ||
    "custom_" +
      name
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/gi, "_")
        .slice(0, 30) +
      "_" +
      Date.now().toString(36).slice(-4);
  const builtin = BUILTIN_CAT_KEYS.has(key);

  const btn = document.getElementById("tm-cat-save");
  btn.disabled = true;
  tmStatus(i18n("Сохраняем…"));
  try {
    await patchSiteSettings((settings) => {
      settings.customCategories = settings.customCategories || {};
      settings.categoryColors = settings.categoryColors || {};
      if (builtin) {
        // Встроенный ключ переименовывается через общий механизм подписей,
        // тот же, что и у типов/ролей в настройках.
        settings.labels = settings.labels || {};
        settings.labels.categories = settings.labels.categories || {};
        settings.labels.categories[key] = name;
      } else {
        settings.customCategories[key] = name;
      }
      if (tmCatColorSet) settings.categoryColors[key] = color;
      else delete settings.categoryColors[key];
    });

    CAT_LABELS[key] = name;
    if (tmCatColorSet) CAT_COLORS[key] = color;
    else delete CAT_COLORS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    populateTagModalCatSelect();

    if (editKey) {
      resetCatForm();
      tmStatus(i18n("Категория обновлена"), "ok");
    } else {
      resetCatForm();
      switchTagModalTab("tag");
      populateTagModalCatSelect();
      document.getElementById("tm-tag-cat").value = key;
      tmStatus(i18n("Категория добавлена – можно выбрать её выше"), "ok");
    }
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  } finally {
    btn.disabled = false;
  }
}

function tmCatTagWord(n) {
  return n % 10 === 1 && n % 100 !== 11
    ? i18n("тег")
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? "тега"
      : i18n("тегов");
}

// Встроенную категорию, как и встроенный тег, нельзя вырезать из
// config.js – поэтому её удаление складывается в hiddenCategories, а
// оттуда применяется при загрузке настроек.
async function deleteCategory() {
  const key = tmCatEdit;
  if (!key) return;

  const used = Object.values(TAGS_MAP).filter((info) => info.cat === key).length;
  if (used) {
    tmCatDeleteShowChoice(key, used);
    return;
  }
  if (!(await confirmDialog(i18n("Удалить категорию «{name}»?", { name: CAT_LABELS[key] })))) return;
  await tmCatDeleteCommit(key);
}

// Раньше здесь была тихая ошибка «сначала перенеси теги вручную» –
// теперь перенос (в любую другую категорию) и удаление вместе с тегами
// сделаны прямо тут, одним из двух кликов.
function tmCatDeleteShowChoice(key, used) {
  document.getElementById("tm-cat-delete-note").textContent = i18n(
    "В категории ещё {n} {word}. Перенести их в другую категорию или удалить вместе с категорией?",
    { n: used, word: tmCatTagWord(used) }
  );
  const select = document.getElementById("tm-cat-move-target");
  select.innerHTML = Object.entries(CAT_LABELS)
    .filter(([k]) => k !== key)
    .map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`)
    .join("");
  document.getElementById("tm-cat-delete-choice").classList.remove("hidden");
  tmStatus("");
}

function tmCatDeleteCancel() {
  document.getElementById("tm-cat-delete-choice").classList.add("hidden");
}

async function tmCatDeleteMove() {
  const key = tmCatEdit;
  const target = document.getElementById("tm-cat-move-target").value;
  if (!key || !target) return;
  if (
    !(await confirmDialog(
      i18n("Перенести теги категории «{from}» в «{to}» и удалить «{from}»?", {
        from: CAT_LABELS[key],
        to: CAT_LABELS[target],
      })
    ))
  )
    return;
  tmStatus(i18n("Переносим…"));
  try {
    await tmCatReassignTags(key, target);
    await tmCatDeleteCommit(key);
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  }
}

async function tmCatDeleteAll() {
  const key = tmCatEdit;
  if (!key) return;
  const names = Object.keys(TAGS_MAP).filter((n) => TAGS_MAP[n].cat === key);
  if (
    !(await confirmDialog(
      i18n("Удалить категорию «{name}» вместе со всеми тегами ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", {
        name: CAT_LABELS[key],
        n: names.length,
      })
    ))
  )
    return;
  try {
    await tmCatDeleteAllTags(names);
    await tmCatDeleteCommit(key);
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  }
}

// Категория у тега (в т.ч. встроенного) переопределяется тем же
// механизмом, что и переименование тега в submitTag() – записью в
// settings.customTags по точному имени тега, встроенный он или свой.
async function tmCatReassignTags(fromCat, toCat) {
  const names = Object.keys(TAGS_MAP).filter((n) => TAGS_MAP[n].cat === fromCat);
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    names.forEach((name) => {
      settings.customTags[name] = { cat: toCat, tip: TAGS_MAP[name].tip || "" };
    });
  });
  names.forEach((name) => {
    TAGS_MAP[name] = { ...TAGS_MAP[name], cat: toCat };
  });
}

async function tmCatDeleteAllTags(names) {
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    const hidden = new Set(settings.hiddenTags || []);
    names.forEach((name) => {
      delete settings.customTags[name];
      if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
    });
    settings.hiddenTags = [...hidden];
  });
  for (const name of names) {
    await applyTagToReviews(name, "");
    delete TAGS_MAP[name];
    selectedTags.delete(name);
  }
}

async function tmCatDeleteCommit(key) {
  const btn = document.getElementById("tm-cat-del");
  btn.disabled = true;
  tmStatus(i18n("Удаляем…"));
  try {
    await patchSiteSettings((settings) => {
      if (settings.customCategories) delete settings.customCategories[key];
      if (settings.categoryColors) delete settings.categoryColors[key];
      const hidden = new Set(settings.hiddenCategories || []);
      if (BUILTIN_CAT_KEYS.has(key)) hidden.add(key);
      settings.hiddenCategories = [...hidden];
      // Переименование встроенной категории живёт в labels.categories –
      // после удаления оно осталось бы висеть мусором.
      if (settings.labels && settings.labels.categories) {
        delete settings.labels.categories[key];
      }
    });
    delete CAT_LABELS[key];
    delete CAT_COLORS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    populateTagModalCatSelect();
    document.getElementById("tm-cat-delete-choice").classList.add("hidden");
    resetCatForm();
    tmStatus(i18n("Категория удалена"), "ok");
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  } finally {
    btn.disabled = false;
  }
}

