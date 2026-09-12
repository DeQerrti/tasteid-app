// ══════════════════════════════════════════════
//  БЫСТРАЯ ПАНЕЛЬ «ВНЕШНИЙ ВИД» ПО ПРАВОЙ КНОПКЕ
//
//  Размер шрифта и масштаб уже есть в настройках («Оформление» и
//  «Приложение»), но лезть туда ради одной цифры каждый раз – неудобно.
//  Правый клик в любом месте приложения открывает маленькую панель с
//  теми же двумя ползунками прямо под курсором.
//
//  Намеренно НЕ переиспользует applyTextScale()/settingsDirty из
//  settings-tabs.js: та функция с markDirty=true помечает страницу
//  настроек как "есть несохранённые правки" – если поставить это отсюда,
//  а потом просто зайти в «Оформление» и выйти, не тронув ничего,
//  человек увидел бы вопрос про несохранённые изменения на пустом
//  месте. Эта панель сохраняет сама, отдельным вызовом, и в общий
//  "грязный" флаг страницы настроек не пишет вовсе.
//
//  setZoom() из settings-app.js, наоборот, переиспользуется как есть –
//  она и так сохраняет сразу сама, никакого отдельного "грязного"
//  состояния у неё нет.
// ══════════════════════════════════════════════

let qaAppInfo = null; // null – ещё не спрашивали, false – обычный сайт без /api/app/*
let qaMenuEl = null;

// Не перехватываем клик там, где он и так что-то значит: над полем
// ввода (нужен свой контекстный менюшка с "Вставить"/"Копировать" от
// самого браузера) или когда что-то выделено текстом (тот же случай –
// человек наверняка хочет скопировать выделенное, а не крутить масштаб).
function qaShouldIntercept(target) {
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return false;
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed && sel.toString().length) return false;
  return true;
}

async function qaEnsureAppInfo() {
  if (qaAppInfo !== null) return qaAppInfo;
  try {
    const res = await fetch("/api/app/info");
    qaAppInfo = res.ok ? await res.json() : false;
  } catch {
    qaAppInfo = false;
  }
  return qaAppInfo;
}

function qaCurrentTextScale() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--text-scale");
  const n = Math.round(parseFloat(raw) * 100);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

// Тот же диапазон и шаг, что у ползунка в «Оформлении» (settings-edit.js).
function qaApplyTextScale(percent) {
  percent = Math.min(150, Math.max(80, Number(percent) || 100));
  document.documentElement.style.setProperty("--text-scale", percent / 100, "important");
  const label = qaMenuEl?.querySelector("#qa-text-scale-val");
  if (label) label.textContent = percent + "%";
  // Если сейчас открыта сама страница настроек – пусть её собственный
  // ползунок и подпись тоже покажут актуальное число, а не разъедутся
  // с тем, что человек только что покрутил здесь.
  const settingsSlider = document.getElementById("text-scale-slider");
  const settingsLabel = document.getElementById("text-scale-value");
  if (settingsSlider) settingsSlider.value = percent;
  if (settingsLabel) settingsLabel.textContent = percent + "%";
  return percent;
}

async function qaSaveTextScale(percent) {
  try {
    await patchSiteSettings((settings) => {
      settings.textScale = percent;
    });
  } catch {
    // Сеть/диск подвели – значение всё равно уже применено на экране
    // живьём, просто не переживёт перезапуск. Тихо, как и большинство
    // фоновых мелочей в этом приложении (см. её же deleteRemoteMedia
    // в js/sync.js) – мы тут случайно, по правому клику, поднимать
    // тревогу посреди чего-то другого не повод.
  }
}

function qaBuildMenuHtml(info) {
  const scale = qaCurrentTextScale();
  // setZoom() – из settings-app.js, а тот подключён только в самом
  // index.html (панель настроек это отдельный маршрут SPA); в add.html
  // (своя отдельная страница для модалки добавления/правки отзыва) его
  // просто нет, даже если /api/app/info ответил как положено –
  // показывать там ползунок, который нечем применить, незачем.
  const zoomRow =
    info && !info.error && typeof setZoom === "function"
      ? `<div class="qa-row">
          <span class="qa-label">${i18n("Масштаб")}</span>
          <input type="range" id="qa-zoom" min="50" max="200" step="5" value="${info.zoom || 100}">
          <span class="qa-value" id="qa-zoom-val">${Math.round(info.zoom || 100)}%</span>
        </div>`
      : "";
  return `
    <div class="qa-row">
      <span class="qa-label">${i18n("Размер шрифта")}</span>
      <input type="range" id="qa-text-scale" min="80" max="150" step="5" value="${scale}">
      <span class="qa-value" id="qa-text-scale-val">${scale}%</span>
    </div>
    ${zoomRow}
    <button type="button" class="qa-reset" id="qa-reset-btn">${i18n("Сбросить оба")}</button>`;
}

function qaClose() {
  if (!qaMenuEl) return;
  qaMenuEl.remove();
  qaMenuEl = null;
  document.removeEventListener("mousedown", qaOutsideClick, true);
  document.removeEventListener("keydown", qaOnKeydown, true);
}

function qaOutsideClick(e) {
  if (qaMenuEl && !qaMenuEl.contains(e.target)) qaClose();
}

function qaOnKeydown(e) {
  if (e.key === "Escape") qaClose();
}

async function qaOpen(x, y) {
  qaClose();
  const info = await qaEnsureAppInfo();

  qaMenuEl = document.createElement("div");
  qaMenuEl.className = "quick-appearance-menu";
  qaMenuEl.innerHTML = qaBuildMenuHtml(info);
  document.body.appendChild(qaMenuEl);

  // Сначала вставить, потом позиционировать – размеры (offsetWidth и
  // т.п.) для клампа по краю окна известны только у уже вставленного
  // в DOM элемента.
  const menuW = qaMenuEl.offsetWidth;
  const menuH = qaMenuEl.offsetHeight;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);
  qaMenuEl.style.left = Math.max(8, left) + "px";
  qaMenuEl.style.top = Math.max(8, top) + "px";

  const textSlider = qaMenuEl.querySelector("#qa-text-scale");
  textSlider.addEventListener("input", () => qaApplyTextScale(textSlider.value));
  textSlider.addEventListener("change", () => qaSaveTextScale(qaApplyTextScale(textSlider.value)));

  const zoomSlider = qaMenuEl.querySelector("#qa-zoom");
  if (zoomSlider) {
    const zoomVal = qaMenuEl.querySelector("#qa-zoom-val");
    zoomSlider.addEventListener("input", () => {
      zoomVal.textContent = Math.round(zoomSlider.value) + "%";
    });
    zoomSlider.addEventListener("change", () => setZoom(zoomSlider.value));
  }

  qaMenuEl.querySelector("#qa-reset-btn").addEventListener("click", () => {
    textSlider.value = 100;
    qaSaveTextScale(qaApplyTextScale(100));
    if (zoomSlider) {
      zoomSlider.value = 100;
      zoomSlider.dispatchEvent(new Event("input"));
      setZoom(100);
    }
  });

  // capture:true – тот же приём, что и у settingsBackAction в
  // settings-edit.js: должно сработать раньше, чем клик/Escape успеет
  // сделать что-то ещё на странице.
  setTimeout(() => {
    document.addEventListener("mousedown", qaOutsideClick, true);
    document.addEventListener("keydown", qaOnKeydown, true);
  }, 0);
}

document.addEventListener("contextmenu", (e) => {
  if (!qaShouldIntercept(e.target)) return;
  e.preventDefault();
  qaOpen(e.clientX, e.clientY);
});
