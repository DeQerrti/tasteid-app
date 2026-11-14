// ══════════════════════════════════════════════
//  settings-appearance.js – оформление (переключатель тегов на карточках, палитра темы) – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Скрыть теги на всех карточках разом ──
// Переключатель (по образцу .fav-toggle из редактора отзыва, см. CSS в
// index.html) поверх обычного поля отзыва – no_tags_on_card, то же
// самое, что чекбокс «Не показывать теги на карточке» в редакторе
// одного отзыва (add.js). core/api.js (saveReview, _hide_all_card_tags)
// расставляет или снимает этот флаг сразу во всех отзывах одной записью
// в reviews.json – оба направления симметричны: включение и выключение
// действуют на всех одинаково, включая отзывы, где галочку поставили
// вручную через редактор конкретного отзыва. Без подтверждения – это
// переключатель, а не разовое необратимое действие, как раньше: щёлкнул
// не туда, щёлкнул обратно.
//
// Кнопка открывается в состоянии «выключено» и просто делает то, что
// показывает – включение и выключение работают симметрично, а не как
// переключатель с реальным состоянием: если на самом деле уже всё
// скрыто (или уже всё видно), сервер честно вернёт touched: 0, и
// сообщение об этом скажет.
let hideTagsAllOn = false;
// У части отзывов теги скрыты, у части нет (флаг поставили руками в редакторе
// одного отзыва). Выключатель показывается «посередине», а клик – «показать
// у всех»: из смешанного состояния прятать всё разом никто не просил.
let hideTagsMixed = false;

// Выключатель называется «Показывать теги»: включён – теги видны, поэтому
// флаг no_tags_on_card (hideTagsAllOn) читается наоборот.
function syncHideTagsToggle() {
  const btn = document.getElementById("hide-tags-toggle");
  if (!btn) return;
  btn.setAttribute("aria-checked", hideTagsMixed ? "mixed" : String(!hideTagsAllOn));
  btn.classList.toggle("mixed", hideTagsMixed);
}

async function toggleHideAllCardTags() {
  const statusId = "status-hide-all-card-tags";
  // Прячем только когда сейчас видно у всех; иначе (скрыто у всех или у части) –
  // показываем у всех.
  const next = !hideTagsAllOn && !hideTagsMixed;
  try {
    const res = await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ _hide_all_card_tags: next }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);
    refreshOpenReviewsTab();
    hideTagsAllOn = next;
    hideTagsMixed = false;
    syncHideTagsToggle();
    flashStatus(
      statusId,
      true,
      data.touched
        ? next
          ? i18n("Готово – теги скрыты на {n} карточках.", { n: data.touched })
          : i18n("Готово – теги возвращены на {n} карточках.", { n: data.touched })
        : next
          ? i18n("У всех отзывов теги на карточке уже были скрыты.")
          : i18n("У всех отзывов теги на карточке уже были видны.")
    );
  } catch (e) {
    flashStatus(statusId, false, i18n("Ошибка сети: ") + e.message);
  }
}

// ── Глаз вместо галочки ──
// eyeIcon()/eyeButton() живут в js/utils.js – общие для всех страниц,
// здесь просто зовутся.

// ── Палитра темы ─────────────────────────────
// Цвета темы по умолчанию читаем прямо из подключённых стилей:
// :root в style.css плюс блок [data-skin="…"] в themes.css. Так
// список не приходится дублировать здесь – а именно из-за такой
// копии список тем однажды уже разъехался с реестром.
function themeDefaults(skin) {
  const base = {};
  const themed = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    // Стиль, который theme.js дописывает в <head>, – это уже
    // применённые переопределения, а не значения темы.
    if (sheet.ownerNode && sheet.ownerNode.id === "theme-overrides") continue;
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      const sel = rule.selectorText.replace(/\s+/g, "");
      const target =
        sel === ":root"
          ? base
          : sel === `[data-skin="${skin}"]` || sel === `html[data-skin="${skin}"]`
            ? themed
            : null;
      if (!target) continue;
      for (const { key } of PALETTE_TOKENS) {
        const value = rule.style.getPropertyValue(key).trim();
        if (value) target[key] = value;
      }
    }
  }
  const out = { ...base, ...themed };
  out.accent = (THEME_PRESETS[skin] && THEME_PRESETS[skin].defaultAccent) || DEFAULT_ACCENT;
  return out;
}

const PALETTE_ROWS = [
  ...PALETTE_TOKENS,
  { key: "accent", label: i18n("Акцент"), hint: i18n("Активные кнопки, ссылки, подсветки") },
];

// Цвета по смыслу: девять подряд читались как один длинный список. Токен,
// которого нет ни в одной группе (добавили в PALETTE_TOKENS и забыли здесь),
// попадает в «Другое», а не пропадает из настроек.
const PALETTE_GROUPS = [
  [i18n("Фоны"), ["--bg", "--bg2", "--surface", "--surface2"]],
  [i18n("Линии"), ["--border", "--border2"]],
  [i18n("Текст"), ["--text", "--text-dim", "--text-hi"]],
  [i18n("Акцент"), ["accent"]],
];

