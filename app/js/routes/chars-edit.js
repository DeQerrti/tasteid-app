// ══════════════════════════════════════════════
//  РОУТ #/chars-edit – редактор тир-листов персонажей
//  (см. план перехода на SPA, фаза 3.1)
//
//  В отличие от #/reviews-order (js/routes/reviews-order.js), эта
//  страница НЕ завёрнута в IIFE: разметка перегружена инлайновыми
//  onclick="funcName(...)" (их несколько десятков – редактирование
//  тайтлов, тиров, персонажей, галерея, модалка), и превращать каждый
//  в вызов через объект-неймспейс – риск опечатки на ровном месте при
//  таком объёме правок ради самой процедуры переноса. Вместо этого
//  функции остаются обычными верхнеуровневыми объявлениями, как раньше
//  были в app/chars-edit.html – они и там были permanent-глобалами
//  документа, значит и здесь после подключения на index.html будут
//  ровно тем же самым, просто в объединённой оболочке. Отсутствие
//  коллизий с остальным index.html (rail, вкладки, js/now.js и т.д.)
//  проверяет scripts/check-duplicate-functions.js (npm run check) –
//  вот он и есть настоящая страховка здесь, а не сама обёртка.
//
//  Что всё же обязано жить внутри mount()/unmount(), а не быть
//  постоянным глобалом: два слушателя на document (keydown и
//  site-labels-ready) – они переживают document, а не текущий узел
//  #view-root, и обязаны сниматься при уходе с маршрута, иначе
//  продолжат работать поверх того, что откроется дальше (см. её же
//  предупреждение в router.js). Остальные слушатели в bindTitleDrag()/
//  bindDragDrop() навешаны прямо на элементы внутри #view-root –
//  умирают вместе с ними при innerHTML="" в router.js, отдельно
//  снимать не нужно.
//
//  Параметр коллекции раньше читался из query-строки самого документа
//  (?collection=X) – здесь его больше нет (один документ на всё
//  приложение, адрес меняет только хэш), поэтому его передаёт роутер:
//  #/chars-edit?collection=X разбирается в router.js и приходит вторым
//  аргументом в mount() как URLSearchParams.
//
//  Кнопка «История» (js/backup.js) на этот маршрут не подключена
//  специально: это самозапускающийся IIFE, который вставляет на
//  страницу плавающую кнопку раз и навсегда, а не по вызову – если
//  добавить его сюда, кнопка осталась бы висеть на ГЛАВНОЙ странице
//  всегда, а не только пока открыт этот маршрут. Сам путь до истории
//  версий никуда не делся – Настройки → История версий.
// ══════════════════════════════════════════════

let data = [];
let activeId = null;
let activeListId = null;
let pendingTier = null;
let charsDragSrc = null;
let selectedGalleryImg = null;
let galleryCache = {};
let foldersCache = null;
let editingTitleId = null;
let dropIndicator = null;
let backupTitleCoverTimer = null;
let backupModalImgTimer = null;

let COLLECTION = "characters";
let COLLECTION_LABEL = "Персонажи";
let DATA_FILE = "characters-tier.json";
let ceCleanupFns = [];
let cePrevTitle = null;
let ceDirty = false;

function ceOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  ceCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container, params) {
  cePrevTitle = document.title;
  foldersCache = null;
  galleryCache = {};

  COLLECTION = (params && params.get("collection")) || "characters";
  COLLECTION_LABEL =
    (window.SITE_TIER_COLLECTIONS || []).find((c) => c.id === COLLECTION)?.label ||
    (COLLECTION === "characters" ? "Персонажи" : COLLECTION);
  DATA_FILE = COLLECTION === "characters" ? "characters-tier.json" : `tier-${COLLECTION}.json`;

  container.innerHTML = `
    <header class="app-topbar">
      <a href="#" class="logo topbar-back" id="ce-back"><span class="arrow">&larr;</span>TasteID</a>
      <h1 class="topbar-title" id="header-sub">${esc(COLLECTION_LABEL ? `${i18n("Редактор")}: ${COLLECTION_LABEL}` : "")}</h1>
    </header>
    <main class="ce-view">
      <aside class="sidebar">
        <div>
          <div class="section-label" data-i18n>Тайтлы</div>
          <div class="title-list" id="title-list"></div>
        </div>
        <div class="new-title-form hidden" id="new-title-form">
          <div class="field">
            <label data-i18n>Название тайтла *</label>
            <input type="text" id="nt-name" placeholder="Название" data-i18n-placeholder="Название">
          </div>
          <div class="field">
            <label data-i18n>ID (латиница, без пробелов) *</label>
            <input type="text" id="nt-id" placeholder="korotkij-id">
            <div id="nt-id-hint" style="font-family:'DM Sans',sans-serif;font-size:.6rem;color:var(--text-dim);margin-top:.3rem;display:none" data-i18n>
              ID нельзя менять у существующего тайтла – на него уже могут ссылаться сохранённые данные.
            </div>
          </div>
          <div class="field">
            <label data-i18n>Папка по умолчанию в chars/ *</label>
            <input type="text" id="nt-folder" placeholder="имя-папки" data-i18n-placeholder="имя-папки">
          </div>
          <div class="field">
            <label data-i18n>Обложка (URL)</label>
            <input type="text" id="nt-cover" placeholder="https://..." oninput="scheduleBackupTitleCover()">
            <input type="hidden" id="nt-cover-backup">
            <div id="nt-cover-backup-status" style="font-family:'DM Sans',sans-serif;font-size:.7rem;margin-top:.3rem"></div>
          </div>
          <div class="field">
            <label data-i18n>Или загрузить с компьютера</label>
            <label class="btn btn-ghost file-btn">
              <input type="file" id="nt-cover-upload" accept="image/*" onchange="updateFileBtnName(this)">
              <span data-i18n>Выбрать файл</span>
            </label>
            <span class="file-btn-name" id="nt-cover-upload-name"></span>
            <button class="btn btn-ghost" style="margin-top:.5rem;margin-left:.5rem" onclick="uploadTitleCoverFile()" data-i18n>Загрузить и использовать</button>
            <div id="nt-cover-upload-status" style="font-family:'DM Sans',sans-serif;font-size:.7rem;margin-top:.3rem"></div>
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-primary" id="nt-submit-btn" onclick="submitTitleForm()" data-i18n>Добавить</button>
            <button class="btn btn-ghost" onclick="toggleNewTitleForm(false)" data-i18n>Отмена</button>
          </div>
        </div>
        <button class="btn btn-dashed" id="btn-add-title" onclick="toggleNewTitleForm(true)" data-i18n>Новый тайтл</button>
      </aside>

      <div class="editor" id="editor">
        <div class="editor-empty" data-i18n>Выберите тайтл слева или создайте новый</div>
      </div>
    </main>

    <div class="modal-overlay hidden" id="modal-overlay" onclick="closeModalOnOverlay(event)">
      <div class="modal">
        <button class="modal-close" onclick="closeModal()">✕</button>
        <div class="modal-title" id="modal-title-label" data-i18n>Добавить персонажа</div>

        <div id="folder-field">
          <span class="folder-select-label" data-i18n>Папка (источник)</span>
          <div class="folder-select-wrap">
            <select id="m-folder" onchange="onFolderChange()">
              <option value="" data-i18n>Загружаем…</option>
            </select>
          </div>
        </div>

        <div class="gallery-status" id="gallery-status"></div>
        <div class="gallery-grid" id="gallery-grid"></div>

        <div class="field">
          <label data-i18n>Имя персонажа *</label>
          <input type="text" id="m-name" placeholder="Имя персонажа" data-i18n-placeholder="Имя персонажа">
        </div>

        <span class="manual-toggle" onclick="toggleManual()" data-i18n>Ввести URL вручную</span>
        <div class="manual-section" id="manual-section">
          <div class="field">
            <label data-i18n>URL картинки</label>
            <input type="text" id="m-img" placeholder="https://..." oninput="previewModalImg(this.value); scheduleBackupModalImg();">
            <input type="hidden" id="m-img-backup">
            <img id="m-img-preview" class="img-preview">
            <div id="m-img-backup-status" style="font-size:.75rem;margin-top:.35rem;"></div>
          </div>
        </div>

        <span class="manual-toggle" onclick="toggleUpload()" data-i18n>⬆ Загрузить с компьютера</span>
        <div class="manual-section" id="upload-section">
          <div class="field">
            <label class="btn btn-ghost file-btn">
              <input type="file" id="m-upload-file" accept="image/*" onchange="updateFileBtnName(this)">
              <span data-i18n>Выбрать файл</span>
            </label>
            <span class="file-btn-name" id="m-upload-file-name"></span>
            <button class="btn btn-ghost" style="margin-top:.5rem;margin-left:.5rem" onclick="uploadCharImage()" data-i18n>Загрузить и использовать</button>
            <div id="upload-status" style="font-size:.8rem;margin-top:.4rem;"></div>
          </div>
        </div>

        <div style="display:flex;gap:.5rem;margin-top:.75rem">
          <button class="btn btn-primary" id="m-btn-add" onclick="confirmAddChar()" data-i18n>Добавить</button>
          <button class="btn btn-ghost" onclick="closeModal()" data-i18n>Отмена</button>
        </div>
      </div>
    </div>`;

  document.title = `TasteID – Редактор: ${COLLECTION_LABEL}`;

  ceOn(document.getElementById("ce-back"), "click", (e) => {
    e.preventDefault();
    leaveCharsEdit();
  });

  ceOn(document, "site-labels-ready", () => {
    const label =
      (window.SITE_TIER_COLLECTIONS || []).find((c) => c.id === COLLECTION)?.label ||
      (COLLECTION === "characters" ? "Персонажи" : COLLECTION);
    document.title = `TasteID – Редактор: ${label}`;
    const headerEl = document.getElementById("header-sub");
    if (headerEl) headerEl.textContent = `${i18n("Редактор")}: ${label}`;
  });

  // Esc: сперва закрыть модалку, если она открыта, – только если её
  // не было, уходим с маршрута целиком. capture: true обязателен –
  // js/utils.js вешает свой ГЛОБАЛЬНЫЙ (постоянный, на весь документ)
  // обработчик Escape ещё на этапе загрузки страницы: он кликает по
  // любому открытому .modal-overlay, что само по себе и закрывает
  // модалку через её же onclick="closeModalOnOverlay(event)". Без
  // capture тот обработчик (в фазе всплытия, добавлен раньше) успевал
  // отработать первым и закрыть модалку ДО того, как этот обработчик
  // проверял её состояние – тот же Escape тогда и закрывал модалку, и
  // тут же (застав её уже закрытой) уводил с маршрута одним нажатием.
  // В фазе перехвата (capture) этот обработчик успевает проверить
  // состояние модалки раньше, чем её кто-либо тронет.
  ceOn(
    document,
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        const modalOpen = !document.getElementById("modal-overlay").classList.contains("hidden");
        if (modalOpen) closeModal();
        else leaveCharsEdit();
        // Иначе бы ниже по всплытию всё равно отработал общий
        // обработчик Escape из utils.js – не сломает (закрыть уже
        // закрытую модалку второй раз безопасно), но незачем.
        e.stopPropagation();
        return;
      }
      if (e.key === "Enter" && !document.getElementById("modal-overlay").classList.contains("hidden")) {
        confirmAddChar();
      }
    },
    { capture: true }
  );

  await initCharsEdit();
}

