// ══════════════════════════════════════════════
//  РОУТ #/favorites-edit – редактор «Любимого»
//  (см. план перехода на SPA, фаза 3.2)
//
//  Как и #/chars-edit (js/routes/chars-edit.js), НЕ завёрнут в IIFE –
//  разметка и рендер списков (renderGroup/renderSubtypePickerDropdown)
//  вызывают друг друга через инлайновые onclick="funcName(...)", и
//  превращать их в вызовы через объект-неймспейс ради самой процедуры
//  переноса – риск опечатки на ровном месте. Верхнеуровневые имена уже
//  однажды переименовывались в фазе 0 (см. её же коммит) именно чтобы
//  не столкнуться с add.html/reviews-order.html – здесь та же
//  страховка: scripts/check-duplicate-functions.js (npm run check).
//
//  На document – три постоянных слушателя не самой страницы, а именно
//  document (click вне дропдауна, tags-map-updated, site-labels-ready)
//  плюс keydown для «Esc уходит с маршрута» – все сняты в unmount().
// ══════════════════════════════════════════════

let favEditingId = null;
let allEntries = [];
let groupLists = { character: [], person: [] };
let orderDirty = false;
let favDragSrc = null;
let subtypePickerOpen = false;
let favTypePickerOpen = false;
const FAV_TYPE_BUILTINS = ["character", "person"];
let backupImageTimer = null;
const SUBTYPE_BUILTINS = ["actor", "director", "author", "seiyuu", "artist", "composer"];

let feCleanupFns = [];
let fePrevTitle = null;

// Привязанные тайтлы (id отзывов из reviews.json) – см. её же комментарий
// у «Тайтлы» в шаблоне mount() ниже.
let linkedReviewIds = [];

// Привязанные СУЩНОСТИ «Любимого» (id из favorites.json, любого типа –
// сэйю к персонажу, персонаж к автору и т.д.) – см. её же комментарий у
// favLinkGroups() ниже.
let linkedFavoriteIds = [];

function feOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  feCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container, params) {
  fePrevTitle = document.title;
  favEditingId = null;
  favImageGallery = [];
  profileCustomFields = [];
  linkedReviewIds = [];
  linkedFavoriteIds = [];
  allEntries = [];
  groupLists = { character: [], person: [] };
  orderDirty = false;
  favDragSrc = null;
  subtypePickerOpen = false;
  favTypePickerOpen = false;

  container.innerHTML = `
    <header class="app-topbar">
      <a href="#" class="logo topbar-back" id="fe-back"><span class="arrow">&larr;</span>TasteID</a>
      <h1 class="topbar-title" id="page-subtitle">${i18n("Персонажи и персоны")}</h1>
    </header>
    <main class="fe-view">
      <div class="edit-banner" id="edit-banner" style="display:none">
        <div>Режим редактирования – <span class="edit-banner-title" id="edit-name-hint"></span></div>
        <button class="btn-new" onclick="resetFavToNew()">${i18n("Новая запись")}</button>
      </div>

      <h2 class="section-title">${i18n("Основное")}</h2>
      <div class="grid">
        <div class="field">
          <label>${i18n("Имя")}</label>
          <input type="text" id="f-name" placeholder="${i18n("Имя")}">
        </div>
        <div class="field">
          <label>${i18n("Тип")}</label>
          <div class="src-type-wrap" style="width:100%;">
            <button type="button" class="src-type-btn" style="width:100%;" onclick="toggleFavTypePickerDropdown()">
              <span id="fav-type-picker-label">${i18n("Персонаж")}</span><span class="src-caret"></span>
            </button>
            <div class="src-type-dropdown hidden" id="fav-type-picker-dropdown"></div>
          </div>
          <input type="hidden" id="f-type" value="character">
        </div>
        <div class="field full field-subtype" id="field-subtype">
          <label>${i18n("Роль персоны")}</label>
          <div class="src-type-wrap" style="width:100%;">
            <button type="button" class="src-type-btn" style="width:100%;" onclick="toggleSubtypePickerDropdown()">
              <span id="subtype-picker-label">${i18n("Актёр")}</span><span class="src-caret"></span>
            </button>
            <div class="src-type-dropdown hidden" id="subtype-picker-dropdown"></div>
          </div>
          <input type="hidden" id="f-subtype" value="actor">
        </div>
        <div class="field full">
          <label>${i18n("Ссылка на изображение")}</label>
          <input type="text" id="f-image" placeholder="https://..." oninput="previewAvatar(this.value); scheduleBackupImage();">
          <input type="hidden" id="f-image-backup">
          <input type="hidden" id="f-image-focus" value="50% 50%">
          <div class="avatar-preview-row">
            <img id="avatar-img" class="avatar-preview" onclick="openFavImageGallery()" title="${i18n("Все картинки этой записи")}">
            <button type="button" class="btn btn-ghost" onclick="openFocusPickerForAvatar()">${i18n("Область картинки")}</button>
          </div>
          <div id="image-backup-status" style="font-size:.8rem;margin-top:.4rem;"></div>
        </div>
        <div class="field full">
          <label>${i18n("Или загрузить с компьютера")}</label>
          <label class="btn btn-ghost file-btn">
            <input type="file" id="f-image-upload" accept="image/*" onchange="updateFileBtnName(this); uploadFavImage()">
            <span>${i18n("Выбрать файл")}</span>
          </label>
          <span class="file-btn-name" id="f-image-upload-name"></span>
          <label class="original-quality-toggle"><input type="checkbox" id="f-image-original" onchange="onImageOriginalToggle()"><span>${i18n("Оригинальное качество (без сжатия)")}</span></label>
          <div id="image-upload-status" style="font-size:.8rem;margin-top:.4rem;"></div>
        </div>
        <div class="field full" id="field-from">
          <label>${i18n("Откуда")}</label>
          <input type="text" id="f-from" placeholder="${i18n("Из какого произведения")}">
        </div>
      </div>

      <!-- Анкета – необязательная, для тех, кто хочет расписать запись
           подробнее одной строчки «откуда». Поля не завязаны ни на что
           в остальном приложении (только показываются в этой же форме
           и в будущей модалке просмотра) – специально свободная форма,
           а не набор проверок под конкретный тип данных. -->
      <h2 class="section-title">${i18n("Анкета")}</h2>
      <div class="grid">
        <div class="field full">
          <label>${i18n("Биография")}</label>
          <textarea id="f-profile-bio" rows="4" placeholder="${i18n("Свободный текст – история персонажа, факты о персоне...")}"></textarea>
        </div>
        <div class="field full field-optional hidden" id="field-profile-quotes">
          <label>${i18n("Цитаты")}<button type="button" class="field-remove-btn" title="${i18n("Убрать поле")}" onclick="removeOptionalProfileField('quotes')">✕</button></label>
          <textarea id="f-profile-quotes" rows="1" placeholder="${i18n("По одной на строку")}"></textarea>
        </div>
        <!-- Не всем сущностям нужны запоминающиеся цитаты – в отличие от
             Биографии/Своих полей, спрятаны по умолчанию, пока не
             добавили явно. -->
        <div class="field full">
          <button type="button" class="btn btn-ghost" id="add-profile-quotes-btn" onclick="addOptionalProfileField('quotes')">${i18n("Добавить цитаты")}</button>
        </div>
        <div class="field full">
          <label>${i18n("Свои поля")}</label>
          <div id="profile-custom-list"></div>
          <button type="button" class="btn btn-ghost" onclick="addProfileCustomField()">${i18n("Добавить поле")}</button>
        </div>
      </div>

      <!-- Тайтлы – связь с отзывами (reviews.json), напр. у персонажа
           показать все тайтлы, где он появлялся: у Джинкс это оба
           отзыва на Аркейн, по сезону на каждый. Само связывание –
           просто список id, никакой отдельной сущности под это не
           заводим. -->
      <h2 class="section-title">${i18n("Тайтлы")}</h2>
      <div id="linked-titles-list" class="linked-titles-list"></div>
      <button type="button" class="btn btn-ghost" onclick="openTitleLinkSearch()">${i18n("Добавить источник")}</button>

      <!-- Связи с другими сущностями «Любимого» (не тайтлами) – сэйю к
           персонажу, персонаж к автору и т.д., в любую сторону. Один
           блок на раздел «Любимого» (Персонажи/Персоны/свои разделы),
           собирается заново при каждом mount()/fillFavForm() –
           появившийся в /settings-edit новый раздел получает свою
           строку сам, без правки разметки здесь (см. favLinkGroups()). -->
      <div id="linked-favorites-groups"></div>

      <div class="divider"></div>
      <button class="btn-save" id="btn-save" onclick="saveEntry()">${i18n("Сохранить")}</button>
      <div class="status-msg" id="status"></div>

      <div class="list-header" id="list-header" style="display:none">
        <div class="divider-title">${i18n("Персонажи")}</div>
        <button class="btn-save-order" id="btn-save-order" onclick="saveFavOrder()">${i18n("Сохранить порядок")}</button>
      </div>
      <div class="entries-list" id="entries-list-character"></div>

      <div class="divider-title" id="persons-title" style="display:none">${i18n("Персоны")}</div>
      <div class="entries-list" id="entries-list-person"></div>

      <div id="entries-groups-custom"></div>

      <div class="order-hint" id="order-hint">${i18n("Перетащите за ⠿, чтобы изменить порядок, затем нажмите «Сохранить порядок»")}</div>
    </main>`;

  renderLinkedFavoriteGroups();
  feOn(document, "tags-map-updated", renderLinkedFavoriteGroups);

  feOn(document.getElementById("fe-back"), "click", (e) => {
    e.preventDefault();
    leaveFavoritesEdit();
  });

  syncSubtypePickerLabel();
  feOn(document, "tags-map-updated", syncSubtypePickerLabel);
  feOn(document, "site-labels-ready", () => {
    syncFavTypePickerLabel();
    loadList();
  });
  feOn(document, "click", (e) => {
    if (!subtypePickerOpen) return;
    const wrap = document.getElementById("subtype-picker-dropdown")?.closest(".src-type-wrap");
    if (wrap && !wrap.contains(e.target)) closeSubtypePickerDropdown();
  });
  feOn(document, "click", (e) => {
    if (!favTypePickerOpen) return;
    const wrap = document.getElementById("fav-type-picker-dropdown")?.closest(".src-type-wrap");
    if (wrap && !wrap.contains(e.target)) closeFavTypePickerDropdown();
  });
  // Esc, открыт ли дропдаун роли – тогда ничего не делаем (тот же выбор,
  // что раньше был в enableEscapeToLeave(".src-type-dropdown:not(.hidden)")
  // из utils.js: Escape сам дропдаун не закрывает, просто не даёт уйти
  // со страницы, пока он открыт). Иначе – уходим с маршрута.
  feOn(document, "keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".src-type-dropdown:not(.hidden)")) return;
    leaveFavoritesEdit();
  });

  document.title = `TasteID – ${i18n("Персонажи и персоны")}`;

  // Раньше единственным триггером первой загрузки списка/типов было
  // событие "site-labels-ready" от theme.js – на отдельной странице
  // оно срабатывало заново при каждом полном заходе. Под SPA-оболочкой
  // applyTheme() выполняется один раз за всё время жизни документа
  // (см. её же комментарий в router.js) – событие уже отгремело
  // задолго до того, как этот маршрут вообще замонтировался, и одной
  // лишь подписки выше недостаточно. Вызываем явно; подписка остаётся
  // на случай, если настройки правда поменяются, пока маршрут открыт.
  syncFavTypePickerLabel();
  await loadList();
  // Тайтлы (see «Тайтлы» ниже) читаются из cache.reviews – если сюда
  // зашли напрямую по ссылке (#/favorites-edit?edit=ID), а не через
  // уже открытую вкладку «Любимое», кэш ещё мог быть не заполнен.
  await fetchReviews();

  // Переход по клику на карточку персонажа/персоны из «Любимого»
  // (favPersonCard в js/favorites.js) – та же схема, что у #/add?edit=ID
  // (см. initAddPage() в add-form-state.js): id может быть либо числом
  // из URL, либо строкой, id записи – всегда число, отсюда сравнение
  // через String() с обеих сторон.
  const editId = params && params.get("edit");
  if (editId) {
    const entry = allEntries.find((r) => String(r.id) === editId);
    if (entry) startEdit(entry.id);
  }
}

