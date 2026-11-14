// ══════════════════════════════════════════════
//  РОУТ #/favorites-order?section=… – порядок карточек раздела «Любимого»
//  (и старый адрес #/reviews-order – то же самое для «Тайтлов»).
//
//  Раздел – любой: «Тайтлы» (fav_order в reviews.json), «Персонажи»,
//  «Персоны» и свои разделы, заведённые в настройках (порядок записей
//  внутри favorites.json). Раньше сеткой с перетаскиванием в любую
//  сторону умели только тайтлы, а персонажи/персоны переставлялись
//  списком по вертикали под формой редактора записи – список оттуда
//  убран, порядок любого раздела теперь здесь.
//
//  Всё завёрнуто в IIFE, а не объявлено на верхнем уровне – иначе имена
//  вроде render()/load() рано или поздно столкнутся с чем-то из общей
//  области видимости index.html (см. предупреждение в router.js и в
//  scripts/check-duplicate-functions.js). Слушатели регистрируются через
//  on() – unmount() снимает их все разом.
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

  // section – ключ раздела «Любимого»: favTitles / favCharacters /
  // favPersons или id своего раздела (он же type записей в favorites.json).
  let section = "favTitles";
  let titles = []; // для favTitles – отзывы; иначе – записи favorites.json
  let allFav = []; // весь favorites.json – чтобы сохранить порядок целиком
  let dragSrc = null;
  let cleanupFns = [];
  let root = null;
  let roDirty = false;

  const favTypeOf = (key) => (key === "favCharacters" ? "character" : key === "favPersons" ? "person" : key);

  function sectionTitle(key) {
    if (key === "favTitles") return siteLabel("sections", "favTitles", i18n("Тайтлы"));
    if (key === "favCharacters") return siteLabel("sections", "favCharacters", i18n("Персонажи"));
    if (key === "favPersons") return siteLabel("sections", "favPersons", i18n("Персоны"));
    return ((window.SITE_FAV_COLLECTIONS || []).find((c) => c.id === key) || {}).label || key;
  }

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanupFns.push(() => target.removeEventListener(type, handler, opts));
  }

  async function mount(container, params) {
    root = container;
    const asked = params && params.get("section");
    const known = ["favTitles", "favCharacters", "favPersons", ...(window.SITE_FAV_COLLECTIONS || []).map((c) => c.id)];
    section = asked && known.includes(asked) ? asked : "favTitles";

    root.innerHTML = `
      <header class="app-topbar">
        <a href="#" class="logo topbar-back" id="ro-back"><span class="arrow">&larr;</span>TasteID</a>
        <h1 class="topbar-title">${i18n("Редактор порядка")}</h1>
      </header>
      <main class="ro-view">
        <div id="ro-content">
          <div class="state-box"><div class="spinner"></div>${i18n("Загружаем…")}</div>
        </div>
      </main>`;

    on(document.getElementById("ro-back"), "click", (e) => {
      e.preventDefault();
      leaveRO();
    });
    on(document, "keydown", (e) => {
      if (e.key === "Escape" && !document.querySelector(".modal-overlay:not(.hidden)")) {
        leaveRO();
      }
    });
    // Без этого свайп/аппаратная кнопка «назад» на телефоне
    // (installBackButton() в mobile/src/main.js) уходили в
    // window.history.back() напрямую, в обход leaveRO() – несохранённый
    // порядок терялся молча. Тот же приём, что у #/add и #/settings-edit.
    setLeaveGuard(leaveRO);

    await load();
  }

  async function leaveRO() {
    const canLeave = await confirmLeaveIfDirty({
      isDirty: () => roDirty,
      save,
    });
    if (canLeave) leaveRoute();
  }

  function unmount() {
    setLeaveGuard(null);
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    titles = [];
    allFav = [];
    dragSrc = null;
    roDirty = false;
    root = null;
  }

  async function load() {
    try {
      if (section === "favTitles") {
        const data = await fetchVaultList("reviews.json");
        titles = data
          .filter((r) => r.favorite === true)
          .sort((a, b) => (a.fav_order ?? 9999) - (b.fav_order ?? 9999));
      } else {
        allFav = await fetchVaultList("favorites.json");
        const type = favTypeOf(section);
        titles = allFav.filter((r) => r.type === type);
      }
      render();
    } catch (e) {
      const content = document.getElementById("ro-content");
      if (content) content.innerHTML = `<div class="state-box">${i18n("Ошибка загрузки:")} ${esc(e.message)}</div>`;
    }
  }

  function itemHtml(r, i) {
    if (section === "favTitles") {
      const PH = imagePlaceholder(120, 180);
      const cover = r.cover || r.cover_backup || PH;
      const label = TYPE_LABELS[r.type] || r.type || "–";
      return `<div class="dnd-item" draggable="true" data-id="${r.id}">
        <div class="dnd-item-num">${i + 1}</div>
        <img src="${esc(cover)}" alt="${esc(r.title)}"
          loading="lazy" style="object-position:${esc(r.cover_focus || "50% 50%")}" ${imgFallbackAttrs(r.cover, r.cover_backup, PH)}>
        <div class="dnd-item-body">
          <div class="dnd-item-title">${esc(r.title)}</div>
          <div class="dnd-item-type">${esc(label)}</div>
        </div>
      </div>`;
    }
    const PH = imagePlaceholder(120, 120);
    const sub = r.type === "person" ? SUBTYPE_LABELS[r.subtype] || "" : r.from || "";
    return `<div class="dnd-item" draggable="true" data-id="${r.id}">
      <div class="dnd-item-num">${i + 1}</div>
      <img src="${esc(r.image || r.image_backup || PH)}" alt="${esc(r.name)}"
        loading="lazy" style="object-position:${esc(r.image_focus || "50% 50%")}" ${imgFallbackAttrs(r.image, r.image_backup, PH)}>
      <div class="dnd-item-body">
        <div class="dnd-item-title">${esc(r.name)}</div>
        ${sub ? `<div class="dnd-item-type">${esc(sub)}</div>` : ""}
      </div>
    </div>`;
  }

  // «Персоны» во вкладке показываются разделами по ролям
  // (favPersonsByRoleHtml в favorites.js) – и здесь так же: отдельная
  // сетка на роль, перетаскивание внутри своей сетки. Общая сетка на все
  // роли позволила бы «переставить» сэйю между режиссёрами – а на вкладке
  // он всё равно остался бы в своём разделе.
  function groupsForRender() {
    if (section !== "favPersons") return [{ title: null, items: titles }];
    const byRole = new Map();
    for (const p of titles) {
      const role = p.subtype || "";
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(p);
    }
    if (byRole.size < 2) return [{ title: null, items: titles }];
    const rank = (role) => {
      const i = FAV_ROLE_ORDER.indexOf(role);
      return i === -1 ? FAV_ROLE_ORDER.length + (role ? 0 : 1) : i;
    };
    return [...byRole.keys()]
      .sort((a, b) => rank(a) - rank(b))
      .map((role) => ({ title: favRoleTitle(role), items: byRole.get(role) }));
  }

  function render() {
    const content = document.getElementById("ro-content");
    if (!content) return;

    if (!titles.length) {
      content.innerHTML =
        section === "favTitles"
          ? `<div class="state-box">${i18n("Нет тайтлов с флагом «Любимое».")}<br>
              <span style="font-size:.85rem">${i18n("Отметьте тайтлы в редакторе отзыва.")}</span></div>`
          : `<div class="state-box">${esc(siteLabel("empty", "generic", i18n("Пока пусто")))}</div>`;
      return;
    }

    const square = section === "favTitles" ? "" : " dnd-grid-square";
    const grids = groupsForRender()
      .map(
        (g) => `
        ${g.title ? `<div class="fav-role-head">${esc(g.title)}<span class="section-count">${g.items.length}</span></div>` : ""}
        <div class="dnd-grid${square}">${g.items.map((r, i) => itemHtml(r, i)).join("")}</div>`
      )
      .join("");

    content.innerHTML = `
      <h2 class="section-title">${esc(sectionTitle(section))}</h2>
      <p class="hint">${i18n("Перетащите карточки, чтобы изменить порядок. Нажмите «Сохранить», когда готово.")}</p>
      <div id="ro-grids">${grids}</div>
      <div class="save-bar">
        <button class="btn-save" id="ro-btn-save">${i18n("Сохранить порядок")}</button>
        <span class="save-status" id="ro-save-status"></span>
      </div>`;

    on(document.getElementById("ro-btn-save"), "click", save);
    document.querySelectorAll("#ro-grids .dnd-grid").forEach(bindDnd);
  }

  function bindDnd(grid) {
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

    // Только внутри своей сетки (см. groupsForRender): карточку из
    // другой сетки сюда не роняем.
    const ours = () => dragSrc && dragSrc.parentElement === grid;

    on(grid, "dragover", (e) => {
      if (!ours()) return;
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
      if (!ours()) return;
      e.preventDefault();
      const target = e.target.closest(".dnd-item");
      if (!target || target === dragSrc) return;
      target.classList.remove("drag-over");

      const rect = target.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (e.clientX < midX) grid.insertBefore(dragSrc, target);
      else grid.insertBefore(dragSrc, target.nextSibling);

      roDirty = true;
      updateNumbers();
    });
  }

  function updateNumbers() {
    document.querySelectorAll("#ro-grids .dnd-grid").forEach((grid) => {
      grid.querySelectorAll(".dnd-item").forEach((el, i) => {
        el.querySelector(".dnd-item-num").textContent = i + 1;
      });
    });
  }

  // Новый порядок всего favorites.json: записи этого раздела встают в
  // те же самые «слоты», где лежали записи раздела раньше, в новом
  // порядке; записи других разделов не двигаются вовсе.
  function fullFavoritesOrder(sectionIds) {
    const type = favTypeOf(section);
    const queue = [...sectionIds];
    return allFav.map((r) => (r.type === type ? queue.shift() : r.id));
  }

  async function save() {
    const btn = document.getElementById("ro-btn-save");
    const status = document.getElementById("ro-save-status");
    const newOrder = [...document.querySelectorAll("#ro-grids .dnd-item")].map((el) => Number(el.dataset.id));

    btn.disabled = true;
    btn.textContent = i18n("Сохраняем…");
    status.className = "save-status";
    status.textContent = "";

    try {
      const res =
        section === "favTitles"
          ? await fetch("/api/save-review", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ _reorder_favorites: newOrder }),
            })
          : await fetch("/api/save-favorite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ _reorder: fullFavoritesOrder(newOrder) }),
            });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        roDirty = false;
        status.className = "save-status ok";
        status.textContent = i18n("Порядок сохранён.");
        // Вкладка «Любимое» под этим маршрутом сама не перечитается, пока
        // по ней не щёлкнуть заново, поэтому дёргаем её явно (js/api.js).
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
  registerRoute("#/favorites-order", { mount, unmount });
})();
