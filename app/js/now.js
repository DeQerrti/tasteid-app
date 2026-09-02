// ══════════════════════════════════════════════
//  NOW – вкладка Главная
//  Читает только из reviews.json – без API
//  Зависит от: config.js, api.js, cards.js
// ══════════════════════════════════════════════
const loading = {};

// Раньше здесь стояла проверка cache.now – если "Сейчас" успела
// отрисоваться до того, как подгрузились подписи/цвета, перерисовать
// готовый кэш заново. Кэша больше нет, но гонка та же: эта вкладка
// открыта по умолчанию при старте и могла отрендериться раньше, чем
// сюда пришло событие. Признак "уже отрисована" теперь – что вкладка
// сейчас видна; loadNow() просто перечитает reviews.json (это дёшево)
// и перерисует уже с правильными подписями.
document.addEventListener("site-labels-ready", () => {
  const tab = document.getElementById("tab-now");
  if (tab && !tab.classList.contains("hidden")) loadNow();
});

// ── Сохранение состояния секций ────────────────
const COLLAPSE_KEY = "tasteid_collapsed";
function getCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []); }
  catch { return new Set(); }
}
function saveCollapsed(set) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set]));
}

async function loadNow() {
  if (loading.now) return;
  loading.now = true;
  const box = document.getElementById("tab-now");
  try {
    await fetchReviews();
    const reviews = cache.reviews || [];
    const buckets = activeStatusBuckets().map(b => ({
      key: b.key,
      label: b.label,
      items: reviews.filter(r => r.status === b.key),
    }));
    const completed = reviews.filter(r =>
      r.status === "completed" || (!r.status && (r.preview || r.grade))
    );
    renderNow({ buckets, completed });
  } catch (err) {
    box.innerHTML = `<div class="state-box">
      <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
      ${i18n("Ошибка:")} ${esc(err.message)}
    </div>`;
  } finally {
    loading.now = false;
  }
}

function makeSection(id, title, items, collapsed) {
  const isCollapsed = collapsed.has(id);
  return `
    <section class="group now-section" data-section="${esc(id)}">
      <div class="now-section-header" onclick="toggleSection('${esc(id)}')">
        <h2 class="section-title" style="margin-bottom:0;cursor:pointer;user-select:none">
          ${esc(title)}
          <span class="section-count">${items.length}</span>
        </h2>
      </div>
      <div class="now-section-body${isCollapsed ? " hidden" : ""}">
        <div class="grid-now" style="margin-top:1.5rem">
          ${items.map((r, i) => manualCard(r, i)).join("")}
        </div>
      </div>
    </section>`;
}

function toggleSection(id) {
  const collapsed = getCollapsed();
  const section = document.querySelector(`.now-section[data-section="${id}"]`);
  if (!section) return;
  const body = section.querySelector(".now-section-body");
  if (collapsed.has(id)) {
    collapsed.delete(id);
    body.classList.remove("hidden");
  } else {
    collapsed.add(id);
    body.classList.add("hidden");
  }
  saveCollapsed(collapsed);
}

// «Архив» – группируем по году. Не элемент activeStatusBuckets() (это
// просто все завершённые, а не отдельный ручной статус), поэтому своя
// функция, а не ещё одна запись в buckets.
function makeArchiveSection(completed, collapsed) {
  if (!completed.length || window.SITE_HIDDEN_STATUSES?.has("archive")) return "";

  const sorted = [...completed].sort((a, b) => {
    const da = new Date(a.date_end || a.date_start || a.date || 0);
    const db = new Date(b.date_end || b.date_start || b.date || 0);
    return db - da;
  });
  const byYear = {};
  for (const r of sorted) {
    const raw = r.date_end || r.date_start || r.date;
    const y = raw ? new Date(raw).getFullYear() : "–";
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(r);
  }

  const isCollapsed = collapsed.has("archive");
  let archiveInner = "";
  for (const year of Object.keys(byYear).sort((a, b) => b - a)) {
    archiveInner += `<div class="year-divider">${esc(String(year))}</div>
      <div class="grid-now">
        ${byYear[year].map((r, i) => manualCard(r, i)).join("")}
      </div>`;
  }

  return `
    <section class="group now-section" data-section="archive">
      <div class="now-section-header" onclick="toggleSection('archive')">
        <h2 class="section-title" style="margin-bottom:0;cursor:pointer;user-select:none">
          ${esc(siteLabel("statuses", "archive", i18n("Архив")))}
          <span class="section-count">${completed.length}</span>
        </h2>
      </div>
      <div class="now-section-body${isCollapsed ? " hidden" : ""}">
        ${archiveInner}
      </div>
    </section>`;
}

function renderNow({ buckets, completed }) {
  const box = document.getElementById("tab-now");
  const collapsed = getCollapsed();
  const html = `<style>
    .now-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: .35rem 0;
      cursor: pointer;
    }
    .now-section-header:hover .section-title { color: var(--text-hi); }

    .section-count {
      font-family: 'DM Sans', sans-serif;
      font-size: .65rem;
      font-weight: 400;
      font-style: normal;
      color: var(--text-dim);
      letter-spacing: .05em;
      margin-left: .1rem;
      align-self: flex-end;
      padding-bottom: .1rem;
    }

    .now-section-body.hidden { display: none; }
  </style>`;

  // Секции копятся отдельно от html: тот всегда начинается с блока
  // <style> выше, то есть пустым не бывает никогда. Раньше заглушка
  // «список пуст» висела на `html || …` и поэтому не показывалась –
  // на пустых данных вкладка оставалась просто белым листом.
  let sections = "";

  // Порядок статусов вместе с «Архивом» – настраивается в /settings-edit
  // перетаскиванием (statusOrderState там же): «Архив» раньше был
  // жёстко зашит последним, теперь может стоять где угодно.
  // window.SITE_STATUS_ORDER = null, пока настроек ещё не было.
  const bucketsByKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  const order = window.SITE_STATUS_ORDER || [...buckets.map((b) => b.key), "archive"];
  const seen = new Set();
  for (const key of order) {
    seen.add(key);
    if (window.SITE_HIDDEN_STATUSES?.has(key)) continue;
    if (key === "archive") {
      sections += makeArchiveSection(completed, collapsed);
    } else if (bucketsByKey[key]?.items.length) {
      sections += makeSection(key, bucketsByKey[key].label, bucketsByKey[key].items, collapsed);
    }
  }
  // Статус, заведённый уже после того, как порядок сохранился (или
  // сама «Архив», если её вдруг нет в сохранённом порядке) – просто
  // дописывается в конец, а не пропадает молча.
  for (const bucket of buckets) {
    if (seen.has(bucket.key) || window.SITE_HIDDEN_STATUSES?.has(bucket.key)) continue;
    if (bucket.items.length) sections += makeSection(bucket.key, bucket.label, bucket.items, collapsed);
  }
  if (!seen.has("archive")) sections += makeArchiveSection(completed, collapsed);

  box.innerHTML = html +
    (sections || `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`);
}
