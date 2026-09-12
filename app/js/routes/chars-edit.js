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
// Массовое добавление сразу нескольких персонажей из уже загруженной
// папки (см. её же комментарий у toggleGalleryBulkMode ниже) – реальный
// случай: 133 картинки персонажей одного тайтла, скопированные в папку
// заранее, добавлять по одной непрактично. Map, а не Set, – сразу
// хранит и имя, и путь к файлу, оба нужны при самом добавлении.
let galleryBulkMode = false;
const selectedGalleryNames = new Map();
let galleryCache = {};
let foldersCache = null;
let editingTitleId = null;
let dropIndicator = null;
let backupTitleCoverTimer = null;
let backupModalImgTimer = null;
// Ползунок размера карточек персонажа – тот же приём и то же имя
// ключа, что у "Ползунок размера" в js/tierlist.js (режим просмотра),
// только своё под редактор: 133 персонажа одного тайтла (реальный
// случай) при фиксированных 72×108 не разглядеть и не найти нужного
// среди мелких одинаковых миниатюр. 108 – прежняя фиксированная высота
// картинки, чтобы у тех, кто ползунок ни разу не трогал, ничего не
// изменилось визуально.
let ceCharHeight = parseInt(localStorage.getItem("ce-char-height") || "108");
// Пакетная загрузка нескольких фото разом (см. onUploadFilesPicked
// ниже) – {id, file, name, previewUrl, status: pending/uploading/done/
// error, error} на каждый выбранный файл. previewUrl – собственный
// blob-URL на файл (создан один раз при выборе, а не при каждой
// перерисовке списка – иначе течёт с каждым renderBatchList()).
let batchItems = [];
let batchCounter = 0;
// Значение cover_backup/img_backup, с которым открыта правка (null у
// новой записи) – та же страховка, что originalCoverBackup в
// js/routes/add.js. Здесь весь тир-лист держится в памяти и пишется
// на диск разом кнопкой «Сохранить» (saveAll), а не по одной записи
// за раз, поэтому это ловит только замену/стирание ссылки в пределах
// одной открытой формы – более старую копию, оставшуюся уже
// сохранённой на диске до этой правки, найдёт «Проверить оставленные
// копии» в настройках после того, как saveAll() запишет новую версию.
let originalTitleCoverBackup = null;
// Резервные копии обложки тайтла, замену которых подтвердил
// submitTitleForm(), но которые ещё не удалены с диска: весь тир-лист
// пишется одним запросом (saveAll), а не по одной записи, поэтому
// удалять старый файл раньше подтверждённого ответа сервера нельзя –
// иначе несохранённый уход из редактора стёр бы файл, на который
// characters-tier.json (на диске) всё ещё ссылается. У персонажа
// такой пары нет – модалка (confirmAddChar) только добавляет нового,
// никогда не подменяет уже сохранённого, поэтому там достаточно
// стирать саму заброшенную "черновую" копию сразу же (см.
// scheduleBackupModalImg ниже) – ей ещё никто не успел сослаться.
let pendingBackupCleanup = [];

let COLLECTION = "characters";
let COLLECTION_LABEL = "Персонажи";
let DATA_FILE = "characters-tier.json";
let ceCleanupFns = [];
let cePrevTitle = null;
let ceDirty = false;
// "Открыть папку" в модалке персонажа умеет только настольное приложение
// (shell.openPath в electron/main.js) – на телефоне и в обычном браузере
// (dev-сервер) /api/app/info либо не отвечает мобильным mobile:true,
// либо не отвечает вовсе. Тот же приём, что в settings-app.js.
let isElectronDesktop = false;
// На телефоне у "папок"/"источников" нет знакомого смысла – там никто
// не раскладывает картинки по chars/<тема> руками, и выбор папки-
// источника только путает (пустой список, лишний тап). Модалка на
// телефоне сразу грузит в папку текущей темы (та уже подставлена в
// #m-folder значением по умолчанию, см. openModal() – сам select
// остаётся в DOM и работает, просто не показан) – остаются только
// "Имя персонажа", ссылка и загрузка файла. window.Capacitor –
// тот же признак, что уже используют app/js/utils.js и mobile/src/main.js.
const isNativeMobile = !!window.Capacitor?.isNativePlatform?.();

function ceOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  ceCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container, params) {
  cePrevTitle = document.title;
  foldersCache = null;
  galleryCache = {};
  pendingBackupCleanup = [];

  COLLECTION = (params && params.get("collection")) || "characters";
  COLLECTION_LABEL =
    (window.SITE_TIER_COLLECTIONS || []).find((c) => c.id === COLLECTION)?.label ||
    (COLLECTION === "characters" ? "Персонажи" : COLLECTION);
  DATA_FILE = COLLECTION === "characters" ? "characters-tier.json" : `tier-${COLLECTION}.json`;

  container.innerHTML = `
    <header class="app-topbar">
      <a href="#" class="logo topbar-back" id="ce-back"><span class="arrow">&larr;</span>TasteID</a>
      <h1 class="topbar-title" id="header-sub">${esc(COLLECTION_LABEL ? `${i18n("Редактор")}: ${COLLECTION_LABEL}` : "")}</h1>
      <div style="display:flex;gap:.5rem;margin-left:auto;flex-wrap:wrap;min-width:0">
        <button class="btn btn-ghost" onclick="renameCurrentCollection()" data-i18n>Переименовать тир-лист</button>
        <button class="btn btn-ghost" onclick="deleteCurrentCollection()" data-i18n>Удалить тир-лист</button>
      </div>
    </header>
    <main class="ce-view">
      <aside class="sidebar">
        <div>
          <div class="section-label" data-i18n>Темы</div>
          <div class="title-list" id="title-list"></div>
        </div>
        <div class="new-title-form hidden" id="new-title-form">
          <div class="field">
            <label data-i18n>Название темы *</label>
            <input type="text" id="nt-name" placeholder="Название" data-i18n-placeholder="Название" onkeydown="if(event.key==='Enter'){event.preventDefault();submitTitleForm();}">
          </div>
          <div class="field">
            <label data-i18n>Обложка (URL)</label>
            <input type="text" id="nt-cover" placeholder="https://..." oninput="scheduleBackupTitleCover()" onkeydown="if(event.key==='Enter'){event.preventDefault();submitTitleForm();}">
            <input type="hidden" id="nt-cover-backup">
            <div id="nt-cover-backup-status" style="font-family:'DM Sans',sans-serif;font-size:.7rem;margin-top:.3rem"></div>
          </div>
          <div class="field">
            <label data-i18n>Или загрузить файл</label>
            <label class="btn btn-ghost file-btn">
              <input type="file" id="nt-cover-upload" accept="image/*" onchange="updateFileBtnName(this); uploadTitleCoverFile()">
              <span data-i18n>Выбрать файл</span>
            </label>
            <span class="file-btn-name" id="nt-cover-upload-name"></span>
            <label class="original-quality-toggle"><input type="checkbox" id="nt-cover-original"><span>${i18n("Оригинальное качество (без сжатия)")}</span></label>
            <div id="nt-cover-upload-status" style="font-family:'DM Sans',sans-serif;font-size:.7rem;margin-top:.3rem"></div>
          </div>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-primary" id="nt-submit-btn" onclick="submitTitleForm()" data-i18n>Добавить</button>
            <button class="btn btn-ghost" onclick="toggleNewTitleForm(false)" data-i18n>Отмена</button>
          </div>
        </div>
        <button class="btn btn-dashed" id="btn-add-title" onclick="toggleNewTitleForm(true)" data-i18n>Новая тема</button>
      </aside>

      <div class="editor" id="editor">
        <div class="editor-empty" data-i18n>Выберите тему слева или создайте новую</div>
      </div>
    </main>

    <div class="modal-overlay hidden${isNativeMobile ? " ce-mobile-add-char" : ""}" id="modal-overlay" onclick="closeModalOnOverlay(event)">
      <div class="modal">
        <button class="modal-close" onclick="closeModal()">✕</button>
        <div class="modal-title" id="modal-title-label" data-i18n>Добавить персонажа</div>

        <div id="folder-field">
          <span class="folder-select-label" data-i18n>Папка (источник)</span>
          <div class="folder-select-row">
            <div class="folder-select-wrap">
              <select id="m-folder" onchange="onFolderChange()">
                <option value="" data-i18n>Загружаем…</option>
              </select>
            </div>
            <button type="button" class="btn btn-ghost hidden" id="m-folder-open-btn" onclick="openCharsFolder()" data-i18n>Открыть папку</button>
            <button type="button" class="btn btn-ghost hidden" id="m-folder-compress-btn" onclick="compressCurrentFolder()" data-i18n>Пережать все файлы</button>
          </div>
        </div>
        <div class="status-msg" id="folder-compress-status"></div>

        <div class="gallery-status" id="gallery-status"></div>
        <span class="manual-toggle" onclick="toggleGalleryBulkMode()" id="gallery-bulk-toggle" data-i18n>Выбрать несколько</span>
        <div class="gallery-grid" id="gallery-grid"></div>
        <div class="hidden" id="gallery-bulk-actions" style="display:flex;gap:.5rem;margin:-.5rem 0 1rem">
          <button type="button" class="btn btn-primary" id="gallery-bulk-add-btn" onclick="addSelectedGalleryChars()"></button>
          <button type="button" class="btn btn-ghost" onclick="clearGalleryBulkSelection()" data-i18n>Снять выбор</button>
        </div>

        <div class="field">
          <label data-i18n>Имя персонажа *</label>
          <input type="text" id="m-name" placeholder="Имя персонажа" data-i18n-placeholder="Имя персонажа">
        </div>

        <label class="original-quality-toggle"><input type="checkbox" id="m-original"><span>${i18n("Оригинальное качество (без сжатия)")}</span></label>

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

        <span class="manual-toggle" onclick="toggleUpload()" data-i18n>⬆ Загрузить файл</span>
        <div class="manual-section" id="upload-section">
          <div class="field">
            <label class="btn btn-ghost file-btn">
              <input type="file" id="m-upload-file" accept="image/*" multiple onchange="onUploadFilesPicked(this)">
              <span data-i18n>Выбрать файл</span>
            </label>
            <span class="file-btn-name" id="m-upload-file-name"></span>
            <div id="upload-status" style="font-size:.8rem;margin-top:.4rem;"></div>
          </div>
          <div class="batch-upload-list hidden" id="batch-upload-list"></div>
          <div class="hidden" id="batch-upload-actions" style="display:flex;gap:.5rem;margin-top:.5rem">
            <button type="button" class="btn btn-primary" id="batch-upload-btn" onclick="uploadBatchFiles()" data-i18n>Добавить всех</button>
            <button type="button" class="btn btn-ghost" onclick="clearBatchFiles()" data-i18n>Очистить список</button>
          </div>
        </div>

        <div style="display:flex;gap:.5rem;margin-top:.75rem">
          <button class="btn btn-primary" id="m-btn-add" onclick="confirmAddChar()" data-i18n>Добавить</button>
          <button class="btn btn-ghost" onclick="closeModal()" data-i18n>Готово</button>
        </div>
      </div>
    </div>`;
  // Без этого вызова весь редактор (боковая панель «Тайтлы», модалка
  // «Добавить персонажа») оставался на русском при английском языке –
  // data-i18n сама по себе ничего не переводит, только applyI18n().
  applyI18n(container);

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

  fetch("/api/app/info")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((info) => {
      isElectronDesktop = !info.error && !info.mobile;
    })
    .catch(() => {
      isElectronDesktop = false;
    });

  // См. её же снятие и комментарий в unmount() – без этого аппаратная
  // кнопка/жест "назад" на телефоне уводил со страницы в обход проверки
  // несохранённых правок, которую в остальных случаях делает
  // leaveCharsEdit() (клик по "←"/Escape).
  setLeaveGuard(leaveCharsEdit);

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
  // setLeaveGuard(null) – см. её же регистрацию в mount(): аппаратная
  // кнопка/жест "назад" на телефоне (installBackButton() в
  // mobile/src/main.js) правит историю напрямую, в обход "←"/Escape
  // внутри самого маршрута, которыми единственно и проверялась
  // несохранённая правка раньше – ровно тот случай, из-за которого
  // новые персонажи/тиры, добавленные на телефоне, могли синхронизироваться
  // молча потерянными: жест "назад" уводил со страницы раньше "Сохранить
  // всё", а confirmLeaveIfDirty() в leaveCharsEdit() выше об этом просто
  // не узнавал.
  setLeaveGuard(null);
  // Та же дыра, что была в js/routes/add.js: форма тайтла (или модалка
  // добавления персонажа) могла остаться открытой с уже скачанной, но
  // ещё не подтверждённой резервной копией, если уйти с маршрута
  // целиком, минуя toggleNewTitleForm(false)/closeModal() – ни один из
  // них тогда не срабатывает, и черновик остаётся на диске ничьим.
  // discardScratchTitleCoverBackup() безопасна и после успешной правки:
  // originalTitleCoverBackup к этому моменту уже синхронизирован (см.
  // saveTitleEdit()/addTitle()). У модалки персонажа своей пары
  // originalXBackup нет – она только добавляет нового, поэтому то же,
  // что в closeModal(): текущее значение всегда черновик, удалять можно
  // безусловно.
  discardScratchTitleCoverBackup();
  deleteMediaFile(document.getElementById("m-img-backup")?.value.trim() || "");
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
  if (data.length) selectTitle(data[0].id, { openMobileEditor: false });
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

function selectTitle(id, { openMobileEditor = true } = {}) {
  activeId = id;
  const title = data.find((t) => t.id === id);
  if (title) activeListId = title.tierlists?.[0]?.id || null;
  // На телефоне .sidebar и .editor вдвоём не помещаются (см. .ce-view
  // в index.html) – класс переключает между списком тайтлов и открытым
  // редактором, как обычный drill-down. На десктопе оба видны всегда,
  // класс там ничего не переключает (медиа-запрос не действует).
  // openMobileEditor:false — для служебного автовыбора первого тайтла
  // при заходе на маршрут (см. load() ниже): человек ещё ничего не
  // нажимал, и прыгать сразу в редактор мимо списка тайтлов не нужно.
  if (openMobileEditor) document.querySelector(".ce-view")?.classList.add("ce-mobile-editor-open");
  renderSidebar();
  renderEditor();
}

function closeMobileEditor() {
  document.querySelector(".ce-view")?.classList.remove("ce-mobile-editor-open");
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
  // Форму закрывают (toggleNewTitleForm(false)) и после удачной правки, и
  // просто отменой без сохранения – раньше только первый случай не терял
  // резервную копию (она успевала уехать в data[]), а во втором черновик,
  // созданный вводом ссылки, оставался на диске ничьим: originalTitleCoverBackup
  // обнулялся ниже, ничего не сравнивая с полем. saveTitleEdit()/addTitle()
  // синхронизируют originalTitleCoverBackup с уже закоммиченным значением
  // ДО вызова toggleNewTitleForm(false), поэтому здесь безопасно звать
  // discard в обоих случаях – после сохранения он не найдёт расхождения.
  discardScratchTitleCoverBackup();
  originalTitleCoverBackup = null;
  document.getElementById("nt-name").value = "";
  document.getElementById("nt-cover").value = "";
  document.getElementById("nt-cover-backup").value = "";
  document.getElementById("nt-cover-backup-status").textContent = "";
  document.getElementById("nt-cover-upload-status").textContent = "";
  document.getElementById("nt-cover-upload").value = "";
  document.getElementById("nt-submit-btn").textContent = i18n("Добавить");
}

// ID тайтла больше не вводится руками – он служебный (ключ в data[],
// имя файла тир-листа никак от него не зависит), а поле только путало:
// человек заполнял его как ещё одно название. Теперь это slugify()
// от папки (она и так обязана быть уникальной – это реальная папка на
// диске в chars/) плюс суффикс времени на случай, если папку для
// нового тайтла всё же укажут ту же, что у уже существующего.
function titleIdFromFolder(folder) {
  return slugify(folder) + "-" + Date.now().toString(36).slice(-4);
}

// Имя папки для НОВОГО тайтла – раньше здесь звали общий slugify()
// (settings-grades.js), а он сделан для id коллекций тир-листа и
// всегда добавляет случайный суффикс времени для уникальности. Для
// папки же это не нужно и не задумывалось (см. её же комментарий у
// addTitle() ниже) – реальный случай: "MementoMori" на диске стало
// "memento-mori-ajd2", хотя должно было стать просто "memento-mori".
// Уникальность папки не обязательна вовсе (два тайтла могут разделять
// одну папку намеренно, отсюда и суффикс времени у самого id в
// titleIdFromFolder выше – на случай совпадения), но чтобы автоматически
// заведённые тайтлы с одинаковым названием не путались в одной папке
// без явного намерения человека, добавляем короткий счётчик, только
// если чистое имя уже занято реальной папкой на диске.
async function newTitleFolderSlug(name) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "title";
  const folders = await loadFolders();
  if (!folders.includes(base)) return base;
  let n = 2;
  while (folders.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ── Резервная копия обложки тайтла по ссылке (качается на сервере) ──
// discardScratchTitleCoverBackup – та же логика, что в js/routes/add.js:
// копия, которую заменяет новая, безопасно удалить сразу же, только
// если она не совпадает с originalTitleCoverBackup (уже сохранённой
// на диске версией).
function discardScratchTitleCoverBackup() {
  const current = document.getElementById("nt-cover-backup").value.trim();
  if (current && current !== originalTitleCoverBackup) deleteMediaFile(current);
}

function scheduleBackupTitleCover() {
  clearTimeout(backupTitleCoverTimer);
  discardScratchTitleCoverBackup();
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
    const original = document.getElementById("nt-cover-original")?.checked || false;
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug, original }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    document.getElementById("nt-cover-backup").value = data.url;
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
    const keepOriginal = document.getElementById("nt-cover-original")?.checked || false;
    const { base64, ext } = await encodeUploadFile(fileInput.files[0], keepOriginal);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "title-covers", filename: `${slug}.${ext}`, contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    discardScratchTitleCoverBackup();
    document.getElementById("nt-cover").value = "";
    document.getElementById("nt-cover-backup").value = data.url;
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

  // Форма правки темы живёт в сайдбаре (#new-title-form внутри
  // .sidebar) – на телефоне сайдбар скрыт, пока открыт редактор (см.
  // .ce-mobile-editor-open в index.html). Карандаш в шапке открытого
  // редактора (editor-edit-btn, renderEditor()) звал эту же функцию
  // "молча" ничего не показывая – форма технически становилась видна,
  // но внутри контейнера, у которого display:none. Возврат к списку
  // тем перед показом формы чинит это и на десктопе ничего не меняет
  // (там сайдбар и так всегда виден, класс на макет не влияет).
  closeMobileEditor();

  editingTitleId = id;
  document.getElementById("nt-name").value = title.title;
  document.getElementById("nt-cover").value = title.cover || "";
  document.getElementById("nt-cover-backup").value = title.cover_backup || "";
  originalTitleCoverBackup = title.cover_backup || null;
  document.getElementById("nt-cover-backup-status").textContent = "";
  document.getElementById("nt-cover-upload-status").textContent = "";
  document.getElementById("nt-cover-upload").value = "";
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
  const cover = document.getElementById("nt-cover").value.trim();
  if (!name) {
    alert(i18n("Заполните название"));
    return;
  }

  if (cover && cover.startsWith("http") && !document.getElementById("nt-cover-backup").value) {
    clearTimeout(backupTitleCoverTimer);
    await backupTitleCoverNow();
  }
  const coverBackup = document.getElementById("nt-cover-backup").value.trim();

  const title = data.find((t) => t.id === editingTitleId);
  if (!title) return;

  // Старую копию удаляем не сразу, а только после того, как saveAll()
  // подтвердит, что characters-tier.json на диске теперь ссылается на
  // другой файл (или вовсе ни на какой) – см. pendingBackupCleanup выше.
  if (originalTitleCoverBackup && originalTitleCoverBackup !== (coverBackup || null)) {
    pendingBackupCleanup.push(originalTitleCoverBackup);
  }
  // Правка только что легла в data[] – теперь это подтверждённое значение
  // формы, а не черновик, и resetTitleForm() ниже (через toggleNewTitleForm)
  // не должна принимать его за брошенную копию и удалять (см. её же
  // discardScratchTitleCoverBackup()).
  originalTitleCoverBackup = coverBackup || null;

  title.title = name;
  title.cover = cover || "";
  title.cover_backup = coverBackup || "";

  ceDirty = true;
  toggleNewTitleForm(false);
  selectTitle(title.id);
}

async function addTitle() {
  const name = document.getElementById("nt-name").value.trim();
  const cover = document.getElementById("nt-cover").value.trim();
  if (!name) {
    alert(i18n("Заполните название"));
    return;
  }
  // Папка на диске (chars/<folder>/...) раньше вводилась руками –
  // теперь всегда выводится из названия темы: newTitleFolderSlug() даёт
  // безопасное для файловой системы имя (см. isSafeName() в core/api.js)
  // БЕЗ случайного суффикса – его туда добавлял слишком общий slugify()
  // из settings-grades.js, сделанный для id коллекций, а не для имени
  // папки (см. её же разбор у newTitleFolderSlug выше). Уникальность
  // самого id по-прежнему обеспечивает суффикс времени в
  // titleIdFromFolder() – папке это не нужно.
  const folder = await newTitleFolderSlug(name);

  // Создаём папку сразу, не дожидаясь первой загруженной картинки –
  // иначе её не с чем открыть проводником (openCharsFolder() ниже) и
  // не видно в "Папка (источник)", пока хоть что-то не загружено через
  // саму модалку. Лучший эффект – если получится до открытия папки
  // человеком, но и не удастся – не страшно, saveMedia() всё равно
  // создаст её сама при первой реальной загрузке. foldersCache сброшен
  // ниже (см. её же сброс после загрузки картинки в uploadCharImage()) –
  // иначе модалка, уже открытая до этого разок, покажет старый список
  // папок без только что созданной.
  foldersCache = null;
  fetch("/api/ensure-chars-folder", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder,
      basePath: COLLECTION === "characters" ? undefined : COLLECTION,
    }),
  }).catch(() => {});

  let id = titleIdFromFolder(folder);
  while (data.find((t) => t.id === id)) id = titleIdFromFolder(folder);

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
  // Та же синхронизация, что в saveTitleEdit(): значение только что легло
  // в data[], resetTitleForm() дальше не должна принимать его за черновик.
  originalTitleCoverBackup = coverBackup || null;

  ceDirty = true;
  toggleNewTitleForm(false);
  selectTitle(id);
}

