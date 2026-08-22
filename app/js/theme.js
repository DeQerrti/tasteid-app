// ══════════════════════════════════════════════
//  THEME — применение цветовой темы и акцентного
//  цвета из site-settings.json поверх :root в style.css
//  Подключать РАНО в <head>, до основного контента —
//  тогда переопределение цветов происходит без "мигания".
// ══════════════════════════════════════════════

// ── Реестр тем ─────────────────────────────────
// Здесь только опись: идентификатор, человеческое название и акцент
// по умолчанию. Сами цвета и визуальный язык каждой темы лежат в
// themes.css, в блоке [data-skin="<id>"].
//
// Раньше палитры были прописаны прямо здесь, объектами, а структурные
// отличия темы — в <style> внутри index.html. Из-за этого тема не
// доходила до страниц админки, а добавление новой означало правку
// разметки. Теперь добавить тему это блок в themes.css плюс строка
// ниже; список в настройках строится по этому реестру, так что его
// тоже трогать не нужно.
//
// defaultAccent подставляется, только если человек не выбрал свой
// акцент вручную.
const THEME_PRESETS = {
  classic: { label: i18n("Классический") },
  "classic-light": { label: i18n("Классический светлый") },
  soft: { label: i18n("Мягкий ботанический"), defaultAccent: "#6b7f4a" },
  "soft-dark": { label: i18n("Мягкий ботанический тёмный"), defaultAccent: "#7fae5a" },
  brutal: { label: i18n("Брутализм"), defaultAccent: "#ff4d00" },
  "brutal-dark": { label: i18n("Брутализм тёмный"), defaultAccent: "#ff4d00" },
  neomorphism: { label: i18n("Неоморфизм"), defaultAccent: "#7c6fe0" },
  "neomorphism-dark": { label: i18n("Неоморфизм тёмный"), defaultAccent: "#8a7bf0" },
  doodle: { label: i18n("Рисованный"), defaultAccent: "#ef6a52" },
  "doodle-dark": { label: i18n("Рисованный тёмный"), defaultAccent: "#ff8a5c" },
};

// Для выпадающих списков и сеток выбора: [{ id, label }]
function themeOptions() {
  return Object.entries(THEME_PRESETS).map(([id, t]) => ({ id, label: t.label }));
}

const DEFAULT_ACCENT = "#8b1a1a"; // текущий --red по умолчанию

// ── Палитра темы ───────────────────────────────
// Девять цветов, из которых собран весь сайт, плюс акцент отдельно.
// Всё остальное — полупрозрачные подсветки, тени, подложки — считается
// от них (см. :root в style.css и accentVariants ниже), поэтому менять
// руками нужно только эти десять.
//
// Список читает экран настроек: добавить сюда строку достаточно, чтобы
// в настройках появился ещё один цвет.
const PALETTE_TOKENS = [
  { key: "--bg", label: i18n("Фон страницы"), hint: i18n("Самый нижний слой") },
  { key: "--bg2", label: i18n("Фон второго уровня"), hint: i18n("Поля ввода, вложенные подложки") },
  { key: "--surface", label: i18n("Блоки и карточки"), hint: i18n("Карточки, панели, модалки") },
  { key: "--surface2", label: i18n("Блоки второго уровня"), hint: i18n("Вкладки, чипы, поле поиска") },
  { key: "--border", label: i18n("Границы"), hint: i18n("Тонкие разделители") },
  { key: "--border2", label: i18n("Границы заметные"), hint: i18n("Рамки кнопок и полей") },
  { key: "--text", label: i18n("Основной текст"), hint: i18n("Тело отзывов и подписи") },
  { key: "--text-dim", label: i18n("Приглушённый текст"), hint: i18n("Даты, вторичные пометки") },
  { key: "--text-hi", label: i18n("Заголовки"), hint: i18n("Названия, яркий текст") },
];

// Строим hi/dim-варианты акцентного цвета через регулировку светлоты (HSL),
// а заливки и рамки — через альфу того же цвета. Из-за этого смена акцента
// перекрашивает и кнопки, и активные фильтры, и подсветки — раньше они
// были литералами rgba(139,26,26,…) и на акцент не реагировали.
function accentVariants(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const alpha = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  return {
    "--red": hex,
    "--red-hi": hslToHex(h, s, Math.min(l + 18, 92)),
    "--red-dim": hslToHex(h, s, Math.max(l - 18, 6)),
    "--accent-wash": alpha(0.08),
    "--accent-fill": alpha(0.15),
    "--accent-fill-hi": alpha(0.25),
    "--accent-line": alpha(0.38),
  };
}

