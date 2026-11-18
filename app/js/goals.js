// ══════════════════════════════════════════════
//  ЦЕЛИ НА ГОД – окно из «Статистики» (кнопка «Цели» рядом с «Итогами»)
//
//  По макету, одобренному owner'ом (ноябрь 2026): список целей года –
//  по типам и, по желанию, «Всё вместе», у каждой своя полоса; нажатие
//  на цель – подробно про неё: сколько из скольких, по месяцам, обложки
//  законченного (обложка открывает отзыв поверх окна). Черты «где стоило
//  бы быть сегодня» и подсказок про график нет – owner их убрал.
//
//  Хранятся в site-settings.json: goals = { "2026": [{ type, n }] },
//  type – ключ типа или "all". Пишутся через patchSiteSettings (config.js)
//  со слиянием, поэтому синхронизация с другого устройства не теряется.
//  «Закончено в году» – те же statsIsCompleted/statsCompletedYear, что в
//  «Статистике» и «Итогах», иначе числа разошлись бы.
// ══════════════════════════════════════════════

// Названия месяцев – как в «Итогах» (recapMonth): языком интерфейса.
const goalsMonth = (i) =>
  new Date(2000, i, 1).toLocaleDateString(dateLocale(), { month: "short" }).replace(".", "");
const goalsState = { year: null, open: null, editing: false, adding: false, goals: {}, busy: false };
let _goalsOpener = null;

const goalsThisYear = () => new Date().getFullYear();
const goalsTypeName = (t) => (t === "all" ? i18n("Всё вместе") : statsTypeName(t));
const goalsTypeColor = (t) => (t === "all" ? "var(--text-hi)" : typeColor(t));
const goalsDateOf = (r) => parseLocalDate(r.date_end || r.date_start || r.date);

// Нормальный вид того, что лежит в настройках: только годы-числа и
// цели с типом и положительным числом.
function goalsClean(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [y, list] of Object.entries(raw)) {
    if (!/^\d{4}$/.test(y) || !Array.isArray(list)) continue;
    const clean = list
      .filter((g) => g && typeof g.type === "string" && Number(g.n) > 0)
      .map((g) => ({ type: g.type, n: Math.round(Number(g.n)) }));
    if (clean.length) out[y] = clean;
  }
  return out;
}

function goalsOf(year) {
  return goalsState.goals[String(year)] || [];
}

function goalsDone(year, type) {
  return (cache.reviews || []).filter(
    (r) => statsIsCompleted(r) && statsCompletedYear(r) === year && (type === "all" || r.type === type)
  );
}

function goalsBar(k, n, color) {
  return `<span class="gl-bar" style="--gc:${color}"><i style="width:${Math.min(100, (k / n) * 100).toFixed(1)}%"></i></span>`;
}

function goalsLeftText(year, k, n) {
  if (k >= n) return k > n ? i18n("Выполнено, и ещё {n} сверху.", { n: k - n }) : i18n("Выполнено!");
  if (year < goalsThisYear()) return i18n("Не хватило {n}.", { n: n - k });
  return i18n("До цели осталось {n}.", { n: n - k });
}

// Типы для «+ Добавить цель»: все включённые (со своими), кроме уже
// занятых в этом году.
function goalsFreeTypes(year) {
  const used = new Set(goalsOf(year).map((g) => g.type));
  return ["all", ...Object.keys(TYPE_LABELS)].filter((t) => !used.has(t));
}