async function leaveFavoritesEdit() {
  const canLeave = await confirmLeaveIfDirty({
    isDirty: () => orderDirty,
    save: saveFavOrder,
  });
  if (canLeave) leaveRoute();
}

function unmount() {
  // Раньше здесь звали discardScratchImageBackup() – резервную копию,
  // сделанную во время редактирования, но так и не сохранённую вместе
  // с записью. С галереей картинок (favImageGallery выше) это больше не
  // нужно и было бы вредно: см. тот же разбор у unmount() в
  // js/routes/add.js.
  feCleanupFns.forEach((fn) => fn());
  feCleanupFns = [];
  clearTimeout(backupImageTimer);
  document.title = fePrevTitle || document.title;
  favEditingId = null;
  allEntries = [];
  groupLists = { character: [], person: [] };
  orderDirty = false;
  favDragSrc = null;
  subtypePickerOpen = false;
  favTypePickerOpen = false;
}

function subtypeLabel(key) {
  return SUBTYPE_LABELS[key] || SUBTYPE_LABELS.actor;
}

function syncSubtypePickerLabel() {
  const el = document.getElementById("f-subtype");
  if (!el) return;
  const key = el.value || "actor";
  document.getElementById("subtype-picker-label").textContent = subtypeLabel(key);
}

