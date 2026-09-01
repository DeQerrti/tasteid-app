// ══════════════════════════════════════════════
//  РОУТ #/reviews-order – редактор порядка «Любимого»
//  Первая страница, переведённая на роутер (см. план перехода на
//  SPA, фаза 2) – самая маленькая и наименее связанная с остальными.
//
//  Логика перенесена из app/reviews-order.html как есть (сам файл
//  удалён в фазе 4 – прямых ссылок на него не осталось нигде).
//  Единственное отличие
//  по существу: всё завёрнуто в IIFE, а не объявлено на верхнем
//  уровне – иначе титлы вроде render()/init() рано или поздно
//  столкнутся с чем-то из общей области видимости index.html (см.
//  предупреждение в router.js и в scripts/check-duplicate-functions.js).
//  Слушатели событий регистрируются через on(), а не напрямую – так
//  unmount() снимает их все разом, и они не продолжают работать после
//  ухода с этого маршрута (проверено вручную – см. тело PR).
// ══════════════════════════════════════════════
(function () {
  const TYPE_LABELS = {
    anime: i18n("Аниме"),
    manga: i18n("Манга"),
    manhwa: i18n("Манхва"),
    manhua: i18n("Маньхуа"),
    novel: i18n("Ранобэ"),
    movie: i18n("Фильм"),
    show: i18n("Сериал"),
    dorama: i18n("Дорама"),
    book: i18n("Книга"),
    game: i18n("Игра"),
    gacha: i18n("Гача"),
  };

  let titles = [];
  let dragSrc = null;
  let cleanupFns = [];
  let root = null;

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanupFns.push(() => target.removeEventListener(type, handler, opts));
  }

  function onKeydown(handler) {
    on(document, "keydown", handler);
  }

  async function mount(container) {
    root = container;
    root.innerHTML = `
      <header class="app-topbar">
        <a href="#" class="logo topbar-back" id="ro-back"><span class="arrow">&larr;</span>TasteID</a>
        <h1 class="topbar-title" data-i18n>Редактор порядка</h1>
      </header>
      <main class="ro-view">
        <div id="ro-content">
          <div class="state-box"><div class="spinner"></div>${i18n("Загружаем…")}</div>
        </div>
      </main>`;

    on(document.getElementById("ro-back"), "click", (e) => {
      e.preventDefault();
      leaveRoute();
    });
    onKeydown((e) => {
      if (e.key === "Escape" && !document.querySelector(".modal-overlay:not(.hidden)")) {
        leaveRoute();
      }
    });

    await load();
  }

  function unmount() {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    titles = [];
    dragSrc = null;
    root = null;
  }

  async function load() {
    try {
      const res = await fetch("/reviews.json?_=" + Date.now());
      const data = await res.json();
      titles = data
        .filter((r) => r.favorite === true)
        .sort((a, b) => (a.fav_order ?? 9999) - (b.fav_order ?? 9999));
      render();
    } catch (e) {
      const content = document.getElementById("ro-content");
      if (content) content.innerHTML = `<div class="state-box">Ошибка загрузки: ${e.message}</div>`;
    }
  }

  function render() {
    const content = document.getElementById("ro-content");
    if (!content) return;

    if (!titles.length) {
      content.innerHTML = `<div class="state-box">${i18n("Нет тайтлов с флагом «Любимое».")}<br>
        <span style="font-size:.85rem">${i18n("Отметьте тайтлы в редакторе отзыва.")}</span></div>`;
      return;
    }

    const PH = imagePlaceholder(120, 180);
    const items = titles
      .map((r, i) => {
        const cover = r.cover || PH;
        const label = TYPE_LABELS[r.type] || r.type || "–";
        return `<div class="dnd-item" draggable="true" data-id="${r.id}">
          <div class="dnd-item-num">${i + 1}</div>
          <img src="${esc(cover)}" alt="${esc(r.title)}"
            loading="lazy" ${imgFallbackAttrs(r.cover, r.cover_backup, PH)}>
          <div class="dnd-item-body">
            <div class="dnd-item-title">${esc(r.title)}</div>
            <div class="dnd-item-type">${esc(label)}</div>
          </div>
        </div>`;
      })
      .join("");

    content.innerHTML = `
      <h2 class="section-title">${i18n("Тайтлы")}</h2>
      <p class="hint">${i18n("Перетащите карточки, чтобы изменить порядок. Нажмите «Сохранить», когда готово.")}</p>
      <div class="dnd-grid" id="ro-grid">${items}</div>
      <div class="save-bar">
        <button class="btn-save" id="ro-btn-save">${i18n("Сохранить порядок")}</button>
        <span class="save-status" id="ro-save-status"></span>
      </div>`;

    on(document.getElementById("ro-btn-save"), "click", save);
    bindDnd();
  }

  function bindDnd() {
    const grid = document.getElementById("ro-grid");
    if (!grid) return;

    on(grid, "dragstart", (e) => {
      dragSrc = e.target.closest(".dnd-item");
      if (!dragSrc) return;
      dragSrc.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    on(grid, "dragend", () => {
      grid.querySelectorAll(".dnd-item").forEach((el) => el.classList.remove("dragging", "drag-over"));
      dragSrc = null;
      updateNumbers();
    });

    on(grid, "dragover", (e) => {
      e.preventDefault();
      const target = e.target.closest(".dnd-item");
      if (!target || target === dragSrc) return;
      grid.querySelectorAll(".dnd-item").forEach((el) => el.classList.remove("drag-over"));
      target.classList.add("drag-over");
    });

    on(grid, "dragleave", (e) => {
      const target = e.target.closest(".dnd-item");
      if (target) target.classList.remove("drag-over");
    });

    on(grid, "drop", (e) => {
      e.preventDefault();
      const target = e.target.closest(".dnd-item");
      if (!target || target === dragSrc || !dragSrc) return;
      target.classList.remove("drag-over");

      const rect = target.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) grid.insertBefore(dragSrc, target);
      else grid.insertBefore(dragSrc, target.nextSibling);

      updateNumbers();
    });
  }

  function updateNumbers() {
    document.querySelectorAll("#ro-grid .dnd-item").forEach((el, i) => {
      el.querySelector(".dnd-item-num").textContent = i + 1;
    });
  }

  async function save() {
    const btn = document.getElementById("ro-btn-save");
    const status = document.getElementById("ro-save-status");
    const newOrder = [...document.querySelectorAll("#ro-grid .dnd-item")].map((el) =>
      parseInt(el.dataset.id)
    );

    btn.disabled = true;
    btn.textContent = i18n("Сохраняем…");
    status.className = "save-status";
    status.textContent = "";

    try {
      const res = await fetch("/api/save-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ _reorder_favorites: newOrder }),
      });
      const data = await res.json();
      if (res.ok) {
        status.className = "save-status ok";
        status.textContent = i18n("Порядок сохранён.");
        // fav_order живёт прямо в записях отзывов (reviews.json) – вкладка
        // «Любимое» под этим маршрутом сама не перечитается, пока по ней
        // не щёлкнуть заново, поэтому дёргаем её явно (см. js/api.js).
        refreshOpenReviewsTab();
      } else {
        status.className = "save-status err";
        status.textContent = i18n("Ошибка: ") + (data.error || i18n("неизвестная"));
      }
    } catch (e) {
      status.className = "save-status err";
      status.textContent = i18n("Ошибка сети: ") + e.message;
    }

    btn.disabled = false;
    btn.textContent = i18n("Сохранить порядок");
  }

  registerRoute("#/reviews-order", { mount, unmount });
})();
