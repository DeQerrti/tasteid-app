// ══════════════════════════════════════════════
//  settings-tabs.js – разделы «Любимого», порядок вкладок, статусы, роли персон – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// Заголовки «Разделы вкладки «X»» ниже называют саму вкладку по её
// текущему имени, а не намертво зашитым «Статусы»/«Любимое»: раньше
// переименование вкладки в списке выше (toggleTabEdit) эти заголовки
// не трогало – переименуй вкладку «Статусы» в «Помидор», и здесь
// осталось бы «Разделы вкладки «Статусы»», хотя такой вкладки уже нет.
function updateSectionListHeadings() {
  const statusesH = document.getElementById("statusesHeading");
  if (statusesH) statusesH.textContent = i18n("Разделы вкладки «{name}»", { name: tabLabels.now || TAB_DEFS_BY_ID.now.def });
  const favH = document.getElementById("favSectionsHeading");
  if (favH)
    favH.textContent = i18n("Разделы вкладки «{name}»", { name: tabLabels.favorites || TAB_DEFS_BY_ID.favorites.def });
  const tierH = document.getElementById("tierModesHeading");
  if (tierH)
    tierH.textContent = i18n("Разделы вкладки «{name}»", { name: tabLabels.tierlist || TAB_DEFS_BY_ID.tierlist.def });
}

// ── Разделы вкладки «Любимое» ──────────────────
// Три встроенных раздела: у "Тайтлы" свой источник (reviews.json,
// флаг favorite), у "Персонажи"/"Персоны" – favorites.json по type.
// Список фиксированный: завести четвёртый встроенный неоткуда, свои
// разделы заводятся ниже (favCollections).
//
// Удалить встроенный раздел можно, но "удалить" здесь значит убрать
// его с сайта и из этого списка – сами записи в favorites.json лежат
// и никуда не деваются. Раз строку из списка убирает не кнопка
// "скрыть", вернуть её иначе как отсюда было бы нечем – поэтому
// удалённые показываются отдельной строкой со стрелкой возврата.
const FAV_SECTIONS = [
  { key: "favTitles", def: i18n("Тайтлы") },
  { key: "favCharacters", def: i18n("Персонажи") },
  { key: "favPersons", def: i18n("Персоны") },
];
let favSectionLabels = {};
let hiddenFavSectionsState = new Set();
let removedFavSections = new Set();
// Порядок трёх встроенных разделов – раньше жёстко зашит (Тайтлы,
// Персонажи, Персоны), теперь настраиваемый перетаскиванием, как и у
// вкладок (tabOrderState). js/favorites.js читает его же
// (window.SITE_FAV_SECTION_ORDER), см. её же комментарий там.
let favSectionOrderState = FAV_SECTIONS.map((s) => s.key);

function renderFavSectionsList() {
  const container = document.getElementById("favSectionsList");
  const rows = favSectionOrderState
    .filter((key) => !removedFavSections.has(key))
    .map((key) => {
      const s = FAV_SECTIONS.find((x) => x.key === key);
      const label = favSectionLabels[key] || s.def;
      return `
      <div class="tab-row" id="favsecrow-${key}" data-key="${key}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenFavSectionsState.has(key), `hiddenFavSectionsState.has('${key}') ? hiddenFavSectionsState.delete('${key}') : hiddenFavSectionsState.add('${key}'); renderFavSectionsList();`)}
        <span class="tab-name" id="favsecname-${key}">${esc(label)}</span>
        <input type="text" id="favsecinput-${key}" value="${esc(label)}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleFavSecEdit('${key}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeFavSection('${key}')">✕</button>
      </div>`;
    })
    .join("");

  const gone = FAV_SECTIONS.filter((s) => removedFavSections.has(s.key));
  const restore = gone.length
    ? `
      <div class="fav-restore">
        Удалённые разделы:
        ${gone
          .map(
            (s) => `<button type="button" class="fav-restore-btn"
            onclick="restoreFavSection('${s.key}')">${esc(favSectionLabels[s.key] || s.def)} ↺</button>`
          )
          .join("")}
      </div>`
    : "";

  container.innerHTML = rows + restore;
  bindFavSectionsDnd();
}

let favSecDragSrc = null;

