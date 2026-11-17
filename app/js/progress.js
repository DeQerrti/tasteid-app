// ══════════════════════════════════════════════
//  PROGRESS – счётчик «где я сейчас» в окне отзыва
//  Зависит от: utils.js (esc, plural, postRecordOrThrow), config.js
//  (isAdmin), i18n.js. Вызывается из reviews.js (reviewModalBodyHtml,
//  openReviewModal, closeReviewModal).
//
//  Только для записей «В процессе» и только внутри окна отзыва: на
//  карточках снаружи ничего не добавляется (owner, ноябрь 2026: «на
//  самих карточках и так много инфы»). Два уровня: у сериалов, аниме и
//  дорам – сезон и серия, у манги, манхвы, маньхуа, ранобэ и книг – том
//  и глава. Чаще всего жмут серию/главу – она крупно и с «+1»; сезон/том
//  – строкой поменьше над ней. У фильмов, игр и гачи счётчика нет.
//
//  Хранится в самой записи отзыва:
//    progress: { outer, outer_total, inner, inner_total, updated }
//  outer – сезон/том, inner – серия/глава, *_total – «из скольки» (null,
//  если неизвестно), updated – дата последней правки (ГГГГ-ММ-ДД). У
//  сериала inner_total – серий в ТЕКУЩЕМ сезоне, у манги – глав всего
//  (главы в манге обычно сквозные). Полный редактор поле не трогает –
//  сервер переносит его сам (core/api.js, saveReview).
// ══════════════════════════════════════════════

const PROGRESS_SERIAL = {
  serial: true,
  outer: i18n("Сезон"),
  inner: i18n("Серия"),
  innerForms: [i18n("серия"), i18n("серии"), i18n("серий")],
};
const PROGRESS_PRINT = {
  serial: false,
  outer: i18n("Том"),
  inner: i18n("Глава"),
  innerForms: [i18n("глава"), i18n("главы"), i18n("глав")],
};
const PROGRESS_UNITS = {
  anime: PROGRESS_SERIAL,
  show: PROGRESS_SERIAL,
  dorama: PROGRESS_SERIAL,
  manga: PROGRESS_PRINT,
  manhwa: PROGRESS_PRINT,
  manhua: PROGRESS_PRINT,
  novel: PROGRESS_PRINT,
  book: PROGRESS_PRINT,
};

function progressUnits(r) {
  return PROGRESS_UNITS[r?.type] || null;
}

function progressShown(r) {
  return !!r && r.status === "current" && !!progressUnits(r) && isAdmin();
}

function progressToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// «сегодня», «вчера» или «12 ноября» (с годом, если не этот).
function progressWhen(raw) {
  if (!raw) return null;
  const d = parseLocalDate(raw);
  if (isNaN(d)) return null;
  const today = parseLocalDate(progressToday());
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return i18n("сегодня");
  if (diff === 1) return i18n("вчера");
  const opts = { day: "numeric", month: "long" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString(dateLocale(), opts);
}

function progressOf(r) {
  const p = r.progress || {};
  return {
    outer: p.outer ?? null,
    outer_total: p.outer_total ?? null,
    inner: p.inner ?? null,
    inner_total: p.inner_total ?? null,
    updated: p.updated ?? null,
  };
}

function progressNumInput(field, value, label, big) {
  return `<input class="rv-progress-num${big ? " big" : ""}" data-progress-field="${field}" type="number" min="0" inputmode="numeric" value="${value ?? ""}" placeholder="?" aria-label="${esc(label)}">`;
}

// Блок целиком. data-no-export – в картинку окна отзыва (reviewExport) не
// попадает: кнопки «+1» на снимке ни к чему.
function progressBlockHtml(r) {
  if (!progressShown(r)) return "";
  const u = progressUnits(r);
  const p = progressOf(r);
  const inner = p.inner ?? 0;
  const pct = p.inner_total ? Math.min(100, Math.round((inner / p.inner_total) * 100)) : null;
  const left = p.inner_total ? Math.max(0, p.inner_total - inner) : null;
  const innerDone = !!p.inner_total && inner >= p.inner_total;
  // Сколько всего сезонов, бывает неизвестно (онгоинг, не вписали) – тогда
  // после последней серии сезона нельзя знать, конец это или нет:
  // предлагаем и следующий сезон, и «завершено».
  const outerKnown = !!p.outer_total;
  const lastOuter = outerKnown && (p.outer ?? 1) >= p.outer_total;
  const finishBtn = `<button type="button" class="rv-progress-link" data-progress-act="finish">${esc(i18n("отметить завершённым"))}</button>`;

  let note;
  if (innerDone && u.serial && !lastOuter) {
    note =
      `${esc(i18n("Сезон {n} досмотрен", { n: p.outer ?? 1 }))} – <button type="button" class="rv-progress-link" data-progress-act="next">${esc(i18n("начать сезон {n}", { n: (p.outer ?? 1) + 1 }))}</button>` +
      (outerKnown ? "" : ` ${esc(i18n("или"))} ${finishBtn}`);
  } else if (innerDone) {
    note = `${esc(u.serial ? i18n("Это последняя серия") : i18n("Это последняя глава"))} – ${finishBtn}`;
  } else {
    const parts = [];
    if (left !== null) {
      const verb = plural(left, [i18n("осталась"), i18n("осталось"), i18n("осталось")]);
      parts.push(`${verb} ${left} ${plural(left, u.innerForms)}${u.serial ? " " + i18n("в сезоне") : ""}`);
    }
    const when = progressWhen(p.updated);
    if (when) parts.push(i18n("последняя отметка – {when}", { when }));
    note = esc(parts.join(" · "));
  }

  return `<div class="rv-progress" data-no-export>
    <div class="rv-progress-row rv-progress-outer">
      <span class="rv-progress-label">${esc(u.outer)}</span>
      <button type="button" class="rv-progress-step small" data-progress-step="outer:-1" aria-label="${esc(i18n("Меньше"))}">−</button>
      ${progressNumInput("outer", p.outer, u.outer)}
      <button type="button" class="rv-progress-step small" data-progress-step="outer:1" aria-label="${esc(i18n("Больше"))}">+</button>
      <span class="rv-progress-of">${esc(i18n("из"))}</span>
      ${progressNumInput("outer_total", p.outer_total, i18n("Всего"))}
    </div>
    <div class="rv-progress-row">
      <span class="rv-progress-label">${esc(u.inner)}</span>
      <button type="button" class="rv-progress-step" data-progress-step="inner:-1" aria-label="${esc(i18n("Меньше"))}">−</button>
      ${progressNumInput("inner", p.inner, u.inner, true)}
      <button type="button" class="rv-progress-step plus" data-progress-step="inner:1" aria-label="${esc(i18n("Плюс один"))}">+1</button>
      <span class="rv-progress-of">${esc(i18n("из"))}</span>
      ${progressNumInput("inner_total", p.inner_total, u.serial ? i18n("Серий в сезоне") : i18n("Глав всего"))}
      ${u.serial ? `<span class="rv-progress-of">${esc(i18n("в сезоне"))}</span>` : ""}
    </div>
    ${pct !== null ? `<div class="rv-progress-bar"><i style="width:${pct}%"></i></div>` : ""}
    <div class="rv-progress-note" aria-live="polite">${note}</div>
  </div>`;
}

// ── Сохранение ──────────────────────────────────
// Не на каждое нажатие: каждая запись reviews.json кладёт прошлую версию
// в историю, а там хранится ограниченное число версий (HISTORY_LIMIT в
// electron/vault.js) – десяток «+1» подряд вытеснил бы из неё полезные
// версии. Пишем через секунду после последнего нажатия и сразу – при
// закрытии окна или переходе к другому отзыву (progressFlush).
const PROGRESS_SAVE_DELAY = 1000;
let progressPending = null; // { r, timer }

function progressRerender(r) {
  const old = document.querySelector("#review-modal-body .rv-progress");
  if (!old) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = progressBlockHtml(r);
  if (tmp.firstElementChild) old.replaceWith(tmp.firstElementChild);
  else old.remove();
}

function progressSchedule(r) {
  if (progressPending && progressPending.r !== r) progressFlush();
  clearTimeout(progressPending?.timer);
  progressPending = { r, timer: setTimeout(progressFlush, PROGRESS_SAVE_DELAY) };
}

async function progressSave(r) {
  try {
    // Только изменённые поля, а не запись целиком: сервер дополняет запись
    // (saveReview в core/api.js), и правки той же записи, пришедшие
    // синхронизацией, пока окно было открыто, так не затираются.
    await postRecordOrThrow("/api/save-review", {
      _editId: r.id ?? r.title,
      title: r.title,
      progress: r.progress ?? null,
      status: r.status,
      date_end: r.date_end ?? null,
    });
  } catch (err) {
    alert(i18n("Счётчик не сохранился: {msg}", { msg: err.message }));
  }
}

function progressFlush() {
  if (!progressPending) return Promise.resolve();
  const { r, timer } = progressPending;
  clearTimeout(timer);
  progressPending = null;
  return progressSave(r);
}

function progressSet(r, field, value) {
  const p = progressOf(r);
  p[field] = value;
  // Сериал без сезонов – это первый сезон. У манхвы томов может не быть
  // вовсе, поэтому «Том 1» сам не подставляется.
  if (p.outer === null && progressUnits(r)?.serial && (field === "inner" || field === "inner_total")) p.outer = 1;
  p.updated = progressToday();
  r.progress = p;
  progressRerender(r);
  progressSchedule(r);
}

// «Отметить завершённым»: статус и дата конца – сразу, оценка – в
// редакторе, который тут же и открывается.
async function progressFinish(r) {
  clearTimeout(progressPending?.timer);
  progressPending = null;
  r.status = "completed";
  if (!r.date_end) r.date_end = progressToday();
  await progressSave(r);
  cache.reviews = null;
  closeReviewModal();
  if (typeof refreshOpenReviewsTab === "function") refreshOpenReviewsTab();
  location.hash = `#/add?edit=${encodeURIComponent(r.id ?? r.title)}`;
}

function progressCurrentReview() {
  return typeof _reviewModalReview !== "undefined" ? _reviewModalReview : null;
}

document.addEventListener("click", (e) => {
  const block = e.target.closest?.("#review-modal-body .rv-progress");
  if (!block) return;
  const r = progressCurrentReview();
  if (!r) return;
  const step = e.target.closest("[data-progress-step]");
  if (step) {
    const [field, delta] = step.dataset.progressStep.split(":");
    const cur = progressOf(r)[field] ?? (field === "outer" ? 1 : 0);
    progressSet(r, field, Math.max(field === "outer" ? 1 : 0, cur + Number(delta)));
    const input = document.querySelector(`#review-modal-body .rv-progress [data-progress-field="${field}"]`);
    input?.classList.add("bump");
    return;
  }
  const act = e.target.closest("[data-progress-act]")?.dataset.progressAct;
  if (act === "next") {
    const p = progressOf(r);
    r.progress = { ...p, outer: (p.outer ?? 1) + 1, inner: 1, inner_total: null, updated: progressToday() };
    progressRerender(r);
    progressSchedule(r);
  } else if (act === "finish") {
    progressFinish(r);
  }
});

document.addEventListener("change", (e) => {
  const field = e.target.dataset?.progressField;
  if (!field || !e.target.closest("#review-modal-body .rv-progress")) return;
  const r = progressCurrentReview();
  if (!r) return;
  const v = parseInt(e.target.value, 10);
  progressSet(r, field, Number.isFinite(v) && v >= 0 ? v : null);
});

// Enter в поле – сохранить число сразу (change), а не ждать ухода фокуса.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset?.progressField) e.target.blur();
});

// Закрыли окно приложения раньше, чем прошла секунда, – дописать.
window.addEventListener("pagehide", () => {
  progressFlush();
});
