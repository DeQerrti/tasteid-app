// ══════════════════════════════════════════════
//  CONFIG – все константы в одном месте
//  Менять только здесь, больше нигде
// ══════════════════════════════════════════════

// Заглушки рисуются на месте, а не тянутся с placehold.co –
// см. imagePlaceholder() в js/utils.js (он подключается раньше).
const PH_TALL = imagePlaceholder(300, 420, "?", { bg: "#28211a", fg: "#6b5e4a" });
const PH_SQ   = imagePlaceholder(300, 300, "?", { bg: "#28211a", fg: "#6b5e4a" });

// Глобальный кэш – один объект на всё приложение
const cache = {};

// ── Ленивая загрузка html2canvas-pro ───────────
// Нужна только для двух кнопок экспорта в картинку (тир-лист,
// годовой дайджест статистики) – незачем качать эту библиотеку при
// каждом открытии страницы. Промис кэшируется, так что повторные
// вызовы не грузят скрипт заново.
//
// Файл лежит в составе приложения, а не тянется с CDN. На сайте CDN
// был уместен, здесь – нет: приложение работает с папкой на диске и
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
// но для надёжности всё равно конвертируем в data:-URL – у data:-URL нет
// источника, canvas с ним не "пачкается" вообще, независимо от браузера.
//
// Сперва пробуем забрать картинку напрямую – большинство наших
// источников отдают Access-Control-Allow-Origin: *, и посредник им не
// нужен. Запасной путь – wsrv.nl, публичный image-proxy с хорошей
// репутацией IP: он умеет забирать картинки с GitHub и не блокируется
// ни одним из наших источников. https-URL передаём со схемой, иначе
// wsrv.nl трактует как http.
//
// Возвращает restore() – вызывать в finally, чтобы вернуть оригинальные src.
async function proxyImagesToDataUrls(container) {
  const imgs = Array.from(container.querySelectorAll("img"));
  const toProxy = imgs
    .map(img => ({ img, src: img.getAttribute("src") || "" }))
    .filter(({ src }) => src && !src.startsWith("data:") && !src.startsWith("/"));

  const origSrc = new Map();

  // Предел по времени – без него зависший (не отвечающий вовсе, не
  // «404», а именно молчащий) сервер вешал бы весь экспорт навсегда:
  // у fetch() своего таймаута нет. Тот же класс проблемы, что и у
  // ожидания картинок в waitForImages (js/utils.js), только уже на
  // уровне сетевого запроса, а не браузерной загрузки <img>.
  async function fetchAsDataUrl(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
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
    // Если резервная копия уже когда-то скачана (см. core/api.js,
    // backupCover) – data-fallback у этой же картинки указывает прямо
    // на неё, тем же сервером, что отдаёт страницу. Берём её первой и
    // даже не пытаемся сходить за оригиналом: у AniList есть защита от
    // ботов, которая иногда отсеивает именно такой запрос "из ниоткуда"
    // (без интерактивной страницы вокруг, с другим набором заголовков,
    // чем у обычной картинки на странице) – а сама обложка при этом уже
    // лежит на диске и никуда ходить не нужно. Внешний адрес и wsrv.nl
    // остаются запасным путём – на случай записи без резервной копии
    // вовсе (например, обложка совсем свежая и ещё не успела
    // сохраниться).
    const candidates = img.dataset.fallback
      ? [img.dataset.fallback, src, `https://wsrv.nl/?url=${encodeURIComponent(src)}`]
      : [src, `https://wsrv.nl/?url=${encodeURIComponent(src)}`];
    for (const url of candidates) {
      try {
        const dataUrl = await fetchAsDataUrl(url);
        origSrc.set(img, src);
        img.src = dataUrl;
        return;
      } catch (e) {
        if (url !== src) console.warn(`[proxyImagesToDataUrls] не удалось получить ${src}: ${e.message}`);
      }
    }

    // Ни прямая ссылка, ни прокси не дали картинку – src остаётся
    // недоступным адресом, и html2canvas внутри себя попробует
    // загрузить его сам, своим собственным (не имеющим предела по
    // времени) запросом: недоступный или молчащий сервер повесил бы
    // весь снимок насмерть, уже после того, как этот же цикл честно
    // отработал со своим таймаутом. Подменяем на заглушку (та же,
    // что показывается и на живой странице при сбое) – она всегда
    // под рукой, это data:-URI, никуда не ходит.
    const placeholder = img.dataset.placeholder;
    if (placeholder) {
      origSrc.set(img, src);
      img.src = placeholder;
    }
  }));

  return function restore() {
    origSrc.forEach((src, img) => { img.src = src; });
  };
}

