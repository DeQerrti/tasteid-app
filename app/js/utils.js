// ══════════════════════════════════════════════
//  UTILS — то, что нужно вообще всем страницам
//  Подключать ПЕРВЫМ, до config.js и до кода страниц.
//  Ни от чего не зависит.
// ══════════════════════════════════════════════

// ── Экранирование HTML ─────────────────────────
// Одинарная кавычка экранируется наравне с двойной. Это важно:
// значения подставляются не только в атрибуты с двойными кавычками,
// но и внутрь одинарных — тогда ' позволяет вырваться из значения.
// Раньше эта функция была скопирована в пяти файлах, и правка в одном
// из них не долетала до остальных — теперь она здесь одна.
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Приложение или обычный браузер ─────────────
// /api/app/* отвечает только внутри Electron-приложения — на сайте
// этих адресов нет вообще, оттуда и определяем контекст. Результат не
// меняется за время жизни страницы, поэтому спрашиваем один раз и
// дальше отдаём готовый промис — до этого места три файла делали один
// и тот же запрос каждый по-своему.
let appContextPromise = null;
function isAppContext() {
  if (!appContextPromise) {
    appContextPromise = fetch("/api/app/info")
      .then((res) => res.ok)
      .catch(() => false);
  }
  return appContextPromise;
}

// ── Резервные картинки без inline-обработчиков ─
//
// Было: onerror="imgFallback(this, '<url из данных>', '<заглушка>')" —
// то есть данные попадали прямо в исполняемый код атрибута. Стоило
// одинарной кавычке просочиться в URL, и остаток значения выполнялся
// как JS. Теперь URL едут в обычных data-атрибутах (данные остаются
// данными), а реакцию на сбой загрузки вешает один слушатель на весь
// документ. Заодно это снимает необходимость в 'unsafe-inline' для
// картинок и переживает любую перерисовку innerHTML.
//
// Разметка: <img src="…" data-fallback="…" data-placeholder="…">
// data-fallback можно не указывать — тогда сразу берётся заглушка.
//
// Событие error на <img> не всплывает, поэтому слушаем на фазе
// перехвата (третий аргумент true) — иначе до document оно не дойдёт.
document.addEventListener(
  "error",
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;

    const fallback = img.dataset.fallback;
    const placeholder = img.dataset.placeholder;

    // data-tried не даёт зациклиться, если резервная копия тоже битая
    if (fallback && !img.dataset.tried) {
      img.dataset.tried = "1";
      img.src = fallback;
      return;
    }
    if (placeholder && img.src !== placeholder) {
      img.dataset.tried = "1";
      img.src = placeholder;
      return;
    }
    // Ни копии, ни заглушки — прячем битую иконку, а не показываем её
    if (img.dataset.hideOnError !== undefined) img.style.display = "none";
  },
  true
);

// Готовые атрибуты для <img> — чтобы не расписывать data-* в каждом шаблоне.
// Возвращает строку вида: data-fallback="…" data-placeholder="…"
// Резервная копия подставляется только если основная ссылка вообще была:
// иначе первый же сбой заглушки увёл бы нас на копию по кругу.
function imgFallbackAttrs(primarySrc, backupSrc, placeholder) {
  const parts = [];
  if (primarySrc && backupSrc) parts.push(`data-fallback="${esc(backupSrc)}"`);
  if (placeholder) parts.push(`data-placeholder="${esc(placeholder)}"`);
  return parts.join(" ");
}

// ── Склонение числительных ─────────────────────
// plural(162, ["тайтл", "тайтла", "тайтлов"]) → "тайтла"
// plural(11,  ["тайтл", "тайтла", "тайтлов"]) → "тайтлов"
//
// Лежит здесь, а не в stats.js, где появился впервые: русское «1 записей»
// вылезает всюду, где есть счётчик, а stats.js подключают только те
// страницы, которым нужна статистика.
function plural(n, forms) {
  // Правило выбора формы зависит от языка (в русском три, в английском
  // две), поэтому живёт в i18n.js — здесь только вызов.
  return i18nPlural(n, forms);
}

