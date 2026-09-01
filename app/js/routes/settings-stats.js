// ══════════════════════════════════════════════
//  settings-stats.js — блоки и цвета вкладки «Статистика» — часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям — читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Блоки статистики ──
const STAT_BLOCKS = [
  { key: "counters", label: i18n("По типам (цифры)") },
  { key: "donut", label: i18n("По типам (диаграмма)") },
  { key: "watch-bars", label: i18n("По годам просмотра") },
  { key: "release-bars", label: i18n("По годам выхода") },
  { key: "grades", label: i18n("Распределение оценок") },
  { key: "rewatch", label: i18n("Пересмотры") },
  { key: "tags", label: i18n("Облако тегов") },
  { key: "spotlight", label: i18n("Топ тайтлы года") },
];
let hiddenStatsState = new Set();

// ── Цвета по типам ──────────────────────────────
// Красят разбивку по типам и годам на вкладке «Статистика»
// (js/stats.js, TYPE_COLORS — это те же ключи и цвета по умолчанию).
// Список типов — тот же, что у BUILTIN_TYPE_DEFAULTS ниже по файлу;
// typeLabels ещё не заполнен на момент объявления, поэтому названия
// читает сама функция рендера, а не константа здесь.
const TYPE_COLOR_DEFAULTS = {
  anime: "#8b1a1a",
  manga: "#1a4a8b",
  manhwa: "#2563a8",
  manhua: "#4a7abf",
  novel: "#5a2d8a",
  book: "#8a4abf",
  movie: "#1a6b3a",
  show: "#2d8a52",
  dorama: "#4aab6e",
  game: "#8b6914",
  gacha: "#c0a020",
};
let typeColors = {};

function renderTypeColorsList() {
  const box = document.getElementById("typeColorsList");
  if (!box) return;
  // Раньше список строился из TYPE_COLOR_DEFAULTS — 11 фиксированных
  // встроенных ключей, — и свои типы (settings.customTypes) в эту
  // панель не попадали вообще: назначить им цвет было негде, и
  // typeColor() в stats.js для них всегда возвращала запасной серый
  // #666. typeLabels уже держит и встроенные, и свои типы (см. их
  // сборку при монтировании выше) — строим список из него, так что
  // новый тип получает свою строку сразу, как только его завели в
  // «Оценки и статусы», без правки этого файла.
  box.innerHTML = Object.keys(typeLabels)
    .map((key) => {
      const label = typeLabels[key] || key;
      const color = typeColors[key] || TYPE_COLOR_DEFAULTS[key] || "#666666";
      return `<div class="pal-row">
        <input type="color" data-type-color="${key}" value="${color}">
        <div class="pal-text"><div class="pal-name">${esc(label)}</div></div>
        <button type="button" class="pal-reset" data-type-reset="${key}"${typeColors[key] ? "" : " hidden"}>${i18n("Цвет по умолчанию")}</button>
      </div>`;
    })
    .join("");
  box.querySelectorAll('input[type="color"]').forEach((input) => {
    input.oninput = () => {
      typeColors[input.dataset.typeColor] = input.value;
      box.querySelector(`[data-type-reset="${input.dataset.typeColor}"]`).hidden = false;
    };
  });
  box.querySelectorAll("[data-type-reset]").forEach((btn) => {
    btn.onclick = () => {
      delete typeColors[btn.dataset.typeReset];
      renderTypeColorsList();
    };
  });
}

function renderStatsList() {
  const container = document.getElementById("statsList");
  container.innerHTML = STAT_BLOCKS.map(
    (b) => `
      <div class="tab-row">
        ${eyeButton(hiddenStatsState.has(b.key), `hiddenStatsState.has('${b.key}') ? hiddenStatsState.delete('${b.key}') : hiddenStatsState.add('${b.key}'); renderStatsList();`)}
        <span class="tab-name">${esc(b.label)}</span>
      </div>
    `
  ).join("");
}