async function leaveCharsEdit() {
  const canLeave = await confirmLeaveIfDirty({
    isDirty: () => ceDirty,
    save: saveAll,
  });
  if (canLeave) leaveRoute();
}

function unmount() {
  ceCleanupFns.forEach((fn) => fn());
  ceCleanupFns = [];
  document.title = cePrevTitle || document.title;
  data = [];
  activeId = null;
  activeListId = null;
  pendingTier = null;
  charsDragSrc = null;
  selectedGalleryImg = null;
  editingTitleId = null;
  ceDirty = false;
  clearTimeout(backupTitleCoverTimer);
  clearTimeout(backupModalImgTimer);
  clearDropIndicator();
}

// ── Drop indicator ──────────────────────────────
function clearDropIndicator() {
  dropIndicator?.remove();
  dropIndicator = null;
}

function getInsertIndex(zone, clientX, clientY) {
  const cards = [...zone.querySelectorAll(".char-card:not(.dragging)")];
  if (!cards.length) return 0;
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (clientY < rect.bottom) {
      if (clientX < rect.left + rect.width / 2) return i;
      const next = cards[i + 1];
      if (!next || next.getBoundingClientRect().top > rect.top) return i + 1;
    }
  }
  return cards.length;
}

function updateDropIndicator(zone, clientX, clientY) {
  clearDropIndicator();
  const idx = getInsertIndex(zone, clientX, clientY);
  const cards = [...zone.querySelectorAll(".char-card:not(.dragging)")];
  dropIndicator = document.createElement("div");
  dropIndicator.className = "drop-indicator";
  const ref = idx < cards.length ? cards[idx] : zone.querySelector(".add-char-btn");
  zone.insertBefore(dropIndicator, ref);
}

// ══ ЗАГРУЗКА ═══════════════════════════════════
async function initCharsEdit() {
  try {
    const res = await fetch(`/${DATA_FILE}?_=` + Date.now());
    if (res.ok) data = await res.json();
    else data = [];
  } catch {
    data = [];
  }
  ceDirty = false;
  renderSidebar();
  if (data.length) selectTitle(data[0].id);
}

// ══ САЙДБАР ════════════════════════════════════
function renderSidebar() {
  const list = document.getElementById("title-list");
  list.innerHTML = data
    .map(
      (t) => `
    <div class="title-item${t.id === activeId ? " active" : ""}" draggable="true" data-title-id="${esc(t.id)}" onclick="selectTitle('${esc(t.id)}')">
      <img class="title-item-cover" src="${esc(t.cover || t.cover_backup || "")}" alt="" data-hide-on-error>
      <div class="title-item-name">${esc(t.title)}</div>
      <button class="title-item-edit" onclick="openEditTitleForm(event,'${esc(t.id)}')" title="${i18n("Редактировать")}">✎</button>
      <button class="title-item-del" onclick="deleteTitle(event,'${esc(t.id)}')" title="${i18n("Удалить")}">✕</button>
    </div>
  `
    )
    .join("");
  bindTitleDrag();
}

function bindTitleDrag() {
  let dragSrcId = null;
  document.querySelectorAll(".title-item[draggable]").forEach((el) => {
    el.addEventListener("dragstart", () => {
      dragSrcId = el.dataset.titleId;
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      document.querySelectorAll(".title-item").forEach((i) => i.classList.remove("drag-over-up", "drag-over-dn"));
    });
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      document.querySelectorAll(".title-item").forEach((i) => i.classList.remove("drag-over-up", "drag-over-dn"));
      const rect = el.getBoundingClientRect();
      const half = e.clientY < rect.top + rect.height / 2;
      el.classList.add(half ? "drag-over-up" : "drag-over-dn");
    });
    el.addEventListener("dragleave", () => {
      el.classList.remove("drag-over-up", "drag-over-dn");
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over-up", "drag-over-dn");
      if (!dragSrcId || dragSrcId === el.dataset.titleId) return;

      const rect = el.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      const fromIdx = data.findIndex((t) => t.id === dragSrcId);
      const toIdx = data.findIndex((t) => t.id === el.dataset.titleId);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = data.splice(fromIdx, 1);
      const newIdx = data.findIndex((t) => t.id === el.dataset.titleId);
      data.splice(insertBefore ? newIdx : newIdx + 1, 0, moved);

      dragSrcId = null;
      ceDirty = true;
      renderSidebar();
    });
  });
}

