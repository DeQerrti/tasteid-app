// ══════════════════════════════════════════════
//  РЕДАКТОР ОТЗЫВА – добавить/править
//  (см. план перехода на SPA, фаза 3.3)
//
//  Файл разросся до ~2900 строк и был разбит на несколько по разделам
//  формы – все по-прежнему простые верхнеуровневые функции в общей
//  области видимости страницы (см. «НЕ завёрнут в IIFE» ниже), просто
//  в разных файлах, поэтому порядок подключения в index.html/add.html
//  не имеет значения между ними самими (все они – объявления функций,
//  вызываются позже, после того как загрузятся все скрипты), но сам
//  add.js обязан идти первым: только он объявляет mount/unmount и
//  общее состояние формы (selectedGrade, selectedTags, editingId и
//  т.д.), на которые остальные файлы ссылаются изнутри своих функций.
//  Список файлов:
//
//    add.js               – это состояние формы, mount()/unmount(),
//                            переключатель «Любимое», сворачиваемые
//                            разделы, даты, оценка, теги на карточке;
//    add-tags-modal.js    – модалка «Теги и категории»;
//    add-source-picker.js – инлайн-пикер источника ссылки;
//    add-type-picker.js   – инлайн-пикер типа тайтла;
//    add-status-picker.js – инлайн-пикер статуса;
//    add-form-state.js    – fillForm/resetToNew/initAddPage/deleteReview;
//    add-cover.js         – панель обложки, загрузка файла, автобэкап;
//    add-save.js          – setStatus/saveReview, признак «есть
//                            несохранённое» и сама регистрация маршрута
//                            #/add (последней строкой – ей нужны mount
//                            и unmount отсюда).
//
//  Каждое верхнеуровневое имя, которое используется не в том файле, где
//  объявлено, обязано быть в sharedBrowserGlobals (eslint.config.js) –
//  как и для любых других файлов app/js/, см. CLAUDE.md.
//
//  Как и #/chars-edit (js/routes/chars-edit.js) и #/favorites-edit
//  (js/routes/favorites-edit.js), этот вид НЕ завёрнут в IIFE: разметка
//  редактора отзыва – рекордсмен по инлайновым onclick="funcName(...)"
//  (обложка, два источника, три выпадающих списка с инлайн-добавлением,
//  сворачиваемые разделы, модалка тегов и категорий – под сотню вызовов),
//  и переписывать каждый на вызов через объект-неймспейс ради самой
//  процедуры переноса – риск опечатки на ровном месте. Что верхнеуровневые
//  имена не сталкиваются с остальным index.html, проверено
//  scripts/check-duplicate-functions.js (фаза 0 как раз для этого и
//  разводила имена по страницам).
//
//  ── Три способа открытия ──
//  Этот файл – единственный источник логики редактора, и подключается
//  в трёх разных документах:
//
//    #/add и #/add?edit=ID – обычный маршрут SPA-оболочки (index.html),
//    через registerRoute() внизу файла;
//
//    app/add.html – тот же редактор отдельным документом. Он остался
//    отдельным ради одного случая: iframe внутри модалки «Добавить
//    себе» на чужом паспорте (openAddFromPassportModal() в
//    js/passports.js грузит /add.html?fromPassport=1&title=…). Кроме
//    этого случая add.html можно было бы просто удалить в пользу
//    #/add – но раз документ всё равно должен существовать для iframe,
//    он же остаётся точкой входа и для прямого открытия ссылки;
//
//    IN_SPA_SHELL (ниже) – единственное, что отличает эти два случая
//    в самом коде: true внутри index.html (там уже есть registerRoute
//    и leaveRoute из router.js), false в одиночном add.html. closeAddView()
//    и registerRoute() внизу – единственные места, которые на него смотрят.
//
//  ── Несохранённые изменения и модалка паспорта ──
//  Родительское окно модалки читает флаг «есть несохранённое» через
//  frame.contentWindow.addDirty – а это свойство на window кладёт
//  только var, не let/const (и eslint.config.js запрещает var в
//  app/js/**). Поэтому наружу торчит не сам addDirty (обычный let), а
//  setAddDirty() – единственное место, которое дополнительно пишет то
//  же значение в window.addDirty, и только когда мы правда открыты как
//  модалка паспорта (fromPassportModal). В остальных двух случаях читать
//  window.addDirty некому, и она не заводится вовсе.
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
//  site-labels-ready из theme.js – тоже одноразовое), поэтому здесь
//  всё то же самое вызывается явно в mount(), а подписки остаются на
//  случай, если справочники поменяются, пока маршрут открыт.
//
//  Кнопка «История» (js/backup.js) сюда, как и на #/chars-edit, не
//  подключена намеренно: это самозапускающийся IIFE, который вешает
//  плавающую кнопку на документ раз и навсегда – в общей оболочке она
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