function goalsListHtml() {
  const y = goalsState.year;
  const list = goalsOf(y);
  const canAdd = y >= goalsThisYear();
  const head = `<div class="recap-head"><div class="recap-kicker">${esc(i18n("Цели"))}</div><div class="gl-year">${y}</div></div>`;

  if (!list.length && !goalsState.adding) {
    const prev = goalsDone(y - 1, "all");
    const byType = {};
    prev.forEach((r) => (byType[r.type] = (byType[r.type] || 0) + 1));
    const hint = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([t, k]) => `${esc(goalsTypeName(t).toLowerCase())} – ${k}`)
      .join(", ");
    return `<div class="recap-card gl-card">${head}
      <p class="gl-empty">${esc(
        canAdd
          ? i18n("Поставьте себе цель – например, 12 книг или 20 фильмов за год, – и здесь будет видно, сколько уже сделано.")
          : i18n("На этот год целей не было.")
      )}${
        canAdd && prev.length
          ? `<br>${esc(i18n("Для ориентира: в {year} вы закончили {n}", { year: y - 1, n: prev.length }))} (${hint}).`
          : ""
      }</p>
      ${canAdd ? `<div class="gl-center"><button type="button" class="tl-filter active" data-gl-add>${esc(i18n("Поставить цель"))}</button></div>` : ""}
    </div>`;
  }

  const rows = list
    .map((g, i) => {
      const k = goalsDone(y, g.type).length;
      return `<div class="gl-row${g.type === "all" ? " gl-row-all" : ""}" style="--tc:${goalsTypeColor(g.type)}">
        <button type="button" class="gl-row-main" data-gl-open="${i}"${goalsState.editing ? " disabled" : ""}>
          <span class="gl-row-name"><i></i>${esc(goalsTypeName(g.type))}</span>
          ${goalsBar(k, g.n, goalsTypeColor(g.type))}
          <span class="gl-row-n"><b>${k}</b> / ${g.n}${k >= g.n ? " ✓" : ""}</span>
          <span class="gl-go" aria-hidden="true">›</span>
        </button>
        ${
          goalsState.editing
            ? `<input type="number" min="1" max="9999" value="${g.n}" data-gl-n="${i}" aria-label="${esc(i18n("Цель: {type}", { type: goalsTypeName(g.type) }))}">
               <button type="button" class="icon-btn" data-gl-del="${i}" aria-label="${esc(i18n("Убрать цель: {type}", { type: goalsTypeName(g.type) }))}">✕</button>`
            : ""
        }
      </div>`;
    })
    .join("");

  const free = goalsFreeTypes(y);
  const addForm =
    goalsState.adding && free.length
      ? `<div class="gl-add">
          <select data-gl-new-type aria-label="${esc(i18n("Тип"))}">${free
            .map((t) => `<option value="${esc(t)}">${esc(goalsTypeName(t))}</option>`)
            .join("")}</select>
          <input type="number" min="1" max="9999" value="10" data-gl-new-n aria-label="${esc(i18n("Сколько"))}">
          <button type="button" class="tl-filter active" data-gl-add-ok>${esc(i18n("Добавить"))}</button>
          <button type="button" class="gl-link" data-gl-add-cancel>${esc(i18n("Отмена"))}</button>
        </div>`
      : "";

  return `<div class="recap-card gl-card">${head}
    <div class="gl-rows">${rows}</div>
    ${addForm}
    <div class="gl-foot">
      ${canAdd && free.length && !goalsState.adding ? `<button type="button" class="gl-link" data-gl-add>+ ${esc(i18n("Добавить цель"))}</button>` : ""}
      ${list.length ? `<button type="button" class="gl-link" data-gl-edit>${esc(goalsState.editing ? i18n("Готово") : i18n("Изменить"))}</button>` : ""}
    </div>
    <div class="status-msg" id="gl-status"></div>
  </div>`;
}

