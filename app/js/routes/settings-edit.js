// ══════════════════════════════════════════════
//  РОУТ #/settings-edit – настройки приложения
//  (см. план перехода на SPA, фаза 3.4 – последняя страница)
//
//  Как и #/chars-edit, #/favorites-edit и #/add, вид НЕ завёрнут в
//  IIFE: в разметке настроек больше сотни инлайновых onclick="имя(…)"
//  (полки оценок, вкладки, статусы, коллекции, разделы «Любимого»,
//  хранилища, синхронизация, палитра), и переписывать каждый вызов на
//  обращение через объект-неймспейс ради самой процедуры переноса –
//  это посадить опечатку на ровном месте. Все 134 верхнеуровневых
//  имени взяты из app/settings-edit.html как есть: ни одно из них не
//  совпадает ни с js/*.js, ни с js/routes/*.js, ни с инлайном
//  index.html – проверено scripts/check-duplicate-functions.js.
//
//  ── ГЛАВНОЕ: iframe с add.html не тронут ──
//  Здесь живёт хост модалки «Добавить себе» из чужого паспорта:
//  #pp-add-modal-overlay/#pp-add-modal-frame. Саму модалку открывает и
//  закрывает js/passports.js (openAddFromPassportModal/
//  closeAddFromPassportModal), а внутрь грузится буквально
//  /add.html?fromPassport=1&title=… – отдельным документом, не
//  маршрутом #/add. Родитель читает у него frame.contentWindow.addDirty,
//  а add.html после сохранения сам зовёт
//  window.parent.closeAddFromPassportModal(). Ничего из этого не
//  меняется от того, что родитель стал видом роутера, а не отдельным
//  документом: iframe остаётся iframe'ом, window.parent – этим окном,
//  а обе функции по-прежнему живут в js/passports.js (он подключён к
//  index.html вместе с этим маршрутом). Разметка оверлея и его CSS
//  перенесены байт в байт; ни js/passports.js, ни app/add.html не
//  тронуты.
//
//  Единственная добавка по этой части – снятие слушателя Escape,
//  который openAddFromPassportModal() вешает на document: если уйти с
//  маршрута с открытой модалкой, разметки оверлея уже нет, и
//  closeAddFromPassportModal() вышел бы по `if (!overlay) return`,
//  оставив слушателя висеть на всём приложении навсегда. Снимаем в
//  unmount() явно.
//
//  ── Разметка и переводы ──
//  Разметка перенесена из settings-edit.html как есть, вместе с
//  атрибутами data-i18n, а не переписана на ${i18n("…")}, как в более
//  мелких маршрутах: страница огромная, и ручная переразметка сотен
//  строк дала бы ровно тот класс ошибок, ради которого этот перенос и
//  делается механически. После вставки зовётся applyI18n(container) –
//  тот же приём, которым эта же страница уже переводила свои
//  динамические панели (renderVaultsPanel).
//
//  ── Что обязано жить в mount()/unmount() ──
//  Всё, что вешается на document/window: клик «мимо» попапа темы,
//  keydown, beforeunload, resize и ResizeObserver у #sidebar. Они
//  переживают #view-root, и без снятия продолжат работать поверх
//  следующего маршрута (см. предупреждение в js/router.js).
//
//  Первичная отрисовка (loadCurrentSettings/detectApp) на исходной
//  странице выполнялась прямо в теле скрипта – здесь она в mount().
//  Подписок на одноразовые site-labels-ready/tags-map-updated у этой
//  страницы не было вовсе, так что ловушки фаз 3.2/3.3 тут нет.
//
//  ── Разбиение на файлы ──
//  Раньше вся логика панелей жила прямо здесь одним файлом на 2972
//  строки. Разметка (settingsViewHtml) и жизненный цикл (mount/unmount)
//  остались тут – это и есть каркас маршрута, – а функции каждой
//  панели переехали в settings-appearance.js, settings-stats.js,
//  settings-grades.js, settings-tabs.js, settings-app.js,
//  settings-sync.js, settings-shortcuts.js и settings-labels.js
//  (index.html подключает их все вместе с этим файлом). Деления по
//  сути это не меняет: как и раньше, это обычные глобальные скрипты
//  без своего экспорта – переезд файла не переезд области видимости, и
//  сотни onclick="имя(…)" в разметке продолжают находить свои функции
//  так же, как находили их здесь до разбиения.
// ══════════════════════════════════════════════

let seCleanupFns = [];
let sePrevTitle = null;
let sePrevSkin = null;
let seSidebarObserver = null;
// Открыта ли на телефоне какая-то панель поверх списка разделов (см.
// .mobile-panel-open в index.html) – на ПК ни на что не влияет,
// сайдбар там открыт всегда целиком.
let seMobilePanelOpen = false;

function seOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  seCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