async function deleteTitle(e, id) {
  e.stopPropagation();
  if (!(await confirmDialog(i18n("Удалить тему и все её списки?")))) return;
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
    // Пустой редактор нечего показывать во весь экран на телефоне – это
    // не тот случай, когда есть куда вернуться кнопкой «Назад».
    closeMobileEditor();
    box.innerHTML = `<div class="editor-empty">${i18n("Выберите тему слева или создайте новую")}</div>`;
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
      .join("") +
    `<button class="list-tab list-tab-add" onclick="addList()">${i18n("Создать список")}</button>` +
    (list
      ? `<button class="list-tab list-tab-edit" onclick="renameList('${esc(list.id)}')" title="${i18n("Переименовать список")}">✎</button>
         <button class="list-tab list-tab-del" onclick="deleteList('${esc(list.id)}')" title="${i18n("Удалить список")}">✕</button>`
      : "");

  const rows = (list?.tiers || []).map((tier, ti) => renderTierRow(title, list, tier, ti)).join("");

  box.innerHTML = `
    <div class="editor-top">
      <button class="editor-back-btn" onclick="closeMobileEditor()" title="${i18n("Назад к списку")}"><span class="arrow">&larr;</span></button>
      <div class="editor-title">${esc(title.title)}</div>
      <button class="editor-edit-btn" onclick="openEditTitleForm(event,'${esc(title.id)}')" title="${i18n("Редактировать")}">✎</button>
    </div>
    <div class="list-tabs">${tabs}</div>
    ${ceSizeSliderHtml()}
    <div class="tl-editor-rows" id="tl-editor-rows">${rows}</div>
    <div class="add-tier-row">
      <input type="text" id="new-tier-name" placeholder="${i18n("Название нового тира")}" data-i18n-placeholder="${i18n("Название нового тира")}" onkeydown="if(event.key==='Enter'){event.preventDefault();addTier();}">
      <input type="color" id="new-tier-color" value="#888888" style="width:32px;height:32px;border:1px solid var(--border2);border-radius:2px;padding:2px;cursor:pointer;background:none;">
      <button class="btn btn-dashed" onclick="addTier()">${i18n("Добавить тир")}</button>
    </div>
    <div class="save-bar">
      <button class="btn btn-green" id="btn-save" onclick="saveAll()">${i18n("Сохранить всё")}</button>
      <span class="status-msg" id="status-msg"></span>
    </div>`;

  bindDragDrop();
  bindTierRowDrag();
  bindCeSizeSlider();
}

