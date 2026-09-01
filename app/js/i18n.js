// ══════════════════════════════════════════════
//  ЯЗЫК ИНТЕРФЕЙСА
//  Подключать ПЕРВЫМ — раньше utils.js, theme.js и кода страниц.
//  Ни от чего не зависит.
//
//  Ключ перевода — сам русский текст, как в gettext:
//
//      i18n("Сохранить")                     → "Save"
//      i18n("Удалить «{name}»?", { name })   → "Delete “{name}”?"
//
//  Почему так, а не выдуманные ключи вроде "settings.save": строк в
//  приложении больше тысячи, и на каждую пришлось бы придумать имя,
//  а потом держать в голове связь имени с текстом. С русским текстом
//  в роли ключа код читается как раньше, а пропущенный перевод не
//  ломает ничего — просто остаётся русским. Имя короткое, но не
//  однобуквенное: t уже занято десятками локальных переменных в коде,
//  и глобальная t() в них тихо затенялась. Обратная сторона: правка
//  русского текста тихо теряет перевод, поэтому есть
//  scripts/check-i18n.js — он показывает, что осталось без перевода.
//
//  РАЗМЕТКА переводится атрибутами, без дублирования текста:
//
//      <button data-i18n>Сохранить</button>
//      <input data-i18n-placeholder="Например: Брошено">
//      <button data-i18n-title="Удалить">
//
//  Язык берём синхронно, ещё до разбора остальной страницы — иначе она
//  успела бы моргнуть русским до ответа. В приложении это window.__TASTEID
//  (см. electron/protocol.js — вписывается прямо в HTML перед этим же
//  скриптом), в браузере при разработке через scripts/serve.js — кука,
//  которую там всё ещё ставит настоящий HTTP-ответ (electron/server.js).
// ══════════════════════════════════════════════

const I18N_LANGS = { ru: "Русский", en: "English" };

function i18nLang() {
  if (window.__TASTEID?.lang === "ru" || window.__TASTEID?.lang === "en") {
    return window.__TASTEID.lang;
  }
  const m = /(?:^|;\s*)tasteid_lang=(ru|en)(?:;|$)/.exec(document.cookie || "");
  return m ? m[1] : "ru";
}

const I18N_CURRENT = i18nLang();

// Словарь переводов: русский текст → английский. Русский тут не
// повторяется — он и так в коде, и любая строка без записи ниже просто
// останется русской.
const I18N_EN = {};

function i18nRegister(pairs) {
  Object.assign(I18N_EN, pairs);
}

// {name} в шаблоне подставляется из vars. Именованные, а не позиционные:
// в переводе порядок слов другой, и «первый аргумент» перестаёт значить
// то же самое.
function i18nFill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

function i18n(ru, vars) {
  if (I18N_CURRENT === "ru") return i18nFill(ru, vars);
  const en = I18N_EN[ru];
  return i18nFill(en === undefined ? ru : en, vars);
}

// ── Разметка ───────────────────────────────────
// Переводит статический текст на месте. Вызывается на DOMContentLoaded
// и после любой перерисовки, которая вставляет разметку с data-i18n.
function applyI18n(root) {
  if (I18N_CURRENT === "ru") return;
  const scope = root || document;

  for (const el of scope.querySelectorAll("[data-i18n]")) {
    // Значение атрибута важнее собственного текста: оно нужно там, где
    // текст уже подменён скриптом (счётчики, имена) и исходником
    // служить не может.
    // Переносы и отступы разметки в ключ не входят: иначе перенос
    // строки в HTML тихо ломал бы совпадение со словарём.
    const src = el.getAttribute("data-i18n") || el.textContent.replace(/\s+/g, " ").trim();
    const out = i18n(src);
    if (out !== src || el.getAttribute("data-i18n")) el.textContent = out;
  }
  for (const attr of ["placeholder", "title", "aria-label", "value"]) {
    for (const el of scope.querySelectorAll(`[data-i18n-${attr}]`)) {
      const src = el.getAttribute(`data-i18n-${attr}`) || el.getAttribute(attr) || "";
      if (src) el.setAttribute(attr, i18n(src));
    }
  }
}

// ── Даты ───────────────────────────────────────
// toLocaleDateString по всему приложению звался с жёстким "ru-RU": при
// английском интерфейсе даты оставались русскими, и карточка выходила
// наполовину переведённой. Локаль тут одна на всех — чтобы «12 мар.» и
// «Mar 12» не зависели от того, какой файл рисует дату.
function dateLocale() {
  return I18N_CURRENT === "en" ? "en-GB" : "ru-RU";
}

// ── Число и слово ──────────────────────────────
// В русском три формы (1 / 2–4 / 5+), в английском две. Держим общий
// вызов с русскими тремя формами, а для английского берём первую и
// третью: [book, books, books] — то есть перевод пишется в том же виде,
// что и оригинал, без отдельной ветки на каждом месте вызова.
function i18nPlural(n, forms) {
  const [one, few, many] = forms;
  if (I18N_CURRENT === "en") return Math.abs(n) === 1 ? one : many;
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (rem === 1) return one;
  if (rem >= 2 && rem <= 4) return few;
  return many;
}

// Три формы для слова, введённого человеком (свой тип, своя единица).
// Русскую эвристику склонения в английском применять нельзя — там
// достаточно окончания -s, а для слов на -s/-x/-ch и т.п. — -es.
function i18nGuessPlural(word) {
  const w = String(word || "").trim();
  if (!w) return [w, w, w];
  if (I18N_CURRENT !== "en") return null; // пусть решает guessRussianPlural
  const many = /(s|x|z|ch|sh)$/i.test(w) ? w + "es" : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + "ies" : w + "s";
  return [w, many, many];
}

// ── Смена языка ────────────────────────────────
// Перезагрузка, а не перерисовка: язык читается из куки при разборе
// страницы, и половина подписей уже разошлась по замыканиям и по
// собранной разметке. Перерисовать всё это точно — задача сложнее и
// ненадёжнее, чем открыть страницу заново.
async function setAppLanguage(lang) {
  if (!I18N_LANGS[lang]) return;
  await fetch("/api/app/language", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lang }),
  });
  location.reload();
}

document.documentElement.lang = I18N_CURRENT;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => applyI18n(), { once: true });
} else {
  applyI18n();
}