// ── Экранирование HTML ─────────────────────────
// esc() переехал в js/utils.js – он нужен и страницам, которые config.js
// не подключают (reviews-order), и лежать в пяти копиях больше не должен.
// utils.js обязан подключаться раньше config.js.

// ── Признак админа (для UI) ────────────────────
// Входить в приложение не во что и не от кого – папку хранилища открыл
// тот, кому она принадлежит, поэтому админские кнопки есть всегда.
// window.__TASTEID.admin (electron/protocol.js) и кука tasteid_ui,
// которую в браузере при разработке всё ещё ставит scripts/serve.js –
// два способа сообщить об этом же самом факте, оставшиеся с тех пор,
// когда на сайте было настоящее «войти».
function isAdmin() {
  if (window.__TASTEID?.admin) return true;
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
// Полной автоматики для русского языка не существует – слишком много
// исключений (человек → люди, окно → окон). Это чистый черновик:
// правильно угадывает окончания для большинства обычных существительных
// по типовым правилам склонения, но всегда должен оставаться
// редактируемым – вызывающий код показывает результат в трёх полях,
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
  // Существительные на -о/-е (средний род: окно, поле) – самая
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
  // Существительные на -ь – род не определить по написанию (словарь vs
  // тетрадь), берём мужской род как более частый случай.
  if (last === "ь") {
    return [w, base + "я", base + "ей"];
  }
  // Согласная на конце – мужской род (артбук, комикс)
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
// на месте (или вернуть новый – оба варианта поддерживаются).
// Свежие настройки для правки.
//
// Читать выложенный site-settings.json здесь нельзя: он обновляется через
// сборку и раскладку, то есть отстаёт на десятки секунд после каждого
// сохранения. Две правки подряд – и вторая читала старый файл, а
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
    // сеть отвалилась – пробуем выложенную копию ниже
  }
  try {
    const res = await fetch("/site-settings.json", { cache: "no-store" });
    if (res.ok) return await res.json();
  } catch {
    // нет файла/сети – работаем с пустым объектом, как при первом сохранении
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
    name:  i18n("Резонанс"),
    desc:  i18n("Личный фаворит. То, что откликнулось"),
    color: "#7c3aed",
  },
  {
    key:   "etalon",
    name:  i18n("Эталон"),
    desc:  i18n("Почти безупречное исполнение"),
    color: "#2563a8",
  },
  {
    key:   "vyskazyvanie",
    name:  i18n("Отлично"),
    desc:  i18n("Достойная работа с посылом"),
    color: "#2d8a4e",
  },
  {
    key:   "attrakcion",
    name:  i18n("Аттракцион"),
    desc:  i18n("Ярко, бодро, на один вечер"),
    color: "#d4a017",
  },
  {
    key:   "fon",
    name:  i18n("Фоновый шум"),
    desc:  i18n("Стерильно и вторично"),
    color: "#6b7280",
  },
  {
    key:   "brak",
    name:  i18n("Брак"),
    desc:  i18n("Технически или сценарно несостоятельно"),
    color: "#c0392b",
  },
  {
    key:   "razocharo",
    name:  i18n("Разочарование"),
    desc:  i18n("Хороший старт, перечеркнутый бездарным финалом"),
    color: "#8B6914",
  },
];