// Тот же ползунок, что и "Размер" в режиме просмотра (js/tierlist.js) –
// только высота ставится на сам <img>, а не на карточку целиком: у
// карточки редактора, в отличие от постера в просмотре, под картинкой
// ещё есть постоянная подпись с именем, и её высоту раздувать вместе с
// картинкой не нужно.
function ceSizeSliderHtml() {
  return `<div style="display:flex;align-items:center;gap:.75rem;margin:.6rem 0 .8rem">
    <span style="font-family:'DM Sans',sans-serif;font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim);flex-shrink:0">${i18n("Размер")}</span>
    <input type="range" min="60" max="400" value="${ceCharHeight}" step="10"
      id="ce-char-size-slider"
      style="flex:1;max-width:200px;accent-color:var(--red);cursor:pointer">
    <span id="ce-char-size-val" style="font-family:'DM Sans',sans-serif;font-size:.65rem;color:var(--text-dim);min-width:42px">${ceCharHeight}px</span>
  </div>`;
}

function bindCeSizeSlider() {
  const slider = document.getElementById("ce-char-size-slider");
  if (!slider) return;
  slider.addEventListener("input", () => {
    ceCharHeight = parseInt(slider.value);
    localStorage.setItem("ce-char-height", ceCharHeight);
    document.getElementById("ce-char-size-val").textContent = ceCharHeight + "px";
    document.querySelectorAll(".char-card img").forEach((img) => {
      img.style.height = ceCharHeight + "px";
    });
    document.querySelectorAll(".add-char-btn").forEach((btn) => {
      btn.style.height = ceCharHeight + "px";
      btn.style.width = Math.round((ceCharHeight * 72) / 108) + "px";
    });
  });
}

const CHAR_PLACEHOLDER = imagePlaceholder(72, 108);

function renderTierRow(title, list, tier, ti) {
  const chars = tier.chars
    .map(
      (ch, ci) => `
    <div class="char-card" draggable="true"
      data-title="${esc(title.id)}" data-list="${esc(list.id)}" data-tier="${ti}" data-char="${ci}">
      <img src="${esc(ch.img || ch.img_backup || "")}" alt="${esc(ch.name)}" style="height:${ceCharHeight}px" ${imgFallbackAttrs(ch.img, ch.img_backup, CHAR_PLACEHOLDER)}>
      <div class="char-card-name">${esc(ch.name)}</div>
      <button class="char-card-del" onclick="deleteChar('${esc(title.id)}','${esc(list.id)}',${ti},${ci})">✕</button>
    </div>
  `
    )
    .join("");

  return `
    <div class="tl-editor-row" data-list="${esc(list.id)}" data-tier="${ti}" style="--tl-color:${esc(tier.color)}">
      <button class="tl-row-del" onclick="deleteTier('${esc(list.id)}',${ti})">✕</button>
      <div class="tl-editor-label" draggable="true">
        <div class="tl-label-dot"></div>
        <input class="tl-label-input" type="text" value="${esc(tier.name)}"
          style="color:${esc(tier.color)}"
          onchange="renameTier('${esc(list.id)}',${ti},this.value)">
        <input class="tl-color-input" type="color" value="${esc(tier.color)}"
          oninput="recolorTier('${esc(list.id)}',${ti},this.value)">
      </div>
      <div class="tl-editor-cards" data-title="${esc(title.id)}" data-list="${esc(list.id)}" data-tier="${ti}">
        ${chars}
        <button class="add-char-btn" style="height:${ceCharHeight}px;width:${Math.round((ceCharHeight * 72) / 108)}px" onclick="openModal('${esc(title.id)}','${esc(list.id)}',${ti})">${i18n("Добавить")}</button>
      </div>
    </div>`;
}

// ══ ТИР-ЛИСТЫ ══════════════════════════════════
function selectList(id) {
  activeListId = id;
  renderEditor();
}

async function addList() {
  const label = await promptDialog(i18n("Название нового списка:"), "", i18n("Создать"));
  if (!label || !label.trim()) return;
  const title = data.find((t) => t.id === activeId);
  if (!title) return;
  const id = activeId + "-" + Date.now();
  title.tierlists.push({ id, label: label.trim(), tiers: defaultTiers() });
  activeListId = id;
  ceDirty = true;
  renderEditor();
}

async function renameList(listId) {
  const title = data.find((t) => t.id === activeId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!list) return;
  const label = await promptDialog(i18n("Название списка:"), list.label, i18n("Сохранить"));
  if (!label || !label.trim()) return;
  list.label = label.trim();
  ceDirty = true;
  renderEditor();
}

async function deleteList(listId) {
  const title = data.find((t) => t.id === activeId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!(await confirmDialog(i18n("Удалить список «{name}»?", { name: list?.label || "" })))) return;
  title.tierlists = title.tierlists.filter((l) => l.id !== listId);
  activeListId = title.tierlists[0]?.id || null;
  ceDirty = true;
  renderEditor();
}

