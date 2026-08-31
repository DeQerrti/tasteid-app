// ══════════════════════════════════════════════
//  РОУТ #/add — редактор отзыва (добавить/править)
//  (см. план перехода на SPA, фаза 3.3)
//
//  Как и #/chars-edit (js/routes/chars-edit.js) и #/favorites-edit
//  (js/routes/favorites-edit.js), этот вид НЕ завёрнут в IIFE: разметка
//  редактора отзыва — рекордсмен по инлайновым onclick="funcName(...)"
//  (обложка, два источника, три выпадающих списка с инлайн-добавлением,
//  сворачиваемые разделы, модалка тегов и категорий — под сотню вызовов),
//  и переписывать каждый на вызов через объект-неймспейс ради самой
//  процедуры переноса — риск опечатки на ровном месте. Верхнеуровневые
//  имена здесь ровно те же, что были в app/add.html: там они точно так же
//  были постоянными глобалами документа. Что они не сталкиваются с
//  остальным index.html, проверено scripts/check-duplicate-functions.js
//  (фаза 0 как раз для этого и разводила имена по страницам).
//
//  ── ГЛАВНОЕ: app/add.html остаётся живым файлом ──
//  Этот маршрут покрывает ТОЛЬКО самостоятельное открытие редактора
//  (#/add и #/add?edit=ID). Вторая жизнь add.html — iframe внутри
//  модалки «Добавить себе» на чужом паспорте: openAddFromPassportModal()
//  в js/passports.js грузит буквально /add.html?fromPassport=1&title=…
//  отдельным документом, читает у него window.addDirty через
//  frame.contentWindow и ждёт, что он сам вызовет
//  window.parent.closeAddFromPassportModal() после сохранения. Поэтому
//  ветка fromPassport здесь НЕ портирована вовсе (в SPA-оболочке
//  window.parent === window, она бессмысленна), а сам add.html не тронут
//  ни на байт — иначе поедет модалка паспортов.
//
//  Из-за этого же расходятся два флага «есть несохранённое»: в add.html
//  это `var addDirty` (нарочно var — только var кладёт свойство на
//  window, откуда его и читает родительский фрейм), здесь — обычный
//  `let addRouteDirty`. Читать его снаружи некому, а no-var из
//  eslint.config.js запретил бы var в app/js/**.
//
//  ── Что обязано жить в mount()/unmount() ──
//  Всё, что вешается на document/window: подписки на tags-map-updated,
//  три «клик мимо выпадающего списка», keydown и beforeunload. Они
//  переживают #view-root, и без снятия продолжат работать поверх
//  следующего маршрута (см. предупреждение в router.js). Слушатели на
//  узлах внутри контейнера (делегирование кликов в списках модалки,
//  input/change на main) умирают вместе с innerHTML = "" в роутере.
//
//  Первичная отрисовка оценок, тегов и списков модалки в add.html
//  выполнялась прямо в теле скрипта, а обновления приходили событием
//  tags-map-updated. В общем документе это событие отгремело один раз,
//  задолго до монтирования маршрута (config.js шлёт его в ответ на
//  site-labels-ready из theme.js — тоже одноразовое), поэтому здесь
//  всё то же самое вызывается явно в mount(), а подписки остаются на
//  случай, если справочники поменяются, пока маршрут открыт.
//
//  Кнопка «История» (js/backup.js) сюда, как и на #/chars-edit, не
//  подключена намеренно: это самозапускающийся IIFE, который вешает
//  плавающую кнопку на документ раз и навсегда — в общей оболочке она
//  осталась бы висеть и на главной. Путь к истории версий никуда не
//  делся: Настройки → История версий (#/backup-history).
// ══════════════════════════════════════════════

// GRADES, GRADE_ORDER, TAGS_MAP приходят из /js/config.js

let selectedGrade = null;
let selectedTags = new Set();
let editingId = null;
// Номера тайтла в чужих базах у редактируемого отзыва. Своего поля в
// форме у них нет: часть достаётся из ссылки на обложку, часть
// дозапрошена у API (scripts/enrich-ids.js). Держим отдельно, чтобы
// при сохранении не потерять то, что из ссылки уже не вывести.
let editingIds = {};

let addCleanupFns = [];
let addPrevTitle = null;
let addLeaveTimer = null;

function addOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  addCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container, params) {
  addPrevTitle = document.title;

  // Состояние вида — с нуля при каждом монтировании: верхнеуровневые
  // let'ы живут столько же, сколько документ, а не столько, сколько
  // открыт маршрут (см. шапку файла).
  selectedGrade = null;
  selectedTags = new Set();
  editingId = null;
  editingIds = {};
  featuredCardTags = new Set();
  noTagsOnCard = false;
  tmTagEdit = null;
  tmCatEdit = null;
  tmCatColorSet = true;
  tmBulkMode = false;
  tmBulkSelected = new Set();
  openSourceDropdown = null;
  typePickerOpen = false;
  typeRenamePending = null;
  statusPickerOpen = false;
  statusRenamePending = null;
  addRouteDirty = false;
  // Та же leaveAddRoute(), что ниже висит на клике по кнопке "назад" —
  // но теперь ещё и на аппаратной/жестовой кнопке "назад" на телефоне
  // (см. installBackButton() в mobile/src/main.js): раньше она обходила
  // эту проверку, дёргая историю напрямую.
  setLeaveGuard(leaveAddRoute);

  container.innerHTML = `
    <header class="app-topbar">
      <a href="#" class="logo topbar-back" id="add-back"><span class="arrow">&larr;</span>TasteID</a>
      <h1 class="topbar-title" id="page-subtitle">${i18n("Добавить отзыв")}</h1>
    </header>

    <main class="add-view">

      <!-- Баннер редактирования -->
      <div class="edit-banner" id="edit-banner" style="display:none">
        <div>Режим редактирования — <span class="edit-banner-title" id="edit-title-hint"></span></div>
        <button class="btn-new" onclick="resetToNew()">${i18n("Новый отзыв")}</button>
      </div>

      <!-- Основное -->
      <h2 class="section-title">${i18n("Основное")}</h2>
      <div class="grid">
        <div class="field">
          <label>${i18n("Название *")}</label>
          <input type="text" id="f-title" placeholder="${i18n("Название")}">
        </div>
        <div class="field">
          <label>${i18n("Год")}</label>
          <input type="text" id="f-year" placeholder="${i18n("Год выхода")}">
        </div>
        <div class="field">
          <label>${i18n("Тип")}</label>
          <div class="src-type-wrap" style="width:100%;">
            <button type="button" class="src-type-btn" style="width:100%;" onclick="toggleTypePickerDropdown()">
              <span id="type-picker-label">${i18n("Аниме")}</span><span class="src-caret"></span>
            </button>
            <div class="src-type-dropdown hidden" id="type-picker-dropdown"></div>
          </div>
          <input type="hidden" id="f-type" value="anime">
        </div>
        <div class="field">
          <label>${i18n("Статус")}</label>
          <div class="src-type-wrap" style="width:100%;">
            <button type="button" class="src-type-btn" style="width:100%;" onclick="toggleStatusPickerDropdown()">
              <span id="status-picker-label">${i18n("Завершено")}</span><span class="src-caret"></span>
            </button>
            <div class="src-type-dropdown hidden" id="status-picker-dropdown"></div>
          </div>
          <input type="hidden" id="f-status" value="completed">
        </div>
        <div class="field">
          <label>${i18n("Формат (доп.)")}</label>
          <input type="text" id="f-format" placeholder="${i18n("Например: 12 серий")}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <input type="checkbox" id="f-favorite" hidden>
          <button type="button" class="btn btn-ghost fav-toggle" id="fav-toggle"
                  aria-pressed="false" onclick="toggleFavorite()">
            <svg class="fav-toggle-icon" width="15" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"></path></svg>
            <span id="fav-toggle-label">${i18n("Добавить в Любимое")}</span>
          </button>
        </div>
      </div>

      <!-- Обложка — свёрнута за кнопкой, как и остальные разделы.
           Отдельного заголовка нет: кнопка «Добавить обложку» и так
           называет раздел, а лишняя строка только удлиняла форму. -->
      <div class="src-field" id="cover-field">
        <button type="button" class="src-add-btn" id="cover-add-btn" onclick="openCoverPanel()">${i18n("Добавить обложку")}</button>
        <div class="cover-block hidden" id="cover-panel">
          <img id="cover-img" class="cover-preview">
          <div class="cover-controls">
            <div class="cover-controls-head">
              <div class="field" style="margin-bottom:0;flex:1;">
                <label>${i18n("Ссылка на обложку")}</label>
                <input type="text" id="f-cover" placeholder="https://..." oninput="previewCover(this.value); scheduleBackupCover();">
              </div>
              <button type="button" class="icon-btn" title="Убрать обложку" onclick="closeCoverPanel()">✕</button>
            </div>
            <div class="hint">${i18n("Или загрузи файл — сожмётся и сконвертируется в WebP автоматически.")}</div>
            <div class="cover-upload-row">
              <label class="btn btn-ghost file-btn">
                <input type="file" id="f-cover-upload" accept="image/*" onchange="updateFileBtnName(this)">
                <span>${i18n("Выбрать файл")}</span>
              </label>
              <span class="file-btn-name" id="f-cover-upload-name"></span>
              <button type="button" class="btn btn-ghost" onclick="uploadCoverFile()">${i18n("Загрузить как обложку")}</button>
            </div>
            <div id="cover-upload-status" class="status-msg" style="margin:.4rem 0 0;text-align:left;min-height:0;"></div>
          </div>
        </div>
        <input type="hidden" id="f-cover-backup">
      </div>

      <!-- Даты — состав полей зависит от статуса (см. updateDateFields) -->
      <div class="sec collapsed" id="sec-dates">
        <button type="button" class="src-add-btn sec-toggle" onclick="toggleEditorSection('dates')">${i18n("Добавить дату")}</button>
        <div class="sec-body">
          <div class="sec-head">
            <span class="sec-title">${i18n("Даты")}</span>
            <button type="button" class="icon-btn" title="Свернуть" onclick="toggleEditorSection('dates', false)">✕</button>
          </div>
          <div id="dates-section"></div>
          <div class="field" style="max-width:220px;margin-bottom:0;">
            <label>${i18n("Пересмотров (не считая первого раза)")}</label>
            <input type="number" id="rewatch-count" min="0" value="0" step="1">
          </div>
        </div>
      </div>

      <!-- Источники. Второе поле спрятано до тех пор, пока не понадобится:
           показывать сразу два предложения «добавить источник» смысла нет. -->
      <div class="src-field" id="src-field-1">
        <button type="button" class="src-add-btn" id="src-add-btn-1" onclick="openSourcePanel(1)">${i18n("Добавить источник")}</button>
        <div class="src-panel hidden" id="src-panel-1">
          <div class="src-panel-row">
            <div class="src-type-wrap">
              <button type="button" class="src-type-btn" id="src-type-btn-1" onclick="toggleTypeDropdown(1)">
                <span id="src-type-label-1">Teletype</span><span class="src-caret"></span>
              </button>
              <div class="src-type-dropdown hidden" id="src-type-dropdown-1"></div>
            </div>
            <input type="text" id="f-url" class="src-url-input" placeholder="https://" oninput="onSourceUrlChange(1)">
            <button type="button" class="icon-btn" title="Убрать источник" onclick="closeSourcePanel(1)">✕</button>
          </div>
          <div class="hint" style="margin:.6rem 0 0;">${i18n("Ссылка на публикацию отзыва на стороне — например, на Teletype.")}</div>
          <button type="button" class="btn-new" id="add-second-source" style="margin-top:.6rem;" onclick="showSecondSource()">${i18n("Добавить ещё один источник")}</button>
        </div>
        <input type="hidden" id="f-source" value="teletype">
      </div>

      <div class="src-field" id="src-field-2" style="margin-top:.75rem;" hidden>
        <div class="src-panel" id="src-panel-2">
          <div class="src-panel-row">
            <div class="src-type-wrap">
              <button type="button" class="src-type-btn" id="src-type-btn-2" onclick="toggleTypeDropdown(2)">
                <span id="src-type-label-2">Teletype</span><span class="src-caret"></span>
              </button>
              <div class="src-type-dropdown hidden" id="src-type-dropdown-2"></div>
            </div>
            <input type="text" id="f-url2" class="src-url-input" placeholder="https://" oninput="onSourceUrlChange(2)">
            <button type="button" class="icon-btn" title="Убрать источник" onclick="hideSecondSource()">✕</button>
          </div>
        </div>
        <input type="hidden" id="f-source2" value="">
      </div>

      <!-- Текст отзыва: превью и полный текст — один раздел. Это две части
           одного и того же, разносить их по двум кнопкам было незачем. -->
      <div class="sec collapsed" id="sec-text">
        <button type="button" class="src-add-btn sec-toggle" onclick="toggleEditorSection('text')">${i18n("Добавить текст отзыва")}</button>
        <div class="sec-body">
          <div class="sec-head">
            <span class="sec-title">${i18n("Текст отзыва")}</span>
            <button type="button" class="icon-btn" title="Свернуть" onclick="toggleEditorSection('text', false)">✕</button>
          </div>
          <div class="field">
            <label>${i18n("Превью — показывается на карточке")}</label>
            <textarea id="f-preview" placeholder="${i18n("Пара предложений — что это и о чём…")}"></textarea>
          </div>
          <div class="field" style="margin-bottom:0;">
            <label>${i18n("Полный текст — необязательно")}</label>
            <textarea id="f-review-full" placeholder="${i18n("Развёрнутый отзыв — откроется по клику на карточку. Если оставить пустым, при клике покажется превью со ссылкой на источник.")}" style="min-height:220px;"></textarea>
          </div>
        </div>
      </div>

      <!-- Оценка и теги — тоже один раздел: и то и другое про «как оценил» -->
      <div class="sec collapsed" id="sec-gradetags">
        <button type="button" class="src-add-btn sec-toggle" onclick="toggleEditorSection('gradetags')">${i18n("Добавить оценку и теги")}</button>
        <div class="sec-body">
          <div class="sec-head">
            <span class="sec-title">${i18n("Оценка и теги")}</span>
            <button type="button" class="icon-btn" title="Свернуть" onclick="toggleEditorSection('gradetags', false)">✕</button>
          </div>
          <div class="grades-grid" id="grades-grid"></div>
          <div class="field" style="margin:1.25rem 0 .75rem; display:flex; align-items:flex-end; gap:.6rem;">
            <div style="flex:1;">
              <label>${i18n("Теги")}</label>
              <button type="button" class="btn-new" onclick="openTagModal()">${i18n("Новый тег")}</button>
            </div>
            <button type="button" class="btn-new btn-new-danger" onclick="openTagModal({bulk:true})">${i18n("Удалить")}</button>
          </div>
          <div class="tags-grid" id="tags-grid"></div>

          <div class="field" id="card-tags-field" style="margin-top:1.25rem;" hidden>
            <label>${i18n("Какие теги показывать на карточке")}</label>
            <p class="card-tags-hint">${i18n("На карточке помещается немного — выбери, какие из выбранных тегов важнее. Остальные останутся видны внутри отзыва.")}</p>
            <div class="card-tag-row card-tags-none-row" id="card-tags-none-row" onclick="toggleNoTagsOnCard()">
              <span class="tm-row-check"></span>
              <span class="card-tag-row-name">${i18n("Не показывать теги на карточке")}</span>
            </div>
            <div id="card-tags-list"></div>
            <p class="card-tags-count" id="card-tags-count"></p>
          </div>
        </div>
      </div>

      <!-- Сохранить -->
      <div class="divider"></div>
      <button class="btn-save" id="btn-save" onclick="saveReview()">${i18n("Сохранить отзыв")}</button>
      <div class="status-msg" id="status"></div>

      <!-- Удаление: только в режиме правки. Ссылкой, а не кнопкой, и внизу —
           чтобы не оказаться под пальцем рядом с «Сохранить». -->
      <div class="danger-zone" id="danger-zone" hidden>
        <button type="button" class="tm-link tm-danger" onclick="deleteReview()">${i18n("Удалить этот отзыв")}</button>
        <span class="danger-hint">${i18n("Запись пропадёт из отзывов, «Любимого» и тир-листа. Вернуть можно через «Историю версий».")}</span>
      </div>

    </main>

    <!-- Модалка: новый тег / новая категория. Класс add-view на ней самой —
         чтобы правила вида «.add-view input» (см. index.html) доставали и до
         полей внутри модалки: на исходной странице это были голые
         input/textarea/select на весь документ. -->
    <div class="modal-overlay add-view hidden" id="tag-modal-overlay" onclick="closeTagModalOnOverlay(event)">
      <div class="modal">
        <button class="modal-close" onclick="closeTagModal()">✕</button>
        <div class="modal-title" id="tag-modal-title">${i18n("Новый тег")}</div>

        <div class="tag-modal-tabs">
          <button type="button" class="tag-modal-tab active" data-tab="tag" onclick="switchTagModalTab('tag')">${i18n("Тег")}</button>
          <button type="button" class="tag-modal-tab" data-tab="cat" onclick="switchTagModalTab('cat')">${i18n("Категория")}</button>
        </div>

        <div class="tag-modal-tab-panel" id="tag-modal-tag-panel">
          <div class="field">
            <label>${i18n("Название тега")}</label>
            <input type="text" id="tm-tag-name" placeholder="${i18n("Например: Крутой саундтрек")}">
          </div>
          <div class="field">
            <label>${i18n("Категория")}</label>
            <div class="select-wrap"><select id="tm-tag-cat"></select></div>
          </div>
          <div class="field">
            <label>${i18n("Подсказка (необязательно)")}</label>
            <input type="text" id="tm-tag-tip" placeholder="${i18n("Короткое пояснение, что значит тег")}">
          </div>
          <div class="tm-actions">
            <button class="btn-save" id="tm-tag-save" onclick="submitTag()">${i18n("Добавить тег")}</button>
            <button type="button" class="tm-link" id="tm-tag-cancel" onclick="resetTagForm()" hidden>${i18n("Отмена")}</button>
            <button type="button" class="tm-link tm-danger" id="tm-tag-del" onclick="deleteTag()" hidden>${i18n("Удалить")}</button>
          </div>

          <div class="tm-bulk-bar hidden" id="tm-bulk-bar">
            <span id="tm-bulk-count">${i18n("Ничего не выбрано")}</span>
            <div class="tm-bulk-actions">
              <button type="button" class="tm-link" onclick="tmBulkCancel()">${i18n("Отмена")}</button>
              <button type="button" class="tm-link tm-danger" id="tm-bulk-delete-btn" onclick="tmBulkDeleteConfirm()" disabled>${i18n("Удалить выбранное")}</button>
            </div>
          </div>
          <div class="tm-list-head">
            <span>${i18n("Существующие теги")}</span>
            <input type="search" id="tm-tag-search" placeholder="${i18n("Поиск")}" oninput="renderTmTagList()">
          </div>
          <div class="tm-list" id="tm-tag-list"></div>
        </div>

        <div class="tag-modal-tab-panel" id="tag-modal-cat-panel" style="display:none;">
          <div class="field">
            <label>${i18n("Название категории")}</label>
            <input type="text" id="tm-cat-name" placeholder="${i18n("Например: Технические детали")}">
          </div>
          <div class="field">
            <label>${i18n("Цвет")}</label>
            <div class="tm-color-row">
              <input type="color" id="tm-cat-color" value="#8b1a1a" oninput="markCatColorSet()">
              <button type="button" class="tm-link" id="tm-cat-nocolor" onclick="clearCatColor()" hidden>${i18n("Без цвета")}</button>
              <span class="tm-note" id="tm-cat-colornote" hidden>${i18n("Цвет не задан — теги будут нейтральными")}</span>
            </div>
          </div>
          <div class="tm-actions">
            <button class="btn-save" id="tm-cat-save" onclick="submitCategory()">${i18n("Добавить категорию")}</button>
            <button type="button" class="tm-link" id="tm-cat-cancel" onclick="resetCatForm()" hidden>${i18n("Отмена")}</button>
            <button type="button" class="tm-link tm-danger" id="tm-cat-del" onclick="deleteCategory()" hidden>${i18n("Удалить")}</button>
          </div>

          <!-- Показывается вместо тихой ошибки, когда в категории ещё есть
               теги: раньше deleteCategory() просто отказывала и просила
               перенести теги руками — здесь и перенос, и удаление вместе с
               категорией доступны в один клик. -->
          <div class="tm-cat-delete-choice hidden" id="tm-cat-delete-choice">
            <p class="tm-note" id="tm-cat-delete-note"></p>
            <div class="field">
              <label>${i18n("Перенести теги в категорию")}</label>
              <div class="select-wrap"><select id="tm-cat-move-target"></select></div>
            </div>
            <div class="tm-actions">
              <button type="button" class="btn-new" onclick="tmCatDeleteMove()">${i18n("Перенести и удалить категорию")}</button>
              <button type="button" class="tm-link tm-danger" onclick="tmCatDeleteAll()">${i18n("Удалить категорию вместе с тегами")}</button>
              <button type="button" class="tm-link" onclick="tmCatDeleteCancel()">${i18n("Отмена")}</button>
            </div>
          </div>

          <div class="tm-list-head"><span>${i18n("Категории")}</span></div>
          <div class="tm-list" id="tm-cat-list"></div>
        </div>

        <div class="status-msg" id="tag-modal-status"></div>
      </div>
    </div>`;

  document.title = `TasteID — ${i18n("Добавить отзыв")}`;

  // ── Уход с маршрута ──
  // Раньше это была ссылка "/" в шапке плюс beforeunload: обычная
  // навигация из документа в документ. Здесь документ не меняется,
  // beforeunload не сработает — спрашиваем сами, тем же confirmDialog,
  // что и в add.html на клике по логотипу.
  addOn(document.getElementById("add-back"), "click", (e) => {
    e.preventDefault();
    leaveAddRoute();
  });

  // Клик по строке в списках модалки — делегирован на контейнер: имена
  // тегов приходят от пользователя и в inline-onclick их пришлось бы
  // экранировать дважды.
  document.getElementById("tm-tag-list").addEventListener("click", (e) => {
    const row = e.target.closest(".tm-row");
    if (!row) return;
    if (tmBulkMode) tmBulkToggle(row.dataset.name);
    else editTag(row.dataset.name);
  });
  document.getElementById("tm-cat-list").addEventListener("click", (e) => {
    const row = e.target.closest(".tm-row");
    if (row) editCategory(row.dataset.key);
  });

  // ── Подписки на справочники ──
  addOn(document, "tags-map-updated", renderGradeInput);
  addOn(document, "tags-map-updated", renderTagsGrid);
  addOn(document, "tags-map-updated", syncTypePickerLabel);
  addOn(document, "tags-map-updated", syncStatusPickerLabel);
  addOn(document, "tags-map-updated", () => {
    renderTmTagList();
    renderTmCatList();
  });
  // Держим подписи типов в src-type-label в актуальном состоянии, если
  // SOURCE_LABELS обновился где-то ещё (например, в настройках).
  addOn(document, "tags-map-updated", () => {
    [1, 2].forEach((n) => {
      const label = document.getElementById(`src-type-label-${n}`);
      if (label) label.textContent = sourceLabel(document.getElementById(srcIds(n).source).value || "teletype");
    });
  });

  // ── Клик мимо выпадающего списка закрывает его ──
  addOn(document, "click", (e) => {
    if (openSourceDropdown === null) return;
    const wrap = document.getElementById(`src-type-btn-${openSourceDropdown}`)?.closest(".src-type-wrap");
    if (wrap && !wrap.contains(e.target)) closeTypeDropdown();
  });
  addOn(document, "click", (e) => {
    if (!typePickerOpen) return;
    const wrap = document.getElementById("type-picker-dropdown")?.closest(".src-type-wrap");
    if (wrap && !wrap.contains(e.target)) closeTypePickerDropdown();
  });
  addOn(document, "click", (e) => {
    if (!statusPickerOpen) return;
    if (e.target.closest("#status-picker-dropdown")) return;
    if (e.target.closest(".src-type-btn")) return;
    closeStatusPickerDropdown();
  });

  // ── Escape ──
  // Раньше здесь работали два обработчика: общий из js/utils.js (он
  // кликает по открытой .modal-overlay и зовёт closeXDropdown()) и
  // enableEscapeToLeave(".src-type-dropdown:not(.hidden)") — уйти на "/",
  // если ничего не открыто. Оба в фазе всплытия, и общий шёл первым:
  // он успевал закрыть модалку ДО того, как второй проверял её
  // состояние, и одно нажатие Escape закрывало модалку тегов и тут же
  // уводило со страницы. Здесь то же, что уже сделано в
  // js/routes/chars-edit.js: свой обработчик в фазе ПЕРЕХВАТА, который
  // видит состояние первым, и stopPropagation — до общего не доходит.
  // Инлайн-переименование типа/статуса (startRenameTypePicker) само
  // гасит Escape, но его onkeydown висит на самом поле, то есть уже
  // после перехвата на document — поэтому проверяем поле явно и
  // отдаём событие ему.
  addOn(
    document,
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      if (e.target?.classList?.contains("src-type-rename-input")) return;
      const modal = document.getElementById("tag-modal-overlay");
      if (modal && !modal.classList.contains("hidden")) {
        closeTagModal();
        e.stopPropagation();
        return;
      }
      if (document.querySelector(".src-type-dropdown:not(.hidden)")) {
        closeTypeDropdown();
        closeTypePickerDropdown();
        closeStatusPickerDropdown();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      leaveAddRoute();
    },
    { capture: true }
  );

  // ── Несохранённые изменения ──
  // Форма отзыва — самое частое место, где реально теряют написанное:
  // набрал текст, отвлёкся, закрыл окно или ушёл по ссылке. Большинство
  // полей — обычные input/textarea/select, их ловит один делегированный
  // слушатель на main. Оценка, теги и «Любимое» — исключение: это
  // кнопки, меняющие состояние в JS напрямую (selectedGrade,
  // selectedTags, чекбокс без события change), поэтому помечены
  // отдельно, прямо там, где это состояние меняется.
  const mainEl = container.querySelector("main.add-view");
  mainEl.addEventListener("input", (e) => {
    if (!e.target.closest("[data-no-dirty]")) markAddDirty();
  });
  mainEl.addEventListener("change", (e) => {
    if (!e.target.closest("[data-no-dirty]")) markAddDirty();
  });
  addOn(window, "beforeunload", (e) => {
    if (!addRouteDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Первичная отрисовка — явно, а не по событию: см. шапку файла.
  renderGradeInput();
  renderTagsGrid();
  resetTagForm();
  resetCatForm();
  syncTypePickerLabel();
  syncStatusPickerLabel();
  updateDateFields();

  await initAddPage(params);
}

function unmount() {
  setLeaveGuard(null);
  addCleanupFns.forEach((fn) => fn());
  addCleanupFns = [];
  clearTimeout(backupCoverTimer);
  clearTimeout(addLeaveTimer);
  document.title = addPrevTitle || document.title;
  // Флаги открытых выпадающих списков — обязательно в исходное: общий
  // обработчик Escape из js/utils.js зовёт closeTypeDropdown() и его
  // соседей на ЛЮБОЙ странице приложения, раз уж они теперь объявлены в
  // общем документе. С поднятым флагом они полезли бы в разметку,
  // которой уже нет.
  openSourceDropdown = null;
  typePickerOpen = false;
  statusPickerOpen = false;
  typeRenamePending = null;
  statusRenamePending = null;
  tmBulkMode = false;
  tmBulkSelected = new Set();
  selectedTags = new Set();
  featuredCardTags = new Set();
  noTagsOnCard = false;
  editingId = null;
  editingIds = {};
  addRouteDirty = false;
}

// Уйти с маршрута — с тем же вопросом, что раньше задавала ссылка
// «TasteID» в шапке add.html при несохранённых правках.
async function leaveAddRoute() {
  if (addRouteDirty) {
    const go = await confirmDialog(
      i18n("Отзыв не сохранён — уйти и потерять правки?"),
      i18n("Уйти без сохранения"),
      i18n("Остаться")
    );
    if (!go) return;
    addRouteDirty = false;
  }
  leaveRoute();
}

// ── Чекбокс Любимое ────────────────────────────
function toggleFavorite() {
  const cb = document.getElementById("f-favorite");
  cb.checked = !cb.checked;
  markAddDirty();
  syncFavToggle();
}

// Приводит вид кнопки в соответствие со скрытым чекбоксом. Вызывается
// и при клике, и при заполнении формы существующим отзывом.
function syncFavToggle() {
  const on = document.getElementById("f-favorite").checked;
  const btn = document.getElementById("fav-toggle");
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  document.getElementById("fav-toggle-label").textContent = on ? "В Любимом" : i18n("Добавить в Любимое");
}

// ── Второй источник ────────────────────────────
// Показывать сразу два предложения «добавить источник» незачем: второй
// нужен редко (дублирующая публикация). Поэтому поле спрятано, а
// предложение добавить его лежит внутри уже открытого первого.
function showSecondSource() {
  document.getElementById("src-field-2").hidden = false;
  document.getElementById("add-second-source").hidden = true;
}

function hideSecondSource() {
  document.getElementById("src-field-2").hidden = true;
  document.getElementById("add-second-source").hidden = false;
  document.getElementById("f-url2").value = "";
  document.getElementById("f-source2").value = "";
}

// ── Сворачиваемые разделы ──────────────────────
// Свёрнутый раздел — одна строка-кнопка вместо блока полей. Состояние
// хранится классом collapsed на обёртке, так что кнопка и содержимое
// не могут разъехаться между собой.
function toggleEditorSection(name, open) {
  const wrap = document.getElementById(`sec-${name}`);
  if (!wrap) return;
  const shouldOpen = open === undefined ? wrap.classList.contains("collapsed") : open;
  wrap.classList.toggle("collapsed", !shouldOpen);
}

const EDITOR_SECTIONS = ["dates", "text", "gradetags"];

function collapseAllSections() {
  EDITOR_SECTIONS.forEach((name) => toggleEditorSection(name, false));
}

// Раздел с данными разворачиваем сразу: иначе при редактировании
// существующего отзыва человек не увидит, что там уже что-то есть.
function openFilledSections(r) {
  if (r.date_start || r.date_end || r.date) toggleEditorSection("dates", true);
  if (r.preview || r.review_full) toggleEditorSection("text", true);
  const hasGrade = r.grade !== undefined && r.grade !== null && r.grade !== "";
  if (hasGrade || (r.tags || []).length) toggleEditorSection("gradetags", true);
}

// ── Даты в зависимости от статуса ──────────────
// Заголовок раздела рисует общая обёртка .sec-head, здесь только поля.
function updateDateFields() {
  const status = document.getElementById("f-status").value;
  const section = document.getElementById("dates-section");
  const wrap = document.getElementById("sec-dates");
  const today = new Date().toISOString().slice(0, 10);

  const prevStart = document.getElementById("f-date-start")?.value || today;
  const prevEnd = document.getElementById("f-date-end")?.value || today;

  // «Планирую» — дат ещё нет, прячем раздел целиком, чтобы кнопка
  // «Добавить дату» не предлагала заполнить бессмысленное поле.
  if (status === "planning") {
    section.innerHTML = "";
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  if (status === "completed") {
    section.innerHTML = `
      <div class="hint">${i18n("Если смотрел один день — заполни только «Завершил» или укажи одинаковые даты, на карточке покажется одна дата.")}</div>
      <div class="grid">
        <div class="field">
          <label>${i18n("Начал")} <span style="font-size:.6rem;opacity:.5">${i18n("(необязательно)")}</span></label>
          <input type="date" id="f-date-start" value="${prevStart}">
        </div>
        <div class="field">
          <label>${i18n("Завершил")}</label>
          <input type="date" id="f-date-end" value="${prevEnd}">
        </div>
      </div>`;
    return;
  }

  // current, onhold и любой свой статус — только дата начала.
  section.innerHTML = `
    <div class="grid">
      <div class="field">
        <label>${i18n("Начал")}</label>
        <input type="date" id="f-date-start" value="${prevStart}">
      </div>
    </div>`;
}

// ── Оценки — вид зависит от шкалы, настроенной в настройках ──
// gradesGrid ищется на каждый вызов, а не один раз при загрузке файла:
// разметка вида появляется только в mount() и умирает в unmount().
function renderGradeInput() {
  const gradesGrid = document.getElementById("grades-grid");
  if (!gradesGrid) return;
  const scale = window.SITE_GRADE_SCALE;
  gradesGrid.innerHTML = "";

  if (!scale || scale.type === "categorical") {
    for (const key of GRADE_ORDER) {
      const g = GRADES[key];
      const btn = document.createElement("button");
      btn.className = "grade-btn";
      btn.textContent = g.name;
      btn.style.color = g.color;
      btn.style.borderColor = g.color + "55";
      btn.title = g.desc || "";
      btn.dataset.key = key;
      btn.classList.toggle("active", key === selectedGrade);
      btn.onclick = () => {
        selectedGrade = selectedGrade === key ? null : key;
        markAddDirty();
        renderGradeInput();
      };
      gradesGrid.appendChild(btn);
    }
    return;
  }

  if (scale.type === "stars") {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:6px;align-items:center;";
    for (let i = 1; i <= (scale.numericMax || 5); i++) {
      const star = document.createElement("span");
      star.textContent = selectedGrade && i <= Number(selectedGrade) ? "★" : "☆";
      star.style.cssText = "cursor:pointer;font-size:1.6rem;color:var(--red);";
      star.onclick = () => {
        selectedGrade = selectedGrade === i ? null : i;
        markAddDirty();
        renderGradeInput();
      };
      wrap.appendChild(star);
    }
    gradesGrid.appendChild(wrap);
    const shelf = GRADES[gradeToShelf(selectedGrade)];
    if (shelf) {
      const note = document.createElement("div");
      note.style.cssText = `color:${shelf.color};font-size:.8rem;margin-top:6px;`;
      note.textContent = shelf.name;
      gradesGrid.appendChild(note);
    }
    return;
  }

  // numeric (5/10/100-балльная и т.п.)
  const input = document.createElement("input");
  input.type = "number";
  input.min = 1;
  input.max = scale.numericMax || 10;
  input.value = selectedGrade ?? "";
  input.style.cssText = "width:100px;";
  input.oninput = () => {
    selectedGrade = input.value === "" ? null : Number(input.value);
    renderShelfPreview();
  };
  gradesGrid.appendChild(input);
  const preview = document.createElement("div");
  preview.id = "grade-shelf-preview";
  preview.style.cssText = "font-size:.8rem;margin-top:6px;";
  gradesGrid.appendChild(preview);

  function renderShelfPreview() {
    const shelf = GRADES[gradeToShelf(selectedGrade)];
    preview.style.color = shelf ? shelf.color : "var(--text-dim)";
    preview.textContent = shelf ? shelf.name : "";
  }
  renderShelfPreview();
}

// ── Теги — из TAGS_MAP (config.js) ─────────────
function renderTagsGrid() {
  const tagsGrid = document.getElementById("tags-grid");
  if (!tagsGrid) return;
  tagsGrid.innerHTML = "";
  for (const [tag, meta] of Object.entries(TAGS_MAP)) {
    const btn = document.createElement("span");
    btn.className = "tag-toggle";
    btn.textContent = tag;
    btn.dataset.tag = tag;
    btn.title = meta.tip || "";
    if (selectedTags.has(tag)) btn.classList.add("active");
    btn.onclick = () => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
        btn.classList.remove("active");
        featuredCardTags.delete(tag);
      } else {
        selectedTags.add(tag);
        btn.classList.add("active");
      }
      markAddDirty();
      renderCardTagsList();
    };
    tagsGrid.appendChild(btn);
  }
}

// ── Какие из выбранных тегов показывать на карточке ──
// Карточка — витрина на беглый взгляд, всех тегов там не поместится
// (reviews.js, reviewCard: показывает первые CARD_TAGS_MAX). Модалка
// показывает все выбранные теги отзыва — кликом отмечаешь до
// CARD_TAGS_MAX «избранных». Ничего не отмечено — карточка сама берёт
// первые по порядку (старое поведение, не нужно ничего решать вручную).
// noTagsOnCard — отдельный режим поверх этого: теги на карточке не
// нужны вовсе, список избранных при этом не трогаем и не теряем —
// он просто не используется, пока переключатель включён.
const CARD_TAGS_MAX = 4;
let featuredCardTags = new Set();
let noTagsOnCard = false;

function renderCardTagsList() {
  const field = document.getElementById("card-tags-field");
  const box = document.getElementById("card-tags-list");
  const count = document.getElementById("card-tags-count");
  const noneRow = document.getElementById("card-tags-none-row");
  const tags = [...selectedTags];
  field.hidden = !tags.length;
  if (!tags.length) return;

  noneRow.classList.toggle("selected", noTagsOnCard);

  if (noTagsOnCard) {
    box.innerHTML = "";
    box.classList.add("disabled");
    count.textContent = i18n("Теги не будут показаны на карточке — только внутри отзыва.");
    return;
  }
  box.classList.remove("disabled");

  const atCap = featuredCardTags.size >= CARD_TAGS_MAX;
  box.innerHTML = tags
    .map((tag) => {
      const featured = featuredCardTags.has(tag);
      const disabled = atCap && !featured;
      return `<div class="card-tag-row ${featured ? "selected" : ""} ${disabled ? "disabled" : ""}"
        onclick="toggleCardTagFeatured('${esc(tag)}')">
      <span class="tm-row-check"></span>
      <span class="card-tag-row-name">${esc(tag)}</span>
    </div>`;
    })
    .join("");
  count.textContent = featuredCardTags.size
    ? i18n("Выбрано: {n}/{max}", { n: featuredCardTags.size, max: CARD_TAGS_MAX })
    : i18n("Ничего не выбрано — покажутся первые теги по порядку.");
}

function toggleCardTagFeatured(tag) {
  if (featuredCardTags.has(tag)) featuredCardTags.delete(tag);
  else if (featuredCardTags.size < CARD_TAGS_MAX) featuredCardTags.add(tag);
  renderCardTagsList();
}

function toggleNoTagsOnCard() {
  noTagsOnCard = !noTagsOnCard;
  markAddDirty();
  renderCardTagsList();
}

// ── Модалка: теги и категории ──────────────────
//    Раньше правка тегов жила в настройках; её убрали оттуда, а сюда
//    добавить забыли — теперь и создание, и редактирование в одном месте:
//    форма сверху работает в двух режимах, режим задаётся выбором строки
//    в списке под ней.
//
//    Встроенные теги и категории лежат в js/config.js и из объекта их не
//    вычеркнуть, поэтому удаление встроенного тега — это запись его имени
//    в settings.hiddenTags, а переименование — hiddenTags + новая запись
//    в customTags. Для встроенных категорий удаления нет вовсе: на них
//    завязаны встроенные теги. См. BUILTIN_TAG_NAMES / BUILTIN_CAT_KEYS.

let tmTagEdit = null; // имя редактируемого тега или null — тогда режим создания
let tmCatEdit = null; // ключ редактируемой категории или null
let tmCatColorSet = true; // задан ли цвет у категории в форме

function tmStatus(text, kind) {
  const el = document.getElementById("tag-modal-status");
  el.textContent = text || "";
  el.className = "status-msg" + (kind ? " " + kind : "");
}

function openTagModal(opts) {
  document.getElementById("tm-tag-search").value = "";
  resetTagForm();
  resetCatForm();
  switchTagModalTab("tag");
  tmStatus("");
  if (opts?.bulk) tmBulkStart();
  else tmBulkCancel();
  document.getElementById("tag-modal-overlay").classList.remove("hidden");
}

function closeTagModal() {
  document.getElementById("tag-modal-overlay").classList.add("hidden");
  tmBulkCancel();
}

function closeTagModalOnOverlay(e) {
  if (e.target === document.getElementById("tag-modal-overlay")) closeTagModal();
}

function switchTagModalTab(tab) {
  document.querySelectorAll(".tag-modal-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tag-modal-tag-panel").style.display = tab === "tag" ? "" : "none";
  document.getElementById("tag-modal-cat-panel").style.display = tab === "cat" ? "" : "none";
  document.getElementById("tag-modal-overlay").dataset.tab = tab;
  tmSyncTitle();
}

function tmSyncTitle() {
  const tab = document.getElementById("tag-modal-overlay").dataset.tab || "tag";
  const title =
    tab === "tag"
      ? tmTagEdit
        ? "Правка тега"
        : i18n("Новый тег")
      : tmCatEdit
        ? "Правка категории"
        : i18n("Новая категория");
  document.getElementById("tag-modal-title").textContent = title;
}

function populateTagModalCatSelect() {
  const select = document.getElementById("tm-tag-cat");
  const current = select.value;
  select.innerHTML = Object.entries(CAT_LABELS)
    .map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`)
    .join("");
  if (current && CAT_LABELS[current] !== undefined) select.value = current;
}

// ── Массовое удаление тегов ─────────────────────
// Тот же список, что и всегда, — просто клик по строке выбирает её
// вместо того, чтобы открывать правку, а форма добавления/правки и
// переключатель вкладок спрятаны CSS-классом .bulk-mode (см. стили).
let tmBulkMode = false;
let tmBulkSelected = new Set();

function tmBulkStart() {
  tmBulkMode = true;
  tmBulkSelected = new Set();
  document.getElementById("tag-modal-tag-panel").classList.add("bulk-mode");
  document.getElementById("tag-modal-overlay").classList.add("bulk-mode");
  document.getElementById("tm-bulk-bar").classList.remove("hidden");
  tmBulkSyncBar();
  renderTmTagList();
}

function tmBulkCancel() {
  tmBulkMode = false;
  tmBulkSelected = new Set();
  document.getElementById("tag-modal-tag-panel").classList.remove("bulk-mode");
  document.getElementById("tag-modal-overlay").classList.remove("bulk-mode");
  document.getElementById("tm-bulk-bar").classList.add("hidden");
  renderTmTagList();
}

function tmBulkToggle(name) {
  if (tmBulkSelected.has(name)) tmBulkSelected.delete(name);
  else tmBulkSelected.add(name);
  tmBulkSyncBar();
  renderTmTagList();
}

function tmBulkSyncBar() {
  const n = tmBulkSelected.size;
  document.getElementById("tm-bulk-count").textContent = n
    ? i18n("Выбрано: {n}", { n })
    : i18n("Ничего не выбрано");
  document.getElementById("tm-bulk-delete-btn").disabled = !n;
}

async function tmBulkDeleteConfirm() {
  const names = [...tmBulkSelected];
  if (!names.length) return;
  if (
    !(await confirmDialog(
      i18n("Удалить выбранные теги ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", { n: names.length })
    ))
  )
    return;

  const btn = document.getElementById("tm-bulk-delete-btn");
  btn.disabled = true;
  try {
    await patchSiteSettings((settings) => {
      settings.customTags = settings.customTags || {};
      const hidden = new Set(settings.hiddenTags || []);
      names.forEach((name) => {
        delete settings.customTags[name];
        if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
      });
      settings.hiddenTags = [...hidden];
    });
    for (let i = 0; i < names.length; i++) {
      tmStatus(i18n("Удаляем {i} из {n}…", { i: i + 1, n: names.length }));
      await applyTagToReviews(names[i], "");
      delete TAGS_MAP[names[i]];
      selectedTags.delete(names[i]);
    }
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    tmStatus(i18n("Удалено тегов: {n}", { n: names.length }), "ok");
    tmBulkCancel();
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
    btn.disabled = false;
  }
}

// ── Списки существующих ────────────────────────
function renderTmTagList() {
  const box = document.getElementById("tm-tag-list");
  const q = document.getElementById("tm-tag-search").value.trim().toLowerCase();

  const byCat = {};
  Object.keys(TAGS_MAP)
    .filter((name) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b, "ru"))
    .forEach((name) => {
      const cat = TAGS_MAP[name].cat || "special";
      (byCat[cat] = byCat[cat] || []).push(name);
    });

  // Сначала категории в их обычном порядке, затем осиротевшие (категорию
  // удалили, а тег на неё ещё смотрит) — чтобы такой тег не пропал из списка.
  const order = Object.keys(CAT_LABELS).filter((key) => byCat[key]);
  Object.keys(byCat).forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });

  if (!order.length) {
    box.innerHTML = `<div class="tm-empty">${q ? "Ничего не найдено" : i18n("Тегов пока нет")}</div>`;
    return;
  }

  box.innerHTML = order
    .map((key) => {
      const rows = byCat[key]
        .map((name) => {
          const selected = tmBulkMode && tmBulkSelected.has(name);
          const active = !tmBulkMode && name === tmTagEdit;
          const marker = tmBulkMode ? `<span class="tm-row-check"></span>` : `<span class="tm-row-note">✎</span>`;
          return `
      <button type="button" class="tm-row${active ? " active" : ""}${selected ? " selected" : ""}" data-name="${esc(name)}">
        <span class="tm-row-name">${esc(name)}</span>
        ${marker}
      </button>`;
        })
        .join("");
      return `<div class="tm-group">${esc(CAT_LABELS[key] || key)}</div>${rows}`;
    })
    .join("");
}

function renderTmCatList() {
  const box = document.getElementById("tm-cat-list");
  const counts = {};
  Object.values(TAGS_MAP).forEach((info) => {
    const key = info.cat || "special";
    counts[key] = (counts[key] || 0) + 1;
  });

  box.innerHTML = Object.keys(CAT_LABELS)
    .map((key) => {
      const color = tmSafeColor(CAT_COLORS[key]);
      const dot = `<span class="tm-dot" style="background:${color || "transparent"}"></span>`;
      const used = counts[key] || 0;
      return `<button type="button" class="tm-row${key === tmCatEdit ? " active" : ""}" data-key="${esc(key)}">
      ${dot}<span class="tm-row-name">${esc(CAT_LABELS[key])}</span>
      <span class="tm-row-note">${used}</span>
      <span class="tm-row-note">✎</span>
    </button>`;
    })
    .join("");
}

// Цвет приходит из site-settings.json, а подставляется в атрибут style —
// пропускаем только настоящий hex, чтобы туда нельзя было дописать своё.
function tmSafeColor(value) {
  return /^#[0-9a-f]{3,8}$/i.test(value || "") ? value : "";
}

// ── Теги: форма ────────────────────────────────
function tmSyncTagForm() {
  const editing = tmTagEdit !== null;
  document.getElementById("tm-tag-save").textContent = editing ? "Сохранить тег" : i18n("Добавить тег");
  document.getElementById("tm-tag-cancel").hidden = !editing;
  document.getElementById("tm-tag-del").hidden = !editing;
  tmSyncTitle();
}

function resetTagForm() {
  tmTagEdit = null;
  document.getElementById("tm-tag-name").value = "";
  document.getElementById("tm-tag-tip").value = "";
  populateTagModalCatSelect();
  tmSyncTagForm();
  renderTmTagList();
}

function editTag(name) {
  const info = TAGS_MAP[name];
  if (!info) return;
  tmTagEdit = name;
  document.getElementById("tm-tag-name").value = name;
  document.getElementById("tm-tag-tip").value = info.tip || "";
  populateTagModalCatSelect();
  if (CAT_LABELS[info.cat] !== undefined) document.getElementById("tm-tag-cat").value = info.cat;
  tmSyncTagForm();
  renderTmTagList();
  tmStatus("");
}

// Отзывы хранят теги строками, поэтому имя правится ещё и в reviews.json.
// Пустое `to` означает «убрать тег из всех отзывов».
async function applyTagToReviews(from, to) {
  const res = await fetch("/api/save-review", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _rename_tag: { from, to } }),
  });
  if (!res.ok) {
    let message = i18n("Справочник обновлён, но старые отзывы поправить не удалось");
    try {
      message = (await res.json()).error || message;
    } catch {}
    throw new Error(message);
  }
}

async function submitTag() {
  const name = document.getElementById("tm-tag-name").value.trim();
  const cat = document.getElementById("tm-tag-cat").value;
  const tip = document.getElementById("tm-tag-tip").value.trim();
  const from = tmTagEdit;

  if (!name) {
    tmStatus(i18n("Введи название тега"), "err");
    return;
  }
  if (name !== from && TAGS_MAP[name]) {
    tmStatus(i18n("Такой тег уже есть"), "err");
    return;
  }

  const btn = document.getElementById("tm-tag-save");
  btn.disabled = true;
  tmStatus(i18n("Сохраняем…"));
  try {
    await patchSiteSettings((settings) => {
      settings.customTags = settings.customTags || {};
      const hidden = new Set(settings.hiddenTags || []);
      if (from) {
        delete settings.customTags[from];
        if (BUILTIN_TAG_NAMES.has(from) && from !== name) hidden.add(from);
      }
      hidden.delete(name);
      settings.customTags[name] = { cat, tip };
      settings.hiddenTags = [...hidden];
    });

    if (from && from !== name) await applyTagToReviews(from, name);

    if (from && from !== name) {
      delete TAGS_MAP[from];
      if (selectedTags.has(from)) {
        selectedTags.delete(from);
        selectedTags.add(name);
      }
    }
    TAGS_MAP[name] = { cat, tip };
    if (!from) selectedTags.add(name);
    document.dispatchEvent(new CustomEvent("tags-map-updated"));

    if (from) {
      resetTagForm();
      tmStatus(from === name ? "Тег обновлён" : `Тег переименован в «${name}»`, "ok");
    } else {
      closeTagModal();
    }
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  } finally {
    btn.disabled = false;
  }
}

async function deleteTag() {
  const name = tmTagEdit;
  if (!name) return;
  if (!(await confirmDialog(i18n("Удалить тег «{name}»?\n\nОн пропадёт и из уже сохранённых отзывов.", { name }))))
    return;

  const btn = document.getElementById("tm-tag-del");
  btn.disabled = true;
  tmStatus(i18n("Удаляем…"));
  try {
    await patchSiteSettings((settings) => {
      settings.customTags = settings.customTags || {};
      delete settings.customTags[name];
      const hidden = new Set(settings.hiddenTags || []);
      if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
      settings.hiddenTags = [...hidden];
    });
    await applyTagToReviews(name, "");

    delete TAGS_MAP[name];
    selectedTags.delete(name);
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    resetTagForm();
    tmStatus(i18n("Тег удалён"), "ok");
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  } finally {
    btn.disabled = false;
  }
}

// ── Категории: форма ───────────────────────────
function markCatColorSet() {
  tmCatColorSet = true;
  tmSyncCatForm();
}

function clearCatColor() {
  tmCatColorSet = false;
  tmSyncCatForm();
}

function tmSyncCatForm() {
  const editing = tmCatEdit !== null;
  document.getElementById("tm-cat-save").textContent = editing ? "Сохранить категорию" : i18n("Добавить категорию");
  document.getElementById("tm-cat-cancel").hidden = !editing;
  // Встроенную категорию удалить нельзя: на ней висят встроенные теги
  // из config.js, и после удаления они остались бы без категории.
  document.getElementById("tm-cat-del").hidden = !editing;
  document.getElementById("tm-cat-nocolor").hidden = !tmCatColorSet;
  document.getElementById("tm-cat-colornote").hidden = tmCatColorSet;
  tmSyncTitle();
}

function resetCatForm() {
  tmCatEdit = null;
  tmCatColorSet = true;
  document.getElementById("tm-cat-name").value = "";
  document.getElementById("tm-cat-color").value = "#8b1a1a";
  document.getElementById("tm-cat-delete-choice").classList.add("hidden");
  tmSyncCatForm();
  renderTmCatList();
}

function editCategory(key) {
  if (CAT_LABELS[key] === undefined) return;
  tmCatEdit = key;
  const color = tmSafeColor(CAT_COLORS[key]);
  tmCatColorSet = !!color;
  document.getElementById("tm-cat-name").value = CAT_LABELS[key];
  document.getElementById("tm-cat-color").value = color || "#8b1a1a";
  tmSyncCatForm();
  renderTmCatList();
  tmStatus("");
}

async function submitCategory() {
  const name = document.getElementById("tm-cat-name").value.trim();
  const color = document.getElementById("tm-cat-color").value;
  const editKey = tmCatEdit;

  if (!name) {
    tmStatus(i18n("Введи название категории"), "err");
    return;
  }

  const key =
    editKey ||
    "custom_" +
      name
        .toLowerCase()
        .replace(/[^a-zа-я0-9]+/gi, "_")
        .slice(0, 30) +
      "_" +
      Date.now().toString(36).slice(-4);
  const builtin = BUILTIN_CAT_KEYS.has(key);

  const btn = document.getElementById("tm-cat-save");
  btn.disabled = true;
  tmStatus(i18n("Сохраняем…"));
  try {
    await patchSiteSettings((settings) => {
      settings.customCategories = settings.customCategories || {};
      settings.categoryColors = settings.categoryColors || {};
      if (builtin) {
        // Встроенный ключ переименовывается через общий механизм подписей,
        // тот же, что и у типов/ролей в настройках.
        settings.labels = settings.labels || {};
        settings.labels.categories = settings.labels.categories || {};
        settings.labels.categories[key] = name;
      } else {
        settings.customCategories[key] = name;
      }
      if (tmCatColorSet) settings.categoryColors[key] = color;
      else delete settings.categoryColors[key];
    });

    CAT_LABELS[key] = name;
    if (tmCatColorSet) CAT_COLORS[key] = color;
    else delete CAT_COLORS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    populateTagModalCatSelect();

    if (editKey) {
      resetCatForm();
      tmStatus(i18n("Категория обновлена"), "ok");
    } else {
      resetCatForm();
      switchTagModalTab("tag");
      populateTagModalCatSelect();
      document.getElementById("tm-tag-cat").value = key;
      tmStatus(i18n("Категория добавлена — можно выбрать её выше"), "ok");
    }
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  } finally {
    btn.disabled = false;
  }
}

function tmCatTagWord(n) {
  return n % 10 === 1 && n % 100 !== 11
    ? i18n("тег")
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? "тега"
      : i18n("тегов");
}

// Встроенную категорию, как и встроенный тег, нельзя вырезать из
// config.js — поэтому её удаление складывается в hiddenCategories, а
// оттуда применяется при загрузке настроек.
async function deleteCategory() {
  const key = tmCatEdit;
  if (!key) return;

  const used = Object.values(TAGS_MAP).filter((info) => info.cat === key).length;
  if (used) {
    tmCatDeleteShowChoice(key, used);
    return;
  }
  if (!(await confirmDialog(i18n("Удалить категорию «{name}»?", { name: CAT_LABELS[key] })))) return;
  await tmCatDeleteCommit(key);
}

// Раньше здесь была тихая ошибка «сначала перенеси теги вручную» —
// теперь перенос (в любую другую категорию) и удаление вместе с тегами
// сделаны прямо тут, одним из двух кликов.
function tmCatDeleteShowChoice(key, used) {
  document.getElementById("tm-cat-delete-note").textContent = i18n(
    "В категории ещё {n} {word}. Перенести их в другую категорию или удалить вместе с категорией?",
    { n: used, word: tmCatTagWord(used) }
  );
  const select = document.getElementById("tm-cat-move-target");
  select.innerHTML = Object.entries(CAT_LABELS)
    .filter(([k]) => k !== key)
    .map(([k, label]) => `<option value="${esc(k)}">${esc(label)}</option>`)
    .join("");
  document.getElementById("tm-cat-delete-choice").classList.remove("hidden");
  tmStatus("");
}

function tmCatDeleteCancel() {
  document.getElementById("tm-cat-delete-choice").classList.add("hidden");
}

async function tmCatDeleteMove() {
  const key = tmCatEdit;
  const target = document.getElementById("tm-cat-move-target").value;
  if (!key || !target) return;
  if (
    !(await confirmDialog(
      i18n("Перенести теги категории «{from}» в «{to}» и удалить «{from}»?", {
        from: CAT_LABELS[key],
        to: CAT_LABELS[target],
      })
    ))
  )
    return;
  tmStatus(i18n("Переносим…"));
  try {
    await tmCatReassignTags(key, target);
    await tmCatDeleteCommit(key);
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка сохранения"), "err");
  }
}

async function tmCatDeleteAll() {
  const key = tmCatEdit;
  if (!key) return;
  const names = Object.keys(TAGS_MAP).filter((n) => TAGS_MAP[n].cat === key);
  if (
    !(await confirmDialog(
      i18n("Удалить категорию «{name}» вместе со всеми тегами ({n})?\n\nОни пропадут и из уже сохранённых отзывов.", {
        name: CAT_LABELS[key],
        n: names.length,
      })
    ))
  )
    return;
  try {
    await tmCatDeleteAllTags(names);
    await tmCatDeleteCommit(key);
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  }
}

// Категория у тега (в т.ч. встроенного) переопределяется тем же
// механизмом, что и переименование тега в submitTag() — записью в
// settings.customTags по точному имени тега, встроенный он или свой.
async function tmCatReassignTags(fromCat, toCat) {
  const names = Object.keys(TAGS_MAP).filter((n) => TAGS_MAP[n].cat === fromCat);
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    names.forEach((name) => {
      settings.customTags[name] = { cat: toCat, tip: TAGS_MAP[name].tip || "" };
    });
  });
  names.forEach((name) => {
    TAGS_MAP[name] = { ...TAGS_MAP[name], cat: toCat };
  });
}

async function tmCatDeleteAllTags(names) {
  await patchSiteSettings((settings) => {
    settings.customTags = settings.customTags || {};
    const hidden = new Set(settings.hiddenTags || []);
    names.forEach((name) => {
      delete settings.customTags[name];
      if (BUILTIN_TAG_NAMES.has(name)) hidden.add(name);
    });
    settings.hiddenTags = [...hidden];
  });
  for (const name of names) {
    await applyTagToReviews(name, "");
    delete TAGS_MAP[name];
    selectedTags.delete(name);
  }
}

async function tmCatDeleteCommit(key) {
  const btn = document.getElementById("tm-cat-del");
  btn.disabled = true;
  tmStatus(i18n("Удаляем…"));
  try {
    await patchSiteSettings((settings) => {
      if (settings.customCategories) delete settings.customCategories[key];
      if (settings.categoryColors) delete settings.categoryColors[key];
      const hidden = new Set(settings.hiddenCategories || []);
      if (BUILTIN_CAT_KEYS.has(key)) hidden.add(key);
      settings.hiddenCategories = [...hidden];
      // Переименование встроенной категории живёт в labels.categories —
      // после удаления оно осталось бы висеть мусором.
      if (settings.labels && settings.labels.categories) {
        delete settings.labels.categories[key];
      }
    });
    delete CAT_LABELS[key];
    delete CAT_COLORS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    populateTagModalCatSelect();
    document.getElementById("tm-cat-delete-choice").classList.add("hidden");
    resetCatForm();
    tmStatus(i18n("Категория удалена"), "ok");
  } catch (err) {
    tmStatus(err.message || i18n("Ошибка удаления"), "err");
  } finally {
    btn.disabled = false;
  }
}

// ── Источники ссылок — источник выбирается прямо в инлайн-меню под
//    кнопкой «+ Добавить источник», без похода в отдельную модалку.
//    Новые типы источников добавляются из того же меню и сохраняются
//    в settings.customSources (SOURCE_LABELS приходит из config.js) ──
const SOURCE_BUILTINS = ["teletype", "other"];
let openSourceDropdown = null; // 1 | 2 | null — какое меню типа сейчас открыто
// Ключ источника, у которого сейчас открыто инлайн-переименование
// (см. startRenameSourceType) — тот же приём, что у typeRenamePending
// в пикере типа тайтла: не даёт Enter (сам вызывает blur) и
// естественному blur сработать дважды подряд.
let sourceRenamePending = null;

function sourceLabel(key) {
  return SOURCE_LABELS[key] || SOURCE_LABELS.teletype;
}

function srcIds(n) {
  return { url: n === 1 ? "f-url" : "f-url2", source: n === 1 ? "f-source" : "f-source2" };
}

// Приводит вид источника в соответствие с тем, заполнен ли он.
// Первый источник живёт по схеме «кнопка ↔ панель», второй просто
// показывается или прячется целиком — он появляется только по
// требованию из уже открытого первого.
function syncSourcePanel(n) {
  const ids = srcIds(n);
  const hasUrl = document.getElementById(ids.url).value.trim().length > 0;
  const srcKey = document.getElementById(ids.source).value || "teletype";
  document.getElementById(`src-type-label-${n}`).textContent = sourceLabel(srcKey);

  if (n === 2) {
    document.getElementById("src-field-2").hidden = !hasUrl;
    document.getElementById("add-second-source").hidden = hasUrl;
    return;
  }

  document.getElementById(`src-add-btn-${n}`).classList.toggle("hidden", hasUrl);
  document.getElementById(`src-panel-${n}`).classList.toggle("hidden", !hasUrl);
}

// Только для первого источника: у второго своя пара показать/спрятать.
function openSourcePanel(n) {
  const ids = srcIds(n);
  const srcInput = document.getElementById(ids.source);
  if (!srcInput.value) srcInput.value = "teletype";
  document.getElementById(`src-type-label-${n}`).textContent = sourceLabel(srcInput.value);
  document.getElementById(`src-add-btn-${n}`).classList.add("hidden");
  document.getElementById(`src-panel-${n}`).classList.remove("hidden");
  document.getElementById(ids.url).focus();
}

function closeSourcePanel(n) {
  const ids = srcIds(n);
  document.getElementById(ids.url).value = "";
  if (n === 2) document.getElementById(ids.source).value = "";
  closeTypeDropdown();
  document.getElementById(`src-panel-${n}`).classList.add("hidden");
  document.getElementById(`src-add-btn-${n}`).classList.remove("hidden");
}

function onSourceUrlChange(_n) {
  // резерв на будущее — например, автоопределение типа источника по URL
}

function renderTypeDropdown(n) {
  const ids = srcIds(n);
  const dd = document.getElementById(`src-type-dropdown-${n}`);
  const current = document.getElementById(ids.source).value || "teletype";
  const options = Object.entries(SOURCE_LABELS)
    .map(([key, label]) => {
      const custom = !SOURCE_BUILTINS.includes(key);
      return `
    <div class="src-type-option${key === current ? " active" : ""}" data-type-key="${esc(key)}" onclick="selectSourceType(${n}, '${key}')">
      <span class="src-type-option-label">${esc(label)}</span>
      ${custom ? `<span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameSourceType(${n}, '${key}')">✎</span>` : ""}
      ${custom ? `<span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeSourceType('${key}')">✕</span>` : ""}
    </div>`;
    })
    .join("");
  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddSourceTypeForm(${n})">${i18n("Добавить")}</button>
    </div>
    <div class="src-type-add-form hidden" id="src-type-add-form-${n}">
      <input type="text" id="src-type-new-name-${n}" placeholder="${i18n("Например: Дзен")}">
      <button type="button" class="btn-new" onclick="confirmAddSourceType(${n})">${i18n("Ок")}</button>
    </div>
    <div class="status-msg src-type-status" id="src-type-status-${n}"></div>`;
}

function toggleTypeDropdown(n) {
  const dd = document.getElementById(`src-type-dropdown-${n}`);
  const isOpen = !dd.classList.contains("hidden");
  closeTypeDropdown();
  if (!isOpen) {
    renderTypeDropdown(n);
    dd.classList.remove("hidden");
    openSourceDropdown = n;
  }
}

function closeTypeDropdown() {
  if (openSourceDropdown === null) return;
  document.getElementById(`src-type-dropdown-${openSourceDropdown}`)?.classList.add("hidden");
  openSourceDropdown = null;
}

function selectSourceType(n, key) {
  document.getElementById(srcIds(n).source).value = key;
  document.getElementById(`src-type-label-${n}`).textContent = sourceLabel(key);
  closeTypeDropdown();
}

function showAddSourceTypeForm(n) {
  const dd = document.getElementById(`src-type-dropdown-${n}`);
  dd.querySelector(".src-type-list").style.display = "none";
  dd.querySelector(".src-type-add-row").style.display = "none";
  document.getElementById(`src-type-add-form-${n}`).classList.remove("hidden");
  document.getElementById(`src-type-new-name-${n}`).focus();
}

async function confirmAddSourceType(n) {
  const input = document.getElementById(`src-type-new-name-${n}`);
  const statusEl = document.getElementById(`src-type-status-${n}`);
  const name = input.value.trim();

  if (!name) {
    statusEl.textContent = i18n("Введи название источника");
    statusEl.className = "status-msg src-type-status err";
    return;
  }
  const exists = Object.values(SOURCE_LABELS).some((l) => l.toLowerCase() === name.toLowerCase());
  if (exists) {
    statusEl.textContent = i18n("Такой источник уже есть");
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
      settings.customSources = settings.customSources || {};
      settings.customSources[key] = name;
    });
    SOURCE_LABELS[key] = name;
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    selectSourceType(n, key);
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg src-type-status err";
  }
}

