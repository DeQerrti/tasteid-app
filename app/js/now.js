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

// Снимок того, что уже нарисовано – см. её же комментарий выше про
// "кэша больше нет": reviews.json перечитывается заново при КАЖДОМ
// заходе на вкладку, и на компьютере это правда дёшево (локальный
// fetch), а на телефоне идёт через нативный мост Capacitor Filesystem
// – заметно медленнее. Без этой проверки каждый заход пересобирал всю
// разметку заново, даже когда данные не изменились ни на йоту: все
// <img> оказывались новыми узлами, и карточки заметно мигали при
// каждом переключении вкладки. Перерисовываем только когда снимок
// (данные + подписи статусов) и правда стал другим.
let nowLastSnapshot = null;

// Текущая выбранная вкладка-переключатель (ключ статуса или "archive") –
// см. её же комментарий у nowModeToggleHtml() ниже. Сбрасывается на
// первую по порядку при каждой загрузке страницы, не запоминается
// между сеансами – так же, как режим самого тир-листа (tlState.mode).
const nowState = { buckets: [], completed: [], mode: null };

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
    const snapshot = JSON.stringify({ buckets, completed });
    if (snapshot === nowLastSnapshot) return;
    nowLastSnapshot = snapshot;
    renderNow({ buckets, completed });
  } catch (err) {
    nowLastSnapshot = null; // при следующей успешной загрузке перерисовать точно
    box.innerHTML = `<div class="state-box">
      <div style="font-size:2rem;margin-bottom:.75rem">⚠️</div>
      ${i18n("Ошибка:")} ${esc(err.message)}
    </div>`;
  } finally {
    loading.now = false;
  }
}

// Порядок статусов вместе с «Архивом» – настраивается в /settings-edit
// перетаскиванием (statusOrderState там же): «Архив» раньше был жёстко
// зашит последним, теперь может стоять где угодно. Скрытые статусы
// (SITE_HIDDEN_STATUSES) сюда не попадают вовсе – ни отдельной секцией,
// как раньше, ни вкладкой переключателя.
function nowOrderedKeys() {
  const known = [...nowState.buckets.map((b) => b.key), "archive"].filter(
    (key) => !window.SITE_HIDDEN_STATUSES?.has(key)
  );
  const saved = window.SITE_STATUS_ORDER || [];
  const ordered = saved.filter((k) => known.includes(k));
  const missing = known.filter((k) => !ordered.includes(k));
  return [...ordered, ...missing];
}

// Если текущая вкладка вдруг пропала (статус скрыли/удалили, пока была
// выбрана) или ещё не выбрана вовсе – берём первую по порядку.
function nowEnsureMode() {
  const keys = nowOrderedKeys();
  if (!keys.includes(nowState.mode)) nowState.mode = keys[0] ?? null;
}

// Переключатель вкладок сверху – тот же вид (.tl-mode-toggle/.tl-mode-btn
// в index.html), что уже есть у режимов тир-листа: расчёт был на то,
// что бесконечно листать вниз через все статусы разом медленнее, чем
// сразу переключиться на нужный, – то же самое время от времени
// делает Статистика для годов и Тир-лист для своих коллекций.
function nowModeToggleHtml() {
  const bucketsByKey = Object.fromEntries(nowState.buckets.map((b) => [b.key, b]));
  const btns = nowOrderedKeys()
    .map((key) => {
      if (key === "archive") {
        return `<button class="tl-mode-btn${nowState.mode === "archive" ? " active" : ""}" data-mode="archive">${esc(siteLabel("statuses", "archive", i18n("Архив")))} <span class="section-count">${nowState.completed.length}</span></button>`;
      }
      const b = bucketsByKey[key];
      if (!b) return "";
      return `<button class="tl-mode-btn${nowState.mode === key ? " active" : ""}" data-mode="${esc(key)}">${esc(b.label)} <span class="section-count">${b.items.length}</span></button>`;
    })
    .join("");
  return `<div class="tl-mode-toggle">${btns}</div>`;
}

