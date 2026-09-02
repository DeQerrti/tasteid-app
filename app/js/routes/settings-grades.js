// ══════════════════════════════════════════════
//  settings-grades.js – шкала оценок, коллекции и режим тир-листа – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Шкала оценок ──
const SCALE_TYPES = [
  { id: "categorical", label: i18n("Названия") },
  { id: "numeric", label: i18n("Числа") },
  { id: "stars", label: i18n("Звёзды") },
];
let scaleType = "categorical";
let shelves = []; // [{key, name, color, min, max}]

const DEFAULT_SHELF_COLORS = ["#7c3aed", "#2563a8", "#2d8a4e", "#d4a017", "#6b7280", "#c0392b", "#8B6914"];

function renderScaleTypeGrid() {
  const grid = document.getElementById("scaleTypeGrid");
  grid.innerHTML = SCALE_TYPES.map(
    (t) => `<div class="theme-option${t.id === scaleType ? " selected" : ""}" data-scale="${t.id}">${t.label}</div>`
  ).join("");
  grid.querySelectorAll(".theme-option").forEach((el) => {
    el.onclick = () => {
      const prevWasCategorical = scaleType === "categorical";
      scaleType = el.dataset.scale;
      const nowIsCategorical = scaleType === "categorical";
      if (prevWasCategorical !== nowIsCategorical) shelves = [];
      renderScaleTypeGrid();
      updateScaleBlocks();
    };
  });
  document.getElementById("numericMaxLabel").textContent =
    scaleType === "stars" ? "Сколько звёзд" : i18n("Максимум");
}

function updateScaleBlocks() {
  document.getElementById("categoricalBlock").style.display = scaleType === "categorical" ? "" : "none";
  document.getElementById("numericBlock").style.display = scaleType === "categorical" ? "none" : "";
  if (scaleType === "categorical") {
    if (!shelves.length) seedCategoricalShelves();
    renderShelvesList("catShelvesList", false);
  } else {
    if (!shelves.length) seedNumericShelves();
    renderShelvesList("shelvesList", true);
  }
}

// Сид для "Названия" – обязательно с реальными ключами GRADES_DEF,
// иначе уже сохранённые отзывы (grade: "etalon" и т.д.) перестанут
// находить свою полку.
function seedCategoricalShelves() {
  shelves = GRADES_DEF.map((g) => ({ key: g.key, name: g.name, color: g.color, desc: g.desc }));
}

function seedNumericShelves() {
  const max = Number(document.getElementById("numericMax").value) || (scaleType === "stars" ? 5 : 10);
  const names = [
    i18n("Резонанс"),
    i18n("Эталон"),
    i18n("Отлично"),
    i18n("Аттракцион"),
    i18n("Фоновый шум"),
    i18n("Брак"),
    i18n("Разочарование"),
  ];
  const n = Math.min(names.length, max);
  const step = max / n;
  shelves = [];
  for (let i = 0; i < n; i++) {
    const hi = Math.round(max - i * step);
    const lo = i === n - 1 ? 1 : Math.round(max - (i + 1) * step) + 1;
    shelves.push({ key: "shelf_" + (i + 1), name: names[i], color: DEFAULT_SHELF_COLORS[i], min: lo, max: hi });
  }
}

function renderShelvesList(containerId, withRange) {
  const container = document.getElementById(containerId);
  container.innerHTML = shelves
    .map(
      (s, i) => `
      <div class="shelf-row">
        <div class="shelf-row-main">
          <input type="color" value="${esc(s.color)}" onchange="shelves[${i}].color=this.value">
          <input type="text" value="${esc(s.name)}" onchange="shelves[${i}].name=this.value" placeholder="${i18n("Название")}">
          ${
            withRange
              ? `
            <span class="rng">${i18n("от")}</span>
            <input type="number" value="${s.min}" onchange="shelves[${i}].min=Number(this.value)">
            <span class="rng">${i18n("до")}</span>
            <input type="number" value="${s.max}" onchange="shelves[${i}].max=Number(this.value)">
          `
              : ""
          }
          <button class="icon-btn" onclick="removeShelfRow(${i}, '${containerId}', ${withRange})">✕</button>
        </div>
        <input type="text" class="shelf-desc" value="${esc(s.desc || "")}"
          onchange="shelves[${i}].desc=this.value" placeholder="${i18n("Описание – показывается подсказкой при наведении")}">
      </div>
    `
    )
    .join("");
}

