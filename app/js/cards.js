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
  return grade ? { grade, score, raw: found.grade } : null;
}

// Цвет полки оценки для полосы на карточке (.card-body в index.html
// рисует её из --gc). Дописывается к уже существующему style="…" карточки,
// поэтому начинается с ";". Без оценки – пусто, полосы нет.
function gradeColorStyle(info) {
  return info?.grade?.color ? `;--gc:${esc(info.grade.color)}` : "";
}

// Цвет полки – ромбом, сама подпись – светлым текстом, как у
// .card-grade-row в «Отзывах». Раньше подпись красилась цветом полки
// целиком: на чёрном это читалось, а на цветном фоне (тёмная
// ботаническая тема) фиолетовый и синий мелким курсивом пропадали.
function gradeInlineHtml(info) {
  if (!info) return "";
  return `<span class="card-grade-inline" data-tip="${esc(info.grade.desc)}"><span class="card-grade-dot" style="--gc:${esc(info.grade.color)}"></span><span class="card-grade-text">${esc(gradeValueLabel(info.raw))}</span></span>`;
}

// Локаль – по языку интерфейса, а не жёстко "ru-RU": с английским
// интерфейсом даты оставались русскими («12 мар.»), то есть половина
// карточки переводилась, а половина нет.
function fmtDateStr(str, short = false) {
  if (!str) return null;
  const d = parseLocalDate(str);
  if (isNaN(d)) return null;
  const locale = dateLocale();
  const currentYear = new Date().getFullYear();
  // short – компактный числовой формат: единственный вызывающий код
  // (watch-badge на карточке) кладёт сюда ДВЕ даты подряд для периода
  // ("5 окт. → 22 нояб.") – в узкой карточке на телефоне это не влезало
  // ни при какой ширине бейджа, потому что "short" раньше игнорировался
  // для текущего года и там всё равно писалось полное название месяца.
  if (short) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    if (d.getFullYear() === currentYear) return `${dd}.${mm}`;
    const yy = String(d.getFullYear()).slice(2);
    return `${dd}.${mm}.${yy}`;
  }
  if (d.getFullYear() === currentYear) {
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
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
  const info     = grade ? { grade, score: gradeScore(shelf), raw: r.grade } : null;
  const tagLabel = TYPE_LABELS[r.type] || r.type || "–";

  // Дата на карточке. У завершённого – когда закончено (или период), у
  // всего остального, что уже начато («В процессе», «Отложено», свои
  // статусы), – когда начато. Раньше «с …» показывалось только у статуса
  // «В процессе», и отложенное оставалось вовсе без даты.
  let watchBadge = "";
  if (r.status === "completed") {
    const startStr = r.date_start ? fmtDateStr(r.date_start, true) : null;
    const endStr   = r.date_end   ? fmtDateStr(r.date_end,   true) : null;
    if (endStr && startStr && r.date_start !== r.date_end) {
      // Без пробелов вокруг тире – диапазон из двух коротких дат и так
      // самое длинное, что бывает в этой строке.
      watchBadge = `${startStr}–${endStr}`;
    } else if (endStr) {
      watchBadge = endStr;
    } else if (startStr) {
      watchBadge = startStr;
    }
  } else if (r.status && r.status !== "planning" && r.date_start) {
    const s = fmtDateStr(r.date_start, true);
    if (s) watchBadge = i18n("с {date}", { date: s });
  }

  const editId = r.id ?? encodeURIComponent(r.title);
  const pencil = isAdmin()
    ? `<a href="#/add?edit=${editId}" class="review-edit-btn" title="${i18n("Редактировать")}" aria-label="${i18n("Редактировать")}">✎</a>`
    : "";

  // Тип и дата – в подписи под обложкой, а не плашками поверх неё:
  // плашки закрывали углы обложки и были набраны кеглем около 9px.
  // tabindex/role – карточку можно открыть с клавиатуры (Enter/пробел,
  // см. nowBindCardClicks в now.js), как уже сделано в «Отзывах».
  // data-type/data-title – по ним «Статусы» фильтруют уже нарисованные
  // карточки, не пересобирая разметку (см. nowApplyFilter там же).
  const metaMain = [tagLabel !== "–" ? tagLabel : "", r.year ? String(r.year) : ""]
    .filter(Boolean)
    .join(" · ");

  return `<div class="review-card-wrap" data-review-id="${esc(editId)}" data-type="${esc(r.type || "")}" data-title="${esc(normTitle(r.title))}" tabindex="0" role="button" aria-label="${esc(r.title)}" style="animation-delay:${Math.min(index * 25, 600)}ms">
    ${pencil}
    <div class="card" style="animation-delay:0ms${gradeColorStyle(info)}">
      <div class="card-poster">
        <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="" loading="lazy" style="object-position:${esc(r.cover_focus || "50% 50%")}" ${coverFallbackAttrs(r.cover, r.cover_backup)}>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(r.title)}</div>
        ${metaMain || watchBadge
          ? `<div class="card-meta card-meta-now">
              <span class="card-meta-main">${esc(metaMain)}</span>
              ${watchBadge ? `<span class="card-meta-date">${esc(watchBadge)}</span>` : ""}
            </div>`
          : ""}
        ${info ? `<div class="card-grade-line">${gradeInlineHtml(info)}</div>` : ""}
      </div>
    </div>
  </div>`;
}