function selectTitle(id) {
  activeId = id;
  const title = data.find((t) => t.id === id);
  if (title) activeListId = title.tierlists?.[0]?.id || null;
  renderSidebar();
  renderEditor();
}

function toggleNewTitleForm(show) {
  document.getElementById("new-title-form").classList.toggle("hidden", !show);
  document.getElementById("btn-add-title").style.display = show ? "none" : "";
  if (!show) {
    editingTitleId = null;
    resetTitleForm();
  } else {
    document.getElementById("nt-name").focus();
  }
}

function resetTitleForm() {
  document.getElementById("nt-name").value = "";
  document.getElementById("nt-id").value = "";
  document.getElementById("nt-folder").value = "";
  document.getElementById("nt-cover").value = "";
  document.getElementById("nt-cover-backup").value = "";
  document.getElementById("nt-cover-backup-status").textContent = "";
  document.getElementById("nt-cover-upload-status").textContent = "";
  document.getElementById("nt-cover-upload").value = "";
  document.getElementById("nt-id").disabled = false;
  document.getElementById("nt-id-hint").style.display = "none";
  document.getElementById("nt-submit-btn").textContent = i18n("Добавить");
}

// ── Резервная копия обложки тайтла по ссылке (качается на сервере) ──
function scheduleBackupTitleCover() {
  clearTimeout(backupTitleCoverTimer);
  document.getElementById("nt-cover-backup").value = "";
  backupTitleCoverTimer = setTimeout(backupTitleCoverNow, 1200);
}