// ── Подтверждение — в теме сайта, а не окном ОС ────────────────────
// window.confirm() рисует сама операционная система: чужой шрифт, чужое
// скругление, обрезанный текст, — единственное на весь сайт место, где
// это заметно. Один диалог на все страницы: DOM и стили создаются лениво,
// при первом вызове, дальше переиспользуются. Классы .modal-overlay/.modal
// — общие (style.css), поэтому тема и палитра подхватываются сами, без
// отдельной подгонки под каждый скин.
//
// Использование: if (!(await confirmDialog("Удалить «Тег»?"))) return;
// cancelLabel по умолчанию — «Отмена»; она же зовёт эту коробку и для
// диалога обновления (electron/main.js, executeJavaScript) со своими
// подписями — там «Отмена» читалась бы не в тему, поэтому там передают
// «Позже».
let confirmDialogEl = null;

function confirmDialog(message, okLabel = i18n("Удалить"), cancelLabel = i18n("Отмена"), { strict = false } = {}) {
  if (!confirmDialogEl) {
    confirmDialogEl = document.createElement("div");
    confirmDialogEl.id = "confirm-dialog-overlay";
    confirmDialogEl.className = "modal-overlay hidden";
    confirmDialogEl.innerHTML = `
      <div class="modal confirm-dialog">
        <div class="confirm-dialog-text"></div>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel"></button>
          <button type="button" class="btn btn-primary" data-act="ok"></button>
        </div>
      </div>`;
    document.body.appendChild(confirmDialogEl);
  }

  const textEl = confirmDialogEl.querySelector(".confirm-dialog-text");
  const okBtn = confirmDialogEl.querySelector('[data-act="ok"]');
  const cancelBtn = confirmDialogEl.querySelector('[data-act="cancel"]');
  textEl.textContent = message;
  okBtn.textContent = okLabel;
  cancelBtn.textContent = cancelLabel;
  confirmDialogEl.classList.remove("hidden");
  okBtn.focus();

  return new Promise((resolve) => {
    const finish = (result) => {
      confirmDialogEl.classList.add("hidden");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      confirmDialogEl.onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    // Клик по подложке — тот же жест, что и Отмена, а не ОК: случайный
    // клик мимо диалога не должен удалять то, что спросили удалить.
    // В строгом режиме (strict) подложка и Escape вообще не реагируют —
    // для диалогов вроде «доступно обновление», которые могут появиться
    // прямо посреди клика по чему-то другому: иначе тот самый клик,
    // пришедшийся на подложку, тихо считался бы отказом.
    confirmDialogEl.onclick = (e) => {
      if (!strict && e.target === confirmDialogEl) finish(false);
    };
    if (!strict) document.addEventListener("keydown", onKey);
  });
}

// ── Растягиваемая боковая панель ────────────────
// Тот же приём, что в Обсидиане: тонкая полоска у правого края панели
// (#rail на главной, #sidebar в настройках), таскаешь мышью — ширина
// меняется и запоминается в localStorage per-панель, так что при
// следующем открытии остаётся та же. На телефоне полоски нет вовсе
// (см. CSS, display:none в мобильном брейкпоинте) — там подгонять
// нечего, ширина и так на весь экран.
function makeResizablePanel(panel, handle, storageKey, min, max) {
  if (!panel || !handle) return;
  const saved = parseInt(localStorage.getItem(storageKey), 10);
  if (saved && saved >= min && saved <= max) panel.style.width = saved + "px";

  let dragging = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    handle.classList.add("active");
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const w = Math.max(min, Math.min(max, startWidth + (e.clientX - startX)));
    panel.style.width = w + "px";
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("active");
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    localStorage.setItem(storageKey, Math.round(panel.getBoundingClientRect().width));
  });
}

// ── Глаз вместо галочки ─────────────────────────
// Открытый — показано, наведи скажет «Скрыть». Перечёркнутый — спрятано,
// наведи скажет «Показать». Кнопка, а не чекбокс: заодно подпись при
// наведении можно поставить любую, а не то, что браузер сам придумает
// для input. Раньше жила только в settings-edit.html — теперь общая,
// её же зовёт card-tags-list в add.html.
function eyeIcon(hidden) {
  return hidden
    ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.22 4.5M14.12 14.12a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
    : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
}
function eyeButton(hidden, onclickExpr) {
  return `<button type="button" class="icon-btn" title="${hidden ? "Показать" : "Скрыть"}" onclick="${onclickExpr}">${eyeIcon(hidden)}</button>`;
}

