// ══════════════════════════════════════════════
//  ЛАЙТБОКС – увеличенный просмотр одной картинки
//
//  Карточки в тир-листе (просмотр и редактор персонажей) масштабированы
//  под сетку – ползунком "Размер" (tierlist.js/chars-edit.js), но
//  разглядеть мелкую деталь на карточке в 100-200px не выйдет. Клик по
//  картинке открывает её в исходном размере на весь экран.
//
//  На телефоне под короткое касание уже занято другое: в просмотре –
//  тултип с именем/оценкой (tlBindTooltip в tierlist.js), в редакторе –
//  начало перетаскивания в другой тир (touch-drag.js, удержание 260мс).
//  Поэтому там лайтбокс вызывается ДОЛГИМ нажатием, а не обычным тапом –
//  переключатели живут в самих tierlist.js/chars-edit.js, здесь только
//  сама модалка показа.
//
//  Не переиспользует focus-modal.js (тоже полноэкранная картинка) – та
//  модалка про ВЫБОР точки кадрирования кликом по картинке, здесь же
//  клик по самой картинке ничего не значит – закрывает любой клик (и по
//  картинке, и мимо) и Escape.
//
//  Крестика нет: в Electron он уезжал под полосу окна (её top 0 – тот
//  же угол, где кнопки окна), а нужен не был – owner закрывает кликом.
//  Клик и по самой картинке, а не только мимо: у персонажей с
//  прозрачным фоном картинка занимает почти весь экран, и «мимо» почти
//  не остаётся.
// ══════════════════════════════════════════════

let lightboxEl = null;

function lightboxEnsure() {
  if (lightboxEl) return lightboxEl;
  lightboxEl = document.createElement("div");
  lightboxEl.id = "image-lightbox-overlay";
  lightboxEl.className = "image-lightbox hidden";
  lightboxEl.innerHTML = `<img id="image-lightbox-img" alt="">`;
  document.body.appendChild(lightboxEl);
  lightboxEl.addEventListener("click", () => closeImageLightbox());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightboxEl.classList.contains("hidden")) closeImageLightbox();
  });
  return lightboxEl;
}

function openImageLightbox(src, alt) {
  if (!src) return;
  lightboxEnsure();
  document.getElementById("image-lightbox-img").src = src;
  document.getElementById("image-lightbox-img").alt = alt || "";
  lightboxEl.classList.remove("hidden");
}

function closeImageLightbox() {
  lightboxEl?.classList.add("hidden");
}
