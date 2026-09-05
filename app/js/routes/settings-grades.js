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
// Шкала на момент открытия страницы – см. её же присвоение в
// settings-shortcuts.js/loadCurrentSettings() и buildRegradeMap() ниже.
let originalGradeScale = null;

const DEFAULT_SHELF_COLORS = ["#7c3aed", "#2563a8", "#2d8a4e", "#d4a017", "#6b7280", "#c0392b", "#8B6914"];

// «Числа»/«Звёзды» показывают полку не своим именем, а самим числом
// или нарисованными звёздами (см. shelfDisplayLabel() в config.js) –
// больше десяти полок значило бы либо двузначные диапазоны такой
// длины, что фильтр в «Отзывах» ими не помещался бы в разумную
// ширину, либо (для звёзд) ряд из мало отличимых на глаз звёздочек.
// «Названия» этим не ограничены – там полка это и есть имя, сколько
// бы их ни было.
const MAX_NUMERIC_SHELVES = 10;

function clampNumericMax() {
  const el = document.getElementById("numericMax");
  const clamped = Math.min(MAX_NUMERIC_SHELVES, Math.max(2, Number(el.value) || 10));
  el.value = clamped;
}

// ── Пересчёт уже поставленных оценок при смене шкалы ──
// «Названия» хранят оценку как строку-ключ полки, «Числа»/«Звёзды» –
// как само число; переход между ними меняет сам формат хранения, и
// без пересчёта старые оценки просто переставали бы находить свою
// полку под новой шкалой (gradeToShelf() в config.js вернул бы null).
// Смена только диапазонов (min/max) внутри «Чисел»/«Звёзд» без смены
// максимума пересчёта не требует вовсе: сырое число не меняется, а
// какой полке оно соответствует, gradeToShelf() и так решает заново
// каждый раз по актуальной шкале – это и есть вся идея хранить сырое
// число, а не готовую полку. Именно поэтому needsRegrade() ниже не
// реагирует на правку названий/цветов/границ саму по себе: если
// реагировать на любую правку scaleType-объекта, пересчёт заодно
// схлопывал бы точные числа/звёзды до середины их полки даже там, где
// в этом не было никакой необходимости, — а вот смена macimum (5
// звёзд → 10) требует пересчёта ровно по той же причине, что и смена
// типа: диапазоны становятся другими не только числом, но и смыслом
// (5 из 5 – не то же самое, что 5 из 10).
function needsRegrade(oldScale, newScale) {
  if (!oldScale) return false; // нечего сравнивать – страница только открылась
  const oldCategorical = oldScale.type === "categorical";
  const newCategorical = newScale.type === "categorical";
  if (oldCategorical !== newCategorical) return true;
  if (!newCategorical && Number(oldScale.numericMax) !== Number(newScale.numericMax)) return true;
  return false;
}

// Позиция полки в её же массиве (0 – лучшая) – единственное, что
// переносится через смену шкалы: сама полка («Эталон») могла быть и
// второй из семи, и второй из пяти, раз её порядковое место в списке
// не изменилось. Пропорция, а не «столько же с конца», — чтобы более
// короткая/длинная новая шкала не съезжала целиком к одному краю.
function shelfPositionMap(oldShelves, newShelves) {
  const map = new Map(); // старый key -> новая полка
  const oldLen = oldShelves.length;
  const newLen = newShelves.length;
  if (!oldLen || !newLen) return map;
  oldShelves.forEach((shelf, i) => {
    const newIndex = oldLen === 1 ? 0 : Math.round((i * (newLen - 1)) / (oldLen - 1));
    map.set(shelf.key, newShelves[Math.min(newIndex, newLen - 1)]);
  });
  return map;
}