// Иконки пунктов списка настроек на телефоне (см. .side-tab-icon в
// index.html – на ПК скрыты: там сайдбар открыт целиком, иконка рядом
// с текстом ничего не поясняет, только сужает и без того тесную
// колонку). Тот же стиль SVG, что и у нижних вкладок (viewBox 24×24,
// stroke=currentColor, stroke-width 2) – простые геометрические
// значки, не иллюстрации, единообразные с уже готовыми в index.html.
// «Статистика» и «Тир-листы» – те же контуры, что у одноимённых
// нижних вкладок, специально: одно и то же понятие в двух местах
// приложения стоит узнавать по одной и той же картинке.
const SIDE_TAB_ICON_PATHS = {
  appearance: '<path d="M12 2s7 7.58 7 12a7 7 0 11-14 0c0-4.42 7-12 7-12z"/>',
  tabs: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  shortcuts:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>',
  stats: '<path d="M4 20V10M12 20V4M20 20v-7"/>',
  grades: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  collections: '<path d="M3 6h18M3 12h18M3 18h11"/>',
  labels:
    '<path d="M20.59 13.41L11 3.83A2 2 0 009.59 3.24L3 3v6.59a2 2 0 00.59 1.41l9.58 9.58a2 2 0 002.83 0l6.59-6.59a2 2 0 000-2.83z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  passports: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M14 9h6M14 13h6M6 16h6"/>',
  sync: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  import: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  vaults: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0018 0V5"/><path d="M3 12a9 3 0 0018 0"/>',
  app: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  backup: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

function sideTabIcon(panel) {
  return `<svg class="side-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SIDE_TAB_ICON_PATHS[panel] || ""}</svg>`;
}

// data-i18n – на span, а не на самой кнопке: applyI18n() подменяет
// el.textContent целиком (см. js/i18n.js), а это стёрло бы и иконку
// вместе с текстом. Тот же приём, что уже у нижних вкладок в
// index.html (span.tab-label рядом с svg.tab-icon).
function sideTabLabel(text) {
  return `<span class="side-tab-label" data-i18n>${text}</span>`;
}

function settingsViewHtml() {
  return `
  <div id="locked" class="hidden">
    Настройки открываются только из самого приложения.
    <br><br>
    <a href="#" id="se-locked-back" style="color:var(--text-dim);" data-i18n>На главную</a>
  </div>

  <div id="app" class="hidden">
    <nav id="sidebar">
      <a href="#" class="back" id="se-back" data-i18n>На главную</a>
      <button class="side-tab active" data-panel="appearance">${sideTabIcon("appearance")}${sideTabLabel("Оформление")}</button>
      <button class="side-tab" data-panel="tabs">${sideTabIcon("tabs")}${sideTabLabel("Вкладки")}</button>
      <button class="side-tab" data-panel="shortcuts">${sideTabIcon("shortcuts")}${sideTabLabel("Горячие клавиши")}</button>
      <button class="side-tab" data-panel="stats">${sideTabIcon("stats")}${sideTabLabel("Статистика")}</button>
      <button class="side-tab" data-panel="grades">${sideTabIcon("grades")}${sideTabLabel("Оценки и статусы")}</button>
      <button class="side-tab" data-panel="collections">${sideTabIcon("collections")}${sideTabLabel("Тир-листы")}</button>
      <button class="side-tab" data-panel="labels">${sideTabIcon("labels")}${sideTabLabel("Подписи")}</button>
      <button class="side-tab" data-panel="passports">${sideTabIcon("passports")}${sideTabLabel("Обмен")}</button>
      <button class="side-tab hidden" data-panel="sync" id="tab-sync">${sideTabIcon("sync")}${sideTabLabel("Синхронизация")}</button>
      <button class="side-tab" data-panel="import">${sideTabIcon("import")}${sideTabLabel("Импорт")}</button>
      <button class="side-tab hidden" data-panel="vaults" id="tab-vaults">${sideTabIcon("vaults")}${sideTabLabel("Хранилища")}</button>
      <button class="side-tab hidden" data-panel="app" id="tab-app">${sideTabIcon("app")}${sideTabLabel("Приложение")}</button>
      <button class="side-tab side-tab-divider" data-panel="backup">${sideTabIcon("backup")}${sideTabLabel("История версий")}</button>
      <div class="sidebar-resize" id="sidebar-resize" aria-hidden="true"></div>
    </nav>

    <main id="main">
      <button type="button" class="settings-panel-back" id="settings-panel-back" aria-label="Все настройки" data-i18n-aria-label="Все настройки">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"></path></svg>
        <span data-i18n>Все настройки</span>
      </button>
      <h1 id="settings-panel-title" data-i18n>Настройки</h1>

      <div class="panel active" id="panel-appearance">
        <div class="theme-grid" id="themeGrid"></div>

        <!-- Отдельно от «Масштаба» (Приложение) – тот через
             webContents.setZoomFactor у Electron увеличивает вообще всё
             (включая иконки и рамки в px) и недоступен на телефоне/сайте.
             Это чистый CSS-множитель (--text-scale, см. style.css) –
             растягивает только текст и то, что в rem, работает везде. -->
        <h2 class="section-h" data-i18n>Размер шрифта</h2>
        <p class="panel-intro" data-i18n>
          Только текст – иконки и отступы не меняются. Чтобы увеличить вообще
          всё, используйте «Масштаб» на вкладке «Приложение».
        </p>
        <div class="row" style="gap:12px;align-items:center;flex-wrap:wrap;">
          <input type="range" id="text-scale-slider" min="80" max="150" step="5" value="100"
            oninput="applyTextScale(this.value, true)">
          <span class="app-zoom" id="text-scale-value">100%</span>
          <button type="button" class="btn btn-ghost" onclick="applyTextScale(100, true)" data-i18n>Сбросить</button>
        </div>

        <h2 class="section-h" data-i18n>Теги на карточках</h2>
        <p class="panel-intro" data-i18n>
          Ставит «Не показывать теги на карточке» сразу во всех отзывах –
          то же самое, что открыть каждый и отметить эту галочку вручную.
          Сами теги никуда не пропадают, они по-прежнему видны внутри
          отзыва. Выключение возвращает теги на карточки всех отзывов
          разом, включая те, где галочку поставили вручную в редакторе
          конкретного отзыва.
        </p>
        <button type="button" class="btn btn-ghost hide-tags-toggle" id="hide-tags-toggle"
                aria-pressed="false" onclick="toggleHideAllCardTags()">
          <span class="hide-tags-toggle-icon" id="hide-tags-toggle-icon">${eyeIcon(false)}</span>
          <span id="hide-tags-toggle-label" data-i18n>Скрыть теги на всех карточках</span>
        </button>
        <p class="status-msg" id="status-hide-all-card-tags"></p>

        <h2 class="section-h" data-i18n>Палитра</h2>
        <div id="paletteList"></div>
        <div class="pal-foot">
          <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
          <button type="button" class="pal-reset" onclick="resetPalette()" data-i18n>Вернуть все цвета темы</button>
        </div>
        <div class="status-msg" id="status-appearance"></div>
      </div>

      <div class="panel" id="panel-tabs">
        <div id="tabsList"></div>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-tabs"></div>

        <h2 class="section-h" data-i18n>Разделы вкладки «Статусы»</h2>
        <div id="statusesList"></div>
        <div class="row" style="margin-top:14px;">
          <div><label data-i18n>Новый раздел</label><input type="text" id="newStatusName" data-no-dirty placeholder="Например: Брошено" data-i18n-placeholder="Например: Брошено"></div>
        </div>
        <button class="btn btn-ghost" onclick="addStatusBucket()" data-i18n>Добавить раздел</button>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>

        <h2 class="section-h" data-i18n>Разделы вкладки «Любимое»</h2>
        <div id="favSectionsList"></div>
        <div id="favCollectionsList"></div>
        <div class="row" style="margin-top:14px;">
          <div><label data-i18n>Новый раздел</label><input type="text" id="newFavCollectionName" data-no-dirty placeholder="Например: Пейринги" data-i18n-placeholder="Например: Пейринги"></div>
        </div>
        <button class="btn btn-ghost" onclick="addFavCollection()" data-i18n>Добавить раздел</button>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
      </div>

      <div class="panel" id="panel-shortcuts">
        <div id="shortcutsList"></div>
        <button class="btn btn-ghost" onclick="resetShortcutsToDefault()" data-i18n>Сбросить</button>

        <h2 class="section-h" data-i18n>Переключение вкладок</h2>
        <p class="panel-intro" data-i18n>
          Цифры 1–5 переключают вкладки по порядку и сами подстраиваются,
          если какую-то скрыть.
        </p>
        <div id="tabKeyBindingsList"></div>
      </div>

      <div class="panel" id="panel-stats">
        <p class="panel-intro" data-i18n>Что показывать на вкладке "Статистика".</p>
        <div id="statsList"></div>

        <h2 class="section-h" data-i18n>Цвета по типам</h2>
        <p class="panel-intro" data-i18n>Красят разбивку по типам и годам – диаграмму, столбики и цифры.</p>
        <div id="typeColorsList"></div>

        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-stats"></div>
      </div>

      <div class="panel" id="panel-grades">
        <p class="panel-intro" data-i18n>Тип шкалы влияет на то, как выглядит поле оценки в форме добавления и как тайтлы раскладываются по тир-листу.</p>

        <div class="theme-grid" id="scaleTypeGrid"></div>

        <div id="categoricalBlock">
          <h2 class="section-h" data-i18n>Полки</h2>
          <p class="panel-intro" data-i18n>Переименуйте, перекрасьте, удалите или добавьте свою.</p>
          <div id="catShelvesList"></div>
          <button class="btn btn-ghost" onclick="addShelfRow(true)" data-i18n>Добавить полку</button>
        </div>

        <div id="numericBlock" style="display:none;">
          <h2 class="section-h" data-i18n>Диапазон</h2>
          <div class="row">
            <div style="flex:0 0 140px;"><label id="numericMaxLabel" data-i18n>Максимум</label><input type="number" id="numericMax" min="2" max="1000" value="10"
              onchange="seedNumericShelves(); renderShelvesList('shelvesList', true);"></div>
          </div>

          <h2 class="section-h" data-i18n>Полки (от лучшей к худшей)</h2>
          <p class="panel-intro" data-i18n>Каждая полка – диапазон значений с названием и цветом. Именно эти полки станут строками тир-листа.</p>
          <div id="shelvesList"></div>
          <button class="btn btn-ghost" onclick="addShelfRow()" data-i18n>Добавить полку</button>
        </div>

        <button class="btn-save" onclick="saveSettings()" style="margin-top:20px;" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-grades"></div>
      </div>

      <div class="panel" id="panel-collections">
        <div id="tierModesList"></div>

        <h2 class="section-h" data-i18n>Коллекции</h2>
        <div id="collectionsList"></div>
        <div class="row" style="margin-top:14px;">
          <div><label data-i18n>Новая коллекция</label><input type="text" id="newCollectionName" data-no-dirty placeholder="Например: Опенинги" data-i18n-placeholder="Например: Опенинги"></div>
        </div>
        <button class="btn btn-ghost" onclick="addCollection()" data-i18n>Добавить коллекцию</button>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-collections"></div>
      </div>

      <div class="panel" id="panel-labels">
        <p class="panel-intro" data-i18n>
          Пустое поле означает «оставить как есть» – под ним написано
          значение по умолчанию.
        </p>
        <div id="labelsGroups"></div>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-labels"></div>
      </div>

      <div class="panel" id="panel-passports">
        <div id="passportsPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- Синхронизация между своими устройствами (телефон, компьютер,
           ещё один компьютер) через приватный репозиторий на GitHub –
           бесплатно, без своего сервера. Не путать с «Паспортом»: тот
           про показ себя чужим, этот – про то, чтобы твои же данные были
           одинаковыми на всех твоих устройствах. Подробности решения –
           в app/js/sync.js. -->
      <div class="panel" id="panel-sync">
        <div id="syncPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- Список хранилищ и переключение между ними. Не путать с
           «Паспортом» на соседней вкладке: тот – урезанный файл-слепок
           для показа чужим, а тут – свои полноценные хранилища, между
           которыми можно переключаться, как между профилями в Obsidian.
           Панель показывается только в приложении – на голом сайте
           хранилище всегда одно и переключать нечего. -->
      <div class="panel" id="panel-vaults">
        <div id="vaultsPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- Настройки самого приложения. На сайте этой панели нет и быть не
           может: там нет ни папки на диске, ни окна, ни масштаба. Она
           показывается только когда /api/app/info отвечает, то есть когда
           страницу открыло приложение, а не браузер. -->
      <div class="panel" id="panel-app">
        <h2 class="section-h" data-i18n>Папка с данными</h2>
        <div class="row">
          <div class="app-path" id="app-vault-path">–</div>
        </div>
        <!-- «Открыть в проводнике» и «Сменить папку» – только для компьютера:
             там это настоящая папка на диске. На телефоне хранилище лежит
             во внутренней области приложения – там нет ни проводника, чтобы
             её открыть, ни смысла её менять (она одна). Раньше эти кнопки
             просто ничего не делали на телефоне – appInfo.mobile в
             renderAppPanel() решает, какой из двух блоков показать. -->
        <div class="row" id="app-vault-actions" style="gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost" onclick="openVaultFolder()" data-i18n>Открыть в проводнике</button>
          <button class="btn btn-ghost" onclick="changeVault()" data-i18n>Сменить папку…</button>
        </div>
        <p class="panel-intro hidden" id="app-vault-mobile-note" data-i18n>
          Хранится во внутренней области приложения – её не видят другие
          приложения, и она исчезнет вместе с удалением TasteID. Чтобы
          перенести данные на другое устройство – резервная копия ниже.
        </p>

        <!-- Не путать с «Паспортом» на соседней вкладке: тот – урезанный
             слепок для показа чужим (без текста отзывов, без избранного,
             без тир-листов) и никогда не пишется обратно в своё же
             хранилище – только смотреть и сравнивать. Здесь наоборот:
             всё целиком и для себя. На компьютере то же самое даёт
             обычное копирование папки хранилища; на телефоне такой папки
             не видно, и без этой кнопки перенести свои же данные было бы
             нечем – сравнить с чужими можно, а увезти свои с собой нет. -->
        <h2 class="section-h" data-i18n>Резервная копия</h2>
        <p class="panel-intro" data-i18n>
          Отзывы, любимое, тир-листы, настройки и загруженные вручную
          картинки – одним файлом, для себя.
        </p>
        <div class="row" style="gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost" onclick="exportBackup()" data-i18n>Скачать резервную копию</button>
          <label class="btn btn-ghost file-btn">
            <input type="file" id="backup-file" data-no-dirty accept="application/json,.json" onchange="restoreBackup(this)">
            <span data-i18n>Восстановить из файла…</span>
          </label>
        </div>
        <div class="status-msg" id="status-backup"></div>

        <h2 class="section-h" data-i18n>Язык</h2>
        <div class="row">
          <div style="flex:0 0 220px;">
            <select id="app-lang" data-no-dirty onchange="setAppLanguage(this.value)"></select>
          </div>
        </div>

        <!-- Масштаб – тоже только компьютер: там это webContents.setZoomLevel
             у Electron. На телефоне такого понятия нет (страница уже
             подогнана под экран самой системой), кнопки были декорацией,
             которая ничего не меняла. -->
        <div id="app-zoom-section">
          <h2 class="section-h" data-i18n>Масштаб</h2>
          <div class="row" style="gap:12px;align-items:center;flex-wrap:wrap;">
            <input type="range" id="app-zoom-slider" class="app-zoom-slider" data-no-dirty
              min="50" max="200" step="5" value="100"
              oninput="previewZoom(this.value)" onchange="setZoom(this.value)">
            <span class="app-zoom" id="app-zoom-value">100%</span>
            <button class="btn btn-ghost" onclick="setZoom(100)" data-i18n>Сбросить</button>
          </div>
        </div>

        <h2 class="section-h" data-i18n>О программе</h2>
        <div class="row"><div class="app-path" id="app-version">–</div></div>
        <div class="row">
          <button class="btn btn-ghost" id="btn-check-update" onclick="checkForUpdateNow()" data-i18n>Проверить обновления</button>
        </div>
        <div class="status-msg" id="status-update"></div>
        <div class="status-msg" id="status-app"></div>

        <h2 class="section-h" data-i18n>Поддержать автора</h2>
        <div class="row">
          <a class="btn btn-ghost" href="https://boosty.to/qerrti/posts/38bee13e-3140-4b7d-816b-c4d3217b397d" target="_blank" rel="noopener" data-i18n>Поддержать на Boosty</a>
        </div>
      </div>

      <div class="panel" id="panel-import">
        <div id="importPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- История версий файлов данных. Раньше отдельная страница
           (backup-history.html) – открывалась поверх настроек и обратно
           вела только на главную, а не назад в настройки. Здесь та же
           разметка (#fileTabs/#content) и тот же скрипт
           (js/backup-history.js), просто внутри панели – переключение
           между панелями уже умеет .side-tab. -->
      <div class="panel" id="panel-backup">
        <p class="panel-intro" data-i18n>
          Каждое сохранение файла – это отдельная версия, которая навсегда остаётся здесь, даже если
          текущая версия сломается. Выберите файл, найдите нужную дату и либо скачайте эту версию как
          JSON, либо восстановите её – тогда она станет текущей.
        </p>
        <div class="history-retention">
          <label for="history-retention-select" data-i18n>Автоматически удалять версии старше:</label>
          <select id="history-retention-select" data-no-dirty onchange="saveHistoryRetention(this.value)"></select>
          <button class="btn btn-ghost" onclick="pruneHistoryNow()" title="Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки – по всем файлам сразу" data-i18n data-i18n-title="Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки – по всем файлам сразу">Почистить сейчас</button>
        </div>
        <div class="status-msg" id="status-history-retention"></div>
        <div class="file-tabs" id="fileTabs"></div>
        <div id="content"><div class="state-box"><div class="spinner"></div>Загружаем…</div></div>
      </div>
    </main>
  </div>

  <!-- «Добавить себе» из чужого паспорта – тот же add.html, что и обычно,
       просто в рамке поверх текущей панели, а не отдельной страницей. См.
       openAddFromPassportModal()/closeAddFromPassportModal() в
       js/passports.js и ветку fromPassport в add.html (она же
       закрывает модалку после сохранения). Разметка перенесена байт в
       байт – на неё завязан js/passports.js по id. -->
  <div id="pp-add-modal-overlay" class="pp-add-modal-overlay hidden">
    <div class="pp-add-modal-panel">
      <button type="button" class="pp-add-modal-close" title="Закрыть" aria-label="Закрыть" onclick="closeAddFromPassportModal()">✕</button>
      <iframe id="pp-add-modal-frame" class="pp-add-modal-frame" title="Добавить отзыв"></iframe>
    </div>
  </div>`;
}

async function mount(container) {
  sePrevTitle = document.title;
  sePrevSkin = document.documentElement.getAttribute("data-skin");
  document.title = `TasteID – ${i18n("Настройки")}`;

  // Состояние вида – с нуля при каждом монтировании: верхнеуровневые
  // let'ы живут столько же, сколько документ, а не столько, сколько
  // открыт маршрут (см. шапку файла).
  settingsDirty = false;
  seMobilePanelOpen = false;
  // Та же leaveSettingsRoute(), что ниже висит на клике по кнопке
  // "назад" – но теперь ещё и на аппаратной/жестовой кнопке "назад" на
  // телефоне (см. installBackButton() в mobile/src/main.js): раньше она
  // обходила эту проверку, дёргая историю напрямую. settingsBackAction()
  // оборачивает её же: на телефоне с открытой панелью сперва просто
  // закрывает панель (возврат к списку разделов, как и переключение
  // между вкладками на ПК – без вопроса про несохранённое), и только
  // если панель и так закрыта – спрашивает и уходит с маршрута.
  setLeaveGuard(settingsBackAction);
  appInfo = null;
  hideTagsAllOn = false;
  rawSettings = {};
  openThemeGroup = null;
  tabDragSrc = null;
  shelves = [];
  scaleType = "categorical";
  typeColors = {};
  themeColors = {};
  hiddenStatsState = new Set();
  hiddenTabsState = new Set();
  hiddenStatusesState = new Set();
  hiddenTierModesState = new Set();
  hiddenFavSectionsState = new Set();
  removedFavSections = new Set();
  hiddenTypes = new Set();
  hiddenSubtypes = new Set();
  customTypeKeys = new Set();
  customSubtypeKeys = new Set();
  customCatKeys = new Set();

  container.innerHTML = `<div class="set-view">${settingsViewHtml()}</div>`;
  // Разметка вставлена одним куском вместе с атрибутами data-i18n –
  // переводим её тем же вызовом, каким эта страница всегда переводила
  // свои динамические панели (см. шапку файла).
  applyI18n(container);

  const lockedEl = container.querySelector("#locked");
  const appEl = container.querySelector("#app");
  if (typeof isAdmin === "function" && !isAdmin()) {
    lockedEl.classList.remove("hidden");
  } else {
    appEl.classList.remove("hidden");
  }

  const mainEl = container.querySelector("#main");

  const sidebar = container.querySelector("#sidebar");
  seCleanupFns.push(
    makeResizablePanel(sidebar, container.querySelector("#sidebar-resize"), "tasteid-sidebar-width", 180, 380)
  );

  // #sidebar – position: fixed (см. её же комментарий в CSS index.html),
  // поэтому выпадает из потока флекса и #app нужно вручную резервировать
  // под неё место через padding-left (#main внутри центрируется в этом
  // остатке через margin: 0 auto). ResizeObserver ловит и восстановленную
  // из localStorage ширину при монтировании, и перетаскивание мышью, и
  // сам факт того, что на телефоне #sidebar становится position: static.
  const syncAppPadding = () => {
    const fixed = getComputedStyle(sidebar).position === "fixed";
    appEl.style.paddingLeft = fixed ? sidebar.getBoundingClientRect().width + "px" : "";
  };
  seSidebarObserver = new ResizeObserver(syncAppPadding);
  seSidebarObserver.observe(sidebar);
  seOn(window, "resize", syncAppPadding);
  syncAppPadding();

  // Заголовок над панелью – раньше везде висело общее «Настройки»
  // независимо от того, какой раздел открыт; здесь ставим название
  // самого раздела, взятое из подписи под тем же .side-tab (она уже
  // переведена – applyI18n() выше отработал раньше этой строки).
  const settingsPanelTitleEl = container.querySelector("#settings-panel-title");
  function updateSettingsPanelTitle(btn) {
    if (!settingsPanelTitleEl) return;
    const label = btn?.querySelector(".side-tab-label")?.textContent;
    settingsPanelTitleEl.textContent = label || i18n("Настройки");
  }

  container.querySelectorAll(".side-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Клик по уже открытой вкладке ничего не переключает – не повод
      // спрашивать про несохранённое там, где никакого ухода с панели
      // не происходит. Но «уже открытой» проверяем не по классу
      // .active – он стоит на «Оформлении» уже в исходной разметке,
      // для ПК, где сайдбар и панель видны всегда вместе. На телефоне
      // же список разделов и открытая панель показываются по очереди
      // (#app.mobile-panel-open, см. index.html), и при первом заходе
      // в настройки панель по этому классу ещё не показана – старая
      // проверка на .active тут же выходила, и «Оформление» не
      // открывалось вообще ничем, кроме как через другой раздел и
      // обратно. Поэтому смотрим, действительно ли #main сейчас на
      // экране, а не на класс, который может остаться от разметки по
      // умолчанию или от прошлого показа.
      const panelAlreadyVisible = getComputedStyle(mainEl).display !== "none";
      if (btn.classList.contains("active") && panelAlreadyVisible) return;
      if (!(await confirmLeavePanel())) return;
      container.querySelectorAll(".side-tab").forEach((b) => b.classList.remove("active"));
      container.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("active");
      updateSettingsPanelTitle(btn);
      // На ПК ничего не меняет (сайдбар виден всегда), а на телефоне –
      // тот самый переход от списка разделов к открытой панели (см.
      // .mobile-panel-open в index.html).
      appEl.classList.add("mobile-panel-open");
      seMobilePanelOpen = true;
      // Паспорта грузятся при первом открытии панели, а не вместе со
      // страницей: они тянут reviews.json целиком, а заходят сюда редко.
      if (btn.dataset.panel === "passports") loadPassports();
      if (btn.dataset.panel === "sync") renderSyncPanel();
      if (btn.dataset.panel === "import") loadImport();
      if (btn.dataset.panel === "vaults") renderVaultsPanel();
      if (btn.dataset.panel === "app") loadAppPanel();
      if (btn.dataset.panel === "backup") initBackupHistoryPanel();
    });
  });

  // «Оформление» помечено активным прямо в разметке – так проще для
  // ПК, где сайдбар и панель видны сразу вместе и подсветку незачем
  // проставлять отдельным кодом. На телефоне же список разделов виден
  // без открытой панели (#main скрыт), и тот же класс просто подсвечивал
  // «Оформление» в списке ещё до того, как в него вообще заходили –
  // вместе со старой проверкой на .active в клике это и не пускало
  // внутрь при первом же заходе в настройки. Саму проверку в клике
  // починили выше; здесь снимаем то, что осталось чисто визуально –
  // список на телефоне должен открываться без единого выбранного
  // пункта.
  if (getComputedStyle(mainEl).display === "none") {
    container.querySelector(".side-tab.active")?.classList.remove("active");
  }
  // И в любом случае заголовок над панелью для раздела по умолчанию –
  // он получает активный класс в обход обработчика клика выше, значит,
  // и заголовок под него нужно проставить здесь же.
  updateSettingsPanelTitle(container.querySelector(".side-tab.active"));

  // «Все настройки» – видна только на телефоне (см. .settings-panel-back
  // в index.html), закрывает панель и возвращает к списку разделов –
  // с тем же вопросом про несохранённое, что и переключение на другую
  // вкладку (confirmLeavePanel(), см. её же комментарий выше).
  container.querySelector("#settings-panel-back")?.addEventListener("click", async () => {
    if (!(await confirmLeavePanel())) return;
    closeMobileSettingsPanel();
  });

  collapsibleizeSettingsSections();

  // ── Предупреждение о несохранённых изменениях ───
  // Почти все панели настроек работают в два шага: правишь поля вживую
  // (previewPalette(), локальные массивы вроде themeColors/statusBuckets),
  // а на сервер это уходит только по нажатию «Сохранить» – общей
  // saveSettings(). Ловим правки не по каждому полю отдельно (их десятки
  // разных типов – цвет, текст, чекбокс, перетаскивание), а одним
  // делегированным слушателем на весь #app: любой input/change внутри
  // панелей настроек взводит флаг, saveSettings() его снимает.
  //
  // Поля, которые сами по себе ничего не готовят к сохранению – имя
  // будущего статуса/раздела до нажатия «Добавить» и т.п., – помечены
  // data-no-dirty прямо в разметке. Слушатели висят на узле внутри
  // контейнера и умирают вместе с ним, снимать отдельно не нужно.
  appEl.addEventListener("input", markSettingsDirty);
  appEl.addEventListener("change", markSettingsDirty);

  // beforeunload подстраховывает закрытие окна/вкладки целиком; уход на
  // другой маршрут документ не меняет и его не вызывает – там спрашивает
  // leaveSettingsRoute() ниже.
  seOn(window, "beforeunload", (e) => {
    if (!settingsDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  container.querySelectorAll("#se-back, #se-locked-back").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      leaveSettingsRoute();
    });
  });

  // Колесо мыши над #sidebar всегда крутит страницу, а не список
  // разделов. #sidebar – position: fixed с overflow-y: auto: без auto
  // список не пролистать на невысоком окне, но браузер по умолчанию
  // отдаёт колесо БЛИЖАЙШЕМУ скроллящемуся предку под курсором – то
  // есть самому сайдбару. Внешне это выглядело как «список сам по себе
  // прыгает вверх-вниз». passive: false – иначе preventDefault() на
  // колесе браузер молча игнорирует.
  sidebar.addEventListener(
    "wheel",
    (e) => {
      window.scrollBy(0, e.deltaY);
      e.preventDefault();
    },
    { passive: false }
  );

  // Клик мимо попапа «тёмная/светлая» закрывает его.
  seOn(document, "click", () => {
    if (!openThemeGroup) return;
    openThemeGroup = null;
    document.querySelectorAll(".theme-popover").forEach((p) => p.classList.add("hidden"));
  });

  // ── Escape ──
  // Раньше страница звала enableEscapeToLeave() из js/utils.js – тот
  // висит на всплытии и уходит на "/", если открытой .modal-overlay нет.
  // Но модалка «Добавить себе» из паспорта – .pp-add-modal-overlay, в
  // этот список она не входила: одно нажатие Escape и закрывало её
  // (обработчик js/passports.js), и тут же уводило со страницы вместе с
  // недописанным отзывом. Здесь, как уже сделано в #/chars-edit и #/add,
  // свой обработчик в фазе ПЕРЕХВАТА: он видит состояние первым и гасит
  // событие, до общего дело не доходит.
  seOn(
    document,
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const ppOverlay = document.getElementById("pp-add-modal-overlay");
      if (ppOverlay && !ppOverlay.classList.contains("hidden")) {
        e.stopPropagation();
        closeAddFromPassportModal();
        return;
      }
      // Подтверждения/запросы (confirmDialog/promptDialog) – обычные
      // .modal-overlay: их закрывает общий обработчик из js/utils.js,
      // событие ему и отдаём, с маршрута при этом не уходим.
      if (document.querySelector(".modal-overlay:not(.hidden), .review-modal-overlay:not(.hidden)")) return;
      e.stopPropagation();
      settingsBackAction();
    },
    { capture: true }
  );

  loadCurrentSettings();
  detectApp();
}