// ── Тултипы [data-tip] — общий JS, а не CSS ::after ────────────────
// Раньше подсказка у тега (.rtag) и у оценки (.grade-chip) рисовалась
// чистым CSS: ::after с content: attr(data-tip), position: absolute
// внутри самого элемента. Это ломалось всюду, где элемент лежит внутри
// чего-то с overflow: hidden/auto, — а это ровно то, что нужно карточке
// (.card, ради уголков-декораций) и модалке отзыва (.review-modal-panel,
// ради скролла): подсказка обрезалась по границе контейнера вместо
// того, чтобы вылезти поверх него, как и полагается всплывающей
// подсказке. Один плавающий элемент вне потока страницы, позиционируемый
// в JS, — тот же приём, что уже работает у тултипа тир-листа
// (js/tierlist.js, .tl-tooltip): такому чужой overflow не мешает.
let dataTipEl = null;

function dataTipEnsure() {
  if (!dataTipEl) {
    dataTipEl = document.createElement("div");
    dataTipEl.className = "data-tip-tooltip hidden";
    document.body.appendChild(dataTipEl);
  }
  return dataTipEl;
}

function dataTipPosition(target, tip) {
  const r = target.getBoundingClientRect();
  const centered = !target.classList.contains("grade-chip");
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let x = centered ? r.left + r.width / 2 - tw / 2 : r.left;
  let y = r.top - th - 8;
  if (y < 4) y = r.bottom + 8; // не помещается сверху — показываем снизу
  x = Math.max(4, Math.min(x, window.innerWidth - tw - 4));
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

document.addEventListener("mouseover", (e) => {
  const target = e.target.closest("[data-tip]");
  if (!target || !target.getAttribute("data-tip")) return;
  const tip = dataTipEnsure();
  tip.textContent = target.getAttribute("data-tip");
  tip.classList.toggle("data-tip-tooltip--grade", target.classList.contains("grade-chip"));
  tip.classList.remove("hidden");
  dataTipPosition(target, tip);
});

document.addEventListener(
  "mouseout",
  (e) => {
    const target = e.target.closest("[data-tip]");
    if (!target || !dataTipEl) return;
    // relatedTarget внутри той же подсказки-цели — не уход, а переход
    // между дочерними узлами (например, счётчиком внутри .stat-tag).
    if (target.contains(e.relatedTarget)) return;
    dataTipEl.classList.add("hidden");
  },
  true
);

// ── Настоящая клавиатурная навигация, не любой keydown ─────────
// У браузерного :focus-visible есть подвох: он включается от ЛЮБОЙ
// клавиши, нажатой пока элемент в фокусе — даже голого Shift без
// всякой навигации. Кликнул мышью по карточке отзыва или по крестику
// модалки, потом нажал что угодно с клавиатуры — и вокруг элемента
// расцветает рамка, хотя человек её не просил и не Tab'ался туда.
// html.kb-nav — свой, честный признак: единственное, что его
// включает — клавиша Tab, единственное, что выключает — любой клик
// мышью. CSS ниже (см. .review-card-wrap, .review-modal-close в
// index.html) реагирует на него вместо :focus-visible.
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.documentElement.classList.add("kb-nav");
}, true);
document.addEventListener("mousedown", () => {
  document.documentElement.classList.remove("kb-nav");
}, true);

