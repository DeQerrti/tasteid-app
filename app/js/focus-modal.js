// ══════════════════════════════════════════════
//  FOCUS-MODAL – выбор точки фокуса кадрирования
//  Общий компонент для обложки отзыва (add-cover.js) и картинки
//  персонажа/персоны (favorites-edit.js) – object-fit: cover обрезает
//  прямоугольную/квадратную/круглую иконку по центру картинки, а нужная
//  деталь (лицо, вписанный текст) может оказаться сбоку и обрезаться.
//  Явный выбор точки – через object-position, без реального
//  перекодирования файла: та же картинка на диске, только другая
//  видимая часть.
//  Зависит от: utils.js (i18n), style.css (.modal-overlay/.modal).
// ══════════════════════════════════════════════

let focusModalEl = null;
let focusModalState = null;

function focusModalEnsure() {
  if (focusModalEl) return focusModalEl;
  focusModalEl = document.createElement("div");
  focusModalEl.id = "focus-modal-overlay";
  focusModalEl.className = "modal-overlay hidden";
  focusModalEl.innerHTML = `
    <div class="modal focus-modal">
      <button class="modal-close" type="button" onclick="closeFocusPicker()">✕</button>
      <div class="modal-title">${i18n("Область картинки")}</div>
      <div class="focus-modal-stage" id="focus-modal-stage">
        <img id="focus-modal-img" alt="">
        <div class="focus-modal-marker" id="focus-modal-marker"></div>
      </div>
      <div class="focus-modal-hint">${i18n("Нажмите на картинку, чтобы выбрать центр области.")}</div>
      <div class="focus-modal-preview-wrap">
        <span>${i18n("Предпросмотр:")}</span>
        <div class="focus-modal-preview" id="focus-modal-preview">
          <img id="focus-modal-preview-img" alt="">
        </div>
      </div>
    </div>`;
  document.body.appendChild(focusModalEl);
  focusModalEl.onclick = (e) => {
    if (e.target === focusModalEl) closeFocusPicker();
  };
  document.getElementById("focus-modal-stage").addEventListener("click", (e) => {
    if (!focusModalState) return;
    const stage = document.getElementById("focus-modal-stage");
    const rect = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));
    setFocusModalPosition(x, y);
    focusModalState.onChange?.(`${x}% ${y}%`);
  });
  return focusModalEl;
}

function setFocusModalPosition(x, y) {
  document.getElementById("focus-modal-marker").style.left = x + "%";
  document.getElementById("focus-modal-marker").style.top = y + "%";
  document.getElementById("focus-modal-preview-img").style.objectPosition = `${x}% ${y}%`;
}

// imageUrl: string. initial: "x% y%". shape: "circle"|"square"|"tall" –
// только форма превью-миниатюры внизу (стейдж сверху всегда показывает
// картинку целиком, без обрезки, иначе часть точек была бы недоступна
// для выбора). onChange(pos) зовётся сразу по клику – сохранять или нет
// решает вызывающий код, сама модалка ничего не пишет на диск.
function openFocusPicker({ imageUrl, initial, shape = "square", onChange }) {
  if (!imageUrl) return;
  focusModalEnsure();
  focusModalState = { onChange };
  const img = document.getElementById("focus-modal-img");
  const previewImg = document.getElementById("focus-modal-preview-img");
  const preview = document.getElementById("focus-modal-preview");
  preview.className = "focus-modal-preview focus-modal-preview-" + shape;
  img.src = imageUrl;
  previewImg.src = imageUrl;
  const stage = document.getElementById("focus-modal-stage");
  // Стейдж подгоняется под настоящие пропорции картинки – без этого
  // клик мимо реального изображения (пустые поля object-fit: contain
  // при несовпадении пропорций) считал бы проценты неправильно.
  stage.style.aspectRatio = "1 / 1";
  img.onload = () => {
    if (img.naturalWidth && img.naturalHeight) {
      stage.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    }
  };
  const [x, y] = (initial || "50% 50%").split(" ").map((v) => parseFloat(v));
  setFocusModalPosition(isNaN(x) ? 50 : x, isNaN(y) ? 50 : y);
  focusModalEl.classList.remove("hidden");
}

function closeFocusPicker() {
  focusModalEl?.classList.add("hidden");
  focusModalState = null;
}
