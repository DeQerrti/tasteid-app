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
// Управление (создание/переименование/удаление) переехало на саму
// вкладку «Тир-лист» (js/tierlist.js) – здесь только сквозной провоз
// значения при общем сохранении настроек, см. loadCurrentSettings() в
// settings-shortcuts.js и payload в saveSettings() (settings-labels.js).
let tierCollections;

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
// хранить для него нечего. Поэтому отдельные переменные, тот же
// визуальный паттерн (.tab-row), что у статусов и коллекций.
let tierTitlesLabel = i18n("Тайтлы");
let hiddenTierModesState = new Set();

function renderTierModesList() {
  const container = document.getElementById("tierModesList");
  container.innerHTML = `
      <div class="tab-row" id="tiermoderow-titles">
        ${eyeButton(hiddenTierModesState.has("titles"), "hiddenTierModesState.has('titles') ? hiddenTierModesState.delete('titles') : hiddenTierModesState.add('titles'); renderTierModesList();")}
        <span class="tab-name" id="tiermodename-titles">${esc(tierTitlesLabel)}</span>
        <input type="text" id="tiermodeinput-titles" value="${esc(tierTitlesLabel)}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTierModeEdit('titles')">✎</button>
      </div>
    `;
}

function toggleTierModeEdit(id) {
  const row = document.getElementById(`tiermoderow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`tiermodeinput-${id}`).value.trim();
    tierTitlesLabel = val || i18n("Тайтлы");
    document.getElementById(`tiermodename-${id}`).textContent = tierTitlesLabel;
  }
}

