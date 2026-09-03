// ══════════════════════════════════════════════
//  IMPORT FORMATS – разбор выгрузок из чужих сервисов
//  Зависит от: ничего (чистые функции)
//
//  Каждый сервис выгружает своё, и единого стандарта нет. Здесь на
//  каждый формат по адаптеру, а наружу они отдают один и тот же вид
//  записи – дальше js/import.js работает с ним, не зная, откуда он.
//
//  Что важно знать про сами выгрузки, потому что это определило всю
//  конструкцию:
//
//    MyAnimeList / Шикимори (XML) – есть номер тайтла, и это удача:
//    сопоставление по номеру не ошибается никогда.
//
//    Goodreads (CSV) – есть и свой номер, и ISBN. Тоже удача.
//
//    Letterboxd (CSV) – номеров НЕТ вовсе, только название и год.
//    Сопоставлять приходится по ним, и для фильмов это работает
//    заметно лучше, чем для аниме: у фильма одно каноническое
//    название и один год, а не три сезона под одним именем.
//
//  Оценки у всех свои: десятка у MAL, пятёрка у Goodreads, половинки
//  звёзд у Letterboxd. Адаптер отдаёт значение как есть и вместе с ним
//  настоящие границы шкалы – scaleMin и scaleMax. Именно настоящие, а
//  не наблюдаемые в файле: если человек ставил только четвёрки и
//  пятёрки, его четвёрка всё равно «хорошо», а не «худшее из
//  возможного», и раскладывать её надо по настоящей шкале.
// ══════════════════════════════════════════════

// ── Разбор CSV ─────────────────────────────────
// Своя реализация вместо split(",") не от любви к велосипедам:
// в выгрузках сплошь и рядом запятые внутри кавычек («Пелевин, Виктор»),
// экранированные кавычки и переводы строк прямо посреди поля – у
// Goodreads так лежат тексты рецензий. Наивный split разваливает файл
// молча, и человек об этом узнаёт уже по кривым данным в паспорте.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // BOM в начале файла превратил бы первый заголовок в «﻿Title»
  // и сломал бы определение формата.
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  // Пустые строки в конце файла – обычное дело, за запись их считать нельзя.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? "").trim(); });
    return obj;
  });
}

// ── Общий вид записи ───────────────────────────
// { title, type, status, score, scoreScale, rewatch, dateStart, dateEnd, ids }
// status – один из ключей ниже, общих для всех сервисов.
// score – как в исходнике; какая там шкала, никто не решает заранее.

const IMPORT_STATUS_KEYS = {
  watching: i18n("Смотрю / читаю / играю"),
  completed: i18n("Пройдено / просмотрено / прочитано"),
  onhold: i18n("Отложено"),
  dropped: i18n("Брошено"),
  plantowatch: i18n("В планах"),
};

// ── MyAnimeList и Шикимори (XML) ───────────────

const MAL_TYPE_MAP = {
  tv: "anime", ova: "anime", ona: "anime", special: "anime",
  movie: "anime", // в списке аниме «Movie» – полнометражка, а не кино
  music: "anime",
  manga: "manga", manhwa: "manhwa", manhua: "manhua",
  novel: "novel", lightnovel: "novel",
  oneshot: "manga", doujinshi: "manga", doujin: "manga",
};

function normalizeMalStatus(raw) {
  const s = (raw || "").toLowerCase().replace(/[\s_-]/g, "");
  if (s === "watching" || s === "reading") return "watching";
  if (s === "completed") return "completed";
  if (s === "onhold") return "onhold";
  if (s === "dropped") return "dropped";
  if (s === "plantowatch" || s === "plantoread") return "plantowatch";
  return null;
}

// MAL пишет «не заполнено» как 0000-00-00; такая дата хуже, чем никакой.
function cleanDate(value) {
  if (!value || /^0{4}-0{2}-0{2}$/.test(value)) return null;
  const m = String(value).match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseMalXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error(i18n("Файл не читается как XML. Выгрузка иногда приходит в архиве – распакуй его сначала."));
  }
  const entries = [...doc.querySelectorAll("anime, manga")];
  if (!entries.length) return null; // не наш формат – пусть попробуют другие

  const cell = (el, tag) => el.querySelector(tag)?.textContent?.trim() || "";
  const items = [];
  let skipped = 0;

  for (const el of entries) {
    const isManga = el.tagName.toLowerCase() === "manga";
    const malId = Number(cell(el, isManga ? "manga_mangadb_id" : "series_animedb_id"));
    const title = cell(el, "series_title") || cell(el, "manga_title");
    if (!malId || !title) { skipped++; continue; }

    const rawType = (cell(el, "series_type") || cell(el, "manga_type") || "")
      .toLowerCase().replace(/[\s_-]/g, "");

    items.push({
      title,
      type: MAL_TYPE_MAP[rawType] || (isManga ? "manga" : "anime"),
      status: normalizeMalStatus(cell(el, "my_status")),
      score: Number(cell(el, "my_score")) || 0,
      rewatch: Number(cell(el, "my_times_watched")) || Number(cell(el, "my_times_read")) || 0,
      dateStart: cleanDate(cell(el, "my_start_date")),
      dateEnd: cleanDate(cell(el, "my_finish_date")),
      ids: { mal: malId },
    });
  }
  return { source: i18n("MyAnimeList / Шикимори"), scaleMin: 1, scaleMax: 10, items, skipped };
}