async function backupTitleCoverNow() {
  const url = document.getElementById("nt-cover").value.trim();
  const status = document.getElementById("nt-cover-backup-status");
  if (!url || !url.startsWith("http")) return;

  const name = document.getElementById("nt-name").value.trim() || "title";
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Делаю резервную копию обложки...");
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
    document.getElementById("nt-cover-backup").value = data.url || "/" + data.path;
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

async function uploadTitleCoverFile() {
  const fileInput = document.getElementById("nt-cover-upload");
  const status = document.getElementById("nt-cover-upload-status");
  if (!fileInput.files.length) {
    status.textContent = i18n("Выберите файл");
    status.style.color = "var(--red-hi)";
    return;
  }
  const name = document.getElementById("nt-name").value.trim() || "title";
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
    const base64 = await convertToWebpForChar(fileInput.files[0]);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "title-covers", filename: slug + ".webp", contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    document.getElementById("nt-cover").value = "";
    document.getElementById("nt-cover-backup").value = "/" + data.path;
    status.textContent = i18n("Загружено ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

function openEditTitleForm(e, id) {
  e.stopPropagation();
  const title = data.find((t) => t.id === id);
  if (!title) return;

  editingTitleId = id;
  document.getElementById("nt-name").value = title.title;
  document.getElementById("nt-id").value = title.id;
  document.getElementById("nt-folder").value = title.folder || "";
  document.getElementById("nt-cover").value = title.cover || "";
  document.getElementById("nt-cover-backup").value = title.cover_backup || "";
  document.getElementById("nt-cover-backup-status").textContent = "";
  document.getElementById("nt-cover-upload-status").textContent = "";
  document.getElementById("nt-cover-upload").value = "";
  document.getElementById("nt-id").disabled = true;
  document.getElementById("nt-id-hint").style.display = "block";
  document.getElementById("nt-submit-btn").textContent = i18n("Сохранить изменения");

  document.getElementById("new-title-form").classList.remove("hidden");
  document.getElementById("btn-add-title").style.display = "none";
  document.getElementById("nt-name").focus();
}

async function submitTitleForm() {
  if (editingTitleId) await saveTitleEdit();
  else await addTitle();
}

async function saveTitleEdit() {
  const name = document.getElementById("nt-name").value.trim();
  const folder = document.getElementById("nt-folder").value.trim();
  const cover = document.getElementById("nt-cover").value.trim();
  if (!name || !folder) {
    alert("Заполните название и папку");
    return;
  }

  if (cover && cover.startsWith("http") && !document.getElementById("nt-cover-backup").value) {
    clearTimeout(backupTitleCoverTimer);
    await backupTitleCoverNow();
  }
  const coverBackup = document.getElementById("nt-cover-backup").value.trim();

  const title = data.find((t) => t.id === editingTitleId);
  if (!title) return;

  title.title = name;
  title.folder = folder;
  title.cover = cover || "";
  title.cover_backup = coverBackup || "";

  ceDirty = true;
  toggleNewTitleForm(false);
  selectTitle(title.id);
}

async function addTitle() {
  const name = document.getElementById("nt-name").value.trim();
  const id = document.getElementById("nt-id").value.trim();
  const folder = document.getElementById("nt-folder").value.trim();
  const cover = document.getElementById("nt-cover").value.trim();
  if (!name || !id || !folder) {
    alert("Заполните название, ID и папку");
    return;
  }
  if (data.find((t) => t.id === id)) {
    alert("Тайтл с таким ID уже существует");
    return;
  }

  if (cover && cover.startsWith("http") && !document.getElementById("nt-cover-backup").value) {
    clearTimeout(backupTitleCoverTimer);
    await backupTitleCoverNow();
  }
  const coverBackup = document.getElementById("nt-cover-backup").value.trim();

  data.push({
    id,
    title: name,
    cover: cover || "",
    cover_backup: coverBackup || "",
    folder,
    tierlists: [
      {
        id: id + "-design",
        label: i18n("Дизайн & Впечатление"),
        tiers: defaultTiers(),
      },
    ],
  });

  ceDirty = true;
  toggleNewTitleForm(false);
  selectTitle(id);
}

async function deleteTitle(e, id) {
  e.stopPropagation();
  if (!(await confirmDialog(i18n("Удалить тайтл и все его тир-листы?")))) return;
  data = data.filter((t) => t.id !== id);
  if (activeId === id) {
    activeId = data[0]?.id || null;
    activeListId = null;
  }
  ceDirty = true;
  renderSidebar();
  renderEditor();
}

function defaultTiers() {
  return [
    { name: i18n("Резонанс"), color: "#7c3aed", chars: [] },
    { name: i18n("Топ"), color: "#2563a8", chars: [] },
    { name: i18n("Хорошо"), color: "#2d8a4e", chars: [] },
    { name: i18n("Средне"), color: "#d4a017", chars: [] },
    { name: i18n("Слабо"), color: "#6b7280", chars: [] },
  ];
}

// ══ РЕДАКТОР ═══════════════════════════════════
function renderEditor() {
  const box = document.getElementById("editor");
  if (!activeId) {
    box.innerHTML = `<div class="editor-empty">${i18n("Выберите тайтл слева или создайте новый")}</div>`;
    return;
  }

  const title = data.find((t) => t.id === activeId);
  if (!title) return;
  if (!Array.isArray(title.tierlists)) title.tierlists = [];
  if (!activeListId) activeListId = title.tierlists[0]?.id || null;
  const list = title.tierlists.find((l) => l.id === activeListId) || title.tierlists[0];

  const tabs =
    title.tierlists
      .map(
        (l) =>
          `<button class="list-tab${l.id === list?.id ? " active" : ""}" onclick="selectList('${esc(l.id)}')">${esc(l.label)}</button>`
      )
      .join("") + `<button class="list-tab list-tab-add" onclick="addList()">${i18n("Создать список")}</button>`;

  const rows = (list?.tiers || []).map((tier, ti) => renderTierRow(title, list, tier, ti)).join("");

  box.innerHTML = `
    <div class="editor-top">
      <div class="editor-title">${esc(title.title)}</div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        ${list ? `<button class="btn btn-ghost" onclick="deleteList('${esc(list.id)}')" data-i18n>Удалить список</button>` : ""}
      </div>
    </div>
    <div class="list-tabs">${tabs}</div>
    <div class="tl-editor-rows" id="tl-editor-rows">${rows}</div>
    <div class="add-tier-row">
      <input type="text" id="new-tier-name" placeholder="${i18n("Название нового тира")}" data-i18n-placeholder="${i18n("Название нового тира")}">
      <input type="color" id="new-tier-color" value="#888888" style="width:32px;height:32px;border:1px solid var(--border2);border-radius:2px;padding:2px;cursor:pointer;background:none;">
      <button class="btn btn-dashed" onclick="addTier()">${i18n("Добавить тир")}</button>
    </div>
    <div class="save-bar">
      <button class="btn btn-green" id="btn-save" onclick="saveAll()">${i18n("Сохранить всё")}</button>
      <span class="status-msg" id="status-msg"></span>
    </div>`;

  bindDragDrop();
}

const CHAR_PLACEHOLDER = imagePlaceholder(72, 108);

function renderTierRow(title, list, tier, ti) {
  const chars = tier.chars
    .map(
      (ch, ci) => `
    <div class="char-card" draggable="true"
      data-title="${esc(title.id)}" data-list="${esc(list.id)}" data-tier="${ti}" data-char="${ci}">
      <img src="${esc(ch.img || ch.img_backup || "")}" alt="${esc(ch.name)}" ${imgFallbackAttrs(ch.img, ch.img_backup, CHAR_PLACEHOLDER)}>
      <div class="char-card-name">${esc(ch.name)}</div>
      <button class="char-card-del" onclick="deleteChar('${esc(title.id)}','${esc(list.id)}',${ti},${ci})">✕</button>
    </div>
  `
    )
    .join("");

  return `
    <div class="tl-editor-row" style="--tl-color:${esc(tier.color)}">
      <button class="tl-row-del" onclick="deleteTier('${esc(list.id)}',${ti})">✕</button>
      <div class="tl-editor-label">
        <div class="tl-label-dot"></div>
        <input class="tl-label-input" type="text" value="${esc(tier.name)}"
          style="color:${esc(tier.color)}"
          onchange="renameTier('${esc(list.id)}',${ti},this.value)">
        <input class="tl-color-input" type="color" value="${esc(tier.color)}"
          oninput="recolorTier('${esc(list.id)}',${ti},this.value)">
      </div>
      <div class="tl-editor-cards" data-title="${esc(title.id)}" data-list="${esc(list.id)}" data-tier="${ti}">
        ${chars}
        <button class="add-char-btn" onclick="openModal('${esc(title.id)}','${esc(list.id)}',${ti})">${i18n("Добавить")}</button>
      </div>
    </div>`;
}

// ══ ТИР-ЛИСТЫ ══════════════════════════════════
function selectList(id) {
  activeListId = id;
  renderEditor();
}

async function addList() {
  const label = await promptDialog(i18n("Название нового тир-листа:"), "", i18n("Создать"));
  if (!label || !label.trim()) return;
  const title = data.find((t) => t.id === activeId);
  if (!title) return;
  const id = activeId + "-" + Date.now();
  title.tierlists.push({ id, label: label.trim(), tiers: defaultTiers() });
  activeListId = id;
  ceDirty = true;
  renderEditor();
}

async function deleteList(listId) {
  if (!(await confirmDialog(i18n("Удалить этот тир-лист?")))) return;
  const title = data.find((t) => t.id === activeId);
  title.tierlists = title.tierlists.filter((l) => l.id !== listId);
  activeListId = title.tierlists[0]?.id || null;
  ceDirty = true;
  renderEditor();
}

// ══ ТИРЫ ═══════════════════════════════════════
function getTier(listId, ti) {
  const title = data.find((t) => t.id === activeId);
  const list = title?.tierlists.find((l) => l.id === listId);
  return list?.tiers[ti];
}

function addTier() {
  const name = document.getElementById("new-tier-name").value.trim();
  const color = document.getElementById("new-tier-color").value;
  if (!name) {
    alert("Введите название тира");
    return;
  }
  const title = data.find((t) => t.id === activeId);
  const list = title?.tierlists.find((l) => l.id === activeListId);
  if (!list) return;
  list.tiers.push({ name, color, chars: [] });
  document.getElementById("new-tier-name").value = "";
  ceDirty = true;
  renderEditor();
}

async function deleteTier(listId, ti) {
  if (!(await confirmDialog(i18n("Удалить тир? Персонажи в нём тоже удалятся.")))) return;
  const title = data.find((t) => t.id === activeId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!list) return;
  list.tiers.splice(ti, 1);
  ceDirty = true;
  renderEditor();
}

function renameTier(listId, ti, val) {
  const t = getTier(listId, ti);
  if (t) t.name = val;
  ceDirty = true;
}

function recolorTier(listId, ti, val) {
  const tier = getTier(listId, ti);
  if (!tier) return;
  tier.color = val;
  ceDirty = true;
  const row = document.querySelectorAll(".tl-editor-row")[ti];
  if (row) {
    row.style.setProperty("--tl-color", val);
    const inp = row.querySelector(".tl-label-input");
    if (inp) inp.style.color = val;
  }
}

// ══ ПЕРСОНАЖИ ══════════════════════════════════
async function deleteChar(titleId, listId, ti, ci) {
  const title = data.find((t) => t.id === titleId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!list) return;
  const char = list.tiers[ti].chars[ci];
  if (!(await confirmDialog(i18n("Удалить «{name}» из тир-листа?", { name: char?.name || i18n("персонажа") }))))
    return;
  list.tiers[ti].chars.splice(ci, 1);
  ceDirty = true;
  renderEditor();
}

// ══ ПАПКИ ══════════════════════════════════════
async function loadFolders() {
  if (foldersCache !== null) return foldersCache;
  try {
    const res = await fetch(`/api/list-chars?collection=${encodeURIComponent(COLLECTION)}`, {
      credentials: "include",
    });
    const json = await res.json();
    foldersCache = json.folders || [];
  } catch {
    foldersCache = [];
  }
  return foldersCache;
}

async function onFolderChange() {
  const folder = document.getElementById("m-folder").value;
  if (!folder) return;
  selectedGalleryImg = null;
  document.querySelectorAll(".gallery-item").forEach((i) => i.classList.remove("selected"));
  document.getElementById("m-name").value = "";
  const title = pendingTier ? data.find((t) => t.id === pendingTier.titleId) : null;
  await loadGallery(folder, title);
}

// ══ ГАЛЕРЕЯ ════════════════════════════════════
async function loadGallery(folder, title) {
  const statusEl = document.getElementById("gallery-status");
  const gridEl = document.getElementById("gallery-grid");

  if (!folder) {
    statusEl.textContent = i18n("Выберите папку выше.");
    gridEl.innerHTML = "";
    return;
  }

  statusEl.textContent = i18n("Загружаем…");
  gridEl.innerHTML = "";
  document.getElementById("manual-section").classList.remove("visible");

  if (!galleryCache[folder]) {
    try {
      const res = await fetch(
        `/api/list-chars?folder=${encodeURIComponent(folder)}&collection=${encodeURIComponent(COLLECTION)}`,
        { credentials: "include" }
      );
      const json = await res.json();
      galleryCache[folder] = json.files || [];
    } catch {
      galleryCache[folder] = [];
    }
  }

  const files = galleryCache[folder];

  if (!files.length) {
    statusEl.textContent = `Картинки не найдены в папке chars/${folder}. Введите URL вручную.`;
    document.getElementById("manual-section").classList.add("visible");
    return;
  }

  const usedNames = title
    ? new Set(title.tierlists.flatMap((l) => l.tiers.flatMap((t) => t.chars.map((c) => c.name))))
    : new Set();

  statusEl.textContent = `${files.length} персонажей в папке chars/${folder}. Кликните на нужного.`;

  gridEl.innerHTML = files
    .map((f) => {
      const used = usedNames.has(f.name);
      return `<div class="gallery-item${used ? " used" : ""}"
        data-name="${esc(f.name)}" data-url="${esc(f.url)}"
        onclick="selectGalleryItem(this)"
        title="${esc(f.name)}${used ? " (уже добавлен)" : ""}">
      <img src="${esc(f.preview || f.url)}" alt="${esc(f.name)}" loading="lazy"
        data-placeholder="${esc(imagePlaceholder(80, 120))}">
      <div class="gallery-item-name">${esc(f.name)}</div>
      <div class="gallery-check">✓</div>
    </div>`;
    })
    .join("");
}

// ══ МОДАЛКА ════════════════════════════════════
async function openModal(titleId, listId, ti) {
  pendingTier = { titleId, listId, tierIdx: ti };
  selectedGalleryImg = null;

  document.getElementById("m-name").value = "";
  document.getElementById("m-img").value = "";
  document.getElementById("m-img-backup").value = "";
  document.getElementById("m-img-backup-status").textContent = "";
  document.getElementById("m-img-preview").style.display = "none";
  document.getElementById("manual-section").classList.remove("visible");
  document.getElementById("gallery-status").textContent = i18n("Загружаем папки…");
  document.getElementById("gallery-grid").innerHTML = "";
  document.getElementById("modal-overlay").classList.remove("hidden");

  const title = data.find((t) => t.id === titleId);
  const folders = await loadFolders();
  const sel = document.getElementById("m-folder");

  if (!folders.length) {
    sel.innerHTML = `<option value="">${i18n("Папки не найдены")}</option>`;
    document.getElementById("gallery-status").textContent = i18n("Папки не найдены в chars/. Введите URL вручную.");
    document.getElementById("manual-section").classList.add("visible");
    return;
  }

  sel.innerHTML = folders
    .map((f) => `<option value="${esc(f)}"${f === title?.folder ? " selected" : ""}>${esc(f)}</option>`)
    .join("");

  await loadGallery(sel.value, title);
  document.getElementById("m-name").focus();
}

function selectGalleryItem(el) {
  document.querySelectorAll(".gallery-item").forEach((i) => i.classList.remove("selected"));
  el.classList.add("selected");
  selectedGalleryImg = { name: el.dataset.name, url: el.dataset.url };
  document.getElementById("m-name").value = el.dataset.name;
  document.getElementById("m-img").value = "";
  document.getElementById("m-img-backup").value = "";
  document.getElementById("m-img-backup-status").textContent = "";
  document.getElementById("m-img-preview").style.display = "none";
}

function toggleManual() {
  const section = document.getElementById("manual-section");
  section.classList.toggle("visible");
  if (section.classList.contains("visible")) {
    selectedGalleryImg = null;
    document.querySelectorAll(".gallery-item").forEach((i) => i.classList.remove("selected"));
    document.getElementById("m-img").focus();
  }
}

function toggleUpload() {
  document.getElementById("upload-section").classList.toggle("visible");
}

function convertToWebpForChar(file) {
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

async function uploadCharImage() {
  const folder = document.getElementById("m-folder").value;
  const fileInput = document.getElementById("m-upload-file");
  const status = document.getElementById("upload-status");

  if (!folder) {
    status.textContent = i18n("Сначала выберите папку выше");
    status.style.color = "var(--red-hi)";
    return;
  }
  if (!fileInput.files.length) {
    status.textContent = i18n("Выберите файл");
    status.style.color = "var(--red-hi)";
    return;
  }

  const file = fileInput.files[0];
  const filename = file.name.replace(/\.[^.]+$/, "") + ".webp";

  status.textContent = i18n("Обрабатываю...");
  status.style.color = "var(--text-dim)";

  try {
    const base64 = await convertToWebpForChar(file);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder,
        filename,
        contentBase64: base64,
        basePath: COLLECTION === "characters" ? undefined : COLLECTION,
      }),
    });
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || i18n("Ошибка загрузки"));

    status.textContent = i18n("Загружено ✓ Обновляю список...");
    status.style.color = "var(--green)";

    delete galleryCache[folder];
    const title = pendingTier ? data.find((t) => t.id === pendingTier.titleId) : null;
    await loadGallery(folder, title);

    const nameGuess = filename.replace(/\.webp$/, "");
    const item = document.querySelector(`.gallery-item[data-name="${CSS.escape(nameGuess)}"]`);
    if (item) {
      selectGalleryItem(item);
      document.getElementById("upload-section").classList.remove("visible");
      status.textContent = "";
    }
    fileInput.value = "";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi)";
  }
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  pendingTier = null;
  selectedGalleryImg = null;
}

