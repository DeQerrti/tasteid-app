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
// Полки другой шкалы, пока открыты настройки: «Названия» и «Числа/Звёзды»
// хранят полку по-разному (ключ против диапазона), но название, цвет и
// описание у неё общие. Раньше при переключении список просто стирался и
// строился заново из стандартных – свои названия приходилось вписывать
// снова, даже если сразу вернулся обратно. Теперь набор уходящей шкалы
// запоминается, а правки названий/цветов/описаний переносятся на ту, куда
// перешли, по порядковому месту полки. Только в памяти: после закрытия
// настроек остаётся лишь активная шкала (это и сохраняется в файл).
let shelvesStash = { categorical: null, numeric: null };
// Ключи полок, у которых показано поле описания, хотя оно пока пустое
// (по ссылке «+ описание»); без этого поле исчезало бы при перерисовке.
let shelfDescOpen = new Set();
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

// ── Перенос оценок при сокращении шкалы ──
// Удалили полку («Шедевр») или оставили в числах пробел в диапазонах – у
// отзывов с такой оценкой в НОВОЙ шкале полки не находится, и они выглядят
// без оценки (само значение в файле остаётся). Пересчёт выше (needsRegrade)
// на такую правку не срабатывает – он только при смене типа или максимума.
// Здесь находим такие отзывы и (askOrphanedGradesTransfer) спрашиваем, на
// какую из оставшихся полок их перенести, чтобы оценки не пришлось ставить
// заново. Оценки, у которых полки не было уже ДО правки, не трогаем – это не
// эта правка их потеряла.
function groupNewlyOrphaned(reviews, oldScale, newScale) {
  const groups = new Map(); // ключ старой полки -> { shelf, raws: Map(строка -> сколько), count }
  for (const r of reviews) {
    const raw = r.grade;
    if (raw === null || raw === undefined || raw === "") continue;
    const oldShelf = shelfForRawGrade(raw, oldScale);
    if (!oldShelf || shelfForRawGrade(raw, newScale)) continue;
    let g = groups.get(oldShelf.key);
    if (!g) groups.set(oldShelf.key, (g = { shelf: oldShelf, raws: new Map(), count: 0 }));
    g.raws.set(String(raw), (g.raws.get(String(raw)) || 0) + 1);
    g.count++;
  }
  return [...groups.values()];
}