// ── Esc закрывает открытое — общее для всех страниц ────────────
// Каждая страница успела обзавестись своим способом закрыть открытое:
// у модалок (.modal-overlay, .review-modal-overlay) — клик по подложке
// (onclick="closeXOnOverlay(event)" или прямой addEventListener с тем
// же условием e.target === overlay), у выпадающих списков в add.html
// (.src-type-dropdown — «выпадающие списки с инлайн-добавлением») —
// свои closeXDropdown(). Вместо того чтобы заводить третий похожий
// обработчик на каждой новой странице, один слушатель здесь: клик по
// самой подложке синтетический (совпадает с условием в её же
// обработчике, так что закрывается по-настоящему, а не просто прячется
// класс), а closeXDropdown() зовутся, только если страница их вообще
// определила — на страницах без такого выпадающего списка это просто
// no-op. inline-переименование (startRenameTypePicker и т.п.) само
// останавливает всплытие на Escape, так что до этого слушателя не
// доходит и не мешает отмене прямо в поле.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  document
    .querySelectorAll(".modal-overlay:not(.hidden), .review-modal-overlay:not(.hidden)")
    .forEach((overlay) => overlay.click());
  ["closeTypeDropdown", "closeTypePickerDropdown", "closeStatusPickerDropdown"].forEach((fn) => {
    if (typeof window[fn] === "function") window[fn]();
  });
});

// ── Esc уходит со страницы — общее для страниц-редакторов ──────
// add.html, settings-edit.html, backup-history.html и подобные
// открываются только кликом из главной, и раньше единственным
// выходом была стрелка в шапке — с клавиатуры никак. Учитывает уже
// открытые модалки и выпадающие списки: тем Escape сначала просто
// закрывает их (см. общий обработчик выше), страницу это не покидает.
function enableEscapeToLeave(extraOpenSelector) {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const selector = [".modal-overlay:not(.hidden)", ".review-modal-overlay:not(.hidden)", extraOpenSelector]
      .filter(Boolean)
      .join(", ");
    if (document.querySelector(selector)) return;
    location.href = "/";
  });
}

// ── Горячие клавиши — общий список и биндинги ──
// Один источник для подсказки по «?» на главной (index.html) и для
// справочной панели в настройках (settings-edit.html) — чтобы правка
// одного списка не расходилась с другим. Сами обработчики клавиш
// живут в index.html — там же, где вкладки и модалки, которыми они
// управляют; здесь только то, что выводится человеку на экран, и
// сами биндинги — общие для чтения и там, и там.
//
// Биндинг хранится по коду физической клавиши (e.code), а не по
// символу (e.key): «/» и «?» на многих раскладках вообще не
// печатаются, а код клавиши не зависит от раскладки. label — как эта
// клавиша называлась в момент, когда её нажали при перебиндинге,
// нужен только для подписи, в сравнении не участвует.
const DEFAULT_KEYBINDINGS = {
  search:    { code: "Slash", shift: false, label: "/" },
  newReview: { code: "KeyN",  shift: false, label: "N" },
  shortcuts: { code: "Slash", shift: true,  label: "?" },
};

function currentKeybindings() {
  const saved = window.SITE_KEYBINDINGS || {};
  const out = {};
  for (const action of Object.keys(DEFAULT_KEYBINDINGS)) {
    const b = saved[action];
    out[action] = b && b.code ? b : DEFAULT_KEYBINDINGS[action];
  }
  return out;
}

function keyBindingLabel(b) {
  return (b.shift ? "Shift+" : "") + (b.label || b.code);
}

function keyBindingMatches(e, b) {
  return e.code === b.code && e.shiftKey === !!b.shift;
}

