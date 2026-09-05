// ══════════════════════════════════════════════
//  СВАЙП МЕЖДУ РАЗДЕЛАМИ (Статусы/Любимое/Тир-лист)
//
//  Кнопки .tl-mode-btn (см. now.js/favorites.js/tierlist.js) уже
//  переключают раздел по тапу – здесь тот же переход, только по
//  горизонтальному свайпу прямо по содержимому вкладки, без необходимости
//  дотягиваться до самого ряда кнопок наверху. Свайп просто кликает по
//  соседней кнопке – вся остальная логика (перерисовка, RAF-коалессинг
//  быстрых переключений) уже есть у неё самой, дублировать нечего.
//
//  Только на телефоне (то же условие, что и у touch-drag.js) – мышь и
//  так может кликнуть по кнопке напрямую.
// ══════════════════════════════════════════════

(() => {
  if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) return;

  const SWIPE_MIN_DX = 60; // px по горизонтали, чтобы засчитать как свайп
  const SWIPE_MAX_DY_RATIO = 0.6; // вертикаль не должна перевешивать горизонталь – иначе это скролл

  // Только вкладки с переключателем разделов – в остальных (Отзывы,
  // Статистика) свайп ловить незачем, там нечего переключать.
  const SWIPE_TAB_IDS = ["tab-now", "tab-favorites", "tab-tierlist"];

  let startX = null;
  let startY = null;
  let tracking = false;

  // Раздел с малым числом карточек (например почти пустой "Планирую")
  // короче самой вкладки по высоте – а <main> (index.html), внутри
  // которого лежит #tab-now, сам оказывается не выше своего содержимого:
  // растянуть его на весь экран здесь нечем (см. её же разбор в этой
  // сессии), так что ниже короткого списка идёт уже пустое место ВНЕ
  // main. Раньше свайп требовал, чтобы палец касался именно внутри main –
  // и в этом пустом месте просто ничего не находил. Поэтому ищем не
  // "куда попал палец", а "какая вкладка сейчас показана" – и не
  // требуем геометрического попадания вовсе, только явно исключаем
  // места, которые точно не она: саму навигацию и открытые модалки.
  function activeSwipeTab() {
    for (const id of SWIPE_TAB_IDS) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) return el;
    }
    return null;
  }

  function isExcluded(target) {
    // #rail – боковая/нижняя навигация (index.html) – свайп по ней это
    // не переключение раздела. .modal-overlay – открытое поверх всего
    // окно (горячие клавиши, создание тир-листа и т.п.) – скрытые не
    // мешают: элемент с display:none (см. .hidden) touch-события не
    // получает вовсе, closest() до него просто не доберётся.
    return !!(target.closest?.("#rail") || target.closest?.(".modal-overlay"));
  }

  document.addEventListener(
    "touchstart",
    (e) => {
      tracking = false;
      if (e.touches.length !== 1) return;
      if (isExcluded(e.target)) return;
      // Не перехватывать свайп по самому ряду кнопок – он на телефоне
      // (см. её же комментарий у .tl-mode-toggle в index.html)
      // прокручивается горизонтально сам, свайп там должен листать
      // кнопки, а не переключать раздел через одну.
      if (e.target.closest(".tl-mode-toggle")) return;
      const root = activeSwipeTab();
      if (!root || !root.querySelector(".tl-mode-toggle")) return;
      const p = e.touches[0];
      startX = p.clientX;
      startY = p.clientY;
      tracking = true;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      const p = e.changedTouches[0];
      if (!p) return;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_DX) return;
      if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_DY_RATIO) return;

      const root = activeSwipeTab();
      if (!root) return;
      const buttons = [...root.querySelectorAll(".tl-mode-toggle .tl-mode-btn")];
      if (buttons.length < 2) return;
      const idx = buttons.findIndex((b) => b.classList.contains("active"));
      if (idx === -1) return;
      // Влево – "дальше" (следующий раздел появляется так, как в любой
      // карусели), вправо – назад. Без зацикливания: свайп у самого
      // края списка разделов просто ничего не делает, а не перекидывает
      // неожиданно на противоположный конец.
      const next = buttons[dx < 0 ? idx + 1 : idx - 1];
      if (next) next.click();
    },
    { passive: true }
  );
})();