async function removeSourceType(key) {
  if (!(await confirmDialog(i18n("Удалить источник «{name}»?", { name: SOURCE_LABELS[key] })))) return;
  try {
    await patchSiteSettings((settings) => {
      settings.customSources = settings.customSources || {};
      delete settings.customSources[key];
    });
    delete SOURCE_LABELS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (openSourceDropdown !== null) renderTypeDropdown(openSourceDropdown);
    // если удалённый тип был выбран в одном из полей — сбрасываем на Teletype
    [1, 2].forEach((n) => {
      const el = document.getElementById(srcIds(n).source);
      if (el.value === key) {
        el.value = "teletype";
        syncSourcePanel(n);
      }
    });
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование своего источника — тот же приём, что у типа тайтла
// (startRenameTypePicker ниже): клик по ✎ подменяет подпись на
// текстовое поле прямо в строке списка, Enter/уход фокуса сохраняют,
// Esc отменяет. Встроенные источники (Teletype/Другое) не
// переименовываются — как и не удаляются (SOURCE_BUILTINS).
function startRenameSourceType(n, key) {
  const dd = document.getElementById(`src-type-dropdown-${n}`);
  const row = dd?.querySelector(`.src-type-option[data-type-key="${CSS.escape(key)}"]`);
  const labelEl = row?.querySelector(".src-type-option-label");
  if (!labelEl) return;

  sourceRenamePending = key;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "src-type-rename-input";
  input.value = SOURCE_LABELS[key];
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      sourceRenamePending = null;
      renderTypeDropdown(n);
    }
  };
  input.onblur = () => {
    if (sourceRenamePending !== key) return;
    sourceRenamePending = null;
    confirmRenameSourceType(n, key, input.value);
  };
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

async function confirmRenameSourceType(n, key, rawName) {
  const name = rawName.trim();
  const oldName = SOURCE_LABELS[key];
  if (!name || name === oldName) {
    if (openSourceDropdown !== null) renderTypeDropdown(openSourceDropdown);
    return;
  }
  const exists = Object.entries(SOURCE_LABELS).some(([k, l]) => k !== key && l.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert(i18n("Такой источник уже есть"));
    if (openSourceDropdown !== null) renderTypeDropdown(openSourceDropdown);
    return;
  }

  try {
    await patchSiteSettings((settings) => {
      settings.customSources = settings.customSources || {};
      settings.customSources[key] = name;
    });
    SOURCE_LABELS[key] = name;
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    [1, 2].forEach((m) => {
      if (document.getElementById(srcIds(m).source).value === key) {
        document.getElementById(`src-type-label-${m}`).textContent = name;
      }
    });
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  } finally {
    if (openSourceDropdown !== null) renderTypeDropdown(openSourceDropdown);
  }
}

// ── Тип тайтла — тот же паттерн выпадающего списка с инлайн-добавлением,
//    что и у источников (см. блок «Источники» выше). Свои типы хранятся
//    в customTypes/hiddenTypes/customTypePlural, переименования встроенных —
//    в labels.types (site-settings.json), правится прямо тут. ──
const TYPE_BUILTINS = [
  "anime",
  "manga",
  "manhwa",
  "manhua",
  "novel",
  "movie",
  "show",
  "dorama",
  "book",
  "game",
  "gacha",
];
let typePickerOpen = false;

function typeLabel(key) {
  return TYPE_LABELS[key] || TYPE_LABELS.anime;
}

function syncTypePickerLabel() {
  const key = document.getElementById("f-type").value || "anime";
  document.getElementById("type-picker-label").textContent = typeLabel(key);
}

// Ключ типа, у которого сейчас открыт инлайн-рендейм (см.
// startRenameTypePicker) — нужен, чтобы Enter (который сам вызывает
// blur для коммита) и естественный blur не сработали дважды подряд.
let typeRenamePending = null;

function renderTypePickerDropdown() {
  const dd = document.getElementById("type-picker-dropdown");
  const current = document.getElementById("f-type").value || "anime";
  const options = Object.entries(TYPE_LABELS)
    .map(
      ([key, label]) => `
    <div class="src-type-option${key === current ? " active" : ""}" data-type-key="${esc(key)}" onclick="selectTypePicker('${key}')">
      <span class="src-type-option-label">${esc(label)}</span>
      <span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameTypePicker('${key}')">✎</span>
      <span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeTypePicker('${key}')">✕</span>
    </div>`
    )
    .join("");
  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddTypeForm()">${i18n("Добавить тип")}</button>
    </div>
    <div class="src-type-add-form hidden" id="type-picker-add-form" style="flex-direction:column;align-items:stretch;">
      <input type="text" id="type-picker-new-name" placeholder="${i18n("Например: Артбук")}" oninput="prefillTypePlural()">
      <div style="display:flex;gap:.4rem;margin-top:.4rem;">
        <input type="text" id="type-picker-plural-one" placeholder="${i18n("1 штука")}" style="font-size:.78rem;">
        <input type="text" id="type-picker-plural-few" placeholder="2–4" style="font-size:.78rem;">
        <input type="text" id="type-picker-plural-many" placeholder="5+" style="font-size:.78rem;">
      </div>
      <div class="hint" style="margin-top:.3rem;font-size:.68rem;">${i18n("Склонение подставилось автоматически (чёрн­овик) — поправь, если неточно.")}</div>
      <button type="button" class="btn-new" style="margin-top:.4rem;" onclick="confirmAddType()">${i18n("Добавить")}</button>
    </div>
    <div class="status-msg src-type-status" id="type-picker-status"></div>`;
}

function toggleTypePickerDropdown() {
  const dd = document.getElementById("type-picker-dropdown");
  const isOpen = !dd.classList.contains("hidden");
  closeTypeDropdown();
  closeTypePickerDropdown();
  if (!isOpen) {
    renderTypePickerDropdown();
    dd.classList.remove("hidden");
    typePickerOpen = true;
  }
}

function closeTypePickerDropdown() {
  if (!typePickerOpen) return;
  document.getElementById("type-picker-dropdown")?.classList.add("hidden");
  typePickerOpen = false;
}

function selectTypePicker(key) {
  document.getElementById("f-type").value = key;
  syncTypePickerLabel();
  closeTypePickerDropdown();
}

function showAddTypeForm() {
  const dd = document.getElementById("type-picker-dropdown");
  dd.querySelector(".src-type-list").style.display = "none";
  dd.querySelector(".src-type-add-row").style.display = "none";
  document.getElementById("type-picker-add-form").classList.remove("hidden");
  document.getElementById("type-picker-new-name").focus();
}

function prefillTypePlural() {
  const name = document.getElementById("type-picker-new-name").value.trim();
  // i18nGuessPlural отвечает только за английский и возвращает null на
  // любом другом языке — тогда решает русская эвристика. Без этой
  // развилки английскому интерфейсу подставлялись русские окончания:
  // «Podcast» превращался в «Podcasta/Podcastов». Обе функции дают
  // черновик, который тут же показывается в трёх редактируемых полях.
  const [one, few, many] = i18nGuessPlural(name) || guessRussianPlural(name);
  document.getElementById("type-picker-plural-one").value = one;
  document.getElementById("type-picker-plural-few").value = few;
  document.getElementById("type-picker-plural-many").value = many;
}

async function confirmAddType() {
  const nameInput = document.getElementById("type-picker-new-name");
  const statusEl = document.getElementById("type-picker-status");
  const name = nameInput.value.trim();

  if (!name) {
    statusEl.textContent = i18n("Введи название типа");
    statusEl.className = "status-msg src-type-status err";
    return;
  }
  const exists = Object.values(TYPE_LABELS).some((l) => l.toLowerCase() === name.toLowerCase());
  if (exists) {
    statusEl.textContent = i18n("Такой тип уже есть");
    statusEl.className = "status-msg src-type-status err";
    return;
  }

  const one = document.getElementById("type-picker-plural-one").value.trim() || name;
  const few = document.getElementById("type-picker-plural-few").value.trim() || name;
  const many = document.getElementById("type-picker-plural-many").value.trim() || name;

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
      settings.customTypes = settings.customTypes || {};
      settings.customTypePlural = settings.customTypePlural || {};
      settings.customTypes[key] = name;
      settings.customTypePlural[key] = [one, few, many];
    });
    TYPE_LABELS[key] = name;
    TYPE_PLURAL[key] = [one, few, many];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    selectTypePicker(key);
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg src-type-status err";
  }
}

// Встроенный тип нельзя вырезать из TYPE_LABELS в коде — «удаление»
// для него складывается в hiddenTypes, тем же приёмом, что и у тегов и
// категорий: он просто перестаёт появляться в списке. У своих типов
// удаление настоящее — стирает customTypes/customTypePlural целиком.
async function removeTypePicker(key) {
  if (Object.keys(TYPE_LABELS).length <= 1) {
    alert(i18n("Должен остаться хотя бы один тип"));
    return;
  }
  if (!(await confirmDialog(i18n("Удалить тип «{name}»?", { name: TYPE_LABELS[key] })))) return;
  const isBuiltin = TYPE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.hiddenTypes = settings.hiddenTypes || [];
        if (!settings.hiddenTypes.includes(key)) settings.hiddenTypes.push(key);
      } else {
        settings.customTypes = settings.customTypes || {};
        settings.customTypePlural = settings.customTypePlural || {};
        delete settings.customTypes[key];
        delete settings.customTypePlural[key];
      }
    });
    delete TYPE_LABELS[key];
    delete TYPE_PLURAL[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (typePickerOpen) renderTypePickerDropdown();
    if (document.getElementById("f-type").value === key) selectTypePicker(Object.keys(TYPE_LABELS)[0]);
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование — инлайн, прямо в строке списка: клик по ✎ подменяет
// подпись на текстовое поле, Enter/уход фокуса сохраняют, Esc отменяет.
// Встроенный тип переименовывается через labels.types (оверрайд
// подписи, ключ в TYPE_BUILTINS не меняется), свой — через сам
// customTypes[key].
function startRenameTypePicker(key) {
  const dd = document.getElementById("type-picker-dropdown");
  const row = dd?.querySelector(`.src-type-option[data-type-key="${CSS.escape(key)}"]`);
  const labelEl = row?.querySelector(".src-type-option-label");
  if (!labelEl) return;

  typeRenamePending = key;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "src-type-rename-input";
  input.value = TYPE_LABELS[key];
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      typeRenamePending = null;
      renderTypePickerDropdown();
    }
  };
  input.onblur = () => {
    if (typeRenamePending !== key) return;
    typeRenamePending = null;
    confirmRenameTypePicker(key, input.value);
  };
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

async function confirmRenameTypePicker(key, rawName) {
  const name = rawName.trim();
  const oldName = TYPE_LABELS[key];
  if (!name || name === oldName) {
    if (typePickerOpen) renderTypePickerDropdown();
    return;
  }
  const exists = Object.entries(TYPE_LABELS).some(([k, l]) => k !== key && l.toLowerCase() === name.toLowerCase());
  if (exists) {
    alert(i18n("Такой тип уже есть"));
    if (typePickerOpen) renderTypePickerDropdown();
    return;
  }

  const isBuiltin = TYPE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.labels = settings.labels || {};
        settings.labels.types = settings.labels.types || {};
        settings.labels.types[key] = name;
      } else {
        settings.customTypes = settings.customTypes || {};
        settings.customTypes[key] = name;
      }
    });
    TYPE_LABELS[key] = name;
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  } finally {
    if (typePickerOpen) {
      syncTypePickerLabel();
      renderTypePickerDropdown();
    }
  }
}

// ── Статус — такой же пикер, как у типа ────────
// Был обычный <select>: он не давал добавить свой статус, хотя типы
// это уже умели. Теперь список общий по виду и поведению, а «своё»
// значение дописывается в statusBuckets внутри site-settings.json.
//
// Само значение по-прежнему лежит в поле f-status (hidden), поэтому
// заполнение и сохранение формы менять не пришлось.
//
// Встроенные статусы (как TYPE_BUILTINS у типов) — их нельзя вычеркнуть
// из DEFAULT_STATUS_BUCKETS в коде, поэтому «удаление» для них
// складывается в hiddenStatuses (тот же массив, что и глазок в
// настройках — там же можно вернуть обратно), а не по-настоящему
// стирает статус. У своих статусов удаление настоящее.
const STATUS_BUILTINS = ["current", "onhold", "planning"];

// Список всех доступных статусов. "completed" — не bucket, он всегда
// последний и неудаляемый: это конечное состояние, а не этап, и он
// не проходит через hiddenStatuses (см. её же комментарий в now.js) —
// без него нечем было бы пометить отзыв завершённым.
function statusOptions() {
  const buckets = activeStatusBuckets().filter((b) => !window.SITE_HIDDEN_STATUSES?.has(b.key));
  return [
    ...buckets.map((b) => ({ key: b.key, label: b.label })),
    { key: "completed", label: siteLabel("statuses", "archive", i18n("Завершено")) },
  ];
}

function statusLabel(key) {
  return statusOptions().find((o) => o.key === key)?.label || key;
}

let statusPickerOpen = false;
// Ключ статуса, у которого сейчас открыт инлайн-рендейм — тот же приём,
// что и у typeRenamePending (см. её же комментарий): Enter сам вызывает
// blur для коммита, флаг не даёт коммитнуть дважды подряд.
let statusRenamePending = null;

function renderStatusPickerDropdown() {
  const dd = document.getElementById("status-picker-dropdown");
  const current = document.getElementById("f-status").value;
  const options = statusOptions()
    .map(
      (o) => `
    <div class="src-type-option${o.key === current ? " active" : ""}" data-status-key="${esc(o.key)}" onclick="selectStatusPicker('${esc(o.key)}')">
      <span class="src-type-option-label">${esc(o.label)}</span>
      <span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameStatusPicker('${esc(o.key)}')">✎</span>
      ${o.key !== "completed" ? `<span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeStatusPicker('${esc(o.key)}')">✕</span>` : ""}
    </div>`
    )
    .join("");

  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddStatusForm()">${i18n("Добавить статус")}</button>
    </div>
    <div class="src-type-add-form hidden" id="status-picker-add-form">
      <input type="text" id="status-picker-new-name" placeholder="${i18n("Например: Перечитываю")}">
      <button type="button" class="btn-new" onclick="confirmAddStatus()">${i18n("Ок")}</button>
    </div>
    <div class="status-msg src-type-status" id="status-picker-status"></div>`;
}

function toggleStatusPickerDropdown() {
  const dd = document.getElementById("status-picker-dropdown");
  const isOpen = !dd.classList.contains("hidden");
  closeTypeDropdown();
  closeTypePickerDropdown();
  closeStatusPickerDropdown();
  if (!isOpen) {
    renderStatusPickerDropdown();
    dd.classList.remove("hidden");
    statusPickerOpen = true;
  }
}

function closeStatusPickerDropdown() {
  if (!statusPickerOpen) return;
  document.getElementById("status-picker-dropdown")?.classList.add("hidden");
  statusPickerOpen = false;
}

function selectStatusPicker(key) {
  document.getElementById("f-status").value = key;
  syncStatusPickerLabel();
  closeStatusPickerDropdown();
  updateDateFields();
}

// Держит подпись на кнопке в согласии со значением поля. Заодно
// подстраховывает случай, когда сохранённый статус успели удалить
// из настроек: тогда откатываемся на первый доступный.
function syncStatusPickerLabel() {
  const field = document.getElementById("f-status");
  const options = statusOptions();
  if (!options.some((o) => o.key === field.value)) {
    field.value = options[0]?.key || "completed";
  }
  document.getElementById("status-picker-label").textContent = statusLabel(field.value);
}

function showAddStatusForm() {
  document.getElementById("status-picker-add-form")?.classList.remove("hidden");
  document.getElementById("status-picker-new-name")?.focus();
}

async function confirmAddStatus() {
  const input = document.getElementById("status-picker-new-name");
  const statusEl = document.getElementById("status-picker-status");
  const name = input.value.trim();

  if (!name) {
    statusEl.textContent = i18n("Введи название статуса");
    statusEl.className = "status-msg src-type-status err";
    return;
  }
  if (statusOptions().some((o) => o.label.toLowerCase() === name.toLowerCase())) {
    statusEl.textContent = i18n("Такой статус уже есть");
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
      // Если своих статусов ещё не задавали, в файле их нет вовсе —
      // берём встроенные, иначе добавление затёрло бы стандартные.
      const current = settings.statusBuckets?.length
        ? settings.statusBuckets
        : DEFAULT_STATUS_BUCKETS.map((b) => ({ ...b, removable: false }));
      settings.statusBuckets = [...current, { key, label: name, removable: true }];
    });
    window.SITE_STATUS_BUCKETS = (
      window.SITE_STATUS_BUCKETS?.length
        ? window.SITE_STATUS_BUCKETS
        : DEFAULT_STATUS_BUCKETS.map((b) => ({ ...b, removable: false }))
    ).concat({ key, label: name, removable: true });
    selectStatusPicker(key);
  } catch (err) {
    statusEl.textContent = err.message || i18n("Ошибка сохранения");
    statusEl.className = "status-msg src-type-status err";
  }
}