// Цвет из настроек может прийти каким угодно — в CSS он попадает в
// объявление, поэтому пропускаем только настоящий hex.
function isHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

// Свои цвета хранятся отдельно для каждой темы: themeColors[skin].
// Иначе подогнанная под тёмную тему палитра переезжала бы на светлую.
function themePalette(settings, skin) {
  const all = settings.themeColors || {};
  return all[skin] || {};
}

function resolveAccent(settings, skin) {
  const own = themePalette(settings, skin).accent;
  if (isHex(own)) return own;
  // Свой акцент темы важнее старого глобального customAccent: иначе
  // однажды выбранный тёмно-красный тянулся бы за человеком во все темы.
  if (isHex(THEME_PRESETS[skin]?.defaultAccent)) return THEME_PRESETS[skin].defaultAccent;
  if (isHex(settings.customAccent)) return settings.customAccent;
  return DEFAULT_ACCENT;
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.substring(0, 2), 16),
    g: parseInt(m.substring(2, 4), 16),
    b: parseInt(m.substring(4, 6), 16),
  };
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h, s;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function applyTheme() {
  let settings = {};
  try {
    // Абсолютный путь обязателен: перехватчик fetch на телефоне
    // (mobile/src/main.js, installFetch) ловит только запросы,
    // начинающиеся с "/" — относительный путь тихо проходил мимо
    // подмены, улетал в настоящую сеть (которой на телефоне нет для
    // такого адреса) и падал в catch ниже. Тема и все настройки сайта
    // из-за этого молча оставались на умолчаниях.
    const res = await fetch("/site-settings.json");
    if (res.ok) settings = await res.json();
  } catch {
    // нет файла/сети — просто остаёмся на теме и подписях по умолчанию
  }

  // Тема — это один атрибут на <html>; всё остальное делает themes.css.
  const skin = THEME_PRESETS[settings.theme] ? settings.theme : "classic";
  document.documentElement.setAttribute("data-skin", skin);

  // Свои цвета и акцент идут последними, чтобы перебить значения из
  // блока темы. Стиль добавляется в конец <head>, то есть после
  // themes.css — при равной специфичности выигрывает он.
  const palette = themePalette(settings, skin);
  const overrides = {};
  for (const { key } of PALETTE_TOKENS) {
    if (isHex(palette[key])) overrides[key] = palette[key];
  }
  Object.assign(overrides, accentVariants(resolveAccent(settings, skin)));

  const declarations = Object.entries(overrides)
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");

  const style = document.createElement("style");
  // id нужен экрану настроек: он читает значения тем прямо из
  // стилей и должен уметь пропустить уже применённые правки.
  style.id = "theme-overrides";
  style.textContent = `:root { ${declarations} }`;
  document.head.appendChild(style);

  window.SITE_LABELS = mergeLabels(settings.labels);
  window.SITE_LABEL_OVERRIDES = settings.labels || {};
  window.SITE_CUSTOM_TAGS = settings.customTags || {};
  window.SITE_HIDDEN_TAGS = settings.hiddenTags || [];
  window.SITE_CUSTOM_TYPES = settings.customTypes || {};
  window.SITE_HIDDEN_TYPES = settings.hiddenTypes || [];
  window.SITE_CUSTOM_TYPE_PLURAL = settings.customTypePlural || {};
  window.SITE_CUSTOM_SOURCES = settings.customSources || {};
  window.SITE_CUSTOM_CATEGORIES = settings.customCategories || {};
  window.SITE_HIDDEN_CATEGORIES = settings.hiddenCategories || [];
  window.SITE_CATEGORY_COLORS = settings.categoryColors || {};
  window.SITE_GRADE_SCALE = settings.gradeScale || null;
  window.SITE_STATUS_BUCKETS = settings.statusBuckets || null;
  window.SITE_HIDDEN_STATUSES = new Set(settings.hiddenStatuses || []);
  window.SITE_TIER_COLLECTIONS = settings.tierCollections || null;
  window.SITE_FAV_COLLECTIONS = settings.favCollections || [];
  window.SITE_HIDDEN_STATS = new Set(settings.hiddenStatsBlocks || []);
  window.SITE_HIDDEN_FAV_SECTIONS = new Set(settings.hiddenFavSections || []);
  window.SITE_HIDDEN_TIER_MODES = new Set(settings.hiddenTierModes || []);
  // Дальше идёт работа с DOM — ждём, пока разметка вообще появится.
  // Цвета выше применяются сразу, не дожидаясь этого, иначе будет
  // видно мигание темы по умолчанию.
  await domReady();

  applyNavLabels();
  applyTabPreferences(settings);
  applySiteName();

  // Событие шлём последним: к этому моменту и подписи, и порядок вкладок
  // уже на месте, а слушатели (config.js, now.js) точно зарегистрированы —
  // они объявлены в скриптах, которые до DOMContentLoaded успевают
  // выполниться даже если стоят в конце <body>.
  document.dispatchEvent(new CustomEvent("site-labels-ready"));
}

