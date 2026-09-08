// ══════════════════════════════════════════════
//  GALLERY-MODAL – общая мини-галерея картинок
//  Общий компонент для обложки отзыва (add-cover.js), персонажей/персон
//  в «Любимом» (favorites-edit.js) и просмотра отзыва (reviews.js) –
//  раньше новая ссылка на обложку тихо стирала предыдущую резервную
//  копию с диска; теперь несколько картинок, когда-либо привязанных к
//  одной записи, живут рядом, а не заменяют друг друга. Модалка
//  открывается кликом по самой обложке/аватарке – показывает все
//  картинки разом, выбор одной делает её текущей, крестик удаляет.
//  Зависит от: utils.js (esc, i18n, confirmDialog), style.css
//  (.modal-overlay/.modal – общая коробка модалок).
// ══════════════════════════════════════════════

let galleryModalEl = null;
let galleryModalState = null;

function galleryModalEnsure() {
  if (galleryModalEl) return galleryModalEl;
  galleryModalEl = document.createElement("div");
  galleryModalEl.className = "modal-overlay hidden";
  galleryModalEl.id = "gallery-modal-overlay";
  galleryModalEl.innerHTML = `
    <div class="modal gallery-modal">
      <button class="modal-close" type="button" onclick="closeGalleryModal()">✕</button>
      <div class="modal-title">${i18n("Галерея")}</div>
      <div class="gallery-modal-grid" id="gallery-modal-grid"></div>
    </div>`;
  document.body.appendChild(galleryModalEl);
  galleryModalEl.onclick = (e) => {
    if (e.target === galleryModalEl) closeGalleryModal();
  };
  return galleryModalEl;
}

// images: string[] относительных путей (в т.ч. активный). active: string.
// onSelect(url) – зовётся сразу по клику на другую картинку (менять
// activeUrl или сохранять на сервере – решает вызывающий код, модалка
// сама ничего не сохраняет). onDelete(url) – async, зовётся после
// подтверждения удаления; вернёт false (или бросит) – элемент из
// галереи не убираем, ошибку показывает сам вызывающий код.
function openGalleryModal({ images, active, onSelect, onDelete, canEdit = true }) {
  if (!images || !images.length) return;
  galleryModalState = { images: [...images], active, onSelect, onDelete, canEdit };
  galleryModalEnsure();
  renderGalleryModalGrid();
  galleryModalEl.classList.remove("hidden");
}

function renderGalleryModalGrid() {
  const grid = document.getElementById("gallery-modal-grid");
  if (!grid || !galleryModalState) return;
  const { images, active, canEdit } = galleryModalState;
  grid.innerHTML = images
    .map(
      (url) => `
    <div class="gallery-modal-item${url === active ? " active" : ""}" data-url="${esc(url)}">
      <img src="${esc(url)}" loading="lazy" alt="">
      ${
        canEdit
          ? `<button type="button" class="gallery-modal-del" title="${i18n("Удалить")}" data-del="${esc(url)}">✕</button>`
          : ""
      }
    </div>`
    )
    .join("");
  grid.querySelectorAll(".gallery-modal-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      const delBtn = e.target.closest(".gallery-modal-del");
      if (delBtn) {
        galleryModalDelete(delBtn.dataset.del);
        return;
      }
      const url = el.dataset.url;
      if (!galleryModalState || url === galleryModalState.active) return;
      galleryModalState.active = url;
      galleryModalState.onSelect?.(url);
      renderGalleryModalGrid();
    });
  });
}

async function galleryModalDelete(url) {
  if (!galleryModalState) return;
  const ok = await confirmDialog(
    i18n("Удалить эту картинку из галереи?"),
    i18n("Удалить"),
    i18n("Отмена")
  );
  if (!ok) return;
  try {
    const removed = await galleryModalState.onDelete?.(url);
    if (removed === false) return;
  } catch (e) {
    alert(i18n("Не удалось удалить: ") + e.message);
    return;
  }
  if (!galleryModalState) return;
  galleryModalState.images = galleryModalState.images.filter((u) => u !== url);
  if (galleryModalState.active === url) {
    galleryModalState.active = galleryModalState.images[0] || null;
    galleryModalState.onSelect?.(galleryModalState.active);
  }
  if (!galleryModalState.images.length) {
    closeGalleryModal();
    return;
  }
  renderGalleryModalGrid();
}

function closeGalleryModal() {
  galleryModalEl?.classList.add("hidden");
  galleryModalState = null;
}