let GRADES      = Object.fromEntries(GRADES_DEF.map(g => [g.key, g]));
let GRADE_ORDER = GRADES_DEF.map(g => g.key);
let TIER_ROWS   = GRADES_DEF.map(g => ({ key: g.key, label: g.name, color: g.color }));

// ── Статусы "до завершения" (секции на вкладке "Главная"). "completed"
//    (Архив) – особый, всегда есть, от него зависит статистика. Остальные
//    три – по умолчанию, но список полностью настраиваемый через
//    /settings-edit (можно переименовать/скрыть/добавить свои, например
//    "Брошено").
const DEFAULT_STATUS_BUCKETS = [
  { key: "current",  label: i18n("В процессе") },
  { key: "onhold",   label: i18n("Отложено") },
  { key: "planning", label: i18n("Планирую") },
];

function activeStatusBuckets() {
  const configured = window.SITE_STATUS_BUCKETS;
  return (configured && configured.length) ? configured : DEFAULT_STATUS_BUCKETS;
}

function gradeScore(key) {
  const idx = GRADE_ORDER.indexOf(key);
  return idx >= 0 ? idx + 1 : null;
}

// ── Шкала оценок – по умолчанию "названия" (то, что уже было). Если в
//    /settings-edit настроена числовая шкала (5/10/100-балльная, звёзды),
//    сырое значение r.grade – число, и его нужно перевести в "полку"
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

// Пересобирает GRADES/GRADE_ORDER/TIER_ROWS из настроенной шкалы –
// вызывается один раз после того, как site-settings.json загрузится.
function rebuildGradesFromScale() {
  const scale = window.SITE_GRADE_SCALE;
  if (!scale || !scale.shelves || !scale.shelves.length) return; // остаёмся на дефолте
  GRADES = Object.fromEntries(scale.shelves.map(s => [s.key, { key: s.key, name: s.name, desc: s.desc || "", color: s.color }]));
  GRADE_ORDER = scale.shelves.map(s => s.key);
  TIER_ROWS = scale.shelves.map(s => ({ key: s.key, label: s.name, color: s.color }));
}

// ── Типы медиа ─────────────────────────────────
// Единственное место, где перечислены встроенные типы: раньше один и
// тот же список из 11 ключей отдельно жил здесь (label + склонение),
// отдельно в js/stats.js (цвет по умолчанию), отдельно в
// js/tierlist.js и js/routes/add.js (просто список ключей) – четыре
// копии одного и того же набора, и добавить тип руками значило не
// забыть поправить все четыре. TYPE_LABELS/TYPE_PLURAL ниже, TYPE_COLORS
// в stats.js и TYPE_BUILTINS/TL_TYPE_ORDER в add.js/tierlist.js теперь
// собираются из этого массива – новый встроенный тип добавляется одной
// строкой здесь и появляется сразу везде.
//
// Порядок фильтров на вкладке «Отзывы» (js/reviews.js, TYPE_FILTER_ORDER)
// специально другой – это осознанная сортировка под фильтр, не копия
// этого списка, поэтому она осталась отдельным массивом.
// label/plural – сразу через i18n("…") литералом, а не переменной:
// scripts/check-i18n.js ищет непереведённые строки по тексту самого
// вызова i18n("…") и не видит вызов с переменной внутри – тексты
// снаружи этого массива остались бы невидимы проверке.
// color – цвет по умолчанию для диаграмм на вкладке «Статистика»
// (js/stats.js, TYPE_COLORS); «Настройки → Статистика → Цвета по типам»
// перекрашивает поверх него, ключ в ключ, а этот остаётся запасным.
const MEDIA_TYPES = [
  {
    key: "anime",
    label: i18n("Аниме"),
    plural: [i18n("аниме"), i18n("аниме"), i18n("аниме")],
    color: "#8b1a1a",
  },
  {
    key: "manga",
    label: i18n("Манга"),
    plural: [i18n("манга"), i18n("манги"), i18n("манг")],
    color: "#1a4a8b",
  },
  {
    key: "manhwa",
    label: i18n("Манхва"),
    plural: [i18n("манхва"), i18n("манхвы"), i18n("манхв")],
    color: "#2563a8",
  },
  {
    key: "manhua",
    label: i18n("Маньхуа"),
    plural: [i18n("маньхуа"), i18n("маньхуа"), i18n("маньхуа")],
    color: "#4a7abf",
  },
  {
    key: "novel",
    label: i18n("Ранобэ"),
    plural: [i18n("ранобэ"), i18n("ранобэ"), i18n("ранобэ")],
    color: "#5a2d8a",
  },
  {
    key: "movie",
    label: i18n("Фильм"),
    plural: [i18n("фильм"), i18n("фильма"), i18n("фильмов")],
    color: "#1a6b3a",
  },
  {
    key: "show",
    label: i18n("Сериал"),
    plural: [i18n("сериал"), i18n("сериала"), i18n("сериалов")],
    color: "#2d8a52",
  },
  {
    key: "dorama",
    label: i18n("Дорама"),
    plural: [i18n("дорама"), i18n("дорамы"), i18n("дорам")],
    color: "#4aab6e",
  },
  {
    key: "book",
    label: i18n("Книга"),
    plural: [i18n("книга"), i18n("книги"), i18n("книг")],
    color: "#8a4abf",
  },
  {
    key: "game",
    label: i18n("Игра"),
    plural: [i18n("игра"), i18n("игры"), i18n("игр")],
    color: "#8b6914",
  },
  {
    key: "gacha",
    label: i18n("Гача"),
    plural: [i18n("гача"), i18n("гачи"), i18n("гач")],
    color: "#c0a020",
  },
];