function keyboardShortcutsList() {
  const kb = currentKeybindings();
  return [
    { keys: ["1", "5"], range: true, desc: i18n("Переключить вкладку") },
    { action: "search", keys: [keyBindingLabel(kb.search)], desc: i18n("Поиск в «Отзывах»") },
    { action: "newReview", keys: [keyBindingLabel(kb.newReview)], desc: i18n("Новый отзыв"), adminOnly: true },
    { action: "shortcuts", keys: [keyBindingLabel(kb.shortcuts)], desc: i18n("Список горячих клавиш") },
    { keys: ["Esc"], desc: i18n("Закрыть окно") },
  ];
}
// editable — только для панели «Горячие клавиши» в настройках: рядом с
// перебиндиваемыми строками рисует кнопку «Изменить». В подсказке по
// «?» на главной этого не должно быть — там просто справка.
// Строка «1–5 Переключить вкладку» там же, в настройках, скрыта —
// ниже есть отдельный раздел «Переключение вкладок» с тем же самым,
// плюс своими биндингами; дублировать нечего. В подсказке «?» на
// главной остаётся — там это единственное быстрое упоминание,
// заходить в настройки ради него не всегда нужно.
function keyboardShortcutsHtml(editable) {
  const admin = typeof isAdmin === "function" && isAdmin();
  return keyboardShortcutsList()
    .filter((s) => !s.adminOnly || admin)
    .filter((s) => !editable || !s.range)
    .map((s) => {
      const keys = s.range
        ? `<span class="kbd">${esc(s.keys[0])}</span>–<span class="kbd">${esc(s.keys[1])}</span>`
        : s.keys.map((k) => `<span class="kbd">${esc(k)}</span>`).join("");
      const editBtn = editable && s.action
        ? `<button type="button" class="btn-mini" data-rebind="${s.action}" onclick="startRebindShortcut('${s.action}', this)">${i18n("Изменить")}</button>`
        : "";
      return `<div class="shortcut-row"><span class="shortcut-keys">${keys}</span><span class="shortcut-desc">${esc(s.desc)}</span>${editBtn}</div>`;
    })
    .join("");
}