function addShelfRow(categorical) {
  if (categorical) {
    const name = i18n("Новая полка");
    const key = "custom_" + name.toLowerCase() + "_" + Date.now().toString(36).slice(-5);
    shelves.push({ key, name, color: "#8b1a1a" });
    renderShelvesList("catShelvesList", false);
  } else {
    const max = Number(document.getElementById("numericMax").value) || 10;
    shelves.push({
      key: "shelf_" + Date.now().toString(36).slice(-5),
      name: i18n("Новая полка"),
      color: "#8b1a1a",
      min: 1,
      max,
    });
    renderShelvesList("shelvesList", true);
  }
}

async function removeShelfRow(i, containerId, withRange) {
  if (!(await confirmDialog(i18n("Удалить полку «{name}»?", { name: shelves[i].name })))) return;
  shelves.splice(i, 1);
  renderShelvesList(containerId, withRange);
}

// ── Коллекции тир-листов ──
// Заводить новую коллекцию по-прежнему проще прямо на вкладке
// «Тир-лист» (кнопка «Создать» в js/tierlist.js – там же, где сразу
// виден результат и можно начать наполнять). А вот скрыть, переименовать,
// удалить и переставить местами существующие тир-листы (в том числе
// «Тайтлы» и друг относительно друга) – ровно то же самое действие,
// что уже есть у статусов и разделов «Любимого» чуть ниже, поэтому и
// список тут один общий, тем же паттерном (.tab-row, drag-handle,
// eyeButton), а не разбросан по разным местам страницы.
function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) +
    "-" +
    Date.now().toString(36).slice(-4)
  );
}

// ── Режим тир-листа «Тайтлы» ───────────────────
// Не элемент tierCollections: у коллекций своя папка с картинками
// и редактор, а «Тайтлы» – это просто вид тир-листа поверх reviews.json,
// хранить для него нечего. В общем списке ниже это просто первый ряд
// с ключом "titles", без кнопки удаления – удалять здесь нечего, у
// вида нет ни файла, ни картинок.
let tierTitlesLabel = i18n("Тайтлы");
let hiddenTierModesState = new Set();

// tierCollections – тот же массив {id, label}, что читает и пишет
// js/tierlist.js (patchSiteSettings при создании коллекции) и
// js/routes/chars-edit.js (переименование/удаление изнутри редактора).
// Здесь то же самое, но списком сразу для всех коллекций и с
// перетаскиванием порядка – действия ниже (removeTierCollectionSetting)
// сохраняются на сервер сразу же, а не откладываются до общего
// «Сохранить», ровно как в chars-edit.js: удаление стирает настоящие
// данные (сам tier-XXX.json), откатить нажатием «Отмена» на этой
// странице такое было бы нельзя, значит и делать вид, что можно, не
// стоит.
let tierCollections;

// Порядок всех режимов тир-листа разом – "titles" и id коллекций.
// Раньше "Тайтлы" всегда шли первыми, а коллекции – в порядке массива
// tierCollections без возможности что-либо переставить (js/tierlist.js,
// tlModeToggleHtml). Теперь один настраиваемый список, tierlist.js
// читает его же (window.SITE_TIER_MODE_ORDER).
let tierModeOrderState = [];

function tierModeOrderedKeys() {
  const known = ["titles", ...(tierCollections || []).map((c) => c.id)];
  const ordered = tierModeOrderState.filter((k) => known.includes(k));
  const missing = known.filter((k) => !ordered.includes(k));
  return [...ordered, ...missing];
}

