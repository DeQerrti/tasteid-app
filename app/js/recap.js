// ══════════════════════════════════════════════
//  RECAP – «Итоги»: год одной открыткой
//  Зависит от: utils.js, config.js, cards.js, stats.js (statsIsCompleted,
//  statsCompletedYear, statsState, TYPE_COLORS), api.js (cache).
//
//  Открывается кнопкой «Итоги ✦» в «Статистике». Четыре вида на выбор –
//  каждый показывает год по-своему, человек сам выбирает, как его
//  показать (owner, ноябрь 2026: «можно другим людям дать выбор»):
//    summary   – выжимка: счётчики, лучшее, типы, месяцы, теги, рекорды;
//    poster    – постер одним экраном: число, тайтл года, четыре обложки
//                и четыре строки (по мотивам Spotify Wrapped/Letterboxd);
//    chronicle – хроника: лучшее каждого месяца (дневник Letterboxd);
//    changes   – что изменилось против прошлого года и всех прошлых
//                (сравнения Steam Replay).
//  Вид запоминается на этом устройстве для этого хранилища. Год – любой,
//  в котором что-то завершено. Снимок картинкой – та же схема, что у
//  statsExport (stats.js).
//
//  «Завершено в году» считается так же, как в «Статистике»
//  (statsIsCompleted + statsCompletedYear), иначе числа в «Итогах» и в
//  статистике за тот же год расходились бы.
// ══════════════════════════════════════════════

const RECAP_VIEWS = [
  { key: "summary", label: i18n("Выжимка") },
  { key: "poster", label: i18n("Постер") },
  { key: "chronicle", label: i18n("Хроника") },
  { key: "changes", label: i18n("Перемены") },
];
const RECAP_VIEW_KEY = "tasteid-recap-view";
const recapState = { year: null, view: "summary" };

function recapLoadView() {
  try {
    const v = localStorage.getItem(vaultScopedKey(RECAP_VIEW_KEY));
    if (RECAP_VIEWS.some((x) => x.key === v)) recapState.view = v;
  } catch {
    // Приватный режим – просто не запомнится.
  }
}

function recapSaveView() {
  try {
    localStorage.setItem(vaultScopedKey(RECAP_VIEW_KEY), recapState.view);
  } catch {
    // см. recapLoadView
  }
}

// ── Данные ──────────────────────────────────────

const recapRaw = (r) => r.date_end || r.date_start || r.date;
const recapShelf = (r) => gradeToShelf(r.grade);
const recapScore = (r) => gradeScore(recapShelf(r)); // 1 – лучшая полка
const recapGrade = (r) => reviewGradeInfo(r)?.grade || null;
// Дней просмотра, оба края включительно, без перерывов между отрезками
// (reviewActiveDays в js/utils.js) – так же, как пишет окно отзыва. Раньше
// здесь была разница дат без +1, и «Дольше всего» показывало на день
// меньше, чем окно того же отзыва.
const recapDays = (r) => reviewActiveDays(r);

function recapCompleted() {
  return (cache.reviews || []).filter((r) => statsIsCompleted(r) && recapRaw(r));
}

function recapYears() {
  return [...new Set(recapCompleted().map(statsCompletedYear).filter(Boolean))].sort((a, b) => b - a);
}

