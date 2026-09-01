// ══════════════════════════════════════════════
//  PASSPORTS – чужой паспорт: просмотр и сравнение
//  Зависит от: utils.js, config.js, api.js, cards.js
//
//  Живёт в настройках, а не в главных вкладках: заглядывают сюда
//  редко, а место в шапке дорогое.
//
//  Два режима. «Просмотр» – чужой паспорт сам по себе, как его видит
//  гость: полки с оценками, свои цвета, свои названия. «Сравнение» –
//  два паспорта рядом, с упором на расхождения: совпадения
//  предсказуемы, спор интереснее.
//
//  Чужой паспорт приходит файлом: человек выгружает свой отсюда же и
//  передаёт как хочет. Сервера для этого не нужно, всё считается в
//  браузере. Когда появится обмен по коду, поменяется только способ
//  доставки файла – формат и вся математика ниже останутся теми же.
// ══════════════════════════════════════════════

const PASSPORT_FORMAT = "tasteid-passport";
const PASSPORT_VERSION = 1;
const GUEST_KEY = "tasteid_guest_passport";
const MODE_KEY = "tasteid_passport_mode";

// Насколько далеко должны разойтись оценки, чтобы считать это спором.
// Меряется в долях шкалы (0 – та же полка, 1 – с лучшей на худшую),
// поэтому порог не зависит от того, семь у человека полок или сто.
const DISAGREE_THRESHOLD = 0.2;

let guestPassport = null;
let passportMode = "view"; // view | compare
let passportsBusy = false;

// Чужой тайтл можно забрать себе – в свой список, не поверх чужого
// отзыва: у гостя нет ни текста, ни тегов, ни ссылки, только само
// название/тип/год, так что это всегда новый, пустой свой отзыв,
// который останется дозаполнить на add.html. Индекс нужен потому,
// что в названии тайтла может быть что угодно, включая кавычки, –
// пихать его прямо в onclick небезопасно.
let ppAddQueue = [];

function registerAddItem(item) {
  ppAddQueue.push(item);
  return ppAddQueue.length - 1;
}

