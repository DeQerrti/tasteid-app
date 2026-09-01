// ══════════════════════════════════════════════
//  CARDS – переиспользуемые функции карточек
//  Зависит от: config.js
//  TYPE_LABELS перенесён в config.js – здесь не объявлять
// ══════════════════════════════════════════════

// ── Хелперы ────────────────────────────────────
function normTitle(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Обработка не открывшихся обложек живёт в js/utils.js: там один
// делегированный слушатель на весь документ, а шаблоны просто ставят
// data-fallback / data-placeholder через imgFallbackAttrs().
// Здесь – только удобная обёртка под вертикальный постер.
function coverFallbackAttrs(cover, coverBackup) {
  return imgFallbackAttrs(cover, coverBackup, PH_TALL);
}

function findReviewForTitle(title, type) {
  if (!cache.reviews?.length || !title) return null;
  const norm = normTitle(title);
  const found = type
    ? cache.reviews.find(r => normTitle(r.title) === norm && r.type === type)
      ?? cache.reviews.find(r => normTitle(r.title) === norm)
    : cache.reviews.find(r => normTitle(r.title) === norm);
  if (!found) return null;
  const shelf = gradeToShelf(found.grade);
  const grade = GRADES[shelf] || null;
  const score = gradeScore(shelf);
  return grade ? { grade, score } : null;
}

function gradeInlineHtml(info) {
  if (!info) return "";
  return `<span class="card-grade-inline" style="color:${info.grade.color}" data-tip="${esc(info.grade.desc)}">${esc(info.grade.name)}</span>`;
}

// Локаль – по языку интерфейса, а не жёстко "ru-RU": с английским
// интерфейсом даты оставались русскими («12 мар.»), то есть половина
// карточки переводилась, а половина нет.
function fmtDateStr(str, short = false) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  const locale = dateLocale();
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() === currentYear) {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  } else {
    if (short) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(2);
      return `${dd}.${mm}.${yy}`;
    }
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  }
}

// ── Карточки ───────────────────────────────────

// Тег в отзыве
function tagHtml(tag) {
  const info = TAGS_MAP[tag];
  const customColor = info && CAT_COLORS[info.cat];
  // TAG_CAT_CLASS знает только про встроенные категории – своя категория
  // без выбранного цвета (осознанно оставленная «нейтральной», см.
  // tm-cat-colornote в add.html) в нём не найдётся, и cls раньше уходил
  // в undefined: класс "rtag undefined" не даёт вообще никакой оболочки.
  // Тот же rtag-special, что у встроенных без цвета, – то самое
  // «нейтральные» из подсказки, а не поломка.
  const cls = customColor ? "rtag-custom" : TAG_CAT_CLASS[info?.cat] || "rtag-special";
  const style = customColor ? ` style="--tag-color:${customColor}"` : "";
  const tip  = info?.tip || "";
  return `<span class="rtag ${cls}"${style} data-tip="${esc(tip)}">${esc(tag)}</span>`;
}

// Карточка из reviews.json (главная, архив)
function manualCard(r, index) {
  // Оценка – из собственного r.grade, а не через findReviewForTitle():
  // та ищет по названию+типу заново по всему кэшу и предназначена для
  // карточек избранного (favorites.js), у которых своей оценки вообще
  // нет. Здесь r – уже сам отзыв; при поиске по названию два разных
  // отзыва с одинаковым названием (например, обзор на 1-2 и отдельно на
  // 3 сезон одного тайтла – намеренно разрешённый дубль, см. reviews.js)
  // находили один и тот же первый попавшийся отзыв и показывали чужую
  // оценку на обеих карточках.
  const shelf    = gradeToShelf(r.grade);
  const grade    = GRADES[shelf] || null;
  const info     = grade ? { grade, score: gradeScore(shelf) } : null;
  const tagLabel = TYPE_LABELS[r.type] || r.type || "–";

  let watchBadge = "";
  if (r.status === "current" && r.date_start) {
    const s = fmtDateStr(r.date_start, true);
    if (s) watchBadge = i18n("с {date}", { date: s });
  } else if (r.status === "completed") {
    const startStr = r.date_start ? fmtDateStr(r.date_start, true) : null;
    const endStr   = r.date_end   ? fmtDateStr(r.date_end,   true) : null;
    if (endStr && startStr && r.date_start !== r.date_end) {
      watchBadge = `${startStr} → ${endStr}`;
    } else if (endStr) {
      watchBadge = endStr;
    } else if (startStr) {
      watchBadge = startStr;
    }
  }

  const editId = r.id ?? encodeURIComponent(r.title);
  const pencil = isAdmin()
    ? `<a href="#/add?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
    : "";

  return `<div class="review-card-wrap" style="animation-delay:${Math.min(index * 25, 600)}ms">
    ${pencil}
    <div class="card" style="animation-delay:0ms">
      <span class="type-tag tag-manual">${esc(tagLabel)}</span>
      ${watchBadge ? `<span class="watch-badge">${esc(watchBadge)}</span>` : ""}
      <img src="${esc(r.cover || PH_TALL)}" alt="${esc(r.title)}" loading="lazy" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        ${r.year || info
          ? `<div class="card-meta">
              ${r.year ? `<span>${esc(String(r.year))}</span>` : ""}
              ${gradeInlineHtml(info)}
            </div>`
          : ""}
      </div>
    </div>
  </div>`;
}