function unmount() {
  setLeaveGuard(null);
  seCleanupFns.forEach((fn) => fn());
  seCleanupFns = [];
  if (seSidebarObserver) {
    seSidebarObserver.disconnect();
    seSidebarObserver = null;
  }

  // Модалка «Добавить себе» вешает свой Escape прямо на document
  // (js/passports.js, openAddFromPassportModal). Если уйти с маршрута с
  // открытой модалкой, её разметки уже нет, и closeAddFromPassportModal()
  // вышел бы по `if (!overlay) return`, оставив слушателя навсегда.
  document.removeEventListener("keydown", onAddFromPassportModalKey);

  revertPalettePreview();
  sePrevSkin = null;

  document.title = sePrevTitle || document.title;
  settingsDirty = false;
  seMobilePanelOpen = false;
  openThemeGroup = null;
  tabDragSrc = null;
  appInfo = null;
  hideTagsAllOn = false;
}

// Общая проверка при уходе с ТЕКУЩЕЙ панели – неважно, на другую
// вкладку (клик по .side-tab), назад к списку на телефоне
// (#settings-panel-back / settingsBackAction()) или совсем с маршрута
// (leaveSettingsRoute()). Раньше про несохранённое спрашивала только
// последняя – переключаться между разделами можно было свободно, и
// правки в открытой панели терялись незаметно: узнать об этом (если
// вообще) получалось только в момент ухода из настроек целиком, когда
// уже не вспомнить, в какой конкретно панели что забыл сохранить.
async function confirmLeavePanel() {
  if (!settingsDirty) return true;
  const canLeave = await confirmLeaveIfDirty({
    isDirty: () => settingsDirty,
    save: saveSettings,
  });
  if (canLeave) {
    settingsDirty = false;
    // Уходим с открытой панели – если это была «Внешний вид»,
    // previewPalette() успела покрасить весь документ инлайновым
    // стилем поверх сохранённой темы (см. комментарий у
    // revertPalettePreview() ниже). Если правки перед этим сохранились
    // (saveSettings() выше), откатывать нечего – revertPalettePreview()
    // на уже сохранённой теме просто ничего не меняет; если же выбрали
    // «Уйти без сохранения» – возвращает документ к тому, что реально
    // лежит в site-settings.json. Раньше откат случался только в
    // unmount(), то есть при уходе с маршрута целиком, – список
    // разделов и любая другая открытая следом панель оставались в
    // непросмотренной теме до конца сессии настроек. Здесь тот же
    // откат, но при уходе с ЛЮБОЙ панели, а не только при закрытии
    // всего маршрута; на панелях без предпросмотра темы вызов ничего
    // не меняет.
    revertPalettePreview();
  }
  return canLeave;
}