function bindFavSectionsDnd() {
  const container = document.getElementById("favSectionsList");
  container.querySelectorAll(".tab-row[draggable]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      favSecDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      favSecDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!favSecDragSrc || row === favSecDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!favSecDragSrc || row === favSecDragSrc) return;

      const srcKey = favSecDragSrc.dataset.key;
      const targetKey = row.dataset.key;
      const srcIdx = favSectionOrderState.indexOf(srcKey);
      let targetIdx = favSectionOrderState.indexOf(targetKey);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      favSectionOrderState.splice(srcIdx, 1);
      targetIdx = favSectionOrderState.indexOf(targetKey);
      favSectionOrderState.splice(before ? targetIdx : targetIdx + 1, 0, srcKey);

      renderFavSectionsList();
    });
  });
}

async function removeFavSection(key) {
  const def = FAV_SECTIONS.find((s) => s.key === key);
  const label = favSectionLabels[key] || def.def;
  if (
    !(await confirmDialog(
      i18n(
        "Удалить раздел «{name}»?\n\nЗаписи останутся в данных, но перестанут показываться. Вернуть раздел можно здесь же.",
        { name: label }
      )
    ))
  ) {
    return;
  }
  removedFavSections.add(key);
  hiddenFavSectionsState.add(key);
  renderFavSectionsList();
}

function restoreFavSection(key) {
  removedFavSections.delete(key);
  hiddenFavSectionsState.delete(key);
  renderFavSectionsList();
}

function toggleFavSecEdit(key) {
  const row = document.getElementById(`favsecrow-${key}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`favsecinput-${key}`).value.trim();
    const def = FAV_SECTIONS.find((s) => s.key === key).def;
    favSectionLabels[key] = val || def;
    document.getElementById(`favsecname-${key}`).textContent = favSectionLabels[key];
  }
}

// ── Свои разделы «Любимого» – в отличие от FAV_SECTIONS это не
// фиксированный список: их заводят по кнопке, у каждого есть галочка
// (скрыть) и удаление, как у коллекций тир-листа. Данные записей
// живут в favorites.json с type = id раздела – своей папки с
// картинками, в отличие от тир-листа, у них нет, поэтому создание
// проще: не нужен модальный шаг с загрузкой.
let favCollections = [];

function renderFavCollectionsList() {
  const container = document.getElementById("favCollectionsList");
  container.innerHTML = favCollections
    .map(
      (c) => `
      <div class="tab-row" id="favcollrow-${c.id}" data-id="${esc(c.id)}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenFavSectionsState.has(c.id), `hiddenFavSectionsState.has('${c.id}') ? hiddenFavSectionsState.delete('${c.id}') : hiddenFavSectionsState.add('${c.id}'); renderFavCollectionsList();`)}
        <span class="tab-name" id="favcollname-${c.id}">${esc(c.label)}</span>
        <input type="text" id="favcollinput-${c.id}" value="${esc(c.label)}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleFavCollectionEdit('${c.id}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeFavCollection('${c.id}')">✕</button>
      </div>
    `
    )
    .join("");
  bindFavCollectionsDnd();
}

let favCollDragSrc = null;

function bindFavCollectionsDnd() {
  const container = document.getElementById("favCollectionsList");
  container.querySelectorAll(".tab-row[draggable]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      favCollDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      favCollDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!favCollDragSrc || row === favCollDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!favCollDragSrc || row === favCollDragSrc) return;

      const srcId = favCollDragSrc.dataset.id;
      const targetId = row.dataset.id;
      const srcIdx = favCollections.findIndex((c) => c.id === srcId);
      let targetIdx = favCollections.findIndex((c) => c.id === targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      const [moved] = favCollections.splice(srcIdx, 1);
      targetIdx = favCollections.findIndex((c) => c.id === targetId);
      favCollections.splice(before ? targetIdx : targetIdx + 1, 0, moved);

      renderFavCollectionsList();
    });
  });
}

function toggleFavCollectionEdit(id) {
  const row = document.getElementById(`favcollrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`favcollinput-${id}`).value.trim();
    const c = favCollections.find((x) => x.id === id);
    if (c) {
      c.label = val || c.label;
      document.getElementById(`favcollname-${id}`).textContent = c.label;
    }
  }
}

function addFavCollection() {
  const name = document.getElementById("newFavCollectionName").value.trim();
  if (!name) return;
  favCollections.push({ id: slugify(name), label: name });
  document.getElementById("newFavCollectionName").value = "";
  renderFavCollectionsList();
}

async function removeFavCollection(id) {
  if (
    !(await confirmDialog(
      i18n("Удалить раздел? Уже добавленные записи останутся в данных, но перестанут где-либо отображаться.")
    ))
  ) {
    return;
  }
  favCollections = favCollections.filter((c) => c.id !== id);
  hiddenFavSectionsState.delete(id);
  renderFavCollectionsList();
}