function goalsDetailHtml() {
  const y = goalsState.year;
  const g = goalsOf(y)[goalsState.open];
  if (!g) return goalsListHtml();
  const items = goalsDone(y, g.type).sort((a, b) => goalsDateOf(a) - goalsDateOf(b));
  const k = items.length;
  const color = goalsTypeColor(g.type);
  const byMonth = Array(12).fill(0);
  items.forEach((r) => byMonth[goalsDateOf(r).getMonth()]++);
  const max = Math.max(1, ...byMonth);
  const now = new Date();
  const lastMonth = y === now.getFullYear() ? now.getMonth() : y < now.getFullYear() ? 11 : -1;
  const months = byMonth
    .map(
      (v, i) => `<span class="${i > lastMonth ? "future" : ""}" title="${esc(goalsMonth(i))}: ${v}">
        <b>${v || ""}</b><i style="height:${v ? Math.max(8, (v / max) * 100) : 2}%"></i><small>${esc(goalsMonth(i))}</small></span>`
    )
    .join("");
  const covers = items
    .map(
      (r) =>
        `<button type="button" class="gl-cover" data-gl-review="${esc(String(r.id))}" title="${esc(r.title)}" aria-label="${esc(r.title)}"><img ${statsCoverAttrs(r)} alt="" loading="lazy"></button>`
    )
    .join("");
  return `<div class="recap-card gl-card" style="--tc:${color}">
    <button type="button" class="gl-link gl-back" data-gl-back>← ${esc(i18n("Все цели"))}</button>
    <div class="recap-head">
      <div class="recap-kicker">${esc(goalsTypeName(g.type))} · ${y}</div>
      <div class="gl-big"><b>${k}</b><span>${esc(i18n("из {n}", { n: g.n }))}</span></div>
    </div>
    ${goalsBar(k, g.n, color)}
    <p class="gl-pace">${esc(goalsLeftText(y, k, g.n))}</p>
    <div class="gl-months">${months}</div>
    ${k ? `<div class="recap-kicker gl-sub">${esc(i18n("Уже закончено"))}</div><div class="gl-covers">${covers}</div>` : ""}
  </div>`;
}

// Годы в окне: текущий и те, на которые цели ставили.
function goalsYears() {
  const ys = new Set([goalsThisYear(), ...Object.keys(goalsState.goals).map(Number)]);
  return [...ys].sort((a, b) => b - a);
}

function goalsHtml() {
  const top = `<div class="recap-top">
    <div class="recap-title">${esc(i18n("Цели"))}</div>
    <div></div>
    <div class="recap-actions">
      <button type="button" class="icon-btn" title="${esc(i18n("Закрыть"))}" aria-label="${esc(i18n("Закрыть"))}" data-gl-close>✕</button>
    </div>
    <div class="recap-years">${goalsYears()
      .map(
        (yy) =>
          `<button type="button" class="tl-filter${yy === goalsState.year ? " active" : ""}" data-gl-year="${yy}">${yy}</button>`
      )
      .join("")}</div>
  </div>`;
  return top + (goalsState.open != null ? goalsDetailHtml() : goalsListHtml());
}

function goalsRender() {
  const box = document.getElementById("goals-body");
  if (box) box.innerHTML = goalsHtml();
}

async function goalsSave(mutate) {
  if (goalsState.busy) return;
  goalsState.busy = true;
  const year = String(goalsState.year);
  try {
    const saved = await patchSiteSettings((settings) => {
      const all = goalsClean(settings.goals);
      const list = mutate(all[year] ? [...all[year]] : []);
      if (list.length) all[year] = list;
      else delete all[year];
      settings.goals = all;
    });
    goalsState.goals = goalsClean(saved.goals);
    return true;
  } catch (err) {
    const st = document.getElementById("gl-status");
    if (st) {
      st.className = "status-msg err";
      st.textContent = err.message;
    }
    return false;
  } finally {
    goalsState.busy = false;
  }
}