// Уйти с маршрута – с тем же вопросом, что раньше задавала ссылка «На
// главную» при несохранённых правках (beforeunload между маршрутами не
// срабатывает: документ не меняется).
async function leaveSettingsRoute() {
  if (!(await confirmLeavePanel())) return;
  leaveRoute();
}

// Закрыть открытую на телефоне панель и вернуться к списку разделов
// (см. .mobile-panel-open в index.html). Вызывающий уже сам спросил
// confirmLeavePanel() – здесь только сама смена вида, без второго
// вопроса.
//
// Класс .active на .side-tab снимаем тоже здесь: на ПК он не мешает
// (сайдбар виден всегда, и обработчик клика по .side-tab специально
// игнорирует клик по уже активной кнопке – открывать нечего, панель и
// так на экране). А вот на телефоне после возврата к списку разделов
// кнопка оставалась визуально выделенной и «активной» для того же
// обработчика – повторный тап по ней проваливался в тот самый ранний
// выход и панель было не открыть снова. Раздел, в который заходили
// последним, при следующем открытии настроек с нуля подсветится через
// разметку по умолчанию («Внешний вид»), а не через этот класс.
function closeMobileSettingsPanel() {
  document.getElementById("app")?.classList.remove("mobile-panel-open");
  document.querySelectorAll(".side-tab.active").forEach((btn) => btn.classList.remove("active"));
  seMobilePanelOpen = false;
}