function renderTierModesList() {
  const container = document.getElementById("tierModesList");
  const rows = tierModeOrderedKeys()
    .map((key) => {
      if (key === "titles") {
        return `
        <div class="tab-row" id="tiermoderow-titles" data-key="titles" draggable="true">
          <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
          ${eyeButton(hiddenTierModesState.has("titles"), "hiddenTierModesState.has('titles') ? hiddenTierModesState.delete('titles') : hiddenTierModesState.add('titles'); renderTierModesList();")}
          <span class="tab-name" id="tiermodename-titles">${esc(tierTitlesLabel)}</span>
          <input type="text" id="tiermodeinput-titles" value="${esc(tierTitlesLabel)}" onkeydown="if(event.key==='Enter')this.blur();">
          <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTierModeEdit('titles')">✎</button>
        </div>`;
      }
      const c = (tierCollections || []).find((x) => x.id === key);
      if (!c) return "";
      return `
      <div class="tab-row" id="tiermoderow-${esc(c.id)}" data-key="${esc(c.id)}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenTierModesState.has(c.id), `hiddenTierModesState.has('${c.id}') ? hiddenTierModesState.delete('${c.id}') : hiddenTierModesState.add('${c.id}'); renderTierModesList();`)}
        <span class="tab-name" id="tiermodename-${esc(c.id)}">${esc(c.label || c.id)}</span>
        <input type="text" id="tiermodeinput-${esc(c.id)}" value="${esc(c.label || c.id)}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTierModeEdit('${c.id}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeTierCollectionSetting('${c.id}')">✕</button>
      </div>`;
    })
    .join("");
  container.innerHTML = rows;
  bindTierModesDnd();
}

let tierModeDragSrc = null;

function bindTierModesDnd() {
  const container = document.getElementById("tierModesList");
  container.querySelectorAll(".tab-row[draggable]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      tierModeDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      tierModeDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!tierModeDragSrc || row === tierModeDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!tierModeDragSrc || row === tierModeDragSrc) return;

      const srcKey = tierModeDragSrc.dataset.key;
      const targetKey = row.dataset.key;
      const order = tierModeOrderedKeys();
      const srcIdx = order.indexOf(srcKey);
      let targetIdx = order.indexOf(targetKey);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      order.splice(srcIdx, 1);
      targetIdx = order.indexOf(targetKey);
      order.splice(before ? targetIdx : targetIdx + 1, 0, srcKey);
      tierModeOrderState = order;

      renderTierModesList();
    });
  });
}

function toggleTierModeEdit(key) {
  const row = document.getElementById(`tiermoderow-${key}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`tiermodeinput-${key}`).value.trim();
    if (key === "titles") {
      tierTitlesLabel = val || i18n("Тайтлы");
      document.getElementById(`tiermodename-${key}`).textContent = tierTitlesLabel;
    } else {
      const c = (tierCollections || []).find((x) => x.id === key);
      if (c) {
        c.label = val || c.label;
        document.getElementById(`tiermodename-${key}`).textContent = c.label;
      }
    }
  }
}

// Удаление тир-листа отсюда стирает те же настоящие данные, что и
// «Удалить тир-лист» в его собственном редакторе (js/routes/chars-edit.js,
// deleteCurrentCollection) – и по той же причине сохраняется сразу на
// сервер, а не копится до нажатия общей кнопки «Сохранить» этой
// страницы: «Отмена»/уход со страницы после такого удаления не должны
// делать вид, что данные можно вернуть.
async function removeTierCollectionSetting(id) {
  const c = (tierCollections || []).find((x) => x.id === id);
  const label = c ? c.label || c.id : id;
  if (
    !(await confirmDialog(
      i18n(
        "Удалить тир-лист «{name}» вместе со всем содержимым – всеми тайтлами, тирами и персонажами внутри? Отменить это будет нельзя.",
        { name: label }
      )
    ))
  ) {
    return;
  }
  try {
    const res = await fetch("/api/save-chars-tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collection: id, data: [] }),
    });
    const resp = await res.json();
    if (!res.ok || !resp.ok) throw new Error(resp.error || i18n("Ошибка удаления"));

    await patchSiteSettings((settings) => {
      settings.tierCollections = (Array.isArray(settings.tierCollections) ? settings.tierCollections : activeTierCollections()).filter(
        (x) => x.id !== id
      );
      settings.hiddenTierModes = (settings.hiddenTierModes || []).filter((x) => x !== id);
    });
    window.SITE_TIER_COLLECTIONS = activeTierCollections().filter((x) => x.id !== id);
    window.SITE_HIDDEN_TIER_MODES?.delete(id);

    tierCollections = (tierCollections || []).filter((x) => x.id !== id);
    hiddenTierModesState.delete(id);
    tierModeOrderState = tierModeOrderState.filter((k) => k !== id);
    renderTierModesList();
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

