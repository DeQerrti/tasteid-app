// ══════════════════════════════════════════════
//  CONFIG — все константы в одном месте
//  Менять только здесь, больше нигде
// ══════════════════════════════════════════════

const PH_TALL = "https://placehold.co/300x420/28211a/6b5e4a?text=?";
const PH_SQ   = "https://placehold.co/300x300/28211a/6b5e4a?text=?";

const NOVEL_FORMATS = ["NOVEL", "LIGHT_NOVEL"];

// Глобальный кэш — один объект на всё приложение
const cache = {};

// ── Ленивая загрузка html2canvas-pro ───────────
// Нужна только для двух кнопок экспорта в картинку (тир-лист,
// годовой дайджест статистики) — незачем качать эту библиотеку при
// каждом открытии страницы. Промис кэшируется, так что повторные
// вызовы не грузят скрипт заново.
//
// Файл лежит в составе приложения, а не тянется с CDN. На сайте CDN
// был уместен, здесь — нет: приложение работает с папкой на диске и
// без интернета, а обе кнопки экспорта молча отказывали в офлайне
// («Не удалось загрузить html2canvas»), хотя ничего сетевого в самой
// отрисовке картинки нет.
let _html2canvasPromise = null;
function loadHtml2Canvas() {
  if (typeof html2canvas !== "undefined") return Promise.resolve();
  if (_html2canvasPromise) return _html2canvasPromise;

  _html2canvasPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/js/vendor/html2canvas-pro.min.js";
    script.onload = () => resolve();
    script.onerror = () => {
      _html2canvasPromise = null; // даём шанс повторить попытку при следующем клике
      reject(new Error("Не удалось загрузить html2canvas"));
    };
    document.head.appendChild(script);
  });

  return _html2canvasPromise;
}

// ── Прокси внешних обложек в data:-URL перед html2canvas ──
// Используется в tlExport() (тир-лист персонажей).
//
// Картинки персонажей лежат на raw.githubusercontent.com (CORS в порядке),
// но для надёжности всё равно конвертируем в data:-URL — у data:-URL нет
// источника, canvas с ним не "пачкается" вообще, независимо от браузера.
//
// Используем wsrv.nl — публичный image-proxy с хорошей репутацией IP.
// Он умеет забирать картинки с GitHub и не блокируется ни одним из наших
// источников. https-URL передаём со схемой, иначе wsrv.nl трактует как http.
//
// Возвращает restore() — вызывать в finally, чтобы вернуть оригинальные src.
async function proxyImagesToDataUrls(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  const toProxy = imgs
    .map(img => ({ img, src: img.getAttribute("src") || "" }))
    .filter(({ src }) => src && !src.startsWith("data:") && !src.startsWith(location.origin) && !src.startsWith("/"));

  const origSrc = new Map();

  async function fetchAsDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  await Promise.all(toProxy.map(async ({ img, src }) => {
    try {
      const dataUrl = await fetchAsDataUrl(`https://wsrv.nl/?url=${encodeURIComponent(src)}`);
      origSrc.set(img, src);
      img.src = dataUrl;
    } catch (e) {
      console.warn(`[proxyImagesToDataUrls] wsrv.nl не смог получить ${src}: ${e.message}`);
    }
  }));

  return function restore() {
    origSrc.forEach((src, img) => { img.src = src; });
  };
}

// ── Экранирование HTML ─────────────────────────
// esc() переехал в js/utils.js — он нужен и страницам, которые config.js
// не подключают (reviews-order), и лежать в пяти копиях больше не должен.
// utils.js обязан подключаться раньше config.js.

// ── Признак админа (для UI) ────────────────────
// tasteid_ui — обычная, не HttpOnly кука, выставляется при логине.
// Реальная авторизация на запись проверяется на бэкенде через
// HttpOnly tasteid_auth (см. functions/_shared.js), эта кука —
// только чтобы решить, показывать ли кнопки редактирования.
function isAdmin() {
  return document.cookie.split(";").some(c => c.trim().startsWith("tasteid_ui="));
}