// Список тем берётся из реестра в js/theme.js. Раньше здесь лежала
// своя копия – и она успела разъехаться: темы «Мягкий ботанический»
// в ней не было вовсе, то есть выбрать её из настроек было нельзя.
const THEMES = typeof themeOptions === "function" ? themeOptions() : [];

// Размер шрифта – см. её же комментарий в разметке выше и в
// style.css (--text-scale). markDirty=false – только для начальной
// загрузки из loadCurrentSettings(), где значение просто отражает то,
// что уже сохранено, а не правку человека.
let textScale = 100;

function applyTextScale(percent, markDirty) {
  percent = Math.min(150, Math.max(80, Number(percent) || 100));
  textScale = percent;
  const slider = document.getElementById("text-scale-slider");
  const label = document.getElementById("text-scale-value");
  if (slider) slider.value = percent;
  if (label) label.textContent = percent + "%";
  document.documentElement.style.setProperty("--text-scale", percent / 100, "important");
  if (markDirty) settingsDirty = true;
}

let selectedTheme = "classic";

// Свои цвета по темам: { skin: { "--bg": "#…", accent: "#…" } }.
// Отдельно для каждой темы – палитра, подогнанная под тёмную, на
// светлой выглядела бы случайным набором.
let themeColors = {};

// Тёмная/светлая пара живёт под одним базовым id (soft/soft-dark,
// classic/classic-light…) – группируем по нему, а не по общему
// списку, иначе десять пилюль в ряд плохо читаются. Какая из двух
// тёмная, а какая светлая – смотрим по-настоящему в themes.css
// (color-scheme), а не угадываем по суффиксу: он у разных пар стоит
// на разных сторонах (у классической светлая – новая, суффикс у
// неё; у остальных наоборот, суффикс у тёмной).
function themeIsDark(skin) {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    if (sheet.ownerNode && sheet.ownerNode.id === "theme-overrides") continue;
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      const sel = rule.selectorText.replace(/\s+/g, "");
      if (sel === `[data-skin="${skin}"]` || sel === `html[data-skin="${skin}"]`) {
        const cs = rule.style.getPropertyValue("color-scheme").trim();
        if (cs) return cs === "dark";
      }
    }
  }
  return false;
}

function themeGroups() {
  const groups = {};
  for (const t of THEMES) {
    const key = t.id.replace(/-dark$|-light$/, "");
    const g = (groups[key] = groups[key] || { key, label: null, light: null, dark: null });
    if (!/-dark$|-light$/.test(t.id)) g.label = t.label;
    if (themeIsDark(t.id)) g.dark = t;
    else g.light = t;
  }
  return Object.values(groups);
}

let openThemeGroup = null;

function renderThemeGrid() {
  const grid = document.getElementById("themeGrid");
  const groups = themeGroups();
  grid.innerHTML = groups
    .map((g) => {
      const active = [g.light, g.dark].find((v) => v && v.id === selectedTheme);
      const mode = active ? (g.dark && active.id === g.dark.id ? " – тёмная" : i18n(" – светлая")) : "";
      return `<div class="theme-group">
        <div class="theme-option${active ? " selected" : ""}" data-group="${g.key}">${g.label}${mode}</div>
        <div class="theme-popover hidden" id="popover-${g.key}">
          ${g.light ? `<button type="button" class="${g.light.id === selectedTheme ? "current" : ""}" data-theme="${g.light.id}">${i18n("Светлая")}</button>` : ""}
          ${g.dark ? `<button type="button" class="${g.dark.id === selectedTheme ? "current" : ""}" data-theme="${g.dark.id}">${i18n("Тёмная")}</button>` : ""}
        </div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".theme-option").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const key = el.dataset.group;
      openThemeGroup = openThemeGroup === key ? null : key;
      grid.querySelectorAll(".theme-popover").forEach((p) => {
        p.classList.toggle("hidden", p.id !== `popover-${openThemeGroup}`);
      });
    };
  });
  grid.querySelectorAll(".theme-popover button").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedTheme = btn.dataset.theme;
      openThemeGroup = null;
      renderThemeGrid();
      renderPalette();
      previewPalette();
    };
  });
}

// ── Drag-and-drop порядка вкладок (вертикальный список) ──
let tabDragSrc = null;

function bindTabsDnd() {
  const container = document.getElementById("tabsList");

  container.querySelectorAll(".tab-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      tabDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      tabDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!tabDragSrc || row === tabDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!tabDragSrc || row === tabDragSrc) return;

      const srcId = tabDragSrc.dataset.id;
      const targetId = row.dataset.id;
      const srcIdx = tabOrderState.indexOf(srcId);
      let targetIdx = tabOrderState.indexOf(targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      // Вставляем перед/после target в зависимости от того, выше или ниже курсор середины строки
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      tabOrderState.splice(srcIdx, 1);
      targetIdx = tabOrderState.indexOf(targetId);
      tabOrderState.splice(before ? targetIdx : targetIdx + 1, 0, srcId);

      renderTabsList();
    });
  });
}

function toggleTabEdit(id) {
  const row = document.getElementById(`tabrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`tabinput-${id}`).value.trim();
    const def = TAB_DEFS.find((t) => t.id === id).def;
    tabLabels[id] = val || def;
    document.getElementById(`tabname-${id}`).textContent = tabLabels[id];
    if (id === "now" || id === "favorites" || id === "tierlist") updateSectionListHeadings();
  }
}