// Быстрые повторные клики (перебираешь разделы один за другим) раньше
// каждый запускали renderNowBody() немедленно и синхронно – это заново
// строит innerHTML всех карточек текущего раздела и заводит для них
// свежие <img>. Клик отрабатывает быстрее, чем браузер успевает
// отрисовать предыдущий рендер, – несколько таких перестроений подряд
// копятся в одной и той же синхронной очереди JS и на разделах с
// длинным списком ощущаются как настоящее зависание: список не отвечает
// на клики, пока не разберёт всю накопившуюся очередь (само окно при
// этом не блокируется – оно в другом процессе). requestAnimationFrame
// схлопывает несколько кликов подряд в один рендер – на экране всё
// равно останется только последний выбранный раздел.
let nowRenderRaf = null;
function bindNowModeToggle() {
  document.querySelectorAll("#tab-now .tl-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.mode === nowState.mode) return;
      nowState.mode = btn.dataset.mode;
      if (nowRenderRaf) cancelAnimationFrame(nowRenderRaf);
      nowRenderRaf = requestAnimationFrame(() => {
        nowRenderRaf = null;
        renderNowBody();
      });
    });
  });
}

// Год, к которому подскочить, – см. её же комментарий у
// scrollToArchiveYear() ниже. Список лет для выпадашки – по самим
// записям архива, не выдуманный диапазон: если человек смотрел кино
// только в 2019–2024, промежуточные пустые года туда не попадают.
function makeArchiveYearJumpHtml(completed) {
  const years = [
    ...new Set(
      completed
        .map((r) => {
          const raw = r.date_end || r.date_start || r.date;
          return raw ? new Date(raw).getFullYear() : null;
        })
        .filter((y) => y !== null)
    ),
  ].sort((a, b) => b - a);
  if (years.length < 2) return ""; // один год – прыгать некуда
  return `<div class="now-archive-jump">
    <select onchange="scrollToArchiveYear(this.value)">
      <option value="" data-i18n>Перейти к году…</option>
      ${years.map((y) => `<option value="${y}">${y}</option>`).join("")}
    </select>
  </div>`;
}

// Прокручивает (не фильтрует – весь архив как был, просто быстрее
// добраться до места) к первой карточке нужного года. Год не фильтр:
// уводить одним выбором в СПИСКЕ год из выпадашки и обратно на "все
// года" – лишний шаг там, где достаточно долистать глазами то, что и
// так на экране, просто начиная с нужного места.
function scrollToArchiveYear(year) {
  if (!year) return;
  const el = document.querySelector(`#tab-now .year-divider[data-year="${CSS.escape(year)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// «Архив» – группируем по году. Не элемент activeStatusBuckets() (это
// просто все завершённые, а не отдельный ручной статус), поэтому своя
// функция, а не ещё одна запись в buckets.
function archiveBodyHtml(completed) {
  if (!completed.length) {
    return `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
  }

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

  let inner = "";
  for (const year of Object.keys(byYear).sort((a, b) => b - a)) {
    inner += `<div class="year-divider" data-year="${esc(String(year))}">${esc(String(year))}</div>
      <div class="grid-now">
        ${byYear[year].map((r, i) => manualCard(r, i)).join("")}
      </div>`;
  }

  return makeArchiveYearJumpHtml(completed) + inner;
}

function nowModeBodyHtml() {
  if (nowState.mode === "archive") return archiveBodyHtml(nowState.completed);
  const bucketsByKey = Object.fromEntries(nowState.buckets.map((b) => [b.key, b]));
  const b = bucketsByKey[nowState.mode];
  if (!b || !b.items.length) {
    return `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
  }
  return `<div class="grid-now">${b.items.map((r, i) => manualCard(r, i)).join("")}</div>`;
}

function renderNowBody() {
  const body = document.getElementById("now-mode-body");
  if (!body) return;
  document.querySelectorAll("#tab-now .tl-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === nowState.mode);
  });
  body.innerHTML = nowModeBodyHtml();
}

function renderNow({ buckets, completed }) {
  const box = document.getElementById("tab-now");
  nowState.buckets = buckets;
  nowState.completed = completed;
  nowEnsureMode();

  if (!nowState.mode) {
    box.innerHTML = `<div class="state-box">${esc(siteLabel("empty", "list", i18n("Список пуст")))}</div>`;
    return;
  }

  box.innerHTML = `${nowModeToggleHtml()}<div id="now-mode-body">${nowModeBodyHtml()}</div>`;
  bindNowModeToggle();
}
