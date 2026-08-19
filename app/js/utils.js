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
function plural(n, [one, few, many]) {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs >= 11 && abs <= 19) return many;
  if (rem === 1)               return one;
  if (rem >= 2 && rem <= 4)   return few;
  return many;
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
let confirmDialogEl = null;

function confirmDialog(message, okLabel = "Удалить") {
  if (!confirmDialogEl) {
    confirmDialogEl = document.createElement("div");
    confirmDialogEl.id = "confirm-dialog-overlay";
    confirmDialogEl.className = "modal-overlay hidden";
    confirmDialogEl.innerHTML = `
      <div class="modal confirm-dialog">
        <div class="confirm-dialog-text"></div>
        <div class="confirm-dialog-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">Отмена</button>
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
    confirmDialogEl.onclick = (e) => {
      if (e.target === confirmDialogEl) finish(false);
    };
    document.addEventListener("keydown", onKey);
  });
}
