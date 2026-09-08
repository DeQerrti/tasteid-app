// ══════════════════════════════════════════════
//  STATS – вкладка Статистика
//  Читает только из reviews.json
//  Зависит от: config.js, api.js, cards.js
// ══════════════════════════════════════════════

// ── Цвета по типам ─────────────────────────────
// Берутся из config.js (MEDIA_TYPES) – единственного места, где
// перечислены встроенные типы. Добавлять цвет для нового типа здесь
// больше не нужно, он приезжает вместе с MEDIA_TYPES.
const TYPE_COLORS = Object.fromEntries(MEDIA_TYPES.map((t) => [t.key, t.color]));

// Настройки → Статистика → «Цвета по типам» – своя перекраска поверх
// TYPE_COLORS, ключ в ключ. Без своего цвета остаётся значение выше.
function typeColor(key) {
  return (window.SITE_TYPE_COLORS && window.SITE_TYPE_COLORS[key]) || TYPE_COLORS[key] || "#666";
}

// Выбранный год дайджеста. "all" – обычная статистика за всё время.
const statsState = { year: "all" };

async function loadStats() {
  if (loading.stats) return;
  loading.stats = true;

  const box = document.getElementById("tab-stats");
  box.innerHTML = `<div class="state-box"><div class="spinner"></div>${i18n("Считаем…")}</div>`;

  try {
    await fetchReviews();
    statsRender();
  } catch (err) {
    box.innerHTML = `<div class="state-box">${i18n("Ошибка:")} ${esc(err.message)}</div>`;
  } finally {
    loading.stats = false;
  }
}

// Тайтл считается "завершённым в году Y", если в этом году дата
// окончания (или начала, если конца нет – старые записи без date_end)
function statsCompletedYear(r) {
  const raw = r.date_end || r.date_start || r.date;
  return raw ? new Date(raw).getFullYear() : null;
}

function statsRender() {
  const box     = document.getElementById("tab-stats");
  const reviews = cache.reviews || [];

  const completed = reviews.filter(r =>
    r.status === "completed" || (!r.status && (r.preview || r.grade))
  );

  const yearsSet = new Set();
  for (const r of completed) {
    const y = statsCompletedYear(r);
    if (y) yearsSet.add(y);
  }
  const years = [...yearsSet].sort((a, b) => b - a);

  const filtersHtml = `<div class="stat-toolbar">
    ${statsYearFiltersHtml(years)}
    ${cameraButton("openStatsExportModal()", "stats-export-btn")}
  </div>`;
  const bodyHtml = statsState.year === "all"
    ? renderAllTimeStats(reviews, completed)
    : renderYearDigest(statsState.year, completed);

  box.innerHTML = filtersHtml + bodyHtml;

  fixLoneStatCard();
  // matchTagsCardHeight() – раньше fitOversizedTags(). Порядок важен:
  // до ограничения высоты у облака тегов ещё нет своей вертикальной
  // прокрутки и scrollbar её не отъедает от ширины ряда; как только
  // matchTagsCardHeight() выставляет max-height и прокрутка появляется,
  // она забирает под себя ~15px ширины – тег, который влезал секунду
  // назад, мог как раз в этот запас и не влезть. Меряем реальную ширину
  // уже после того, как скроллбар (если он будет) точно на месте.
  matchTagsCardHeight();
  fitOversizedTags();
  animateCounters();
  animateStackedBars();
  statsBindAll();
}