async function removeStatusPicker(key) {
  if (!(await confirmDialog(i18n("Удалить статус «{name}»?", { name: statusLabel(key) })))) return;
  const isBuiltin = STATUS_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.hiddenStatuses = settings.hiddenStatuses || [];
        if (!settings.hiddenStatuses.includes(key)) settings.hiddenStatuses.push(key);
      } else {
        if (!settings.statusBuckets) return;
        settings.statusBuckets = settings.statusBuckets.filter((b) => b.key !== key);
      }
    });
    if (isBuiltin) {
      window.SITE_HIDDEN_STATUSES = window.SITE_HIDDEN_STATUSES || new Set();
      window.SITE_HIDDEN_STATUSES.add(key);
    } else {
      window.SITE_STATUS_BUCKETS = (window.SITE_STATUS_BUCKETS || []).filter((b) => b.key !== key);
    }
    if (document.getElementById("f-status").value === key) {
      selectStatusPicker(statusOptions()[0]?.key || "completed");
    } else {
      renderStatusPickerDropdown();
    }
  } catch (err) {
    alert(err.message || i18n("Ошибка удаления"));
  }
}

// Переименование — тот же инлайн-приём, что и у типа (startRenameTypePicker):
// клик по ✎ подменяет подпись на текстовое поле, Enter/уход фокуса
// сохраняют, Esc отменяет. «Завершено» — не настоящий bucket (см.
// statusOptions), его подпись живёт в labels.statuses.archive, у
// обычных — прямо в statusBuckets.
function startRenameStatusPicker(key) {
  const dd = document.getElementById("status-picker-dropdown");
  const row = dd?.querySelector(`.src-type-option[data-status-key="${CSS.escape(key)}"]`);
  const labelEl = row?.querySelector(".src-type-option-label");
  if (!labelEl) return;

  statusRenamePending = key;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "src-type-rename-input";
  input.value = statusLabel(key);
  input.onclick = (e) => e.stopPropagation();
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      statusRenamePending = null;
      renderStatusPickerDropdown();
    }
  };
  input.onblur = () => {
    if (statusRenamePending !== key) return;
    statusRenamePending = null;
    confirmRenameStatusPicker(key, input.value);
  };
  labelEl.replaceWith(input);
  input.focus();
  input.select();
}

