// ══════════════════════════════════════════════
//  IMPORT — перенос списка из чужих сервисов
//  Зависит от: utils.js, config.js, api.js, import-formats.js
//
//  Рассчитано на человека, который переезжает со своим списком в
//  несколько сотен записей. Поэтому импорт не «кнопка вслепую», а три
//  шага: загрузил файл — увидел, что нашлось, и сам решил, как его
//  оценки и статусы ложатся в твои — подтвердил. Сюрпризов быть не
//  должно: чужая выгрузка попадает в паспорт только после явного да.
//
//  Разбор форматов живёт отдельно, в js/import-formats.js: сервисов
//  много, у каждого свои причуды, и держать их вперемешку с экраном
//  было бы больно. Здесь — только то, что человек видит и решает.
// ══════════════════════════════════════════════

const IMPORT_ANILIST_ENDPOINT = "https://graphql.anilist.co";
const IMPORT_BATCH = 50; // AniList отдаёт до 50 записей за страницу

const IMPORT_TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const IMPORT_TMDB_IMAGES = "https://image.tmdb.org/t/p/w500";
const IMPORT_TMDB_BATCH = 5; // у TMDB лимит по запросам в секунду, а не по пачке

// Ключ TMDB лежит в localStorage браузера и больше нигде.
//
// Соблазн положить его в site-settings.json велик — он бы синхронизировался
// между устройствами сам. Но репозиторий сайта открытый, и всё, что в нём
// сохраняется, немедленно становится публичным: ключ утёк бы в первый же
// коммит и остался бы в истории навсегда. Поэтому он живёт только здесь,
// ценой того, что на новом устройстве его придётся ввести заново.
const TMDB_KEY_STORAGE = "tasteid_tmdb_key";

// Служебное значение в списке статусов: «здесь и сейчас завести свой».
// Чаще всего это «Брошено» — статуса с таким смыслом у большинства нет,
// а записи под ним терять жалко. Уводить человека в другой раздел
// нельзя: разобранный файл живёт в памяти страницы и при уходе пропадёт.
const NEW_STATUS_VALUE = "__new__";

// Приложение это или сайт. isAppContext() отвечает промисом, а
// renderImport() собирает разметку сразу — поэтому ответ запоминаем
// один раз при загрузке и дальше читаем синхронно. К последнему шагу
// импорта он заведомо готов: до него ещё выбирать файл и сверять
// оценки.
let importInAppContext = false;
isAppContext().then((yes) => {
  importInAppContext = yes;
});

let importData = null; // разобранная выгрузка
let importStep = "file"; // file | map | done
let importBusy = false;
let importStatusMap = {};
let importScoreMap = {};
let importSkipExisting = true;
let importKeysOpen = false; // не схлопывать блок с ключами при перерисовке

// ── Умолчания для соответствий ─────────────────
// Расставляются сами, но человек их правит: смысл шага именно в этом.

function defaultStatusMap() {
  const mine = activeStatusBuckets().map((b) => b.key);
  const has = (key) => mine.includes(key);
  return {
    watching: has("current") ? "current" : mine[0] || "completed",
    completed: "completed",
    onhold: has("onhold") ? "onhold" : "completed",
    // «Брошено» у большинства нет — тогда по умолчанию не тащим вовсе,
    // чтобы чужие брошенные не засоряли паспорт молча.
    dropped: has("dropped") ? "dropped" : "",
    plantowatch: has("planning") ? "planning" : "",
  };
}

// Оценки. Шкала нигде не зашита: у MAL десятка, у Goodreads пятёрка,
// у Letterboxd половинки звёзд. Берём значения, которые реально
// встретились в файле, и раскладываем их по полкам пропорционально —
// лучшее к лучшей, худшее к худшей.
function scoresInFile() {
  const values = new Set();
  for (const item of importData.items) {
    if (item.score > 0) values.add(item.score);
  }
  return [...values].sort((a, b) => b - a);
}

function defaultScoreMap() {
  const shelves = GRADE_ORDER;
  const scores = scoresInFile();
  if (!scores.length) return {};

  // Границы берём у сервиса, а не из файла. Иначе у человека, который
  // ставил только 8, 9 и 10, восьмёрка уехала бы на худшую полку —
  // хотя по десятибалльной шкале это «хорошо».
  const max = importData.scaleMax || Math.max(...scores);
  const min = importData.scaleMin ?? Math.min(...scores);
  const span = max - min || 1;

  const map = {};
  for (const score of scores) {
    const position = Math.min(Math.max((max - score) / span, 0), 1); // 0 — лучшее
    const idx = Math.min(Math.round(position * (shelves.length - 1)), shelves.length - 1);
    map[score] = shelves[idx];
  }
  return map;
}

// ── Экран ──────────────────────────────────────

async function loadImport() {
  if (importBusy) return;
  importBusy = true;
  try {
    await fetchReviews();
    renderImport();
  } finally {
    importBusy = false;
  }
}

function renderImport() {
  const box = document.getElementById("importPanel");
  if (!box) return;
  box.innerHTML = importStyles() + (
    importStep === "map" ? importMapHtml() :
    importStep === "done" ? importDoneHtml() :
    importFileHtml()
  );
  bindImport();
}