// Тегов может быть куда больше, чем влезает в высоту соседней карточки
// в той же строке грида (например, "Пересмотры") – раньше облако тегов
// просто росло сколько нужно, растягивая заодно и всю строку грида
// (align-items: stretch), и соседка с коротким содержимым оставалась
// растянутой заодно, с пустотой внутри. Нужно наоборот: высоту строки
// должна задавать соседка, а лишние теги сверх этой высоты – прятаться
// под свою прокрутку внутри карточки тегов, а не раздувать строку.
//
// Мерить "естественную" высоту соседки нельзя напрямую через
// getBoundingClientRect() – та уже растянута тем же align-items:
// stretch под текущую (раздутую тегами) высоту строки, а не под
// собственное содержимое. На время замера снимаем растяжение у обеих
// карточек (align-self: start) – тогда у каждой видна её настоящая
// высота, meряем соседку, и сразу возвращаем как было; после этого
// max-height у .stat-tag-cloud, а не у всей карточки – карточка
// по-прежнему тянется вместе со строкой (визуально совпадает с
// соседкой), просто её содержимому внутри этого предела уже некуда
// расти дальше, кроме собственной прокрутки.
function matchTagsCardHeight() {
  const tagsCard = document.querySelector(".stat-card-tags");
  if (!tagsCard) return;
  const cloud = tagsCard.querySelector(".stat-tag-cloud");
  const header = tagsCard.querySelector(".section-title");
  if (!cloud || !header) return;
  // Статистику иногда перерисовывают, пока сама вкладка ещё скрыта –
  // например, refreshOpenReviewsTab() (js/api.js) дёргает loadStats()
  // сразу после сохранения настроек в /settings-edit, а вкладка «Статусы»
  // в этот момент всё ещё спрятана позади открытого маршрута настроек
  // (#shell-root.hidden). offsetParent === null для display:none и
  // любого его скрытого предка – верный признак "мерить сейчас нечего":
  // getBoundingClientRect() вернула бы одни нули, "сосед" нашёлся бы по
  // случайному совпадению (у всех top: 0), а max-height запомнил бы
  // такой мусор в inline-style на будущее. Ничего не трогаем – когда
  // вкладка станет видимой, тот же вызов из router.js (см. её же
  // комментарий там) перемеряет всё заново правильно.
  if (tagsCard.offsetParent === null) return;

  cloud.style.maxHeight = "";

  const grid = tagsCard.closest(".stat-grid");
  if (!grid) return;
  const myTop = tagsCard.getBoundingClientRect().top;
  const sibling = [...grid.children].find(
    (el) => el !== tagsCard && Math.abs(el.getBoundingClientRect().top - myTop) < 1
  );
  // Одна в своей строке (нечётное число блоков, см. fixLoneStatCard) –
  // сравнивать не с кем. На ПК колонка и так не на всю ширину экрана –
  // пусть занимает столько высоты, сколько нужно. На телефоне же
  // одинокий блок растягивается на всю ширину экрана (.stat-card-solo,
  // index.html) и с ней же – сколько бы ни было тегов, они укладывались
  // в 1-2 строки почти во всю длину телефона, а не оставались тем же
  // компактным блоком, каким были рядом с соседкой. Ограничиваем той же
  // высотой в 4 строки, что и раньше была бы видна рядом с соседкой –
  // остальное так же под прокрутку внутри.
  if (!sibling) {
    if (window.matchMedia("(max-width: 700px)").matches) capToRows(cloud, 4);
    return;
  }

  tagsCard.style.alignSelf = "start";
  sibling.style.alignSelf = "start";
  const siblingHeight = sibling.getBoundingClientRect().height;
  const overhead = tagsCard.getBoundingClientRect().height - cloud.getBoundingClientRect().height;
  tagsCard.style.alignSelf = "";
  sibling.style.alignSelf = "";

  cloud.style.maxHeight = `${Math.max(40, siblingHeight - overhead)}px`;
}

// Высота одной строки тегов не фиксированная константа – у каждого тега
// свой размер шрифта (scale в renderTagCloud), поэтому меряем по факту:
// берём реальные позиции уже отрисованных (не ограниченных по высоте)
// тегов и находим, на какой высоте начинается пятая строка – именно
// туда и обрезаем, а не гадаем "среднюю" высоту строки заранее.
function capToRows(cloud, rows) {
  const items = [...cloud.children];
  if (!items.length) return;
  const rowTops = [...new Set(items.map((el) => Math.round(el.getBoundingClientRect().top)))].sort(
    (a, b) => a - b
  );
  // Строк и так меньше предела – обрезать нечего.
  if (rowTops.length <= rows) return;
  const firstHeight = items[0].getBoundingClientRect().height;
  const rowStep = rowTops[1] - rowTops[0];
  cloud.style.maxHeight = `${firstHeight + rowStep * (rows - 1)}px`;
}