function closeModalOnOverlay(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

function previewModalImg(url) {
  const img = document.getElementById("m-img-preview");
  if (url && url.startsWith("http")) {
    img.src = url;
    img.style.display = "block";
    selectedGalleryImg = null;
  } else img.style.display = "none";
}

// ── Резервная копия картинки персонажа по ссылке (качается на сервере) ──
function scheduleBackupModalImg() {
  clearTimeout(backupModalImgTimer);
  document.getElementById("m-img-backup").value = "";
  backupModalImgTimer = setTimeout(backupModalImgNow, 1200);
}

async function backupModalImgNow() {
  const url = document.getElementById("m-img").value.trim();
  const status = document.getElementById("m-img-backup-status");
  if (!url || !url.startsWith("http")) return;

  const name = document.getElementById("m-name").value.trim() || "char";
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Делаю резервную копию...");
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
    document.getElementById("m-img-backup").value = data.url || "/" + data.path;
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

async function confirmAddChar() {
  const name = document.getElementById("m-name").value.trim();
  const manualImg = document.getElementById("m-img").value.trim();
  if (!name) {
    alert("Введите имя персонажа");
    return;
  }
  if (!pendingTier) return;

  if (!selectedGalleryImg && manualImg && manualImg.startsWith("http") && !document.getElementById("m-img-backup").value) {
    clearTimeout(backupModalImgTimer);
    const btn = document.getElementById("m-btn-add");
    btn.disabled = true;
    btn.textContent = i18n("Делаю резервную копию...");
    await backupModalImgNow();
    btn.disabled = false;
    btn.textContent = i18n("Добавить");
  }
  const manualImgBackup = document.getElementById("m-img-backup").value.trim();

  const img = selectedGalleryImg?.url || manualImg || "";
  const imgBackup = selectedGalleryImg ? "" : manualImgBackup;

  const { titleId, listId, tierIdx } = pendingTier;
  const title = data.find((t) => t.id === titleId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!list) return;

  const char = { name, img };
  if (imgBackup) char.img_backup = imgBackup;
  list.tiers[tierIdx].chars.push(char);
  ceDirty = true;
  closeModal();
  renderEditor();
}

// ══ DRAG & DROP – с позиционным индикатором ════
function bindDragDrop() {
  document.querySelectorAll(".char-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      charsDragSrc = {
        titleId: card.dataset.title,
        listId: card.dataset.list,
        tierIdx: parseInt(card.dataset.tier),
        charIdx: parseInt(card.dataset.char),
      };
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      clearDropIndicator();
      document.querySelectorAll(".tl-editor-cards").forEach((z) => z.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll(".tl-editor-cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
      updateDropIndicator(zone, e.clientX, e.clientY);
    });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove("drag-over");
        clearDropIndicator();
      }
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      if (!charsDragSrc) return;

      const insertIdx = getInsertIndex(zone, e.clientX, e.clientY);
      const destTitleId = zone.dataset.title;
      const destListId = zone.dataset.list;
      const destTierIdx = parseInt(zone.dataset.tier);

      const srcTitle = data.find((t) => t.id === charsDragSrc.titleId);
      const srcList = srcTitle?.tierlists.find((l) => l.id === charsDragSrc.listId);
      if (!srcList) return;

      const [moved] = srcList.tiers[charsDragSrc.tierIdx].chars.splice(charsDragSrc.charIdx, 1);

      const destTitle = data.find((t) => t.id === destTitleId);
      const destList = destTitle?.tierlists.find((l) => l.id === destListId);
      if (!destList) {
        srcList.tiers[charsDragSrc.tierIdx].chars.splice(charsDragSrc.charIdx, 0, moved);
        return;
      }

      destList.tiers[destTierIdx].chars.splice(insertIdx, 0, moved);
      charsDragSrc = null;
      ceDirty = true;
      renderEditor();
    });
  });
}