function addFromPassport(idx) {
  const item = ppAddQueue[idx];
  if (!item) return;
  const params = new URLSearchParams({
    fromPassport: "1",
    title: item.title || "",
    type: item.type || "",
    year: item.year || "",
  });
  // Обложка едет дальше, только если это настоящая внешняя ссылка –
  // тогда она открывается из интернета и работает у кого угодно. Если
  // у автора паспорта обложка загружена локальным файлом (без внешней
  // ссылки), buildMyPassport() подставляет вместо неё путь на его
  // диске – у нас он не откроется никогда, тащить его смысла нет.
  if (/^https?:\/\//.test(item.cover || "")) params.set("cover", item.cover);
  openAddFromPassportModal(`/add.html?${params.toString()}`);
}

// ── Модалка «добавить себе» ─────────────────────
// Раньше это была обычная навигация (location.href на add.html) – она
// уводила с чужого паспорта на пустую страницу редактора, и вернуться
// в то же место (та же вкладка настроек, тот же открытый паспорт)
// можно было только кнопкой «назад» в браузере, если она вообще
// сработала бы так, как ожидает человек. Модалка с add.html внутри
// iframe решает это без переписывания самого редактора – та же
// страница, тот же код, просто в рамке поверх текущей. Сохранился –
// add.html сам закроет модалку (см. её initPage()/saveReview(): она
// проверяет window.parent и зовёт closeAddFromPassportModal()) – и
// человек остаётся там же, где был, в настройках, на чужом паспорте.
function openAddFromPassportModal(url) {
  const overlay = document.getElementById("pp-add-modal-overlay");
  const frame = document.getElementById("pp-add-modal-frame");
  if (!overlay || !frame) { location.href = url; return; }
  frame.src = url;
  overlay.classList.remove("hidden");
  document.addEventListener("keydown", onAddFromPassportModalKey);
}

// Обычный ✕/Escape может закрыть модалку поверх недописанного отзыва –
// та же проверка, что несохранённые правки где угодно ещё в приложении
// (см. add.html, addDirty). Само add.html после успешного сохранения
// сбрасывает свой addDirty перед вызовом этой функции, так что в этом
// случае подтверждение не всплывает.
async function closeAddFromPassportModal() {
  const overlay = document.getElementById("pp-add-modal-overlay");
  const frame = document.getElementById("pp-add-modal-frame");
  if (!overlay) return;
  const dirty = frame?.contentWindow?.addDirty;
  if (dirty && !(await confirmDialog(
    i18n("Отзыв не сохранён – закрыть и потерять правки?"),
    i18n("Закрыть без сохранения"),
    i18n("Остаться")
  ))) return;
  overlay.classList.add("hidden");
  if (frame) frame.src = "about:blank";
  document.removeEventListener("keydown", onAddFromPassportModalKey);
}

function onAddFromPassportModalKey(e) {
  if (e.key === "Escape") closeAddFromPassportModal();
}

// ── Формат паспорта ────────────────────────────
// Только то, что нужно для показа и сравнения: тексты отзывов сюда не
// едут – так файл легче, а решение «что показывать чужим» остаётся за
// автором паспорта.

function buildMyPassport() {
  const scale = window.SITE_GRADE_SCALE || {
    type: "categorical",
    shelves: GRADE_ORDER.map((key) => ({
      key,
      name: GRADES[key]?.name || key,
      color: GRADES[key]?.color,
    })),
  };

  const items = (cache.reviews || [])
    .filter((r) => gradeToShelf(r.grade) || r.favorite)
    .map((r) => ({
      title: r.title,
      type: r.type || null,
      year: r.year || null,
      cover: r.cover || r.cover_backup || null,
      grade: gradeToShelf(r.grade),
      favorite: r.favorite === true,
      ids: r.ids || undefined,
    }));

  return {
    format: PASSPORT_FORMAT,
    version: PASSPORT_VERSION,
    exportedAt: new Date().toISOString(),
    gradeScale: { type: scale.type, shelves: scale.shelves },
    items,
  };
}

function exportMyPassport() {
  const passport = buildMyPassport();
  const blob = new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `passport-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Файл пришёл от другого человека – значит доверять его содержимому
// нельзя. Проверяем форму до того, как что-то из него показывать.
function parsePassport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(i18n("Это не похоже на файл паспорта – внутри не JSON."));
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(i18n("Внутри файла должен быть объект паспорта."));
  }
  if (data.format !== PASSPORT_FORMAT) {
    throw new Error(i18n("Файл не от TasteID – не тот формат."));
  }
  if (!Array.isArray(data.items)) {
    throw new Error(i18n("В паспорте нет списка тайтлов."));
  }
  const shelves = data.gradeScale?.shelves;
  if (!Array.isArray(shelves) || !shelves.length) {
    throw new Error(i18n("В паспорте нет шкалы оценок – показывать будет нечего."));
  }
  return {
    ...data,
    items: data.items.filter((i) => i && typeof i.title === "string" && i.title.trim()),
  };
}

// ── Сопоставление тайтлов ──────────────────────
// Сначала по номерам в чужих базах (js/external-ids.js) – это
// единственный надёжный способ: названия у одного и того же тайтла
// пишут по-разному. Название остаётся запасным вариантом для записей,
// у которых номера ещё нет.

const ID_MATCH_ORDER = ["mal", "anilist", "tmdb", "igdb", "hardcover_edition", "goodreads", "isbn13"];

function matchKeys(item) {
  const keys = [];
  for (const base of ID_MATCH_ORDER) {
    const value = item.ids?.[base];
    if (value) keys.push(`${base}:${value}`);
  }
  keys.push(`t:${normTitle(item.title)}|${item.type || ""}`);
  return keys;
}

// Ключ, под которым оказалось больше одной записи, выбрасывается
// совсем. Живой пример: три «Jujutsu Kaisen» – манга, второй сезон и
// третий. Номера у них разные, и по номерам всё сходится правильно,
// а вот по названию с типом второй и третий сезоны неразличимы. Лучше
// не сопоставить вовсе, чем показать выдуманный спор с чужой оценкой
// не от того сезона.
function indexByKeys(items) {
  const index = new Map();
  const ambiguous = new Set();
  for (const item of items) {
    for (const key of matchKeys(item)) {
      if (index.has(key) && index.get(key) !== item) ambiguous.add(key);
      else index.set(key, item);
    }
  }
  for (const key of ambiguous) index.delete(key);
  return index;
}

// ── Оценки в общих единицах ────────────────────
// У двух людей шкалы могут быть разные: у одного семь именованных
// полок, у другого десятибалльная. Сравнивать ключи бессмысленно,
// поэтому каждая оценка переводится в положение на своей шкале:
// 0 – лучшее, 1 – худшее. Дальше сравнимо что угодно с чем угодно.

// Цвет из чужого паспорта подставляется в style="--chip:…", а файл
// паспорта приходит от другого человека – то есть это единственное
// место, где в разметку попадает не своё. esc() спасает от выхода из
// атрибута, но не от точки с запятой: «red;background:url(…)» дописал
// бы соседнее правило и увёл бы запрос наружу. Пропускаем только то,
// что и правда цвет.
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-z]{3,20})$/i;
function safeColor(value, fallback = "var(--text-dim)") {
  const v = String(value ?? "").trim();
  return SAFE_COLOR.test(v) ? v : fallback;
}

function makeGradeInfo(scale) {
  const shelves = scale.shelves;
  const byKey = new Map(shelves.map((s, i) => [s.key, { ...s, index: i }]));
  const last = Math.max(shelves.length - 1, 1);
  return {
    shelves,
    label: (key) => byKey.get(key)?.name || key || "–",
    color: (key) => safeColor(byKey.get(key)?.color),
    position: (key) => {
      const shelf = byKey.get(key);
      return shelf ? shelf.index / last : null;
    },
  };
}

function myGradeInfo() {
  return makeGradeInfo({
    shelves: GRADE_ORDER.map((key) => ({
      key,
      name: GRADES[key]?.name || key,
      color: GRADES[key]?.color,
    })),
  });
}

function myGradedItems() {
  return (cache.reviews || [])
    .filter((r) => gradeToShelf(r.grade))
    .map((r) => ({
      title: r.title,
      type: r.type || null,
      year: r.year || null,
      cover: r.cover || null,
      coverBackup: r.cover_backup || null,
      grade: gradeToShelf(r.grade),
      ids: r.ids,
    }));
}

// ── Загрузка панели ────────────────────────────

async function loadPassports() {
  if (passportsBusy) return;
  passportsBusy = true;
  const box = document.getElementById("passportsPanel");
  if (!box) { passportsBusy = false; return; }
  try {
    await fetchReviews();
    passportMode = localStorage.getItem(MODE_KEY) === "compare" ? "compare" : "view";
    if (!guestPassport) {
      const saved = localStorage.getItem(GUEST_KEY);
      if (saved) {
        try {
          guestPassport = parsePassport(saved);
        } catch {
          // Сохранённый паспорт испортился или устарел форматом –
          // молча забываем, человек просто загрузит файл заново.
          localStorage.removeItem(GUEST_KEY);
        }
      }
    }
    renderPassports();
  } catch (err) {
    box.innerHTML = `<p class="panel-intro">Ошибка: ${esc(err.message)}</p>`;
  } finally {
    passportsBusy = false;
  }
}

function renderPassports() {
  const box = document.getElementById("passportsPanel");
  if (!box) return;
  box.innerHTML = passportStyles() + passportIntroHtml() +
    (guestPassport
      ? (passportMode === "compare" ? compareResultHtml() : guestViewHtml())
      : "");
  bindPassports();
}

function passportIntroHtml() {
  const loaded = guestPassport
    ? `<div class="pp-loaded">
         ${i18n("Загружен чужой паспорт: {count}&nbsp;{unit}", {
           count: guestPassport.items.length,
           unit: plural(guestPassport.items.length, unitForms()),
         })}${
           guestPassport.exportedAt
             ? ` · ${i18n("выгружен {date}", { date: esc(new Date(guestPassport.exportedAt).toLocaleDateString(dateLocale())) })}`
             : ""
         }
         <button class="pp-link" id="pp-forget" type="button">${i18n("забыть")}</button>
       </div>`
    : "";

  const modes = guestPassport
    ? `<div class="pp-modes">
         <button class="pp-mode${passportMode === "view" ? " active" : ""}" data-mode="view" type="button">${i18n("Просмотр")}</button>
         <button class="pp-mode${passportMode === "compare" ? " active" : ""}" data-mode="compare" type="button">${i18n("Сравнение со своим")}</button>
       </div>`
    : "";

  return `
    <p class="panel-intro">
      ${i18n("Чужой паспорт – файл: пусть человек выгрузит свой такой же кнопкой ниже и пришлёт. Дальше его можно просто посмотреть или сравнить со своим. Всё считается прямо в браузере, никуда не отправляется.")}
    </p>
    <p class="panel-intro">
      ${i18n("Это не резервная копия: файл легче, чем ваши настоящие данные (без текста отзывов, без избранного, без тир-листов), и загрузка сюда чужого паспорта ничего своего не трогает и не заменяет.")}
    </p>
    <div class="pp-actions">
      <label class="btn btn-ghost file-btn">
        <input type="file" id="pp-file" accept="application/json,.json">
        <span>${i18n("Загрузить чужой паспорт")}</span>
      </label>
      <button class="btn btn-ghost" id="pp-export" type="button">${i18n("Выгрузить свой")}</button>
    </div>
    <div class="status-msg" id="pp-status"></div>
    ${loaded}
    ${modes}`;
}

// ── Режим «Просмотр» ───────────────────────────
// Чужой паспорт сам по себе: полки его шкалы, его названия и цвета.
// Ровно то, что человек увидел бы, зайдя к нему на сайт.

function guestViewHtml() {
  ppAddQueue = [];
  const info = makeGradeInfo(guestPassport.gradeScale);
  const items = guestPassport.items;
  const graded = items.filter((i) => i.grade);

  const byType = {};
  for (const item of items) {
    const label = TYPE_LABELS[item.type] || item.type || "–";
    byType[label] = (byType[label] || 0) + 1;
  }
  const topTypes = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, n]) => `${label} ${n}`)
    .join(" · ");

  const summary = `<div class="pp-summary">
    ${ppStat(items.length, i18n("тайтлов"))}
    ${ppStat(graded.length, i18n("с оценкой"))}
    ${ppStat(items.filter((i) => i.favorite).length, i18n("в любимом"))}
    ${ppStat(info.shelves.length, i18n("полок в шкале"))}
  </div>
  ${topTypes ? `<p class="pp-types">${esc(topTypes)}</p>` : ""}`;

  // По полкам сверху вниз – получается его тир-лист.
  const shelves = info.shelves.map((shelf) => {
    const inShelf = graded.filter((i) => i.grade === shelf.key);
    if (!inShelf.length) return "";
    return `<section class="pp-shelf">
      <div class="pp-shelf-head">
        <span class="pp-shelf-dot" style="--chip:${esc(safeColor(shelf.color))}"></span>
        <h3 class="pp-shelf-name">${esc(shelf.name)}</h3>
        <span class="pp-shelf-count">${inShelf.length}</span>
      </div>
      <div class="pp-grid">
        ${inShelf.map((item) => `
          <div class="pp-card" title="${esc(item.title)}">
            ${ppPoster(item)}
            <button class="pp-add-btn" title="${esc(i18n("Добавить себе"))}"
              onclick="addFromPassport(${registerAddItem(item)})">+</button>
            <div class="pp-card-title">${esc(item.title)}</div>
            ${ppMeta(item)}
          </div>`).join("")}
      </div>
    </section>`;
  }).join("");

  const noGrade = items.filter((i) => !i.grade);

  return `<div class="pp-result">
    ${summary}
    ${shelves || `<p class="panel-intro">В этом паспорте нет ни одной оценки.</p>`}
    ${noGrade.length
      ? `<p class="pp-types">Ещё ${noGrade.length} без оценки – только в любимом.</p>`
      : ""}
  </div>`;
}

function ppStat(value, label) {
  return `<div class="pp-stat">
    <div class="pp-stat-value">${value}</div>
    <div class="pp-stat-label">${esc(label)}</div>
  </div>`;
}

function ppPoster(item) {
  const cover = item.cover || item.coverBackup || PH_TALL;
  return `<img class="pp-poster" src="${esc(cover)}" alt="" loading="lazy"
    ${imgFallbackAttrs(item.cover, item.coverBackup, PH_TALL)}>`;
}

function ppMeta(item) {
  const parts = [];
  if (item.type) parts.push(TYPE_LABELS[item.type] || item.type);
  if (item.year) parts.push(String(item.year));
  return parts.length ? `<div class="pp-meta">${esc(parts.join(" · "))}</div>` : "";
}

function ppChip(info, grade) {
  return `<span class="pp-chip" style="--chip:${esc(info.color(grade))}">${esc(info.label(grade))}</span>`;
}

// ── Режим «Сравнение» ──────────────────────────

function compareResultHtml() {
  ppAddQueue = [];
  const mine = myGradeInfo();
  const theirs = makeGradeInfo(guestPassport.gradeScale);

  const myItems = myGradedItems();
  const theirItems = guestPassport.items.filter((i) => i.grade);
  const theirIndex = indexByKeys(theirItems);

  // Каждый чужой тайтл засчитывается не больше одного раза: без этого
  // два моих отзыва, севших на одну чужую запись, раздували бы «смотрели
  // оба» до числа большего, чем весь чужой паспорт.
  const claimed = new Set();
  const both = [];
  const onlyMine = [];
  for (const item of myItems) {
    const match = matchKeys(item)
      .map((k) => theirIndex.get(k))
      .find((m) => m && !claimed.has(m));
    if (match) {
      claimed.add(match);
      both.push({ mine: item, theirs: match });
    } else {
      onlyMine.push(item);
    }
  }
  const onlyTheirs = theirItems.filter((item) => !claimed.has(item));

  // Расхождение считаем в долях шкалы, чтобы разные шкалы были сравнимы.
  for (const pair of both) {
    const a = mine.position(pair.mine.grade);
    const b = theirs.position(pair.theirs.grade);
    pair.gap = a === null || b === null ? null : Math.abs(a - b);
    pair.iRatedHigher = a !== null && b !== null && a < b;
  }

  const rated = both.filter((p) => p.gap !== null);
  const argued = rated.filter((p) => p.gap > DISAGREE_THRESHOLD).sort((a, b) => b.gap - a.gap);
  const agreed = rated.filter((p) => p.gap <= DISAGREE_THRESHOLD).sort((a, b) => a.gap - b.gap);
  const avgGap = rated.length ? rated.reduce((s, p) => s + p.gap, 0) / rated.length : null;
  const accord = avgGap === null ? null : Math.round((1 - avgGap) * 100);

  return `<div class="pp-result">
    <div class="pp-summary">
      ${ppStat(both.length, i18n("смотрели оба"))}
      ${ppStat(accord === null ? "–" : accord + "%", i18n("совпадение вкусов"))}
      ${ppStat(argued.length, i18n("заметных споров"))}
      ${ppStat(onlyTheirs.length, i18n("можно забрать себе"))}
    </div>
    ${comparePairsHtml(i18n("Где разошлись"), argued, mine, theirs, i18n("Полное согласие – спорить не о чем."))}
    ${comparePairsHtml(i18n("Где сошлись"), agreed, mine, theirs, i18n("Общих оценок не нашлось."))}
    ${compareOneSidedHtml(i18n("Стоит забрать себе"), onlyTheirs, theirs, true)}
    ${compareOneSidedHtml(i18n("Только у вас"), onlyMine, mine)}
  </div>`;
}

function comparePairsHtml(title, pairs, mine, theirs, emptyText) {
  const rows = pairs.map((pair) => `
    <div class="pp-row${pair.gap > DISAGREE_THRESHOLD ? " pp-row-argued" : ""}">
      ${ppPoster(pair.mine)}
      <div class="pp-body">
        <div class="pp-title">${esc(pair.mine.title)}</div>
        ${ppMeta(pair.mine)}
      </div>
      <div class="pp-grades">
        <div class="pp-side"><div class="pp-who">${i18n("вы")}</div>${ppChip(mine, pair.mine.grade)}</div>
        <div class="pp-vs">${pair.gap > DISAGREE_THRESHOLD ? (pair.iRatedHigher ? "&gt;" : "&lt;") : "="}</div>
        <div class="pp-side"><div class="pp-who">${i18n("он")}</div>${ppChip(theirs, pair.theirs.grade)}</div>
      </div>
    </div>`).join("");

  return ppSection(title, rows, emptyText);
}

function compareOneSidedHtml(title, items, info, showAdd) {
  // Сначала то, что оценено выше: если это список «забрать себе»,
  // сверху должно оказаться лучшее, а не случайное.
  const sorted = [...items].sort((a, b) => {
    const pa = info.position(a.grade);
    const pb = info.position(b.grade);
    return (pa === null ? 2 : pa) - (pb === null ? 2 : pb);
  });

  const rows = sorted.map((item) => `
    <div class="pp-row">
      ${ppPoster(item)}
      <div class="pp-body">
        <div class="pp-title">${esc(item.title)}</div>
        ${ppMeta(item)}
      </div>
      <div class="pp-grades">${item.grade ? ppChip(info, item.grade) : ""}</div>
      ${showAdd
        ? `<button class="btn btn-ghost pp-add-btn-row" onclick="addFromPassport(${registerAddItem(item)})">${i18n("Добавить себе")}</button>`
        : ""}
    </div>`).join("");

  return ppSection(title, rows, i18n("Пусто"));
}

function ppSection(title, rows, emptyText) {
  return `<section class="pp-section">
    <h2 class="section-h">${esc(title)}</h2>
    ${rows || `<p class="pp-empty">${esc(emptyText)}</p>`}
  </section>`;
}

// ── Обработчики ────────────────────────────────

function bindPassports() {
  document.getElementById("pp-export")?.addEventListener("click", exportMyPassport);

  document.getElementById("pp-forget")?.addEventListener("click", () => {
    guestPassport = null;
    localStorage.removeItem(GUEST_KEY);
    renderPassports();
  });

  document.querySelectorAll(".pp-mode").forEach((btn) => {
    btn.addEventListener("click", () => {
      passportMode = btn.dataset.mode;
      localStorage.setItem(MODE_KEY, passportMode);
      renderPassports();
    });
  });

  document.getElementById("pp-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = document.getElementById("pp-status");
    status.className = "status-msg";
    status.textContent = i18n("Читаем файл…");
    try {
      const text = await file.text();
      guestPassport = parsePassport(text);
      try {
        localStorage.setItem(GUEST_KEY, text);
      } catch {
        // Паспорт не поместился в хранилище браузера – не беда,
        // показать всё равно покажем, просто до перезагрузки.
      }
      renderPassports();
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    }
  });
}

function passportStyles() {
  return `<style>
    .pp-actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin-bottom: .5rem; }
    .pp-loaded {
      font-family: 'DM Sans', sans-serif;
      font-size: .76rem;
      color: var(--text-dim);
      margin: .9rem 0 0;
    }
    .pp-link {
      background: none; border: none; padding: 0 0 0 .5rem;
      color: var(--red-hi); cursor: pointer; font: inherit;
      text-decoration: underline; text-underline-offset: .2em;
    }

    .pp-modes { display: flex; gap: .4rem; margin: 1.1rem 0 0; flex-wrap: wrap; }
    .pp-mode {
      font-family: 'DM Sans', sans-serif;
      font-size: .66rem;
      letter-spacing: .09em;
      text-transform: uppercase;
      color: var(--text-dim);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 2px;
      padding: .45rem 1rem;
      cursor: pointer;
      transition: color .2s, border-color .2s, background .2s;
    }
    .pp-mode:hover { color: var(--text); }
    .pp-mode.active { color: var(--text-hi); border-color: var(--red); background: var(--surface2); }

    .pp-result { margin-top: 2rem; }

    .pp-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 1rem;
    }
    .pp-stat { background: var(--surface); padding: .9rem .8rem; text-align: center; }
    .pp-stat-value {
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-size: 1.5rem;
      color: var(--text-hi); line-height: 1;
    }
    .pp-stat-label {
      font-family: 'DM Sans', sans-serif;
      font-size: .58rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim); margin-top: .4rem;
    }
    .pp-types {
      font-family: 'DM Sans', sans-serif;
      font-size: .72rem; color: var(--text-dim);
      margin: 0 0 2rem;
    }

    .pp-section { margin-top: 2.5rem; }
    .pp-empty {
      font-family: 'DM Sans', sans-serif;
      font-size: .8rem; color: var(--text-dim);
      padding: .9rem; border: 1px dashed var(--border); border-radius: 2px;
    }

    /* ── Просмотр: полки чужой шкалы ── */
    .pp-shelf { margin-bottom: 2rem; }
    .pp-shelf-head { display: flex; align-items: center; gap: .55rem; margin-bottom: .8rem; }
    .pp-shelf-dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--chip); flex-shrink: 0;
    }
    .pp-shelf-name {
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-style: italic; font-size: 1.05rem;
      color: var(--text-hi); margin: 0;
    }
    .pp-shelf-count {
      font-family: 'DM Sans', sans-serif;
      font-size: .62rem; color: var(--text-dim);
    }
    .pp-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      gap: .6rem;
    }
    .pp-card { min-width: 0; position: relative; }
    .pp-add-btn {
      position: absolute; top: .3rem; right: .3rem;
      width: 22px; height: 22px; line-height: 20px; text-align: center;
      border-radius: 50%; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-hi);
      font-size: 1rem; cursor: pointer; opacity: .85; transition: opacity .15s;
    }
    .pp-add-btn:hover { opacity: 1; }
    .pp-card-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: .8rem; font-weight: 600; color: var(--text-hi);
      line-height: 1.25; margin-top: .3rem;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .pp-poster {
      width: 100%; aspect-ratio: 2/3; object-fit: cover;
      border-radius: 2px; background: var(--surface2); display: block;
    }

    /* ── Сравнение: строки ── */
    .pp-row {
      display: flex; align-items: center; gap: .85rem;
      padding: .55rem .75rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 2px;
      margin-bottom: .45rem;
    }
    .pp-row-argued { border-left: 3px solid var(--red); }
    .pp-row .pp-poster { width: 36px; flex-shrink: 0; }
    .pp-body { flex: 1; min-width: 0; }
    .pp-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: .98rem; font-weight: 600; color: var(--text-hi); line-height: 1.3;
    }
    .pp-meta {
      font-family: 'DM Sans', sans-serif;
      font-size: .6rem; letter-spacing: .06em; text-transform: uppercase;
      color: var(--text-dim); margin-top: .2rem;
    }
    .pp-grades { display: flex; align-items: center; gap: .65rem; flex-shrink: 0; }
    .pp-add-btn-row { flex-shrink: 0; white-space: nowrap; }
    .pp-side { text-align: center; }
    .pp-who {
      font-family: 'DM Sans', sans-serif;
      font-size: .54rem; letter-spacing: .12em; text-transform: uppercase;
      color: var(--text-dim); margin-bottom: .22rem;
    }
    .pp-chip {
      display: inline-block;
      font-family: 'DM Sans', sans-serif;
      font-size: .62rem; letter-spacing: .04em;
      padding: .2rem .55rem; border-radius: 2px; white-space: nowrap;
      color: var(--chip); border: 1px solid var(--chip);
      background: color-mix(in srgb, var(--chip) 12%, transparent);
    }
    .pp-vs {
      font-family: 'Playfair Display', serif;
      font-size: .95rem; color: var(--text-dim); flex-shrink: 0;
    }

    @media (max-width: 620px) {
      .pp-row { flex-wrap: wrap; }
      .pp-body { flex: 1 1 60%; }
      .pp-grades { width: 100%; justify-content: flex-start; padding-left: 3.6rem; }
      .pp-add-btn-row { margin-left: 3.6rem; margin-top: .3rem; }
    }
  </style>`;
}