const TYPE_LABELS = Object.fromEntries(MEDIA_TYPES.map(t => [t.key, t.label]));

// Формы для склонения по числу: [1 штука, 2–4 штуки, 5+ штук]
const TYPE_PLURAL = Object.fromEntries(MEDIA_TYPES.map(t => [t.key, t.plural]));

// ══════════════════════════════════════════════
//  ТЕГИ
//  Категории:
//    visual  – картинка, звук, стиль
//    plot    – сюжет, структура, нарратив
//    chars   – персонажи, мир, сеттинг
//    special – атмосфера, эмоции, геймплей
//    genre   – жанровые теги
// ══════════════════════════════════════════════

const TAGS_MAP = {

  // ── Визуал / звук ────────────────────────────
  "Топ рисовка":          { cat: "visual",  tip: i18n("Эстетическое наслаждение, детализация на высоте") },
  "Топ визуал":           { cat: "visual",  tip: i18n("Красивая картинка, операторская работа, постановка") },
  "Специфичный стиль":    { cat: "visual",  tip: i18n("Авторский почерк, к которому нужно привыкнуть") },
  "Слабая картинка":      { cat: "visual",  tip: i18n("Бюджетно, криво или слишком упрощённо") },
  "Осты в тему":          { cat: "visual",  tip: i18n("Музыка усиливает сцены") },
  "Один дубль":           { cat: "visual",  tip: i18n("Ощущение непрерывной съёмки, без склеек") },
  "Визуальный нарратив":  { cat: "visual",  tip: i18n("История рассказывается без слов – через образы и детали") },

  // ── Сюжет / нарратив ─────────────────────────
  "Затягивает сразу":         { cat: "plot", tip: i18n("Бодрый старт, невозможно оторваться") },
  "Долгая раскачка":          { cat: "plot", tip: i18n("Нужно перетерпеть начало, чтобы стало интересно") },
  "Сюжетные дыры":            { cat: "plot", tip: i18n("Много логических нестыковок") },
  "Рояли в кустах":           { cat: "plot", tip: i18n("Внезапные спасения и нелепые совпадения") },
  "Стеклище":                 { cat: "plot", tip: i18n("Автор беспощаден к героям и вашим нервам") },
  "Чеховские ружья":          { cat: "plot", tip: i18n("Детали из первых глав выстреливают спустя 100 выпусков") },
  "Слитый финал":             { cat: "plot", tip: i18n("Концовка портит всё") },
  "Сильный финальный акт":    { cat: "plot", tip: i18n("Концовка вытягивает или венчает всё") },
  "Открытый финал":           { cat: "plot", tip: i18n("Намеренно без ответов, додумай сам") },
  "До титров":                { cat: "plot", tip: i18n("Держит в напряжении до конца") },
  "Проседает":                { cat: "plot", tip: i18n("Темп провисает в середине") },
  "Ненадёжный рассказчик":    { cat: "plot", tip: i18n("Не факт что рассказчику можно верить") },
  "Поток сознания":           { cat: "plot", tip: i18n("Нелинейное субъективное изложение") },
  "Документальный стиль":     { cat: "plot", tip: i18n("Хроники, дневники, письма – эффект реальности") },
  "Медленный нарратив":       { cat: "plot", tip: i18n("Атмосфера и детали важнее событий") },
  "Эпический масштаб":        { cat: "plot", tip: i18n("История через поколения, эпохи или целые миры") },
  "Саспенс":                  { cat: "plot", tip: i18n("Напряжение нагнетается без экшена") },
  "Затянутый монтаж":         { cat: "plot", tip: i18n("Мог быть короче – есть лишние сцены") },
  "Сюжет удивил":             { cat: "plot", tip: i18n("Ожидания были ниже результата") },

  // ── Персонажи / мир ──────────────────────────
  "Живые герои":          { cat: "chars", tip: i18n("Персонажи с душой, которым веришь и сопереживаешь") },
  "Картонные чары":       { cat: "chars", tip: i18n("Пустые герои-функции без внятной мотивации") },
  "Крутой протагонист":   { cat: "chars", tip: i18n("Главный герой тащит на себе весь тайтл") },
  "Слабый ГГ":            { cat: "chars", tip: i18n("Главный герой скучный, глупый или раздражающий") },
  "Топ антагонист":       { cat: "chars", tip: i18n("Злодей интереснее или харизматичнее героев") },
  "Актёр тащит":          { cat: "chars", tip: i18n("Харизма исполнителя вытягивает весь материал") },
  "Оригинальный сеттинг": { cat: "chars", tip: i18n("Необычный мир, который интересно изучать") },
  "Дырявый сеттинг":      { cat: "chars", tip: i18n("Декорации без внятного лора и истории") },
  "Лор важнее сюжета":    { cat: "chars", tip: i18n("Мир интереснее происходящих событий") },
  "Нарратив через окружение": { cat: "chars", tip: i18n("Лор спрятан в деталях мира, а не в диалогах") },

  // ── Атмосфера / эмоции / качество ───────────
  "Без кринжа":           { cat: "special", tip: i18n("Выдержанный тон, без неловкого пафоса") },
  "Почти без кринжа":     { cat: "special", tip: i18n("Почти выдержанный тон") },
  "Много кринжа":         { cat: "special", tip: i18n("Неловкие моменты, пафос или странный юмор") },
  "Жесть":                { cat: "special", tip: i18n("Много насилия, крови или безумных поворотов") },
  "Философия":            { cat: "special", tip: i18n("Размышления о смысле бытия и прочего") },
  "Чистый кайф":          { cat: "special", tip: i18n("Читается легко, идеально для расслабления") },
  "Серая мораль":         { cat: "special", tip: i18n("Нет чёткого деления на добро и зло") },
  "Хорни вайб":           { cat: "special", tip: i18n("Много фансервиса, акцент на сексуальности") },
  "Переоценён":           { cat: "special", tip: i18n("Хайп не соответствует реальному качеству") },
  "Недооценён":           { cat: "special", tip: i18n("Прошло мимо незаслуженно") },
  "Тяжело смотреть повторно": { cat: "special", tip: i18n("Слишком больно или скучно при пересмотре") },
  "Лучше в оригинале":    { cat: "special", tip: i18n("Перевод или локализация убивают часть смысла") },
  "Слабая режиссура":     { cat: "special", tip: i18n("Важные моменты не вызывают эмоций") },
  "Абсолют синема":       { cat: "special", tip: i18n("Постановка, катсцены и подача на высоком уровне") },

  // ── Игры ─────────────────────────────────────
  "Автобой":                    { cat: "special", tip: i18n("Игра сама играет в игру лучше вас") },
  "Душный гринд":               { cat: "special", tip: i18n("Слишком много однообразной рутины") },
  "Мета-дрочево":               { cat: "special", tip: i18n("Без изучения актуальной меты жить тяжело") },
  "Топ боёвка":                 { cat: "special", tip: i18n("Драки приносят удовольствие даже спустя десятки часов") },
  "Вайфугейминг":               { cat: "special", tip: i18n("Персонажи запоминаются дизайном и харизмой") },
  "Скипал диалоги":             { cat: "special", tip: i18n("История не смогла удержать внимание") },
  "Идеальный геймфил":          { cat: "special", tip: i18n("Управление само по себе приносит удовольствие") },
  "Переусложнённые системы":    { cat: "special", tip: i18n("Слишком много механик, легко потеряться") },
  "Короткая и ёмкая":           { cat: "special", tip: i18n("Прошёл за вечер – и не пожалел") },
  "Слабый финальный босс":      { cat: "special", tip: i18n("Финальный босс разочаровал геймплейно или сюжетно") },

  // ── Жанры ────────────────────────────────────
  "Комедия":        { cat: "special", tip: i18n("Юмор – основа или важная часть") },
  "Хоррор":         { cat: "special", tip: i18n("Страх, напряжение, атмосфера ужаса") },
  "Триллер":        { cat: "special", tip: i18n("Саспенс и непредсказуемые повороты") },
  "Детектив":       { cat: "special", tip: i18n("Расследование и разгадка тайны в центре") },
  "Романтика":      { cat: "special", tip: i18n("Любовная линия как основа сюжета") },
  "Драма":          { cat: "special", tip: i18n("Акцент на эмоциях и человеческих конфликтах") },
  "Экшен":          { cat: "special", tip: i18n("Динамика, сражения, адреналин") },
  "Фэнтези":        { cat: "special", tip: i18n("Магия, мифология, выдуманные миры") },
  "Sci-Fi":         { cat: "special", tip: i18n("Наука, технологии, будущее как основа мира") },
  "Киберпанк":      { cat: "special", tip: i18n("Высокие технологии, низкий уровень жизни") },
  "Постапокалипсис":{ cat: "special", tip: i18n("Мир после катастрофы") },
  "Исторический":   { cat: "special", tip: i18n("Реальная историческая эпоха как сеттинг") },
  "Психологический":{ cat: "special", tip: i18n("Акцент на психике, восприятии, манипуляции") },
  "Военный":        { cat: "special", tip: i18n("Война как основной контекст") },
  "Спокон":         { cat: "special", tip: i18n("Спорт и путь к вершине") },
  "Меха":           { cat: "special", tip: i18n("Гигантские роботы и пилоты") },
  "Сэйнэн":         { cat: "special", tip: i18n("Для взрослой аудитории, сложные темы") },
  "Сёнэн":          { cat: "special", tip: i18n("Приключения, дружба, сила воли") },
  "Иммерсивный":    { cat: "special", tip: i18n("Полностью погружает в свой мир и атмосферу") },
  "Роуд-муви":      { cat: "special", tip: i18n("Путешествие как метафора или буквальный сюжет") },
  "Биография":      { cat: "special", tip: i18n("Реальный человек или основано на реальных событиях") },
};