// ══ СОХРАНЕНИЕ ══════════════════════════════════
async function saveAll() {
  const btn = document.getElementById("btn-save");
  const status = document.getElementById("status-msg");
  btn.disabled = true;
  btn.textContent = i18n("Сохраняем…");
  status.className = "status-msg";
  status.textContent = "";
  try {
    const res = await fetch("/api/save-chars-tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collection: COLLECTION, data }),
    });
    const resp = await res.json();
    if (res.ok) {
      ceDirty = false;
      status.className = "status-msg ok";
      status.textContent = i18n("Сохранено.");
      // tlState.collections[COLLECTION] (js/tierlist.js) держит уже
      // загруженный набор персонажей/игр этой коллекции с флагом
      // loaded: true – без сброса «Тир-лист» под этим маршрутом ещё
      // показывал бы старую версию, пока по нему не щёлкнуть заново.
      delete tlState.collections[COLLECTION];
      refreshOpenReviewsTab();
    } else {
      status.className = "status-msg err";
      status.textContent = i18n("Ошибка: ") + (resp.error || i18n("неизвестная"));
    }
  } catch (e) {
    status.className = "status-msg err";
    status.textContent = i18n("Ошибка сети: ") + e.message;
  }
  btn.disabled = false;
  btn.textContent = i18n("Сохранить всё");
}

registerRoute("#/chars-edit", { mount, unmount });