async function confirmRenameStatusPicker(key, rawName) {
  const name = rawName.trim();
  const oldName = statusLabel(key);
  if (!name || name === oldName) {
    if (statusPickerOpen) renderStatusPickerDropdown();
    return;
  }
  if (statusOptions().some((o) => o.key !== key && o.label.toLowerCase() === name.toLowerCase())) {
    alert(i18n("Такой статус уже есть"));
    if (statusPickerOpen) renderStatusPickerDropdown();
    return;
  }

  try {
    await patchSiteSettings((settings) => {
      if (key === "completed") {
        settings.labels = settings.labels || {};
        settings.labels.statuses = settings.labels.statuses || {};
        settings.labels.statuses.archive = name;
      } else {
        settings.statusBuckets = settings.statusBuckets || [];
        const bucket = settings.statusBuckets.find((b) => b.key === key);
        if (bucket) bucket.label = name;
      }
    });
    if (key === "completed") {
      window.SITE_LABELS = window.SITE_LABELS || {};
      window.SITE_LABELS.statuses = window.SITE_LABELS.statuses || {};
      window.SITE_LABELS.statuses.archive = name;
    } else {
      const bucket = window.SITE_STATUS_BUCKETS?.find((b) => b.key === key);
      if (bucket) bucket.label = name;
    }
    syncStatusPickerLabel();
  } catch (err) {
    alert(err.message || i18n("Ошибка сохранения"));
  } finally {
    if (statusPickerOpen) renderStatusPickerDropdown();
  }
}

