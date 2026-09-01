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

  const filtersHtml = statsYearFiltersHtml(years);
  const bodyHtml = statsState.year === "all"
    ? renderAllTimeStats(reviews, completed)
    : renderYearDigest(statsState.year, completed);

  box.innerHTML = filtersHtml + bodyHtml;

  animateCounters();
  animateStackedBars();
  statsBindAll();
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
    ${isStatVisible("counters")   ? renderCounters(counts, total) : ""}
    ${isStatVisible("donut")      ? renderDonut(counts, total) : ""}
    ${isStatVisible("grades")     ? renderGradeChart(gradeCounts) : ""}
    ${isStatVisible("watch-bars") ? renderStackedBarChart(siteLabel("stats", "watchYears", i18n("По годам просмотра")), "watch-bars", watchYearsByType) : ""}
    ${isStatVisible("release-bars") ? renderStackedBarChart(siteLabel("stats", "releaseYears", i18n("По годам выхода")), "release-bars", releaseYearsByType) : ""}
    ${isStatVisible("rewatch")    ? renderRewatchStats(reviews) : ""}
    ${isStatVisible("tags")       ? renderTagCloud(topTags) : ""}
  </div>`;
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
      ${isStatVisible("counters") ? renderCounters(counts, total, i18n("Итоги {year}", { year }), siteLabel("stats", "completed", i18n("завершено"))) : ""}
      ${isStatVisible("donut")    ? renderDonut(counts, total) : ""}
      ${isStatVisible("grades")   ? renderGradeChart(gradeCounts) : ""}
      ${isStatVisible("spotlight") ? renderTitleOfYear(spotlight, year) : ""}
      ${isStatVisible("rewatch")  ? renderRewatchStats(yearReviews) : ""}
      ${isStatVisible("tags")     ? renderTagCloud(topTags) : ""}
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
    <div class="stat-counters">
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
    return `<span class="rtag ${cls} stat-tag" style="${styleAttr}font-size:${scale.toFixed(2)}rem"
      data-tip="${esc(info?.tip || "")}">${esc(tag)} <span class="stat-tag-cnt">${cnt}</span></span>`;
  }).join("");
  return `<section class="stat-section stat-card">
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