// ── Перебиндинг — только в настройках ──────────
// «Изменить» переводит кнопку в режим ожидания следующей клавиши;
// Escape отменяет, любая другая клавиша (кроме голых модификаторов)
// сохраняется. Совпадение с уже занятой комбинацией — отказ, а не
// молчаливая замена: два действия на одной клавише работали бы как
// повезёт, в зависимости от порядка проверки в обработчике.
let rebindingAction = null;
async function startRebindShortcut(action, btn) {
  if (rebindingAction) return; // уже ждём другую клавишу — не начинать вторую одновременно
  rebindingAction = action;
  const prevLabel = btn.textContent;
  btn.textContent = i18n("Нажмите клавишу…");
  btn.disabled = true;

  const finish = async (result) => {
    document.removeEventListener("keydown", onKey, true);
    rebindingAction = null;
    if (result) {
      const kb = currentKeybindings();
      const clash = Object.entries(kb).find(([a, b]) => a !== action && b.code === result.code && !!b.shift === result.shift);
      if (clash) {
        backupToastGlobal(i18n("Эта клавиша уже занята другим действием."), false);
      } else {
        try {
          await patchSiteSettings((settings) => {
            settings.keyBindings = { ...(settings.keyBindings || {}), [action]: result };
          });
          window.SITE_KEYBINDINGS = { ...(window.SITE_KEYBINDINGS || {}), [action]: result };
        } catch (e) {
          backupToastGlobal(e.message, false);
        }
      }
    }
    if (typeof window.refreshShortcutsPanel === "function") window.refreshShortcutsPanel();
    else { btn.textContent = prevLabel; btn.disabled = false; }
  };

  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return finish(null);
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; // ждём настоящую клавишу дальше
    finish({ code: e.code, shift: e.shiftKey, label: e.key.length === 1 ? e.key.toUpperCase() : e.key });
  };
  document.addEventListener("keydown", onKey, true);
}
// Тост есть не на каждой странице (собственный backupToast — только у
// backup-history.js) — здесь свой минимальный, без зависимости.
function backupToastGlobal(text, ok) {
  const el = document.createElement("div");
  el.className = "toast " + (ok ? "ok" : "err");
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Переключение вкладок — своя клавиша или кнопка мыши ────────
// По умолчанию вкладки переключаются цифрами 1–5 по видимой позиции
// (сама адаптируется к скрытым вкладкам — см. index.html). Здесь —
// необязательная привязка ПОВЕРХ цифр: конкретная клавиша или кнопка
// мыши на конкретную вкладку по её id, а не по позиции, поэтому не
// требует отдельной адаптации при скрытии других вкладок.
const TAB_IDS = ["now", "favorites", "reviews", "stats", "tierlist"];

function currentTabKeyBindings() {
  return window.SITE_TAB_KEYBINDINGS || {};
}

function tabBindingLabel(b) {
  if (!b) return "";
  if (b.type === "mouse") return b.label;
  return (b.shift ? "Shift+" : "") + (b.label || b.code);
}

function tabBindingMatchesKey(e, b) {
  return !!b && b.type === "key" && e.code === b.code && e.shiftKey === !!b.shift;
}

function tabBindingMatchesMouse(e, b) {
  return !!b && b.type === "mouse" && e.button === b.button;
}

function tabSwitchBindingsHtml() {
  const bindings = currentTabKeyBindings();
  return TAB_IDS.map((id) => {
    const label = typeof window.siteLabel === "function" ? window.siteLabel("nav", id, id) : id;
    const b = bindings[id];
    const current = b
      ? `<span class="kbd">${esc(tabBindingLabel(b))}</span>`
      : `<span class="shortcut-desc">${esc(i18n("не задано"))}</span>`;
    const clearBtn = b
      ? `<button type="button" class="btn-mini" onclick="clearTabKeyBinding('${id}')">${i18n("Очистить")}</button>`
      : "";
    return `<div class="shortcut-row">
      <span class="shortcut-keys">${current}</span>
      <span class="shortcut-desc">${esc(label)}</span>
      <button type="button" class="btn-mini" data-rebind-tab="${id}" onclick="startRebindTabKey('${id}', this)">${i18n("Изменить")}</button>
      ${clearBtn}
    </div>`;
  }).join("");
}

async function clearTabKeyBinding(id) {
  try {
    const bindings = { ...currentTabKeyBindings() };
    delete bindings[id];
    await patchSiteSettings((settings) => {
      settings.tabKeyBindings = bindings;
    });
    window.SITE_TAB_KEYBINDINGS = bindings;
  } catch (e) {
    backupToastGlobal(e.message, false);
  }
  if (typeof window.refreshTabKeyBindingsPanel === "function") window.refreshTabKeyBindingsPanel();
}

// «Изменить» слушает и клавиатуру, и мышь одновременно — что сработает
// первым, то и биндится. Левая кнопка мыши не биндится вообще: ей
// открывают эту же панель и жмут другие кнопки, отличить намеренный
// клик по действию от «выбираю мышь как биндинг» было бы нечем.
let rebindingTabAction = null;
async function startRebindTabKey(tabId, btn) {
  if (rebindingTabAction) return;
  rebindingTabAction = tabId;
  const prevLabel = btn.textContent;
  btn.textContent = i18n("Нажмите клавишу или кнопку мыши…");
  btn.disabled = true;

  const finish = async (result) => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onMouse, true);
    rebindingTabAction = null;
    if (result) {
      const bindings = currentTabKeyBindings();
      const clash = Object.entries(bindings).find(
        ([id, b]) =>
          id !== tabId &&
          ((result.type === "key" && tabBindingMatchesKey(result, b)) ||
            (result.type === "mouse" && tabBindingMatchesMouse(result, b)))
      );
      if (clash) {
        backupToastGlobal(i18n("Эта клавиша уже занята другой вкладкой."), false);
      } else {
        try {
          const next = { ...bindings, [tabId]: result };
          await patchSiteSettings((settings) => {
            settings.tabKeyBindings = next;
          });
          window.SITE_TAB_KEYBINDINGS = next;
        } catch (e) {
          backupToastGlobal(e.message, false);
        }
      }
    }
    if (typeof window.refreshTabKeyBindingsPanel === "function") window.refreshTabKeyBindingsPanel();
    else { btn.textContent = prevLabel; btn.disabled = false; }
  };

  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return finish(null);
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    finish({ type: "key", code: e.code, shift: e.shiftKey, label: e.key.length === 1 ? e.key.toUpperCase() : e.key });
  };
  const onMouse = (e) => {
    if (e.button === 0) return; // левая — обычный клик по панели, не биндинг
    e.preventDefault();
    e.stopPropagation();
    const names = { 1: i18n("Средняя кнопка"), 3: i18n("Кнопка «Назад»"), 4: i18n("Кнопка «Вперёд»") };
    finish({ type: "mouse", button: e.button, label: names[e.button] || i18n("Кнопка мыши {n}", { n: e.button }) });
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onMouse, true);
}