// ── заполнить форму ────────────────────────────
function fillForm(r) {
  editingIds = r.ids || {};
  document.getElementById("f-title").value = r.title || "";
  document.getElementById("f-year").value = r.year || "";
  document.getElementById("f-format").value = r.format || "";
  document.getElementById("f-cover").value = r.cover || "";
  document.getElementById("f-cover-backup").value = r.cover_backup || "";
  document.getElementById("f-url").value = r.url || "";
  document.getElementById("f-preview").value = r.preview || "";
  document.getElementById("f-review-full").value = r.review_full || "";
  document.getElementById("f-source").value = r.source || "teletype";
  document.getElementById("f-type").value = r.type || "anime";
  document.getElementById("f-status").value = r.status || "completed";
  document.getElementById("f-url2").value = r.url2 || "";
  document.getElementById("f-source2").value = r.source2 || "";
  syncTypePickerLabel();

  // Инлайн-панели источников и обложки — раскрыть/свернуть по наличию значения
  syncSourcePanel(1);
  syncSourcePanel(2);
  syncCoverPanel();

  // Переключатель «Любимое»
  document.getElementById("f-favorite").checked = r.favorite === true;
  syncFavToggle();

  // Разворачиваем разделы, в которых уже что-то заполнено
  collapseAllSections();
  openFilledSections(r);

  // Поля дат
  updateDateFields();
  const today = new Date().toISOString().slice(0, 10);
  const startEl = document.getElementById("f-date-start");
  const endEl = document.getElementById("f-date-end");
  if (startEl) startEl.value = r.date_start || today;
  const rewatchEl = document.getElementById("rewatch-count");
  if (rewatchEl) rewatchEl.value = r.rewatch_count || 0;
  if (endEl) endEl.value = r.date_end || today;

  previewCover(r.cover || "");

  selectedGrade = r.grade !== undefined && r.grade !== null ? r.grade : null;
  renderGradeInput();

  selectedTags = new Set(r.tags || []);
  document
    .querySelectorAll(".tag-toggle")
    .forEach((b) => b.classList.toggle("active", selectedTags.has(b.dataset.tag)));
  featuredCardTags = new Set(r.featured_tags_on_card || []);
  noTagsOnCard = !!r.no_tags_on_card;
  renderCardTagsList();
}