// ── MyAnimeList (ответ по нику, а не файл) ─────
// Тот же список, что и в XML-выгрузке выше, но добытый через ник (см.
// core/api.js, fetchMalUserList) – это другой, «постраничный» JSON
// самого списка на сайте, а не файл ручного экспорта, поэтому у него
// свои имена полей. Типы тайтлов сведены к тем же ключам через
// MAL_TYPE_MAP, статусы – к тем же пяти, что и у XML-версии.

const MAL_JSON_STATUS_MAP = { 1: "watching", 2: "completed", 3: "onhold", 4: "dropped", 6: "plantowatch" };

// Личные даты начала/окончания (не путать с
// anime_start_date_string/anime_end_date_string – это даты выхода
// самого тайтла, а не когда его посмотрел человек), две цифры года.
// Порядок дня и месяца в паре первых чисел зависит от формата даты,
// выставленного в настройках профиля на самом MyAnimeList – он не
// один и тот же у всех аккаунтов (проверено на двух живых списках:
// у одного "10-18-02" явно месяц-день, у другого "28-01-18" явно
// день-месяц). Но формат – свойство всего аккаунта, не отдельной
// записи: если хотя бы у части дат один из компонентов однозначно
// больше 12 (то есть не может быть месяцем), этого достаточно, чтобы
// решить формат для ВСЕГО списка разом – и дальше применять его даже
// к тем датам, где сами по себе оба числа ≤12 и различить формат было
// бы нечем. Без этого раньше терялась примерно половина дат: ровно
// столько, где день и месяц оба меньше 13.
function detectMalDateOrder(rawDates) {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const value of rawDates) {
    const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
  }
  // Ни одной однозначной даты вообще, или (в теории) они указывают в
  // разные стороны сразу – формат решить не из чего, лучше не гадать.
  if (dayFirst && !monthFirst) return "day-first";
  if (monthFirst && !dayFirst) return "month-first";
  return null;
}

function parseMalDateWithOrder(value, order) {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m || !order) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const year = Number(m[3]) <= 69 ? 2000 + Number(m[3]) : 1900 + Number(m[3]);
  const [day, month] = order === "day-first" ? [a, b] : [b, a];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMalJsonLists({ anime, manga }) {
  const items = [];
  let skipped = 0;

  const allEntries = [...(anime || []), ...(manga || [])];
  const dateOrder = detectMalDateOrder(
    allEntries.flatMap((el) => [el.start_date_string, el.finish_date_string])
  );

  const push = (el, isManga) => {
    const malId = Number(isManga ? el.manga_id : el.anime_id);
    // String(...), не голое значение поля: у тайтлов, чьё название –
    // одни цифры (аниме «86» – ровно такой случай, MAL id 41457),
    // MAL отдаёт title числом, а не строкой в JSON. normTitle() ниже
    // по цепочке (js/import.js → js/cards.js) вызывает .toLowerCase()
    // без всякой защиты и без этого падал бы на первом же таком тайтле.
    const rawTitle = isManga ? el.manga_title : el.anime_title;
    const title = rawTitle === null || rawTitle === undefined ? "" : String(rawTitle);
    if (!malId || !title) { skipped++; return; }
    const rawType = ((isManga ? el.manga_media_type_string : el.anime_media_type_string) || "")
      .toLowerCase().replace(/[\s_-]/g, "");
    items.push({
      title,
      type: MAL_TYPE_MAP[rawType] || (isManga ? "manga" : "anime"),
      status: MAL_JSON_STATUS_MAP[el.status] || null,
      score: Number(el.score) || 0,
      // Список на сайте не отдаёт число пересмотров, только флаг
      // «пересматриваю сейчас прямо в эту минуту» – если он стоит,
      // значит пересмотр точно был хотя бы один, это надёжнее, чем
      // сплошной 0 для всех подряд, но всё ещё не точное число (XML-
      // выгрузка его знает и читается по-настоящему, см. parseMalXml).
      rewatch: el.is_rewatching ? 1 : 0,
      dateStart: parseMalDateWithOrder(el.start_date_string, dateOrder),
      dateEnd: parseMalDateWithOrder(el.finish_date_string, dateOrder),
      cover: (isManga ? el.manga_image_path : el.anime_image_path) || null,
      ids: { mal: malId },
    });
  };

  for (const el of anime || []) push(el, false);
  for (const el of manga || []) push(el, true);

  return { source: "MyAnimeList", scaleMin: 1, scaleMax: 10, items, skipped };
}