// Регистрируется как setLeaveGuard() (см. mount()) – то, что реально
// зовёт кнопка «назад» на телефоне (аппаратная/жест, см.
// installBackButton() в mobile/src/main.js) и Escape. На ПК сайдбар
// виден всегда целиком, seMobilePanelOpen там в false и не взводится
// (см. клик по .side-tab), так что там это просто leaveSettingsRoute()
// как и было.
async function settingsBackAction() {
  if (seMobilePanelOpen) {
    if (!(await confirmLeavePanel())) return;
    closeMobileSettingsPanel();
    return;
  }
  await leaveSettingsRoute();
}

// previewPalette() красит вживую весь документ инлайновым стилем на
// <html> – на отдельной странице это переживало ровно до перехода, а в
// общей оболочке осталось бы висеть на всём приложении. Снимаем
// собственные объявления: под ними лежит #theme-overrides от
// applyTheme() (см. js/theme.js) с настоящими, сохранёнными значениями,
// так что откат мгновенный и без вспышки. saveSettings() при успехе сам
// зовёт applyTheme() и обновляет sePrevSkin – тогда откатывать нечего.
//
// Зовётся не только при закрытии маршрута целиком (unmount()), но и при
// уходе с каждой отдельной панели (confirmLeavePanel()) – поэтому сам
// sePrevSkin здесь не обнуляем: он хранит тему на момент открытия
// настроек и должен пережить несколько заходов в «Внешний вид» и
// откатов подряд в рамках одной сессии. Обнуляет его только unmount(),
// когда сессия настроек и правда закончилась.
function revertPalettePreview() {
  const root = document.documentElement;
  for (const { key } of PALETTE_TOKENS) root.style.removeProperty(key);
  for (const key of Object.keys(accentVariants(DEFAULT_ACCENT))) root.style.removeProperty(key);
  root.style.removeProperty("--text-scale");
  if (sePrevSkin) root.setAttribute("data-skin", sePrevSkin);
}