// Что именно сайт принимает и откуда это берётся.
//
// Названия здесь нарочно полные, вплоть до пункта меню и имени файла:
// «выгрузи список» — совет, по которому человек, ни разу этого не делавший,
// не сдвинется с места. Сервисы прячут экспорт в настройках по-разному, и
// половина отдаёт архив вместо файла, о чём тоже надо предупредить заранее,
// а не ошибкой разбора.
const IMPORT_SOURCES = [
  {
    what: i18n("Аниме и манга"),
    who: "MyAnimeList",
    file: "XML",
    how: i18n("myanimelist.net → значок профиля → Export → Anime List или Manga List → Export My List. Скачается архив .xml.gz — распакуй его, нужен файл .xml изнутри."),
  },
  {
    what: i18n("Аниме и манга"),
    who: i18n("Шикимори"),
    file: "XML",
    how: i18n("shikimori.one → Настройки → Списки → Экспорт → формат MyAnimeList. Аниме и манга выгружаются двумя отдельными файлами — загрузи их по очереди."),
  },
  {
    what: i18n("Аниме и манга"),
    who: "AniList",
    file: i18n("по нику"),
    how: i18n("Файл не нужен и выгружать ничего не надо: открытый список AniList отдаёт кому угодно, и мы просто спросим его по нику. Поле для ника ниже. Обложки приезжают сразу вместе со списком."),
  },
  {
    what: i18n("Книги"),
    who: "Goodreads",
    file: "CSV",
    how: i18n("goodreads.com/review/import → кнопка Export Library, через минуту там же появится ссылка на goodreads_library_export.csv."),
  },
  {
    what: i18n("Фильмы"),
    who: "Letterboxd",
    file: "CSV",
    how: i18n("letterboxd.com/settings/data → Export Your Data. Скачается архив; внутри нужны ratings.csv (что оценено), watched.csv (что просмотрено) и watchlist.csv (что в планах) — по одному за раз."),
  },
];

function importSourcesHtml() {
  return `<div class="imp-sources">
    ${IMPORT_SOURCES.map((src) => `
      <div class="imp-source">
        <div class="imp-source-head">
          <span class="imp-source-who">${esc(src.who)}</span>
          <span class="imp-source-file">${esc(src.file)}</span>
        </div>
        <div class="imp-source-what">${esc(src.what)}</div>
        <div class="imp-source-how">${esc(src.how)}</div>
      </div>`).join("")}
  </div>`;
}

function importFileHtml() {
  return `
    <p class="panel-intro">
      ${i18n("Перенос списка из другого сервиса. Формат узнаётся сам, выбирать его не нужно. Файл разбирается прямо здесь, в браузере, и никуда не отправляется, а в паспорт попадает только после того, как ты подтвердишь.")}
    </p>
    <h2 class="section-h">${i18n("Что и откуда принимаем")}</h2>
    ${importSourcesHtml()}
    <p class="imp-note">
      ${i18n("Игры пока не принимаем: у сервисов, где их ведут, нет общего формата выгрузки. Появится образец файла — разберём и его.")}
    </p>
    ${importKeysHtml()}
    <div class="imp-actions">
      <label class="btn btn-ghost file-btn">
        <input type="file" id="imp-file" accept=".xml,.csv,application/xml,text/xml,text/csv">
        <span>${i18n("Выбрать файл выгрузки")}</span>
      </label>
    </div>
    <div class="status-msg" id="imp-status"></div>

    <h2 class="section-h">${i18n("Или по нику с AniList")}</h2>
    <p class="imp-note">
      ${i18n("Ник тот же, что в адресе профиля: anilist.co/user/")}<strong>${i18n("ник")}</strong>${i18n(". Список должен быть открыт — если в настройках профиля он закрыт, снаружи его не видно.")}
    </p>
    <div class="imp-actions">
      <input type="text" id="imp-anilist-user" placeholder="${i18n("ник на AniList")}"
             autocomplete="off" spellcheck="false">
      <button class="btn btn-ghost" id="imp-anilist-go" type="button">${i18n("Забрать список")}</button>
    </div>
    <div class="status-msg" id="imp-anilist-status"></div>`;
}

// ── Ключи сервисов ─────────────────────────────
// Ключ нужен ровно один и ровно для одного: обложек к фильмам. Всё
// остальное сайт добирает бесплатно и молча — см. блок «Обложки» ниже.