// ── Goodreads (CSV) ────────────────────────────

function parseGoodreads(rows) {
  const items = [];
  let skipped = 0;

  for (const r of rows) {
    const title = r["Title"];
    if (!title) { skipped++; continue; }

    // «to-read» / «currently-reading» / «read», плюс свои полки.
    const shelf = (r["Exclusive Shelf"] || "").toLowerCase();
    const status =
      shelf === "read" ? "completed" :
      shelf === "currently-reading" ? "watching" :
      shelf === "to-read" ? "plantowatch" :
      shelf === "on-hold" ? "onhold" :
      shelf === "dropped" || shelf === "abandoned" ? "dropped" :
      null;

    // ISBN приходит в виде ="9780123456789" – так Goodreads защищается
    // от того, чтобы Excel не съел ведущие нули и не сделал из номера
    // число в экспоненциальной записи.
    const isbn13 = Number((r["ISBN13"] || "").replace(/[^0-9]/g, "")) || 0;
    const goodreads = Number(r["Book Id"]) || 0;

    const ids = {};
    if (goodreads) ids.goodreads = goodreads;
    if (isbn13 > 9_000_000_000_000) ids.isbn13 = isbn13;

    items.push({
      title,
      type: "book",
      status,
      score: Number(r["My Rating"]) || 0, // 0 = не оценено
      rewatch: Math.max(Number(r["Read Count"]) || 0, 1) - 1, // у них это «сколько раз прочитано»
      dateStart: null,
      dateEnd: cleanDate(r["Date Read"]),
      year: (r["Original Publication Year"] || r["Year Published"] || "").trim() || null,
      author: (r["Author"] || "").trim() || null,
      ids: Object.keys(ids).length ? ids : undefined,
    });
  }
  return { source: "Goodreads", scaleMin: 1, scaleMax: 5, items, skipped };
}

// ── Letterboxd (CSV) ───────────────────────────
// Номеров в выгрузке нет вовсе – ни TMDB, ни IMDb. Есть название, год
// и ссылка на страницу самого Letterboxd. Сопоставлять придётся по
// названию с годом, и для фильмов это приемлемо: у фильма одно
// каноническое название и один год выхода.

function parseLetterboxd(rows) {
  const items = [];
  let skipped = 0;

  for (const r of rows) {
    const title = r["Name"];
    if (!title) { skipped++; continue; }

    // watchlist.csv – это «посмотреть потом», у него нет ни оценки,
    // ни даты просмотра. Отличаем по отсутствию колонки с оценкой.
    const hasRating = "Rating" in r;
    const rating = Number(r["Rating"]) || 0;

    items.push({
      title,
      type: "movie",
      status: hasRating || r["Watched Date"] || r["Date"] ? "completed" : "plantowatch",
      score: rating,
      rewatch: (r["Rewatch"] || "").toLowerCase() === "yes" ? 1 : 0,
      dateStart: null,
      dateEnd: cleanDate(r["Watched Date"] || r["Date"]),
      year: (r["Year"] || "").trim() || null,
      ids: undefined, // взять неоткуда
    });
  }
  // Половинки звёзд: минимум не единица, а 0,5.
  return { source: "Letterboxd", scaleMin: 0.5, scaleMax: 5, items, skipped };
}

// ── AniList (ответ API, а не файл) ─────────────
// Единственный источник, который приходит не файлом: список у AniList
// открытый и спрашивается по нику, без ключа. Разбор всё равно живёт
// здесь, рядом с остальными: наружу отдаётся ровно та же запись, и
// мастеру всё равно, приехала она из файла или из сети.

const ANILIST_STATUS_MAP = {
  CURRENT: "watching",
  REPEATING: "watching", // пересмотр – это всё-таки «смотрю»
  PLANNING: "plantowatch",
  COMPLETED: "completed",
  DROPPED: "dropped",
  PAUSED: "onhold",
};

