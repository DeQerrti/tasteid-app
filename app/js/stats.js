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
    // «Любимое» – для блоков «Твои люди» и «Твои персонажи»; без него
    // статистика всё равно рисуется, просто без этих двух блоков.
    try {
      const res = await fetch("/favorites.json?_=" + Date.now());
      const data = res.ok ? await res.json() : [];
      statsFavData = Array.isArray(data) ? data : [];
    } catch {
      statsFavData = [];
    }
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
  return raw ? parseLocalDate(raw).getFullYear() : null;
}

// ══ Вкладка целиком ═════════════════════════════
// Раньше: счётчики по типам + бублик с теми же числами + столбики по
// годам выхода (60 штук, нечитаемо) + облако тегов с прокруткой –
// всё про «сколько и чего». Теперь сверху – «вкус в трёх словах» (какие
// теги поднимают твою оценку) и те же числа по типам, дальше – КАК ты
// оцениваешь типы, шкала, что поднимает и что роняет оценку, годы,
// десятилетия выхода, теги, лицо вкуса, люди, пересмотры, персонажи.
// Каждый блок по-прежнему можно скрыть в настройках (data-stat-key –
// тот же ключ, что в STAT_BLOCKS settings-stats.js) и выбрать для
// снимка картинкой.
//
// Размеры – резиновые, от ширины вкладки (контейнер #tab-stats, единица
// --sxu в index.html): на ноутбуке мельче, на большом мониторе крупнее,
// пропорции одни и те же; на 2K/4K при масштабе 100% вкладка ещё и
// увеличивается целиком (zoom), а не стоит узкой колонкой посередине.

// Записи «Любимого» – для «Твоих людей» и «Твоих персонажей».
let statsFavData = [];

function statsRender() {
  const box = document.getElementById("tab-stats");
  const reviews = cache.reviews || [];
  const completed = reviews.filter(statsIsCompleted);
  const years = [...new Set(completed.map(statsCompletedYear).filter(Boolean))].sort((a, b) => b - a);
  const year = statsState.year;

  const toolbar = `<div class="stat-toolbar">
    ${statsYearFiltersHtml(years)}
    ${cameraButton("openStatsExportModal()", "stats-export-btn")}
  </div>`;

  const d = statsData(reviews, completed, year);
  if (!d.pool.length) {
    const emptyText =
      year === "all"
        ? i18n("Пока нет оценённых тайтлов")
        : siteLabel("stats", "emptyYear", i18n("За {year} год пока нет завершённых с оценкой")).replace("{year}", year);
    box.innerHTML = toolbar + `<div class="state-box">${esc(emptyText)}</div>`;
    statsBindAll();
    return;
  }

  const blocks =
    year === "all"
      ? [
          statsHeroHtml(d, year),
          statsTypesHtml(d),
          statsGradesHtml(d),
          statsLiftHtml(d, year),
          statsWatchYearsHtml(d),
          statsDecadesHtml(d),
          statsTagsHtml(d),
          statsFacesHtml(d, year),
          statsPeopleHtml(d),
          statsRewatchHtml(d),
          statsCharsHtml(d),
        ]
      : [
          statsHeroHtml(d, year),
          statsTypesHtml(d),
          statsGradesHtml(d),
          statsFacesHtml(d, year),
          statsLiftHtml(d, year),
          statsTagsHtml(d),
          statsRewatchHtml(d),
        ];

  box.innerHTML = toolbar + `<div class="stat-grid sx">${blocks.join("")}</div>`;
  statsFixLoneCards();
  statsFitTags();
  statsBindAll();
}

function statsIsCompleted(r) {
  return r.status === "completed" || (!r.status && (r.review_full || r.preview || r.grade));
}