// Тег, который даже один в своей строке шире самой карточки (частый тег
// с крупным авторским размером в узкой колонке телефона – см. scale в
// renderTagCloud), раньше просто обрезался многоточием через CSS
// (.stat-tag – index.html). Здесь – настоящее решение: подгоняем именно
// этому тегу размер шрифта под реальную ширину ряда, а не прячем лишнее
// под "…". Меряем после того, как разметка уже в DOM и .stat-tag-cloud
// получила настоящую ширину (offsetWidth/clientWidth = 0 до этого).
//
// scrollWidth сравниваем с СОБСТВЕННЫМ clientWidth тега, а не с шириной
// всего ряда: max-width:100% (index.html) уже сжимает clientWidth тега
// до ширины ряда, но clientWidth border-box'а исключает border, а
// scrollWidth его учитывает – при бордере в 1-2px (rtag-категории со
// своим border) сравнение с шириной ряда напрямую было систематически
// на пару пикселей строже, чем нужно, и CSS-эллипсис из index.html всё
// равно подключался на паре пикселей текста, даже когда шрифт уже был
// ужат «под ноль». Со сравнением тега с самим собой оба числа считаются
// одной и той же коробкой – переполнение показывает по-настоящему то,
// что не влезло, без систематической ошибки на толщину border.
function fitOversizedTags() {
  document.querySelectorAll(".stat-tag-cloud").forEach((cloud) => {
    if (!cloud.clientWidth) return;
    cloud.querySelectorAll(".stat-tag").forEach((tag) => {
      const base = parseFloat(tag.dataset.baseSize);
      if (!base) return;
      let size = base;
      tag.style.fontSize = `${size}rem`;
      // Нижняя граница (.55rem) – защита от нечитаемо мелкого текста на
      // экстремально длинном теге; ниже неё уже подключается ellipsis
      // из CSS как последний рубеж, а не подгонка размера.
      //
      // ВАЖНО: сравнение именно "> ", без вычитаний-допусков – scrollWidth
      // и clientWidth целые, и любое "- 1"/"+ 1" тут ломает всё: у
      // равных чисел a > a-1 истинно ВСЕГДА, то есть цикл ужимал бы
      // КАЖДЫЙ тег до нижней границы независимо от того, было ли
      // переполнение вообще (было и попало в релиз – шрифт тегов на ПК
      // ужимался в пол даже там, где места было в избытке). Простое
      // строгое "больше" не идеальнее на границе в доли пикселя, но
      // подгонка размера тут не обязана ловить каждую долю пикселя –
      // CSS text-overflow: ellipsis (.stat-tag, index.html) остаётся
      // подстраховкой на этот редкий случай.
      let guard = 0;
      while (tag.scrollWidth > tag.clientWidth && size > 0.55 && guard < 20) {
        size -= 0.05;
        tag.style.fontSize = `${size.toFixed(2)}rem`;
        guard++;
      }
    });
  });
}

// Последняя не-.wide карточка иногда остаётся без пары в своей строке
// (нечётное число включённых обычных блоков) – место под вторую половину
// строки просто пустует до конца сетки, хотя сама карточка вполне могла
// бы его занять. grid-auto-flow: dense (см. .stat-grid, index.html) не
// помогает именно этому случаю – ему просто нечем заполнить дыру,
// подходящих карточек ПОСЛЕ неё не осталось. Простой nth-child здесь не
// годится: .wide-карточки сбивают чёт/нечет, они занимают всю строку
// сами, а не через "второй столбец", – поэтому парность считаем в JS,
// проходя по факту так же, как это делает сама раскладка грида.
function fixLoneStatCard() {
  const grid = document.querySelector("#tab-stats .stat-grid");
  if (!grid) return;
  let pairedSlotOpen = false;
  let lastAlone = null;
  for (const el of grid.children) {
    el.classList.remove("stat-card-solo");
    if (el.classList.contains("wide")) {
      pairedSlotOpen = false;
      lastAlone = null;
      continue;
    }
    if (!pairedSlotOpen) {
      lastAlone = el;
      pairedSlotOpen = true;
    } else {
      lastAlone = null;
      pairedSlotOpen = false;
    }
  }
  lastAlone?.classList.add("stat-card-solo");
}

// ── Переключатель года ─────────────────────────
function statsYearFiltersHtml(years) {
  const allBtn = `<button class="tl-filter${statsState.year === "all" ? " active" : ""}" data-stat-year="all">${i18n("Всё время")}</button>`;
  const yearBtns = years.map(y =>
    `<button class="tl-filter${String(statsState.year) === String(y) ? " active" : ""}" data-stat-year="${y}">${y}</button>`
  ).join("");
  return `<div class="stat-year-filters">${allBtn}${yearBtns}</div>`;
}

function statsBindAll() {
  document.querySelectorAll(".tl-filter[data-stat-year]").forEach(btn => {
    btn.addEventListener("click", () => {
      statsState.year = btn.dataset.statYear === "all" ? "all" : parseInt(btn.dataset.statYear);
      statsRender();
    });
  });
}