async function goalsOnClick(e) {
  const overlay = document.getElementById("goals-overlay");
  const q = (sel) => e.target.closest(sel);
  if (e.target === overlay || q("[data-gl-close]")) return closeGoals();

  const review = q("[data-gl-review]");
  if (review) {
    const r = (cache.reviews || []).find((x) => String(x.id) === review.dataset.glReview);
    if (r) openReviewModal(r);
    return;
  }
  const yb = q("[data-gl-year]");
  if (yb) {
    goalsState.year = Number(yb.dataset.glYear);
    goalsState.open = null;
    goalsState.editing = goalsState.adding = false;
  } else if (q("[data-gl-open]")) {
    if (goalsState.editing) return;
    goalsState.open = Number(q("[data-gl-open]").dataset.glOpen);
  } else if (q("[data-gl-back]")) {
    goalsState.open = null;
  } else if (q("[data-gl-edit]")) {
    if (goalsState.editing) {
      const values = {};
      overlay.querySelectorAll("[data-gl-n]").forEach((inp) => {
        values[inp.dataset.glN] = Math.max(1, Math.min(9999, Math.round(Number(inp.value)) || 1));
      });
      // По типу, а не по номеру строки: на диске список мог успеть
      // поменяться синхронизацией, пока окно было открыто.
      const byType = {};
      goalsOf(goalsState.year).forEach((g, i) => {
        if (i in values && values[i] !== g.n) byType[g.type] = values[i];
      });
      if (Object.keys(byType).length) {
        const ok = await goalsSave((list) => list.map((g) => (g.type in byType ? { ...g, n: byType[g.type] } : g)));
        if (!ok) return;
      }
    }
    goalsState.editing = !goalsState.editing;
    goalsState.adding = false;
  } else if (q("[data-gl-del]")) {
    const g = goalsOf(goalsState.year)[Number(q("[data-gl-del]").dataset.glDel)];
    if (!g) return;
    if (!(await goalsSave((list) => list.filter((x) => x.type !== g.type)))) return;
    if (!goalsOf(goalsState.year).length) goalsState.editing = false;
  } else if (q("[data-gl-add]")) {
    goalsState.adding = true;
    goalsState.editing = false;
  } else if (q("[data-gl-add-cancel]")) {
    goalsState.adding = false;
  } else if (q("[data-gl-add-ok]")) {
    const type = overlay.querySelector("[data-gl-new-type]")?.value;
    const n = Math.max(1, Math.min(9999, Math.round(Number(overlay.querySelector("[data-gl-new-n]")?.value)) || 1));
    if (!type) return;
    // «Всё вместе» – первой строкой, остальные – в порядке добавления.
    const ok = await goalsSave((list) => {
      const next = list.filter((x) => x.type !== type).concat({ type, n });
      return next.sort((a, b) => (a.type === "all" ? -1 : b.type === "all" ? 1 : 0));
    });
    if (!ok) return;
    goalsState.adding = false;
  } else {
    return;
  }
  goalsRender();
}

function goalsEnsureOverlay() {
  let overlay = document.getElementById("goals-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "goals-overlay";
  overlay.className = "recap-overlay goals-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", i18n("Цели"));
  overlay.innerHTML = `<div class="recap-wrap gl-wrap" id="goals-body" tabindex="-1"></div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", goalsOnClick);
  // Enter в поле числа – как «Добавить»/«Готово».
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches?.("input")) return;
    e.preventDefault();
    overlay.querySelector(goalsState.adding ? "[data-gl-add-ok]" : "[data-gl-edit]")?.click();
  });
  // Захватом – раньше обработчика окна отзыва: тот закрывает отзыв, и
  // здесь уже не было бы видно, что он был открыт, – одно нажатие Esc
  // закрывало бы оба окна. Пока открыт отзыв, Esc – его.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || overlay.classList.contains("hidden")) return;
      if (document.querySelector(".review-modal-overlay:not(.hidden)")) return;
      closeGoals();
    },
    { capture: true }
  );
  return overlay;
}

async function openGoals() {
  const thisYear = goalsThisYear();
  const picked = statsState.year === "all" ? thisYear : Number(statsState.year);
  goalsState.year = Number.isFinite(picked) ? picked : thisYear;
  goalsState.open = null;
  goalsState.editing = goalsState.adding = false;
  try {
    goalsState.goals = goalsClean((await currentSiteSettings()).goals);
  } catch {
    goalsState.goals = {};
  }
  const overlay = goalsEnsureOverlay();
  _goalsOpener = document.activeElement;
  goalsRender();
  overlay.classList.remove("hidden");
  overlay.scrollTop = 0;
  document.body.style.overflow = "hidden";
  document.getElementById("goals-body")?.focus();
}

function closeGoals() {
  const overlay = document.getElementById("goals-overlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  _goalsOpener?.focus?.();
  _goalsOpener = null;
}