// ── Статусы ──
let archiveLabel = i18n("Архив");
let statusBuckets = [];
let hiddenStatusesState = new Set();
// Порядок статусов вместе с «Архивом» – раньше архив был жёстко зашит
// последним рядом (не перетаскивался вовсе), хотя физически ничего не
// требует, чтобы он шёл последним: js/now.js просто рендерит статусы в
// этом самом порядке. Теперь один общий список, архив – обычный ряд в
// нём. statusOrderedKeys() сама достраивает порядок при рассинхроне
// (только что заведённый статус, или загрузка настроек до того, как
// в них появился archive) – в конец, а не молча теряет ряд.
let statusOrderState = [];

function statusOrderedKeys() {
  const known = [...statusBuckets.map((b) => b.key), "archive"];
  const ordered = statusOrderState.filter((k) => known.includes(k));
  const missing = known.filter((k) => !ordered.includes(k));
  return [...ordered, ...missing];
}

function renderStatusesList() {
  const container = document.getElementById("statusesList");
  const rows = statusOrderedKeys()
    .map((key) => {
      if (key === "archive") {
        return `
        <div class="tab-row" id="statusrow-archive" data-key="archive" draggable="true">
          <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
          ${eyeButton(hiddenStatusesState.has("archive"), `hiddenStatusesState.has('archive') ? hiddenStatusesState.delete('archive') : hiddenStatusesState.add('archive'); renderStatusesList();`)}
          <span class="tab-name" id="statusname-archive">${archiveLabel}</span>
          <input type="text" id="statusinput-archive" value="${archiveLabel}" onkeydown="if(event.key==='Enter')this.blur();">
          <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleStatusEdit('archive')">✎</button>
        </div>`;
      }
      const b = statusBuckets.find((x) => x.key === key);
      if (!b) return "";
      return `
      <div class="tab-row" id="statusrow-${b.key}" data-key="${b.key}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenStatusesState.has(b.key), `hiddenStatusesState.has('${b.key}') ? hiddenStatusesState.delete('${b.key}') : hiddenStatusesState.add('${b.key}'); renderStatusesList();`)}
        <span class="tab-name" id="statusname-${b.key}">${b.label}</span>
        <input type="text" id="statusinput-${b.key}" value="${b.label}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleStatusEdit('${b.key}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeStatusBucket('${b.key}')">✕</button>
      </div>`;
    })
    .join("");
  container.innerHTML = rows;
  bindStatusesDnd();
}

let statusDragSrc = null;

function bindStatusesDnd() {
  const container = document.getElementById("statusesList");
  container.querySelectorAll(".tab-row[draggable]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      statusDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      statusDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!statusDragSrc || row === statusDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!statusDragSrc || row === statusDragSrc) return;

      const srcKey = statusDragSrc.dataset.key;
      const targetKey = row.dataset.key;
      const order = statusOrderedKeys();
      const srcIdx = order.indexOf(srcKey);
      let targetIdx = order.indexOf(targetKey);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      order.splice(srcIdx, 1);
      targetIdx = order.indexOf(targetKey);
      order.splice(before ? targetIdx : targetIdx + 1, 0, srcKey);
      statusOrderState = order;

      renderStatusesList();
    });
  });
}

