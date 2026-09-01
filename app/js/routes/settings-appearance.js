// ══════════════════════════════════════════════
//  settings-appearance.js — оформление (переключатель тегов на карточках, палитра темы) — часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям — читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Скрыть теги на всех карточках разом ──
// Переключатель (по образцу .fav-toggle из редактора отзыва, см. CSS в
// index.html) поверх обычного поля отзыва — no_tags_on_card, то же
// самое, что чекбокс «Не показывать теги на карточке» в редакторе
// одного отзыва (add.js). core/api.js (saveReview, _hide_all_card_tags)
// расставляет или снимает этот флаг сразу во всех отзывах одной записью
// в reviews.json — оба направления симметричны: включение и выключение
// действуют на всех одинаково, включая отзывы, где галочку поставили
// вручную через редактор конкретного отзыва. Без подтверждения — это
// переключатель, а не разовое необратимое действие, как раньше: щёлкнул
// не туда, щёлкнул обратно.
//
// Кнопка открывается в состоянии «выключено» и просто делает то, что
// показывает — включение и выключение работают симметрично, а не как
// переключатель с реальным состоянием: если на самом деле уже всё
// скрыто (или уже всё видно), сервер честно вернёт touched: 0, и
// сообщение об этом скажет.
let hideTagsAllOn = false;

function syncHideTagsToggle() {
  const btn = document.getElementById("hide-tags-toggle");
  if (!btn) return;
  btn.classList.toggle("on", hideTagsAllOn);
  btn.setAttribute("aria-pressed", String(hideTagsAllOn));
  document.getElementById("hide-tags-toggle-icon").innerHTML = eyeIcon(hideTagsAllOn);
  document.getElementById("hide-tags-toggle-label").textContent = hideTagsAllOn
    ? i18n("Теги скрыты на всех карточках")
    : i18n("Скрыть теги на всех карточках");
}

async function toggleHideAllCardTags() {
  const statusId = "status-hide-all-card-tags";
  const next = !hideTagsAllOn;
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
    syncHideTagsToggle();
    flashStatus(
      statusId,
      true,
      data.touched
        ? next
          ? i18n("Готово — теги скрыты на {n} карточках.", { n: data.touched })
          : i18n("Готово — теги возвращены на {n} карточках.", { n: data.touched })
        : next
          ? i18n("У всех отзывов теги на карточке уже были скрыты.")
          : i18n("У всех отзывов теги на карточке уже были видны.")
    );
  } catch (e) {
    flashStatus(statusId, false, i18n("Ошибка сети: ") + e.message);
  }
}

// ── Глаз вместо галочки ──
// eyeIcon()/eyeButton() живут в js/utils.js — общие для всех страниц,
// здесь просто зовутся.

// ── Палитра темы ─────────────────────────────
// Цвета темы по умолчанию читаем прямо из подключённых стилей:
// :root в style.css плюс блок [data-skin="…"] в themes.css. Так
// список не приходится дублировать здесь — а именно из-за такой
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
    // Стиль, который theme.js дописывает в <head>, — это уже
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

function renderPalette() {
  const defaults = themeDefaults(selectedTheme);
  const own = themeColors[selectedTheme] || {};
  const box = document.getElementById("paletteList");
  box.innerHTML = PALETTE_ROWS.map((t) => {
    const custom = own[t.key];
    return `<div class="pal-row">
        <input type="color" data-token="${t.key}" value="${custom || defaults[t.key] || "#000000"}">
        <div class="pal-text">
          <div class="pal-name">${t.label}</div>
          <div class="pal-hint">${t.hint}</div>
        </div>
        <button type="button" class="pal-reset" data-reset="${t.key}"${custom ? "" : " hidden"}>${i18n("Цвет темы")}</button>
      </div>`;
  }).join("");

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
// маршрута — revertPalettePreview() выше.
function previewPalette() {
  // Выбор темы/цвета — это клик по кнопке, а не input/change, и
  // делегированный слушатель на #app его не ловит: взводим флаг
  // «есть несохранённое» здесь, там же, где меняется состояние.
  // Раньше это делала обёртка поверх previewPalette в конце файла —
  // тот же эффект, только без переприсваивания функции.
  settingsDirty = true;

  const root = document.documentElement;
  root.setAttribute("data-skin", selectedTheme);
  const own = themeColors[selectedTheme] || {};
  // "important" третьим аргументом — не для красоты: #theme-overrides
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

  // В приложении рамку окна красит Electron, а не CSS — сам он не
  // узнает про смену темы без перезагрузки страницы. Запрос молча
  // проваливается на обычном сайте, где этого адреса нет, — и это
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