function tmdbKey() {
  try {
    return localStorage.getItem(TMDB_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function saveTmdbKey(value) {
  try {
    if (value) localStorage.setItem(TMDB_KEY_STORAGE, value);
    else localStorage.removeItem(TMDB_KEY_STORAGE);
  } catch {
    // Приватный режим — ключ проживёт до перезагрузки страницы, и ладно.
  }
}

// Ключ проверяем сразу, а не в момент импорта: узнать об опечатке через
// двести запросов и список без обложек — худший из возможных вариантов.
async function checkTmdbKey(key) {
  const res = await fetch(`${IMPORT_TMDB_ENDPOINT}/configuration?api_key=${encodeURIComponent(key)}`);
  if (res.status === 401) throw new Error(i18n("TMDB не узнал этот ключ. Проверь, что скопирован он целиком."));
  if (!res.ok) throw new Error(`TMDB ответил ${res.status}. Попробуй ещё раз через минуту.`);
  return true;
}

function importKeysHtml() {
  const key = tmdbKey();
  return `
    <details class="imp-keys"${importKeysOpen ? " open" : ""}>
      <summary>
        Ключи сервисов — по желанию
        ${key ? `<span class="imp-key-on">TMDB подключён</span>` : ""}
      </summary>
      <div class="imp-keys-body">
        <p class="imp-note">
          ${i18n("Без всяких ключей сайт уже достаёт обложки аниме и манги (у AniList) и обложки книг (у Open Library) — там их отдают всем. Ключ нужен только для фильмов: единственная открытая база с постерами, TMDB, пускает по ключу. Ключ бесплатный и выдаётся сразу.")}
        </p>

        <div class="imp-key">
          <div class="imp-key-head">
            <span class="imp-key-name">TMDB</span>
            <span class="imp-key-what">${i18n("постеры, год выхода и номер фильма")}</span>
          </div>
          <ol class="imp-key-steps">
            <li>${i18n("Заведи аккаунт на themoviedb.org и подтверди почту.")}</li>
            <li>${i18n("Настройки профиля → раздел API → Request an API Key.")}</li>
            <li>${i18n("Выбери тип Developer, прими условия и заполни короткую анкету (в поле о цели использования достаточно написать, что ведёшь личный список просмотренного).")}</li>
            <li>${i18n("Ключ появится тут же, в строке API Key (v3 auth) — скопируй его сюда целиком.")}</li>
          </ol>
          <div class="imp-key-row">
            <input type="password" id="imp-tmdb-key" value="${esc(key)}"
                   placeholder="${i18n("ключ v3, 32 знака")}" autocomplete="off" spellcheck="false">
            <button class="btn btn-ghost" id="imp-tmdb-save" type="button">${i18n("Проверить и сохранить")}</button>
            ${key ? `<button class="btn btn-ghost" id="imp-tmdb-clear" type="button">Убрать</button>` : ""}
          </div>
          <div class="status-msg" id="imp-key-status"></div>
        </div>

        <p class="imp-note imp-key-warn">
          ${i18n("Ключ хранится только в этом браузере и никуда не уходит: ни на сервер сайта, ни в его файлы. Причина простая — репозиторий сайта открытый, и всё, что сохраняется в настройках, видно любому. Обратная сторона: на другом устройстве ключ придётся ввести заново.")}
        </p>
      </div>
    </details>`;
}

// Что из выгрузки уже есть в паспорте.
//
// Сначала по номерам — это не ошибается никогда. Но у Letterboxd
// номеров нет вовсе, так что для фильмов остаётся название с годом.
// Для фильма это приемлемо: у него одно каноническое название и один
// год выхода, в отличие от аниме, где под одним именем идут три
// сезона (см. историю с «Jujutsu Kaisen» в js/passports.js).
function importMatchKeys(item) {
  const keys = [];
  for (const [base, value] of Object.entries(item.ids || {})) {
    if (value) keys.push(`${base}:${value}`);
  }
  const year = item.year ? String(item.year).slice(0, 4) : "";
  keys.push(`t:${normTitle(item.title)}|${item.type || ""}|${year}`);
  return keys;
}

function splitImportItems() {
  // Индекс своих отзывов. Неоднозначные ключи выбрасываем: лучше
  // посчитать запись новой, чем приписать чужую оценку не тому тайтлу.
  const index = new Map();
  const ambiguous = new Set();
  for (const r of cache.reviews || []) {
    for (const key of importMatchKeys(r)) {
      if (index.has(key) && index.get(key) !== r) ambiguous.add(key);
      else index.set(key, r);
    }
  }
  for (const key of ambiguous) index.delete(key);

  const fresh = [];
  const existing = [];
  for (const item of importData.items) {
    const hit = importMatchKeys(item).some((k) => index.has(k));
    (hit ? existing : fresh).push(item);
  }
  return { fresh, existing };
}

function importMapHtml() {
  const { fresh, existing } = splitImportItems();
  const byStatus = {};
  for (const item of importData.items) {
    const key = item.status || "—";
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  const scored = importData.items.filter((i) => i.score > 0).length;

  const statusRows = Object.keys(IMPORT_STATUS_KEYS)
    .filter((key) => byStatus[key])
    .map((key) => `
      <div class="imp-row" id="imp-statusrow-${key}">
        <div class="imp-from">${esc(IMPORT_STATUS_KEYS[key])} <span class="imp-count">${byStatus[key]}</span></div>
        <div class="imp-arrow">→</div>
        <select class="imp-select" data-status="${key}">
          <option value="">${i18n("не импортировать")}</option>
          <option value="completed"${importStatusMap[key] === "completed" ? " selected" : ""}>${esc(siteLabel("statuses", "archive", i18n("Архив")))}</option>
          ${activeStatusBuckets().map((b) =>
            `<option value="${esc(b.key)}"${importStatusMap[key] === b.key ? " selected" : ""}>${esc(b.label)}</option>`
          ).join("")}
          <option value="${NEW_STATUS_VALUE}">${i18n("+ завести свой статус…")}</option>
        </select>
      </div>
      <div class="imp-newstatus hidden" id="imp-newstatus-${key}">
        <input type="text" id="imp-newstatus-name-${key}" placeholder="${i18n("Например: Брошено")}" maxlength="40">
        <button class="btn btn-ghost" data-create-status="${key}" type="button">${i18n("Завести")}</button>
        <button class="btn btn-ghost" data-cancel-status="${key}" type="button">${i18n("Отмена")}</button>
      </div>`).join("");

  const scoreRows = scoresInFile().map((score) => {
    const n = importData.items.filter((i) => i.score === score).length;
    return `
      <div class="imp-row">
        <div class="imp-from">${esc(String(score))} <span class="imp-count">${n}</span></div>
        <div class="imp-arrow">→</div>
        <select class="imp-select" data-score="${esc(String(score))}">
          <option value="">${i18n("без оценки")}</option>
          ${GRADE_ORDER.map((key) =>
            `<option value="${esc(key)}"${importScoreMap[score] === key ? " selected" : ""}>${esc(GRADES[key]?.name || key)}</option>`
          ).join("")}
        </select>
      </div>`;
  });

  const hasMovies = importData.items.some((i) => i.type === "movie");
  const hasKey = !!tmdbKey();

  return `
    <p class="imp-source-line">${importData.byName ? "Список" : i18n("Узнан формат")}: <strong>${esc(importData.source)}</strong></p>
    <div class="imp-summary">
      ${impStat(importData.items.length, importData.byName ? "в списке" : i18n("в выгрузке"))}
      ${impStat(fresh.length, i18n("новых"))}
      ${impStat(existing.length, i18n("уже есть"))}
      ${impStat(scored, i18n("с оценкой"))}
    </div>
    ${importData.skipped ? `<p class="imp-note">${importData.skipped} записей пропущено — у них нет названия.</p>` : ""}
    ${hasMovies && hasKey ? `<p class="imp-note">Постеры к фильмам возьмём у TMDB по названию и году — ключ подключён.</p>` : ""}
    ${hasMovies && !hasKey ? `
      <p class="imp-note">
        Обложек у фильмов в выгрузке нет. Без ключа TMDB они приедут без
        картинок — это не страшно, ключ можно добавить и потом, а обложки
        подтянуть повторным импортом того же файла. Аниме, манга и книги
        обложки получат в любом случае.
      </p>
      ${importKeysHtml()}` : ""}

    <h2 class="section-h">${i18n("Статусы")}</h2>
    <p class="panel-intro">Слева то, что стоит ${importData.byName ? "в списке" : i18n("в выгрузке")}, справа — куда это ляжет у тебя.</p>
    ${statusRows}

    <h2 class="section-h">${i18n("Оценки")}</h2>
    <p class="panel-intro">
      Шкала сервиса (от ${esc(String(importData.scaleMin ?? 1))} до
      ${esc(String(importData.scaleMax ?? 10))}) разложена на твои полки поровну.
      Поправь, если у тебя другое представление о том, что такое «восьмёрка».
    </p>
    ${scoreRows.join("") || `<p class="imp-note">В выгрузке нет ни одной оценки.</p>`}

    <h2 class="section-h">${i18n("Что уже есть в паспорте")}</h2>
    <div class="imp-row imp-row-plain">
      <label><input type="checkbox" id="imp-skip" ${importSkipExisting ? "checked" : ""}> Не трогать ${existing.length} ${plural(existing.length, [i18n("запись"), i18n("записи"), i18n("записей")])}, которые уже заведены</label>
    </div>
    <p class="panel-intro">
      ${i18n("Снятая галочка перезапишет у них статус и оценку значениями из выгрузки. Тексты отзывов не пострадают в любом случае.")}
    </p>

    <div class="imp-actions">
      <button class="btn-save" id="imp-run" type="button">${i18n("Перенести в паспорт")}</button>
      <button class="btn btn-ghost" id="imp-cancel" type="button">${i18n("Отмена")}</button>
    </div>
    <div class="status-msg" id="imp-status"></div>`;
}

function importDoneHtml() {
  // «Сайт обновится» — про сайт, а не про приложение: здесь записи уже
  // лежат в reviews.json на диске. Строку показываем только когда это
  // правда сайт, как это делают все остальные подобные сообщения.
  const note = importInAppContext ? "" : i18n(" Сайт обновится через ~30 секунд.");
  return `
    <p class="panel-intro">${i18n("Готово.")}${note}</p>
    <div class="imp-summary">
      ${impStat(importData.added, i18n("добавлено"))}
      ${impStat(importData.updated, i18n("обновлено"))}
      ${impStat(importData.untouched, i18n("не тронуто"))}
    </div>
    <div class="imp-actions">
      <button class="btn btn-ghost" id="imp-again" type="button">${i18n("Импортировать ещё файл")}</button>
    </div>`;
}

function impStat(value, label) {
  return `<div class="imp-stat">
    <div class="imp-stat-value">${value}</div>
    <div class="imp-stat-label">${esc(label)}</div>
  </div>`;
}

// ── Заведение статуса на месте ─────────────────

async function createStatusFromImport(malKey) {
  const input = document.getElementById(`imp-newstatus-name-${malKey}`);
  const status = document.getElementById("imp-status");
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  const existing = activeStatusBuckets().find(
    (b) => b.label.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    // Такой статус уже есть — просто выбираем его, а не плодим двойник.
    importStatusMap[malKey] = existing.key;
    renderImport();
    return;
  }

  // Ключ строится так же, как в панели «Оценки и статусы», чтобы
  // заведённое отсюда ничем не отличалось от заведённого там.
  const key =
    "status_" +
    name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "_").slice(0, 30) +
    "_" + Date.now().toString(36).slice(-4);

  status.className = "status-msg";
  status.textContent = `Заводим статус «${name}»…`;
  try {
    const saved = await patchSiteSettings((settings) => {
      const current = settings.statusBuckets?.length
        ? settings.statusBuckets
        : DEFAULT_STATUS_BUCKETS.map((b) => ({ ...b, removable: false }));
      settings.statusBuckets = [...current, { key, label: name, removable: true }];
    });

    // Статус должен появиться сразу и здесь, и на самом сайте.
    window.SITE_STATUS_BUCKETS = saved.statusBuckets;
    // Панель «Оценки и статусы» держит свою копию списка, и её
    // сохранение затёрло бы новый статус. Даём ей знать.
    if (typeof onStatusBucketsChanged === "function") {
      onStatusBucketsChanged(saved.statusBuckets);
    }

    importStatusMap[malKey] = key;
    status.textContent = `Статус «${name}» заведён.`;
    renderImport();
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = `Не получилось завести статус: ${err.message}`;
  }
}

// ── Обложки ────────────────────────────────────
// В выгрузках их нет ни у кого. Что можно достать без ключей:
//
//   аниме и манга — у AniList по номеру MAL, тем же способом, что и
//   scripts/enrich-ids.js; заодно приезжает номер AniList и год;
//
//   книги — прямой ссылкой на Open Library по ISBN, даже без запроса:
//   ?default=false заставляет её отдать 404 вместо пустой картинки,
//   а с битой ссылкой сайт и так умеет (см. imgFallbackAttrs);
//
//   фильмы — только с ключом TMDB, и только по названию с годом: в
//   выгрузке Letterboxd нет ни номера фильма, ни ссылки на базу. Без
//   ключа приедут без обложек, и это честно сказано на экране.

function openLibraryCover(isbn13) {
  return `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`;
}

function tmdbPoster(path) {
  return `${IMPORT_TMDB_IMAGES}${path}`;
}

// Ключ, под которым найденный фильм ждёт своей записи. Название с годом —
// единственное, чем фильм из выгрузки себя называет, так что и здесь то же.
function tmdbCacheKey(item) {
  return `${normTitle(item.title)}|${item.year ? String(item.year).slice(0, 4) : ""}`;
}

// Поиск по названию с годом. Год важен: «Дюна» без него — это и 1984-й,
// и 2021-й, и первый в выдаче окажется не тот. Берём первый результат:
// TMDB сортирует по популярности, и при совпадении года это почти всегда
// именно тот фильм.
async function fetchTmdbMeta(items, onProgress) {
  const key = tmdbKey();
  const found = new Map();
  if (!key) return found;

  for (let i = 0; i < items.length; i += IMPORT_TMDB_BATCH) {
    const chunk = items.slice(i, i + IMPORT_TMDB_BATCH);
    onProgress?.(Math.min(i + chunk.length, items.length), items.length);

    await Promise.all(chunk.map(async (item) => {
      const params = new URLSearchParams({ api_key: key, query: item.title, language: "ru-RU" });
      const year = item.year ? String(item.year).slice(0, 4) : "";
      if (year) params.set("year", year);
      try {
        const res = await fetch(`${IMPORT_TMDB_ENDPOINT}/search/movie?${params}`);
        if (!res.ok) return;
        const body = await res.json();
        const hit = body?.results?.[0];
        if (hit) found.set(tmdbCacheKey(item), hit);
      } catch {
        // Сеть отвалилась — этот фильм приедет без постера, остальные нет.
      }
    }));

    // У TMDB лимит около сорока запросов в секунду; пятёрка с паузой в
    // четверть секунды и близко к нему не подходит.
    if (i + IMPORT_TMDB_BATCH < items.length) await new Promise((r) => setTimeout(r, 250));
  }
  return found;
}

async function fetchAnilistMeta(malIds, onProgress) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(idMal_in: $ids) {
          id
          idMal
          coverImage { large }
          startDate { year }
        }
      }
    }`;

  const byMal = new Map();
  for (let i = 0; i < malIds.length; i += IMPORT_BATCH) {
    const chunk = malIds.slice(i, i + IMPORT_BATCH);
    onProgress?.(Math.min(i + chunk.length, malIds.length), malIds.length);
    try {
      const res = await fetch(IMPORT_ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { ids: chunk } }),
      });
      if (!res.ok) continue;
      const body = await res.json();
      for (const m of body?.data?.Page?.media || []) {
        if (m.idMal) byMal.set(m.idMal, m);
      }
    } catch {
      // Сеть отвалилась — идём дальше без обложек для этой пачки.
    }
    if (i + IMPORT_BATCH < malIds.length) await new Promise((r) => setTimeout(r, 1200));
  }
  return byMal;
}

// ── Список с AniList по нику ───────────────────
// Ключа не нужно: открытый список отдаётся кому угодно. Запроса ровно
// два — на аниме и на мангу; MediaListCollection не разбит на страницы и
// приезжает целиком (у него свой потолок в 11 тысяч записей, до которого
// живому человеку далеко).

const ANILIST_LIST_QUERY = `
  query ($userName: String, $type: MediaType) {
    MediaListCollection(userName: $userName, type: $type) {
      lists {
        isCustomList
        entries {
          status
          score(format: POINT_10)
          repeat
          startedAt { year month day }
          completedAt { year month day }
          media {
            id
            idMal
            type
            format
            countryOfOrigin
            title { romaji english native }
            startDate { year }
            coverImage { large }
          }
        }
      }
    }
  }`;

async function fetchAnilistUserList(userName, onProgress) {
  const collections = [];
  const types = ["ANIME", "MANGA"];

  for (const type of types) {
    onProgress?.(type);
    let res;
    try {
      res = await fetch(IMPORT_ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: ANILIST_LIST_QUERY, variables: { userName, type } }),
      });
    } catch {
      throw new Error(i18n("Не получилось достучаться до AniList. Проверь интернет и попробуй ещё раз."));
    }

    if (res.status === 429) {
      throw new Error(i18n("AniList просит подождать — слишком много запросов подряд. Попробуй через минуту."));
    }

    const body = await res.json().catch(() => null);
    const message = body?.errors?.[0]?.message;

    if (message && /not found/i.test(message)) {
      throw new Error(`AniList не знает пользователя «${userName}». Ник нужен тот, что в адресе профиля.`);
    }
    if (message && /private/i.test(message)) {
      throw new Error(`Список у «${userName}» закрыт настройками профиля — снаружи его не видно.`);
    }
    if (message) throw new Error(`AniList ответил: ${message}`);
    if (!res.ok) throw new Error(`AniList ответил ${res.status}. Попробуй ещё раз через минуту.`);

    collections.push(body?.data?.MediaListCollection);
  }

  return collections;
}

// ── Перенос ────────────────────────────────────

async function runImport() {
  const status = document.getElementById("imp-status");
  const btn = document.getElementById("imp-run");
  btn.disabled = true;

  const { fresh, existing } = splitImportItems();
  const toWrite = importSkipExisting ? fresh : [...fresh, ...existing];

  // Не импортируем то, чей статус человек оставил пустым.
  const selected = toWrite.filter((i) => i.status && importStatusMap[i.status]);
  if (!selected.length) {
    status.className = "status-msg err";
    status.textContent = i18n("Нечего переносить: у всех записей статус помечен как «не импортировать».");
    btn.disabled = false;
    return;
  }

  status.className = "status-msg";

  // Обложки. Аниме и манга — у AniList по номеру MAL, книгам хватит
  // прямой ссылки по ISBN, фильмы — у TMDB и только если есть ключ.
  //
  // У списка, взятого с AniList по нику, обложка уже своя — за ней в
  // AniList ходить незачем, и такие записи в запрос не попадают.
  const malIds = selected.filter((i) => !i.cover).map((i) => i.ids?.mal).filter(Boolean);
  let meta = new Map();
  if (malIds.length) {
    meta = await fetchAnilistMeta(malIds, (done, total) => {
      status.textContent = `Спрашиваем обложки у AniList… ${done} из ${total}`;
    });
  }

  const movies = selected.filter((i) => i.type === "movie");
  let films = new Map();
  if (movies.length && tmdbKey()) {
    films = await fetchTmdbMeta(movies, (done, total) => {
      status.textContent = `Спрашиваем постеры у TMDB… ${done} из ${total}`;
    });
  }

  const payload = selected.map((item) => {
    const extra = item.ids?.mal ? meta.get(item.ids.mal) : null;
    const film = item.type === "movie" ? films.get(tmdbCacheKey(item)) : null;
    const ids = { ...(item.ids || {}) };
    if (extra?.id) ids.anilist = extra.id;
    if (film?.id) ids.tmdb = film.id;

    const cover =
      item.cover ||
      extra?.coverImage?.large ||
      (film?.poster_path ? tmdbPoster(film.poster_path) : null) ||
      (ids.isbn13 ? openLibraryCover(ids.isbn13) : null);

    return {
      title: item.title,
      type: item.type,
      status: importStatusMap[item.status],
      grade: item.score ? importScoreMap[item.score] || null : null,
      year:
        item.year ||
        (extra?.startDate?.year ? String(extra.startDate.year) : null) ||
        (film?.release_date ? film.release_date.slice(0, 4) : null),
      cover,
      rewatch_count: item.rewatch || 0,
      date_start: item.dateStart,
      date_end: item.dateEnd,
      ids: Object.keys(ids).length ? ids : undefined,
    };
  });

  status.textContent = `Записываем ${payload.length} записей…`;
  try {
    const res = await fetch("/api/import-reviews", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload, overwrite: !importSkipExisting }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);

    importData.added = data.added ?? 0;
    importData.updated = data.updated ?? 0;
    importData.untouched = importData.items.length - (data.added ?? 0) - (data.updated ?? 0);
    importStep = "done";
    cache.reviews = null; // список изменился — перечитаем при следующем обращении
    renderImport();
  } catch (err) {
    status.className = "status-msg err";
    status.textContent = `Не получилось: ${err.message}`;
    btn.disabled = false;
  }
}

function bindImport() {
  bindImportKeys();
  bindAnilistUser();

  document.getElementById("imp-file")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const status = document.getElementById("imp-status");
    status.className = "status-msg";
    status.textContent = i18n("Читаем файл…");
    try {
      await startMapping(parseImportFile(await file.text(), file.name));
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    }
  });

  document.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const malKey = sel.dataset.status;
      if (sel.value === NEW_STATUS_VALUE) {
        // Возвращаем список к прошлому выбору: служебный пункт не
        // должен остаться выбранным, если человек передумает.
        sel.value = importStatusMap[malKey] || "";
        const form = document.getElementById(`imp-newstatus-${malKey}`);
        form.classList.remove("hidden");
        document.getElementById(`imp-newstatus-name-${malKey}`).focus();
        return;
      }
      importStatusMap[malKey] = sel.value;
    });
  });

  document.querySelectorAll("[data-create-status]").forEach((btn) => {
    btn.addEventListener("click", () => createStatusFromImport(btn.dataset.createStatus));
  });
  document.querySelectorAll("[data-cancel-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`imp-newstatus-${btn.dataset.cancelStatus}`).classList.add("hidden");
    });
  });
  document.querySelectorAll(".imp-newstatus input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      createStatusFromImport(input.id.replace("imp-newstatus-name-", ""));
    });
  });
  document.querySelectorAll("[data-score]").forEach((sel) => {
    sel.addEventListener("change", () => { importScoreMap[sel.dataset.score] = sel.value; });
  });
  document.getElementById("imp-skip")?.addEventListener("change", (e) => {
    importSkipExisting = e.target.checked;
  });

  document.getElementById("imp-run")?.addEventListener("click", runImport);
  document.getElementById("imp-cancel")?.addEventListener("click", () => {
    importData = null;
    importStep = "file";
    renderImport();
  });
  document.getElementById("imp-again")?.addEventListener("click", () => {
    importData = null;
    importStep = "file";
    renderImport();
  });
}

// Разобранный список — из файла ли, из сети ли — дальше идёт одним путём.
async function startMapping(parsed) {
  // Перечитываем свои отзывы перед разбором: после предыдущего импорта
  // кэш сброшен, а без него «уже есть» посчиталось бы нулём и вторая
  // пачка приехала бы дублями.
  await fetchReviews();
  importData = parsed;
  importStatusMap = defaultStatusMap();
  importScoreMap = defaultScoreMap();
  importStep = "map";
  renderImport();
}

function bindAnilistUser() {
  const input = document.getElementById("imp-anilist-user");
  const btn = document.getElementById("imp-anilist-go");
  const status = document.getElementById("imp-anilist-status");
  if (!input || !btn) return;

  const go = async () => {
    const userName = input.value.trim().replace(/^@/, "");
    if (!userName) { input.focus(); return; }
    if (importBusy) return;
    importBusy = true;
    btn.disabled = true;
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем AniList…");
    try {
      const collections = await fetchAnilistUserList(userName, (type) => {
        status.textContent = type === "ANIME" ? "Забираем аниме…" : i18n("Забираем мангу…");
      });
      const parsed = parseAnilistLists(collections);
      parsed.source = `AniList — ${userName}`;
      parsed.byName = true; // не файл: экран соответствий говорит об этом иначе
      if (!parsed.items.length) {
        throw new Error(`У «${userName}» в списке ничего нет — ни аниме, ни манги.`);
      }
      await startMapping(parsed);
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    } finally {
      importBusy = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener("click", go);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    go();
  });
}

function bindImportKeys() {
  // Раскрытый блок должен пережить перерисовку: её вызывает и сохранение
  // ключа, и появление статуса, а схлопывающийся на глазах блок читается
  // как сбой.
  document.querySelector(".imp-keys")?.addEventListener("toggle", (e) => {
    importKeysOpen = e.target.open;
  });

  const input = document.getElementById("imp-tmdb-key");
  const status = document.getElementById("imp-key-status");

  const save = async () => {
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    status.className = "status-msg";
    status.textContent = i18n("Спрашиваем TMDB, знает ли он такой ключ…");
    try {
      await checkTmdbKey(key);
      saveTmdbKey(key);
      importKeysOpen = true;
      renderImport();
      const fresh = document.getElementById("imp-key-status");
      if (fresh) fresh.textContent = i18n("Ключ принят. Постеры к фильмам теперь приедут вместе со списком.");
    } catch (err) {
      status.className = "status-msg err";
      status.textContent = err.message;
    }
  };

  document.getElementById("imp-tmdb-save")?.addEventListener("click", save);
  input?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    save();
  });

  document.getElementById("imp-tmdb-clear")?.addEventListener("click", () => {
    saveTmdbKey("");
    importKeysOpen = true;
    renderImport();
  });
}

function importStyles() {
  return `<style>
    .imp-actions { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; margin: 1.2rem 0 .6rem; }
    .imp-actions input[type="text"] { width: auto; flex: 1; min-width: 11rem; }
    .imp-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
      gap: 1px; background: var(--border);
      border: 1px solid var(--border); border-radius: 2px;
      overflow: hidden; margin-bottom: 1rem;
    }
    .imp-stat { background: var(--surface); padding: .85rem .7rem; text-align: center; }
    .imp-stat-value {
      font-family: 'Playfair Display', serif;
      font-weight: 700; font-size: 1.5rem; color: var(--text-hi); line-height: 1;
    }
    .imp-stat-label {
      font-family: 'DM Sans', sans-serif;
      font-size: .57rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim); margin-top: .4rem;
    }
    .imp-note {
      font-family: 'DM Sans', sans-serif;
      font-size: .75rem; color: var(--text-dim); margin: 0 0 1.5rem;
    }

    .imp-row {
      display: flex; align-items: center; gap: .7rem;
      padding: .5rem 0;
      border-bottom: 1px solid var(--border);
    }
    .imp-row-plain { border-bottom: none; }
    .imp-from {
      flex: 1; min-width: 0;
      font-family: 'Cormorant Garamond', serif;
      font-size: .98rem; color: var(--text-hi);
    }
    .imp-count {
      font-family: 'DM Sans', sans-serif;
      font-size: .62rem; color: var(--text-dim); margin-left: .4rem;
    }
    .imp-arrow { color: var(--text-dim); flex-shrink: 0; }
    .imp-select { width: auto; min-width: 11rem; flex-shrink: 0; }

    .imp-sources {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
      gap: 1px; background: var(--border);
      border: 1px solid var(--border); border-radius: 2px;
      overflow: hidden; margin: 1rem 0 1.2rem;
    }
    /* Нечётное число источников в двухколоночной сетке оставляет пустую
       ячейку последней строки — фон .imp-sources (он и рисует тонкие линии
       между карточками) в ней ничем не перекрыт и виден как лишний серый
       блок. Последняя карточка при нечётном счёте растягивается на всю
       строку и ячейке взяться неоткуда. */
    .imp-source:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .imp-source { background: var(--surface); padding: .85rem .95rem; min-width: 0; }
    .imp-source-head {
      display: flex; align-items: baseline; gap: .5rem;
      justify-content: space-between;
    }
    .imp-source-who {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.08rem; font-weight: 600; color: var(--text-hi);
    }
    .imp-source-file {
      font-family: 'DM Sans', sans-serif;
      font-size: .55rem; letter-spacing: .12em; text-transform: uppercase;
      color: var(--text-dim); border: 1px solid var(--border2);
      border-radius: 2px; padding: .12rem .35rem; flex-shrink: 0;
    }
    .imp-source-what {
      font-family: 'DM Sans', sans-serif;
      font-size: .58rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim); margin-top: .3rem;
    }
    .imp-source-how {
      font-family: 'DM Sans', sans-serif;
      font-size: .74rem; line-height: 1.5;
      color: var(--text-dim); margin-top: .5rem;
    }

    .imp-keys {
      border: 1px solid var(--border); border-radius: 2px;
      background: var(--surface); margin: 1.2rem 0;
    }
    .imp-keys > summary {
      cursor: pointer; list-style: none;
      display: flex; align-items: center; gap: .6rem; flex-wrap: wrap;
      padding: .7rem .95rem;
      font-family: 'DM Sans', sans-serif;
      font-size: .66rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim);
    }
    .imp-keys > summary::-webkit-details-marker { display: none; }
    .imp-keys > summary::before {
      content: "+"; color: var(--text-dim); font-size: .9rem; line-height: 1;
    }
    .imp-keys[open] > summary::before { content: "–"; }
    .imp-keys > summary:hover { color: var(--text-hi); }
    .imp-key-on {
      font-size: .55rem; letter-spacing: .1em;
      color: var(--text-hi); border: 1px solid var(--border2);
      border-radius: 2px; padding: .12rem .4rem; text-transform: none;
    }
    .imp-keys-body { padding: 0 .95rem .95rem; border-top: 1px solid var(--border); padding-top: .9rem; }
    .imp-keys-body .imp-note { margin-bottom: 1rem; }
    .imp-key-head { display: flex; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
    .imp-key-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.08rem; font-weight: 600; color: var(--text-hi);
    }
    .imp-key-what {
      font-family: 'DM Sans', sans-serif;
      font-size: .58rem; letter-spacing: .1em; text-transform: uppercase;
      color: var(--text-dim);
    }
    .imp-key-steps {
      font-family: 'DM Sans', sans-serif;
      font-size: .74rem; line-height: 1.6; color: var(--text-dim);
      margin: .6rem 0 .9rem; padding-left: 1.1rem;
    }
    .imp-key-steps li { margin-bottom: .25rem; }
    .imp-key-row { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; }
    .imp-key-row input { width: auto; flex: 1; min-width: 12rem; }
    .imp-key-warn { margin: 1.1rem 0 0; }
    .imp-source-line {
      font-family: 'DM Sans', sans-serif;
      font-size: .78rem; color: var(--text-dim); margin: 0 0 1rem;
    }
    .imp-source-line strong { color: var(--text-hi); font-weight: 500; }

    .imp-newstatus {
      display: flex; gap: .5rem; align-items: center;
      padding: .6rem 0 .8rem; flex-wrap: wrap;
    }
    .imp-newstatus.hidden { display: none; }
    .imp-newstatus input { width: auto; flex: 1; min-width: 10rem; }

    @media (max-width: 520px) {
      .imp-row { flex-wrap: wrap; }
      .imp-arrow { display: none; }
      .imp-select { width: 100%; min-width: 0; }
    }
  </style>`;
}