// ── Статистика за всё время (как было) ─────────
function renderAllTimeStats(reviews, completed) {
  const withGrade = reviews.filter(r => r.grade);

  const typeCounts = {};
  for (const r of withGrade) {
    const t = r.type || "anime";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const counts = Object.entries(TYPE_LABELS)
    .map(([key, label]) => ({ key, label, val: typeCounts[key] || 0, color: typeColor(key) }))
    .filter(c => c.val > 0);
  const total = counts.reduce((s, c) => s + c.val, 0);

  const watchYearsByType = {};
  for (const r of completed) {
    const y = statsCompletedYear(r);
    if (!y) continue;
    const t = r.type || "anime";
    if (!watchYearsByType[y]) watchYearsByType[y] = {};
    watchYearsByType[y][t] = (watchYearsByType[y][t] || 0) + 1;
  }

  const releaseYearsByType = {};
  for (const r of withGrade) {
    const y = parseInt(r.year);
    if (!y) continue;
    const t = r.type || "anime";
    if (!releaseYearsByType[y]) releaseYearsByType[y] = {};
    releaseYearsByType[y][t] = (releaseYearsByType[y][t] || 0) + 1;
  }

  const gradeCounts = {};
  for (const r of withGrade) { const s = gradeToShelf(r.grade); if (s) gradeCounts[s] = (gradeCounts[s] || 0) + 1; }

  const tagCounts = {};
  for (const r of reviews) {
    for (const tag of (r.tags || [])) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);

  return `<div class="stat-grid">
    ${isStatVisible("counters")   ? withStatKey(renderCounters(counts, total), "counters") : ""}
    ${isStatVisible("donut")      ? withStatKey(renderDonut(counts, total), "donut") : ""}
    ${isStatVisible("grades")     ? withStatKey(renderGradeChart(gradeCounts), "grades") : ""}
    ${isStatVisible("watch-bars") ? withStatKey(renderStackedBarChart(siteLabel("stats", "watchYears", i18n("По годам просмотра")), "watch-bars", watchYearsByType), "watch-bars") : ""}
    ${isStatVisible("release-bars") ? withStatKey(renderStackedBarChart(siteLabel("stats", "releaseYears", i18n("По годам выхода")), "release-bars", releaseYearsByType), "release-bars") : ""}
    ${isStatVisible("rewatch")    ? withStatKey(renderRewatchStats(reviews), "rewatch") : ""}
    ${isStatVisible("tags")       ? withStatKey(renderTagCloud(topTags), "tags") : ""}
  </div>`;
}

// data-stat-key размечает готовую HTML-строку секции – по нему модалка
// выбора блоков перед снимком (openStatsExportModal ниже) находит нужный
// узел в живом .stat-grid и на время скрывает невыбранные, вместо того
// чтобы городить отдельную офскрин-копию разметки (как у «Любимого»):
// секции статистики и так уже готовы на странице, прятать проще, чем
// пересобирать заново.
function withStatKey(html, key) {
  return html.replace("<section ", `<section data-stat-key="${key}" `);
}

// ── Годовой дайджест ────────────────────────────
function renderYearDigest(year, completed) {
  const yearReviews = completed.filter(r => statsCompletedYear(r) === year);
  const withGrade   = yearReviews.filter(r => r.grade);

  const typeCounts = {};
  for (const r of withGrade) {
    const t = r.type || "anime";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const counts = Object.entries(TYPE_LABELS)
    .map(([key, label]) => ({ key, label, val: typeCounts[key] || 0, color: typeColor(key) }))
    .filter(c => c.val > 0);
  const total = counts.reduce((s, c) => s + c.val, 0);

  if (!total) {
    const emptyText = siteLabel("stats", "emptyYear", i18n("За {year} год пока нет завершённых с оценкой"));
    return `<div class="state-box">${esc(emptyText.replace("{year}", year))}</div>`;
  }

  const gradeCounts = {};
  for (const r of withGrade) { const s = gradeToShelf(r.grade); if (s) gradeCounts[s] = (gradeCounts[s] || 0) + 1; }

  const tagCounts = {};
  for (const r of yearReviews) {
    for (const tag of (r.tags || [])) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

  const spotlight = statsTopTitlesOfYear(withGrade);

  return `
    <div id="stats-digest" class="stat-grid">
      ${isStatVisible("counters") ? withStatKey(renderCounters(counts, total, i18n("Итоги {year}", { year }), siteLabel("stats", "completed", i18n("завершено"))), "counters") : ""}
      ${isStatVisible("donut")    ? withStatKey(renderDonut(counts, total), "donut") : ""}
      ${isStatVisible("grades")   ? withStatKey(renderGradeChart(gradeCounts), "grades") : ""}
      ${isStatVisible("spotlight") ? withStatKey(renderTitleOfYear(spotlight, year), "spotlight") : ""}
      ${isStatVisible("rewatch")  ? withStatKey(renderRewatchStats(yearReviews), "rewatch") : ""}
      ${isStatVisible("tags")     ? withStatKey(renderTagCloud(topTags), "tags") : ""}
    </div>
  `;
}

// Лучшая оценка года (минимальный gradeScore – в начале GRADE_ORDER лежат
// лучшие оценки). При нескольких тайтлах с одинаковой лучшей оценкой
// показываем все, но не больше 6, чтобы не раздувать дайджест.
function statsTopTitlesOfYear(withGrade) {
  if (!withGrade.length) return [];
  let best = Infinity;
  for (const r of withGrade) {
    const s = gradeScore(gradeToShelf(r.grade));
    if (s !== null && s < best) best = s;
  }
  if (best === Infinity) return [];
  return withGrade.filter(r => gradeScore(gradeToShelf(r.grade)) === best).slice(0, 6);
}

function renderTitleOfYear(list, year) {
  if (!list.length) return "";
  const heading = (list.length > 1
    ? siteLabel("stats", "spotlightMany", i18n("Тайтлы {year} года"))
    : siteLabel("stats", "spotlightOne", i18n("Тайтл {year} года"))
  ).replace("{year}", year);
  const cards = list.map((r, i) => `<div class="year-spotlight-item">${manualCard(r, i)}</div>`).join("");
  return `<section class="stat-section stat-card wide">
    <h2 class="section-title">${esc(heading)}</h2>
    <div class="year-spotlight-grid">${cards}</div>
  </section>`;
}

// ── Счётчики ───────────────────────────────────
// plural() живёт в js/utils.js: он понадобился и настройкам, и импорту,
// а stats.js подключают не все страницы.

function renderCounters(counts, total, sectionTitle = null, totalLabel = null) {
  sectionTitle = sectionTitle ?? siteLabel("stats", "total", i18n("Всего"));
  // По умолчанию – склоняемое "тайтл/тайтла/тайтлов".
  // Если передана строка ("завершено") – используем её как есть без склонения.
  const label = totalLabel !== null
    ? totalLabel
    : plural(total, unitForms());
  const items = counts.map(c => {
    const forms = TYPE_PLURAL[c.key];
    const subLabel = forms ? plural(c.val, forms) : c.label;
    const pluralAttr = forms ? `data-plural="${forms.join("|")}"` : "";
    return `
    <div class="stat-counter">
      <div class="stat-counter-val" data-target="${c.val}" style="color:${c.color}">0</div>
      <div class="stat-counter-label" ${pluralAttr}>${esc(subLabel)}</div>
    </div>
  `;
  }).join("");

  return `<section class="stat-section stat-card wide">
    <h2 class="section-title">${esc(sectionTitle)}</h2>
    <div class="stat-total">
      <span class="stat-total-num" data-target="${total}">0</span>
      <span class="stat-total-label" ${!totalLabel ? `data-plural="${esc(unitForms().join("|"))}"` : ""}>${esc(label)}</span>
    </div>
    <div class="stat-counters">${items}</div>
  </section>`;
}

// ── Пончик ─────────────────────────────────────
function renderDonut(counts, total) {
  if (!total) return "";
  const r = 80, cx = 100, cy = 100;
  const circumference = 2 * Math.PI * r;

  const legend = counts.map(c => `
    <div class="donut-legend-item">
      <span class="donut-dot" style="background:${c.color}"></span>
      <span class="donut-legend-label">${esc(c.label)}</span>
      <span class="donut-legend-val">${c.val}</span>
      <span class="donut-legend-pct">${Math.round(c.val / total * 100)}%</span>
    </div>
  `).join("");

  let accum = 0;
  const segs = counts.map(c => {
    const pct  = c.val / total;
    const dash = pct * circumference;
    const seg  = `<circle cx="${cx}" cy="${cy}" r="${r}"
      fill="none" stroke="${c.color}" stroke-width="16"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(circumference - accum * circumference).toFixed(2)}"
      style="transform:rotate(-90deg);transform-origin:${cx}px ${cy}px"/>`;
    accum += pct;
    return seg;
  }).join("");

  return `<section class="stat-section stat-card">
    <h2 class="section-title">${esc(siteLabel("stats", "types", i18n("Разбивка по типам")))}</h2>
    <div class="stat-donut-wrap">
      <svg viewBox="0 0 200 200" class="stat-donut-svg">
        ${segs}
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="donut-center-num">${total}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="donut-center-label">${i18n("всего")}</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  </section>`;
}

// ── Стековые барчарты по годам ─────────────────
// yearsByType: { year: { type: count } }
function renderStackedBarChart(title, id, yearsByType) {
  const years = Object.keys(yearsByType).sort((a, b) => a - b);
  if (!years.length) return "";

  const totals = years.map(y => Object.values(yearsByType[y]).reduce((s, v) => s + v, 0));
  const max = Math.max(...totals);

  const bars = years.map((year, yi) => {
    const yearTotal = totals[yi];
    const pct = max ? (yearTotal / max * 100) : 0;

    const segments = Object.entries(TYPE_LABELS)
      .map(([key]) => ({ key, val: yearsByType[year][key] || 0, color: typeColor(key) }))
      .filter(s => s.val > 0)
      .map(s => {
        const segPct = yearTotal ? (s.val / yearTotal * 100).toFixed(2) : 0;
        return `<div class="year-bar-seg"
          style="height:${segPct}%;background:${s.color}"
          title="${TYPE_LABELS[s.key] || s.key}: ${s.val}"></div>`;
      }).join("");

    return `<div class="year-bar-wrap">
      <div class="year-bar-track">
        <div class="year-bar-stack" data-pct="${pct.toFixed(1)}" style="height:0%">
          ${segments}
        </div>
      </div>
      <div class="year-bar-val">${yearTotal}</div>
      <div class="year-bar-label">${esc(String(year))}</div>
    </div>`;
  }).join("");

  return `<section class="stat-section stat-card wide">
    <h2 class="section-title">${esc(title)}</h2>
    <div class="year-bars-wrap" id="${id}">${bars}</div>
  </section>`;
}

// ── Оценки ─────────────────────────────────────
function renderGradeChart(gradeCounts) {
  const total = Object.values(gradeCounts).reduce((s, v) => s + v, 0);
  if (!total) return "";
  const max = Math.max(...Object.values(gradeCounts));

  const bars = GRADE_ORDER.map(key => {
    const g   = GRADES[key];
    if (!g) return "";
    const val = gradeCounts[key] || 0;
    const pct = max ? (val / max * 100) : 0;
    return `<div class="grade-row">
      <div class="grade-row-label" style="color:${g.color}">${esc(g.name)}</div>
      <div class="grade-row-track">
        <div class="grade-row-bar" data-pct="${pct.toFixed(1)}" style="width:0%;background:${g.color}"></div>
      </div>
      <div class="grade-row-val">${val}</div>
    </div>`;
  }).join("");

  return `<section class="stat-section stat-card">
    <h2 class="section-title">${esc(siteLabel("stats", "grades", i18n("Шкала послевкусия")))}</h2>
    <div class="grade-bars">${bars}</div>
  </section>`;
}

// ── Облако тегов ───────────────────────────────
function renderRewatchStats(reviews) {
  const rewatched = reviews.filter(r => r.rewatch_count > 0);
  if (!rewatched.length) return "";

  const totalRewatches = rewatched.reduce((sum, r) => sum + r.rewatch_count, 0);
  const top = [...rewatched].sort((a, b) => b.rewatch_count - a.rewatch_count)[0];

  return `<section class="stat-section stat-card">
    <h2 class="section-title">${esc(siteLabel("stats", "rewatch", i18n("Пересмотры")))}</h2>
    <div class="stat-counters stat-counters-rewatch">
      <div class="stat-counter">
        <div class="stat-counter-val" data-target="${rewatched.length}" style="color:var(--red-hi)">0</div>
        <div class="stat-counter-label">${esc(plural(rewatched.length, [
          siteLabel("stats", "rewatchOne", i18n("тайтл пересмотрен")),
          siteLabel("stats", "rewatchFew", i18n("тайтла пересмотрено")),
          siteLabel("stats", "rewatchMany", i18n("тайтлов пересмотрено")),
        ]))}</div>
      </div>
      <div class="stat-counter">
        <div class="stat-counter-val" data-target="${totalRewatches}" style="color:var(--red-hi)">0</div>
        <div class="stat-counter-label">${esc(plural(totalRewatches, [i18n("пересмотр всего"), i18n("пересмотра всего"), i18n("пересмотров всего")]))}</div>
      </div>
    </div>
    <div class="stat-rewatch-top">${i18n("Больше всего пересмотрено:")} <b>${esc(top.title)}</b> (×${top.rewatch_count})</div>
  </section>`;
}

function renderTagCloud(topTags) {
  if (!topTags.length) return "";
  const max = topTags[0][1];
  const items = topTags.map(([tag, cnt]) => {
    const info  = TAGS_MAP[tag];
    const customColor = info && CAT_COLORS[info.cat];
    const cls = customColor ? "rtag-custom" : TAG_CAT_CLASS[info?.cat] || "rtag-special";
    const styleAttr = customColor ? `--tag-color:${customColor};` : "";
    const scale = 0.8 + (cnt / max) * 0.7;
    // data-base-size хранит "авторский" размер отдельно от style –
    // fitOversizedTags() ниже перезаписывает сам style, уменьшая шрифт
    // тем тегам, что не влезают в свою строку; без отдельно сохранённого
    // оригинала повторный проход (например, при следующей отрисовке уже
    // с другим годом) ужимал бы уже однажды ужатый размер ещё раз.
    return `<span class="rtag ${cls} stat-tag" style="${styleAttr}font-size:${scale.toFixed(2)}rem" data-base-size="${scale.toFixed(2)}"
      data-tip="${esc(info?.tip || "")}">${esc(tag)} <span class="stat-tag-cnt">${cnt}</span></span>`;
  }).join("");
  // Без .wide – раньше эта карточка всегда занимала всю ширину грида,
  // и если перед ней в своей строке оказывалась одна-единственная
  // некрупная карточка (например, «Пересмотры»), вторая половина той
  // же строки оставалась пустой: следующим шёл именно этот, уже
  // растянутый на весь ряд блок, и заполнить собой дыру он не мог. Как
  // обычная карточка сетки, он сам встаёт в свободную половину той же
  // строки (см. её же max-height/overflow у .stat-tag-cloud в
  // index.html – без ограничения высоты блок в половину ширины разросся
  // бы вдвое выше, тегов там и так меньше в ряду, но выглядит это
  // нормально, а не "сломанно"). stat-card-tags – растягивает саму
  // карточку в колонку (index.html), чтобы .stat-tag-cloud могла занять
  // остаток её высоты вместо жёсткого max-height: карточка и так тянется
  // под соседку в гриде, а без flex:1 это пустое место под тегами
  // никак не использовалось – переносить их в несколько строк было
  // некуда, кроме как за счёт этого резерва.
  return `<section class="stat-section stat-card stat-card-tags">
    <h2 class="section-title">${esc(siteLabel("stats", "tags", i18n("Частые теги в отзывах")))}</h2>
    <div class="stat-tag-cloud">${items}</div>
  </section>`;
}

// ── Анимации ───────────────────────────────────
function animateCounters() {
  document.querySelectorAll("[data-target]").forEach(el => {
    const target = parseInt(el.dataset.target);
    // Лейбл рядом: у stat-total-num – следующий span, у stat-counter-val – следующий div
    const labelEl = el.nextElementSibling;
    const forms = labelEl?.dataset.plural?.split("|");

    const dur = 800, start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / dur, 1);
      const val = Math.round((1 - Math.pow(1 - t, 3)) * target);
      el.textContent = val;
      if (forms && labelEl) labelEl.textContent = pluralLabel(val, forms);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

function pluralLabel(n, [one, few, many]) {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (rem === 1)               return one;
  if (rem >= 2 && rem <= 4)   return few;
  return many;
}

function animateStackedBars() {
  setTimeout(() => {
    document.querySelectorAll(".year-bar-stack").forEach(el => {
      el.style.transition = "height .6s cubic-bezier(.4,0,.2,1)";
      el.style.height = el.dataset.pct + "%";
    });
    document.querySelectorAll(".grade-row-bar").forEach(el => {
      el.style.transition = "width .6s cubic-bezier(.4,0,.2,1)";
      el.style.width = el.dataset.pct + "%";
    });
  }, 100);
}

// ══ ЭКСПОРТ СТАТИСТИКИ В КАРТИНКУ ═══════════════════════
// Тот же приём, что у тир-листа персонажей и «Любимого»
// (js/tierlist.js: tlExport, js/favorites.js: favExport) – html2canvas
// поверх уже отрисованного .stat-grid, картинки сперва проксируются в
// data:-URL (см. config.js). Экспортирует ровно то, что сейчас открыто:
// «Всё время» или дайджест конкретного года – переключать это отдельно
// незачем, для этого уже есть переключатель года над самой статистикой.
// Выбор блоков перед снимком – тот же приём, что и у «Любимого»
// (favExportSections/openFavExportModal в js/favorites.js): без него
// снимок статистики со всеми включёнными блоками разом выходил очень
// длинным (вытянутая колонка в два столбца, где половина блоков в
// картинке вообще не нужна тому, кому её показываешь) – прежде чем
// делиться, проще выключить лишнее, чем потом обрезать готовую
// картинку в другом приложении. В отличие от «Любимого» здесь не
// строится отдельная офскрин-разметка – секции статистики уже готовы
// в живом .stat-grid (см. data-stat-key, withStatKey выше), невыбранные
// на время снимка просто прячутся через display:none и возвращаются
// обратно сразу после.
let statsExportModalEl = null;

function statsExportModalEnsure() {
  if (statsExportModalEl) return statsExportModalEl;
  statsExportModalEl = document.createElement("div");
  statsExportModalEl.id = "stats-export-overlay";
  statsExportModalEl.className = "modal-overlay hidden";
  statsExportModalEl.innerHTML = `
    <div class="modal confirm-dialog fav-export-modal">
      <div class="confirm-dialog-text">${i18n("Что показать на картинке?")}</div>
      <div id="stats-export-options"></div>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${i18n("Отмена")}</button>
        <button type="button" class="btn btn-primary" data-act="ok">${i18n("Сохранить")}</button>
      </div>
    </div>`;
  document.body.appendChild(statsExportModalEl);
  statsExportModalEl.querySelector('[data-act="cancel"]').onclick = closeStatsExportModal;
  statsExportModalEl.onclick = (e) => {
    if (e.target === statsExportModalEl) closeStatsExportModal();
  };
  statsExportModalEl.querySelector('[data-act="ok"]').onclick = () => {
    const ids = [...statsExportModalEl.querySelectorAll('input[name="stats-export-sec"]:checked')].map((el) => el.value);
    closeStatsExportModal();
    statsExport(ids);
  };
  return statsExportModalEl;
}

function openStatsExportModal() {
  const sections = [...document.querySelectorAll("#tab-stats .stat-grid [data-stat-key]")];
  if (!sections.length) return;
  const modal = statsExportModalEnsure();
  modal.querySelector("#stats-export-options").innerHTML = sections
    .map((sec) => {
      const key = sec.dataset.statKey;
      const label = sec.querySelector(".section-title")?.textContent || key;
      return `<label class="fav-export-option"><input type="checkbox" name="stats-export-sec" value="${esc(key)}" checked>${esc(label)}</label>`;
    })
    .join("");
  modal.classList.remove("hidden");
}

function closeStatsExportModal() {
  statsExportModalEl?.classList.add("hidden");
}

async function statsExport(selectedKeys) {
  const btn = document.getElementById("stats-export-btn");
  const grid = document.querySelector("#tab-stats .stat-grid");
  if (!grid) return;

  // Прячем на время снимка секции, снятые в модалке. restoreHidden
  // возвращает их обратно в finally, независимо от того, как снимок
  // завершился – ошибкой или успехом.
  const hidden = [];
  if (selectedKeys) {
    grid.querySelectorAll("[data-stat-key]").forEach((sec) => {
      if (!selectedKeys.includes(sec.dataset.statKey)) {
        hidden.push({ el: sec, prev: sec.style.display });
        sec.style.display = "none";
      }
    });
  }
  const restoreHidden = () => {
    for (const { el, prev } of hidden) el.style.display = prev;
  };

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

    // «Тайтл года» использует ту же карточку (manualCard), что и вся
    // остальная лента, с loading="lazy" – см. её же комментарий у
    // forceLoadImagesForExport в js/utils.js про то, почему это стоит
    // форсировать перед снимком.
    const imgs = Array.from(grid.querySelectorAll("img"));
    await forceLoadImagesForExport(imgs);

    restoreImages = await proxyImagesToDataUrls(grid);

    // html2canvas клонирует grid в отдельный iframe – это перезапускает
    // часы animation: fadeUp у разделов/карточек с нуля, и снимок
    // выходил темнее живой страницы (та часть анимации, где элементы
    // ещё не успели проявиться полностью). См. её же комментарий у
    // disableAnimations() в js/utils.js.
    restoreAnim = disableAnimations(grid);
    // Неоморфизм иначе вышел бы на снимке плоским – см. bakeNeoShadows()
    // в config.js (та же причина и тот же приём, что у favExport() в
    // favorites.js).
    restoreShadows = bakeNeoShadows(grid);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

    const canvas = await withTimeout(
      html2canvas(grid, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
        scale: safeCaptureScale(grid, 2),
        useCORS: true,
        allowTaint: false,
        logging: false,
        onclone: (clonedDoc) => {
          clonedDoc.documentElement.setAttribute("data-skin", document.documentElement.getAttribute("data-skin") || "");
        },
      }),
      captureTimeoutMs(imgs.length),
      i18n("Не удалось создать картинку за разумное время.")
    );

    const link = document.createElement("a");
    const label = statsState.year === "all" ? "all-time" : String(statsState.year);
    link.download = `stats-${label}.png`;
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
    restoreBtn();
    restoreHidden();
  }
}