// Снимок встроенных тегов, сделанный до того, как в TAGS_MAP подмешаются
// пользовательские. Нужен редактору тегов: встроенный тег нельзя просто
// удалить из объекта – его удаление и переименование живут в hiddenTags.
const BUILTIN_TAG_NAMES = new Set(Object.keys(TAGS_MAP));

const TAG_CAT_CLASS = {
  visual:  "rtag-visual",
  plot:    "rtag-plot",
  chars:   "rtag-chars",
  special: "rtag-special",
  genre:   "rtag-genre",
};

const CAT_LABELS = {
  visual:  i18n("Визуал / звук"),
  plot:    i18n("Сюжет / нарратив"),
  chars:   i18n("Персонажи / мир"),
  special: i18n("Атмосфера / эмоции"),
  genre:   i18n("Жанр"),
};

// Ключи встроенных категорий – по той же причине, что и BUILTIN_TAG_NAMES:
// вырезать встроенную категорию из этого файла нельзя, поэтому её
// удаление живёт в hiddenCategories, а переименование – в labels.
const BUILTIN_CAT_KEYS = new Set(Object.keys(CAT_LABELS));

// Заполняется только для пользовательских категорий (у встроенных цвета нет –
// они все выглядят нейтрально). ключ → hex-цвет.
const CAT_COLORS = {};