// ── сброс ──────────────────────────────────────
function resetToNew() {
  editingId = null;
  editingIds = {};
  document.getElementById("edit-banner").style.display = "none";
  document.getElementById("danger-zone").hidden = true;
  document.getElementById("page-subtitle").textContent = i18n("Добавить отзыв");
  document.getElementById("btn-save").textContent = i18n("Сохранить отзыв");
  // Раньше это было history.replaceState(…, "add.html") — сбросить
  // ?edit=ID, чтобы обновление страницы не открыло снова правку уже
  // сохранённого отзыва. Здесь адрес документа не меняется, меняется
  // только хэш, и replaceState (в отличие от location.hash = …) не
  // порождает hashchange, то есть маршрут не перемонтируется.
  history.replaceState(null, "", "#/add");

  ["f-title", "f-year", "f-format", "f-cover", "f-url", "f-preview", "f-url2", "f-review-full", "f-cover-backup"].forEach(
    (id) => (document.getElementById(id).value = "")
  );
  document.getElementById("f-source").value = "teletype";
  document.getElementById("f-source2").value = "";
  document.getElementById("f-type").value = "anime";
  document.getElementById("f-status").value = "planning";
  document.getElementById("rewatch-count").value = 0;
  syncTypePickerLabel();

  // Свернуть обе панели источников, панель обложки и выпадающие списки типов
  closeTypeDropdown();
  closeTypePickerDropdown();
  syncSourcePanel(1);
  syncSourcePanel(2);
  syncCoverPanel();

  // Сброс переключателя «Любимое»
  document.getElementById("f-favorite").checked = false;
  syncFavToggle();

  // Новый отзыв начинается с компактной формы
  collapseAllSections();

  document.getElementById("cover-img").style.display = "none";
  selectedGrade = null;
  selectedTags.clear();
  featuredCardTags.clear();
  noTagsOnCard = false;
  renderGradeInput();
  document.querySelectorAll(".tag-toggle").forEach((b) => b.classList.remove("active"));
  renderCardTagsList();
  document.getElementById("status").textContent = "";
  document.getElementById("status").className = "status-msg";
  updateDateFields();
}

