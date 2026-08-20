// ══════════════════════════════════════════════
//  CARDS — переиспользуемые функции карточек
//  Зависит от: config.js
//  TYPE_LABELS перенесён в config.js — здесь не объявлять
// ══════════════════════════════════════════════

// ── Хелперы ────────────────────────────────────
function normTitle(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Обработка не открывшихся обложек живёт в js/utils.js: там один
// делегированный слушатель на весь документ, а шаблоны просто ставят
// data-fallback / data-placeholder через imgFallbackAttrs().
// Здесь — только удобная обёртка под вертикальный постер.
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
  return `<span class="card-grade-inline" style="color:${info.grade.color}">${esc(info.grade.name)}</span>`;
}

function fmtDateStr(str, short = false) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  const currentYear = new Date().getFullYear();
  if (d.getFullYear() === currentYear) {
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } else {
    if (short) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yy = String(d.getFullYear()).slice(2);
      return `${dd}.${mm}.${yy}`;
    }
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  }
}

// ── Карточки ───────────────────────────────────

// Тег в отзыве
function tagHtml(tag) {
  const info = TAGS_MAP[tag];
  const customColor = info && CAT_COLORS[info.cat];
  const cls = customColor ? "rtag-custom" : (info ? TAG_CAT_CLASS[info.cat] : "rtag-special");
  const style = customColor ? ` style="--tag-color:${customColor}"` : "";
  const tip  = info?.tip || "";
  return `<span class="rtag ${cls}"${style} data-tip="${esc(tip)}">${esc(tag)}</span>`;
}

// Карточка из reviews.json (главная, архив)
function manualCard(r, index) {
  const info     = findReviewForTitle(r.title, r.type);
  const tagLabel = TYPE_LABELS[r.type] || r.type || "—";

  let watchBadge = "";
  if (r.status === "current" && r.date_start) {
    const s = fmtDateStr(r.date_start, true);
    if (s) watchBadge = `с ${s}`;
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
    ? `<a href="add.html?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}">✎</a>`
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