function renderSubtypePickerDropdown() {
  const dd = document.getElementById("subtype-picker-dropdown");
  const current = document.getElementById("f-subtype").value || "actor";
  const options = Object.entries(SUBTYPE_LABELS)
    .map(
      ([key, label]) => `
    <div class="src-type-option${key === current ? " active" : ""}" data-type-key="${esc(key)}" onclick="selectSubtypePicker('${key}')">
      <span class="src-type-option-label">${esc(label)}</span>
      <span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameSubtypePicker('${key}')">✎</span>
      <span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeSubtypePicker('${key}')">✕</span>
    </div>`
    )
    .join("");
  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddSubtypeForm()">${i18n("Добавить роль")}</button>
    </div>
    <div class="src-type-add-form hidden" id="subtype-picker-add-form">
      <input type="text" id="subtype-picker-new-name" placeholder="${i18n("Например: Продюсер")}" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddSubtype();}">
      <button type="button" class="btn-new" onclick="confirmAddSubtype()">${i18n("Ок")}</button>
    </div>
    <div class="status-msg src-type-status" id="subtype-picker-status"></div>`;
}

function toggleSubtypePickerDropdown() {
  const dd = document.getElementById("subtype-picker-dropdown");
  const isOpen = !dd.classList.contains("hidden");
  closeSubtypePickerDropdown();
  if (!isOpen) {
    renderSubtypePickerDropdown();
    dd.classList.remove("hidden");
    subtypePickerOpen = true;
  }
}

function closeSubtypePickerDropdown() {
  if (!subtypePickerOpen) return;
  document.getElementById("subtype-picker-dropdown")?.classList.add("hidden");
  subtypePickerOpen = false;
}

function selectSubtypePicker(key) {
  document.getElementById("f-subtype").value = key;
  syncSubtypePickerLabel();
  closeSubtypePickerDropdown();
}

function showAddSubtypeForm() {
  const dd = document.getElementById("subtype-picker-dropdown");
  dd.querySelector(".src-type-list").style.display = "none";
  dd.querySelector(".src-type-add-row").style.display = "none";
  document.getElementById("subtype-picker-add-form").classList.remove("hidden");
  document.getElementById("subtype-picker-new-name").focus();
}

async function confirmAddSubtype() {
  const input = document.getElementById("subtype-picker-new-name");
  const statusEl = document.getElementById("subtype-picker-status");
  const name = input.value.trim();

  if (!name) {
    statusEl.textContent = i18n("Введите название роли");
    statusEl.className = "status-msg src-type-status err";
    return;
  }
  const exists = Object.values(SUBTYPE_LABELS).some((l) => l.toLowerCase() === name.toLowerCase());
  if (exists) {
    statusEl.textContent = i18n("Такая роль уже есть");
    statusEl.className = "status-msg src-type-status err";
    return;
  }

  const key =
    "custom_" +
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .slice(0, 30) +
    "_" +
    Date.now().toString(36).slice(-4);
  statusEl.textContent = i18n("Сохраняем…");
  statusEl.className = "status-msg src-type-status";
  try {
    await patchSiteSettings((settings) => {
      settings.customSubtypes = settings.customSubtypes || {};
      settings.customSubtypes[key] = name;
    });
    SUBTYPE_LABELS[key] = name;
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    selectSubtypePicker(key);
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg src-type-status err";
  }
}

async function removeSubtypePicker(key) {
  if (Object.keys(SUBTYPE_LABELS).length <= 1) {
    alert(i18n("Должна остаться хотя бы одна роль"));
    return;
  }
  if (!(await confirmDialog(i18n("Удалить роль «{name}»?", { name: SUBTYPE_LABELS[key] })))) return;
  const isBuiltin = SUBTYPE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.hiddenSubtypes = settings.hiddenSubtypes || [];
        if (!settings.hiddenSubtypes.includes(key)) settings.hiddenSubtypes.push(key);
      } else {
        settings.customSubtypes = settings.customSubtypes || {};
        delete settings.customSubtypes[key];
      }
    });
    delete SUBTYPE_LABELS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (subtypePickerOpen) renderSubtypePickerDropdown();
    if (document.getElementById("f-subtype").value === key) selectSubtypePicker(Object.keys(SUBTYPE_LABELS)[0]);
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование роли – тот же приём, что у типа тайтла в add.html
// (startRenameTypePicker): клик по ✎ подменяет подпись на текстовое
// поле прямо в строке списка, Enter/уход фокуса сохраняют, Esc
// отменяет. Встроенная роль переименовывается через labels.subtypes
// (оверрайд подписи, ключ в SUBTYPE_BUILTINS не меняется), своя –
// через сам customSubtypes[key].
let subtypeRenamePending = null;

function startRenameSubtypePicker(key) {
  const dd = document.getElementById("subtype-picker-dropdown");
  const row = dd?.querySelector(`.src-type-option[data-type-key="${CSS.escape(key)}"]`);
  const labelEl = row?.querySelector(".src-type-option-label");
  if (!labelEl) return;

  subtypeRenamePending = key;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "src-type-rename-input";
  input.value = SUBTYPE_LABELS[key];
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); subtypeRenamePending = null; renderSubtypePickerDropdown(); }
  };
  input.onblur = () => {
    if (subtypeRenamePending !== key) return;
    subtypeRenamePending = null;
    confirmRenameSubtypePicker(key, input.value);
  };
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

async function confirmRenameSubtypePicker(key, rawName) {
  const name = rawName.trim();
  const oldName = SUBTYPE_LABELS[key];
  if (!name || name === oldName) {
    if (subtypePickerOpen) renderSubtypePickerDropdown();
    return;
  }
  const exists = Object.entries(SUBTYPE_LABELS).some(([k, l]) => k !== key && l.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert(i18n("Такая роль уже есть"));
    if (subtypePickerOpen) renderSubtypePickerDropdown();
    return;
  }

  const isBuiltin = SUBTYPE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.labels = settings.labels || {};
        settings.labels.subtypes = settings.labels.subtypes || {};
        settings.labels.subtypes[key] = name;
      } else {
        settings.customSubtypes = settings.customSubtypes || {};
        settings.customSubtypes[key] = name;
      }
    });
    SUBTYPE_LABELS[key] = name;
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  } finally {
    if (subtypePickerOpen) { syncSubtypePickerLabel(); renderSubtypePickerDropdown(); }
  }
}

function favCustomCollections() {
  return window.SITE_FAV_COLLECTIONS || [];
}

// ── Тип записи («Персонаж»/«Персона» + свои разделы) – тот же паттерн
//    выпадающего списка с инлайн-добавлением, что у роли персоны
//    (см. блок «Роль персоны» выше). Свои типы – это те же разделы
//    «Любимого» (favCollections), что заводятся в /settings-edit;
//    добавленный отсюда сразу появляется там и наоборот. Встроенные
//    типы (character/person) теперь тоже переименовываются и
//    скрываются – тем же приёмом, что источники в add.html и роли
//    выше: подпись живёт в labels.favTypes, скрытие – в
//    hiddenFavTypes. Скрытие built-in типа – НЕ то же самое, что
//    удаление своего раздела: раздел «Персонажи»/«Персоны» на вкладке
//    «Любимое» устроен отдельным, всегда существующим блоком
//    разметки (js/favorites.js), а не циклом по favCollections, и
//    прячется своим отдельным тумблером (hiddenFavSections, тот же
//    глазок, что и у остальных секций, в /settings-edit). Скрытие
//    типа здесь означает только «нельзя выбрать/создать новую запись
//    этого типа» – уже существующие персонажи/персоны никуда не
//    денутся с вкладки. Формулировка диалога подтверждения ниже это
//    и объясняет, чтобы не пугать несуществующей потерей данных.
function favTypePickerOptionLabel(id) {
  const overrides = window.SITE_LABEL_OVERRIDES?.favTypes || {};
  if (id === "character") return overrides.character || i18n("Персонаж");
  if (id === "person") return overrides.person || i18n("Персона");
  return (favCustomCollections().find((c) => c.id === id) || {}).label || id;
}

function syncFavTypePickerLabel() {
  const el = document.getElementById("f-type");
  if (!el) return;
  document.getElementById("fav-type-picker-label").textContent = favTypePickerOptionLabel(el.value || "character");
}

function renderFavTypePickerDropdown() {
  const dd = document.getElementById("fav-type-picker-dropdown");
  const current = document.getElementById("f-type").value || "character";
  const hidden = window.SITE_HIDDEN_FAV_TYPES || [];
  const items = [
    { id: "character", label: favTypePickerOptionLabel("character") },
    { id: "person", label: favTypePickerOptionLabel("person") },
    ...favCustomCollections(),
  ].filter((it) => !hidden.includes(it.id) || it.id === current);
  const options = items
    .map(
      ({ id, label }) => `
    <div class="src-type-option${id === current ? " active" : ""}" data-type-key="${esc(id)}" onclick="selectFavTypePicker('${id}')">
      <span class="src-type-option-label">${esc(label)}</span>
      <span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameFavTypePicker('${id}')">✎</span>
      <span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeFavTypePicker('${id}')">✕</span>
    </div>`
    )
    .join("");
  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddFavTypeForm()">${i18n("Добавить тип")}</button>
    </div>
    <div class="src-type-add-form hidden" id="fav-type-picker-add-form">
      <input type="text" id="fav-type-picker-new-name" placeholder="${i18n("Например: Локации")}" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddFavType();}">
      <button type="button" class="btn-new" onclick="confirmAddFavType()">${i18n("Ок")}</button>
    </div>
    <div class="status-msg src-type-status" id="fav-type-picker-status"></div>`;
}

function toggleFavTypePickerDropdown() {
  const dd = document.getElementById("fav-type-picker-dropdown");
  const isOpen = !dd.classList.contains("hidden");
  closeFavTypePickerDropdown();
  if (!isOpen) {
    renderFavTypePickerDropdown();
    dd.classList.remove("hidden");
    favTypePickerOpen = true;
  }
}

function closeFavTypePickerDropdown() {
  if (!favTypePickerOpen) return;
  document.getElementById("fav-type-picker-dropdown")?.classList.add("hidden");
  favTypePickerOpen = false;
}

function selectFavTypePicker(id) {
  document.getElementById("f-type").value = id;
  syncFavTypePickerLabel();
  closeFavTypePickerDropdown();
  onTypeChange();
}

function showAddFavTypeForm() {
  const dd = document.getElementById("fav-type-picker-dropdown");
  dd.querySelector(".src-type-list").style.display = "none";
  dd.querySelector(".src-type-add-row").style.display = "none";
  document.getElementById("fav-type-picker-add-form").classList.remove("hidden");
  document.getElementById("fav-type-picker-new-name").focus();
}

async function confirmAddFavType() {
  const input = document.getElementById("fav-type-picker-new-name");
  const statusEl = document.getElementById("fav-type-picker-status");
  const name = input.value.trim();

  if (!name) {
    statusEl.textContent = i18n("Введите название типа");
    statusEl.className = "status-msg src-type-status err";
    return;
  }
  const existingLabels = [favTypePickerOptionLabel("character"), favTypePickerOptionLabel("person"), ...favCustomCollections().map((c) => c.label)];
  const exists = existingLabels.some((l) => l.toLowerCase() === name.toLowerCase());
  if (exists) {
    statusEl.textContent = i18n("Такой тип уже есть");
    statusEl.className = "status-msg src-type-status err";
    return;
  }

  // slugify() – из js/routes/settings-edit.js, тот же формат id, что
  // и у раздела, заведённого через "+ Добавить раздел" в настройках
  // (см. addFavCollection там же): нижний регистр + метка времени,
  // чтобы совпадение с уже удалённым разделом было исключено.
  const id = slugify(name);
  statusEl.textContent = i18n("Сохраняем…");
  statusEl.className = "status-msg src-type-status";
  try {
    await patchSiteSettings((settings) => {
      settings.favCollections = settings.favCollections || [];
      settings.favCollections.push({ id, label: name });
    });
    window.SITE_FAV_COLLECTIONS = [...favCustomCollections(), { id, label: name }];
    groupLists[id] = [];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    selectFavTypePicker(id);
    renderList();
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg src-type-status err";
  }
}