// ══ КОЛЛЕКЦИЯ (весь тир-лист, а не один список внутри тайтла) ══
// Переименование и удаление коллекции – прямо здесь, внутри её же
// редактора, а не на вкладке «Тир-лист» и не в /settings-edit (раньше
// было то там, то там – теперь один раз и по месту). Встроенная
// "characters" не исключение: activeTierCollections() возвращает её
// только заглушкой, пока settings.tierCollections не существует,
// поэтому переименование/удаление пишет её в site-settings.json как
// обычную запись – после этого она ничем не отличается от своей.
// Вернуть удалённую "characters" можно с самой вкладки «Тир-лист»
// (restoreBuiltinTierCollection в js/tierlist.js) – там же, где кнопка
// «Редактор» на неё и вела, пока коллекция существовала.
async function renameCurrentCollection() {
  const name = await promptDialog(i18n("Новое название тир-листа:"), COLLECTION_LABEL, i18n("Сохранить"));
  if (name === null) return;
  const newLabel = name.trim();
  if (!newLabel || newLabel === COLLECTION_LABEL) return;

  try {
    await patchSiteSettings((settings) => {
      settings.tierCollections = Array.isArray(settings.tierCollections) ? settings.tierCollections : activeTierCollections();
      const entry = settings.tierCollections.find((c) => c.id === COLLECTION);
      if (entry) entry.label = newLabel;
      else settings.tierCollections.push({ id: COLLECTION, label: newLabel });
    });
    window.SITE_TIER_COLLECTIONS = activeTierCollections().map((c) => (c.id === COLLECTION ? { ...c, label: newLabel } : c));
    COLLECTION_LABEL = newLabel;
    document.title = `TasteID – ${i18n("Редактор")}: ${COLLECTION_LABEL}`;
    const headerEl = document.getElementById("header-sub");
    if (headerEl) headerEl.textContent = `${i18n("Редактор")}: ${COLLECTION_LABEL}`;
    refreshTierCollectionsElsewhere();
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  }
}

// Тир-лист переименовывают/удаляют либо отсюда (редактор одной
// коллекции), либо кнопкой «Создать» с самой вкладки «Тир-лист»
// (tierlist.js: submitNewCollection). И вкладка «Тир-лист» (кнопки
// переключения режима, tlRender), и панель настроек «Разделы вкладки
// «Тир-лист»» (settings-grades.js: tierCollections/renderTierModesList)
// держат СВОИ копии списка коллекций, загруженные один раз при заходе
// – без явного обновления они не видели правку до повторного захода
// на вкладку/панель. Дальше только там, где разметка правда есть:
// #shell-root остаётся в DOM (просто скрыт), пока открыт этот
// редактор или настройки, но других маршрутов вроде #/add там нет
// вовсе.
function refreshTierCollectionsElsewhere() {
  if (document.getElementById("tab-tierlist")) tlRender();
  if (typeof tierCollections !== "undefined" && document.getElementById("tierModesList")) {
    tierCollections = window.SITE_TIER_COLLECTIONS;
    renderTierModesList();
  }
}

async function deleteCurrentCollection() {
  if (
    !(await confirmDialog(
      i18n(
        "Удалить тир-лист «{name}» вместе со всем содержимым – всеми темами, тирами и персонажами внутри? Отменить это будет нельзя.",
        { name: COLLECTION_LABEL }
      )
    ))
  ) {
    return;
  }
  try {
    // Стираем сами данные (тайтлы/тиры/персонажи этой коллекции) и
    // папку с их картинками, а не только кнопку на вкладке – раньше
    // здесь писали data: [] через save-chars-tier: файл tier-XXX.json
    // оставался на диске, просто опустевшим, вместе со всей папкой
    // картинок – см. её же разбор у deleteTierCollection в core/api.js.
    const res = await fetch("/api/delete-tier-collection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ collection: COLLECTION }),
    });
    const resp = await res.json();
    if (!res.ok || !resp.ok) throw new Error(resp.error || i18n("Ошибка удаления"));
    // Тихо, как и сам deleteRemoteMedia (js/sync.js) – без неё картинки
    // раздела остались бы висеть в репозитории синхронизации и
    // вернулись бы обратно на следующей автосинхронизации.
    deleteRemoteMediaFolder(COLLECTION);

    await patchSiteSettings((settings) => {
      settings.tierCollections = (Array.isArray(settings.tierCollections) ? settings.tierCollections : activeTierCollections()).filter(
        (c) => c.id !== COLLECTION
      );
      settings.hiddenTierModes = (settings.hiddenTierModes || []).filter((x) => x !== COLLECTION);
    });
    window.SITE_TIER_COLLECTIONS = activeTierCollections().filter((c) => c.id !== COLLECTION);
    window.SITE_HIDDEN_TIER_MODES?.delete(COLLECTION);
    delete tlState.collections[COLLECTION];
    if (tlState.mode === COLLECTION) tlState.mode = "titles";
    refreshTierCollectionsElsewhere();
    leaveRoute();
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
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

// Открыть выбранную в "Папка (источник)" папку проводником – чтобы
// скопом накидать в неё заранее скачанные картинки вместо загрузки по
// одной через "Загрузить файл" ниже. Кнопка скрыта не на настольном
// приложении (см. isElectronDesktop, loadGallery()).
async function openCharsFolder() {
  const folder = document.getElementById("m-folder").value;
  if (!folder) return;
  try {
    await fetch("/api/app/open-chars-folder", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder,
        basePath: COLLECTION === "characters" ? undefined : COLLECTION,
      }),
    });
  } catch {
    // Не критично – кнопка просто не сработает, ничего в приложении
    // от этого не сломается.
  }
}