// Какую полку предложить по умолчанию. «Числа/Звёзды» – ту, чей диапазон
// ближе всего к потерянному (по значению). «Названия» – ближайшую по месту
// среди полок, что были и раньше (удалили третью из восьми – предложим
// вторую, а не «последнюю»).
function defaultTransferTarget(oldShelf, oldScale, newScale) {
  if (!newScale.shelves.length) return null;
  if (newScale.type !== "categorical") {
    const mid = (Number(oldShelf.min) + Number(oldShelf.max)) / 2;
    let best = null;
    let bestDist = Infinity;
    for (const s of newScale.shelves) {
      const d = mid < s.min ? s.min - mid : mid > s.max ? mid - s.max : 0;
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }
  const oldIdx = oldScale.shelves.findIndex((s) => s.key === oldShelf.key);
  let best = null;
  let bestDist = Infinity;
  for (const s of newScale.shelves) {
    const i = oldScale.shelves.findIndex((o) => o.key === s.key);
    if (i < 0) continue;
    const d = Math.abs(i - oldIdx);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best || newScale.shelves[0];
}

function transferShelfLabel(shelf, scale) {
  if (scale.type === "categorical") return shelf.name;
  const range = Number(shelf.min) === Number(shelf.max) ? String(shelf.min) : `${shelf.min}–${shelf.max}`;
  return `${shelf.name} (${range})`;
}

// Окно «Куда перенести оценки?». Резолвится картой { старое значение -> новое }
// (пустой, если везде выбрано «оставить без оценки») или null, если
// сохранение отменили (Отмена, Escape, клик мимо окна).
function askOrphanedGradesTransfer(groups, oldScale, newScale) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const reviewsWord = (n) => `${n} ${plural(n, [i18n("отзыв"), i18n("отзыва"), i18n("отзывов")])}`;
    const rows = groups
      .map((g, i) => {
        const target = defaultTransferTarget(g.shelf, oldScale, newScale);
        const options = newScale.shelves
          .map(
            (s) =>
              `<option value="${esc(s.key)}"${target && s.key === target.key ? " selected" : ""}>${esc(transferShelfLabel(s, newScale))}</option>`
          )
          .join("");
        return `<div class="regrade-row">
          <div class="regrade-from"><span class="regrade-dot" style="--gc:${esc(g.shelf.color || "#888")}"></span>${esc(transferShelfLabel(g.shelf, oldScale))}
            <span class="regrade-count">${reviewsWord(g.count)}</span></div>
          <span class="regrade-arrow" aria-hidden="true">→</span>
          <select class="regrade-select" data-i="${i}" aria-label="${esc(i18n("Куда перенести"))}">${options}<option value="">${esc(i18n("Оставить без оценки"))}</option></select>
        </div>`;
      })
      .join("");
    overlay.innerHTML = `<div class="modal regrade-dialog" role="dialog" aria-modal="true" aria-labelledby="regrade-title">
      <h2 id="regrade-title" class="section-title">${esc(i18n("Куда перенести оценки?"))}</h2>
      <p class="regrade-lead">${esc(i18n("После правки у части отзывов не осталось полки. Выберите, на какую полку перенести их оценки, – иначе у этих отзывов оценки не будет."))}</p>
      <div class="regrade-rows">${rows}</div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${esc(i18n("Отмена"))}</button>
        <button type="button" class="btn btn-primary" data-act="ok">${esc(i18n("Перенести и сохранить"))}</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const finish = (result) => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(null);
      }
    };
    document.addEventListener("keydown", onKey, true);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.querySelector('[data-act="cancel"]').onclick = () => finish(null);
    overlay.querySelector('[data-act="ok"]').onclick = () => {
      const map = {};
      overlay.querySelectorAll(".regrade-select").forEach((sel) => {
        const g = groups[Number(sel.dataset.i)];
        const target = newScale.shelves.find((s) => s.key === sel.value);
        if (!target) return; // «оставить без оценки»
        for (const raw of g.raws.keys()) map[raw] = rawGradeForShelf(target, newScale);
      });
      finish(map);
    };
    overlay.querySelector(".regrade-select")?.focus();
  });
}

// Сколько отзывов потеряют оценку, если убрать эту полку из ТЕКУЩЕГО списка
// (нужно для пометки в вопросе «Удалить полку?»): считаем по шкале как она
// сейчас в форме, а не по сохранённой, – правок может быть уже несколько.
async function countReviewsLosingShelf(i) {
  // null – посчитать не удалось. Раньше возвращался 0, то есть «таких
  // отзывов нет», и предупреждение при удалении полки молча пропадало.
  let reviews = [];
  try {
    reviews = await fetchVaultList("reviews.json");
  } catch {
    return null;
  }
  const before = { type: scaleType, shelves };
  const after = { type: scaleType, shelves: shelves.filter((_, j) => j !== i) };
  let n = 0;
  for (const r of reviews) {
    const raw = r.grade;
    if (raw === null || raw === undefined || raw === "") continue;
    if (shelfForRawGrade(raw, before) === shelves[i] && !shelfForRawGrade(raw, after)) n++;
  }
  return n;
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
  // Образец оценки под названием: чип с названием полки, «8 / 10», звёзды.
  // Раньше – три кнопки с одними словами и абзац над ними про то, на что
  // выбор влияет.
  const sample = {
    categorical: `<span class="scale-sample-chip">${esc(shelves[1]?.name || i18n("Эталон"))}</span>`,
    numeric: `<span class="scale-sample-num">8<em> / 10</em></span>`,
    stars: `<span class="scale-sample-stars">★★★★★★★★<s>★★</s></span>`,
  };
  grid.innerHTML = SCALE_TYPES.map(
    (t) =>
      `<div class="theme-option scale-card${t.id === scaleType ? " selected" : ""}" data-scale="${t.id}"><span>${t.label}</span><span class="scale-sample">${sample[t.id]}</span></div>`
  ).join("");
  grid.querySelectorAll(".theme-option").forEach((el) => {
    el.onclick = async () => {
      const prevWasCategorical = scaleType === "categorical";
      const newScale = el.dataset.scale;
      const nowIsCategorical = newScale === "categorical";
      // «Названия» и «Числа/Звёзды» хранят полку по-разному (ключ против
      // диапазона), но название, цвет и описание у неё общие – их
      // переносим, а не стираем (раньше тут был диалог «сбросит названия
      // полок», и свои названия вписывались заново, даже если сразу
      // вернулся обратно – см. её же историю в defrostGradeScale,
      // js/theme.js, из-за которой сброс принимали за «перевелось на
      // английский»). Сами оценки отзывов пересчитываются при сохранении
      // отдельно (needsRegrade) и спрашиваются там же.
      if (prevWasCategorical !== nowIsCategorical) {
        const max = Number(document.getElementById("numericMax").value) || (newScale === "stars" ? 5 : 10);
        shelves = switchShelvesTo(nowIsCategorical ? "categorical" : "numeric", max);
      }
      scaleType = newScale;
      settingsDirty = true;
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

// Диапазоны для n полок на шкале 1…max – та же разбивка, что у
// seedNumericShelves(): n полок делят шкалу поровну, начиная с лучшей.
function numericRange(i, n, max) {
  const step = max / n;
  const hi = Math.round(max - i * step);
  const lo = i === n - 1 ? 1 : Math.round(max - (i + 1) * step) + 1;
  return { min: lo, max: hi };
}

// «Названия» -> «Числа/Звёзды»: те же названия, цвета, описания, диапазоны
// раскладываются по шкале поровну. Больше MAX_NUMERIC_SHELVES (или больше
// самого максимума) полок в числах не бывает – лишние остаются в запасе
// shelvesStash и вернутся при переключении назад.
function shelvesToNumeric(src, max) {
  const n = Math.max(1, Math.min(src.length, MAX_NUMERIC_SHELVES, max));
  return src.slice(0, n).map((s, i) => {
    const out = { key: "shelf_" + (i + 1), name: s.name, color: s.color, ...numericRange(i, n, max) };
    if (s.desc) out.desc = s.desc;
    return out;
  });
}

// «Числа/Звёзды» -> «Названия»: ключ у полки нужен настоящий (по нему
// оценки отзывов находят полку), поэтому первым семи отдаём ключи
// GRADES_DEF по порядку, остальным – свои; название, цвет и описание
// остаются теми, что были.
function shelvesToCategorical(src) {
  return src.map((s, i) => {
    const out = {
      key: GRADES_DEF[i]?.key || "custom_" + Date.now().toString(36).slice(-5) + "_" + i,
      name: s.name,
      color: s.color,
    };
    if (s.desc) out.desc = s.desc;
    return out;
  });
}

// Полки для новой шкалы: если её набор уже был (мы с неё ушли в этом же
// сеансе) – берём его, наложив на него названия/цвета/описания, которые
// правили здесь; иначе строим из текущих. Уходящий набор запоминается.
function switchShelvesTo(toKind, max) {
  const from = shelves;
  shelvesStash[toKind === "categorical" ? "numeric" : "categorical"] = from;
  const stashed = shelvesStash[toKind];
  if (stashed) {
    const next = JSON.parse(JSON.stringify(stashed));
    next.forEach((s, i) => {
      const f = from[i];
      if (!f) return;
      s.name = f.name;
      s.color = f.color;
      if (f.desc) s.desc = f.desc;
      else delete s.desc;
    });
    return next;
  }
  return toKind === "categorical" ? shelvesToCategorical(from) : shelvesToNumeric(from, max);
}

// Сменился «Максимум»/«Сколько звёзд»: диапазоны раскладываем заново, а
// названия, цвета и описания оставляем (раньше любая смена максимума
// сбрасывала все полки на стандартные).
function reflowNumericRanges() {
  const max = Number(document.getElementById("numericMax").value) || (scaleType === "stars" ? 5 : 10);
  if (!shelves.length) {
    seedNumericShelves();
    return;
  }
  shelves = shelvesToNumeric(shelves, max);
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
      <div class="shelf-row" data-i="${i}">
        <div class="shelf-row-main">
          ${withRange ? "" : `<span class="shelf-grip" title="${i18n("Перетащить")}">⠿</span>`}
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
          ${s.desc || shelfDescOpen.has(s.key) ? "" : `<button type="button" class="shelf-desc-link" onclick="openShelfDesc(${i}, '${containerId}', ${withRange})">${i18n("+ описание")}</button>`}
          <button class="icon-btn" onclick="removeShelfRow(${i}, '${containerId}', ${withRange})">✕</button>
        </div>
        ${
          s.desc || shelfDescOpen.has(s.key)
            ? `<input type="text" class="shelf-desc" value="${esc(s.desc || "")}"
          onchange="shelves[${i}].desc=this.value" placeholder="${i18n("Описание – показывается подсказкой при наведении")}">`
            : ""
        }
      </div>
    `
    )
    .join("");
  if (!withRange) bindShelvesDnd(container, containerId);
}