async function removeFavTypePicker(id) {
  const label = favTypePickerOptionLabel(id);
  const hidden = window.SITE_HIDDEN_FAV_TYPES || [];
  const visibleCount = 2 + favCustomCollections().length - hidden.length;
  if (visibleCount <= 1) {
    alert(i18n("Должен остаться хотя бы один тип"));
    return;
  }

  if (FAV_TYPE_BUILTINS.includes(id)) {
    if (
      !(await confirmDialog(
        i18n(
          "Скрыть тип «{name}» из списка?\n\nУже добавленные персонажи и персоны останутся на вкладке «Любимое» как есть – пропадёт только возможность выбрать этот тип для новой или редактируемой записи. Вернуть можно здесь же.",
          { name: label }
        )
      ))
    ) {
      return;
    }
    try {
      await patchSiteSettings((settings) => {
        settings.hiddenFavTypes = settings.hiddenFavTypes || [];
        if (!settings.hiddenFavTypes.includes(id)) settings.hiddenFavTypes.push(id);
      });
      window.SITE_HIDDEN_FAV_TYPES = [...hidden, id];
      if (favTypePickerOpen) renderFavTypePickerDropdown();
      if (document.getElementById("f-type").value === id) {
        selectFavTypePicker(FAV_TYPE_BUILTINS.find((t) => t !== id) || "character");
      }
    } catch (err) {
      alert(err.message || i18n("Ошибка удаления"));
    }
    return;
  }

  // Свой раздел, в отличие от встроенных выше, не привязан ни к чему,
  // кроме собственных записей – скрывать их вслед за разделом (как для
  // "character"/"person") было бы некуда: раздел пропадает из списка
  // насовсем, вернуть его как раньше было бы уже нечем, значит и
  // притворяться, что записи "просто перестанут показываться", не
  // стоит – удаляем по-настоящему, вместе с разделом.
  const toDelete = groupLists[id] || [];
  if (
    !(await confirmDialog(
      i18n(
        "Удалить раздел «{name}»?\n\nЗаписи этого раздела ({count}) будут удалены без возможности восстановления.",
        { name: label, count: toDelete.length }
      )
    ))
  ) {
    return;
  }
  try {
    const res = await fetch("/api/save-favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ _deleteMany: toDelete.map((r) => r.id) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || i18n("Ошибка удаления"));
    // Записи удалены по подтверждённому ответу сервера – резервные копии
    // обложек теперь точно ничьи, раньше этого момента удалять было
    // нельзя (та же логика, что у одиночного удаления, см. её же
    // комментарий в deleteFavEntry() ниже): удали их раньше и упади
    // запрос на середине (сеть, сервер) – записи в favorites.json
    // остались бы жить со ссылкой на уже стёртый файл, то есть с
    // разбитой картинкой, которую было бы уже нечем чинить.
    for (const entry of toDelete) {
      const orphaned = new Set(entry.image_gallery || []);
      if (entry.image_backup) orphaned.add(entry.image_backup);
      orphaned.forEach((url) => deleteMediaFile(url));
    }

    await patchSiteSettings((settings) => {
      settings.favCollections = (settings.favCollections || []).filter((c) => c.id !== id);
    });
    window.SITE_FAV_COLLECTIONS = favCustomCollections().filter((c) => c.id !== id);
    delete groupLists[id];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (favTypePickerOpen) renderFavTypePickerDropdown();
    if (document.getElementById("f-type").value === id) selectFavTypePicker("character");
    // allEntries/groupLists у остальных разделов не менялись, но список
    // мог показывать только что удалённые записи – проще перечитать
    // с диска, чем вычищать их из локального состояния вручную.
    await loadList();
    refreshOpenReviewsTab();
    renderList();
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование – тот же инлайн-приём, что у роли персоны
// (startRenameSubtypePicker). Встроенный тип пишет подпись в
// labels.favTypes (ключ character/person не меняется), свой раздел
// правит label прямо в объекте внутри favCollections – та же запись,
// что редактируется и в /settings-edit (toggleFavCollectionEdit),
// только сохраняется сразу, а не по общей кнопке «Сохранить».
let favTypeRenamePending = null;

function startRenameFavTypePicker(id) {
  const dd = document.getElementById("fav-type-picker-dropdown");
  const row = dd?.querySelector(`.src-type-option[data-type-key="${CSS.escape(id)}"]`);
  const labelEl = row?.querySelector(".src-type-option-label");
  if (!labelEl) return;

  favTypeRenamePending = id;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "src-type-rename-input";
  input.value = favTypePickerOptionLabel(id);
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); favTypeRenamePending = null; renderFavTypePickerDropdown(); }
  };
  input.onblur = () => {
    if (favTypeRenamePending !== id) return;
    favTypeRenamePending = null;
    confirmRenameFavTypePicker(id, input.value);
  };
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

async function confirmRenameFavTypePicker(id, rawName) {
  const name = rawName.trim();
  const oldName = favTypePickerOptionLabel(id);
  if (!name || name === oldName) {
    if (favTypePickerOpen) renderFavTypePickerDropdown();
    return;
  }
  const existingItems = [
    { id: "character", label: favTypePickerOptionLabel("character") },
    { id: "person", label: favTypePickerOptionLabel("person") },
    ...favCustomCollections(),
  ];
  const exists = existingItems.some((it) => it.id !== id && it.label.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert(i18n("Такой тип уже есть"));
    if (favTypePickerOpen) renderFavTypePickerDropdown();
    return;
  }

  try {
    if (FAV_TYPE_BUILTINS.includes(id)) {
      await patchSiteSettings((settings) => {
        settings.labels = settings.labels || {};
        settings.labels.favTypes = settings.labels.favTypes || {};
        settings.labels.favTypes[id] = name;
      });
      window.SITE_LABEL_OVERRIDES = window.SITE_LABEL_OVERRIDES || {};
      window.SITE_LABEL_OVERRIDES.favTypes = { ...(window.SITE_LABEL_OVERRIDES.favTypes || {}), [id]: name };
    } else {
      await patchSiteSettings((settings) => {
        settings.favCollections = settings.favCollections || [];
        const c = settings.favCollections.find((x) => x.id === id);
        if (c) c.label = name;
      });
      window.SITE_FAV_COLLECTIONS = favCustomCollections().map((c) => (c.id === id ? { ...c, label: name } : c));
    }
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  } finally {
    if (favTypePickerOpen) { syncFavTypePickerLabel(); renderFavTypePickerDropdown(); }
  }
}

// ── Анкета: свои поля ────────────────────────────
// Список { label, value } – сколько угодно произвольных пар, помимо
// заранее заведённых био/пола/цитат выше. Держим как обычный массив в
// памяти, а не читаем прямо из разметки при сохранении – со строками,
// которые можно как добавлять, так и удалять, разметка сама по себе не
// источник истины (проще один раз отрендерить из массива, чем потом
// восстанавливать порядок/значения обратно из DOM).
let profileCustomFields = [];

// Пол – без своего поля в форме (см. её же комментарий у
// buildProfileField ниже), но раз уже был сохранён у записи раньше,
// молча стирать его при пересохранении не годится.
let currentProfileGender = null;

function renderProfileCustomFields() {
  const box = document.getElementById("profile-custom-list");
  if (!box) return;
  box.innerHTML = profileCustomFields
    .map(
      (f, i) => `
    <div class="profile-custom-row">
      <input type="text" placeholder="${i18n("Название поля")}" value="${esc(f.label)}" oninput="profileCustomFields[${i}].label = this.value">
      <input type="text" placeholder="${i18n("Значение")}" value="${esc(f.value)}" oninput="profileCustomFields[${i}].value = this.value">
      <button type="button" class="icon-btn" title="${i18n("Удалить поле")}" onclick="removeProfileCustomField(${i})">✕</button>
    </div>`
    )
    .join("");
}

function addProfileCustomField() {
  profileCustomFields.push({ label: "", value: "" });
  renderProfileCustomFields();
  document.querySelector("#profile-custom-list .profile-custom-row:last-child input")?.focus();
}

function removeProfileCustomField(i) {
  profileCustomFields.splice(i, 1);
  renderProfileCustomFields();
}

// Собирает анкету перед сохранением – null целиком, если вообще ничего
// не заполнено, а не объект из одних пустых полей: не хочется раздувать
// favorites.json пустой анкетой у каждой записи, у которой её никто не
// заводил.
// Цитаты – необязательное поле, спрятанное, пока его не добавили явно
// (см. её же комментарий у «+ Добавить цитаты» в mount() выше).
// Прячем/показываем именно так, а не оставляем поле просто пустовать
// видимым – меньше незаполненных строк на глаза тому, кому они не
// нужны вовсе.
function addOptionalProfileField(key) {
  document.getElementById(`field-profile-${key}`).classList.remove("hidden");
  document.getElementById(`add-profile-${key}-btn`).classList.add("hidden");
  document.getElementById(`f-profile-${key}`).focus();
}

function removeOptionalProfileField(key) {
  document.getElementById(`field-profile-${key}`).classList.add("hidden");
  document.getElementById(`f-profile-${key}`).value = "";
  document.getElementById(`add-profile-${key}-btn`).classList.remove("hidden");
}

function buildProfileField() {
  const bio = document.getElementById("f-profile-bio").value.trim();
  const quotes = document
    .getElementById("f-profile-quotes")
    .value.split("\n")
    .map((q) => q.trim())
    .filter(Boolean);
  const custom = profileCustomFields
    .map((f) => ({ label: f.label.trim(), value: f.value.trim() }))
    .filter((f) => f.label || f.value);
  if (!bio && !currentProfileGender && !quotes.length && !custom.length) return null;
  return {
    bio: bio || null,
    // Пол убран из редактора (нечем и незачем каждому заполнять) – но
    // раз уже стоял у записи, при пересохранении не стираем его молча,
    // только показать в форме больше негде.
    gender: currentProfileGender || null,
    quotes: quotes.length ? quotes : null,
    custom: custom.length ? custom : null,
  };
}

// ── Тайтлы: связь с отзывами ──────────────────────
// Хранится как linkedReviewIds (id из reviews.json) – без отдельной
// сущности под саму связь, id вполне достаточно: полные данные
// (обложка, название) при рендере каждый раз берутся заново из
// cache.reviews (fetchReviews() ниже), не дублируются в favorites.json.
function renderLinkedTitles() {
  const box = document.getElementById("linked-titles-list");
  if (!box) return;
  const reviews = linkedReviewIds
    .map((id) => (cache.reviews || []).find((r) => r.id === id))
    .filter(Boolean);
  box.innerHTML = reviews.length
    ? reviews
        .map(
          (r) => `
    <div class="linked-title-chip" draggable="true" data-id="${r.id}" title="${i18n("Перетащить")}">
      <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="" loading="lazy">
      <span>${esc(r.title)}</span>
      <button type="button" class="linked-title-del" title="${i18n("Удалить")}" onclick="removeLinkedTitle(${r.id})">✕</button>
    </div>`
        )
        .join("")
    : `<div class="linked-titles-empty">${i18n("Пока нет привязанных тайтлов.")}</div>`;
  bindLinkedTitleDnd(box);
}

// Порядок привязанных тайтлов – тот же приём перетаскивания, что и у
// entry-row/bindFavDnd выше, только сравнение «до/после» идёт по X, а
// не Y: карточки лежат в ряд (flex-wrap), а не столбиком.
let titleDragSrc = null;

function bindLinkedTitleDnd(box) {
  box.querySelectorAll(".linked-title-chip").forEach((chip) => {
    chip.addEventListener("dragstart", () => {
      titleDragSrc = chip;
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => {
      box.querySelectorAll(".linked-title-chip").forEach((el) => el.classList.remove("dragging", "drag-over"));
      titleDragSrc = null;
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!titleDragSrc || chip === titleDragSrc) return;
      box.querySelectorAll(".linked-title-chip").forEach((el) => el.classList.remove("drag-over"));
      chip.classList.add("drag-over");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("drag-over"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("drag-over");
      if (!titleDragSrc || chip === titleDragSrc) return;

      const srcId = Number(titleDragSrc.dataset.id);
      const targetId = Number(chip.dataset.id);
      const srcIdx = linkedReviewIds.indexOf(srcId);
      let targetIdx = linkedReviewIds.indexOf(targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = chip.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;

      linkedReviewIds.splice(srcIdx, 1);
      targetIdx = linkedReviewIds.indexOf(targetId);
      linkedReviewIds.splice(before ? targetIdx : targetIdx + 1, 0, srcId);
      renderLinkedTitles();
    });
  });
}

function removeLinkedTitle(id) {
  linkedReviewIds = linkedReviewIds.filter((x) => x !== id);
  renderLinkedTitles();
}

let titleLinkModalEl = null;

function titleLinkModalEnsure() {
  if (titleLinkModalEl) return titleLinkModalEl;
  titleLinkModalEl = document.createElement("div");
  titleLinkModalEl.id = "title-link-modal-overlay";
  titleLinkModalEl.className = "modal-overlay hidden";
  titleLinkModalEl.innerHTML = `
    <div class="modal">
      <button class="modal-close" type="button" onclick="closeTitleLinkSearch()">✕</button>
      <div class="modal-title">${i18n("Добавить источник")}</div>
      <input type="text" id="title-link-search" class="fav-title-search" placeholder="${i18n("Название тайтла...")}" oninput="renderTitleLinkResults()">
      <div id="title-link-results" class="linked-titles-results"></div>
    </div>`;
  document.body.appendChild(titleLinkModalEl);
  titleLinkModalEl.onclick = (e) => {
    if (e.target === titleLinkModalEl) closeTitleLinkSearch();
  };
  return titleLinkModalEl;
}

async function openTitleLinkSearch() {
  const overlay = titleLinkModalEnsure();
  await fetchReviews();
  overlay.classList.remove("hidden");
  const input = document.getElementById("title-link-search");
  input.value = "";
  renderTitleLinkResults();
  input.focus();
}

function closeTitleLinkSearch() {
  titleLinkModalEl?.classList.add("hidden");
}

function renderTitleLinkResults() {
  const box = document.getElementById("title-link-results");
  if (!box) return;
  const q = (document.getElementById("title-link-search")?.value || "").trim().toLowerCase();
  const results = (cache.reviews || [])
    .filter((r) => !linkedReviewIds.includes(r.id))
    .filter((r) => !q || r.title.toLowerCase().includes(q))
    .slice(0, 30);
  box.innerHTML = results.length
    ? results
        .map(
          (r) => `
    <div class="linked-title-result" onclick="addLinkedTitle(${r.id})">
      <img src="${esc(r.cover || r.cover_backup || PH_TALL)}" alt="" loading="lazy">
      <span>${esc(r.title)}</span>
    </div>`
        )
        .join("")
    : `<div class="linked-titles-empty">${i18n("Ничего не найдено")}</div>`;
}

function addLinkedTitle(id) {
  if (!linkedReviewIds.includes(id)) linkedReviewIds.push(id);
  renderLinkedTitles();
  closeTitleLinkSearch();
}

// ── Связи с другими сущностями «Любимого» ─────────
// В отличие от «Тайтлы» (всегда reviews.json), здесь целью может быть
// запись ЛЮБОГО раздела «Любимого» – сэйю к персонажу, персонаж к
// автору, что угодно, включая свои разделы. Раздел (не «сущность») и
// определяет группу: один блок «Персонажи»/«Персоны»/«Составы» на
// каждый существующий раздел, кроме самих Тайтлов (у них уже есть своя
// секция выше). Список берём из тех же данных, что уже загружены для
// самого списка записей внизу страницы (allEntries) – отдельно
// спрашивать нечего.
function favLinkGroups() {
  const overrides = window.SITE_LABEL_OVERRIDES?.favTypes || {};
  const builtins = [
    { id: "character", label: overrides.character || i18n("Персонажи"), addLabel: i18n("Добавить персонажа") },
    { id: "person", label: overrides.person || i18n("Персоны"), addLabel: i18n("Добавить персону") },
  ];
  const custom = favCustomCollections().map((c) => ({
    id: c.id,
    label: c.label,
    addLabel: i18n("Добавить запись"),
  }));
  return [...builtins, ...custom];
}

function renderLinkedFavoriteGroups() {
  const box = document.getElementById("linked-favorites-groups");
  if (!box) return;
  box.innerHTML = favLinkGroups()
    .map(
      (g) => `
    <h2 class="section-title">${esc(g.label)}</h2>
    <div id="linked-fav-list-${esc(g.id)}" class="linked-titles-list"></div>
    <button type="button" class="btn btn-ghost" onclick="openFavoriteLinkSearch('${esc(g.id)}')">${esc(g.addLabel)}</button>
  `
    )
    .join("");
  favLinkGroups().forEach((g) => renderLinkedFavoritesGroup(g.id));
}

function renderLinkedFavoritesGroup(groupId) {
  const box = document.getElementById(`linked-fav-list-${groupId}`);
  if (!box) return;
  const entries = linkedFavoriteIds
    .map((id) => allEntries.find((e) => e.id === id))
    .filter((e) => e && e.type === groupId);
  box.innerHTML = entries.length
    ? entries
        .map(
          (e) => `
    <div class="linked-title-chip linked-fav-chip" draggable="true" data-id="${e.id}" data-group="${esc(groupId)}" title="${i18n("Перетащить")}">
      <img src="${esc(e.image || e.image_backup || PH_SQ)}" alt="" loading="lazy">
      <span>${esc(e.name)}</span>
      <button type="button" class="linked-title-del" title="${i18n("Удалить")}" onclick="removeLinkedFavorite(${e.id})">✕</button>
    </div>`
        )
        .join("")
    : `<div class="linked-titles-empty">${i18n("Пока ничего не привязано.")}</div>`;
  bindLinkedFavoriteDnd(box);
}

let favLinkDragSrc = null;

function bindLinkedFavoriteDnd(box) {
  box.querySelectorAll(".linked-fav-chip").forEach((chip) => {
    chip.addEventListener("dragstart", () => {
      favLinkDragSrc = chip;
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => {
      box.querySelectorAll(".linked-fav-chip").forEach((el) => el.classList.remove("dragging", "drag-over"));
      favLinkDragSrc = null;
    });
    chip.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!favLinkDragSrc || chip === favLinkDragSrc) return;
      box.querySelectorAll(".linked-fav-chip").forEach((el) => el.classList.remove("drag-over"));
      chip.classList.add("drag-over");
    });
    chip.addEventListener("dragleave", () => chip.classList.remove("drag-over"));
    chip.addEventListener("drop", (e) => {
      e.preventDefault();
      chip.classList.remove("drag-over");
      if (!favLinkDragSrc || chip === favLinkDragSrc) return;

      const srcId = Number(favLinkDragSrc.dataset.id);
      const targetId = Number(chip.dataset.id);
      const srcIdx = linkedFavoriteIds.indexOf(srcId);
      let targetIdx = linkedFavoriteIds.indexOf(targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = chip.getBoundingClientRect();
      const before = e.clientX < rect.left + rect.width / 2;

      linkedFavoriteIds.splice(srcIdx, 1);
      targetIdx = linkedFavoriteIds.indexOf(targetId);
      linkedFavoriteIds.splice(before ? targetIdx : targetIdx + 1, 0, srcId);
      renderLinkedFavoritesGroup(chip.dataset.group);
    });
  });
}

function removeLinkedFavorite(id) {
  const entry = allEntries.find((e) => e.id === id);
  linkedFavoriteIds = linkedFavoriteIds.filter((x) => x !== id);
  if (entry) renderLinkedFavoritesGroup(entry.type);
}

let favoriteLinkModalEl = null;
let favoriteLinkGroupId = null;

function favoriteLinkModalEnsure() {
  if (favoriteLinkModalEl) return favoriteLinkModalEl;
  favoriteLinkModalEl = document.createElement("div");
  favoriteLinkModalEl.id = "favorite-link-modal-overlay";
  favoriteLinkModalEl.className = "modal-overlay hidden";
  favoriteLinkModalEl.innerHTML = `
    <div class="modal">
      <button class="modal-close" type="button" onclick="closeFavoriteLinkSearch()">✕</button>
      <div class="modal-title" id="favorite-link-modal-title"></div>
      <input type="text" id="favorite-link-search" class="fav-title-search" placeholder="${i18n("Имя...")}" oninput="renderFavoriteLinkResults()">
      <div id="favorite-link-results" class="linked-titles-results"></div>
    </div>`;
  document.body.appendChild(favoriteLinkModalEl);
  favoriteLinkModalEl.onclick = (e) => {
    if (e.target === favoriteLinkModalEl) closeFavoriteLinkSearch();
  };
  return favoriteLinkModalEl;
}

function openFavoriteLinkSearch(groupId) {
  favoriteLinkGroupId = groupId;
  const overlay = favoriteLinkModalEnsure();
  const group = favLinkGroups().find((g) => g.id === groupId);
  document.getElementById("favorite-link-modal-title").textContent = group ? group.addLabel : i18n("Добавить");
  overlay.classList.remove("hidden");
  const input = document.getElementById("favorite-link-search");
  input.value = "";
  renderFavoriteLinkResults();
  input.focus();
}

function closeFavoriteLinkSearch() {
  favoriteLinkModalEl?.classList.add("hidden");
}

function renderFavoriteLinkResults() {
  const box = document.getElementById("favorite-link-results");
  if (!box) return;
  const q = (document.getElementById("favorite-link-search")?.value || "").trim().toLowerCase();
  const results = allEntries
    .filter((e) => e.type === favoriteLinkGroupId)
    .filter((e) => e.id !== favEditingId)
    .filter((e) => !linkedFavoriteIds.includes(e.id))
    .filter((e) => !q || e.name.toLowerCase().includes(q))
    .slice(0, 30);
  box.innerHTML = results.length
    ? results
        .map(
          (e) => `
    <div class="linked-title-result linked-fav-result" onclick="addLinkedFavorite(${e.id})">
      <img src="${esc(e.image || e.image_backup || PH_SQ)}" alt="" loading="lazy">
      <span>${esc(e.name)}</span>
    </div>`
        )
        .join("")
    : `<div class="linked-titles-empty">${i18n("Ничего не найдено")}</div>`;
}

function addLinkedFavorite(id) {
  if (!linkedFavoriteIds.includes(id)) linkedFavoriteIds.push(id);
  renderLinkedFavoritesGroup(favoriteLinkGroupId);
  closeFavoriteLinkSearch();
}

function onTypeChange() {
  const isPerson = document.getElementById("f-type").value === "person";
  document.getElementById("field-subtype").classList.toggle("visible", isPerson);
  document.getElementById("field-from").classList.toggle("hidden-field", isPerson);
  if (isPerson) document.getElementById("f-from").value = "";
}

function previewAvatar(url) {
  const img = document.getElementById("avatar-img");
  // Раньше проверялось только url.startsWith("http") – из-за этого
  // превью пропадало для уже загруженных с компьютера картинок:
  // относительный путь вида "/favorites/xxx.webp" такой проверке не
  // проходил (см. тот же разбор у previewCover() в add-cover.js).
  if (url && url.trim()) {
    img.src = url;
    img.style.objectPosition = document.getElementById("f-image-focus")?.value || "50% 50%";
    img.style.display = "block";
  } else img.style.display = "none";
}

function openFocusPickerForAvatar() {
  const url = document.getElementById("f-image-backup").value.trim() || document.getElementById("f-image").value.trim();
  if (!url) return;
  openFocusPicker({
    imageUrl: url,
    initial: document.getElementById("f-image-focus").value || "50% 50%",
    shape: "circle",
    onChange: (pos) => {
      document.getElementById("f-image-focus").value = pos;
      document.getElementById("avatar-img").style.objectPosition = pos;
    },
  });
}

// ── Галерея картинок ─────────────────────────────
// Тот же приём, что coverGallery в add-cover.js (см. её же подробный
// комментарий там) – новая ссылка/файл больше не стирает предыдущую
// резервную копию, все копятся здесь, а удаление – только явное, через
// саму галерею (openGalleryModal).
let favImageGallery = [];

function favImageGalleryAdd(url) {
  if (!url || favImageGallery.includes(url)) return;
  favImageGallery.push(url);
}

function openFavImageGallery() {
  if (!favImageGallery.length) return;
  openGalleryModal({
    images: favImageGallery,
    active: document.getElementById("f-image-backup").value.trim() || null,
    onSelect: (url) => {
      document.getElementById("f-image").value = "";
      document.getElementById("f-image-backup").value = url || "";
      // Точка фокуса привязана к тому, что сейчас активно, а не к
      // конкретному файлу навсегда – при смене картинки на другую
      // сбрасываем в центр, а не тащим старую точку на новую картинку.
      document.getElementById("f-image-focus").value = "50% 50%";
      previewAvatar(url);
    },
    onDelete: async (url) => {
      await deleteMediaFile(url);
      favImageGallery = favImageGallery.filter((u) => u !== url);
    },
  });
}

// Та же переобработка «задним числом», что и onCoverOriginalToggle() в
// add-cover.js: сама галочка ничего не трогает, но если источник ещё
// под рукой (файл не переизбран, ссылка ещё в поле) – прогоняем его
// заново с новым качеством, новая копия добавляется в галерею рядом со
// старой.
async function onImageOriginalToggle() {
  const fileInput = document.getElementById("f-image-upload");
  if (fileInput.files.length) {
    await uploadFavImage();
    return;
  }
  const url = document.getElementById("f-image").value.trim();
  if (url.startsWith("http")) await backupImageNow();
}

async function uploadFavImage() {
  const fileInput = document.getElementById("f-image-upload");
  const status = document.getElementById("image-upload-status");
  if (!fileInput.files.length) {
    status.textContent = i18n("Выберите файл");
    status.style.color = "var(--red-hi, #c0392b)";
    return;
  }
  const name = document.getElementById("f-name").value.trim() || "favorite";
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Обрабатываю...");
  status.style.color = "";
  try {
    const keepOriginal = document.getElementById("f-image-original")?.checked || false;
    const { base64, ext } = await encodeUploadFile(fileInput.files[0], keepOriginal);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "favorites", filename: `${slug}.${ext}`, contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    document.getElementById("f-image").value = "";
    document.getElementById("f-image-backup").value = data.url;
    favImageGalleryAdd(data.url);
    previewAvatar(data.url);
    status.textContent = i18n("Загружено ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

function scheduleBackupImage() {
  clearTimeout(backupImageTimer);
  document.getElementById("f-image-backup").value = "";
  backupImageTimer = setTimeout(backupImageNow, 1200);
}

async function backupImageNow() {
  const url = document.getElementById("f-image").value.trim();
  const status = document.getElementById("image-backup-status");
  if (!url || !url.startsWith("http")) return;

  const name = document.getElementById("f-name").value.trim() || "favorite";
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Делаю резервную копию картинки...");
  status.style.color = "";
  try {
    const original = document.getElementById("f-image-original")?.checked || false;
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug, original }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    document.getElementById("f-image-backup").value = data.url;
    favImageGalleryAdd(data.url);
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

function setFavStatus(type, text) {
  const el = document.getElementById("status");
  el.className = "status-msg" + (type ? " " + type : "");
  el.textContent = text;
}

function resetFavToNew() {
  favEditingId = null;
  favImageGallery = [];
  profileCustomFields = [];
  linkedReviewIds = [];
  linkedFavoriteIds = [];
  renderProfileCustomFields();
  renderLinkedTitles();
  renderLinkedFavoriteGroups();
  document.getElementById("edit-banner").style.display = "none";
  document.getElementById("page-subtitle").textContent = i18n("Персонажи и персоны");
  document.getElementById("btn-save").textContent = i18n("Сохранить");
  currentProfileGender = null;
  [
    "f-name",
    "f-image",
    "f-from",
    "f-image-backup",
    "f-profile-bio",
    "f-profile-quotes",
  ].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("f-image-focus").value = "50% 50%";
  document.getElementById("f-type").value = "character";
  document.getElementById("f-subtype").value = "actor";
  syncFavTypePickerLabel();
  closeFavTypePickerDropdown();
  syncSubtypePickerLabel();
  closeSubtypePickerDropdown();
  document.getElementById("avatar-img").style.display = "none";
  document.getElementById("field-subtype").classList.remove("visible");
  document.getElementById("field-from").classList.remove("hidden-field");
  document.getElementById("field-profile-quotes").classList.add("hidden");
  document.getElementById("add-profile-quotes-btn").classList.remove("hidden");
  document.getElementById("image-backup-status").textContent = "";
  document.getElementById("image-upload-status").textContent = "";
  document.getElementById("f-image-upload").value = "";
  setFavStatus("", "");
}

function fillFavForm(r) {
  document.getElementById("f-name").value = r.name || "";
  document.getElementById("f-image").value = r.image || "";
  document.getElementById("f-image-backup").value = r.image_backup || "";
  document.getElementById("f-image-focus").value = r.image_focus || "50% 50%";
  favImageGallery = r.image_gallery?.length
    ? [...r.image_gallery]
    : r.image_backup
      ? [r.image_backup]
      : [];
  document.getElementById("f-from").value = r.from || "";
  document.getElementById("f-profile-bio").value = r.profile?.bio || "";
  currentProfileGender = r.profile?.gender || null;
  document.getElementById("f-profile-quotes").value = (r.profile?.quotes || []).join("\n");
  document.getElementById("field-profile-quotes").classList.toggle("hidden", !r.profile?.quotes?.length);
  document.getElementById("add-profile-quotes-btn").classList.toggle(
    "hidden",
    !!r.profile?.quotes?.length
  );
  profileCustomFields = r.profile?.custom?.length ? r.profile.custom.map((f) => ({ ...f })) : [];
  renderProfileCustomFields();
  linkedReviewIds = r.linked_review_ids?.length ? [...r.linked_review_ids] : [];
  renderLinkedTitles();
  linkedFavoriteIds = r.linked_favorite_ids?.length ? [...r.linked_favorite_ids] : [];
  renderLinkedFavoriteGroups();
  document.getElementById("f-type").value = r.type || "character";
  document.getElementById("f-subtype").value = r.subtype || "actor";
  syncFavTypePickerLabel();
  closeFavTypePickerDropdown();
  syncSubtypePickerLabel();
  closeSubtypePickerDropdown();
  document.getElementById("image-backup-status").textContent = "";
  document.getElementById("image-upload-status").textContent = "";
  document.getElementById("f-image-upload").value = "";
  // Внешняя ссылка (r.image) обычно пуста у картинок, загруженных с
  // компьютера, – превью в этом случае берём из уже сделанной
  // резервной копии, иначе оно пропадало бы при каждом повторном входе
  // в редактор (см. её же историю в previewAvatar() выше).
  previewAvatar(r.image || r.image_backup || "");
  onTypeChange();
}

function favTypeLabel(type, subtype) {
  const overrides = window.SITE_LABEL_OVERRIDES?.favTypes || {};
  if (type === "person") return SUBTYPE_LABELS[subtype] || overrides.person || i18n("Персона");
  if (type === "character") return overrides.character || i18n("Персонаж");
  return (favCustomCollections().find((c) => c.id === type) || {}).label || type;
}

function renderGroup(type, list) {
  const container = document.getElementById(`entries-list-${type}`);
  if (!container) return;
  if (!list.length) {
    container.innerHTML = `<div class="entries-empty">${i18n("Пока пусто")}</div>`;
    return;
  }
  container.innerHTML = list
    .map((r) => {
      // Тип строкой у каждой записи имеет смысл только когда он и правда
      // отличается от записи к записи – роль персоны (Автор/Режиссёр/…).
      // У персонажей и у своих разделов favTypeLabel() всегда возвращает
      // одно и то же для всей группы – ровно то же, что уже написано в
      // заголовке divider-title над списком, повторять это на каждой
      // строке было чистым шумом.
      const typeLabel = r.type === "person" ? favTypeLabel(r.type, r.subtype) : null;
      return `
    <div class="entry-row" data-id="${r.id}" data-group="${type}" draggable="true">
      <span class="entry-drag-handle" title="${i18n("Перетащить")}">⠿</span>
      <img class="entry-avatar" src="${esc(r.image || r.image_backup || "")}" style="object-position:${esc(r.image_focus || "50% 50%")}" data-hide-on-error alt="">
      <div class="entry-name">${esc(r.name)}</div>
      <div class="entry-meta">
        ${r.from ? `<div class="entry-type">${esc(r.from)}</div>` : ""}
        ${typeLabel ? `<div class="entry-type">${esc(typeLabel)}</div>` : ""}
      </div>
      <button class="entry-edit" onclick="startEdit(${r.id})">${i18n("✎ Изменить")}</button>
      <button class="entry-del" title="${i18n("Удалить")}" onclick="event.stopPropagation(); deleteFavEntry(${r.id})">✕</button>
    </div>`;
    })
    .join("");
  bindFavDnd(container);
}

function renderCustomGroupContainers() {
  const wrap = document.getElementById("entries-groups-custom");
  wrap.innerHTML = favCustomCollections()
    .map(
      (c) => `
    <div class="divider-title">${esc(c.label)}</div>
    <div class="entries-list" id="entries-list-${esc(c.id)}"></div>
  `
    )
    .join("");
}

function renderList() {
  renderCustomGroupContainers();
  Object.keys(groupLists).forEach((type) => renderGroup(type, groupLists[type]));

  document.getElementById("persons-title").style.display =
    groupLists.person.length || groupLists.character.length ? "flex" : "none";

  const totalCount = Object.values(groupLists).reduce((n, l) => n + l.length, 0);
  const btn = document.getElementById("btn-save-order");
  const hint = document.getElementById("order-hint");
  btn.classList.toggle("visible", orderDirty);
  hint.classList.toggle("visible", totalCount > 1);
}

function bindFavDnd(container) {
  container.querySelectorAll(".entry-row").forEach((row) => {
    row.addEventListener("dragstart", () => {
      favDragSrc = row;
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".entry-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      favDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!favDragSrc || row === favDragSrc || row.dataset.group !== favDragSrc.dataset.group) return;
      container.querySelectorAll(".entry-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!favDragSrc || row === favDragSrc || row.dataset.group !== favDragSrc.dataset.group) return;

      const group = row.dataset.group;
      const list = groupLists[group];
      if (!list) return;
      const srcId = Number(favDragSrc.dataset.id);
      const targetId = Number(row.dataset.id);
      const srcIdx = list.findIndex((r) => r.id === srcId);
      let targetIdx = list.findIndex((r) => r.id === targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      const [moved] = list.splice(srcIdx, 1);
      targetIdx = list.findIndex((r) => r.id === targetId);
      list.splice(before ? targetIdx : targetIdx + 1, 0, moved);

      orderDirty = true;
      renderList();
    });
  });
}

async function loadList() {
  try {
    const res = await fetch("/favorites.json?_=" + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    if (!data.length) return;

    allEntries = data;
    groupLists = { character: [], person: [] };
    favCustomCollections().forEach((c) => {
      groupLists[c.id] = [];
    });
    Object.keys(groupLists).forEach((type) => {
      groupLists[type] = data.filter((r) => r.type === type);
    });
    orderDirty = false;
    document.getElementById("list-header").style.display = "flex";
    renderList();
  } catch {
    // нет файла/сети – список просто останется пустым
  }
}

async function startEdit(id) {
  const entry = allEntries.find((r) => r.id === id);
  if (!entry) return;
  favEditingId = entry.id;
  fillFavForm(entry);
  document.getElementById("edit-banner").style.display = "flex";
  document.getElementById("edit-name-hint").textContent = entry.name;
  document.getElementById("page-subtitle").textContent = i18n("Редактировать запись");
  document.getElementById("btn-save").textContent = i18n("Сохранить изменения");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Удаление самой записи (персонажа/персоны) – прямо из строки списка,
// тем же приёмом, что у ✕ на карточках чар-листа (char-card-del) и
// у тайтлов (title-item-del) в /chars-edit: без похода в форму
// редактирования. Бэкенд уже это умел (saveFavorite → body._delete в
// core/api.js) – не хватало только кнопки и обработчика здесь.
async function deleteFavEntry(id) {
  const entry = allEntries.find((r) => r.id === id);
  const name = entry?.name || i18n("эту запись");
  if (!(await confirmDialog(i18n("Удалить «{name}»?", { name })))) return;
  try {
    const res = await fetch("/api/save-favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ _delete: id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || i18n("неизвестная"));
    // Запись удалена по подтверждённому ответу сервера – все картинки её
    // галереи (не только текущую) теперь точно ничьи, раньше этого
    // момента удалять было нельзя (см. её же логику в saveReview()/
    // add-save.js). В отличие от смены картинки при редактировании,
    // здесь удаляется вся запись целиком – оставлять её галерею
    // сиротами на диске смысла нет.
    const orphaned = new Set(entry?.image_gallery || []);
    if (entry?.image_backup) orphaned.add(entry.image_backup);
    orphaned.forEach((url) => deleteMediaFile(url));
    // Если удалили ту самую запись, что сейчас открыта в форме –
    // форма показывала бы то, чего уже нет.
    if (favEditingId === id) resetFavToNew();
    await loadList();
    // «Любимое» под этим маршрутом ещё показывала бы удалённую запись,
    // пока по ней не щёлкнуть заново – вкладка сама не перечитается,
    // пока открыт /favorites-edit поверх неё (см. js/api.js).
    refreshOpenReviewsTab();
    setFavStatus("ok", i18n("«{name}» удалена.", { name }));
  } catch (err) {
    setFavStatus("err", i18n("Не удалось удалить: ") + err.message);
  }
}

async function saveFavOrder() {
  const btn = document.getElementById("btn-save-order");
  btn.disabled = true;
  btn.textContent = i18n("Сохраняем…");

  const favNewOrder = Object.values(groupLists).flat().map((r) => r.id);

  try {
    const res = await fetch("/api/save-favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ _reorder: favNewOrder }),
    });
    const data = await res.json();
    if (res.ok) {
      orderDirty = false;
      btn.classList.remove("visible");
      document.getElementById("order-hint").classList.remove("visible");
      setFavStatus("ok", i18n("Порядок сохранён."));
      // Тот же сброс, что и при удалении выше.
      refreshOpenReviewsTab();
    } else {
      setFavStatus("err", i18n("Ошибка: ") + (data.error || i18n("неизвестная")));
    }
  } catch (e) {
    setFavStatus("err", i18n("Ошибка сети: ") + e.message);
  }

  btn.disabled = false;
  btn.textContent = i18n("Сохранить порядок");
}

async function saveEntry() {
  const btn = document.getElementById("btn-save");
  const name = document.getElementById("f-name").value.trim();
  if (!name) {
    setFavStatus("err", i18n("Заполните имя"));
    return;
  }

  const type = document.getElementById("f-type").value;

  const imageUrl = document.getElementById("f-image").value.trim();
  if (imageUrl && imageUrl.startsWith("http") && !document.getElementById("f-image-backup").value) {
    clearTimeout(backupImageTimer);
    setFavStatus("", i18n("Делаю резервную копию картинки перед сохранением..."));
    await backupImageNow();
  }

  const entry = {
    name,
    type,
    image: imageUrl || null,
    image_backup: document.getElementById("f-image-backup").value.trim() || null,
    // null вместо "50% 50%" – это ровно то же самое, что и центр по
    // умолчанию (object-position без него), не нужно раздувать
    // favorites.json значением, ничего не меняющим.
    image_focus:
      document.getElementById("f-image-focus").value.trim() !== "50% 50%"
        ? document.getElementById("f-image-focus").value.trim()
        : null,
    // Все резервные копии, когда-либо сделанные для этой записи – см.
    // favImageGallery выше (тот же приём, что cover_gallery у отзывов,
    // add-save.js).
    image_gallery: favImageGallery.length ? favImageGallery : null,
    from: document.getElementById("f-from").value.trim() || null,
    profile: buildProfileField(),
    linked_review_ids: linkedReviewIds.length ? [...linkedReviewIds] : null,
    // Свой же id сюда попасть не должен (поиск его и так не предлагает,
    // это просто подстраховка на случай правки другим путём).
    linked_favorite_ids: linkedFavoriteIds.filter((id) => id !== favEditingId).length
      ? linkedFavoriteIds.filter((id) => id !== favEditingId)
      : null,
  };
  if (type === "person") {
    entry.subtype = document.getElementById("f-subtype").value || null;
  }
  if (favEditingId !== null) entry._editId = favEditingId;

  btn.disabled = true;
  btn.textContent = i18n("Сохраняем…");
  setFavStatus("", "");

  try {
    const res = await fetch("/api/save-favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(entry),
    });
    const data = await res.json();
    if (res.ok) {
      setFavStatus("ok", favEditingId !== null ? `«${name}» обновлён.` : `«${name}» сохранён.`);
      // Раньше здесь удаляли прежнюю резервную копию, если после
      // сохранения активной стала другая, – с галереей картинок это
      // больше не годится, см. тот же разбор у saveReview() в
      // add-save.js. Явное удаление – только через саму галерею.
      if (favEditingId === null) resetFavToNew();
      // Тот же сброс, что при удалении и смене порядка выше.
      refreshOpenReviewsTab();
      setTimeout(loadList, 2000);
    } else {
      setFavStatus("err", i18n("Ошибка: ") + (data.error || i18n("неизвестная")));
    }
  } catch (e) {
    setFavStatus("err", i18n("Ошибка сети: ") + e.message);
  }

  btn.disabled = false;
  btn.textContent = favEditingId !== null ? i18n("Сохранить изменения") : i18n("Сохранить");
}

registerRoute("#/favorites-edit", { mount, unmount });