// Промис готовности DOM — чтобы не писать одну и ту же ветку readyState
// по четыре раза.
function domReady() {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) =>
    document.addEventListener("DOMContentLoaded", resolve, { once: true })
  );
}

// ── Порядок вкладок, скрытые вкладки и стартовая вкладка ──
// Всё это настраивается в /settings-edit и хранится в site-settings.json
// (tabOrder / hiddenTabs / mainTab). Раньше публичная страница читала
// только hiddenTabs, а порядок и стартовую вкладку игнорировала —
// настройки сохранялись, но ни на что не влияли.
//
// Итоговую стартовую вкладку кладём в window.SITE_INITIAL_TAB: сама
// активация — за index.html, который знает про switchTab().
function applyTabPreferences(settings) {
  const nav = document.querySelector("nav");
  const buttons = Array.from(document.querySelectorAll("[data-label^='nav.']"));
  if (!buttons.length) return;

  const idOf = (btn) => btn.getAttribute("data-label").split(".")[1];
  const byId = new Map(buttons.map((btn) => [idOf(btn), btn]));
  const hidden = new Set(settings.hiddenTabs || []);

  // Порядок: сначала то, что задано явно, затем всё остальное — в том
  // порядке, в каком оно лежит в разметке. Незнакомые id из настроек
  // игнорируются сами собой (byId.has отсеивает).
  const order = (settings.tabOrder || []).filter((id) => byId.has(id));
  const rest = buttons.map(idOf).filter((id) => !order.includes(id));
  const finalOrder = [...order, ...rest];

  if (nav) finalOrder.forEach((id) => nav.appendChild(byId.get(id)));

  finalOrder.forEach((id) => {
    byId.get(id).hidden = hidden.has(id);
  });

  const visible = finalOrder.filter((id) => !hidden.has(id));
  const wanted = settings.mainTab;
  window.SITE_INITIAL_TAB =
    wanted && visible.includes(wanted) ? wanted : visible[0] || null;
}

// ── Подписи интерфейса ─────────────────────────
// Всё, что человек видит на сайте и может захотеть назвать по-своему.
// Значения по умолчанию лежат здесь, переопределения — в разделе
// «Подписи» в /settings-edit, откуда попадают в site-settings.json.
//
// Смысл в том, чтобы владелец сайта не упирался в чужие формулировки:
// «Шкала послевкусия» хороша для авторской шкалы оценок и странно
// смотрится при 10-балльной, «тайтл» уместен для аниме и не уместен,
// если человек ведёт только книги.
//
// Читать через siteLabel(группа, ключ, запасное значение) — если ключа
// в настройках нет, вернётся значение отсюда.
const DEFAULT_LABELS = {
  nav: { now: i18n("Статусы"), favorites: i18n("Любимое"), reviews: i18n("Отзывы"), stats: i18n("Статистика"), tierlist: i18n("Тир-лист") },
  statuses: { current: i18n("В процессе"), onhold: i18n("Отложено"), planning: i18n("Планирую"), archive: i18n("Архив") },

  // Шапка сайта: name — само название, по умолчанию бренд, но кто
  // угодно может назвать свою копию иначе («Мой список», например);
  // subtitle — строка под ним.
  site: { name: "TasteID", subtitle: i18n("Цифровой паспорт интересов") },

  // Заголовки блоков на вкладке «Любимое»
  sections: {
    favTitles: i18n("Тайтлы"),
    favCharacters: i18n("Персонажи"),
    favPersons: i18n("Персоны"),
    tierTitles: i18n("Тайтлы"),
  },

  // Панель фильтров на вкладке «Отзывы»
  filters: { search: i18n("Поиск"), type: i18n("Тип"), grade: i18n("Оценка"), source: i18n("Ссылки"), all: i18n("Все") },

  // Заголовки блоков статистики
  stats: {
    total: i18n("Всего"),
    completed: i18n("завершено"),
    types: i18n("Разбивка по типам"),
    grades: i18n("Шкала послевкусия"),
    rewatch: i18n("Пересмотры"),
    tags: i18n("Частые теги в отзывах"),
    watchYears: i18n("По годам просмотра"),
    releaseYears: i18n("По годам выхода"),
    // Подпись под числом пересмотров, три формы под склонение
    rewatchOne: i18n("тайтл пересмотрен"),
    rewatchFew: i18n("тайтла пересмотрено"),
    rewatchMany: i18n("тайтлов пересмотрено"),
    // Блок «лучшее за год», {year} подставляется
    spotlightOne: i18n("Тайтл {year} года"),
    spotlightMany: i18n("Тайтлы {year} года"),
    // Когда за выбранный год ничего не завершено
    emptyYear: i18n("За {year} год пока нет завершённых с оценкой"),
  },

  // Общее слово для единицы коллекции — в трёх формах для склонения.
  // Используется там, где тип не важен: «233 тайтла», «12 тайтлов».
  units: { one: i18n("тайтл"), few: i18n("тайтла"), many: i18n("тайтлов") },

  // Тексты, когда показывать нечего
  empty: {
    generic: i18n("Пока пусто"),
    list: i18n("Список пуст"),
    reviews: i18n("Отзывов пока нет."),
    search: i18n("Ничего не найдено"),
  },
};