// true внутри index.html (router.js уже подключён и определил
// registerRoute/leaveRoute), false в одиночном app/add.html – см.
// шапку файла и closeAddView() ниже.
const IN_SPA_SHELL = typeof registerRoute === "function";

// Открыты ли мы как модалка «Добавить себе» из чужого паспорта –
// выставляется в initAddPage() и определяет, куда ведёт «уйти»/«сохранить»
// (см. closeAddView() и saveReview()) и нужно ли зеркалить addDirty на
// window (см. setAddDirty()).
let fromPassportModal = false;

function addOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  addCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

async function mount(container, params) {
  addPrevTitle = document.title;

  // Состояние вида – с нуля при каждом монтировании: верхнеуровневые
  // let'ы живут столько же, сколько документ, а не столько, сколько
  // открыт маршрут (см. шапку файла).
  selectedGrade = null;
  selectedTags = new Set();
  editingId = null;
  editingIds = {};
  coverGallery = [];
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
  fromPassportModal = false;
  setAddDirty(false);
  // Та же leaveAddView(), что ниже висит на клике по кнопке "назад" –
  // но теперь ещё и на аппаратной/жестовой кнопке "назад" на телефоне
  // (см. installBackButton() в mobile/src/main.js): раньше она обходила
  // эту проверку, дёргая историю напрямую. setLeaveGuard – из router.js,
  // в одиночном add.html его нет и спрашивать нечего: там кнопка «назад»
  // одна, и она уже проверяется в mount() ниже через leaveAddView().
  if (IN_SPA_SHELL) setLeaveGuard(leaveAddView);

  container.innerHTML = `
    <!-- Шапка липкая (.app-topbar, admin.css) – поэтому «Сохранить» живёт
         здесь, а не только в самом низу длинной формы: сохранить можно с
         любого места, без прокрутки. #edit-banner – только «Новый отзыв»
         в режиме правки (fillForm/resetToNew по-прежнему показывают и
         прячут его через style.display). -->
    <header class="app-topbar ed-bar">
      <a href="#" class="logo topbar-back" id="add-back"><span class="arrow">&larr;</span>TasteID</a>
      <div class="ed-bar-title">
        <h1 class="topbar-title" id="page-subtitle">${i18n("Добавить отзыв")}</h1>
        <span class="ed-bar-name" id="edit-title-hint"></span>
      </div>
      <span class="ed-state" id="ed-state" aria-live="polite"></span>
      <span class="ed-bar-new" id="edit-banner" style="display:none">
        <button type="button" class="btn btn-ghost" onclick="resetToNew()">${i18n("Новый отзыв")}</button>
      </span>
      <button type="button" class="btn ed-save" id="btn-save" title="Ctrl+S" onclick="saveReview()">${i18n("Сохранить отзыв")}</button>
    </header>

    <main class="add-view ed">
      <div class="status-msg ed-status" id="status"></div>

      <div class="ed-cols">
        <!-- Слева – как отзыв будет выглядеть на «Статусах», и всё, что
             относится к самой картинке. Карточку рисует та же manualCard()
             (js/cards.js), что и на вкладке, – см. renderEdPreview(). В
             одиночном add.html (модалка «Добавить себе») cards.js не
             подключён, и блок предпросмотра там скрыт. -->
        <aside class="ed-side">
          <div class="ed-preview-wrap" id="ed-preview-wrap" hidden>
            <div class="ed-cap">${i18n("Так выглядит карточка")}</div>
            <div class="ed-preview" id="ed-preview" inert></div>
          </div>

          <input type="checkbox" id="f-favorite" hidden>
          <button type="button" class="btn btn-ghost fav-toggle" id="fav-toggle"
                  aria-pressed="false" onclick="toggleFavorite()">
            <svg class="fav-toggle-icon" width="15" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"></path></svg>
            <span id="fav-toggle-label">${i18n("Добавить в Любимое")}</span>
          </button>

          <div class="src-field" id="cover-field">
            <button type="button" class="src-add-btn" id="cover-add-btn" onclick="openCoverPanel()">${i18n("Добавить обложку")}</button>
            <div class="cover-block hidden" id="cover-panel">
              <div class="cover-preview-col">
                <img id="cover-img" class="cover-preview" onclick="openCoverGallery()" title="${i18n("Все обложки этого отзыва")}">
                <button type="button" class="btn btn-ghost cover-focus-btn hidden" id="cover-focus-btn" onclick="openFocusPickerForCover()">${i18n("Область картинки")}</button>
                <button type="button" class="btn btn-ghost ed-gallery-btn" onclick="openCoverGallery()">${i18n("Все обложки этого отзыва")}</button>
              </div>
              <input type="hidden" id="f-cover-focus" value="50% 50%">
              <div class="cover-controls">
                <div class="cover-controls-head">
                  <div class="field" style="margin-bottom:0;flex:1;">
                    <label for="f-cover">${i18n("Ссылка на обложку")}</label>
                    <input type="text" id="f-cover" placeholder="https://..." oninput="previewCover(this.value); scheduleBackupCover();">
                  </div>
                  <button type="button" class="icon-btn" title="${i18n("Убрать обложку")}" aria-label="${i18n("Убрать обложку")}" onclick="closeCoverPanel()">✕</button>
                </div>
                <div class="hint">${i18n("Или загрузить файл – сожмётся и сконвертируется в WebP автоматически.")}</div>
                <div class="cover-upload-row">
                  <label class="btn btn-ghost file-btn">
                    <input type="file" id="f-cover-upload" accept="image/*" onchange="updateFileBtnName(this); uploadCoverFile()">
                    <span>${i18n("Выбрать файл")}</span>
                  </label>
                  <span class="file-btn-name" id="f-cover-upload-name"></span>
                </div>
                <label class="original-quality-toggle"><input type="checkbox" id="f-cover-original" onchange="onCoverOriginalToggle()"><span>${i18n("Оригинальное качество (без сжатия)")}</span></label>
                <div id="cover-upload-status" class="status-msg" style="margin:.4rem 0 0;text-align:left;min-height:0;"></div>
              </div>
            </div>
            <input type="hidden" id="f-cover-backup">
          </div>
        </aside>

        <!-- Справа – сама форма. Разделы открыты всегда и идут по
             важности: что это → как оценил → когда → текст → теги →
             источник. Раньше всё после «Основного» было свёрнуто за
             кнопками «Добавить…», а оценка лежала в самом низу. -->
        <div class="ed-form">
          <section class="ed-sec">
            <h2 class="ed-h">${i18n("Основное")}</h2>
            <div class="grid ed-grid">
              <div class="field full">
                <label for="f-title">${i18n("Название")}</label>
                <input type="text" id="f-title" class="ed-title-input" placeholder="${i18n("Название")}">
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
                <label for="f-year">${i18n("Год")}</label>
                <input type="text" id="f-year" inputmode="numeric" placeholder="${i18n("Год выхода")}">
              </div>
              <div class="field">
                <label for="f-format">${i18n("Формат")}</label>
                <input type="text" id="f-format" placeholder="${i18n("Например: 12 серий")}">
              </div>
            </div>
          </section>

          <section class="ed-sec">
            <h2 class="ed-h">${i18n("Оценка")}</h2>
            <div class="grades-grid" id="grades-grid"></div>
          </section>

          <!-- Даты – состав полей зависит от статуса (см. updateDateFields);
               у «Планирую» раздел прячется целиком. -->
          <section class="ed-sec" id="sec-dates">
            <h2 class="ed-h">${i18n("Даты")}</h2>
            <div id="dates-section"></div>
            <div class="field" style="max-width:220px;margin-bottom:0;">
              <label for="rewatch-count">${i18n("Пересмотров")}</label>
              <input type="number" id="rewatch-count" min="0" value="0" step="1">
            </div>
          </section>

          <!-- Текст отзыва – одно поле. Раньше их было два: «превью» (короткий
               текст рядом с обложкой на карточке) и «полный текст». Карточки
               текст давно не показывают, по клику сразу открывается весь
               отзыв, и превью осталось полем, которое ни на что не влияет.
               В данных поля preview тоже больше нет – см. migratePreview в
               core/api.js. -->
          <section class="ed-sec">
            <h2 class="ed-h">${i18n("Текст отзыва")}</h2>
            <div class="field" style="margin-bottom:0;">
              <textarea id="f-review-full" aria-label="${i18n("Текст отзыва")}" placeholder="${i18n("Ваш отзыв – откроется по клику на карточку.")}" style="min-height:240px;"></textarea>
              <div class="ed-count" id="ed-text-count"></div>
            </div>
          </section>

          <!-- Теги: поиск, выбранные отдельной строкой, остальные по
               категориям (см. renderTagsGrid). Раньше все теги шли одной
               сплошной стеной без групп, хотя категория есть у каждого. -->
          <section class="ed-sec">
            <h2 class="ed-h">${i18n("Теги")} <span class="ed-h-note" id="tags-count"></span></h2>
            <div class="ed-tag-tools">
              <input type="search" id="tag-q" data-no-dirty placeholder="${i18n("Найти тег")}" aria-label="${i18n("Найти тег")}">
              <button type="button" class="btn-new" onclick="openTagModal()">${i18n("Новый тег")}</button>
              <button type="button" class="btn-new btn-new-danger" onclick="openTagModal({bulk:true})">${i18n("Удалить")}</button>
            </div>
            <div class="ed-picked" id="tags-picked"></div>
            <div class="ed-cats" id="tags-grid"></div>

            <div class="field" id="card-tags-field" style="margin-top:1.25rem;" hidden>
              <label>${i18n("Какие теги показывать на карточке")}</label>
              <p class="card-tags-hint">${i18n("На карточке помещается немного – выберите, какие из выбранных тегов важнее. Остальные останутся видны внутри отзыва.")}</p>
              <div class="card-tag-row card-tags-none-row" id="card-tags-none-row" onclick="toggleNoTagsOnCard()">
                <span class="tm-row-check"></span>
                <span class="card-tag-row-name">${i18n("Не показывать теги на карточке")}</span>
              </div>
              <div id="card-tags-list"></div>
              <p class="card-tags-count" id="card-tags-count"></p>
            </div>
          </section>

          <!-- Источники. Второе поле спрятано до тех пор, пока не понадобится:
               показывать сразу два предложения «добавить источник» смысла нет. -->
          <section class="ed-sec">
            <h2 class="ed-h">${i18n("Источник")}</h2>
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
                  <button type="button" class="icon-btn" title="${i18n("Убрать источник")}" aria-label="${i18n("Убрать источник")}" onclick="closeSourcePanel(1)">✕</button>
                </div>
                <div class="hint" style="margin:.6rem 0 0;">${i18n("Ссылка на публикацию отзыва на стороне – например, на Teletype.")}</div>
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
                  <button type="button" class="icon-btn" title="${i18n("Убрать источник")}" aria-label="${i18n("Убрать источник")}" onclick="hideSecondSource()">✕</button>
                </div>
              </div>
              <input type="hidden" id="f-source2" value="">
            </div>
          </section>

          <!-- Вторая кнопка сохранения – внизу формы: в модалке «Добавить
               себе» шапка скрыта (см. initAddPage), и без неё сохранить
               было бы нечем. Без id: состояние «Сохраняем…» показывает
               кнопка в шапке, а от двойного нажатия защищает сам
               saveReview(). -->
          <button type="button" class="btn-save ed-save-bottom" onclick="saveReview()">${i18n("Сохранить")}</button>

          <!-- Удаление: только в режиме правки. Ссылкой, а не кнопкой, и внизу –
               чтобы не оказаться под пальцем рядом с «Сохранить». -->
          <div class="danger-zone" id="danger-zone" hidden>
            <button type="button" class="tm-link tm-danger" onclick="deleteReview()">${i18n("Удалить этот отзыв")}</button>
            <span class="danger-hint">${i18n("Запись пропадёт из «Отзывов», «Любимого» и «Тир-листа». Вернуть можно через «Историю версий».")}</span>
          </div>
        </div>
      </div>

    </main>

    <!-- Модалка: новый тег / новая категория. Класс add-view на ней самой –
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
              <span class="tm-note" id="tm-cat-colornote" hidden>${i18n("Цвет не задан – теги будут нейтральными")}</span>
            </div>
          </div>
          <div class="tm-actions">
            <button class="btn-save" id="tm-cat-save" onclick="submitCategory()">${i18n("Добавить категорию")}</button>
            <button type="button" class="tm-link" id="tm-cat-cancel" onclick="resetCatForm()" hidden>${i18n("Отмена")}</button>
            <button type="button" class="tm-link tm-danger" id="tm-cat-del" onclick="deleteCategory()" hidden>${i18n("Удалить")}</button>
          </div>

          <!-- Показывается вместо тихой ошибки, когда в категории ещё есть
               теги: раньше deleteCategory() просто отказывала и просила
               перенести теги руками – здесь и перенос, и удаление вместе с
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

  document.title = `TasteID – ${i18n("Добавить отзыв")}`;

  // ── Уход ──
  // Ссылка стала обычной кнопкой (href="#") везде, даже в одиночном
  // add.html: реальная навигация не даёт спросить подтверждение –
  // спрашиваем сами, тем же confirmDialog, что и everywhere ещё.
  addOn(document.getElementById("add-back"), "click", (e) => {
    e.preventDefault();
    leaveAddView();
  });

  // Клик по строке в списках модалки – делегирован на контейнер: имена
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

  // ── Ctrl+S / Cmd+S – сохранить из любого места формы ──
  // На document, а не на main: фокус может стоять и в шапке, и нигде.
  // preventDefault обязателен – иначе браузер (и WebView) открывает своё
  // «Сохранить страницу как…». Открытая модалка тегов – не время
  // сохранять отзыв: там свои кнопки.
  addOn(document, "keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "s") return;
    e.preventDefault();
    const modal = document.getElementById("tag-modal-overlay");
    if (modal && !modal.classList.contains("hidden")) return;
    saveReview();
  });

  // ── Теги: клик и клавиатура – делегированно ──
  // Имена тегов приходят от пользователя, в inline-onclick их пришлось бы
  // экранировать дважды (та же причина, что у списков модалки выше).
  for (const id of ["tags-grid", "tags-picked"]) {
    const box = document.getElementById(id);
    box.addEventListener("click", (e) => {
      const el = e.target.closest(".tag-toggle");
      if (el) toggleEditorTag(el.dataset.tag);
    });
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target.closest(".tag-toggle");
      if (!el) return;
      e.preventDefault();
      const tag = el.dataset.tag;
      toggleEditorTag(tag);
      // Список перерисован – возвращаем фокус на тот же тег, иначе
      // следующий Tab начинался бы с начала страницы.
      document.querySelector(`#${id} .tag-toggle[data-tag="${CSS.escape(tag)}"]`)?.focus();
    });
  }
  document.getElementById("tag-q").addEventListener("input", renderTagsGrid);

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
  // enableEscapeToLeave(".src-type-dropdown:not(.hidden)") – уйти на "/",
  // если ничего не открыто. Оба в фазе всплытия, и общий шёл первым:
  // он успевал закрыть модалку ДО того, как второй проверял её
  // состояние, и одно нажатие Escape закрывало модалку тегов и тут же
  // уводило со страницы. Здесь то же, что уже сделано в
  // js/routes/chars-edit.js: свой обработчик в фазе ПЕРЕХВАТА, который
  // видит состояние первым, и stopPropagation – до общего не доходит.
  // Инлайн-переименование типа/статуса (startRenameTypePicker) само
  // гасит Escape, но его onkeydown висит на самом поле, то есть уже
  // после перехвата на document – поэтому проверяем поле явно и
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
      leaveAddView();
    },
    { capture: true }
  );

  // ── Несохранённые изменения ──
  // Форма отзыва – самое частое место, где реально теряют написанное:
  // набрал текст, отвлёкся, закрыл окно или ушёл по ссылке. Большинство
  // полей – обычные input/textarea/select, их ловит один делегированный
  // слушатель на main. Оценка, теги и «Любимое» – исключение: это
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
  // Предпросмотр есть только там, где подключён js/cards.js (см.
  // renderEdPreview) – в одиночном add.html блок остаётся скрытым.
  document.getElementById("ed-preview-wrap").hidden = typeof manualCard !== "function";
  addOn(window, "beforeunload", (e) => {
    if (!addDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Первичная отрисовка – явно, а не по событию: см. шапку файла.
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
  // Раньше здесь звали discardScratchCoverBackup() – резервную копию
  // обложки, сделанную во время редактирования, но так и не
  // сохранённую вместе с отзывом (закрыли редактор без сохранения),
  // удаляли сразу при выходе. С галереей обложек (coverGallery в
  // add-cover.js) это больше не нужно и было бы вредно: любая копия,
  // однажды попавшая в галерею, должна остаться на диске, пока её не
  // удалят явно через саму галерею (openGalleryModal), а не потому что
  // редактор закрыли без сохранения. Отсюда и обратная сторона: копия,
  // сделанная во время экспериментов с обложкой, но так и не
  // сохранённая ни в одном отзыве, теперь остаётся на диске как есть –
  // найти такую поможет «Осиротевшие обложки» в настройках.
  if (IN_SPA_SHELL) setLeaveGuard(null);
  addCleanupFns.forEach((fn) => fn());
  addCleanupFns = [];
  clearTimeout(backupCoverTimer);
  clearTimeout(addLeaveTimer);
  document.title = addPrevTitle || document.title;
  // Флаги открытых выпадающих списков – обязательно в исходное: общий
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
  fromPassportModal = false;
  setAddDirty(false);
}

// Уйти – с тем же вопросом, что раньше задавала ссылка «TasteID» в
// шапке при несохранённых правках, независимо от того, как этот вид
// открыт (см. closeAddView() ниже).
async function leaveAddView() {
  const canLeave = await confirmLeaveIfDirty({
    isDirty: () => addDirty,
    save: saveReview,
    message: i18n("Отзыв не сохранён."),
  });
  if (!canLeave) return;
  setAddDirty(false);
  closeAddView();
}

// Три способа закрыть вид – по тому, как он был открыт (см. шапку файла):
// модалка паспорта закрывается у родителя, SPA-маршрут уходит через
// роутер, а одиночный add.html без паспорта (прямая ссылка, мимо обоих
// случаев) ведёт себя как обычная ссылка – реальной навигацией на "/".
function closeAddView() {
  if (fromPassportModal) {
    window.parent.closeAddFromPassportModal();
    return;
  }
  if (IN_SPA_SHELL) {
    leaveRoute();
    return;
  }
  location.href = "/";
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
  document.getElementById("fav-toggle-label").textContent = on ? i18n("В Любимом") : i18n("Добавить в Любимое");
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

// ── Предпросмотр карточки ──────────────────────
// Слева от формы – карточка такой, какой она будет на «Статусах»: её
// рисует та же manualCard() (js/cards.js), а не отдельная копия разметки,
// так что предпросмотр не может разойтись с настоящей карточкой.
//
// Обновляется на любое изменение формы (см. setAddDirty в add-save.js и
// явные вызовы в fillForm/resetToNew/previewCover). Узел <img> при этом
// не пересоздаётся, пока не сменилась сама картинка: иначе обложка
// мигала бы на каждую набранную букву названия.
function editorDraftReview() {
  const val = (id) => document.getElementById(id)?.value.trim() || "";
  return {
    title: val("f-title") || i18n("Название"),
    type: val("f-type"),
    status: val("f-status"),
    year: val("f-year"),
    cover: val("f-cover"),
    cover_backup: val("f-cover-backup"),
    cover_focus: val("f-cover-focus") || null,
    date_start: val("f-date-start") || null,
    date_end: val("f-date-end") || null,
    grade: selectedGrade,
  };
}

function renderEdPreview() {
  const title = document.getElementById("f-title");
  if (!title) return; // вид уже размонтирован
  const hint = document.getElementById("edit-title-hint");
  if (hint) hint.textContent = title.value.trim();

  const text = document.getElementById("f-review-full").value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById("ed-text-count").textContent = words
    ? i18n("Слов: {words} · знаков: {chars}", { words, chars: text.length })
    : "";

  const box = document.getElementById("ed-preview");
  if (!box || typeof manualCard !== "function") return;
  const tmp = document.createElement("div");
  tmp.innerHTML = manualCard(editorDraftReview(), 0);
  tmp.querySelector(".review-edit-btn")?.remove();
  const next = tmp.firstElementChild;
  const cur = box.firstElementChild;
  if (!cur) {
    box.replaceChildren(next);
    return;
  }
  const curImg = cur.querySelector("img");
  const nextImg = next.querySelector("img");
  if (curImg.getAttribute("src") !== nextImg.getAttribute("src")) curImg.replaceWith(nextImg);
  else curImg.style.objectPosition = nextImg.style.objectPosition;
  cur.querySelector(".card-body").replaceWith(next.querySelector(".card-body"));
  cur.querySelector(".card").setAttribute("style", next.querySelector(".card").getAttribute("style"));
}

// ── Даты в зависимости от статуса ──────────────
// Заголовок раздела рисует общая обёртка .sec-head, здесь только поля.
function updateDateFields() {
  const status = document.getElementById("f-status").value;
  const section = document.getElementById("dates-section");
  const wrap = document.getElementById("sec-dates");
  const today = todayLocalISO();

  // Сегодняшняя дата подставляется только в поле, которого ещё не было
  // на экране (новый отзыв, переход из «Планирую»), и никогда – в «Начато»
  // у «Завершено»: там оно необязательное. Раньше пустое поле всегда
  // добивалось сегодняшней датой, и у отзыва, где была только дата
  // завершения, при любом сохранении появлялось «Начато: сегодня» –
  // позже самого «Завершено» (21 такая запись в реальном хранилище).
  // Поле, которое человек сам очистил, при смене статуса тоже остаётся
  // пустым.
  const startEl = document.getElementById("f-date-start");
  const endEl = document.getElementById("f-date-end");
  const prevStart = startEl ? startEl.value : status === "completed" ? "" : today;
  const prevEnd = endEl ? endEl.value : today;

  // «Планирую» – дат ещё нет, прячем раздел целиком, чтобы кнопка
  // «Добавить дату» не предлагала заполнить бессмысленное поле.
  if (status === "planning") {
    section.innerHTML = "";
    wrap.hidden = true;
    renderEdPreview();
    return;
  }
  wrap.hidden = false;

  if (status === "completed") {
    section.innerHTML = `
      <div class="grid">
        <div class="field">
          <label>${i18n("Начато")} <span style="font-size:.6rem;opacity:.5">${i18n("(необязательно)")}</span></label>
          <input type="date" id="f-date-start" value="${prevStart}">
        </div>
        <div class="field">
          <label>${i18n("Завершено")}</label>
          <input type="date" id="f-date-end" value="${prevEnd}">
        </div>
      </div>
      <div class="hint">${i18n("Если смотрели один день – заполните только «Завершено» или укажите одинаковые даты, на карточке покажется одна дата.")}</div>`;
    renderEdPreview();
    return;
  }

  // current, onhold и любой свой статус – только дата начала.
  section.innerHTML = `
    <div class="grid">
      <div class="field">
        <label>${i18n("Начато")}</label>
        <input type="date" id="f-date-start" value="${prevStart}">
      </div>
    </div>`;
  renderEdPreview();
}

// ── Оценки – вид зависит от шкалы, настроенной в настройках ──
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

// ── Теги – из TAGS_MAP (config.js) ─────────────
// Сверху – выбранные (нажатие снимает тег), ниже – все теги по
// категориям, в порядке справочника. Поле «Найти тег» сужает нижний
// список; выбранные остаются на виду при любом запросе. Тег, которого
// в справочнике уже нет (удалили, а в отзыве он остался), всё равно
// виден среди выбранных – раньше снять его отсюда было нечем.
function tagToggleHtml(tag, active) {
  return `<span class="tag-toggle${active ? " active" : ""}" role="button" tabindex="0" aria-pressed="${active}" data-tag="${esc(tag)}" title="${esc(TAGS_MAP[tag]?.tip || "")}">${esc(tag)}</span>`;
}

function renderTagsGrid() {
  const tagsGrid = document.getElementById("tags-grid");
  const picked = document.getElementById("tags-picked");
  if (!tagsGrid || !picked) return;

  document.getElementById("tags-count").textContent = selectedTags.size
    ? i18n("выбрано: {n}", { n: selectedTags.size })
    : "";
  picked.innerHTML = selectedTags.size
    ? [...selectedTags].map((tag) => tagToggleHtml(tag, true)).join("")
    : `<span class="ed-picked-empty">${i18n("Теги не выбраны – нажмите на тег ниже или найдите его по названию.")}</span>`;

  const q = normTagQuery(document.getElementById("tag-q")?.value);
  const byCat = new Map();
  for (const [tag, meta] of Object.entries(TAGS_MAP)) {
    if (q && !normTagQuery(tag).includes(q)) continue;
    const cat = meta.cat || "";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(tag);
  }
  if (!byCat.size) {
    tagsGrid.innerHTML = `<div class="ed-picked-empty">${i18n("Такого тега нет – его можно завести кнопкой «Новый тег».")}</div>`;
    return;
  }
  tagsGrid.innerHTML = [...byCat.entries()]
    .map(
      ([cat, tags]) => `<div class="ed-cat">
        <div class="ed-cat-name">${esc(CAT_LABELS[cat] || cat || i18n("Без категории"))}</div>
        <div class="ed-cat-tags">${tags.map((tag) => tagToggleHtml(tag, selectedTags.has(tag))).join("")}</div>
      </div>`
    )
    .join("");
}

function normTagQuery(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .trim();
}

function toggleEditorTag(tag) {
  if (!tag) return;
  if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
    featuredCardTags.delete(tag);
  } else {
    selectedTags.add(tag);
  }
  markAddDirty();
  renderTagsGrid();
  renderCardTagsList();
}

// ── Какие из выбранных тегов показывать на карточке ──
// Карточка – витрина на беглый взгляд, всех тегов там не поместится
// (reviews.js, reviewCard: показывает первые CARD_TAGS_MAX). Модалка
// показывает все выбранные теги отзыва – кликом отмечаешь до
// CARD_TAGS_MAX «избранных». Ничего не отмечено – карточка сама берёт
// первые по порядку (старое поведение, не нужно ничего решать вручную).
// noTagsOnCard – отдельный режим поверх этого: теги на карточке не
// нужны вовсе, список избранных при этом не трогаем и не теряем –
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
    count.textContent = i18n("Теги не будут показаны на карточке – только внутри отзыва.");
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
    : i18n("Ничего не выбрано – покажутся первые теги по порядку.");
}

function toggleCardTagFeatured(tag) {
  if (featuredCardTags.has(tag)) featuredCardTags.delete(tag);
  else if (featuredCardTags.size < CARD_TAGS_MAX) featuredCardTags.add(tag);
  // Без этого выбор тегов для карточки не считался правкой: уйти со
  // страницы можно было без вопроса, и выбор терялся молча.
  markAddDirty();
  renderCardTagsList();
}

function toggleNoTagsOnCard() {
  noTagsOnCard = !noTagsOnCard;
  markAddDirty();
  renderCardTagsList();
}