// Пережимает все файлы в выбранной папке заново через /api/compress-folder
// (реальная работа – на сервере, см. её же compressFolder в core/api.js).
// Одна из "133 картинки за раз" историй: человек скопировал оригиналы
// прямо в папку через проводник – см. её же комментарий в
// quick-appearance.js про то, что такие файлы приложение вообще не
// трогает при обычной загрузке. Эта кнопка – ручной способ сделать то,
// что при обычной загрузке через приложение происходит само.
async function compressCurrentFolder() {
  const folder = document.getElementById("m-folder").value;
  if (!folder) return;
  const statusEl = document.getElementById("folder-compress-status");

  const ok = confirm(
    i18n(
      "Все файлы в этой папке будут пережаты заново, даже уже сжатые. Некоторые могут сменить имя (расширение). Старые версии уйдут в корзину. Продолжить?"
    )
  );
  if (!ok) return;

  const btn = document.getElementById("m-folder-compress-btn");
  btn.disabled = true;
  statusEl.className = "status-msg";
  statusEl.textContent = i18n("Пережимаем…");

  try {
    const res = await fetch("/api/compress-folder", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection: COLLECTION, folder }),
    });
    const resp = await res.json();
    if (!res.ok) {
      statusEl.className = "status-msg err";
      statusEl.textContent = i18n("Ошибка: ") + (resp.error || i18n("неизвестная"));
      return;
    }

    // Сервер уже переписал ссылки во ВСЕХ коллекциях прямо на диске (см.
    // её же fixRef внутри compressFolder), но если этот редактор сейчас
    // открыт на этой же коллекции, наш data[] в памяти всё ещё указывает
    // на старые имена файлов – не поправим здесь, и следующее "Сохранить
    // всё" перезапишет диск обратно старыми путями поверх того, что
    // сервер только что исправил.
    const renameMap = new Map(resp.renames || []);
    if (renameMap.size) {
      // Та же логика, что и у fixRef на сервере (compressFolder,
      // core/api.js) – см. её же комментарий там про то, почему ch.img
      // нужно кодировать обратно посегментно, а не просто подставлять
      // сырой путь из renames.
      const fixRef = (value) => {
        if (!value) return value;
        const hadSlash = value.startsWith("/");
        const decoded = decodeURIComponent(value);
        const clean = decoded.replace(/^\/+/, "");
        const next = renameMap.get(clean);
        if (!next) return value;
        const wasEncoded = decoded !== value;
        const result = wasEncoded ? next.split("/").map(encodeURIComponent).join("/") : next;
        return hadSlash ? "/" + result : result;
      };
      for (const title of data) {
        title.cover_backup = fixRef(title.cover_backup);
        for (const list of title.tierlists || []) {
          for (const tier of list.tiers || []) {
            for (const ch of tier.chars || []) {
              ch.img = fixRef(ch.img);
              ch.img_backup = fixRef(ch.img_backup);
            }
          }
        }
      }
      renderEditor();
    }

    // Кэш превью этой папки хранит старые имена/URL – без сброса
    // галерея продолжит показывать превью, среди которых часть уже не
    // существует под этим путём.
    delete galleryCache[folder];
    const title = pendingTier ? data.find((t) => t.id === pendingTier.titleId) : null;
    await loadGallery(folder, title);

    statusEl.className = "status-msg ok";
    statusEl.textContent = i18n("Готово: пережато файлов — ") + resp.converted;
  } catch (e) {
    statusEl.className = "status-msg err";
    statusEl.textContent = i18n("Ошибка сети: ") + e.message;
  } finally {
    btn.disabled = false;
  }
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
  // Список персонажей вот-вот перерисуется заново (новая папка либо
  // обновление после массового добавления ниже) – прежний выбор для
  // массового добавления в нём уже не найти, оставлять его висеть
  // незачем.
  selectedGalleryNames.clear();

  // Кнопка "Открыть папку" – только на настольном приложении (см.
  // isElectronDesktop) и только когда есть что открывать (папка
  // выбрана в "Папка (источник)" выше).
  document
    .getElementById("m-folder-open-btn")
    .classList.toggle("hidden", !isElectronDesktop || !folder);
  // "Пережать все файлы" – в отличие от кнопки выше, работает и на
  // телефоне тоже (compressImage там свой, через canvas – см. её же
  // комментарий у compressFolder в core/api.js), скрыта только когда
  // нечего пережимать.
  document.getElementById("m-folder-compress-btn").classList.toggle("hidden", !folder);
  document.getElementById("folder-compress-status").textContent = "";

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
        onclick="onGalleryItemClick(this)"
        title="${esc(f.name)}${used ? " (уже добавлен)" : ""}">
      <img src="${esc(f.preview || f.url)}" alt="${esc(f.name)}" loading="lazy"
        data-placeholder="${esc(imagePlaceholder(80, 120))}">
      <div class="gallery-item-name">${esc(f.name)}</div>
      <div class="gallery-check">✓</div>
      <div class="gallery-bulk-check">✓</div>
    </div>`;
    })
    .join("");
  updateGalleryBulkBar();
}

// Общая часть очистки формы добавления персонажа – и при открытии
// модалки с нуля (openModal), и после каждого добавленного персонажа
// внутри уже открытой модалки (confirmAddChar) – модалка теперь сама
// не закрывается после добавления, см. её же комментарий там.
function resetAddCharFormFields() {
  selectedGalleryImg = null;
  document.getElementById("m-name").value = "";
  document.getElementById("m-img").value = "";
  document.getElementById("m-img-backup").value = "";
  document.getElementById("m-img-backup-status").textContent = "";
  document.getElementById("m-img-preview").style.display = "none";
}

// ══ МОДАЛКА ════════════════════════════════════
async function openModal(titleId, listId, ti) {
  pendingTier = { titleId, listId, tierIdx: ti };
  resetAddCharFormFields();
  clearBatchFiles();

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
    document.getElementById("m-folder-open-btn").classList.add("hidden");
    document.getElementById("m-folder-compress-btn").classList.add("hidden");
    return;
  }

  // Папка на диске – служебный slug (folder теперь и не вводится вручную,
  // см. addTitle()), в выпадающем списке человеку нужно название темы,
  // которой она принадлежит – а не сам slug. Для чужой/осиротевшей папки
  // (тема удалена, а её картинки на диске остались) названия не найдётся –
  // тогда показываем сам slug, как и раньше.
  sel.innerHTML = folders
    .map((f) => {
      const owner = data.find((t) => t.folder === f);
      return `<option value="${esc(f)}"${f === title?.folder ? " selected" : ""}>${esc(owner ? owner.title : f)}</option>`;
    })
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
  deleteMediaFile(document.getElementById("m-img-backup").value.trim());
  document.getElementById("m-img-backup").value = "";
  document.getElementById("m-img-backup-status").textContent = "";
  document.getElementById("m-img-preview").style.display = "none";
}

// ── Массовое добавление из уже загруженной папки ──
// Обычный клик по картинке (selectGalleryItem выше) добавляет ровно
// одного персонажа сразу и требует нажать "Добавить" на каждого –
// нормально для нескольких штук, но не для сотни персонажей, заранее
// скинутых в папку через проводник (реальный случай – 133 файла разом).
// "Выбрать несколько" переключает клик по галерее на накопление
// выбора вместо немедленного добавления; имя персонажа при этом всегда
// берётся из имени файла – спрашивать его отдельно для каждой из
// полусотни картинок было бы не быстрее, чем добавлять по одной.
function onGalleryItemClick(el) {
  if (galleryBulkMode) toggleGalleryBulkItem(el);
  else selectGalleryItem(el);
}

function toggleGalleryBulkItem(el) {
  const name = el.dataset.name;
  if (selectedGalleryNames.has(name)) {
    selectedGalleryNames.delete(name);
    el.classList.remove("bulk-selected");
  } else {
    selectedGalleryNames.set(name, el.dataset.url);
    el.classList.add("bulk-selected");
  }
  updateGalleryBulkBar();
}

function updateGalleryBulkBar() {
  const bar = document.getElementById("gallery-bulk-actions");
  if (!bar) return;
  const n = selectedGalleryNames.size;
  bar.classList.toggle("hidden", n === 0);
  document.getElementById("gallery-bulk-add-btn").textContent = i18n("Добавить выбранных ({n})", { n });
}

function toggleGalleryBulkMode() {
  galleryBulkMode = !galleryBulkMode;
  document.getElementById("gallery-grid").classList.toggle("bulk-mode", galleryBulkMode);
  document.getElementById("gallery-bulk-toggle").textContent = galleryBulkMode
    ? i18n("Отменить выбор нескольких")
    : i18n("Выбрать несколько");
  if (!galleryBulkMode) clearGalleryBulkSelection();
}

function clearGalleryBulkSelection() {
  selectedGalleryNames.clear();
  document.querySelectorAll(".gallery-item.bulk-selected").forEach((el) => el.classList.remove("bulk-selected"));
  updateGalleryBulkBar();
}

async function addSelectedGalleryChars() {
  if (!selectedGalleryNames.size || !pendingTier) return;
  const { titleId, listId, tierIdx } = pendingTier;
  const title = data.find((t) => t.id === titleId);
  const list = title?.tierlists.find((l) => l.id === listId);
  if (!list) return;

  for (const [name, url] of selectedGalleryNames) {
    list.tiers[tierIdx].chars.push({ name, img: url });
  }
  ceDirty = true;
  renderEditor();

  // loadGallery() ниже сама чистит выбор (см. её же комментарий там) и
  // заново пересчитывает, кто уже "использован" – только что
  // добавленные персонажи должны сразу же показаться отмеченными.
  const folder = document.getElementById("m-folder")?.value;
  const freshTitle = data.find((t) => t.id === titleId);
  if (folder) await loadGallery(folder, freshTitle);
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

// Общая часть одиночной (uploadCharImage) и пакетной (uploadBatchFiles)
// загрузки – конвертирует в webp (или, если отмечен чекбокс «оригинал»,
// оставляет как есть – см. encodeUploadFile в js/utils.js) и грузит на
// диск под именем, собранным из уже введённого имени персонажа, а не из
// имени файла (см. комментарий у onUploadFilesPicked ниже). Не трогает
// форму/статус/галерею – это разное у одиночной и пакетной загрузки,
// решает вызывающий код.
async function uploadOneCharFile(file, name, folder, keepOriginal) {
  // isSafeFileName() на сервере (core/api.js) запрещает "/", "\" и "..",
  // а vault.saveMedia() дополнительно подчищает остальные небезопасные
  // для имени файла символы (см. её же комментарий в electron/vault.js) –
  // повторяем тот же список здесь, чтобы safeName ниже (по нему потом
  // ищут только что загруженную картинку в списке галереи) совпадал с
  // именем, которое реально легло на диск.
  const safeName = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/\.+/g, "_").trim() || "персонаж";
  const { base64, ext } = await encodeUploadFile(file, keepOriginal);
  const res = await fetch("/api/upload-char-image", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder,
      filename: `${safeName}.${ext}`,
      contentBase64: base64,
      basePath: COLLECTION === "characters" ? undefined : COLLECTION,
    }),
  });
  const result = await res.json();
  if (!result.ok) throw new Error(result.error || i18n("Ошибка загрузки"));
  return { url: result.url, safeName };
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

  // Раньше именем файла на диске (а значит и подсказкой при повторном
  // выборе картинки из этой же папки для другого тайтла) становилось
  // родное имя файла – на компьютере это чинили вручную, переименовывая
  // файл перед загрузкой ("Наруто.jpg" вместо "IMG_1234.jpg"). На
  // телефоне так не делают – там имя файла всегда случайное системное
  // (фото из галереи), а переименовать его перед загрузкой неоткуда.
  // Поэтому имя файла теперь всегда берётся из уже введённого выше поля
  // «Имя персонажа», а не из файла – оно и так обязано быть заполнено
  // до нажатия «Добавить».
  const customName = document.getElementById("m-name").value.trim();
  if (!customName) {
    status.textContent = i18n("Сначала введите имя персонажа выше");
    status.style.color = "var(--red-hi)";
    return;
  }
  if (galleryCache[folder]?.some((f) => f.name === customName)) {
    status.textContent = i18n("Персонаж с таким именем уже есть в этой папке. Выберите другое имя.");
    status.style.color = "var(--red-hi)";
    return;
  }

  const file = fileInput.files[0];
  status.textContent = i18n("Обрабатываю...");
  status.style.color = "var(--text-dim)";

  try {
    const keepOriginal = document.getElementById("m-original")?.checked || false;
    const { safeName } = await uploadOneCharFile(file, customName, folder, keepOriginal);

    status.textContent = i18n("Загружено ✓ Обновляю список...");
    status.style.color = "var(--green)";

    delete galleryCache[folder];
    const title = pendingTier ? data.find((t) => t.id === pendingTier.titleId) : null;
    await loadGallery(folder, title);

    const item = document.querySelector(`.gallery-item[data-name="${CSS.escape(safeName)}"]`);
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

// ══ ПАКЕТНАЯ ЗАГРУЗКА НЕСКОЛЬКИХ ФОТО ══════════
// На телефоне открыть папку темы и накидать в неё скачанные картинки
// (как на компьютере, см. openCharsFolder()) неоткуда – файловой
// системы там не видно. Зато выбрать сразу несколько фото из галереи в
// одном системном диалоге – можно, обычный <input type=file multiple>.
// Единственное, что нельзя разложить по одному полю "Имя персонажа" –
// имя нужно каждому фото своё, отсюда отдельный мини-список ниже.
function onUploadFilesPicked(input) {
  const files = Array.from(input.files || []);
  if (files.length <= 1) {
    updateFileBtnName(input);
    clearBatchFiles();
    if (files.length === 1) uploadCharImage();
    return;
  }
  clearBatchFiles();
  document.getElementById("m-upload-file-name").textContent = i18n("Выбрано файлов: {n}", { n: files.length });
  batchItems = files.map((file) => ({
    id: ++batchCounter,
    file,
    name: "",
    previewUrl: URL.createObjectURL(file),
    status: "pending",
    error: "",
  }));
  renderBatchList();
}

function setBatchItemName(id, value) {
  // Только состояние – без перерисовки списка, иначе на каждую букву
  // поле теряло бы фокус и позицию курсора (renderBatchList строит
  // разметку заново целиком).
  const item = batchItems.find((i) => i.id === id);
  if (item) item.name = value;
}

function removeBatchItem(id) {
  const idx = batchItems.findIndex((i) => i.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(batchItems[idx].previewUrl);
  batchItems.splice(idx, 1);
  renderBatchList();
}

function clearBatchFiles() {
  batchItems.forEach((i) => URL.revokeObjectURL(i.previewUrl));
  batchItems = [];
  const fileInput = document.getElementById("m-upload-file");
  if (fileInput) fileInput.value = "";
  const nameEl = document.getElementById("m-upload-file-name");
  if (nameEl) nameEl.textContent = "";
  renderBatchList();
}

function renderBatchList() {
  const listEl = document.getElementById("batch-upload-list");
  const actionsEl = document.getElementById("batch-upload-actions");
  if (!listEl || !actionsEl) return;
  if (!batchItems.length) {
    listEl.classList.add("hidden");
    actionsEl.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }
  listEl.classList.remove("hidden");
  actionsEl.classList.remove("hidden");
  listEl.innerHTML = batchItems
    .map((it) => {
      const statusText =
        it.status === "uploading"
          ? i18n("Загружаю…")
          : it.status === "done"
            ? "✓"
            : it.status === "error"
              ? it.error
              : "";
      return `
      <div class="batch-item${it.status === "error" ? " batch-item-error" : ""}">
        <img src="${esc(it.previewUrl)}" alt="" class="batch-item-preview">
        <input type="text" class="batch-item-name" placeholder="${i18n("Имя персонажа")}"
          value="${esc(it.name)}" oninput="setBatchItemName(${it.id}, this.value)"
          ${it.status === "uploading" || it.status === "done" ? "disabled" : ""}>
        <span class="batch-item-status">${esc(statusText)}</span>
        <button type="button" class="batch-item-remove" onclick="removeBatchItem(${it.id})"
          ${it.status === "uploading" ? "disabled" : ""} title="${i18n("Убрать из списка")}">✕</button>
      </div>`;
    })
    .join("");
}

async function uploadBatchFiles() {
  const folder = document.getElementById("m-folder").value;
  if (!folder) {
    alert(i18n("Сначала выберите папку выше"));
    return;
  }
  const btn = document.getElementById("batch-upload-btn");
  btn.disabled = true;

  const title = pendingTier ? data.find((t) => t.id === pendingTier.titleId) : null;
  const list = pendingTier && title?.tierlists.find((l) => l.id === pendingTier.listId);
  let addedAny = false;
  const keepOriginal = document.getElementById("m-original")?.checked || false;

  for (const item of batchItems) {
    if (item.status === "done") continue;
    const name = item.name.trim();
    if (!name) {
      item.status = "error";
      item.error = i18n("Введите имя");
      renderBatchList();
      continue;
    }
    // Совпадение с уже загруженным в эту папку раньше, а также с уже
    // успешно загруженным ВЫШЕ по этому же списку – galleryCache
    // пополняется сразу после каждой успешной загрузки (ниже), поэтому
    // к моменту проверки следующей строки в нём уже есть все предыдущие.
    if (galleryCache[folder]?.some((f) => f.name === name)) {
      item.status = "error";
      item.error = i18n("Такое имя уже есть");
      renderBatchList();
      continue;
    }
    item.status = "uploading";
    item.error = "";
    renderBatchList();
    try {
      const { url, safeName } = await uploadOneCharFile(item.file, name, folder, keepOriginal);
      if (!galleryCache[folder]) galleryCache[folder] = [];
      galleryCache[folder].push({ name: safeName, url });
      if (list) {
        list.tiers[pendingTier.tierIdx].chars.push({ name, img: url });
        ceDirty = true;
        addedAny = true;
      }
      item.status = "done";
    } catch (e) {
      item.status = "error";
      item.error = e.message;
    }
    renderBatchList();
  }

  btn.disabled = false;
  if (addedAny) renderEditor();
  // Готовые убираем – мешать их с новой попыткой некому, а ошибочные
  // оставляем на месте: имя можно поправить и снова нажать "Добавить
  // всех", без необходимости выбирать файлы заново.
  batchItems = batchItems.filter((i) => i.status !== "done");
  if (!batchItems.length) clearBatchFiles();
  else renderBatchList();

  if (folder) await loadGallery(folder, title);
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  pendingTier = null;
  selectedGalleryImg = null;
  // Закрыли, не добавив персонажа, – черновая копия, если успела
  // создаться, никому уже не пригодится.
  deleteMediaFile(document.getElementById("m-img-backup").value.trim());
  document.getElementById("m-img-backup").value = "";
  // Следующее открытие модалки – для другого тира или другой темы,
  // режим массового выбора из прошлого раза там ни при чём.
  if (galleryBulkMode) toggleGalleryBulkMode();
  else clearGalleryBulkSelection();
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
  // Модалка только добавляет нового персонажа – текущее значение
  // всегда черновое, ещё не сохранённое ни в одном тир-листе, поэтому
  // удалить его сразу при замене ссылки безопасно (в отличие от
  // discardScratchTitleCoverBackup, сравнивать не с чем).
  deleteMediaFile(document.getElementById("m-img-backup").value.trim());
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
    const original = document.getElementById("m-original")?.checked || false;
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug, original }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    document.getElementById("m-img-backup").value = data.url;
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
  renderEditor();

  // Модалка больше не закрывается сама после добавления – раньше это
  // означало заново открывать её (заново тапать "Добавить" на тире)
  // ради каждого следующего персонажа, что особенно чувствуется на
  // телефоне. Вместо этого форма чистится и готова к следующему вводу
  // сразу же; закрывает модалку сам человек ("Готово"/крестик/Esc/клик
  // по фону) – ровно как задумано в closeModal().
  resetAddCharFormFields();
  await loadGallery(document.getElementById("m-folder").value, title);
  document.getElementById("m-name").focus();
}

// ══ ПЕРЕТАСКИВАНИЕ ЦЕЛЫХ ТИРОВ ══════════════════
// Тот же приём, что у сайдбара тайтлов (bindTitleDrag): draggable на
// самой строке тира, вложенные .char-card тоже draggable – браузер сам
// выбирает ближайшего draggable-предка к точке нажатия, поэтому
// перетаскивание персонажа внутри/между тирами (bindDragDrop ниже) не
// путается с перетаскиванием строки целиком. tierDragSrc держит
// «активна ли сейчас именно эта, а не персонажная, перетасовка» –
// dragover/drop строки всплывают и от перетаскивания персонажа тоже,
// без этой проверки они бы срабатывали не вовремя.
let tierDragSrc = null;

function bindTierRowDrag() {
  // draggable="true" – на .tl-editor-label (цветная область с названием
  // тира), не на всей строке: тир и так занимает всю ширину редактора,
  // и на телефоне палец на самих карточках персонажей внутри строки
  // иногда промахивался мимо конкретной карточки (палец чуть в стороне
  // от неё, всё ещё в пределах строки тира) и утаскивал вместо картинки
  // весь тир целиком. closest('[draggable="true"]') в touch-drag.js
  // теперь находит .tl-editor-label только когда касание правда началось
  // на ней – в остальных случаях доходит до .char-card или не находит
  // ничего вовсе. dragstart/dragover/drop по-прежнему слушаем на всей
  // строке (row) – начатое на .tl-editor-label событие туда всплывает
  // само, а наводиться/отпускать можно над любой её частью, не только
  // над самим названием.
  document.querySelectorAll(".tl-editor-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      tierDragSrc = { listId: row.dataset.list, tierIdx: parseInt(row.dataset.tier) };
      row.classList.add("dragging");
      e.stopPropagation();
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document.querySelectorAll(".tl-editor-row").forEach((r) => r.classList.remove("drag-over-up", "drag-over-dn"));
      tierDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      if (!tierDragSrc) return;
      e.preventDefault();
      e.stopPropagation();
      document.querySelectorAll(".tl-editor-row").forEach((r) => r.classList.remove("drag-over-up", "drag-over-dn"));
      const rect = row.getBoundingClientRect();
      const half = e.clientY < rect.top + rect.height / 2;
      row.classList.add(half ? "drag-over-up" : "drag-over-dn");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drag-over-up", "drag-over-dn");
    });
    row.addEventListener("drop", (e) => {
      if (!tierDragSrc) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over-up", "drag-over-dn");

      const destListId = row.dataset.list;
      const destTierIdx = parseInt(row.dataset.tier);
      if (tierDragSrc.listId !== destListId || tierDragSrc.tierIdx === destTierIdx) {
        tierDragSrc = null;
        return;
      }

      const title = data.find((t) => t.id === activeId);
      const list = title?.tierlists.find((l) => l.id === destListId);
      if (!list) {
        tierDragSrc = null;
        return;
      }

      const rect = row.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      const [moved] = list.tiers.splice(tierDragSrc.tierIdx, 1);
      let insertIdx = destTierIdx > tierDragSrc.tierIdx ? destTierIdx - 1 : destTierIdx;
      if (!insertBefore) insertIdx += 1;
      list.tiers.splice(insertIdx, 0, moved);

      tierDragSrc = null;
      ceDirty = true;
      renderEditor();
    });
  });
}

// ══ DRAG & DROP – с позиционным индикатором ════
function bindDragDrop() {
  document.querySelectorAll(".char-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      // stopPropagation – иначе dragstart всплывает до .tl-editor-row
      // (bindTierRowDrag), у которого свой слушатель dragstart без
      // проверки, от чего именно событие: строка решала, что тащат
      // весь тир, и tierDragSrc оказывался ложно выставлен параллельно
      // с charsDragSrc. Отпускание картинки над .tl-editor-cards
      // (тоже внутри строки) точно так же всплывало до drop строки –
      // тот видел ненулевой (ложный) tierDragSrc и, помимо переноса
      // персонажа, ещё и переставлял сам тир. Отсюда репорт "тир тоже
      // заменяется" при перетаскивании картинки.
      e.stopPropagation();
      charsDragSrc = {
        titleId: card.dataset.title,
        listId: card.dataset.list,
        tierIdx: parseInt(card.dataset.tier),
        charIdx: parseInt(card.dataset.char),
      };
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", (e) => {
      e.stopPropagation();
      card.classList.remove("dragging");
      clearDropIndicator();
      document.querySelectorAll(".tl-editor-cards").forEach((z) => z.classList.remove("drag-over"));
    });
  });

  document.querySelectorAll(".tl-editor-cards").forEach((zone) => {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add("drag-over");
      updateDropIndicator(zone, e.clientX, e.clientY);
    });
    zone.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove("drag-over");
        clearDropIndicator();
      }
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
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
      // Только теперь подтверждено, что диск больше не ссылается на
      // старые копии обложек – раньше этого момента удалять их было
      // нельзя (см. pendingBackupCleanup выше).
      pendingBackupCleanup.forEach((relPath) => deleteMediaFile(relPath));
      pendingBackupCleanup = [];
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