// Сырое значение конкретного отзыва (строка-ключ или число) -> его
// полка в СТАРОЙ шкале. Та же логика, что у gradeToShelf() в
// config.js, но принимает шкалу параметром – gradeToShelf() всегда
// читает текущую (window.SITE_GRADE_SCALE), а нам здесь ровно наоборот
// нужна шкала ДО правки.
function shelfForRawGrade(rawGrade, scale) {
  if (rawGrade === null || rawGrade === undefined || rawGrade === "") return null;
  if (scale.type === "categorical") return scale.shelves.find((s) => s.key === rawGrade) || null;
  const num = Number(rawGrade);
  if (Number.isNaN(num)) return null;
  return scale.shelves.find((s) => num >= s.min && num <= s.max) || null;
}

// Готовое сырое значение отзыва под НОВУЮ шкалу для данной полки:
// ключ для «Названий», середина диапазона (округлённая) для «Чисел»/
// «Звёзд» – единственное разумное число, когда переносится не точная
// оценка, а «примерно такая же полка», см. её же обсуждение с
// владельцем про алгоритм по позиции полки.
function rawGradeForShelf(shelf, scale) {
  if (scale.type === "categorical") return shelf.key;
  return Math.round((Number(shelf.min) + Number(shelf.max)) / 2);
}

// Строит { старое сырое значение (как строка) -> новое сырое значение }
// по всем оценкам, реально встретившимся в отзывах, – не по всем
// теоретически возможным числам шкалы (при «Числах» с максимумом 100
// это была бы карта на 100 записей почти всегда впустую).
//
// orphaned – сырые значения, для которых полка не нашлась уже в
// СТАРОЙ шкале (например, полку с таким ключом когда-то удалили, а
// оценка у отзыва осталась) – такие оценки не видны нигде в
// приложении ещё до этой правки, регрейд их не портит и не чинит, но
// раньше человек об этом узнавал только сам, наткнувшись на отзыв без
// оценки. Возвращаем список наружу, чтобы saveSettings() мог хотя бы
// предупредить, а не промолчать.
function buildRegradeMap(usedRawGrades, oldScale, newScale) {
  const shelfMap = shelfPositionMap(oldScale.shelves, newScale.shelves);
  const map = {};
  const orphaned = [];
  for (const raw of usedRawGrades) {
    const oldShelf = shelfForRawGrade(raw, oldScale);
    if (!oldShelf) {
      orphaned.push(raw);
      continue;
    }
    const newShelf = shelfMap.get(oldShelf.key);
    if (!newShelf) continue; // shelfPositionMap покрывает все ключи oldScale.shelves – сюда дойти не должны
    map[String(raw)] = rawGradeForShelf(newShelf, newScale);
  }
  return { map, orphaned };
}

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
    if (shelves.length >= MAX_NUMERIC_SHELVES) {
      alert(i18n("Больше {v0} полок для чисел/звёзд не бывает.", { v0: MAX_NUMERIC_SHELVES }));
      return;
    }
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
          ${eyeButton(hiddenTierModesState.has("titles"), "hiddenTierModesState.has('titles') ? hiddenTierModesState.delete('titles') : hiddenTierModesState.add('titles'); renderTierModesList(); settingsDirty = true;")}
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
        ${eyeButton(hiddenTierModesState.has(c.id), `hiddenTierModesState.has('${c.id}') ? hiddenTierModesState.delete('${c.id}') : hiddenTierModesState.add('${c.id}'); renderTierModesList(); settingsDirty = true;`)}
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
        "Удалить тир-лист «{name}» вместе со всем содержимым – всеми темами, тирами и персонажами внутри? Отменить это будет нельзя.",
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
    hiddenTierModesState.delete(id);
    tierModeOrderState = tierModeOrderState.filter((k) => k !== id);
    // refreshTierCollectionsElsewhere() (chars-edit.js) сама обновляет
    // tierCollections/renderTierModesList() здесь же и, если вкладка
    // «Тир-лист» уже открыта фоном, перерисовывает и её – без этого
    // вызова удалённый раздел висел там до перезахода: настройки
    // писали на диск сразу, но никто не говорил уже отрисованной
    // вкладке, что список изменился.
    refreshTierCollectionsElsewhere();
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