function recapCountBy(list, f) {
  const c = {};
  for (const r of list) {
    for (const k of [].concat(f(r))) if (k !== null && k !== undefined && k !== "") c[k] = (c[k] || 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

function recapAvgShelf(list) {
  const s = list.map(recapScore).filter((x) => x !== null);
  if (!s.length) return null;
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const key = GRADE_ORDER[Math.min(GRADE_ORDER.length, Math.max(1, Math.round(avg))) - 1];
  return { avg, grade: GRADES[key] };
}

function recapData(y) {
  const all = recapCompleted();
  const list = all.filter((r) => statsCompletedYear(r) === y);
  const months = Array(12).fill(0);
  for (const r of list) months[parseLocalDate(recapRaw(r)).getMonth()]++;
  const graded = list.filter((r) => recapScore(r) !== null).sort((a, b) => recapScore(a) - recapScore(b));
  const top2 = GRADE_ORDER.slice(0, 2);
  const low2 = GRADE_ORDER.length > 3 ? GRADE_ORDER.slice(-2) : [];
  const timed = list.filter((r) => recapDays(r) !== null).sort((a, b) => recapDays(b) - recapDays(a));
  return {
    y,
    list,
    all,
    prev: all.filter((r) => statsCompletedYear(r) === y - 1),
    before: all.filter((r) => statsCompletedYear(r) < y),
    types: recapCountBy(list, (r) => r.type),
    months,
    tags: recapCountBy(list, (r) => r.tags || []),
    graded,
    best: graded.filter((r) => top2.includes(recapShelf(r))),
    worst: graded.filter((r) => low2.includes(recapShelf(r))),
    longest: timed[0] && recapDays(timed[0]) > 1 ? timed[0] : null,
    oneDay: timed.filter((r) => recapDays(r) === 1),
    written: list.filter((r) => (r.review_full || r.preview || "").trim()).length,
    fav: list.filter((r) => r.favorite),
  };
}

// ── Кусочки разметки ────────────────────────────

const recapTypeName = (k) => TYPE_LABELS[k] || k;
const recapMonth = (i, form = "long") =>
  new Date(2000, i, 1).toLocaleDateString(dateLocale(), { month: form }).replace(".", "");
const recapDaysWord = (n) => plural(n, [i18n("день"), i18n("дня"), i18n("дней")]);
const recapTitlesWord = (n) => plural(n, [i18n("тайтл"), i18n("тайтла"), i18n("тайтлов")]);

function recapImg(r) {
  return `<img ${coverImgAttrs(r.cover, r.cover_backup)} alt="" style="object-position:${esc(r.cover_focus || "50% 50%")}">`;
}

function recapGradeLine(g) {
  return g ? `<span class="card-grade-dot" style="--gc:${esc(g.color)}"></span>${esc(g.name)}` : "";
}

function recapCover(r) {
  const g = recapGrade(r);
  return `<figure class="recap-cover"><div class="recap-img">${recapImg(r)}</div>
    <figcaption>${g ? `${recapGradeLine(g)}<br>` : ""}<strong>${esc(r.title)}</strong></figcaption></figure>`;
}

function recapFact(r, kicker, big, title, sub) {
  return `<div class="recap-fact">
    ${r ? `<div class="recap-fact-img">${recapImg(r)}</div>` : ""}
    <div>
      <div class="recap-k">${esc(kicker)}</div>
      ${big ? `<div class="recap-big">${esc(big)}</div>` : ""}
      ${title ? `<div class="recap-t">${esc(title)}</div>` : ""}
      ${sub ? `<div class="recap-s">${esc(sub)}</div>` : ""}
    </div>
  </div>`;
}

function recapHead(d, kicker, lead) {
  return `<header class="recap-head">
    <div class="recap-kicker">${esc(kicker)}</div>
    <div class="recap-year">${d.y}</div>
    <div class="recap-lead">${lead}</div>
  </header>`;
}

function recapOneDayText(d) {
  const names = d.oneDay.slice(0, 3).map((r) => r.title).join(", ");
  const more = d.oneDay.length > 3 ? " " + i18n("и ещё {n}", { n: d.oneDay.length - 3 }) : "";
  return i18n("начаты и закончены в один день: {names}", { names }) + more;
}

// ── Вид «Выжимка» ───────────────────────────────

function recapSummaryHtml(d) {
  const total = d.list.length;
  const prevN = d.prev.length;
  const diff = total - prevN;
  let diffTxt = "";
  if (prevN) {
    diffTxt =
      diff > 0
        ? i18n("на {n} больше, чем в {y}", { n: diff, y: d.y - 1 })
        : diff < 0
          ? i18n("на {n} меньше, чем в {y}", { n: -diff, y: d.y - 1 })
          : i18n("столько же, сколько в {y}", { y: d.y - 1 });
  }
  const maxM = Math.max(...d.months, 1);
  const peak = d.months.indexOf(maxM);
  const closed = plural(total, [i18n("тайтл закрыт"), i18n("тайтла закрыто"), i18n("тайтлов закрыто")]);
  const typeBar = d.types
    .map(([k, n]) => `<i style="flex:${n};background:${esc(TYPE_COLORS[k] || "var(--red)")}" title="${esc(recapTypeName(k))}: ${n}"></i>`)
    .join("");
  const typeLegend = d.types
    .map(([k, n]) => `<span class="recap-legend"><b style="background:${esc(TYPE_COLORS[k] || "var(--red)")}"></b>${esc(recapTypeName(k))} <em>${n}</em></span>`)
    .join("");
  const months = d.months
    .map(
      (n, i) =>
        `<div class="recap-m${i === peak ? " peak" : ""}"><em>${n || ""}</em><span class="recap-mbar" style="height:${Math.round((n / maxM) * 100)}%"></span><small>${esc(recapMonth(i, "short"))}</small></div>`
    )
    .join("");
  const tags = d.tags
    .slice(0, 8)
    .map(([t, n]) => `<span class="recap-tag">${esc(tagLabel(t))} <em>${n}</em></span>`)
    .join("");
  const L = d.longest;
  const facts = [
    L
      ? recapFact(L, i18n("Дольше всего"), `${recapDays(L)} ${recapDaysWord(recapDays(L))}`, L.title,
          `${fmtDateStr(L.date_start, true)} – ${fmtDateStr(L.date_end, true)}`)
      : "",
    d.oneDay.length
      ? recapFact(d.oneDay[0], i18n("На одном дыхании"), `${d.oneDay.length} ${recapTitlesWord(d.oneDay.length)}`, "", recapOneDayText(d))
      : "",
  ].join("");

  return `<article class="recap-card" data-view="summary">
    ${recapHead(d, i18n("TasteID · итоги года"), `<strong>${total}</strong> ${esc(closed)}${diffTxt ? ` – ${esc(diffTxt)}` : ""}`)}
    <div class="recap-counters">
      <div><b>${d.written}</b><span>${esc(plural(d.written, [i18n("отзыв написан"), i18n("отзыва написано"), i18n("отзывов написано")]))}</span></div>
      <div><b>${d.best.length}</b><span>${esc(i18n("на верхних полках"))}</span></div>
      <div><b>${d.fav.length}</b><span>${esc(i18n("в любимом"))} ♥</span></div>
      <div><b>${esc(recapMonth(peak))}</b><span>${esc(i18n("самый плотный месяц · {n}", { n: maxM }))}</span></div>
    </div>
    ${d.best.length ? `<section class="recap-sec"><h3>${esc(i18n("Лучшее года"))}</h3><div class="recap-row">${d.best.slice(0, 8).map(recapCover).join("")}</div></section>` : ""}
    ${d.types.length ? `<section class="recap-sec"><h3>${esc(i18n("Из чего был год"))}</h3><div class="recap-typebar">${typeBar}</div><div class="recap-legends">${typeLegend}</div></section>` : ""}
    <section class="recap-sec"><h3>${esc(i18n("По месяцам"))}</h3><div class="recap-months">${months}</div></section>
    ${tags ? `<section class="recap-sec"><h3>${esc(i18n("Чаще всего в тегах"))}</h3><div class="recap-tags">${tags}</div></section>` : ""}
    ${facts ? `<section class="recap-sec recap-facts">${facts}</section>` : ""}
    ${d.worst.length ? `<section class="recap-sec"><h3>${esc(i18n("Не зашло"))}</h3><div class="recap-row small">${d.worst.slice(0, 8).map(recapCover).join("")}</div></section>` : ""}
  </article>`;
}

// ── Вид «Постер» ────────────────────────────────

function recapPosterHtml(d) {
  const total = d.list.length;
  const words = d.tags.slice(0, 3).map(([t]) => tagLabel(t));
  const [topType, topN] = d.types[0] || [];
  const hero = d.graded[0] || d.list[0];
  const g = hero && recapGrade(hero);
  const strip = (d.graded.length ? d.graded : d.list).filter((r) => r !== hero).slice(0, 4);
  const L = d.longest;
  const rows = [
    words.length ? [i18n("Год в трёх словах"), words.join(" · ")] : null,
    topType ? [i18n("Больше всего"), `${recapTypeName(topType).toLowerCase()} – ${topN}`] : null,
    L ? [i18n("Дольше всего"), `${L.title} – ${recapDays(L)} ${recapDaysWord(recapDays(L))}`] : null,
    [i18n("Написано отзывов"), i18n("{n} из {total}", { n: d.written, total })],
  ].filter(Boolean);

  return `<article class="recap-card recap-poster" data-view="poster">
    <div class="recap-kicker">TasteID · ${d.y}</div>
    <div class="recap-poster-num">${total}</div>
    <div class="recap-poster-label">${esc(i18n("{word} за год", { word: recapTitlesWord(total) }))}</div>
    ${hero ? `<div class="recap-poster-hero">
        <div class="recap-poster-hero-img">${recapImg(hero)}</div>
        <div><div class="recap-k">${esc(i18n("Тайтл года"))}</div>
          <div class="recap-poster-title">${esc(hero.title)}</div>
          ${g ? `<div class="recap-s">${recapGradeLine(g)}</div>` : ""}</div>
      </div>` : ""}
    ${strip.length ? `<div class="recap-poster-strip">${strip.map((r) => `<div class="recap-img">${recapImg(r)}</div>`).join("")}</div>` : ""}
    <dl class="recap-poster-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
  </article>`;
}

// ── Вид «Хроника» ───────────────────────────────

function recapChronicleHtml(d) {
  const total = d.list.length;
  const byM = Array.from({ length: 12 }, () => []);
  for (const r of d.list) byM[parseLocalDate(recapRaw(r)).getMonth()].push(r);
  // Текущий год – только прошедшие месяцы, без пустых «будущих».
  const now = new Date();
  const lastMonth = d.y === now.getFullYear() ? now.getMonth() : 11;
  const cells = byM
    .slice(0, lastMonth + 1)
    .map((items, i) => {
      items.sort((a, b) => (recapScore(a) ?? 99) - (recapScore(b) ?? 99));
      const top = items[0];
      const rest = items.slice(1, 6);
      const g = top && recapGrade(top);
      return `<div class="recap-chron-m${items.length ? "" : " empty"}">
        <div class="recap-chron-head"><span>${esc(recapMonth(i))}</span><em>${items.length || "–"}</em></div>
        ${top
          ? `<div class="recap-chron-top"><div class="recap-img"${g ? ` style="--gc:${esc(g.color)}"` : ""}>${recapImg(top)}</div>
              <div class="recap-chron-t">${esc(top.title)}${g ? `<small>${recapGradeLine(g)}</small>` : ""}</div></div>`
          : `<div class="recap-chron-none">${esc(i18n("тишина"))}</div>`}
        ${rest.length ? `<div class="recap-chron-rest">${rest.map((r) => `<div class="recap-img" title="${esc(r.title)}">${recapImg(r)}</div>`).join("")}${items.length > 6 ? `<span>+${items.length - 6}</span>` : ""}</div>` : ""}
      </div>`;
    })
    .join("");
  return `<article class="recap-card" data-view="chronicle">
    ${recapHead(d, i18n("TasteID · хроника года"), `<strong>${total}</strong> ${esc(recapTitlesWord(total))} · ${esc(i18n("крупно – лучшее месяца по оценке"))}`)}
    <div class="recap-chron">${cells}</div>
  </article>`;
}

// ── Вид «Перемены» ──────────────────────────────

function recapChangesHtml(d) {
  const total = d.list.length;
  const prevN = d.prev.length;
  const lead =
    `<strong>${total}</strong> ${esc(recapTitlesWord(total))}` +
    (prevN
      ? ` ${esc(i18n("против {n} в {y}", { n: prevN, y: d.y - 1 }))} – ${total >= prevN ? "+" : "−"}${Math.round((Math.abs(total - prevN) / prevN) * 100)}%`
      : "");

  // Оценки: этот год против всех прошлых вместе.
  const ya = recapAvgShelf(d.list);
  const ba = recapAvgShelf(d.before);
  let gradeTxt = "";
  if (ya && ba) {
    const diff = ba.avg - ya.avg; // > 0 – в этом году полки выше (номер меньше)
    gradeTxt =
      Math.abs(diff) < 0.2
        ? i18n("как обычно – в среднем «{g}»", { g: ya.grade.name })
        : diff > 0
          ? i18n("щедрее обычного: в среднем «{g}», раньше – «{was}»", { g: ya.grade.name, was: ba.grade.name })
          : i18n("строже обычного: в среднем «{g}», раньше – «{was}»", { g: ya.grade.name, was: ba.grade.name });
  }

  // Типы: этот год против прошлого.
  const prevT = Object.fromEntries(recapCountBy(d.prev, (r) => r.type));
  const curT = Object.fromEntries(d.types);
  const keys = [...new Set([...Object.keys(curT), ...Object.keys(prevT)])].sort((a, b) => (curT[b] || 0) - (curT[a] || 0));
  const maxT = Math.max(1, ...keys.map((k) => Math.max(curT[k] || 0, prevT[k] || 0)));
  const typeRows = keys
    .map((k) => {
      const c = curT[k] || 0;
      const p = prevT[k] || 0;
      const delta = c - p;
      return `<div class="recap-cmp-row"><span class="recap-cmp-name">${esc(recapTypeName(k))}</span>
        <span class="recap-cmp-bars"><i class="prev" style="width:${(p / maxT) * 100}%"></i><i class="cur" style="width:${(c / maxT) * 100}%;background:${esc(TYPE_COLORS[k] || "var(--red)")}"></i></span>
        <span class="recap-cmp-n">${c}</span><span class="recap-cmp-d${delta > 0 ? " up" : delta < 0 ? " down" : ""}">${delta > 0 ? "+" + delta : delta < 0 ? "−" + -delta : "="}</span></div>`;
    })
    .join("");

  // Теги: что стало заметно чаще и что ушло. Сравниваем доли, а не
  // штуки – годы разной длины.
  const beforeTags = Object.fromEntries(recapCountBy(d.before, (r) => r.tags || []));
  const nowTags = Object.fromEntries(d.tags);
  const share = (n, all) => n / Math.max(1, all);
  const rising = d.tags
    .filter(([t, n]) => n >= 3 && share(n, total) > 2 * share(beforeTags[t] || 0, d.before.length))
    .slice(0, 5);
  const fading = Object.entries(beforeTags)
    .filter(([t, n]) => n >= 8 && share(nowTags[t] || 0, total) < 0.4 * share(n, d.before.length))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Эпоха и края года.
  const rel = d.list.filter((r) => /^\d{4}$/.test(String(r.year || ""))).sort((a, b) => a.year - b.year);
  const oldest = rel[0];
  const newest = rel[rel.length - 1];
  const fresh = rel.filter((r) => Number(r.year) >= d.y - 1).length;
  const byEnd = [...d.list].sort((a, b) => String(recapRaw(a)).localeCompare(String(recapRaw(b))));
  const first = byEnd[0];
  const last = byEnd[byEnd.length - 1];

  const tagList = (arr, cls, arrow, empty, count) =>
    arr.length
      ? arr.map(([t, n]) => `<span class="recap-tag ${cls}">${arrow} ${esc(tagLabel(t))} <em>${count ? count(t) : n}</em></span>`).join("")
      : `<span class="recap-s">${esc(empty)}</span>`;

  return `<article class="recap-card" data-view="changes">
    ${recapHead(d, i18n("TasteID · как изменился вкус"), lead)}
    ${gradeTxt ? `<section class="recap-sec recap-verdict"><div class="recap-k">${esc(i18n("Оценки"))}</div><div class="recap-verdict-t">${esc(gradeTxt)}</div></section>` : ""}
    ${keys.length ? `<section class="recap-sec"><h3>${esc(i18n("Типы: {y} против {p}", { y: d.y, p: d.y - 1 }))}</h3>
      <div class="recap-cmp">${typeRows}</div>
      <div class="recap-s recap-cmp-legend"><i class="prev"></i> ${d.y - 1} <i class="cur"></i> ${d.y}</div></section>` : ""}
    ${d.before.length ? `<section class="recap-sec recap-cmp-cols">
      <div><h3>${esc(i18n("Новое во вкусе"))}</h3><div class="recap-s">${esc(i18n("теги, которых в этом году стало заметно больше"))}</div>
        <div class="recap-tags">${tagList(rising, "up", "↑", i18n("ничего резкого"))}</div></div>
      <div><h3>${esc(i18n("Отошло на второй план"))}</h3><div class="recap-s">${esc(i18n("раньше было часто, в этом году – редко"))}</div>
        <div class="recap-tags">${tagList(fading, "down", "↓", i18n("ничего не ушло"), (t) => nowTags[t] || 0)}</div></div>
    </section>` : ""}
    <section class="recap-sec recap-facts">
      ${oldest ? recapFact(oldest, i18n("Самое старое"), String(oldest.year), oldest.title, "") : ""}
      ${newest && newest !== oldest ? recapFact(newest, i18n("Самое свежее"), String(newest.year), newest.title,
          `${fresh} ${plural(fresh, [i18n("новинка"), i18n("новинки"), i18n("новинок")])} ${d.y - 1}–${d.y}`) : ""}
      ${first ? recapFact(first, i18n("Первое в году"), "", first.title, fmtDateStr(recapRaw(first))) : ""}
      ${last && last !== first ? recapFact(last, d.y === new Date().getFullYear() ? i18n("Последнее на сегодня") : i18n("Последнее в году"), "", last.title, fmtDateStr(recapRaw(last))) : ""}
    </section>
  </article>`;
}

// ── Окно ────────────────────────────────────────

const RECAP_RENDER = {
  summary: recapSummaryHtml,
  poster: recapPosterHtml,
  chronicle: recapChronicleHtml,
  changes: recapChangesHtml,
};

function recapHtml() {
  const years = recapYears();
  const y = recapState.year;
  const top = `<div class="recap-top">
    <div class="recap-title">${esc(i18n("Итоги"))}</div>
    <div class="recap-views" role="tablist" aria-label="${esc(i18n("Вид итогов"))}">${RECAP_VIEWS.map(
      (v) => `<button type="button" class="recap-view${v.key === recapState.view ? " active" : ""}" role="tab" aria-selected="${v.key === recapState.view}" data-recap-view="${v.key}">${esc(v.label)}</button>`
    ).join("")}</div>
    <div class="recap-actions">
      ${cameraButton("recapExport()", "recap-export-btn")}
      <button type="button" class="icon-btn" title="${esc(i18n("Закрыть"))}" aria-label="${esc(i18n("Закрыть"))}" onclick="closeRecap()">✕</button>
    </div>
    <div class="recap-years">${years.map((yy) => `<button type="button" class="tl-filter${yy === y ? " active" : ""}" data-recap-year="${yy}">${yy}</button>`).join("")}</div>
  </div>`;
  if (!years.length || y === null) {
    return top + `<div class="state-box">${esc(i18n("Пока нет завершённых тайтлов"))}</div>`;
  }
  return top + RECAP_RENDER[recapState.view](recapData(y));
}

function recapRender() {
  const box = document.getElementById("recap-body");
  if (box) box.innerHTML = recapHtml();
  recapYearIntoView(box);
}

// На телефоне годы – одной строкой с прокруткой (index.html): выбранный
// год прокручиваем в видимую часть, иначе ранний год оставался за краем.
// Только сама строка – окно по высоте не двигается.
function recapYearIntoView(box) {
  const row = box?.querySelector(".recap-years");
  const active = row?.querySelector(".active");
  if (!row || !active || row.scrollWidth <= row.clientWidth) return;
  const left = active.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
  row.scrollLeft = Math.max(0, left - (row.clientWidth - active.offsetWidth) / 2);
}

function recapEnsureOverlay() {
  let overlay = document.getElementById("recap-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "recap-overlay";
  overlay.className = "recap-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", i18n("Итоги"));
  overlay.innerHTML = `<div class="recap-wrap" id="recap-body" tabindex="-1"></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    const yb = e.target.closest("[data-recap-year]");
    if (yb) {
      recapState.year = Number(yb.dataset.recapYear);
      recapRender();
      return;
    }
    const vb = e.target.closest("[data-recap-view]");
    if (vb) {
      recapState.view = vb.dataset.recapView;
      recapSaveView();
      recapRender();
      return;
    }
    if (e.target === overlay) closeRecap();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeRecap();
  });
  return overlay;
}

let _recapOpener = null;

// year – необязательный: по умолчанию год, выбранный в «Статистике», а на
// «Все годы» – последний год, в котором что-то завершено.
function openRecap(year) {
  recapLoadView();
  const years = recapYears();
  const wanted = Number(year ?? (statsState.year === "all" ? NaN : statsState.year));
  recapState.year = years.includes(wanted) ? wanted : (years[0] ?? null);
  const overlay = recapEnsureOverlay();
  _recapOpener = document.activeElement;
  recapRender();
  overlay.classList.remove("hidden");
  overlay.scrollTop = 0;
  document.body.style.overflow = "hidden";
  document.getElementById("recap-body")?.focus();
}

function closeRecap() {
  const overlay = document.getElementById("recap-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  _recapOpener?.focus?.();
  _recapOpener = null;
}

// Снимок открытки картинкой – тот же порядок, что у statsExport
// (stats.js): подгрузить картинки, подменить их копиями с диска, снять
// анимации и тени, снять, вернуть всё обратно.
async function recapExport() {
  const card = document.querySelector("#recap-body .recap-card");
  if (!card) return;
  const btn = document.getElementById("recap-export-btn");
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
    const imgs = Array.from(card.querySelectorAll("img"));
    await forceLoadImagesForExport(imgs);
    restoreImages = await proxyImagesToDataUrls(card);
    restoreAnim = disableAnimations(card);
    restoreShadows = bakeNeoShadows(card);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const canvas = await withTimeout(
      html2canvas(card, {
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0a0a0c",
        scale: safeCaptureScale(card, 2),
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
    link.download = `tasteid-${recapState.year}-${recapState.view}.png`;
    link.href = canvas.toDataURL("image/png");
    // В документ обязательно – см. тот же приём у tlExport() в tierlist.js.
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    alert(i18n("Не удалось создать картинку 😢") + "\n" + err.message);
  } finally {
    restoreImages();
    restoreAnim();
    restoreShadows();
    restoreBtn();
  }
}