function toggleStatusEdit(key) {
  const row = document.getElementById(`statusrow-${key}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`statusinput-${key}`).value.trim();
    if (key === "archive") {
      archiveLabel = val || i18n("Архив");
      document.getElementById(`statusname-${key}`).textContent = archiveLabel;
    } else {
      const bucket = statusBuckets.find((b) => b.key === key);
      if (bucket) {
        bucket.label = val || bucket.label;
        document.getElementById(`statusname-${key}`).textContent = bucket.label;
      }
    }
  }
}

function addStatusBucket() {
  const name = document.getElementById("newStatusName").value.trim();
  if (!name) return;
  const key =
    "status_" +
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .slice(0, 30) +
    "_" +
    Date.now().toString(36).slice(-4);
  statusBuckets.push({ key, label: name, removable: true });
  document.getElementById("newStatusName").value = "";
  renderStatusesList();
}

async function countReviewsByStatus(key) {
  const reviews = await fetchReviews();
  return reviews.filter((r) => r.status === key).length;
}

// Удалить статус, которым что-то помечено, – не поломка, но записи
// пропадут со вкладки, и человек об этом должен узнать до, а не после.
// Половина базы вполне может лежать в «Отложено».
async function removeStatusBucket(key) {
  const bucket = statusBuckets.find((b) => b.key === key);
  const label = bucket ? bucket.label : key;

  let used = 0;
  try {
    used = await countReviewsByStatus(key);
  } catch {
    // Не смогли посчитать – спросим без числа, но удалять не мешаем.
  }
  const warn = used
    ? `\n\nВ этом статусе ${used} ${plural(used, [i18n("запись"), i18n("записи"), i18n("записей")])}. Они останутся в данных, но пропадут со вкладки «Статусы», пока им не поставить другой статус.`
    : "";

  if (!(await confirmDialog(i18n("Удалить раздел «{name}»?", { name: label }) + warn))) return;
  statusBuckets = statusBuckets.filter((b) => b.key !== key);
  hiddenStatusesState.delete(key);
  renderStatusesList();
}

// Статус можно завести и из «Импорта», не уходя с разобранного файла
// (js/import.js). Тогда эта панель осталась бы со старым списком, и
// её «Сохранить» затёрло бы только что заведённый статус – поэтому
// импорт зовёт этот хук сразу после записи настроек.
function onStatusBucketsChanged(buckets) {
  statusBuckets = JSON.parse(JSON.stringify(buckets));
  renderStatusesList();
}

const BUILTIN_CAT_DEFAULTS = {
  visual: i18n("Визуал / звук"),
  plot: i18n("Сюжет / нарратив"),
  chars: i18n("Персонажи / мир"),
  special: i18n("Атмосфера / эмоции"),
  genre: i18n("Жанр"),
};
let allCatLabels = { ...BUILTIN_CAT_DEFAULTS }; // ключ -> название (встроенные + свои)
let catColors = {}; // ключ -> hex (необязательно, у встроенных по умолчанию нет)
let customCatKeys = new Set();
let customTags = {};

// Рендер-функции и «+ Добавить» для категорий/тегов убраны вместе с
// панелью «Теги» – то же самое делается инлайн в редакторе отзыва.
// Состояние выше (allCatLabels/catColors/customCatKeys/customTags)
// остаётся: оно подгружается в loadCurrentSettings() и уходит обратно
// в saveSettings() неизменным, чтобы данные не терялись при сохранении
// с любой другой вкладки.

const BUILTIN_TYPE_DEFAULTS = {
  anime: i18n("Аниме"),
  manga: i18n("Манга"),
  manhwa: i18n("Манхва"),
  manhua: i18n("Маньхуа"),
  novel: i18n("Ранобэ"),
  movie: i18n("Фильм"),
  show: i18n("Сериал"),
  dorama: i18n("Дорама"),
  book: i18n("Книга"),
  game: i18n("Игра"),
  gacha: i18n("Гача"),
};
let typeLabels = {};
let hiddenTypes = new Set();
let customTypeKeys = new Set();
let typePlural = {}; // key -> [1 штука, 2–4 штуки, 5+ штук], только для своих типов

// ── Роли персон (в «Любимом», тип «Персона») ──
const BUILTIN_SUBTYPE_DEFAULTS = {
  actor: i18n("Актёр"),
  director: i18n("Режиссёр"),
  author: i18n("Автор"),
  seiyuu: i18n("Сэйю"),
  artist: i18n("Художник"),
  composer: i18n("Композитор"),
};
let subtypeLabels = {};
let hiddenSubtypes = new Set();
let customSubtypeKeys = new Set();

// Панель «Типы» (типы тайтлов и роли персон) убрана – то же самое
// теперь делается инлайн: типы в редакторе отзыва (#/add), роли в
// редакторе персон (#/favorites-edit), тем же паттерном выпадающего
// списка с добавлением, что и у источников. Состояние выше по-прежнему
// подгружается в loadCurrentSettings() и уходит обратно в saveSettings()
// неизменным, чтобы данные не терялись при сохранении с любой другой
// вкладки.