// ── Сворачиваемые разделы настроек ──────────────
// Осталось только там, где родилась исходная просьба – «Вкладки»: там
// три отдельных раздела (сами вкладки, статусы, разделы «Любимого»), и
// пролистывать мимо двух неактуальных действительно приходилось. Плюс
// «Подписи», которые рисуют свои заголовки групп позже.
//
// Каждый h2.section-h внутри панели помечает начало раздела; всё, что
// идёт за ним до следующего h2.section-h (или до конца родителя) – тело
// этого раздела. Оборачиваем обе части в .set-sec и вешаем клик на
// заголовок – см. CSS у .set-view .set-sec в index.html.
function collapsibleizeSettingsSections() {
  // idempotent: «Подписи» дорисовывает свои h2.section-h позже, после
  // загрузки настроек (renderLabelsPanel), и эта функция вызывается
  // ещё раз – уже обёрнутые заголовки пропускаем, а не заворачиваем
  // повторно (иначе .set-sec оказалась бы вложена сама в себя).
  document
    .querySelectorAll(
      "#panel-tabs h2.section-h:not(.set-sec-toggle), #panel-labels h2.section-h:not(.set-sec-toggle)"
    )
    .forEach((h2) => {
      const parent = h2.parentNode;
      const body = document.createElement("div");
      body.className = "set-sec-body";
      let next = h2.nextElementSibling;
      while (next && !(next.tagName === "H2" && next.classList.contains("section-h"))) {
        const toMove = next;
        next = next.nextElementSibling;
        body.appendChild(toMove);
      }
      const wrap = document.createElement("div");
      wrap.className = "set-sec collapsed";
      h2.classList.add("set-sec-toggle");
      h2.setAttribute("tabindex", "0");
      h2.setAttribute("role", "button");
      h2.setAttribute("aria-expanded", "false");
      parent.insertBefore(wrap, h2);
      wrap.appendChild(h2);
      wrap.appendChild(body);

      const toggle = () => {
        const open = wrap.classList.toggle("collapsed") === false;
        h2.setAttribute("aria-expanded", String(open));
      };
      h2.addEventListener("click", toggle);
      h2.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    });
}

let settingsDirty = false;

function markSettingsDirty(e) {
  if (e.target.closest("[data-no-dirty]")) return;
  if (!e.target.closest(".panel")) return;
  settingsDirty = true;
}

function flashStatus(id, ok, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = ok ? "var(--green)" : "var(--red-hi)";
}


registerRoute("#/settings-edit", { mount, unmount });