// Описание полки – по ссылке «+ описание»: семь одинаковых пустых полей на
// всю ширину читались как шум. Заполненное описание видно всегда.
function openShelfDesc(i, containerId, withRange) {
  shelfDescOpen.add(shelves[i].key);
  renderShelvesList(containerId, withRange);
  document.querySelector(`#${containerId} .shelf-row[data-i="${i}"] .shelf-desc`)?.focus();
}

// Порядок полок «Названий» – то, насколько хороша оценка: сверху лучшая
// (от него считаются статистика и тир-лист). Раньше поменять порядок было
// нечем – своя полка всегда вставала в конец, то есть становилась худшей.
// У «Чисел»/«Звёзд» порядок задают диапазоны, ручки там нет.
let shelfDragFrom = null;
function bindShelvesDnd(container, containerId) {
  container.querySelectorAll(".shelf-row").forEach((row) => {
    const grip = row.querySelector(".shelf-grip");
    if (!grip) return;
    grip.addEventListener("mousedown", () => (row.draggable = true));
    row.addEventListener("dragstart", (e) => {
      shelfDragFrom = Number(row.dataset.i);
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.draggable = false;
      shelfDragFrom = null;
      container.querySelectorAll(".shelf-row").forEach((r) => r.classList.remove("dragging", "drag-over"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (shelfDragFrom === null) return;
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const to = Number(row.dataset.i);
      if (shelfDragFrom === null || shelfDragFrom === to) return;
      const [moved] = shelves.splice(shelfDragFrom, 1);
      shelves.splice(to, 0, moved);
      settingsDirty = true;
      renderShelvesList(containerId, false);
    });
  });
}

function addShelfRow(categorical) {
  if (categorical) {
    const name = i18n("Новая полка");
    const key = "custom_" + name.toLowerCase() + "_" + Date.now().toString(36).slice(-5);
    shelves.push({ key, name, color: "#8b1a1a" });
    settingsDirty = true;
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
    settingsDirty = true;
    renderShelvesList("shelvesList", true);
  }
}

async function removeShelfRow(i, containerId, withRange) {
  // С такой оценкой есть отзывы – скажем об этом сразу: при сохранении
  // предложим перенести их на другую полку (askOrphanedGradesTransfer).
  const lost = await countReviewsLosingShelf(i);
  const note = lost === null
    ? " " + i18n("Не удалось посчитать, сколько отзывов стоит на этой полке, – файл отзывов не читается.")
    : lost
    ? " " +
      i18n("С такой оценкой: {n}. При сохранении предложу перенести их на другую полку.", {
        n: `${lost} ${plural(lost, [i18n("отзыв"), i18n("отзыва"), i18n("отзывов")])}`,
      })
    : "";
  if (!(await confirmDialog(i18n("Удалить полку «{name}»?", { name: shelves[i].name }) + note))) return;
  shelves.splice(i, 1);
  // Клик по кнопке – не input/change, общий слушатель (markSettingsDirty) его
  // не ловит: без этого после одного лишь удаления полки полоса «Сохранить»
  // не появлялась, и правку нечем было сохранить.
  settingsDirty = true;
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
        <div class="tab-row${hiddenTierModesState.has("titles") ? " is-hidden" : ""}" id="tiermoderow-titles" data-key="titles" draggable="true">
          <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
          ${eyeButton(hiddenTierModesState.has("titles"), "hiddenTierModesState.has('titles') ? hiddenTierModesState.delete('titles') : hiddenTierModesState.add('titles'); renderTierModesList(); settingsDirty = true;")}
          <span class="tab-name" id="tiermodename-titles">${esc(tierTitlesLabel)}</span>
          <input type="text" id="tiermodeinput-titles" value="${esc(tierTitlesLabel)}" onkeydown="if(event.key==='Enter')this.blur();">
          <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTierModeEdit('titles')">✎</button>
          <span class="row-slot" aria-hidden="true"></span>
        </div>`;
      }
      const c = (tierCollections || []).find((x) => x.id === key);
      if (!c) return "";
      return `
      <div class="tab-row${hiddenTierModesState.has(c.id) ? " is-hidden" : ""}" id="tiermoderow-${esc(c.id)}" data-key="${esc(c.id)}" draggable="true">
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
    const res = await fetch("/api/delete-tier-collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collection: id }),
    });
    const resp = await res.json();
    if (!res.ok || !resp.ok) throw new Error(resp.error || i18n("Ошибка удаления"));
    // Тихо, как и сам deleteRemoteMedia (js/sync.js) – без неё картинки
    // раздела остались бы висеть в репозитории синхронизации и
    // вернулись бы обратно на следующей автосинхронизации.
    deleteRemoteMediaFolder(id);

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

