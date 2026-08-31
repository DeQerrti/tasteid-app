// ══════════════════════════════════════════════
//  РОУТ #/favorites-edit — редактор «Любимого»
//  (см. план перехода на SPA, фаза 3.2)
//
//  Как и #/chars-edit (js/routes/chars-edit.js), НЕ завёрнут в IIFE —
//  разметка и рендер списков (renderGroup/renderSubtypePickerDropdown)
//  вызывают друг друга через инлайновые onclick="funcName(...)", и
//  превращать их в вызовы через объект-неймспейс ради самой процедуры
//  переноса — риск опечатки на ровном месте. Верхнеуровневые имена уже
//  однажды переименовывались в фазе 0 (см. её же коммит) именно чтобы
//  не столкнуться с add.html/reviews-order.html — здесь та же
//  страховка: scripts/check-duplicate-functions.js (npm run check).
//
//  На document — три постоянных слушателя не самой страницы, а именно
//  document (click вне дропдауна, tags-map-updated, site-labels-ready)
//  плюс keydown для «Esc уходит с маршрута» — все сняты в unmount().
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

function feOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  feCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container) {
  fePrevTitle = document.title;
  favEditingId = null;
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
        <div>Режим редактирования — <span class="edit-banner-title" id="edit-name-hint"></span></div>
        <button class="btn-new" onclick="resetFavToNew()">${i18n("Новая запись")}</button>
      </div>

      <h2 class="section-title">${i18n("Основное")}</h2>
      <div class="grid">
        <div class="field">
          <label>${i18n("Имя *")}</label>
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
          <img id="avatar-img" class="avatar-preview">
          <div id="image-backup-status" style="font-size:.8rem;margin-top:.4rem;"></div>
        </div>
        <div class="field full">
          <label>${i18n("Или загрузить с компьютера")}</label>
          <label class="btn btn-ghost file-btn">
            <input type="file" id="f-image-upload" accept="image/*" onchange="updateFileBtnName(this)">
            <span>${i18n("Выбрать файл")}</span>
          </label>
          <span class="file-btn-name" id="f-image-upload-name"></span>
          <button type="button" class="btn-new" style="margin-top:.5rem;margin-left:.5rem" onclick="uploadFavImage()">${i18n("Загрузить и использовать")}</button>
          <div id="image-upload-status" style="font-size:.8rem;margin-top:.4rem;"></div>
        </div>
        <div class="field full" id="field-from">
          <label>${i18n("Откуда (необязательно)")}</label>
          <input type="text" id="f-from" placeholder="${i18n("Из какого произведения")}">
        </div>
      </div>

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

      <div class="order-hint" id="order-hint">${i18n("Перетащи за ⠿, чтобы изменить порядок, затем нажми «Сохранить порядок»")}</div>
    </main>`;

  feOn(document.getElementById("fe-back"), "click", (e) => {
    e.preventDefault();
    leaveRoute();
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
  // Esc, открыт ли дропдаун роли — тогда ничего не делаем (тот же выбор,
  // что раньше был в enableEscapeToLeave(".src-type-dropdown:not(.hidden)")
  // из utils.js: Escape сам дропдаун не закрывает, просто не даёт уйти
  // со страницы, пока он открыт). Иначе — уходим с маршрута.
  feOn(document, "keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector(".src-type-dropdown:not(.hidden)")) return;
    leaveRoute();
  });

  document.title = `TasteID — ${i18n("Персонажи и персоны")}`;

  // Раньше единственным триггером первой загрузки списка/типов было
  // событие "site-labels-ready" от theme.js — на отдельной странице
  // оно срабатывало заново при каждом полном заходе. Под SPA-оболочкой
  // applyTheme() выполняется один раз за всё время жизни документа
  // (см. её же комментарий в router.js) — событие уже отгремело
  // задолго до того, как этот маршрут вообще замонтировался, и одной
  // лишь подписки выше недостаточно. Вызываем явно; подписка остаётся
  // на случай, если настройки правда поменяются, пока маршрут открыт.
  syncFavTypePickerLabel();
  await loadList();
}

function unmount() {
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
      <input type="text" id="subtype-picker-new-name" placeholder="${i18n("Например: Продюсер")}">
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
    statusEl.textContent = i18n("Введи название роли");
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

// Переименование роли — тот же приём, что у типа тайтла в add.html
// (startRenameTypePicker): клик по ✎ подменяет подпись на текстовое
// поле прямо в строке списка, Enter/уход фокуса сохраняют, Esc
// отменяет. Встроенная роль переименовывается через labels.subtypes
// (оверрайд подписи, ключ в SUBTYPE_BUILTINS не меняется), своя —
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

// ── Тип записи («Персонаж»/«Персона» + свои разделы) — тот же паттерн
//    выпадающего списка с инлайн-добавлением, что у роли персоны
//    (см. блок «Роль персоны» выше). Свои типы — это те же разделы
//    «Любимого» (favCollections), что заводятся в /settings-edit;
//    добавленный отсюда сразу появляется там и наоборот. Встроенные
//    типы (character/person) теперь тоже переименовываются и
//    скрываются — тем же приёмом, что источники в add.html и роли
//    выше: подпись живёт в labels.favTypes, скрытие — в
//    hiddenFavTypes. Скрытие built-in типа — НЕ то же самое, что
//    удаление своего раздела: раздел «Персонажи»/«Персоны» на вкладке
//    «Любимое» устроен отдельным, всегда существующим блоком
//    разметки (js/favorites.js), а не циклом по favCollections, и
//    прячется своим отдельным тумблером (hiddenFavSections, тот же
//    глазок, что и у остальных секций, в /settings-edit). Скрытие
//    типа здесь означает только «нельзя выбрать/создать новую запись
//    этого типа» — уже существующие персонажи/персоны никуда не
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
      <input type="text" id="fav-type-picker-new-name" placeholder="${i18n("Например: Локации")}">
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
    statusEl.textContent = i18n("Введи название типа");
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

  // slugify() — из js/routes/settings-edit.js, тот же формат id, что
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
          "Скрыть тип «{name}» из списка?\n\nУже добавленные персонажи и персоны останутся на вкладке «Любимое» как есть — пропадёт только возможность выбрать этот тип для новой или редактируемой записи. Вернуть можно здесь же.",
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

  if (
    !(await confirmDialog(
      i18n(
        "Удалить раздел «{name}»?\n\nЗаписи останутся в данных, но перестанут показываться. Вернуть раздел можно здесь же.",
        { name: label }
      )
    ))
  ) {
    return;
  }
  try {
    await patchSiteSettings((settings) => {
      settings.favCollections = (settings.favCollections || []).filter((c) => c.id !== id);
    });
    window.SITE_FAV_COLLECTIONS = favCustomCollections().filter((c) => c.id !== id);
    delete groupLists[id];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (favTypePickerOpen) renderFavTypePickerDropdown();
    if (document.getElementById("f-type").value === id) selectFavTypePicker("character");
    renderList();
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование — тот же инлайн-приём, что у роли персоны
// (startRenameSubtypePicker). Встроенный тип пишет подпись в
// labels.favTypes (ключ character/person не меняется), свой раздел
// правит label прямо в объекте внутри favCollections — та же запись,
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

function onTypeChange() {
  const isPerson = document.getElementById("f-type").value === "person";
  document.getElementById("field-subtype").classList.toggle("visible", isPerson);
  document.getElementById("field-from").classList.toggle("hidden-field", isPerson);
  if (isPerson) document.getElementById("f-from").value = "";
}

function previewAvatar(url) {
  const img = document.getElementById("avatar-img");
  if (url && url.startsWith("http")) {
    img.src = url;
    img.style.display = "block";
  } else img.style.display = "none";
}

function convertImageToWebp(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const maxSide = Math.max(width, height);
      if (maxSide > 1200) {
        const scale = 1200 / maxSide;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error(i18n("Не удалось сконвертировать")));
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        "image/webp",
        0.85
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function uploadFavImage() {
  const fileInput = document.getElementById("f-image-upload");
  const status = document.getElementById("image-upload-status");
  if (!fileInput.files.length) {
    status.textContent = i18n("Выбери файл");
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
    const base64 = await convertImageToWebp(fileInput.files[0]);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "favorites", filename: slug + ".webp", contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    document.getElementById("f-image").value = "";
    document.getElementById("f-image-backup").value = "/" + data.path;
    previewAvatar("/" + data.path);
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
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    document.getElementById("f-image-backup").value = data.url || "/" + data.path;
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
  document.getElementById("edit-banner").style.display = "none";
  document.getElementById("page-subtitle").textContent = i18n("Персонажи и персоны");
  document.getElementById("btn-save").textContent = i18n("Сохранить");
  ["f-name", "f-image", "f-from", "f-image-backup"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("f-type").value = "character";
  document.getElementById("f-subtype").value = "actor";
  syncFavTypePickerLabel();
  closeFavTypePickerDropdown();
  syncSubtypePickerLabel();
  closeSubtypePickerDropdown();
  document.getElementById("avatar-img").style.display = "none";
  document.getElementById("field-subtype").classList.remove("visible");
  document.getElementById("field-from").classList.remove("hidden-field");
  document.getElementById("image-backup-status").textContent = "";
  document.getElementById("image-upload-status").textContent = "";
  document.getElementById("f-image-upload").value = "";
  setFavStatus("", "");
}

function fillFavForm(r) {
  document.getElementById("f-name").value = r.name || "";
  document.getElementById("f-image").value = r.image || "";
  document.getElementById("f-image-backup").value = r.image_backup || "";
  document.getElementById("f-from").value = r.from || "";
  document.getElementById("f-type").value = r.type || "character";
  document.getElementById("f-subtype").value = r.subtype || "actor";
  syncFavTypePickerLabel();
  closeFavTypePickerDropdown();
  syncSubtypePickerLabel();
  closeSubtypePickerDropdown();
  document.getElementById("image-backup-status").textContent = "";
  document.getElementById("image-upload-status").textContent = "";
  document.getElementById("f-image-upload").value = "";
  previewAvatar(r.image || "");
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
      const typeLabel = favTypeLabel(r.type, r.subtype);
      return `
    <div class="entry-row" data-id="${r.id}" data-group="${type}" draggable="true">
      <span class="entry-drag-handle" title="${i18n("Перетащить")}">⠿</span>
      <img class="entry-avatar" src="${esc(r.image || r.image_backup || "")}" data-hide-on-error alt="">
      <div class="entry-name">${esc(r.name)}</div>
      ${r.from ? `<div class="entry-type">${esc(r.from)}</div>` : ""}
      <div class="entry-type">${esc(typeLabel)}</div>
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
    // нет файла/сети — список просто останется пустым
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

// Удаление самой записи (персонажа/персоны) — прямо из строки списка,
// тем же приёмом, что у ✕ на карточках чар-листа (char-card-del) и
// у тайтлов (title-item-del) в /chars-edit: без похода в форму
// редактирования. Бэкенд уже это умел (saveFavorite → body._delete в
// core/api.js) — не хватало только кнопки и обработчика здесь.
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
    // Если удалили ту самую запись, что сейчас открыта в форме —
    // форма показывала бы то, чего уже нет.
    if (favEditingId === id) resetFavToNew();
    await loadList();
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
    setFavStatus("err", i18n("Заполни имя"));
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
    from: document.getElementById("f-from").value.trim() || null,
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
      if (favEditingId === null) resetFavToNew();
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