// ── Подпись выбранного файла для .file-btn (см. style.css) ─────
// Вызывается через onchange у <input type="file"> внутри <label class="file-btn">.
function updateFileBtnName(input) {
  const nameEl = document.getElementById(input.id + "-name");
  if (!nameEl) return;
  nameEl.textContent = input.files && input.files[0] ? input.files[0].name : "";
}

// ── Эвристика склонения существительных по числу (1 / 2–4 / 5+) ──
// Полной автоматики для русского языка не существует — слишком много
// исключений (человек → люди, окно → окон). Это чистый черновик:
// правильно угадывает окончания для большинства обычных существительных
// по типовым правилам склонения, но всегда должен оставаться
// редактируемым — вызывающий код показывает результат в трёх полях,
// которые можно поправить, а не подставляет его молча.
function guessRussianPlural(word) {
  const w = word.trim();
  if (!w) return ["", "", ""];
  const lower = w.toLowerCase();
  const hushers = ["ж", "ш", "щ", "ч"]; // после них "ы" пишется как "и"
  const last = lower.slice(-1);
  const base = lower.slice(0, -1);

  // Существительные на -а/-я (обычно женский род: книга, неделя)
  if (last === "а") {
    const softEnding = hushers.includes(base.slice(-1)) || ["г", "к", "х"].includes(base.slice(-1));
    return [w, base + (softEnding ? "и" : "ы"), base];
  }
  if (last === "я") {
    return [w, base + "и", base + "й"];
  }
  // Существительные на -о/-е (средний род: окно, поле) — самая
  // ненадёжная категория, много исключений, но черновик лучше пустоты.
  if (last === "о") {
    return [w, base + "а", base];
  }
  if (last === "е") {
    return [w, base + "я", base + "й"];
  }
  // Существительные на -й (трамвай, герой)
  if (last === "й") {
    return [w, base + "я", base + "ев"];
  }
  // Существительные на -ь — род не определить по написанию (словарь vs
  // тетрадь), берём мужской род как более частый случай.
  if (last === "ь") {
    return [w, base + "я", base + "ей"];
  }
  // Согласная на конце — мужской род (артбук, комикс)
  if (hushers.includes(last)) {
    return [w, w + "а", w + "ей"];
  }
  if (last === "ц") {
    return [w, w + "а", w + "ев"];
  }
  return [w, w + "а", w + "ов"];
}