// Пользовательские теги (добавляются через /settings-edit, хранятся в
// site-settings.json) – подмешиваются в TAGS_MAP, как только теги
// подгрузятся. Событие переотправляем дальше, чтобы страницы вроде
// add.html могли перерисовать список тегов, если он уже был построен.
document.addEventListener("site-labels-ready", () => {
  const custom = window.SITE_CUSTOM_TAGS || {};
  Object.assign(TAGS_MAP, custom);

  // Скрытые теги – тот же приём, что и с типами/ролями: встроенный тег
  // нельзя вырезать из этого файла, поэтому удаление и переименование
  // встроенного тега складывается в hiddenTags, а новое имя (если оно
  // есть) уже пришло выше в customTags.
  for (const name of window.SITE_HIDDEN_TAGS || []) delete TAGS_MAP[name];

  const overrides = window.SITE_LABEL_OVERRIDES || {};

  // Если настроен свой список полок (для любого типа шкалы, включая
  // "Названия") – GRADES/GRADE_ORDER/TIER_ROWS пересобираются из него.
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

  // Формы склонения для своих типов (см. addCustomType в /settings-edit) –
  // встроенные типы уже имеют свои формы выше и не переопределяются.
  const customTypePlural = window.SITE_CUSTOM_TYPE_PLURAL || {};
  Object.assign(TYPE_PLURAL, customTypePlural);

  // Свои источники ссылок (добавляются прямо из редактора отзыва, add.html) –
  // подмешиваются в SOURCE_LABELS, как только настройки подгрузятся.
  // Порядок – как у типов выше: сперва добавляем свои, потом вырезаем
  // скрытые встроенные, потом накатываем переименования (для скрытого
  // ключа override уже не найдёт его в SOURCE_LABELS и просто ничего
  // не сделает – проверка `!== undefined` ниже).
  const sourceOverrides = overrides.sources || {};
  const customSources = window.SITE_CUSTOM_SOURCES || {};
  const hiddenSources = window.SITE_HIDDEN_SOURCES || [];

  Object.assign(SOURCE_LABELS, customSources);
  for (const key of hiddenSources) delete SOURCE_LABELS[key];
  for (const [key, label] of Object.entries(sourceOverrides)) {
    if (SOURCE_LABELS[key] !== undefined && label) SOURCE_LABELS[key] = label;
  }

  // Роли персон (в «Любимом») – тот же паттерн, что и у типов: свои
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
  // Удалённые категории – после customCategories: свою категорию удаляют
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
  teletype: i18n("Teletype"),
  other:    i18n("Другое"),
};

// ── Роли персон (в «Любимом», тип «Персона») – единственный источник
//    правды: раньше дублировалось в favorites-edit.html и js/favorites.js
//    отдельными копиями, теперь оба места ссылаются сюда. Переименование/
//    скрытие/добавление ролей – из /settings-edit, панель «Типы».
const SUBTYPE_LABELS = {
  actor:    i18n("Актёр"),
  director: i18n("Режиссёр"),
  author:   i18n("Автор"),
  seiyuu:   i18n("Сэйю"),
  artist:   i18n("Художник"),
  composer: i18n("Композитор"),
};