// Три формы единицы коллекции — удобная обёртка, чтобы не писать
// siteLabel("units", …) по три раза подряд.
function unitForms() {
  return [
    siteLabel("units", "one", DEFAULT_LABELS.units.one),
    siteLabel("units", "few", DEFAULT_LABELS.units.few),
    siteLabel("units", "many", DEFAULT_LABELS.units.many),
  ];
}

function mergeLabels(overrides) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_LABELS));
  if (overrides) {
    for (const group of Object.keys(merged)) {
      if (overrides[group]) Object.assign(merged[group], overrides[group]);
    }
  }
  return merged;
}

// Используется другими скриптами (например, now.js) для чтения подписи
// с учётом переопределений — если SITE_LABELS ещё не загрузился, просто
// отдаёт запасное значение, ничего не ломается.
function siteLabel(group, key, fallback) {
  return (window.SITE_LABELS && window.SITE_LABELS[group] && window.SITE_LABELS[group][key]) || fallback;
}

// Используется stats.js, чтобы решить, показывать ли конкретный блок
// статистики — управляется из /settings-edit.
function isStatVisible(key) {
  return !(window.SITE_HIDDEN_STATS && window.SITE_HIDDEN_STATS.has(key));
}

// Используется favorites.js, чтобы решить, показывать ли раздел
// вкладки «Любимое» — управляется из /settings-edit.
function isFavSectionVisible(key) {
  return !(window.SITE_HIDDEN_FAV_SECTIONS && window.SITE_HIDDEN_FAV_SECTIONS.has(key));
}

// Используется tierlist.js, чтобы решить, показывать ли режим
// тир-листа — управляется из /settings-edit.
function isTierModeVisible(key) {
  return !(window.SITE_HIDDEN_TIER_MODES && window.SITE_HIDDEN_TIER_MODES.has(key));
}

function applyNavLabels() {
  document.querySelectorAll("[data-label]").forEach((el) => {
    const path = el.getAttribute("data-label").split(".");
    let value = window.SITE_LABELS;
    for (const key of path) value = value && value[key];
    if (value) el.textContent = value;
  });
}

// Название на видном месте: шапка каждой страницы («логотип» — тот
// же текст, что ведёт на главную) и вкладка браузера/окна. Меняем
// только когда оно правда переопределено — «TasteID» и так уже
// написан прямо в разметке каждой страницы, трогать DOM без нужды
// незачем.
function applySiteName() {
  const name = siteLabel("site", "name", "TasteID");
  if (name === "TasteID") return;
  document.querySelectorAll(".logo").forEach((el) => {
    el.textContent = name;
  });
  document.title = document.title.replace(/TasteID/g, name);
}

// Промис выставляем наружу: index.html дожидается его, чтобы не рисовать
// первую вкладку до того, как станет известно, какая вкладка стартовая.
// Ошибку глушим — сайт обязан открыться даже без site-settings.json.
window.themeReady = applyTheme().catch((err) => {
  console.warn("[theme] настройки не применились:", err);
});