// ── Точечное обновление site-settings.json ─────
// Для мест вне /settings-edit (например, редактор отзыва или тир-лист),
// где нет всего состояния настроек на руках: подтягивает актуальный
// site-settings.json, даёт мутатору поправить нужный кусок и отправляет
// файл целиком обратно. mutator(settings) должен мутировать объект
// на месте (или вернуть новый — оба варианта поддерживаются).
// Свежие настройки для правки.
//
// Читать выложенный site-settings.json здесь нельзя: он обновляется через
// сборку и раскладку, то есть отстаёт на десятки секунд после каждого
// сохранения. Две правки подряд — и вторая читала старый файл, а
// отправляла его целиком поверх свежего, стирая первую. Молча: sha на
// сервере перечитывается перед записью и всегда верный, неверно
// содержимое.
//
// /api/site-settings отдаёт то, что лежит в репозитории сию секунду.
// Запасной путь оставлен на случай, если эндпоинта нет (старая выкладка):
// лучше вернуться к прежнему поведению, чем не сохранить ничего.
async function currentSiteSettings() {
  try {
    const res = await fetch("/api/site-settings", { credentials: "include", cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    // сеть отвалилась — пробуем выложенную копию ниже
  }
  try {
    const res = await fetch("/site-settings.json", { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    // нет файла/сети — работаем с пустым объектом, как при первом сохранении
  }
  return {};
}

async function patchSiteSettings(mutator) {
  let settings = await currentSiteSettings();

  settings = mutator(settings) || settings;

  const res = await fetch("/api/save-site-settings", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });

  if (!res.ok) {
    let message = "Ошибка сохранения";
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }

  return settings;
}

// ══════════════════════════════════════════════
//  ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ ДЛЯ ОЦЕНОК
// ══════════════════════════════════════════════

const GRADES_DEF = [
  {
    key:   "rezonans",
    name:  "Резонанс",
    desc:  "Личный фаворит. То, что откликнулось",
    color: "#7c3aed",
  },
  {
    key:   "etalon",
    name:  "Эталон",
    desc:  "Почти безупречное исполнение",
    color: "#2563a8",
  },
  {
    key:   "vyskazyvanie",
    name:  "Отлично",
    desc:  "Достойная работа с посылом",
    color: "#2d8a4e",
  },
  {
    key:   "attrakcion",
    name:  "Аттракцион",
    desc:  "Ярко, бодро, на один вечер",
    color: "#d4a017",
  },
  {
    key:   "fon",
    name:  "Фоновый шум",
    desc:  "Стерильно и вторично",
    color: "#6b7280",
  },
  {
    key:   "brak",
    name:  "Брак",
    desc:  "Технически или сценарно несостоятельно",
    color: "#c0392b",
  },
  {
    key:   "razocharo",
    name:  "Разочарование",
    desc:  "Хороший старт, перечеркнутый бездарным финалом",
    color: "#8B6914",
  },
];

let GRADES      = Object.fromEntries(GRADES_DEF.map(g => [g.key, g]));
let GRADE_ORDER = GRADES_DEF.map(g => g.key);
let TIER_ROWS   = GRADES_DEF.map(g => ({ key: g.key, label: g.name, color: g.color }));

// ── Статусы "до завершения" (секции на вкладке "Главная"). "completed"
//    (Архив) — особый, всегда есть, от него зависит статистика. Остальные
//    три — по умолчанию, но список полностью настраиваемый через
//    /settings-edit (можно переименовать/скрыть/добавить свои, например
//    "Брошено").
const DEFAULT_STATUS_BUCKETS = [
  { key: "current",  label: "В процессе" },
  { key: "onhold",   label: "Отложено" },
  { key: "planning", label: "Планирую" },
];

function activeStatusBuckets() {
  const configured = window.SITE_STATUS_BUCKETS;
  return (configured && configured.length) ? configured : DEFAULT_STATUS_BUCKETS;
}

function gradeScore(key) {
  const idx = GRADE_ORDER.indexOf(key);
  return idx >= 0 ? idx + 1 : null;
}

// ── Шкала оценок — по умолчанию "названия" (то, что уже было). Если в
//    /settings-edit настроена числовая шкала (5/10/100-балльная, звёзды),
//    сырое значение r.grade — число, и его нужно перевести в "полку"
//    (одну из GRADES/TIER_ROWS) через диапазоны. Везде, где раньше читали
//    r.grade напрямую как ключ полки, теперь нужно сначала прогнать через
//    gradeToShelf(r.grade).
function gradeToShelf(rawGrade) {
  if (rawGrade === null || rawGrade === undefined || rawGrade === "") return null;
  const scale = window.SITE_GRADE_SCALE;
  if (!scale || scale.type === "categorical") return rawGrade; // уже ключ полки
  const num = Number(rawGrade);
  if (Number.isNaN(num)) return null;
  for (const shelf of scale.shelves) {
    if (num >= shelf.min && num <= shelf.max) return shelf.key;
  }
  return null;
}

// Пересобирает GRADES/GRADE_ORDER/TIER_ROWS из настроенной шкалы —
// вызывается один раз после того, как site-settings.json загрузится.
function rebuildGradesFromScale() {
  const scale = window.SITE_GRADE_SCALE;
  if (!scale || !scale.shelves || !scale.shelves.length) return; // остаёмся на дефолте
  GRADES = Object.fromEntries(scale.shelves.map(s => [s.key, { key: s.key, name: s.name, desc: s.desc || "", color: s.color }]));
  GRADE_ORDER = scale.shelves.map(s => s.key);
  TIER_ROWS = scale.shelves.map(s => ({ key: s.key, label: s.name, color: s.color }));
}

// ── Типы медиа ─────────────────────────────────
const TYPE_LABELS = {
  anime:   "Аниме",
  manga:   "Манга",
  manhwa:  "Манхва",
  manhua:  "Маньхуа",
  novel:   "Ранобэ",
  movie:   "Фильм",
  show:    "Сериал",
  dorama:  "Дорама",
  book:    "Книга",
  game:    "Игра",
  gacha:   "Гача",
};

// Формы для склонения по числу: [1 штука, 2–4 штуки, 5+ штук]
const TYPE_PLURAL = {
  anime:  ["аниме",              "аниме",               "аниме"],
  manga:  ["манга",              "манги",               "манг"],
  manhwa: ["манхва",             "манхвы",              "манхв"],
  manhua: ["маньхуа",            "маньхуа",             "маньхуа"],
  novel:  ["ранобэ",             "ранобэ",              "ранобэ"],
  movie:  ["фильм",              "фильма",              "фильмов"],
  show:   ["сериал",             "сериала",             "сериалов"],
  dorama: ["дорама",             "дорамы",              "дорам"],
  book:   ["книга",              "книги",               "книг"],
  game:   ["игра",               "игры",                "игр"],
  gacha:  ["гача",               "гачи",                "гач"],
};

// ══════════════════════════════════════════════
//  ТЕГИ
//  Категории:
//    visual  — картинка, звук, стиль
//    plot    — сюжет, структура, нарратив
//    chars   — персонажи, мир, сеттинг
//    special — атмосфера, эмоции, геймплей
//    genre   — жанровые теги
// ══════════════════════════════════════════════

const TAGS_MAP = {

  // ── Визуал / звук ────────────────────────────
  "Топ рисовка":          { cat: "visual",  tip: "Эстетическое наслаждение, детализация на высоте" },
  "Топ визуал":           { cat: "visual",  tip: "Красивая картинка, операторская работа, постановка" },
  "Специфичный стиль":    { cat: "visual",  tip: "Авторский почерк, к которому нужно привыкнуть" },
  "Слабая картинка":      { cat: "visual",  tip: "Бюджетно, криво или слишком упрощённо" },
  "Осты в тему":          { cat: "visual",  tip: "Музыка усиливает сцены" },
  "Один дубль":           { cat: "visual",  tip: "Ощущение непрерывной съёмки, без склеек" },
  "Визуальный нарратив":  { cat: "visual",  tip: "История рассказывается без слов — через образы и детали" },

  // ── Сюжет / нарратив ─────────────────────────
  "Затягивает сразу":         { cat: "plot", tip: "Бодрый старт, невозможно оторваться" },
  "Долгая раскачка":          { cat: "plot", tip: "Нужно перетерпеть начало, чтобы стало интересно" },
  "Сюжетные дыры":            { cat: "plot", tip: "Много логических нестыковок" },
  "Рояли в кустах":           { cat: "plot", tip: "Внезапные спасения и нелепые совпадения" },
  "Стеклище":                 { cat: "plot", tip: "Автор беспощаден к героям и твоим нервам" },
  "Чеховские ружья":          { cat: "plot", tip: "Детали из первых глав выстреливают спустя 100 выпусков" },
  "Слитый финал":             { cat: "plot", tip: "Концовка портит всё" },
  "Сильный финальный акт":    { cat: "plot", tip: "Концовка вытягивает или венчает всё" },
  "Открытый финал":           { cat: "plot", tip: "Намеренно без ответов, додумай сам" },
  "До титров":                { cat: "plot", tip: "Держит в напряжении до конца" },
  "Проседает":                { cat: "plot", tip: "Темп провисает в середине" },
  "Ненадёжный рассказчик":    { cat: "plot", tip: "Не факт что рассказчику можно верить" },
  "Поток сознания":           { cat: "plot", tip: "Нелинейное субъективное изложение" },
  "Документальный стиль":     { cat: "plot", tip: "Хроники, дневники, письма — эффект реальности" },
  "Медленный нарратив":       { cat: "plot", tip: "Атмосфера и детали важнее событий" },
  "Эпический масштаб":        { cat: "plot", tip: "История через поколения, эпохи или целые миры" },
  "Саспенс":                  { cat: "plot", tip: "Напряжение нагнетается без экшена" },
  "Затянутый монтаж":         { cat: "plot", tip: "Мог быть короче — есть лишние сцены" },
  "Сюжет удивил":             { cat: "plot", tip: "Ожидания были ниже результата" },

  // ── Персонажи / мир ──────────────────────────
  "Живые герои":          { cat: "chars", tip: "Персонажи с душой, которым веришь и сопереживаешь" },
  "Картонные чары":       { cat: "chars", tip: "Пустые герои-функции без внятной мотивации" },
  "Крутой протагонист":   { cat: "chars", tip: "Главный герой тащит на себе весь тайтл" },
  "Слабый ГГ":            { cat: "chars", tip: "Главный герой скучный, глупый или раздражающий" },
  "Топ антагонист":       { cat: "chars", tip: "Злодей интереснее или харизматичнее героев" },
  "Актёр тащит":          { cat: "chars", tip: "Харизма исполнителя вытягивает весь материал" },
  "Оригинальный сеттинг": { cat: "chars", tip: "Необычный мир, который интересно изучать" },
  "Дырявый сеттинг":      { cat: "chars", tip: "Декорации без внятного лора и истории" },
  "Лор важнее сюжета":    { cat: "chars", tip: "Мир интереснее происходящих событий" },
  "Нарратив через окружение": { cat: "chars", tip: "Лор спрятан в деталях мира, а не в диалогах" },

  // ── Атмосфера / эмоции / качество ───────────
  "Без кринжа":           { cat: "special", tip: "Выдержанный тон, без неловкого пафоса" },
  "Почти без кринжа":     { cat: "special", tip: "Почти выдержанный тон" },
  "Много кринжа":         { cat: "special", tip: "Неловкие моменты, пафос или странный юмор" },
  "Жесть":                { cat: "special", tip: "Много насилия, крови или безумных поворотов" },
  "Философия":            { cat: "special", tip: "Размышления о смысле бытия и прочего" },
  "Чистый кайф":          { cat: "special", tip: "Читается легко, идеально для расслабления" },
  "Серая мораль":         { cat: "special", tip: "Нет чёткого деления на добро и зло" },
  "Хорни вайб":           { cat: "special", tip: "Много фансервиса, акцент на сексуальности" },
  "Переоценён":           { cat: "special", tip: "Хайп не соответствует реальному качеству" },
  "Недооценён":           { cat: "special", tip: "Прошло мимо незаслуженно" },
  "Тяжело смотреть повторно": { cat: "special", tip: "Слишком больно или скучно при пересмотре" },
  "Лучше в оригинале":    { cat: "special", tip: "Перевод или локализация убивают часть смысла" },
  "Слабая режиссура":     { cat: "special", tip: "Важные моменты не вызывают эмоций" },
  "Абсолют синема":       { cat: "special", tip: "Постановка, катсцены и подача на высоком уровне" },

  // ── Игры ─────────────────────────────────────
  "Автобой":                    { cat: "special", tip: "Игра сама играет в игру лучше тебя" },
  "Душный гринд":               { cat: "special", tip: "Слишком много однообразной рутины" },
  "Мета-дрочево":               { cat: "special", tip: "Без изучения актуальной меты жить тяжело" },
  "Топ боёвка":                 { cat: "special", tip: "Драки приносят удовольствие даже спустя десятки часов" },
  "Вайфугейминг":               { cat: "special", tip: "Персонажи запоминаются дизайном и харизмой" },
  "Скипал диалоги":             { cat: "special", tip: "История не смогла удержать внимание" },
  "Идеальный геймфил":          { cat: "special", tip: "Управление само по себе приносит удовольствие" },
  "Переусложнённые системы":    { cat: "special", tip: "Слишком много механик, легко потеряться" },
  "Короткая и ёмкая":           { cat: "special", tip: "Прошёл за вечер — и не пожалел" },
  "Слабый финальный босс":      { cat: "special", tip: "Финальный босс разочаровал геймплейно или сюжетно" },

  // ── Жанры ────────────────────────────────────
  "Комедия":        { cat: "special", tip: "Юмор — основа или важная часть" },
  "Хоррор":         { cat: "special", tip: "Страх, напряжение, атмосфера ужаса" },
  "Триллер":        { cat: "special", tip: "Саспенс и непредсказуемые повороты" },
  "Детектив":       { cat: "special", tip: "Расследование и разгадка тайны в центре" },
  "Романтика":      { cat: "special", tip: "Любовная линия как основа сюжета" },
  "Драма":          { cat: "special", tip: "Акцент на эмоциях и человеческих конфликтах" },
  "Экшен":          { cat: "special", tip: "Динамика, сражения, адреналин" },
  "Фэнтези":        { cat: "special", tip: "Магия, мифология, выдуманные миры" },
  "Sci-Fi":         { cat: "special", tip: "Наука, технологии, будущее как основа мира" },
  "Киберпанк":      { cat: "special", tip: "Высокие технологии, низкий уровень жизни" },
  "Постапокалипсис":{ cat: "special", tip: "Мир после катастрофы" },
  "Исторический":   { cat: "special", tip: "Реальная историческая эпоха как сеттинг" },
  "Психологический":{ cat: "special", tip: "Акцент на психике, восприятии, манипуляции" },
  "Военный":        { cat: "special", tip: "Война как основной контекст" },
  "Спокон":         { cat: "special", tip: "Спорт и путь к вершине" },
  "Меха":           { cat: "special", tip: "Гигантские роботы и пилоты" },
  "Сэйнэн":         { cat: "special", tip: "Для взрослой аудитории, сложные темы" },
  "Сёнэн":          { cat: "special", tip: "Приключения, дружба, сила воли" },
  "Иммерсивный":    { cat: "special", tip: "Полностью погружает в свой мир и атмосферу" },
  "Роуд-муви":      { cat: "special", tip: "Путешествие как метафора или буквальный сюжет" },
  "Биография":      { cat: "special", tip: "Реальный человек или основано на реальных событиях" },
};

// Снимок встроенных тегов, сделанный до того, как в TAGS_MAP подмешаются
// пользовательские. Нужен редактору тегов: встроенный тег нельзя просто
// удалить из объекта — его удаление и переименование живут в hiddenTags.
const BUILTIN_TAG_NAMES = new Set(Object.keys(TAGS_MAP));

const TAG_CAT_CLASS = {
  visual:  "rtag-visual",
  plot:    "rtag-plot",
  chars:   "rtag-chars",
  special: "rtag-special",
  genre:   "rtag-genre",
};

const CAT_LABELS = {
  visual:  "Визуал / звук",
  plot:    "Сюжет / нарратив",
  chars:   "Персонажи / мир",
  special: "Атмосфера / эмоции",
  genre:   "Жанр",
};

// Ключи встроенных категорий — по той же причине, что и BUILTIN_TAG_NAMES:
// вырезать встроенную категорию из этого файла нельзя, поэтому её
// удаление живёт в hiddenCategories, а переименование — в labels.
const BUILTIN_CAT_KEYS = new Set(Object.keys(CAT_LABELS));

// Заполняется только для пользовательских категорий (у встроенных цвета нет —
// они все выглядят нейтрально). ключ → hex-цвет.
const CAT_COLORS = {};

// Пользовательские теги (добавляются через /settings-edit, хранятся в
// site-settings.json) — подмешиваются в TAGS_MAP, как только теги
// подгрузятся. Событие переотправляем дальше, чтобы страницы вроде
// add.html могли перерисовать список тегов, если он уже был построен.
document.addEventListener("site-labels-ready", () => {
  const custom = window.SITE_CUSTOM_TAGS || {};
  Object.assign(TAGS_MAP, custom);

  // Скрытые теги — тот же приём, что и с типами/ролями: встроенный тег
  // нельзя вырезать из этого файла, поэтому удаление и переименование
  // встроенного тега складывается в hiddenTags, а новое имя (если оно
  // есть) уже пришло выше в customTags.
  for (const name of window.SITE_HIDDEN_TAGS || []) delete TAGS_MAP[name];

  const overrides = window.SITE_LABEL_OVERRIDES || {};

  // Если настроен свой список полок (для любого типа шкалы, включая
  // "Названия") — GRADES/GRADE_ORDER/TIER_ROWS пересобираются из него.
  // Иначе остаёмся на встроенных 7 GRADES_DEF.
  const scale = window.SITE_GRADE_SCALE;
  if (scale && scale.shelves?.length) {
    rebuildGradesFromScale();
  }

  const typeOverrides = overrides.types || {};
  const customTypes = window.SITE_CUSTOM_TYPES || {};
  const hiddenTypes = window.SITE_HIDDEN_TYPES || [];

  Object.assign(TYPE_LABELS, customTypes);
  for (const key of hiddenTypes) delete TYPE_LABELS[key];
  for (const [key, label] of Object.entries(typeOverrides)) {
    if (TYPE_LABELS[key] !== undefined && label) TYPE_LABELS[key] = label;
  }

  // Формы склонения для своих типов (см. addCustomType в /settings-edit) —
  // встроенные типы уже имеют свои формы выше и не переопределяются.
  const customTypePlural = window.SITE_CUSTOM_TYPE_PLURAL || {};
  Object.assign(TYPE_PLURAL, customTypePlural);

  // Свои источники ссылок (добавляются прямо из редактора отзыва, add.html) —
  // подмешиваются в SOURCE_LABELS, как только настройки подгрузятся.
  const customSources = window.SITE_CUSTOM_SOURCES || {};
  Object.assign(SOURCE_LABELS, customSources);

  // Роли персон (в «Любимом») — тот же паттерн, что и у типов: свои
  // роли подмешиваются, скрытые убираются, переименования встроенных
  // применяются.
  const subtypeOverrides = overrides.subtypes || {};
  const customSubtypes = window.SITE_CUSTOM_SUBTYPES || {};
  const hiddenSubtypes = window.SITE_HIDDEN_SUBTYPES || [];
  Object.assign(SUBTYPE_LABELS, customSubtypes);
  for (const key of hiddenSubtypes) delete SUBTYPE_LABELS[key];
  for (const [key, label] of Object.entries(subtypeOverrides)) {
    if (SUBTYPE_LABELS[key] !== undefined && label) SUBTYPE_LABELS[key] = label;
  }

  const catOverrides = overrides.categories || {};
  for (const [key, label] of Object.entries(catOverrides)) {
    if (CAT_LABELS[key] !== undefined && label) CAT_LABELS[key] = label;
  }
  const customCategories = window.SITE_CUSTOM_CATEGORIES || {};
  for (const [key, label] of Object.entries(customCategories)) {
    CAT_LABELS[key] = label;
  }
  // Удалённые категории — после customCategories: свою категорию удаляют
  // прямо из объекта, встроенную вырезать неоткуда, и она приходит сюда.
  for (const key of window.SITE_HIDDEN_CATEGORIES || []) {
    delete CAT_LABELS[key];
    delete CAT_COLORS[key];
  }
  const categoryColors = window.SITE_CATEGORY_COLORS || {};
  for (const [key, color] of Object.entries(categoryColors)) {
    if (color) CAT_COLORS[key] = color;
  }

  document.dispatchEvent(new CustomEvent("tags-map-updated"));
});

const SOURCE_LABELS = {
  teletype: "Teletype",
  other:    "Другое",
};

// ── Роли персон (в «Любимом», тип «Персона») — единственный источник
//    правды: раньше дублировалось в favorites-edit.html и js/favorites.js
//    отдельными копиями, теперь оба места ссылаются сюда. Переименование/
//    скрытие/добавление ролей — из /settings-edit, панель «Типы».
const SUBTYPE_LABELS = {
  actor:    "Актёр",
  director: "Режиссёр",
  author:   "Автор",
  seiyuu:   "Сэйю",
  artist:   "Художник",
  composer: "Композитор",
};