// ── инит по параметрам маршрута ────────────────
// Раньше это был initPage(), читавший location.search: ?edit=ID для
// правки и ?fromPassport=1&title=… для добавления из чужого паспорта.
// Вторая ветка сюда не переехала намеренно — она живёт в отдельном
// документе add.html внутри iframe (см. шапку файла), а параметры
// первой приходят из хэша через роутер: #/add?edit=ID.
async function initAddPage(params) {
  updateDateFields();

  const editId = params?.get("edit");
  if (!editId) return;

  try {
    const res = await fetch("/reviews.json?_=" + Date.now());
    const data = await res.json();
    const review = data.find((r) => String(r.id) === editId || encodeURIComponent(r.title) === editId);
    if (!review) {
      setStatus("err", i18n("Отзыв с таким ID не найден"));
      return;
    }
    editingId = review.id ?? review.title;
    fillForm(review);
    document.getElementById("edit-banner").style.display = "flex";
    document.getElementById("edit-title-hint").textContent = review.title;
    document.getElementById("page-subtitle").textContent = i18n("Редактировать отзыв");
    document.getElementById("btn-save").textContent = i18n("Сохранить изменения");
    document.title = `TasteID — ${i18n("Редактировать отзыв")}`;
    // Удаляем строго по номеру записи. У совсем старых записей номера
    // может не оказаться — тогда кнопки просто нет: удалять по названию
    // нельзя, под одним названием лежат разные записи.
    document.getElementById("danger-zone").hidden = typeof review.id !== "number";
    // fillForm() трогает те же поля, что и человек руками, — на
    // делегированный input/change слушатель это не похоже (значения
    // ставятся из кода, событий не будет), но renderGradeInput() и
    // прочее могли успеть пометить форму грязной. Она только что
    // открыта — считаем её чистой.
    addRouteDirty = false;
  } catch (e) {
    setStatus("err", i18n("Не удалось загрузить отзыв: ") + e.message);
  }
}

// ── удаление ───────────────────────────────────
// Спрашиваем один раз, но по-человечески: с названием записи, чтобы было
// видно, что удаляется именно то. Обещание про «Историю версий» настоящее —
// reviews.json там отслеживается и откатывается целиком.
async function deleteReview() {
  if (typeof editingId !== "number") return;

  const title = document.getElementById("f-title").value.trim() || i18n("эту запись");
  if (
    !(await confirmDialog(
      i18n(
        "Удалить «{name}»?\n\nЗапись пропадёт из отзывов, «Любимого» и тир-листа.\nВернуть её можно будет только откатом в «Истории версий».",
        { name: title }
      )
    ))
  )
    return;

  setStatus("", i18n("Удаляем…"));
  try {
    const res = await fetch("/api/delete-review", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);

    // В приложении никакой выкладки нет: файл на диске уже переписан,
    // ждать нечего.
    setStatus("ok", i18n("«{name}» удалена.", { name: data.title }));
    cache.reviews = null; // тот же сброс, что и после сохранения — запись пропала, кэш об этом не знает
    refreshOpenReviewsTab(); // вкладка под /add молча висит с уже несуществующей карточкой (js/api.js)
    // Форма после удаления показывает то, чего уже нет, — уходим с
    // маршрута. Флаг «есть несохранённое» сбрасываем явно: иначе уход
    // спросил бы «уйти без сохранения», хотя запись только что удалена,
    // а не брошена недописанной.
    addRouteDirty = false;
    document.getElementById("danger-zone").hidden = true;
    document.getElementById("btn-save").disabled = true;
    addLeaveTimer = setTimeout(() => leaveRoute(), 1800);
  } catch (e) {
    setStatus("err", i18n("Не удалось удалить: ") + e.message);
  }
}

function previewCover(url) {
  const img = document.getElementById("cover-img");
  // Раньше проверялось только url.startsWith("http") — из-за этого превью
  // не показывалось после загрузки файла на сервер (относительный путь
  // вида "/covers/xxx.webp" такой проверке не проходил).
  if (url && url.trim()) {
    img.src = url;
    img.style.display = "block";
  } else img.style.display = "none";
}

// ── Инлайн-панель обложки — свёрнута за кнопкой «+ Добавить обложку»,
//    так же как источники ниже. ──
function openCoverPanel() {
  document.getElementById("cover-add-btn").classList.add("hidden");
  document.getElementById("cover-panel").classList.remove("hidden");
  document.getElementById("f-cover").focus();
}

function closeCoverPanel() {
  document.getElementById("f-cover").value = "";
  document.getElementById("f-cover-backup").value = "";
  document.getElementById("f-cover-upload").value = "";
  document.getElementById("f-cover-upload-name").textContent = "";
  document.getElementById("cover-upload-status").textContent = "";
  previewCover("");
  document.getElementById("cover-panel").classList.add("hidden");
  document.getElementById("cover-add-btn").classList.remove("hidden");
}

// Раскрыть/свернуть панель обложки по наличию значения — как у источников.
function syncCoverPanel() {
  const hasCover = document.getElementById("f-cover").value.trim().length > 0;
  document.getElementById("cover-add-btn").classList.toggle("hidden", hasCover);
  document.getElementById("cover-panel").classList.toggle("hidden", !hasCover);
}

// ── Загрузка своей картинки как обложки (вместо/вместе со ссылкой) ──
function convertCoverToWebp(file) {
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

async function uploadCoverFile() {
  const fileInput = document.getElementById("f-cover-upload");
  const status = document.getElementById("cover-upload-status");
  if (!fileInput.files.length) {
    status.textContent = i18n("Выбери файл");
    status.style.color = "var(--red-hi, #c0392b)";
    return;
  }
  const title = document.getElementById("f-title").value.trim() || "cover";
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Обрабатываю...");
  status.style.color = "";
  try {
    const base64 = await convertCoverToWebp(fileInput.files[0]);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "covers", filename: slug + ".webp", contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    // Обложка загружена напрямую — своя резервная копия ей не нужна.
    document.getElementById("f-cover").value = "";
    document.getElementById("f-cover-backup").value = "/" + data.path;
    previewCover("/" + data.path);
    status.textContent = i18n("Загружено ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

// ── Автобэкап картинки по ссылке — качается на сервере, чтобы не
//    упереться в CORS. Срабатывает через паузу после ввода, не на
//    каждую напечатанную букву. ──
let backupCoverTimer = null;

function scheduleBackupCover() {
  clearTimeout(backupCoverTimer);
  document.getElementById("f-cover-backup").value = "";
  backupCoverTimer = setTimeout(backupCoverNow, 1200);
}

async function backupCoverNow() {
  const url = document.getElementById("f-cover").value.trim();
  const status = document.getElementById("cover-upload-status");
  if (!url || !url.startsWith("http")) return;

  const title = document.getElementById("f-title").value.trim() || "cover";
  const slug =
    title
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
    document.getElementById("f-cover-backup").value = data.url || "/" + data.path;
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

function setStatus(type, text) {
  const el = document.getElementById("status");
  el.className = "status-msg" + (type ? " " + type : "");
  el.textContent = text;
}

// ── сохранение ─────────────────────────────────
async function saveReview() {
  const btn = document.getElementById("btn-save");

  const title = document.getElementById("f-title").value.trim();
  const url = document.getElementById("f-url").value.trim();
  const reviewFull = document.getElementById("f-review-full").value.trim();
  // Превью необязательно: если заполнили только полный текст, само
  // превью (короткий текст-заглушка для карточек/списков и признак
  // «отзыв не пустой» в фильтрах — js/reviews.js, js/now.js, js/stats.js)
  // подтягивается из полного текста, а не остаётся пустым.
  const preview = document.getElementById("f-preview").value.trim() || reviewFull;
  const status = document.getElementById("f-status").value;

  if (!title) {
    setStatus("err", i18n("Заполни название"));
    return;
  }

  // Подстраховка: если ссылку на обложку вписали и сразу сохранили, не
  // дожидаясь паузы в 1.2с — бэкап мог не успеть запуститься. Досылаем
  // его прямо сейчас и ждём завершения перед сохранением отзыва.
  const coverUrl = document.getElementById("f-cover").value.trim();
  if (coverUrl && coverUrl.startsWith("http") && !document.getElementById("f-cover-backup").value) {
    clearTimeout(backupCoverTimer);
    setStatus("", i18n("Делаю резервную копию обложки перед сохранением..."));
    await backupCoverNow();
  }

  const url2 = document.getElementById("f-url2").value.trim() || null;
  const source2 = document.getElementById("f-source2").value || null;

  const dateStart = document.getElementById("f-date-start")?.value || null;
  const dateEnd = document.getElementById("f-date-end")?.value || null;

  const cover = document.getElementById("f-cover").value.trim() || null;

  // Номер тайтла в чужой базе достаётся из самой ссылки на обложку —
  // ничего дополнительно вводить не нужно. Нужен он для будущего
  // импорта списков: там всё сходится по номерам, а не по названиям
  // (см. js/external-ids.js). Уже проставленные номера не затираем —
  // часть из них дозапрошена у API и в ссылке не лежит.
  const ids = mergeIds(editingIds, extractIdsFromCover(cover));

  const review = {
    title,
    url,
    type: document.getElementById("f-type").value,
    status,
    favorite: document.getElementById("f-favorite").checked || false,
    source: url ? document.getElementById("f-source").value : null,
    url2,
    source2: url2 ? source2 : null,
    year: document.getElementById("f-year").value.trim() || null,
    format: document.getElementById("f-format").value.trim() || null,
    cover,
    cover_backup: document.getElementById("f-cover-backup").value.trim() || null,
    date_start: dateStart,
    rewatch_count: parseInt(document.getElementById("rewatch-count").value, 10) || 0,
    date_end: dateEnd,
    preview: preview || null,
    review_full: reviewFull || null,
    grade: selectedGrade,
    tags: [...selectedTags],
    featured_tags_on_card: [...featuredCardTags].filter((t) => selectedTags.has(t)),
    no_tags_on_card: noTagsOnCard,
  };

  if (Object.keys(ids).length) review.ids = ids;

  if (editingId !== null) review._editId = editingId;

  btn.disabled = true;
  btn.textContent = i18n("Сохраняем…");
  setStatus("", "");

  try {
    const res = await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(review),
    });
    const data = await res.json();
    if (res.ok) {
      setStatus("ok", editingId !== null ? `«${title}» обновлён.` : `«${title}» сохранён.`);
      addRouteDirty = false;
      // Список отзывов в памяти (js/api.js: fetchReviews) не знает про
      // эту правку — без сброса карточка на вкладке «Отзывы» показывала
      // бы старые теги/оценку/что угодно ещё до перезагрузки страницы.
      cache.reviews = null;
      // Сброса кэша мало: вкладка под /add спрятана через .hidden, а не
      // разобрана, и сама не перечитается, пока по ней не щёлкнут заново
      // (js/api.js, refreshOpenReviewsTab) — иначе после правки названия
      // старое ещё висело бы в «Отзывах», пока не переключиться туда-обратно.
      refreshOpenReviewsTab();
      if (editingId === null) resetToNew();
    } else {
      setStatus("err", i18n("Ошибка: ") + (data.error || i18n("неизвестная")));
    }
  } catch (e) {
    setStatus("err", i18n("Ошибка сети: ") + e.message);
  }

  btn.disabled = false;
  btn.textContent = editingId !== null ? "Сохранить изменения" : i18n("Сохранить отзыв");
}

// ── Признак несохранённых изменений ────────────
// В add.html этот флаг объявлен как `var addDirty` — нарочно: его
// читает родительское окно через frame.contentWindow.addDirty, а
// свойство на window кладёт только var. Здесь читать его снаружи
// некому (отдельного документа нет), поэтому обычный let — и другое
// имя, чтобы никто не спутал его с тем, «настоящим», из iframe.
let addRouteDirty = false;

function markAddDirty() {
  addRouteDirty = true;
}

registerRoute("#/add", { mount, unmount });