// У AniList нет отдельных типов для манхвы и маньхуа – есть страна
// происхождения, и по ней они различаются надёжнее, чем у MyAnimeList,
// где тип проставляют руками и часто забывают.
function anilistType(media) {
  if (media.type === "ANIME") return "anime";
  if ((media.format || "").toUpperCase() === "NOVEL") return "novel";
  const country = (media.countryOfOrigin || "").toUpperCase();
  if (country === "KR") return "manhwa";
  if (country === "CN" || country === "TW") return "manhua";
  return "manga";
}

// Дата у AniList разложена на части, и любая из них может быть пустой.
// Неполную дату отбрасываем целиком: «2021-00-00» хуже, чем ничего.
function anilistDate(d) {
  if (!d || !d.year || !d.month || !d.day) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

// collections – по одному ответу MediaListCollection на аниме и мангу.
function parseAnilistLists(collections) {
  const items = [];
  const seen = new Set();
  let skipped = 0;

  for (const collection of collections) {
    for (const list of collection?.lists || []) {
      // Свои списки AniList отдаёт вперемешку с обычными, и одна и та же
      // запись лежит сразу в двух: в статусном и в своём. Берём только
      // статусные – иначе половина списка приехала бы дважды.
      if (list.isCustomList) continue;

      for (const entry of list.entries || []) {
        const media = entry.media;
        const title = media?.title?.romaji || media?.title?.english || media?.title?.native;
        if (!media || !title) { skipped++; continue; }
        if (seen.has(media.id)) continue;
        seen.add(media.id);

        const ids = {};
        if (media.id) ids.anilist = media.id;
        if (media.idMal) ids.mal = media.idMal;

        items.push({
          title,
          type: anilistType(media),
          status: ANILIST_STATUS_MAP[entry.status] || null,
          score: Number(entry.score) || 0,
          rewatch: Number(entry.repeat) || 0,
          dateStart: anilistDate(entry.startedAt),
          dateEnd: anilistDate(entry.completedAt),
          year: media.startDate?.year ? String(media.startDate.year) : null,
          // Обложка приезжает вместе со списком – в отличие от файла,
          // после которого за ней приходится ходить отдельным запросом.
          cover: media.coverImage?.large || null,
          ids: Object.keys(ids).length ? ids : undefined,
        });
      }
    }
  }
  // Оценку просим у AniList в десятибалльном виде – как у MyAnimeList,
  // чтобы экран соответствий выглядел одинаково. У кого стоит стобалльная
  // шкала, тому AniList округлит сам.
  return { source: "AniList", scaleMin: 1, scaleMax: 10, items, skipped };
}

// ── Определение формата ────────────────────────
// По набору заголовков: они у сервисов достаточно своеобразные, чтобы
// не спутать. Если не узнали – честно говорим об этом, а не пытаемся
// угадать и разложить данные наугад.

function detectCsvFormat(headers) {
  const has = (name) => headers.includes(name);
  if (has("Book Id") && has("Exclusive Shelf")) return "goodreads";
  if (has("Letterboxd URI") || (has("Name") && has("Year") && (has("Rating") || has("Watched Date")))) {
    return "letterboxd";
  }
  return null;
}

// Единая точка входа: отдаёт { source, scaleHint, items, skipped }
// либо бросает ошибку с объяснением, что не так с файлом.
// eslint-disable-next-line no-unused-vars
function parseImportFile(text, filename = "") {
  const looksXml = /^\s*<\?xml|<myanimelist/i.test(text.slice(0, 400));

  if (looksXml) {
    const parsed = parseMalXml(text);
    if (parsed && parsed.items.length) return parsed;
    throw new Error(i18n("Это XML, но списка аниме или манги внутри нет."));
  }

  const rows = csvToObjects(text);
  if (!rows.length) {
    throw new Error(i18n("Файл пустой или это не CSV и не XML. Нужна выгрузка списка из сервиса."));
  }

  const format = detectCsvFormat(Object.keys(rows[0]));
  if (format === "goodreads") {
    const parsed = parseGoodreads(rows);
    if (parsed.items.length) return parsed;
  }
  if (format === "letterboxd") {
    const parsed = parseLetterboxd(rows);
    if (parsed.items.length) return parsed;
  }

  throw new Error(
    i18n("Не удалось узнать формат файла. Понимаем выгрузки: MyAnimeList и Шикимори (XML), ") +
    i18n("Goodreads и Letterboxd (CSV). Колонки в файле: ") +
    Object.keys(rows[0]).slice(0, 6).join(", ") + "…"
  );
}