// gradeScore(): 1 – лучшая полка шкалы (config.js). «Качество» – наоборот:
// у лучшей полки самое большое число, чтобы средние читались привычно.
function statsQuality(r) {
  const s = gradeScore(gradeToShelf(r.grade));
  return s ? GRADE_ORDER.length + 1 - s : null;
}
// Среднее «качество» → ближайшая полка шкалы, словами («≈ Отлично»).
function statsShelfFor(avg) {
  const n = GRADE_ORDER.length;
  return GRADES[GRADE_ORDER[Math.min(Math.max(n - Math.round(avg), 0), n - 1)]];
}
function statsAvg(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function statsTypeName(key) {
  return TYPE_LABELS[key] || key;
}

// Тег учитывается в «что поднимает / роняет», если стоит хотя бы у
// стольких оценённых тайтлов (за год – меньше, тайтлов там в разы меньше).
const STATS_MIN_TAG = 4;
const STATS_MIN_TAG_YEAR = 2;
// Тип – в «мягче/строже всего», если оценок у него хотя бы столько.
const STATS_MIN_TYPE = 3;
// «Сглаживание»: к оценкам тега добавляются столько воображаемых тайтлов
// с твоей обычной оценкой. Тегу с 45 тайтлами это почти ничего не меняет,
// а тег с 4 тайтлами уже не обгонит его только потому, что четыре оценки
// случайно оказались высокими.
const STATS_TAG_SMOOTHING = 5;
// «Частые теги»: сколько берём в запас (сколько из них видно – решает
// высота карточки, statsFitTags) и сколько показываем, когда карточка
// одна в ряду (телефон, скрытый сосед) – там подгонять не под что.
const STATS_TAGS_MAX = 60;
const STATS_TAGS_SOLO = 16;

function statsData(reviews, completed, year) {
  const pool =
    year === "all" ? reviews.filter((r) => r.grade) : completed.filter((r) => statsCompletedYear(r) === year && r.grade);
  const prev = year === "all" ? null : completed.filter((r) => statsCompletedYear(r) === year - 1 && r.grade);
  const graded = pool.filter((r) => statsQuality(r) !== null);
  const allGraded = reviews.filter((r) => r.grade && statsQuality(r) !== null);
  const overall = graded.length ? statsAvg(graded.map(statsQuality)) : 0;
  // За год теги сравниваются с обычной оценкой ЗА ВСЁ ВРЕМЯ – видно,
  // что в этом году «зашло» лучше привычного.
  const base = year === "all" ? overall : allGraded.length ? statsAvg(allGraded.map(statsQuality)) : 0;

  const byTag = new Map();
  for (const r of graded) {
    for (const t of r.tags || []) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(statsQuality(r));
    }
  }
  const minTag = year === "all" ? STATS_MIN_TAG : STATS_MIN_TAG_YEAR;
  const tags = [...byTag]
    .filter(([, v]) => v.length >= minTag)
    .map(([name, v]) => {
      const smooth = (v.reduce((a, b) => a + b, 0) + base * STATS_TAG_SMOOTHING) / (v.length + STATS_TAG_SMOOTHING);
      return { name, n: v.length, avg: statsAvg(v), lift: smooth - base };
    })
    .sort((a, b) => b.lift - a.lift);
  const up = tags.filter((t) => t.lift > 0.15).slice(0, 6);
  const down = tags
    .filter((t) => t.lift < -0.15)
    .slice(-6)
    .reverse();

  const byType = new Map();
  for (const r of pool) {
    const t = r.type || "anime";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }
  const types = [...byType].map(([type, list]) => {
    const q = list.map(statsQuality).filter((x) => x !== null);
    // Сколько тайтлов типа на каждой полке – раскрывается кликом по
    // строке в «Как ты оцениваешь типы»: средняя «Отлично» на 51 фильм
    // не говорит, сколько из них «Резонанс», а сколько «Брак».
    const shelves = GRADE_ORDER.map((k) => ({ g: GRADES[k], n: list.filter((r) => gradeToShelf(r.grade) === k).length }));
    return { type, n: list.length, avg: q.length ? statsAvg(q) : null, shelves };
  });
  const rated = types.filter((t) => t.avg !== null && t.n >= STATS_MIN_TYPE).sort((a, b) => b.avg - a.avg);

  const gradeCounts = GRADE_ORDER.map((k) => ({ g: GRADES[k], n: pool.filter((r) => gradeToShelf(r.grade) === k).length }));

  const tagCount = new Map();
  for (const r of pool) for (const t of r.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  // С запасом: сколько из них показать, решает высота карточки
  // (statsFitTags) – на широком экране влезает больше, на узком меньше.
  const topTags = [...tagCount].sort((a, b) => b[1] - a[1]).slice(0, STATS_TAGS_MAX);

  const rewatched = pool.filter((r) => r.rewatch_count > 0).sort((a, b) => b.rewatch_count - a.rewatch_count);

  const watch = new Map();
  for (const r of completed) {
    const y = statsCompletedYear(r);
    if (!y) continue;
    if (!watch.has(y)) watch.set(y, new Map());
    const m = watch.get(y);
    const t = r.type || "anime";
    m.set(t, (m.get(t) || 0) + 1);
  }
  // Годы выхода – десятилетиями; всё до 1950 – одной строкой: пара
  // книг XIV века иначе растягивала шкалу на семь веков.
  const decades = new Map();
  // Те же тайтлы внутри десятилетия – по годам (раскрывается кликом по
  // десятилетию): decadeYears.get(1990).get(1994) → Map(тип → сколько).
  const decadeYears = new Map();
  for (const r of pool) {
    const y = parseInt(r.year);
    if (!y) continue;
    const key = y < 1950 ? 0 : Math.floor(y / 10) * 10;
    if (!decades.has(key)) decades.set(key, new Map());
    const m = decades.get(key);
    const t = r.type || "anime";
    m.set(t, (m.get(t) || 0) + 1);
    if (!decadeYears.has(key)) decadeYears.set(key, new Map());
    const years = decadeYears.get(key);
    if (!years.has(y)) years.set(y, new Map());
    years.get(y).set(t, (years.get(y).get(t) || 0) + 1);
  }

  const best = GRADE_ORDER[0];
  const bestList = pool.filter((r) => gradeToShelf(r.grade) === best);
  const faces =
    year === "all"
      ? bestList.filter((r) => r.favorite).sort((a, b) => (a.fav_order ?? 9999) - (b.fav_order ?? 9999))
      : bestList;

  const byId = new Map(reviews.map((r) => [r.id, r]));
  const byTitle = new Map(reviews.map((r) => [normTitle(r.title), r]));
  const linkedOf = (e) => (e.linked_review_ids || []).map((id) => byId.get(id)).filter((r) => r && statsQuality(r) !== null);
  const people = statsFavData
    .filter((e) => e.type === "person")
    .map((e) => {
      const linked = linkedOf(e);
      return { e, linked, avg: linked.length ? statsAvg(linked.map(statsQuality)) : null };
    })
    .filter((p) => p.linked.length)
    .sort((a, b) => b.avg - a.avg || b.linked.length - a.linked.length);
  const peopleNoLinks = statsFavData.filter((e) => e.type === "person" && !(e.linked_review_ids || []).length).length;
  const chars = statsFavData
    .filter((e) => e.type === "character")
    .map((e) => {
      let linked = linkedOf(e);
      if (!linked.length && e.from) {
        const r = byTitle.get(normTitle(e.from));
        if (r && statsQuality(r) !== null) linked = [r];
      }
      return { e, avg: linked.length ? statsAvg(linked.map(statsQuality)) : null };
    });

  return { pool, prev, graded, overall, up, down, types, rated, gradeCounts, topTags, rewatched, watch, decades, decadeYears, faces, people, peopleNoLinks, chars };
}

// src и атрибуты подстраховки – как у карточек во всём приложении
// (coverFallbackAttrs/imgFallbackAttrs): битая внешняя ссылка на живой
// странице сама меняется на резервную копию, а снимок (statsExport →
// proxyImagesToDataUrls) берёт копию с диска сразу. Без них снимок ходил
// за внешними ссылками, часть сайтов (TMDB, Hardcover) не отдаёт картинки
// чужой странице (CORS) – и на картинке статистики были пустые места.
const statsCoverAttrs = (r) =>
  `src="${esc(r.cover || r.cover_backup || PH_TALL)}" ${coverFallbackAttrs(r.cover, r.cover_backup)}`;
const statsImageAttrs = (e) =>
  `src="${esc(e.image || e.image_backup || PH_SQ)}" ${imgFallbackAttrs(e.image, e.image_backup, PH_SQ)}`;
function statsGradeHtml(g, extra = "") {
  return `<span class="sx-grade" style="--gc:${esc(g.color)}">${esc(g.name)}${extra}</span>`;
}
function statsCard(key, cls, title, explain, body) {
  if (!isStatVisible(key)) return "";
  return `<section class="stat-card sx-card ${cls}" data-stat-key="${key}">
    <h2 class="section-title sx-h">${esc(title)}</h2>
    ${explain ? `<p class="sx-explain">${esc(explain)}</p>` : ""}
    ${body}
  </section>`;
}
function statsLegendHtml(typeKeys) {
  return `<div class="sx-legend">${typeKeys
    .map((t) => `<span style="--tc:${esc(typeColor(t))}"><i></i>${esc(statsTypeName(t))}</span>`)
    .join("")}</div>`;
}

// Шапка: «вкус в трёх словах» (ключ taste) + числа по типам (ключ
// counters – те же, что раньше в блоке «Всего»). Обе части скрываются
// в настройках по отдельности.
function statsHeroHtml(d, year) {
  const showTaste = isStatVisible("taste");
  const showCounters = isStatVisible("counters");
  if (!showTaste && !showCounters) return "";

  let taste = "";
  if (showTaste) {
    const words = d.up
      .slice(0, 3)
      .map((t) => `<span>${esc(t.name)}</span>`)
      .join("");
    const overallG = d.graded.length ? statsShelfFor(d.overall) : null;
    const soft = d.rated[0];
    const strict = d.rated[d.rated.length - 1];
    const line = [
      overallG ? i18n("В среднем ты ставишь {grade}.", { grade: `<b>${esc(overallG.name)}</b>` }) : "",
      soft && strict && soft !== strict
        ? i18n("Мягче всего ты к типу «{soft}», строже всего – к «{strict}».", {
            soft: esc(statsTypeName(soft.type)),
            strict: esc(statsTypeName(strict.type)),
          })
        : "",
      d.down[0] ? i18n("Главный повод разочароваться – «{tag}».", { tag: esc(d.down[0].name) }) : "",
    ]
      .filter(Boolean)
      .join(" ");
    taste = `<div class="sx-taste">
        <div class="sx-kicker">${esc(year === "all" ? i18n("Твой вкус в трёх словах") : i18n("{year} год в трёх словах", { year }))}</div>
        <div class="sx-words">${words || esc(i18n("Пока мало оценок для выводов"))}</div>
        ${line ? `<div class="sx-line">${line}</div>` : ""}
      </div>
      <div class="sx-covers">${d.faces
        .slice(0, 3)
        .map((r) => `<img ${statsCoverAttrs(r)} alt="${esc(r.title)}" title="${esc(r.title)}">`)
        .join("")}</div>`;
  }

  let counters = "";
  if (showCounters) {
    const order = Object.keys(TYPE_LABELS);
    const cells = [...d.types]
      .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
      .map((t) => {
        const forms = TYPE_PLURAL[t.type] || (window.SITE_CUSTOM_TYPE_PLURAL || {})[t.type];
        const label = Array.isArray(forms) ? plural(t.n, forms) : statsTypeName(t.type);
        return `<div class="sx-tc stat-counter"><div class="sx-tc-val" style="color:${esc(typeColor(t.type))}">${t.n}</div><div class="sx-tc-lbl">${esc(label)}</div></div>`;
      })
      .join("");
    const delta = d.prev && d.prev.length ? d.pool.length - d.prev.length : null;
    const deltaHtml =
      delta === null
        ? ""
        : `<small class="${delta < 0 ? "down" : ""}">${esc(i18n("{d} к {year}", { d: (delta > 0 ? "+" : "") + delta, year: year - 1 }))}</small>`;
    const label =
      year === "all"
        ? plural(d.pool.length, [i18n("тайтл"), i18n("тайтла"), i18n("тайтлов")])
        : siteLabel("stats", "completed", i18n("завершено"));
    counters = `<div class="sx-total${showTaste ? "" : " solo"}">
        <div class="sx-total-big">${d.pool.length}<span>${esc(label)}</span>${deltaHtml}</div>
        <div class="sx-tcs stat-counters">${cells}</div>
      </div>`;
  }

  return `<section class="stat-card sx-hero" data-stat-key="${showTaste ? "taste" : "counters"}">
    <h2 class="section-title sx-hero-title">${esc(year === "all" ? siteLabel("stats", "total", i18n("Всего")) : i18n("Итоги {year}", { year }))}</h2>
    ${taste}${counters}
  </section>`;
}

// Раскрытая строка типа: полки, на которых у этого типа что-то есть, –
// подпись полки, полоса (от самой полной полки типа) и число.
function statsShelvesDetailHtml(shelves) {
  const used = shelves.filter((s) => s.n);
  const max = Math.max(...used.map((s) => s.n), 1);
  return `<div class="sx-detail" hidden>${used
    .map(
      (s) =>
        `<div class="sx-grow">${statsGradeHtml(s.g)}<span class="sx-bar" style="--tc:${esc(s.g.color)}"><i style="width:${Math.round((s.n / max) * 100)}%"></i></span><span class="sx-grow-n">${s.n}</span></div>`
    )
    .join("")}</div>`;
}

function statsTypesHtml(d) {
  const list = d.types.filter((t) => t.avg !== null).sort((a, b) => b.avg - a.avg);
  const n = GRADE_ORDER.length;
  // Строка – кнопка: клик раскрывает под ней, сколько тайтлов этого
  // типа на каждой полке (statsBindAll, data-stat-expand). Подсказки
  // текстом нет – вкладкой делятся снимком; что строка раскрывается,
  // видно по стрелке у названия при наведении.
  const body = `<div class="sx-types">${list
    .map((t) => {
      const g = statsShelfFor(t.avg);
      return `<div class="sx-expand">
      <div class="sx-type" style="--tc:${esc(typeColor(t.type))}" data-stat-expand role="button" tabindex="0" aria-expanded="false">
        <span class="sx-type-name"><i></i>${esc(statsTypeName(t.type))}</span>
        <span class="sx-bar" style="--tc:${esc(g.color)}"><i style="width:${Math.round((t.avg / n) * 100)}%"></i></span>
        <span class="sx-type-n">${t.n}<small>${esc(plural(t.n, [i18n("оценка"), i18n("оценки"), i18n("оценок")]))}</small></span>
        ${statsGradeHtml(g)}
      </div>
      ${statsShelvesDetailHtml(t.shelves)}
      </div>`;
    })
    .join("")}</div>`;
  return statsCard(
    "donut",
    "w7",
    siteLabel("stats", "types", i18n("Как ты оцениваешь типы")),
    i18n("Средняя оценка по каждому типу – от самого щедрого к самому строгому."),
    body
  );
}

function statsGradesHtml(d) {
  const max = Math.max(...d.gradeCounts.map((g) => g.n), 1);
  const body = `<div class="sx-grades">${d.gradeCounts
    .map(
      (g) =>
        `<div class="sx-grow">${statsGradeHtml(g.g)}<span class="sx-bar" style="--tc:${esc(g.g.color)}"><i style="width:${Math.round((g.n / max) * 100)}%"></i></span><span class="sx-grow-n">${g.n}</span></div>`
    )
    .join("")}</div>`;
  return statsCard(
    "grades",
    "w5",
    siteLabel("stats", "grades", i18n("Шкала послевкусия")),
    i18n("Сколько тайтлов на каждой полке."),
    body
  );
}

function statsReasonRows(list) {
  if (!list.length) return `<div class="sx-empty">${esc(i18n("Пока мало данных"))}</div>`;
  const n = GRADE_ORDER.length;
  return `<div class="sx-rows">${list
    .map((t) => {
      const g = statsShelfFor(t.avg);
      return `<div class="sx-row" data-tip="${esc(TAGS_MAP[t.name]?.tip || t.name)}">
        <span class="sx-row-name">${esc(t.name)}</span>
        <span class="sx-bar" style="--tc:${esc(g.color)}"><i style="width:${Math.round((t.avg / n) * 100)}%"></i></span>
        ${statsGradeHtml(g, ` <small>· ${t.n}</small>`)}
      </div>`;
    })
    .join("")}</div>`;
}

// «Что поднимает» и «что роняет» – один ключ lift в настройках, две
// карточки рядом.
function statsLiftHtml(d, year) {
  if (!isStatVisible("lift")) return "";
  const vs = year === "all" ? i18n("обычной") : i18n("твоей обычной за всё время");
  return (
    statsCard(
      "lift",
      "",
      i18n("Что поднимает оценку"),
      i18n("Теги, с которыми средняя оценка выше {vs}. Справа – к какой полке она в среднем ближе и у скольких тайтлов тег стоит.", { vs }),
      statsReasonRows(d.up)
    ) +
    statsCard(
      "lift-down",
      "",
      i18n("Что гарантированно роняет"),
      i18n("Теги, с которыми оценка заметно ниже {vs}.", { vs }),
      statsReasonRows(d.down)
    )
  );
}

function statsWatchYearsHtml(d) {
  const years = [...d.watch.keys()].sort((a, b) => a - b);
  if (!years.length) return "";
  const totals = years.map((y) => [...d.watch.get(y).values()].reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const typeKeys = [...new Set(years.flatMap((y) => [...d.watch.get(y).keys()]))];
  const body = `${statsLegendHtml(typeKeys)}
    <div class="sx-years">${years
      .map((y, i) => {
        const m = d.watch.get(y);
        const h = Math.max(Math.round((totals[i] / max) * 100), 2);
        return `<button type="button" class="sx-year" data-stat-year-bar="${y}" title="${y}: ${totals[i]}">
          <span class="sx-year-stack" style="height:${h}%">${typeKeys
            .filter((t) => m.get(t))
            .map((t) => `<i style="--tc:${esc(typeColor(t))};flex:${m.get(t)}"></i>`)
            .join("")}</span>
          <span class="sx-year-lbl"><b>${totals[i]}</b>${y}</span>
        </button>`;
      })
      .join("")}</div>`;
  return statsCard(
    "watch-bars",
    "w12",
    siteLabel("stats", "watchYears", i18n("По годам просмотра")),
    i18n("Сколько завершено за год и чего именно. Клик по году – его итоги."),
    body
  );
}

function statsDecadesHtml(d) {
  const keys = [...d.decades.keys()].sort((a, b) => b - a);
  if (!keys.length) return "";
  const totals = keys.map((k) => [...d.decades.get(k).values()].reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  const typeKeys = [...new Set(keys.flatMap((k) => [...d.decades.get(k).keys()]))];
  const label = (k) => (k === 0 ? i18n("до 1950") : i18n("{d}-е", { d: k }));
  const stack = (m, width) =>
    `<span class="sx-bar-wrap"><span class="sx-bar sx-bar-stack" style="width:${width}%">${typeKeys
      .filter((t) => m.get(t))
      .map((t) => `<i style="--tc:${esc(typeColor(t))};flex:${m.get(t)}"></i>`)
      .join("")}</span></span>`;
  const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
  // Десятилетие – кнопка: клик раскрывает его по годам (новые сверху,
  // как и сами десятилетия). Полосы годов – от самого полного года
  // внутри этого десятилетия, а не от всей шкалы: иначе год с парой
  // тайтлов был бы точкой.
  const yearsHtml = (k) => {
    const years = [...(d.decadeYears.get(k) || new Map())].sort((a, b) => b[0] - a[0]);
    const yMax = Math.max(...years.map(([, m]) => sum(m)), 1);
    return `<div class="sx-detail" hidden>${years
      .map(
        ([y, m]) => `<div class="sx-decade sx-decade-year">
          <span class="sx-decade-lbl">${y}</span>
          ${stack(m, Math.max(Math.round((sum(m) / yMax) * 100), 3))}
          <span class="sx-grow-n">${sum(m)}</span>
        </div>`
      )
      .join("")}</div>`;
  };
  const body = `${statsLegendHtml(typeKeys)}
    <div class="sx-decades">${keys
      .map((k, i) => {
        const m = d.decades.get(k);
        return `<div class="sx-expand">
        <div class="sx-decade" data-stat-expand role="button" tabindex="0" aria-expanded="false">
          <span class="sx-decade-lbl">${esc(label(k))}</span>
          ${stack(m, Math.max(Math.round((totals[i] / max) * 100), 3))}
          <span class="sx-grow-n">${totals[i]}</span>
        </div>
        ${yearsHtml(k)}
        </div>`;
      })
      .join("")}</div>`;
  return statsCard(
    "release-bars",
    "",
    siteLabel("stats", "releaseYears", i18n("По годам выхода")),
    i18n("По десятилетиям: сколько оценённых тайтлов вышло в каждом и каких типов."),
    body
  );
}

function statsTagsHtml(d) {
  if (!d.topTags.length) return "";
  const body = `<div class="sx-tags">${d.topTags
    .map(([t, n]) => {
      // Цвет категории и подсказка (что значит тег) – как в старом облаке
      // тегов и в карточках отзывов (tagHtml в cards.js): цвет – по
      // категории тега, подсказка – из словаря тегов.
      const info = TAGS_MAP[t];
      const customColor = info && CAT_COLORS[info.cat];
      const cls = customColor ? "rtag-custom" : TAG_CAT_CLASS[info?.cat] || "rtag-special";
      const style = customColor ? ` style="--tag-color:${customColor}"` : "";
      return `<span class="rtag ${cls} sx-tag stat-tag"${style} data-tip="${esc(info?.tip || "")}">${esc(t)}<small>${n}</small></span>`;
    })
    .join("")}</div>`;
  return statsCard(
    "tags",
    "",
    siteLabel("stats", "tags", i18n("Частые теги в отзывах")),
    "",
    body
  );
}

function statsRewatchHtml(d) {
  if (!d.rewatched.length) return "";
  const total = d.rewatched.reduce((s, r) => s + r.rewatch_count, 0);
  const n = d.rewatched.length;
  const body = `<div class="sx-rewatch">${d.rewatched
    .slice(0, 5)
    .map(
      (r) =>
        `<button type="button" class="sx-rw" data-stat-review="${esc(String(r.id))}"><img ${statsCoverAttrs(r)} alt=""><span class="sx-rw-title">${esc(r.title)}</span><span class="sx-rw-n">×${r.rewatch_count}</span></button>`
    )
    .join("")}</div>
    <div class="sx-sum">${esc(
      `${n} ${plural(n, [
        siteLabel("stats", "rewatchOne", i18n("тайтл пересмотрен")),
        siteLabel("stats", "rewatchFew", i18n("тайтла пересмотрено")),
        siteLabel("stats", "rewatchMany", i18n("тайтлов пересмотрено")),
      ])} · ${total} ${plural(total, [i18n("пересмотр всего"), i18n("пересмотра всего"), i18n("пересмотров всего")])}`
    )}</div>`;
  return statsCard(
    "rewatch",
    "w5",
    siteLabel("stats", "rewatch", i18n("Пересмотры")),
    "",
    body
  );
}

function statsFacesHtml(d, year) {
  const list = d.faces.slice(0, 14);
  if (!list.length) return "";
  const best = GRADES[GRADE_ORDER[0]].name;
  const title =
    year === "all"
      ? i18n("Лицо вкуса")
      : (list.length > 1
          ? siteLabel("stats", "spotlightMany", i18n("Тайтлы {year} года"))
          : siteLabel("stats", "spotlightOne", i18n("Тайтл {year} года"))
        ).replace("{year}", year);
  const explain =
    year === "all"
      ? i18n("Любимые тайтлы с высшей оценкой")
      : i18n("Всё, что получило «{grade}» в этом году.", { grade: best });
  const body = `<div class="sx-faces">${list
    .map(
      (r) =>
        `<button type="button" class="sx-face" data-stat-review="${esc(String(r.id))}"><img ${statsCoverAttrs(r)} alt="" loading="lazy"><span>${esc(r.title)}</span></button>`
    )
    .join("")}</div>`;
  return statsCard("spotlight", year === "all" ? "w7" : "w12", title, explain, body);
}

// Без приписок под заголовками «Твои люди», «Пересмотры», «Твои
// персонажи», «Частые теги»: вкладкой делятся снимком, а из названия
// блока и так понятно, что в нём (просьба owner'а).
function statsPeopleHtml(d) {
  const explain = "";
  const body = d.people.length
    ? `<div class="sx-people">${d.people
        .slice(0, 6)
        .map(
          (p) => `<button type="button" class="sx-person" data-stat-fav="${esc(String(p.e.id))}">
          <img ${statsImageAttrs(p.e)} alt="" style="object-position:${esc(p.e.image_focus || "50% 50%")}">
          <span class="sx-person-text"><span class="sx-person-name">${esc(p.e.name)}</span><span class="sx-person-sub">${esc(
            [SUBTYPE_LABELS[p.e.subtype], p.linked.map((r) => r.title).join(", ")].filter(Boolean).join(" · ")
          )}</span></span>
          ${statsGradeHtml(statsShelfFor(p.avg))}
        </button>`
        )
        .join("")}</div>`
    : `<div class="sx-empty">${esc(i18n("Пока ни у кого не привязаны тайтлы"))}</div>`;
  return statsCard("people", "w5", i18n("Твои люди"), explain, body);
}

function statsCharsHtml(d) {
  if (!d.chars.length) return "";
  const body = `<div class="sx-chars">${d.chars
    .slice(0, 16)
    .map(
      (c) => `<button type="button" class="sx-char" data-stat-fav="${esc(String(c.e.id))}">
        <img ${statsImageAttrs(c.e)} alt="" style="object-position:${esc(c.e.image_focus || "50% 50%")}" loading="lazy">
        <span class="sx-char-name">${esc(c.e.name)}</span>
        ${c.e.from ? `<span class="sx-char-from">${esc(c.e.from)}</span>` : ""}
        ${c.avg !== null ? statsGradeHtml(statsShelfFor(c.avg)) : ""}
      </button>`
    )
    .join("")}</div>`;
  return statsCard(
    "characters",
    "w7",
    i18n("Твои персонажи"),
    "",
    body
  );
}

// Блоки можно скрывать в настройках – карточка, оставшаяся в своём ряду
// без пары, растягивается на всю ширину вместо пустой половины рядом.
function statsFixLoneCards() {
  const cards = [...document.querySelectorAll("#tab-stats .sx > .sx-card")];
  cards.forEach((c) => c.classList.remove("sx-solo"));
  const rows = new Map();
  for (const c of cards) {
    const top = Math.round(c.getBoundingClientRect().top);
    if (!rows.has(top)) rows.set(top, []);
    rows.get(top).push(c);
  }
  for (const row of rows.values()) {
    if (row.length === 1 && !row[0].classList.contains("w12")) row[0].classList.add("sx-solo");
  }
}

function statsYearFiltersHtml(years) {
  const allBtn = `<button class="tl-filter${statsState.year === "all" ? " active" : ""}" data-stat-year="all">${i18n("Всё время")}</button>`;
  const yearBtns = years
    .map(
      (y) =>
        `<button class="tl-filter${String(statsState.year) === String(y) ? " active" : ""}" data-stat-year="${y}">${y}</button>`
    )
    .join("");
  return `<div class="stat-year-filters">${allBtn}${yearBtns}</div>`;
}

// «Частые теги» заполняют свою карточку целиком: карточка тянется до
// высоты соседней в ряду (CSS: .sx-tags с flex-basis 0 не влияет на
// высоту ряда), и в ней видно столько тегов, сколько помещается
// целиком, – на широком экране больше, на узком меньше. Карточка одна в
// ряду (телефон, сосед скрыт) – подгонять не под что, показываем
// STATS_TAGS_SOLO. ResizeObserver пересчитывает при любом изменении
// размера, в том числе когда вкладку показывают после скрытой
// отрисовки (тогда высота была 0 и считать было не по чему).
let statsTagsObserver = null;
function statsFitTags() {
  statsTagsObserver?.disconnect();
  statsTagsObserver = null;
  const card = document.querySelector('#tab-stats .sx-card[data-stat-key="tags"]');
  const box = card?.querySelector(".sx-tags");
  if (!box) return;
  const tags = [...box.children];
  const fit = () => {
    if (card.classList.contains("sx-solo")) {
      tags.forEach((t, i) => t.classList.toggle("sx-tag-off", i >= STATS_TAGS_SOLO));
      return;
    }
    const h = box.clientHeight;
    if (!h) return;
    tags.forEach((t) => t.classList.remove("sx-tag-off"));
    let cut = false;
    for (const t of tags) {
      if (!cut && t.offsetTop + t.offsetHeight > h) cut = true;
      if (cut) t.classList.add("sx-tag-off");
    }
  };
  fit();
  statsTagsObserver = new ResizeObserver(fit);
  statsTagsObserver.observe(box);
}

// При смене размера окна ряды карточек перестраиваются – какая из них
// осталась одна в ряду (sx-solo), а с ней и сколько тегов влезает,
// нужно пересчитать. Один слушатель на всё время жизни страницы.
let statsResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(statsResizeTimer);
  statsResizeTimer = setTimeout(() => {
    if (document.getElementById("tab-stats")?.classList.contains("hidden")) return;
    statsFixLoneCards();
    statsFitTags();
  }, 150);
});

function statsBindAll() {
  const box = document.getElementById("tab-stats");
  // Раскрывающиеся строки: тип → полки, десятилетие → годы.
  box.querySelectorAll("[data-stat-expand]").forEach((row) => {
    const toggle = () => {
      const detail = row.nextElementSibling;
      if (!detail) return;
      detail.hidden = !detail.hidden;
      row.setAttribute("aria-expanded", String(!detail.hidden));
      // Карточка выросла или сжалась – вместе с ней и ряд, а значит, и
      // место под теги соседней карточки. ResizeObserver это тоже
      // поймает, но только к следующей отрисовке – пересчитываем сразу.
      statsFitTags();
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
  box.querySelectorAll(".tl-filter[data-stat-year]").forEach((btn) => {
    btn.addEventListener("click", () => {
      statsState.year = btn.dataset.statYear === "all" ? "all" : parseInt(btn.dataset.statYear);
      statsRender();
    });
  });
  box.querySelectorAll("[data-stat-year-bar]").forEach((el) =>
    el.addEventListener("click", () => {
      statsState.year = parseInt(el.dataset.statYearBar);
      statsRender();
      box.scrollIntoView({ block: "start" });
    })
  );
  box.querySelectorAll("[data-stat-review]").forEach((el) =>
    el.addEventListener("click", () => {
      const r = (cache.reviews || []).find((x) => String(x.id) === el.dataset.statReview);
      if (r) openReviewModal(r);
    })
  );
  box.querySelectorAll("[data-stat-fav]").forEach((el) =>
    el.addEventListener("click", () => {
      const e = statsFavData.find((x) => String(x.id) === el.dataset.statFav);
      if (e && typeof openFavPersonModal === "function") openFavPersonModal(e);
    })
  );
}

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
  // На широком окне (≥2300px, в том числе при уменьшенном масштабе
  // приложения) у #tab-stats стоит CSS zoom (index.html). html2canvas его
  // не понимает: места слов берёт увеличенные, а буквы рисует обычного
  // размера – на снимке между словами выходили дыры. На время снимка
  // zoom снимаем (раскладка та же, просто без увеличения; чёткость даёт
  // scale ниже) и возвращаем в finally вместе со спрятанными разделами.
  const tab = document.getElementById("tab-stats");
  const prevZoom = tab?.style.zoom ?? "";
  if (tab && getComputedStyle(tab).zoom !== "1") tab.style.zoom = "1";
  const restoreHidden = () => {
    for (const { el, prev } of hidden) el.style.display = prev;
    if (tab) tab.style.zoom = prevZoom;
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