// Образец справа от палитры: окно настроек почти закрывает приложение, и
// изменение цвета не на чем было увидеть. Рисуем те же карточки отзывов, что и
// на вкладке «Отзывы» (reviewCard), – они берут цвета из переменных страницы, а
// previewPalette() как раз их и меняет на лету.
function paletteSampleHtml() {
  const list = (cache.reviews || []).filter((r) => r.cover || r.cover_backup);
  const pick = [
    list.find((r) => r.grade === "etalon" && (r.tags || []).length) || list[0],
    list.find((r) => r.grade === "attrakcion" && r !== list[0]) || list[1],
  ].filter(Boolean);
  if (!pick.length) return "";
  return `<div class="pal-sample" aria-hidden="true">
      <div class="pal-sample-title">${i18n("Так выглядит")}</div>
      <div class="pal-sample-cards">${pick.map((r, i) => reviewCard(r, i)).join("")}</div>
      <div class="pal-sample-row">
        <button type="button" class="rv-filter-btn active" tabindex="-1">${i18n("Фильтр")}</button>
        <button type="button" class="rv-filter-btn" tabindex="-1">${i18n("Тип")} ▾</button>
        <span class="rtag rtag-special">${i18n("Тег")}</span>
      </div>
      <div class="pal-sample-text">${i18n("Обычный текст отзыва")} <span>${i18n("и приглушённый")}</span></div>
    </div>`;
}

function renderPalette() {
  const defaults = themeDefaults(selectedTheme);
  const own = themeColors[selectedTheme] || {};
  const box = document.getElementById("paletteList");
  const rowHtml = (t) => {
    const custom = own[t.key];
    return `<div class="pal-row">
        <input type="color" data-token="${t.key}" value="${custom || defaults[t.key] || "#000000"}" aria-label="${t.label}">
        <div class="pal-text">
          <div class="pal-name">${t.label}</div>
          <div class="pal-hint">${t.hint}</div>
        </div>
        <button type="button" class="pal-reset" data-reset="${t.key}"${custom ? "" : " hidden"}>${i18n("Цвет темы")}</button>
      </div>`;
  };
  const byKey = Object.fromEntries(PALETTE_ROWS.map((t) => [t.key, t]));
  const grouped = new Set(PALETTE_GROUPS.flatMap(([, keys]) => keys));
  const groups = [...PALETTE_GROUPS];
  const rest = PALETTE_ROWS.filter((t) => !grouped.has(t.key)).map((t) => t.key);
  if (rest.length) groups.push([i18n("Другое"), rest]);
  box.innerHTML = `<div class="pal-wrap">
      <div class="pal-groups">${groups
        .map(
          ([title, keys]) =>
            `<div class="pal-group"><div class="pal-group-title">${title}</div>${keys.map((k) => rowHtml(byKey[k])).join("")}</div>`
        )
        .join("")}</div>
      ${paletteSampleHtml()}
    </div>`;

  box.querySelectorAll('input[type="color"]').forEach((input) => {
    input.oninput = () => {
      (themeColors[selectedTheme] = themeColors[selectedTheme] || {})[input.dataset.token] = input.value;
      box.querySelector(`[data-reset="${input.dataset.token}"]`).hidden = false;
      previewPalette();
    };
  });
  box.querySelectorAll(".pal-reset").forEach((btn) => {
    btn.onclick = () => {
      if (themeColors[selectedTheme]) delete themeColors[selectedTheme][btn.dataset.reset];
      renderPalette();
      previewPalette();
    };
  });
}

function resetPalette() {
  delete themeColors[selectedTheme];
  renderPalette();
  previewPalette();
}

// Предпросмотр прямо в открытом приложении: инлайновый стиль на <html>
// перебивает и тему, и переопределения из theme.js. Откат при уходе с
// маршрута – revertPalettePreview() выше.
function previewPalette() {
  // Выбор темы/цвета – это клик по кнопке, а не input/change, и
  // делегированный слушатель на #app его не ловит: взводим флаг
  // «есть несохранённое» здесь, там же, где меняется состояние.
  // Раньше это делала обёртка поверх previewPalette в конце файла –
  // тот же эффект, только без переприсваивания функции.
  settingsDirty = true;

  const root = document.documentElement;
  root.setAttribute("data-skin", selectedTheme);
  const own = themeColors[selectedTheme] || {};
  // "important" третьим аргументом – не для красоты: #theme-overrides
  // (theme.js) теперь тоже пишет свои переменные с !important (см. её
  // же комментарий), а обычный инлайн-стиль !important в стилевом
  // блоке не перебивает. Без этого живой предпросмотр здесь просто
  // переставал бы что-либо менять на глаз, стоило странице загрузиться
  // не с чистого кэша.
  for (const { key } of PALETTE_TOKENS) {
    if (own[key]) root.style.setProperty(key, own[key], "important");
    else root.style.removeProperty(key);
  }
  const accent = own.accent || themeDefaults(selectedTheme).accent;
  for (const [key, value] of Object.entries(accentVariants(accent))) {
    root.style.setProperty(key, value, "important");
  }

  // В приложении рамку окна красит Electron, а не CSS – сам он не
  // узнает про смену темы без перезагрузки страницы. Запрос молча
  // проваливается на обычном сайте, где этого адреса нет, – и это
  // нормально, там красить нечего.
  const cs = getComputedStyle(root);
  fetch("/api/app/set-titlebar-colors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bg: cs.getPropertyValue("--bg").trim(),
      symbol: cs.getPropertyValue("--text-dim").trim(),
    }),
  }).catch(() => {});
}

