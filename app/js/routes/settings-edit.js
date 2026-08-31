// ══════════════════════════════════════════════
//  РОУТ #/settings-edit — настройки приложения
//  (см. план перехода на SPA, фаза 3.4 — последняя страница)
//
//  Как и #/chars-edit, #/favorites-edit и #/add, вид НЕ завёрнут в
//  IIFE: в разметке настроек больше сотни инлайновых onclick="имя(…)"
//  (полки оценок, вкладки, статусы, коллекции, разделы «Любимого»,
//  хранилища, синхронизация, палитра), и переписывать каждый вызов на
//  обращение через объект-неймспейс ради самой процедуры переноса —
//  это посадить опечатку на ровном месте. Все 134 верхнеуровневых
//  имени взяты из app/settings-edit.html как есть: ни одно из них не
//  совпадает ни с js/*.js, ни с js/routes/*.js, ни с инлайном
//  index.html — проверено scripts/check-duplicate-functions.js.
//
//  ── ГЛАВНОЕ: iframe с add.html не тронут ──
//  Здесь живёт хост модалки «Добавить себе» из чужого паспорта:
//  #pp-add-modal-overlay/#pp-add-modal-frame. Саму модалку открывает и
//  закрывает js/passports.js (openAddFromPassportModal/
//  closeAddFromPassportModal), а внутрь грузится буквально
//  /add.html?fromPassport=1&title=… — отдельным документом, не
//  маршрутом #/add. Родитель читает у него frame.contentWindow.addDirty,
//  а add.html после сохранения сам зовёт
//  window.parent.closeAddFromPassportModal(). Ничего из этого не
//  меняется от того, что родитель стал видом роутера, а не отдельным
//  документом: iframe остаётся iframe'ом, window.parent — этим окном,
//  а обе функции по-прежнему живут в js/passports.js (он подключён к
//  index.html вместе с этим маршрутом). Разметка оверлея и его CSS
//  перенесены байт в байт; ни js/passports.js, ни app/add.html не
//  тронуты.
//
//  Единственная добавка по этой части — снятие слушателя Escape,
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
//  делается механически. После вставки зовётся applyI18n(container) —
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
//  странице выполнялась прямо в теле скрипта — здесь она в mount().
//  Подписок на одноразовые site-labels-ready/tags-map-updated у этой
//  страницы не было вовсе, так что ловушки фаз 3.2/3.3 тут нет.
// ══════════════════════════════════════════════

let seCleanupFns = [];
let sePrevTitle = null;
let sePrevSkin = null;
let seSidebarObserver = null;
// Открыта ли на телефоне какая-то панель поверх списка разделов (см.
// .mobile-panel-open в index.html) — на ПК ни на что не влияет,
// сайдбар там открыт всегда целиком.
let seMobilePanelOpen = false;

function seOn(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  seCleanupFns.push(() => target.removeEventListener(type, handler, opts));
}

// Иконки пунктов списка настроек на телефоне (см. .side-tab-icon в
// index.html — на ПК скрыты: там сайдбар открыт целиком, иконка рядом
// с текстом ничего не поясняет, только сужает и без того тесную
// колонку). Тот же стиль SVG, что и у нижних вкладок (viewBox 24×24,
// stroke=currentColor, stroke-width 2) — простые геометрические
// значки, не иллюстрации, единообразные с уже готовыми в index.html.
// «Статистика» и «Тир-листы» — те же контуры, что у одноимённых
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

// data-i18n — на span, а не на самой кнопке: applyI18n() подменяет
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
      <button class="side-tab" data-panel="passports">${sideTabIcon("passports")}${sideTabLabel("Паспорта")}</button>
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
      <h1 data-i18n>Настройки</h1>

      <div class="panel active" id="panel-appearance">
        <div class="theme-grid" id="themeGrid"></div>

        <!-- Отдельно от «Масштаба» (Приложение) — тот через
             webContents.setZoomFactor у Electron увеличивает вообще всё
             (включая иконки и рамки в px) и недоступен на телефоне/сайте.
             Это чистый CSS-множитель (--text-scale, см. style.css) —
             растягивает только текст и то, что в rem, работает везде. -->
        <h2 class="section-h" data-i18n>Размер шрифта</h2>
        <p class="panel-intro" data-i18n>
          Только текст — иконки и отступы не меняются. Чтобы увеличить вообще
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
          Ставит «Не показывать теги на карточке» сразу во всех отзывах —
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
        <p class="panel-intro" data-i18n>Глаз — показывать вкладку или нет. Карандаш — переименовать. Перетаскивай за ⠿, чтобы менять порядок. Точка справа — какая вкладка открывается первой (при заходе на сайт и при обновлении страницы).</p>
        <div id="tabsList"></div>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-tabs"></div>

        <h2 class="section-h" data-i18n>Разделы вкладки «Статусы»</h2>
        <div id="statusesList"></div>
        <div class="row" style="margin-top:14px;">
          <div><label data-i18n>Новый статус</label><input type="text" id="newStatusName" data-no-dirty placeholder="Например: Брошено" data-i18n-placeholder="Например: Брошено"></div>
        </div>
        <button class="btn btn-ghost" onclick="addStatusBucket()" data-i18n>Добавить статус</button>
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
        <p class="panel-intro" data-i18n>
          Клавиши для поиска, нового отзыва и списка горячих клавиш можно
          поменять под себя — жми «Изменить» и нажми нужную клавишу.
        </p>
        <div id="shortcutsList"></div>
        <button class="btn btn-ghost" onclick="resetShortcutsToDefault()" data-i18n>Сбросить к умолчаниям</button>

        <h2 class="section-h" data-i18n>Переключение вкладок</h2>
        <p class="panel-intro" data-i18n>
          Цифры 1–5 переключают вкладки по порядку и сами подстраиваются,
          если какую-то скрыть. Здесь — необязательно, поверх цифр: своя
          клавиша или кнопка мыши (средняя, «назад»/«вперёд») на
          конкретную вкладку, привязанная к ней самой, а не к номеру.
        </p>
        <div id="tabKeyBindingsList"></div>
      </div>

      <div class="panel" id="panel-stats">
        <p class="panel-intro" data-i18n>Что показывать на вкладке "Статистика".</p>
        <div id="statsList"></div>

        <h2 class="section-h" data-i18n>Цвета по типам</h2>
        <p class="panel-intro" data-i18n>Красят разбивку по типам и годам — диаграмму, столбики и цифры.</p>
        <div id="typeColorsList"></div>

        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-stats"></div>
      </div>

      <div class="panel" id="panel-grades">
        <p class="panel-intro" data-i18n>Тип шкалы влияет на то, как выглядит поле оценки в форме добавления и как тайтлы раскладываются по тир-листу.</p>

        <div class="theme-grid" id="scaleTypeGrid"></div>

        <div id="categoricalBlock">
          <h2 class="section-h" data-i18n>Полки</h2>
          <p class="panel-intro" data-i18n>Переименуй, перекрась, удали или добавь свою.</p>
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
          <p class="panel-intro" data-i18n>Каждая полка — диапазон значений с названием и цветом. Именно эти полки станут строками тир-листа.</p>
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
          Все надписи, которые видит посетитель. Пустое поле означает
          «оставить как есть» — под ним написано значение по умолчанию.
        </p>
        <div id="labelsGroups"></div>
        <button class="btn-save" onclick="saveSettings()" data-i18n>Сохранить</button>
        <div class="status-msg" id="status-labels"></div>
      </div>

      <div class="panel" id="panel-passports">
        <div id="passportsPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- Синхронизация между своими устройствами (телефон, компьютер,
           ещё один компьютер) через приватный репозиторий на GitHub —
           бесплатно, без своего сервера. Не путать с «Паспортом»: тот
           про показ себя чужим, этот — про то, чтобы твои же данные были
           одинаковыми на всех твоих устройствах. Подробности решения —
           в app/js/sync.js. -->
      <div class="panel" id="panel-sync">
        <div id="syncPanel"><p class="panel-intro" data-i18n>Загружаем…</p></div>
      </div>

      <!-- Список хранилищ и переключение между ними. Не путать с
           «Паспортом» на соседней вкладке: тот — урезанный файл-слепок
           для показа чужим, а тут — свои полноценные хранилища, между
           которыми можно переключаться, как между профилями в Obsidian.
           Панель показывается только в приложении — на голом сайте
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
          <div class="app-path" id="app-vault-path">—</div>
        </div>
        <!-- «Открыть в проводнике» и «Сменить папку» — только для компьютера:
             там это настоящая папка на диске. На телефоне хранилище лежит
             во внутренней области приложения — там нет ни проводника, чтобы
             её открыть, ни смысла её менять (она одна). Раньше эти кнопки
             просто ничего не делали на телефоне — appInfo.mobile в
             renderAppPanel() решает, какой из двух блоков показать. -->
        <div class="row" id="app-vault-actions" style="gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost" onclick="openVaultFolder()" data-i18n>Открыть в проводнике</button>
          <button class="btn btn-ghost" onclick="changeVault()" data-i18n>Сменить папку…</button>
        </div>
        <p class="panel-intro hidden" id="app-vault-mobile-note" data-i18n>
          Хранится во внутренней области приложения — её не видят другие
          приложения, и она исчезнет вместе с удалением TasteID. Чтобы
          перенести данные на другое устройство — резервная копия ниже.
        </p>

        <!-- Не путать с «Паспортом» на соседней вкладке: тот — урезанный
             слепок для показа чужим (без текста отзывов, без избранного,
             без тир-листов) и никогда не пишется обратно в своё же
             хранилище — только смотреть и сравнивать. Здесь наоборот:
             всё целиком и для себя. На компьютере то же самое даёт
             обычное копирование папки хранилища; на телефоне такой папки
             не видно, и без этой кнопки перенести свои же данные было бы
             нечем — сравнить с чужими можно, а увезти свои с собой нет. -->
        <h2 class="section-h" data-i18n>Резервная копия</h2>
        <p class="panel-intro" data-i18n>
          Отзывы, любимое, тир-листы, настройки и загруженные вручную
          картинки — одним файлом, для себя.
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

        <!-- Масштаб — тоже только компьютер: там это webContents.setZoomLevel
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
        <div class="row"><div class="app-path" id="app-version">—</div></div>
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
           (backup-history.html) — открывалась поверх настроек и обратно
           вела только на главную, а не назад в настройки. Здесь та же
           разметка (#fileTabs/#content) и тот же скрипт
           (js/backup-history.js), просто внутри панели — переключение
           между панелями уже умеет .side-tab. -->
      <div class="panel" id="panel-backup">
        <p class="panel-intro" data-i18n>
          Каждое сохранение файла — это отдельная версия, которая навсегда остаётся здесь, даже если
          текущая версия сломается. Выбери файл, найди нужную дату и либо скачай эту версию как
          JSON, либо восстанови её — тогда она станет текущей.
        </p>
        <div class="history-retention">
          <label for="history-retention-select" data-i18n>Автоматически удалять версии старше:</label>
          <select id="history-retention-select" data-no-dirty onchange="saveHistoryRetention(this.value)"></select>
          <button class="btn btn-ghost" onclick="pruneHistoryNow()" title="Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки — по всем файлам сразу" data-i18n data-i18n-title="Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки — по всем файлам сразу">Почистить сейчас</button>
        </div>
        <div class="status-msg" id="status-history-retention"></div>
        <div class="file-tabs" id="fileTabs"></div>
        <div id="content"><div class="state-box"><div class="spinner"></div>Загружаем…</div></div>
      </div>
    </main>
  </div>

  <!-- «Добавить себе» из чужого паспорта — тот же add.html, что и обычно,
       просто в рамке поверх текущей панели, а не отдельной страницей. См.
       openAddFromPassportModal()/closeAddFromPassportModal() в
       js/passports.js и ветку fromPassport в add.html (она же
       закрывает модалку после сохранения). Разметка перенесена байт в
       байт — на неё завязан js/passports.js по id. -->
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
  document.title = `TasteID — ${i18n("Настройки")}`;

  // Состояние вида — с нуля при каждом монтировании: верхнеуровневые
  // let'ы живут столько же, сколько документ, а не столько, сколько
  // открыт маршрут (см. шапку файла).
  settingsDirty = false;
  seMobilePanelOpen = false;
  // Та же leaveSettingsRoute(), что ниже висит на клике по кнопке
  // "назад" — но теперь ещё и на аппаратной/жестовой кнопке "назад" на
  // телефоне (см. installBackButton() в mobile/src/main.js): раньше она
  // обходила эту проверку, дёргая историю напрямую. settingsBackAction()
  // оборачивает её же: на телефоне с открытой панелью сперва просто
  // закрывает панель (возврат к списку разделов, как и переключение
  // между вкладками на ПК — без вопроса про несохранённое), и только
  // если панель и так закрыта — спрашивает и уходит с маршрута.
  setLeaveGuard(settingsBackAction);
  appInfo = null;
  reviewsForCount = null;
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
  // Разметка вставлена одним куском вместе с атрибутами data-i18n —
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

  const sidebar = container.querySelector("#sidebar");
  seCleanupFns.push(
    makeResizablePanel(sidebar, container.querySelector("#sidebar-resize"), "tasteid-sidebar-width", 180, 380)
  );

  // #sidebar — position: fixed (см. её же комментарий в CSS index.html),
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

  container.querySelectorAll(".side-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      // Клик по уже открытой вкладке ничего не переключает — не повод
      // спрашивать про несохранённое там, где никакого ухода с панели
      // не происходит.
      if (btn.classList.contains("active")) return;
      if (!(await confirmLeavePanel())) return;
      container.querySelectorAll(".side-tab").forEach((b) => b.classList.remove("active"));
      container.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("active");
      // На ПК ничего не меняет (сайдбар виден всегда), а на телефоне —
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

  // «Все настройки» — видна только на телефоне (см. .settings-panel-back
  // в index.html), закрывает панель и возвращает к списку разделов —
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
  // а на сервер это уходит только по нажатию «Сохранить» — общей
  // saveSettings(). Ловим правки не по каждому полю отдельно (их десятки
  // разных типов — цвет, текст, чекбокс, перетаскивание), а одним
  // делегированным слушателем на весь #app: любой input/change внутри
  // панелей настроек взводит флаг, saveSettings() его снимает.
  //
  // Поля, которые сами по себе ничего не готовят к сохранению — имя
  // будущего статуса/раздела до нажатия «Добавить» и т.п., — помечены
  // data-no-dirty прямо в разметке. Слушатели висят на узле внутри
  // контейнера и умирают вместе с ним, снимать отдельно не нужно.
  appEl.addEventListener("input", markSettingsDirty);
  appEl.addEventListener("change", markSettingsDirty);

  // beforeunload подстраховывает закрытие окна/вкладки целиком; уход на
  // другой маршрут документ не меняет и его не вызывает — там спрашивает
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
  // разделов. #sidebar — position: fixed с overflow-y: auto: без auto
  // список не пролистать на невысоком окне, но браузер по умолчанию
  // отдаёт колесо БЛИЖАЙШЕМУ скроллящемуся предку под курсором — то
  // есть самому сайдбару. Внешне это выглядело как «список сам по себе
  // прыгает вверх-вниз». passive: false — иначе preventDefault() на
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
  // Раньше страница звала enableEscapeToLeave() из js/utils.js — тот
  // висит на всплытии и уходит на "/", если открытой .modal-overlay нет.
  // Но модалка «Добавить себе» из паспорта — .pp-add-modal-overlay, в
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
      // Подтверждения/запросы (confirmDialog/promptDialog) — обычные
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

  document.title = sePrevTitle || document.title;
  settingsDirty = false;
  seMobilePanelOpen = false;
  openThemeGroup = null;
  tabDragSrc = null;
  appInfo = null;
  reviewsForCount = null;
  hideTagsAllOn = false;
}

// Общая проверка при уходе с ТЕКУЩЕЙ панели — неважно, на другую
// вкладку (клик по .side-tab), назад к списку на телефоне
// (#settings-panel-back / settingsBackAction()) или совсем с маршрута
// (leaveSettingsRoute()). Раньше про несохранённое спрашивала только
// последняя — переключаться между разделами можно было свободно, и
// правки в открытой панели терялись незаметно: узнать об этом (если
// вообще) получалось только в момент ухода из настроек целиком, когда
// уже не вспомнить, в какой конкретно панели что забыл сохранить.
async function confirmLeavePanel() {
  if (!settingsDirty) return true;
  const go = await confirmDialog(
    i18n("Есть несохранённые изменения — уйти и потерять их?"),
    i18n("Уйти без сохранения"),
    i18n("Остаться")
  );
  if (go) settingsDirty = false;
  return go;
}

// Уйти с маршрута — с тем же вопросом, что раньше задавала ссылка «На
// главную» при несохранённых правках (beforeunload между маршрутами не
// срабатывает: документ не меняется).
async function leaveSettingsRoute() {
  if (!(await confirmLeavePanel())) return;
  leaveRoute();
}

// Закрыть открытую на телефоне панель и вернуться к списку разделов
// (см. .mobile-panel-open в index.html). Вызывающий уже сам спросил
// confirmLeavePanel() — здесь только сама смена вида, без второго
// вопроса.
function closeMobileSettingsPanel() {
  document.getElementById("app")?.classList.remove("mobile-panel-open");
  seMobilePanelOpen = false;
}

// Регистрируется как setLeaveGuard() (см. mount()) — то, что реально
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
// <html> — на отдельной странице это переживало ровно до перехода, а в
// общей оболочке осталось бы висеть на всём приложении. Снимаем
// собственные объявления: под ними лежит #theme-overrides от
// applyTheme() (см. js/theme.js) с настоящими, сохранёнными значениями,
// так что откат мгновенный и без вспышки. saveSettings() при успехе сам
// зовёт applyTheme() и обновляет sePrevSkin — тогда откатывать нечего.
function revertPalettePreview() {
  const root = document.documentElement;
  for (const { key } of PALETTE_TOKENS) root.style.removeProperty(key);
  for (const key of Object.keys(accentVariants(DEFAULT_ACCENT))) root.style.removeProperty(key);
  root.style.removeProperty("--text-scale");
  if (sePrevSkin) root.setAttribute("data-skin", sePrevSkin);
  sePrevSkin = null;
}

// ── Сворачиваемые разделы настроек ──────────────
// Осталось только там, где родилась исходная просьба — «Вкладки»: там
// три отдельных раздела (сами вкладки, статусы, разделы «Любимого»), и
// пролистывать мимо двух неактуальных действительно приходилось. Плюс
// «Подписи», которые рисуют свои заголовки групп позже.
//
// Каждый h2.section-h внутри панели помечает начало раздела; всё, что
// идёт за ним до следующего h2.section-h (или до конца родителя) — тело
// этого раздела. Оборачиваем обе части в .set-sec и вешаем клик на
// заголовок — см. CSS у .set-view .set-sec в index.html.
function collapsibleizeSettingsSections() {
  // idempotent: «Подписи» дорисовывает свои h2.section-h позже, после
  // загрузки настроек (renderLabelsPanel), и эта функция вызывается
  // ещё раз — уже обёрнутые заголовки пропускаем, а не заворачиваем
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

// ── Скрыть теги на всех карточках разом ──
// Переключатель (по образцу .fav-toggle из редактора отзыва, см. CSS в
// index.html) поверх обычного поля отзыва — no_tags_on_card, то же
// самое, что чекбокс «Не показывать теги на карточке» в редакторе
// одного отзыва (add.js). core/api.js (saveReview, _hide_all_card_tags)
// расставляет или снимает этот флаг сразу во всех отзывах одной записью
// в reviews.json — оба направления симметричны: включение и выключение
// действуют на всех одинаково, включая отзывы, где галочку поставили
// вручную через редактор конкретного отзыва. Без подтверждения — это
// переключатель, а не разовое необратимое действие, как раньше: щёлкнул
// не туда, щёлкнул обратно.
//
// Кнопка не тянет reviews.json, чтобы при каждом заходе в настройки
// узнать, стоит ли флаг уже у всех, — файл четверть мегабайта, а
// «Внешний вид» открывается чаще любой другой панели (тот же довод, что
// у reviewsForCount ниже, про подсчёт по статусам). Поэтому при каждом
// заходе кнопка открывается в состоянии «выключено» и просто делает то,
// что показывает; если на самом деле уже всё скрыто (или уже всё
// видно), сервер честно вернёт touched: 0, и сообщение об этом скажет.
let hideTagsAllOn = false;

function syncHideTagsToggle() {
  const btn = document.getElementById("hide-tags-toggle");
  if (!btn) return;
  btn.classList.toggle("on", hideTagsAllOn);
  btn.setAttribute("aria-pressed", String(hideTagsAllOn));
  document.getElementById("hide-tags-toggle-icon").innerHTML = eyeIcon(hideTagsAllOn);
  document.getElementById("hide-tags-toggle-label").textContent = hideTagsAllOn
    ? i18n("Теги скрыты на всех карточках")
    : i18n("Скрыть теги на всех карточках");
}

async function toggleHideAllCardTags() {
  const statusId = "status-hide-all-card-tags";
  const next = !hideTagsAllOn;
  try {
    const res = await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ _hide_all_card_tags: next }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);
    refreshOpenReviewsTab();
    hideTagsAllOn = next;
    syncHideTagsToggle();
    flashStatus(
      statusId,
      true,
      data.touched
        ? next
          ? i18n("Готово — теги скрыты на {n} карточках.", { n: data.touched })
          : i18n("Готово — теги возвращены на {n} карточках.", { n: data.touched })
        : next
          ? i18n("У всех отзывов теги на карточке уже были скрыты.")
          : i18n("У всех отзывов теги на карточке уже были видны.")
    );
  } catch (e) {
    flashStatus(statusId, false, i18n("Ошибка сети: ") + e.message);
  }
}

// ── Глаз вместо галочки ──
// eyeIcon()/eyeButton() живут в js/utils.js — общие для всех страниц,
// здесь просто зовутся.

// ── Блоки статистики ──
const STAT_BLOCKS = [
  { key: "counters", label: i18n("По типам (цифры)") },
  { key: "donut", label: i18n("По типам (диаграмма)") },
  { key: "watch-bars", label: i18n("По годам просмотра") },
  { key: "release-bars", label: i18n("По годам выхода") },
  { key: "grades", label: i18n("Распределение оценок") },
  { key: "rewatch", label: i18n("Пересмотры") },
  { key: "tags", label: i18n("Облако тегов") },
  { key: "spotlight", label: i18n("Топ тайтлы года") },
];
let hiddenStatsState = new Set();

// ── Цвета по типам ──────────────────────────────
// Красят разбивку по типам и годам на вкладке «Статистика»
// (js/stats.js, TYPE_COLORS — это те же ключи и цвета по умолчанию).
// Список типов — тот же, что у BUILTIN_TYPE_DEFAULTS ниже по файлу;
// typeLabels ещё не заполнен на момент объявления, поэтому названия
// читает сама функция рендера, а не константа здесь.
const TYPE_COLOR_DEFAULTS = {
  anime: "#8b1a1a",
  manga: "#1a4a8b",
  manhwa: "#2563a8",
  manhua: "#4a7abf",
  novel: "#5a2d8a",
  book: "#8a4abf",
  movie: "#1a6b3a",
  show: "#2d8a52",
  dorama: "#4aab6e",
  game: "#8b6914",
  gacha: "#c0a020",
};
let typeColors = {};

function renderTypeColorsList() {
  const box = document.getElementById("typeColorsList");
  if (!box) return;
  box.innerHTML = Object.keys(TYPE_COLOR_DEFAULTS)
    .map((key) => {
      const label = typeLabels[key] || key;
      const color = typeColors[key] || TYPE_COLOR_DEFAULTS[key];
      return `<div class="pal-row">
        <input type="color" data-type-color="${key}" value="${color}">
        <div class="pal-text"><div class="pal-name">${esc(label)}</div></div>
        <button type="button" class="pal-reset" data-type-reset="${key}"${typeColors[key] ? "" : " hidden"}>${i18n("Цвет по умолчанию")}</button>
      </div>`;
    })
    .join("");
  box.querySelectorAll('input[type="color"]').forEach((input) => {
    input.oninput = () => {
      typeColors[input.dataset.typeColor] = input.value;
      box.querySelector(`[data-type-reset="${input.dataset.typeColor}"]`).hidden = false;
    };
  });
  box.querySelectorAll("[data-type-reset]").forEach((btn) => {
    btn.onclick = () => {
      delete typeColors[btn.dataset.typeReset];
      renderTypeColorsList();
    };
  });
}

function renderStatsList() {
  const container = document.getElementById("statsList");
  container.innerHTML = STAT_BLOCKS.map(
    (b) => `
      <div class="tab-row">
        ${eyeButton(hiddenStatsState.has(b.key), `hiddenStatsState.has('${b.key}') ? hiddenStatsState.delete('${b.key}') : hiddenStatsState.add('${b.key}'); renderStatsList();`)}
        <span class="tab-name">${esc(b.label)}</span>
      </div>
    `
  ).join("");
}

// ── Шкала оценок ──
const SCALE_TYPES = [
  { id: "categorical", label: i18n("Названия") },
  { id: "numeric", label: i18n("Числа") },
  { id: "stars", label: i18n("Звёзды") },
];
let scaleType = "categorical";
let shelves = []; // [{key, name, color, min, max}]

const DEFAULT_SHELF_COLORS = ["#7c3aed", "#2563a8", "#2d8a4e", "#d4a017", "#6b7280", "#c0392b", "#8B6914"];

function renderScaleTypeGrid() {
  const grid = document.getElementById("scaleTypeGrid");
  grid.innerHTML = SCALE_TYPES.map(
    (t) => `<div class="theme-option${t.id === scaleType ? " selected" : ""}" data-scale="${t.id}">${t.label}</div>`
  ).join("");
  grid.querySelectorAll(".theme-option").forEach((el) => {
    el.onclick = () => {
      const prevWasCategorical = scaleType === "categorical";
      scaleType = el.dataset.scale;
      const nowIsCategorical = scaleType === "categorical";
      if (prevWasCategorical !== nowIsCategorical) shelves = [];
      renderScaleTypeGrid();
      updateScaleBlocks();
    };
  });
  document.getElementById("numericMaxLabel").textContent =
    scaleType === "stars" ? "Сколько звёзд" : i18n("Максимум");
}

function updateScaleBlocks() {
  document.getElementById("categoricalBlock").style.display = scaleType === "categorical" ? "" : "none";
  document.getElementById("numericBlock").style.display = scaleType === "categorical" ? "none" : "";
  if (scaleType === "categorical") {
    if (!shelves.length) seedCategoricalShelves();
    renderShelvesList("catShelvesList", false);
  } else {
    if (!shelves.length) seedNumericShelves();
    renderShelvesList("shelvesList", true);
  }
}

// Сид для "Названия" — обязательно с реальными ключами GRADES_DEF,
// иначе уже сохранённые отзывы (grade: "etalon" и т.д.) перестанут
// находить свою полку.
function seedCategoricalShelves() {
  shelves = GRADES_DEF.map((g) => ({ key: g.key, name: g.name, color: g.color, desc: g.desc }));
}

function seedNumericShelves() {
  const max = Number(document.getElementById("numericMax").value) || (scaleType === "stars" ? 5 : 10);
  const names = [
    i18n("Резонанс"),
    i18n("Эталон"),
    i18n("Отлично"),
    i18n("Аттракцион"),
    i18n("Фоновый шум"),
    i18n("Брак"),
    i18n("Разочарование"),
  ];
  const n = Math.min(names.length, max);
  const step = max / n;
  shelves = [];
  for (let i = 0; i < n; i++) {
    const hi = Math.round(max - i * step);
    const lo = i === n - 1 ? 1 : Math.round(max - (i + 1) * step) + 1;
    shelves.push({ key: "shelf_" + (i + 1), name: names[i], color: DEFAULT_SHELF_COLORS[i], min: lo, max: hi });
  }
}

function renderShelvesList(containerId, withRange) {
  const container = document.getElementById(containerId);
  container.innerHTML = shelves
    .map(
      (s, i) => `
      <div class="shelf-row">
        <div class="shelf-row-main">
          <input type="color" value="${esc(s.color)}" onchange="shelves[${i}].color=this.value">
          <input type="text" value="${esc(s.name)}" onchange="shelves[${i}].name=this.value" placeholder="${i18n("Название")}">
          ${
            withRange
              ? `
            <span class="rng">${i18n("от")}</span>
            <input type="number" value="${s.min}" onchange="shelves[${i}].min=Number(this.value)">
            <span class="rng">${i18n("до")}</span>
            <input type="number" value="${s.max}" onchange="shelves[${i}].max=Number(this.value)">
          `
              : ""
          }
          <button class="icon-btn" onclick="removeShelfRow(${i}, '${containerId}', ${withRange})">✕</button>
        </div>
        <input type="text" class="shelf-desc" value="${esc(s.desc || "")}"
          onchange="shelves[${i}].desc=this.value" placeholder="${i18n("Описание — показывается подсказкой при наведении")}">
      </div>
    `
    )
    .join("");
}

function addShelfRow(categorical) {
  if (categorical) {
    const name = i18n("Новая полка");
    const key = "custom_" + name.toLowerCase() + "_" + Date.now().toString(36).slice(-5);
    shelves.push({ key, name, color: "#8b1a1a" });
    renderShelvesList("catShelvesList", false);
  } else {
    const max = Number(document.getElementById("numericMax").value) || 10;
    shelves.push({
      key: "shelf_" + Date.now().toString(36).slice(-5),
      name: i18n("Новая полка"),
      color: "#8b1a1a",
      min: 1,
      max,
    });
    renderShelvesList("shelvesList", true);
  }
}

async function removeShelfRow(i, containerId, withRange) {
  if (!(await confirmDialog(i18n("Удалить полку «{name}»?", { name: shelves[i].name })))) return;
  shelves.splice(i, 1);
  renderShelvesList(containerId, withRange);
}

// ── Коллекции тир-листов ──
let tierCollections = [];

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) +
    "-" +
    Date.now().toString(36).slice(-4)
  );
}

// ── Режим тир-листа «Тайтлы» ───────────────────
// Не элемент tierCollections: у коллекций своя папка с картинками
// и редактор, а «Тайтлы» — это просто вид тир-листа поверх reviews.json,
// хранить для него нечего. Поэтому отдельные переменные, тот же
// визуальный паттерн (.tab-row), что у статусов и коллекций.
let tierTitlesLabel = i18n("Тайтлы");
let hiddenTierModesState = new Set();

function renderTierModesList() {
  const container = document.getElementById("tierModesList");
  container.innerHTML = `
      <div class="tab-row" id="tiermoderow-titles">
        ${eyeButton(hiddenTierModesState.has("titles"), "hiddenTierModesState.has('titles') ? hiddenTierModesState.delete('titles') : hiddenTierModesState.add('titles'); renderTierModesList();")}
        <span class="tab-name" id="tiermodename-titles">${esc(tierTitlesLabel)}</span>
        <input type="text" id="tiermodeinput-titles" value="${esc(tierTitlesLabel)}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTierModeEdit('titles')">✎</button>
      </div>
    `;
}

function toggleTierModeEdit(id) {
  const row = document.getElementById(`tiermoderow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`tiermodeinput-${id}`).value.trim();
    tierTitlesLabel = val || i18n("Тайтлы");
    document.getElementById(`tiermodename-${id}`).textContent = tierTitlesLabel;
  }
}

// ── Разделы вкладки «Любимое» ──────────────────
// Три встроенных раздела: у "Тайтлы" свой источник (reviews.json,
// флаг favorite), у "Персонажи"/"Персоны" — favorites.json по type.
// Список фиксированный: завести четвёртый встроенный неоткуда, свои
// разделы заводятся ниже (favCollections).
//
// Удалить встроенный раздел можно, но "удалить" здесь значит убрать
// его с сайта и из этого списка — сами записи в favorites.json лежат
// и никуда не деваются. Раз строку из списка убирает не кнопка
// "скрыть", вернуть её иначе как отсюда было бы нечем — поэтому
// удалённые показываются отдельной строкой со стрелкой возврата.
const FAV_SECTIONS = [
  { key: "favTitles", def: i18n("Тайтлы") },
  { key: "favCharacters", def: i18n("Персонажи") },
  { key: "favPersons", def: i18n("Персоны") },
];
let favSectionLabels = {};
let hiddenFavSectionsState = new Set();
let removedFavSections = new Set();

function renderFavSectionsList() {
  const container = document.getElementById("favSectionsList");
  const rows = FAV_SECTIONS.filter((s) => !removedFavSections.has(s.key))
    .map((s) => {
      const label = favSectionLabels[s.key] || s.def;
      return `
      <div class="tab-row" id="favsecrow-${s.key}">
        ${eyeButton(hiddenFavSectionsState.has(s.key), `hiddenFavSectionsState.has('${s.key}') ? hiddenFavSectionsState.delete('${s.key}') : hiddenFavSectionsState.add('${s.key}'); renderFavSectionsList();`)}
        <span class="tab-name" id="favsecname-${s.key}">${esc(label)}</span>
        <input type="text" id="favsecinput-${s.key}" value="${esc(label)}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleFavSecEdit('${s.key}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeFavSection('${s.key}')">✕</button>
      </div>`;
    })
    .join("");

  const gone = FAV_SECTIONS.filter((s) => removedFavSections.has(s.key));
  const restore = gone.length
    ? `
      <div class="fav-restore">
        Удалённые разделы:
        ${gone
          .map(
            (s) => `<button type="button" class="fav-restore-btn"
            onclick="restoreFavSection('${s.key}')">${esc(favSectionLabels[s.key] || s.def)} ↺</button>`
          )
          .join("")}
      </div>`
    : "";

  container.innerHTML = rows + restore;
}

async function removeFavSection(key) {
  const def = FAV_SECTIONS.find((s) => s.key === key);
  const label = favSectionLabels[key] || def.def;
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
  removedFavSections.add(key);
  hiddenFavSectionsState.add(key);
  renderFavSectionsList();
}

function restoreFavSection(key) {
  removedFavSections.delete(key);
  hiddenFavSectionsState.delete(key);
  renderFavSectionsList();
}

function toggleFavSecEdit(key) {
  const row = document.getElementById(`favsecrow-${key}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`favsecinput-${key}`).value.trim();
    const def = FAV_SECTIONS.find((s) => s.key === key).def;
    favSectionLabels[key] = val || def;
    document.getElementById(`favsecname-${key}`).textContent = favSectionLabels[key];
  }
}

// ── Свои разделы «Любимого» — в отличие от FAV_SECTIONS это не
// фиксированный список: их заводят по кнопке, у каждого есть галочка
// (скрыть) и удаление, как у коллекций тир-листа. Данные записей
// живут в favorites.json с type = id раздела — своей папки с
// картинками, в отличие от тир-листа, у них нет, поэтому создание
// проще: не нужен модальный шаг с загрузкой.
let favCollections = [];

function renderFavCollectionsList() {
  const container = document.getElementById("favCollectionsList");
  container.innerHTML = favCollections
    .map(
      (c) => `
      <div class="tab-row" id="favcollrow-${c.id}">
        ${eyeButton(hiddenFavSectionsState.has(c.id), `hiddenFavSectionsState.has('${c.id}') ? hiddenFavSectionsState.delete('${c.id}') : hiddenFavSectionsState.add('${c.id}'); renderFavCollectionsList();`)}
        <span class="tab-name" id="favcollname-${c.id}">${esc(c.label)}</span>
        <input type="text" id="favcollinput-${c.id}" value="${esc(c.label)}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleFavCollectionEdit('${c.id}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeFavCollection('${c.id}')">✕</button>
      </div>
    `
    )
    .join("");
}

function toggleFavCollectionEdit(id) {
  const row = document.getElementById(`favcollrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`favcollinput-${id}`).value.trim();
    const c = favCollections.find((x) => x.id === id);
    if (c) {
      c.label = val || c.label;
      document.getElementById(`favcollname-${id}`).textContent = c.label;
    }
  }
}

function addFavCollection() {
  const name = document.getElementById("newFavCollectionName").value.trim();
  if (!name) return;
  favCollections.push({ id: slugify(name), label: name });
  document.getElementById("newFavCollectionName").value = "";
  renderFavCollectionsList();
}

async function removeFavCollection(id) {
  if (
    !(await confirmDialog(
      i18n("Удалить раздел? Уже добавленные записи останутся в данных, но перестанут где-либо отображаться.")
    ))
  ) {
    return;
  }
  favCollections = favCollections.filter((c) => c.id !== id);
  hiddenFavSectionsState.delete(id);
  renderFavCollectionsList();
}

// Скрытие коллекций живёт в том же hiddenTierModes, что и у «Тайтлов»:
// на вкладке это один ряд кнопок, и делить его на два разных списка
// настроек было бы враньём про устройство.
//
// Удаление доступно и встроенным «Персонажам». Файл с их тир-листом
// (characters-tier.json) при этом остаётся лежать, как и картинки, —
// поэтому у встроенной коллекции есть строка возврата: заново завести
// её с тем же id из интерфейса нельзя, у новой он был бы с суффиксом.
const BUILTIN_COLLECTION = { id: "characters", label: i18n("Персонажи") };
let removedBuiltinCollection = false;

function renderCollectionsList() {
  const container = document.getElementById("collectionsList");
  const rows = tierCollections
    .map(
      (c) => `
      <div class="tab-row" id="collrow-${c.id}">
        ${eyeButton(hiddenTierModesState.has(c.id), `hiddenTierModesState.has('${c.id}') ? hiddenTierModesState.delete('${c.id}') : hiddenTierModesState.add('${c.id}'); renderCollectionsList();`)}
        <span class="tab-name" id="collname-${c.id}">${esc(c.label)}</span>
        <input type="text" id="collinput-${c.id}" value="${esc(c.label)}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleCollectionEdit('${c.id}')">✎</button>
        <button class="icon-btn" title="${i18n("Удалить")}" onclick="removeCollection('${c.id}')">✕</button>
      </div>
    `
    )
    .join("");

  const restore = removedBuiltinCollection
    ? `
      <div class="fav-restore">
        ${i18n("Удалённые коллекции:")}
        <button type="button" class="fav-restore-btn"
          onclick="restoreBuiltinCollection()">${esc(BUILTIN_COLLECTION.label)} ↺</button>
      </div>`
    : "";

  container.innerHTML = rows + restore;
}

function restoreBuiltinCollection() {
  if (tierCollections.some((c) => c.id === BUILTIN_COLLECTION.id)) return;
  tierCollections.unshift({ ...BUILTIN_COLLECTION });
  hiddenTierModesState.delete(BUILTIN_COLLECTION.id);
  removedBuiltinCollection = false;
  renderCollectionsList();
}

function toggleCollectionEdit(id) {
  const row = document.getElementById(`collrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`collinput-${id}`).value.trim();
    const c = tierCollections.find((x) => x.id === id);
    if (c) {
      c.label = val || c.label;
      document.getElementById(`collname-${id}`).textContent = c.label;
    }
  }
}

function addCollection() {
  const name = document.getElementById("newCollectionName").value.trim();
  if (!name) return;
  tierCollections.push({ id: slugify(name), label: name });
  document.getElementById("newCollectionName").value = "";
  renderCollectionsList();
}

async function removeCollection(id) {
  const c = tierCollections.find((x) => x.id === id);
  const label = c ? c.label : id;
  const file = id === "characters" ? "characters-tier.json" : `tier-${id}.json`;
  if (
    !(await confirmDialog(
      i18n(
        "Удалить коллекцию «{name}»?\n\nСам тир-лист останется лежать в {file}, вместе с картинками, — пропадёт только кнопка на вкладке.",
        { name: label, file }
      )
    ))
  ) {
    return;
  }
  tierCollections = tierCollections.filter((x) => x.id !== id);
  hiddenTierModesState.delete(id);
  if (id === BUILTIN_COLLECTION.id) removedBuiltinCollection = true;
  renderCollectionsList();
}

// Список тем берётся из реестра в js/theme.js. Раньше здесь лежала
// своя копия — и она успела разъехаться: темы «Мягкий ботанический»
// в ней не было вовсе, то есть выбрать её из настроек было нельзя.
const THEMES = typeof themeOptions === "function" ? themeOptions() : [];

// Размер шрифта — см. её же комментарий в разметке выше и в
// style.css (--text-scale). markDirty=false — только для начальной
// загрузки из loadCurrentSettings(), где значение просто отражает то,
// что уже сохранено, а не правку человека.
let textScale = 100;

function applyTextScale(percent, markDirty) {
  percent = Math.min(150, Math.max(80, Number(percent) || 100));
  textScale = percent;
  const slider = document.getElementById("text-scale-slider");
  const label = document.getElementById("text-scale-value");
  if (slider) slider.value = percent;
  if (label) label.textContent = percent + "%";
  document.documentElement.style.setProperty("--text-scale", percent / 100, "important");
  if (markDirty) settingsDirty = true;
}

let selectedTheme = "classic";

// Свои цвета по темам: { skin: { "--bg": "#…", accent: "#…" } }.
// Отдельно для каждой темы — палитра, подогнанная под тёмную, на
// светлой выглядела бы случайным набором.
let themeColors = {};

// Тёмная/светлая пара живёт под одним базовым id (soft/soft-dark,
// classic/classic-light…) — группируем по нему, а не по общему
// списку, иначе десять пилюль в ряд плохо читаются. Какая из двух
// тёмная, а какая светлая — смотрим по-настоящему в themes.css
// (color-scheme), а не угадываем по суффиксу: он у разных пар стоит
// на разных сторонах (у классической светлая — новая, суффикс у
// неё; у остальных наоборот, суффикс у тёмной).
function themeIsDark(skin) {
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    if (sheet.ownerNode && sheet.ownerNode.id === "theme-overrides") continue;
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      const sel = rule.selectorText.replace(/\s+/g, "");
      if (sel === `[data-skin="${skin}"]` || sel === `html[data-skin="${skin}"]`) {
        const cs = rule.style.getPropertyValue("color-scheme").trim();
        if (cs) return cs === "dark";
      }
    }
  }
  return false;
}

function themeGroups() {
  const groups = {};
  for (const t of THEMES) {
    const key = t.id.replace(/-dark$|-light$/, "");
    const g = (groups[key] = groups[key] || { key, label: null, light: null, dark: null });
    if (!/-dark$|-light$/.test(t.id)) g.label = t.label;
    if (themeIsDark(t.id)) g.dark = t;
    else g.light = t;
  }
  return Object.values(groups);
}

let openThemeGroup = null;

function renderThemeGrid() {
  const grid = document.getElementById("themeGrid");
  const groups = themeGroups();
  grid.innerHTML = groups
    .map((g) => {
      const active = [g.light, g.dark].find((v) => v && v.id === selectedTheme);
      const mode = active ? (g.dark && active.id === g.dark.id ? " — тёмная" : i18n(" — светлая")) : "";
      return `<div class="theme-group">
        <div class="theme-option${active ? " selected" : ""}" data-group="${g.key}">${g.label}${mode}</div>
        <div class="theme-popover hidden" id="popover-${g.key}">
          ${g.light ? `<button type="button" class="${g.light.id === selectedTheme ? "current" : ""}" data-theme="${g.light.id}">${i18n("Светлая")}</button>` : ""}
          ${g.dark ? `<button type="button" class="${g.dark.id === selectedTheme ? "current" : ""}" data-theme="${g.dark.id}">${i18n("Тёмная")}</button>` : ""}
        </div>
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".theme-option").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const key = el.dataset.group;
      openThemeGroup = openThemeGroup === key ? null : key;
      grid.querySelectorAll(".theme-popover").forEach((p) => {
        p.classList.toggle("hidden", p.id !== `popover-${openThemeGroup}`);
      });
    };
  });
  grid.querySelectorAll(".theme-popover button").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      selectedTheme = btn.dataset.theme;
      openThemeGroup = null;
      renderThemeGrid();
      renderPalette();
      previewPalette();
    };
  });
}

// ── Палитра темы ─────────────────────────────
// Цвета темы по умолчанию читаем прямо из подключённых стилей:
// :root в style.css плюс блок [data-skin="…"] в themes.css. Так
// список не приходится дублировать здесь — а именно из-за такой
// копии список тем однажды уже разъехался с реестром.
function themeDefaults(skin) {
  const base = {};
  const themed = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;
    // Стиль, который theme.js дописывает в <head>, — это уже
    // применённые переопределения, а не значения темы.
    if (sheet.ownerNode && sheet.ownerNode.id === "theme-overrides") continue;
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      const sel = rule.selectorText.replace(/\s+/g, "");
      const target =
        sel === ":root"
          ? base
          : sel === `[data-skin="${skin}"]` || sel === `html[data-skin="${skin}"]`
            ? themed
            : null;
      if (!target) continue;
      for (const { key } of PALETTE_TOKENS) {
        const value = rule.style.getPropertyValue(key).trim();
        if (value) target[key] = value;
      }
    }
  }
  const out = { ...base, ...themed };
  out.accent = (THEME_PRESETS[skin] && THEME_PRESETS[skin].defaultAccent) || DEFAULT_ACCENT;
  return out;
}

const PALETTE_ROWS = [
  ...PALETTE_TOKENS,
  { key: "accent", label: i18n("Акцент"), hint: i18n("Активные кнопки, ссылки, подсветки") },
];

function renderPalette() {
  const defaults = themeDefaults(selectedTheme);
  const own = themeColors[selectedTheme] || {};
  const box = document.getElementById("paletteList");
  box.innerHTML = PALETTE_ROWS.map((t) => {
    const custom = own[t.key];
    return `<div class="pal-row">
        <input type="color" data-token="${t.key}" value="${custom || defaults[t.key] || "#000000"}">
        <div class="pal-text">
          <div class="pal-name">${t.label}</div>
          <div class="pal-hint">${t.hint}</div>
        </div>
        <button type="button" class="pal-reset" data-reset="${t.key}"${custom ? "" : " hidden"}>${i18n("Цвет темы")}</button>
      </div>`;
  }).join("");

  box.querySelectorAll('input[type="color"]').forEach((input) => {
    input.oninput = () => {
      (themeColors[selectedTheme] = themeColors[selectedTheme] || {})[input.dataset.token] = input.value;
      box.querySelector(`[data-reset="${input.dataset.token}"]`).hidden = false;
      previewPalette();
    };
  });
  box.querySelectorAll(".pal-reset").forEach((btn) => {
    btn.onclick = () => {
      if (themeColors[selectedTheme]) delete themeColors[selectedTheme][btn.dataset.reset];
      renderPalette();
      previewPalette();
    };
  });
}

function resetPalette() {
  delete themeColors[selectedTheme];
  renderPalette();
  previewPalette();
}

// Предпросмотр прямо в открытом приложении: инлайновый стиль на <html>
// перебивает и тему, и переопределения из theme.js. Откат при уходе с
// маршрута — revertPalettePreview() выше.
function previewPalette() {
  // Выбор темы/цвета — это клик по кнопке, а не input/change, и
  // делегированный слушатель на #app его не ловит: взводим флаг
  // «есть несохранённое» здесь, там же, где меняется состояние.
  // Раньше это делала обёртка поверх previewPalette в конце файла —
  // тот же эффект, только без переприсваивания функции.
  settingsDirty = true;

  const root = document.documentElement;
  root.setAttribute("data-skin", selectedTheme);
  const own = themeColors[selectedTheme] || {};
  // "important" третьим аргументом — не для красоты: #theme-overrides
  // (theme.js) теперь тоже пишет свои переменные с !important (см. её
  // же комментарий), а обычный инлайн-стиль !important в стилевом
  // блоке не перебивает. Без этого живой предпросмотр здесь просто
  // переставал бы что-либо менять на глаз, стоило странице загрузиться
  // не с чистого кэша.
  for (const { key } of PALETTE_TOKENS) {
    if (own[key]) root.style.setProperty(key, own[key], "important");
    else root.style.removeProperty(key);
  }
  const accent = own.accent || themeDefaults(selectedTheme).accent;
  for (const [key, value] of Object.entries(accentVariants(accent))) {
    root.style.setProperty(key, value, "important");
  }

  // В приложении рамку окна красит Electron, а не CSS — сам он не
  // узнает про смену темы без перезагрузки страницы. Запрос молча
  // проваливается на обычном сайте, где этого адреса нет, — и это
  // нормально, там красить нечего.
  const cs = getComputedStyle(root);
  fetch("/api/app/set-titlebar-colors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bg: cs.getPropertyValue("--bg").trim(),
      symbol: cs.getPropertyValue("--text-dim").trim(),
    }),
  }).catch(() => {});
}

// ── Настройки приложения ───────────────────────
// Всё здесь идёт через /api/app/*: страница в песочнице и до системы
// сама дотянуться не может. На сайте этих адресов нет, поэтому панель
// и не показывается — проверяем одним запросом при монтировании.
let appInfo = null;

async function appApi(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

async function detectApp() {
  try {
    appInfo = await appApi("/api/app/info");
    document.getElementById("tab-app").classList.remove("hidden");
    document.getElementById("tab-vaults").classList.remove("hidden");
    // Синхронизация ходит в /api/export-backup и /api/restore-backup —
    // они есть у приложения (core/api.js), но не у голого сайта.
    document.getElementById("tab-sync").classList.remove("hidden");
  } catch {
    // Обычный браузер — панелей приложения просто нет.
  }
}

function zoomPercent(percent) {
  return Math.round(percent) + "%";
}

function renderAppPanel() {
  if (!appInfo) return;
  const langSel = document.getElementById("app-lang");
  if (langSel && !langSel.options.length) {
    langSel.innerHTML = Object.entries(I18N_LANGS)
      .map(([code, name]) => `<option value="${code}"${code === I18N_CURRENT ? " selected" : ""}>${name}</option>`)
      .join("");
  }
  document.getElementById("app-vault-path").textContent = appInfo.vaultPath || i18n("не выбрана");
  document.getElementById("app-zoom-value").textContent = zoomPercent(appInfo.zoom || 100);
  document.getElementById("app-zoom-slider").value = appInfo.zoom || 100;
  document.getElementById("app-version").textContent = `TasteID ${appInfo.version || ""} · ${appInfo.platform || ""}`;

  // На телефоне нет ни проводника, ни понятия масштаба окна — вместо
  // неработающих кнопок показываем то, что там правда можно сделать.
  document.getElementById("app-vault-actions").classList.toggle("hidden", !!appInfo.mobile);
  document.getElementById("app-vault-mobile-note").classList.toggle("hidden", !appInfo.mobile);
  document.getElementById("app-zoom-section").classList.toggle("hidden", !!appInfo.mobile);
}

// На макбуке и в мобильном банере обновление показывает себя само,
// если найдено, — здесь только статус для случаев, когда нечего
// показывать (уже последняя версия) или уже показано (диалог/банер
// всплыл отдельно, поверх этой же страницы).
async function checkForUpdateNow() {
  const btn = document.getElementById("btn-check-update");
  if (btn) btn.disabled = true;
  flashStatus("status-update", true, i18n("Проверяем…"));
  try {
    const data = await appApi("/api/app/check-update", {});
    if (data.status === "latest") flashStatus("status-update", true, i18n("У тебя последняя версия."));
    else if (data.status === "error") flashStatus("status-update", false, i18n("Не удалось проверить обновления."));
    // «Качается» — самый частый случай успеха, и раньше он показывал
    // пустую строку: человек жал кнопку и не получал вообще никакой
    // реакции, хотя обновление уже нашлось.
    else if (data.status === "downloading")
      flashStatus(
        "status-update",
        true,
        i18n("Найдена версия {v} — качаем, предложим установить.", { v: data.version || "" })
      );
    else if (data.status === "dev")
      flashStatus("status-update", true, i18n("Запущено из исходников — обновления не проверяются."));
    else flashStatus("status-update", true, "");
  } catch (e) {
    flashStatus("status-update", false, e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Панель «Хранилища» ─────────────────────────
// Список {id, name} приходит из appInfo (тот же /api/app/info, что
// уже дёргает detectApp()) — отдельного запроса не нужно, разве что
// appInfo ещё не готов при самом первом клике по вкладке.
//
// На компьютере «Добавить» — это выбор папки: новой или уже
// существующей (например, скопированной с другого устройства
// вручную). На телефоне выбирать нечего — там только имя, а папку
// заводит сама MobileVault.
async function renderVaultsPanel() {
  const box = document.getElementById("vaultsPanel");
  try {
    if (!appInfo) appInfo = await appApi("/api/app/info");
    box.innerHTML = `
        <p class="panel-intro" data-i18n>
          Несколько независимых хранилищ на одном устройстве — со своими
          отзывами, тир-листами и синхронизацией у каждого. Переключение
          между ними ничего не стирает: данные остаются каждое в своей
          папке.
        </p>
        <div id="vaultsList"></div>
        <div class="row" id="vaults-add-desktop" style="gap:10px;flex-wrap:wrap;margin-top:14px;">
          <button class="btn btn-ghost" onclick="addVault('new')" data-i18n>Создать новое хранилище…</button>
          <button class="btn btn-ghost" onclick="addVault('open')" data-i18n>Открыть существующее…</button>
        </div>
        <div class="row hidden" id="vaults-add-mobile" style="gap:10px;flex-wrap:wrap;margin-top:14px;">
          <button class="btn btn-ghost" onclick="addVault('mobile')" data-i18n>Добавить хранилище…</button>
        </div>
        <div class="status-msg" id="status-vaults"></div>
      `;
    document.getElementById("vaults-add-desktop").classList.toggle("hidden", !!appInfo.mobile);
    document.getElementById("vaults-add-mobile").classList.toggle("hidden", !appInfo.mobile);
    applyI18n(box);
    renderVaultsList();
  } catch (e) {
    box.innerHTML = `<p class="panel-intro">${esc(e.message)}</p>`;
  }
}

function renderVaultsList() {
  const list = document.getElementById("vaultsList");
  const vaults = appInfo.vaults || [];
  const currentId = appInfo.currentVaultId;
  list.innerHTML = vaults
    .map(
      (v) => `
      <div class="tab-row" id="vaultrow-${v.id}">
        <span class="tab-name" id="vaultname-${v.id}">${esc(v.name)}</span>
        <input type="text" id="vaultinput-${v.id}" value="${esc(v.name)}">
        ${
          v.id === currentId
            ? `<span class="vault-current" data-i18n>текущее</span>`
            : `<button class="btn btn-ghost" onclick="switchVault('${v.id}')" data-i18n>Открыть</button>`
        }
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleVaultEdit('${v.id}')">✎</button>
        ${
          v.id !== currentId
            ? `<button class="icon-btn" title="${i18n("Убрать из списка")}" onclick="removeVault('${v.id}')">✕</button>`
            : ""
        }
      </div>
    `
    )
    .join("");
  applyI18n(list);
}

async function toggleVaultEdit(id) {
  const row = document.getElementById(`vaultrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (editing) {
    const input = document.getElementById(`vaultinput-${id}`);
    input.focus();
    input.select();
    return;
  }
  const val = document.getElementById(`vaultinput-${id}`).value.trim();
  if (!val) {
    renderVaultsList();
    return;
  }
  try {
    await appApi("/api/app/rename-vault", { id, name: val });
    appInfo.vaults = (appInfo.vaults || []).map((v) => (v.id === id ? { ...v, name: val } : v));
    document.getElementById(`vaultname-${id}`).textContent = val;
  } catch (e) {
    flashStatus("status-vaults", false, e.message);
    renderVaultsList();
  }
}

// Переключение перечитывает reviews.json, favorites.json и всё
// остальное с нуля — как и при «Сменить папку» на прошлой версии
// этой вкладки, проще и надёжнее перезагрузить страницу, чем гонять
// все панели вручную по новой. Хэш #/settings-edit при этом остаётся
// в адресе, так что после перезагрузки открываются те же настройки.
async function switchVault(id) {
  try {
    await appApi("/api/app/switch-vault", { id });
    location.reload();
  } catch (e) {
    flashStatus("status-vaults", false, e.message);
  }
}

async function addVault(mode) {
  try {
    let path;
    // promptDialog, а не window.prompt: в Electron последнего просто
    // нет — вызов бросает «prompt() is not supported.», то есть на
    // компьютере обе кнопки заканчивались ошибкой, а хранилище так и
    // не заводилось (см. js/utils.js).
    if (mode === "mobile") {
      const name = await promptDialog(i18n("Имя нового хранилища:"), i18n("Новое хранилище"));
      if (name === null) return; // отмена
      await appApi("/api/app/add-vault", { name: name.trim() });
    } else {
      const picked = await appApi("/api/app/pick-vault", { mode });
      if (!picked.path) return; // отмена в системном диалоге выбора папки
      path = picked.path;
      const suggested = path.split(/[\\/]/).filter(Boolean).pop() || i18n("Хранилище");
      const name = await promptDialog(i18n("Имя для этого хранилища:"), suggested);
      if (name === null) return;
      await appApi("/api/app/use-vault", { path, name: name.trim() });
    }
    location.reload();
  } catch (e) {
    flashStatus("status-vaults", false, e.message);
  }
}

// Из списка можно убрать только не-текущее хранилище (кнопка вообще
// не показывается у активного) — предупреждение разное для
// компьютера и телефона, потому что и последствия разные: на
// компьютере папка остаётся на диске и её можно открыть заново
// через «Открыть существующее», на телефоне отдельной папки для
// не-default хранилища больше не будет вообще.
async function removeVault(id) {
  const warn = appInfo.mobile
    ? i18n("Хранилище и все его данные будут стёрты с телефона. Продолжить?")
    : i18n(
        "Хранилище будет убрано из списка. Сама папка на диске никуда не денется — её можно будет открыть заново через «Открыть существующее»."
      );
  // confirmDialog, а не window.confirm: та же коробка в теме
  // приложения, что и у остальных подтверждений (js/utils.js).
  if (!(await confirmDialog(warn, i18n("Убрать")))) return;
  try {
    await appApi("/api/app/remove-vault", { id });
    appInfo.vaults = (appInfo.vaults || []).filter((v) => v.id !== id);
    renderVaultsList();
  } catch (e) {
    flashStatus("status-vaults", false, e.message);
  }
}

async function loadAppPanel() {
  try {
    appInfo = await appApi("/api/app/info");
  } catch {}
  renderAppPanel();
}

// Применять масштаб на каждое перемещение ползунка казалось удобным,
// но вышло наоборот: сам интерфейс (в том числе ползунок) едет вместе
// с масштабом прямо под курсором, и попасть в нужное значение труднее,
// а не легче. Цифра рядом обновляется вживую (input), а сам масштаб —
// только когда отпустили (change).
function previewZoom(percent) {
  document.getElementById("app-zoom-value").textContent = zoomPercent(Number(percent));
}

async function setZoom(percent) {
  try {
    const { zoom } = await appApi("/api/app/zoom", { percent: Number(percent) });
    appInfo.zoom = zoom;
    renderAppPanel();
  } catch (e) {
    flashStatus("status-app", false, e.message);
  }
}

async function openVaultFolder() {
  try {
    await appApi("/api/app/open-vault-folder", {});
  } catch (e) {
    flashStatus("status-app", false, e.message);
  }
}

async function changeVault() {
  try {
    const { path } = await appApi("/api/app/pick-vault", { mode: "open" });
    if (!path) return;
    await appApi("/api/app/use-vault", { path });
    // Перезагружаемся: на экране лежат настройки прошлой папки, и
    // сохранение поверх новой затёрло бы её своими.
    location.reload();
  } catch (e) {
    flashStatus("status-app", false, e.message);
  }
}

// ── Резервная копия ─────────────────────────────
// Не путать с «Паспортом»: тот — урезанный слепок для показа чужим,
// этот — всё целиком и только для себя (core/api.js: exportBackup /
// restoreBackup, там же расписано подробнее).
async function exportBackup() {
  try {
    const res = await fetch("/api/export-backup");
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Ошибка ${res.status}`);

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasteid-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    flashStatus("status-backup", false, e.message);
  }
}

async function restoreBackup(input) {
  const file = input.files?.[0];
  input.value = ""; // тот же файл ещё раз выбрать иначе не получится — onchange не сработает
  if (!file) return;

  if (
    !(await confirmDialog(
      i18n(
        "Текущие отзывы, любимое, тир-листы и настройки будут заменены содержимым файла. Отменить это можно только другой резервной копией. Продолжить?"
      ),
      i18n("Восстановить")
    ))
  ) {
    return;
  }

  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(i18n("Это не похоже на файл резервной копии — внутри не JSON."));
    }
    const res = await fetch("/api/restore-backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || `Ошибка ${res.status}`);

    flashStatus("status-backup", true, i18n("Восстановлено. Обновляем страницу…"));
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    flashStatus("status-backup", false, e.message);
  }
}

// ── Синхронизация ────────────────────────────
// Вся логика, включая автосинхронизацию в фоне, — в app/js/sync.js,
// здесь только экран: две панели, «не подключено» и «подключено», и
// разбор конфликтов, если они есть. syncInFlight — общий с
// автосинхронизацией флаг (объявлен в sync.js): не дать ручной кнопке
// и подоспевшему фоновому запуску столкнуться на одном и том же пути.

function renderSyncPanel() {
  const box = document.getElementById("syncPanel");
  const config = getSyncConfig();
  box.innerHTML = config ? syncConnectedHtml(config) : syncSetupHtml();
  applyI18n(box);
  // Конфликт, найденный автосинхронизацией, мог случиться, пока
  // человек не смотрел на эту вкладку вовсе — открыв её, сразу
  // досчитываем ещё раз и показываем, что не так, а не заставляем
  // сперва самому нажать «Синхронизировать сейчас».
  if (config && localStorage.getItem(AUTOSYNC_CONFLICTS_KEY) === "1") startSync();
}

function syncSetupHtml() {
  return `
      <p class="sync-intro" data-i18n>
        Свободно и без своего сервера: приватный репозиторий на GitHub
        как общее хранилище для всех твоих устройств — телефона,
        компьютера, ещё одного компьютера. GitHub здесь единственный
        сервер, а токен и служебные данные синхронизации остаются
        только на этом устройстве.
      </p>
      <p class="sync-intro" data-i18n>
        После подключения синхронизация запускается сама — через
        какое-то время после того, как что-то сохранено, и при открытии
        приложения. Кнопка «Синхронизировать сейчас» останется — на
        случай, если не хочется ждать.
      </p>
      <ol class="sync-intro" style="padding-left:1.2em;display:flex;flex-direction:column;gap:.5em;">
        <li data-i18n>Заведи аккаунт на github.com, если его ещё нет — бесплатно.</li>
        <li>
          <span data-i18n>Создай токен доступа —</span>
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=TasteID" target="_blank" rel="noopener" data-i18n>по этой ссылке</a><span data-i18n>, галочка «repo» уже отмечена. Внизу страницы — «Generate token».</span>
        </li>
        <li data-i18n>Скопируй токен (он показывается один раз) и вставь сюда.</li>
      </ol>
      <div class="field">
        <label data-i18n>Токен доступа</label>
        <input type="password" id="sync-token" placeholder="ghp_…" autocomplete="off">
      </div>
      <div class="field">
        <label data-i18n>Название репозитория</label>
        <input type="text" id="sync-repo" value="tasteid-vault">
        <p class="panel-intro" data-i18n>
          Если такого репозитория ещё нет на твоём GitHub — создадим
          сами, приватным. Если уже есть (например, второе устройство
          его уже завело) — подключимся к нему.
        </p>
      </div>
      <button class="btn btn-primary" onclick="connectSync()" id="sync-connect-btn" data-i18n>Подключить</button>
      <div class="status-msg" id="status-sync"></div>
    `;
}

function syncConnectedHtml(config) {
  const state = getSyncState();
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString(dateLocale()) : i18n("ещё не было");
  return `
      <p class="panel-intro">
        ${i18n("Подключено к")}
        <a href="https://github.com/${esc(config.owner)}/${esc(config.repo)}" target="_blank" rel="noopener">${esc(config.owner)}/${esc(config.repo)}</a>.
        ${i18n("Последняя синхронизация: {when}.", { when: last })}
      </p>
      <div class="row" style="gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="startSync()" id="sync-now-btn" data-i18n>Синхронизировать сейчас</button>
        <button class="btn btn-ghost" onclick="disconnectSync()" data-i18n>Отключить</button>
      </div>
      <div class="status-msg" id="status-sync"></div>
      <div id="sync-progress"></div>
      <div id="sync-conflicts"></div>
    `;
}

async function connectSync() {
  const btn = document.getElementById("sync-connect-btn");
  const token = document.getElementById("sync-token").value.trim();
  const repo = document.getElementById("sync-repo").value.trim();
  if (!token || !repo) {
    flashStatus("status-sync", false, i18n("Заполни токен и название репозитория."));
    return;
  }

  btn.disabled = true;
  flashStatus("status-sync", true, i18n("Проверяем токен…"));
  try {
    const user = await checkGithubUser(token);
    const config = { token, owner: user.login, repo };

    flashStatus("status-sync", true, i18n("Проверяем репозиторий…"));
    if (!(await repoExists(config))) {
      flashStatus("status-sync", true, i18n("Репозитория ещё нет — создаём…"));
      await createRepo(config);
    }

    saveSyncConfig(config);
    renderSyncPanel();
  } catch (e) {
    flashStatus("status-sync", false, e.message);
  } finally {
    btn.disabled = false;
  }
}

async function disconnectSync() {
  if (
    !(await confirmDialog(
      i18n(
        "Приложение забудет токен и репозиторий на этом устройстве. Сами данные — здесь и в репозитории — никуда не денутся, подключиться заново можно в любой момент."
      ),
      i18n("Отключить")
    ))
  ) {
    return;
  }
  clearSyncConfig();
  renderSyncPanel();
}

async function startSync() {
  if (syncInFlight) return;
  syncInFlight = true;
  const btn = document.getElementById("sync-now-btn");
  btn.disabled = true;
  document.getElementById("sync-conflicts").innerHTML = "";
  flashStatus("status-sync", true, i18n("Синхронизируем…"));

  try {
    const config = getSyncConfig();
    const result = await runSync(config, (done, total, path) => {
      document.getElementById("sync-progress").textContent = `${done} / ${total}: ${path}`;
    });
    document.getElementById("sync-progress").textContent = "";

    // Забранные файлы и картинки записываем тем же путём, что и
    // резервную копию, — restoreBackup трогает только то, что
    // передано, остальные файлы хранилища не затронет.
    if (Object.keys(result.pulledFiles).length || Object.keys(result.pulledImages).length) {
      await fetch("/api/restore-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: "tasteid-backup",
          files: result.pulledFiles,
          images: result.pulledImages,
        }),
      });
    }

    if (result.conflicts.length) {
      flashStatus(
        "status-sync",
        false,
        i18n("Готово, но {n} файл(ов) изменились и здесь, и в репозитории — выбери, что оставить.", {
          n: result.conflicts.length,
        })
      );
      renderConflicts(config, result.conflicts);
    } else {
      // Сперва перерисовать («последняя синхронизация» обновится),
      // потом показать статус — иначе renderSyncPanel() тут же стирает
      // status-sync вместе со всей панелью, и человек не успевает
      // увидеть «Готово» ни на миг.
      renderSyncPanel();
      flashStatus(
        "status-sync",
        true,
        i18n("Готово: отправлено {pushed}, забрано {pulled}, без изменений {skipped}.", result)
      );
    }

    if (Object.keys(result.pulledFiles).length || Object.keys(result.pulledImages).length) {
      setTimeout(() => location.reload(), 1200);
    }
  } catch (e) {
    flashStatus("status-sync", false, e.message);
  } finally {
    syncInFlight = false;
    if (document.getElementById("sync-now-btn")) document.getElementById("sync-now-btn").disabled = false;
  }
}

function renderConflicts(config, conflicts) {
  const box = document.getElementById("sync-conflicts");
  box.innerHTML = conflicts
    .map(
      (c, i) => `
        <div class="edit-banner" style="flex-direction:column;align-items:stretch;gap:.6rem;">
          <div class="edit-banner-title">${esc(c.path)}</div>
          <div class="row" style="gap:10px;">
            <button class="btn btn-ghost" onclick="pickConflict(${i}, 'local')">${i18n("Оставить моё")}</button>
            <button class="btn btn-ghost" onclick="pickConflict(${i}, 'remote')">${i18n("Взять оттуда")}</button>
          </div>
        </div>`
    )
    .join("");
  window.__syncConflicts = conflicts;
  window.__syncConfig = config;
}

async function pickConflict(index, choice) {
  const conflict = window.__syncConflicts[index];
  try {
    const remoteValue = await resolveConflict(window.__syncConfig, conflict, choice);
    if (choice === "remote") {
      const payload =
        conflict.kind === "images"
          ? { images: { [conflict.path]: remoteValue } }
          : { files: { [conflict.path]: remoteValue } };
      await fetch("/api/restore-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "tasteid-backup", ...payload }),
      });
    }
    window.__syncConflicts.splice(index, 1);
    if (window.__syncConflicts.length) {
      renderConflicts(window.__syncConfig, window.__syncConflicts);
    } else {
      document.getElementById("sync-conflicts").innerHTML = "";
      localStorage.setItem(AUTOSYNC_CONFLICTS_KEY, "");
      flashStatus("status-sync", true, i18n("Конфликты решены."));
      if (choice === "remote") setTimeout(() => location.reload(), 900);
    }
  } catch (e) {
    flashStatus("status-sync", false, e.message);
  }
}

const TAB_DEFS = [
  { id: "now", def: i18n("Статусы") },
  { id: "favorites", def: i18n("Любимое") },
  { id: "reviews", def: i18n("Отзывы") },
  { id: "stats", def: i18n("Статистика") },
  { id: "tierlist", def: i18n("Тир-лист") },
];
const TAB_DEFS_BY_ID = Object.fromEntries(TAB_DEFS.map((t) => [t.id, t]));
let tabLabels = {};
let hiddenTabsState = new Set();
let tabOrderState = TAB_DEFS.map((t) => t.id); // порядок id вкладок
let mainTabState = "now"; // какая вкладка открывается первой

function renderTabsList() {
  const container = document.getElementById("tabsList");
  container.innerHTML = tabOrderState
    .map((id) => {
      const def = TAB_DEFS_BY_ID[id];
      if (!def) return "";
      return `
      <div class="tab-row" id="tabrow-${id}" data-id="${id}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenTabsState.has(id), `hiddenTabsState.has('${id}') ? hiddenTabsState.delete('${id}') : hiddenTabsState.add('${id}'); renderTabsList();`)}
        <span class="tab-name" id="tabname-${id}">${tabLabels[id] || def.def}</span>
        <input type="text" id="tabinput-${id}" value="${tabLabels[id] || def.def}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTabEdit('${id}')">✎</button>
        <label class="main-radio-label" title="${i18n("Открывать эту вкладку первой")}">
          <input type="radio" name="mainTabRadio" value="${id}" ${mainTabState === id ? "checked" : ""}
            onchange="mainTabState = '${id}'">
          ${i18n("Главная страница")}
        </label>
      </div>
    `;
    })
    .join("");
  bindTabsDnd();
}

// ── Drag-and-drop порядка вкладок (вертикальный список) ──
let tabDragSrc = null;

function bindTabsDnd() {
  const container = document.getElementById("tabsList");

  container.querySelectorAll(".tab-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      tabDragSrc = row;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("dragging", "drag-over"));
      tabDragSrc = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!tabDragSrc || row === tabDragSrc) return;
      container.querySelectorAll(".tab-row").forEach((el) => el.classList.remove("drag-over"));
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drag-over");
      if (!tabDragSrc || row === tabDragSrc) return;

      const srcId = tabDragSrc.dataset.id;
      const targetId = row.dataset.id;
      const srcIdx = tabOrderState.indexOf(srcId);
      let targetIdx = tabOrderState.indexOf(targetId);
      if (srcIdx === -1 || targetIdx === -1) return;

      // Вставляем перед/после target в зависимости от того, выше или ниже курсор середины строки
      const rect = row.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;

      tabOrderState.splice(srcIdx, 1);
      targetIdx = tabOrderState.indexOf(targetId);
      tabOrderState.splice(before ? targetIdx : targetIdx + 1, 0, srcId);

      renderTabsList();
    });
  });
}

function toggleTabEdit(id) {
  const row = document.getElementById(`tabrow-${id}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`tabinput-${id}`).value.trim();
    const def = TAB_DEFS.find((t) => t.id === id).def;
    tabLabels[id] = val || def;
    document.getElementById(`tabname-${id}`).textContent = tabLabels[id];
  }
}

// ── Статусы ──
let archiveLabel = i18n("Архив");
let statusBuckets = [];
let hiddenStatusesState = new Set();

function renderStatusesList() {
  const container = document.getElementById("statusesList");
  const rows = [...statusBuckets, { key: "archive", label: archiveLabel, removable: false }];
  container.innerHTML = rows
    .map(
      (b) => `
      <div class="tab-row" id="statusrow-${b.key}">
        ${eyeButton(hiddenStatusesState.has(b.key), `hiddenStatusesState.has('${b.key}') ? hiddenStatusesState.delete('${b.key}') : hiddenStatusesState.add('${b.key}'); renderStatusesList();`)}
        <span class="tab-name" id="statusname-${b.key}">${b.label}</span>
        <input type="text" id="statusinput-${b.key}" value="${b.label}">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleStatusEdit('${b.key}')">✎</button>
        ${b.key !== "archive" ? `<button class="icon-btn" title="${i18n("Удалить")}" onclick="removeStatusBucket('${b.key}')">✕</button>` : ""}
      </div>
    `
    )
    .join("");
}

function toggleStatusEdit(key) {
  const row = document.getElementById(`statusrow-${key}`);
  const editing = row.classList.toggle("editing");
  if (!editing) {
    const val = document.getElementById(`statusinput-${key}`).value.trim();
    if (key === "archive") {
      archiveLabel = val || i18n("Архив");
      document.getElementById(`statusname-${key}`).textContent = archiveLabel;
    } else {
      const bucket = statusBuckets.find((b) => b.key === key);
      if (bucket) {
        bucket.label = val || bucket.label;
        document.getElementById(`statusname-${key}`).textContent = bucket.label;
      }
    }
  }
}

function addStatusBucket() {
  const name = document.getElementById("newStatusName").value.trim();
  if (!name) return;
  const key =
    "status_" +
    name
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .slice(0, 30) +
    "_" +
    Date.now().toString(36).slice(-4);
  statusBuckets.push({ key, label: name, removable: true });
  document.getElementById("newStatusName").value = "";
  renderStatusesList();
}

// reviews.json тянем только когда он действительно нужен — в момент
// удаления статуса. Настройки открывают часто, а файл на четверть
// мегабайта; грузить его на каждый заход ради одной цифры незачем.
let reviewsForCount = null;

async function countReviewsByStatus(key) {
  if (!reviewsForCount) {
    const res = await fetch("/reviews.json?_=" + Date.now());
    reviewsForCount = await res.json();
  }
  return reviewsForCount.filter((r) => r.status === key).length;
}

// Удалить статус, которым что-то помечено, — не поломка, но записи
// пропадут со вкладки, и человек об этом должен узнать до, а не после.
// Половина базы вполне может лежать в «Отложено».
async function removeStatusBucket(key) {
  const bucket = statusBuckets.find((b) => b.key === key);
  const label = bucket ? bucket.label : key;

  let used = 0;
  try {
    used = await countReviewsByStatus(key);
  } catch {
    // Не смогли посчитать — спросим без числа, но удалять не мешаем.
  }
  const warn = used
    ? `\n\nВ этом статусе ${used} ${plural(used, [i18n("запись"), i18n("записи"), i18n("записей")])}. Они останутся в данных, но пропадут со вкладки «Статусы», пока им не поставить другой статус.`
    : "";

  if (!(await confirmDialog(i18n("Удалить раздел «{name}»?", { name: label }) + warn))) return;
  statusBuckets = statusBuckets.filter((b) => b.key !== key);
  hiddenStatusesState.delete(key);
  renderStatusesList();
}

// Статус можно завести и из «Импорта», не уходя с разобранного файла
// (js/import.js). Тогда эта панель осталась бы со старым списком, и
// её «Сохранить» затёрло бы только что заведённый статус — поэтому
// импорт зовёт этот хук сразу после записи настроек.
function onStatusBucketsChanged(buckets) {
  statusBuckets = JSON.parse(JSON.stringify(buckets));
  renderStatusesList();
}

const BUILTIN_CAT_DEFAULTS = {
  visual: i18n("Визуал / звук"),
  plot: i18n("Сюжет / нарратив"),
  chars: i18n("Персонажи / мир"),
  special: i18n("Атмосфера / эмоции"),
  genre: i18n("Жанр"),
};
let allCatLabels = { ...BUILTIN_CAT_DEFAULTS }; // ключ -> название (встроенные + свои)
let catColors = {}; // ключ -> hex (необязательно, у встроенных по умолчанию нет)
let customCatKeys = new Set();
let customTags = {};

// Рендер-функции и «+ Добавить» для категорий/тегов убраны вместе с
// панелью «Теги» — то же самое делается инлайн в редакторе отзыва.
// Состояние выше (allCatLabels/catColors/customCatKeys/customTags)
// остаётся: оно подгружается в loadCurrentSettings() и уходит обратно
// в saveSettings() неизменным, чтобы данные не терялись при сохранении
// с любой другой вкладки.

const BUILTIN_TYPE_DEFAULTS = {
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
let typeLabels = {};
let hiddenTypes = new Set();
let customTypeKeys = new Set();
let typePlural = {}; // key -> [1 штука, 2–4 штуки, 5+ штук], только для своих типов

// ── Роли персон (в «Любимом», тип «Персона») ──
const BUILTIN_SUBTYPE_DEFAULTS = {
  actor: i18n("Актёр"),
  director: i18n("Режиссёр"),
  author: i18n("Автор"),
  seiyuu: i18n("Сэйю"),
  artist: i18n("Художник"),
  composer: i18n("Композитор"),
};
let subtypeLabels = {};
let hiddenSubtypes = new Set();
let customSubtypeKeys = new Set();

// Панель «Типы» (типы тайтлов и роли персон) убрана — то же самое
// теперь делается инлайн: типы в редакторе отзыва (#/add), роли в
// редакторе персон (#/favorites-edit), тем же паттерном выпадающего
// списка с добавлением, что и у источников. Состояние выше по-прежнему
// подгружается в loadCurrentSettings() и уходит обратно в saveSettings()
// неизменным, чтобы данные не терялись при сохранении с любой другой
// вкладки.

// ── Горячие клавиши ─────────────────────────────
// Перерисовывает только эту панель — не всю loadCurrentSettings(),
// чтобы перебиндинг клавиши не сбрасывал несохранённые правки на
// соседних вкладках настроек.
function refreshShortcutsPanel() {
  const el = document.getElementById("shortcutsList");
  if (el) el.innerHTML = keyboardShortcutsHtml(true);
}

function refreshTabKeyBindingsPanel() {
  const el = document.getElementById("tabKeyBindingsList");
  if (el) el.innerHTML = tabSwitchBindingsHtml();
}

async function resetShortcutsToDefault() {
  try {
    await patchSiteSettings((settings) => {
      settings.keyBindings = {};
    });
    window.SITE_KEYBINDINGS = {};
    refreshShortcutsPanel();
  } catch (e) {
    backupToastGlobal(e.message, false);
  }
}

// Сырой site-settings.json как он лежит в репозитории. saveSettings()
// строит payload поверх него, а не с нуля: часть настроек добавляется
// из других редакторов (свои источники ссылок, скрытые теги) и этой
// страницей не управляется — без базового объекта они терялись бы при
// любом сохранении отсюда.
let rawSettings = {};

async function loadCurrentSettings() {
  // Через currentSiteSettings (js/config.js), а не напрямую из
  // выложенного файла: сохранение отсюда отправляет весь объект целиком,
  // и прочитанная копия, отставшая на одну выкладку, стёрла бы всё, что
  // изменилось за это время в другой вкладке или с телефона.
  const settings = await currentSiteSettings();
  rawSettings = settings;

  applyTextScale(Number(settings.textScale) || 100, false);

  selectedTheme = settings.theme || "classic";
  themeColors = JSON.parse(JSON.stringify(settings.themeColors || {}));
  // Раньше акцент был один на весь сайт (customAccent) и тянулся за
  // человеком во все темы — в том числе в те, у которых есть свой
  // акцент по умолчанию. Переносим его в палитру текущей темы, но
  // только если своего у неё нет: тот же порядок, что и в theme.js.
  const themeHasOwnAccent = !!(THEME_PRESETS[selectedTheme] || {}).defaultAccent;
  if (settings.customAccent && !themeHasOwnAccent && !(themeColors[selectedTheme] || {}).accent) {
    (themeColors[selectedTheme] = themeColors[selectedTheme] || {}).accent = settings.customAccent;
  }
  renderThemeGrid();
  renderPalette();

  const labels = settings.labels || {};
  renderLabelsPanel(labels);
  // «Подписи» рисует свои заголовки групп только сейчас — сворачиваем
  // и их тоже (см. collapsibleizeSettingsSections()).
  collapsibleizeSettingsSections();
  tabLabels = { ...(labels.nav || {}) };
  hiddenTabsState = new Set(settings.hiddenTabs || []);
  const savedOrder = Array.isArray(settings.tabOrder) ? settings.tabOrder.filter((id) => TAB_DEFS_BY_ID[id]) : [];
  const missing = TAB_DEFS.map((t) => t.id).filter((id) => !savedOrder.includes(id));
  tabOrderState = [...savedOrder, ...missing];
  mainTabState = settings.mainTab && TAB_DEFS_BY_ID[settings.mainTab] ? settings.mainTab : "now";
  renderTabsList();

  tierTitlesLabel = (labels.sections && labels.sections.tierTitles) || i18n("Тайтлы");
  hiddenTierModesState = new Set(settings.hiddenTierModes || []);
  renderTierModesList();

  // Пустой сохранённый список — это «все коллекции удалены», а не
  // «настроек ещё нет»: подставлять сюда встроенную по длине массива
  // значило бы воскрешать её после удаления.
  tierCollections = Array.isArray(settings.tierCollections)
    ? JSON.parse(JSON.stringify(settings.tierCollections))
    : [{ ...BUILTIN_COLLECTION }];
  removedBuiltinCollection = !tierCollections.some((c) => c.id === BUILTIN_COLLECTION.id);
  renderCollectionsList();

  favSectionLabels = {
    favTitles: (labels.sections && labels.sections.favTitles) || i18n("Тайтлы"),
    favCharacters: (labels.sections && labels.sections.favCharacters) || i18n("Персонажи"),
    favPersons: (labels.sections && labels.sections.favPersons) || i18n("Персоны"),
  };
  hiddenFavSectionsState = new Set(settings.hiddenFavSections || []);
  removedFavSections = new Set(settings.removedFavSections || []);
  renderFavSectionsList();

  favCollections = settings.favCollections ? JSON.parse(JSON.stringify(settings.favCollections)) : [];
  renderFavCollectionsList();

  const statuses = labels.statuses || {};
  const builtinDefaults = [
    { key: "current", label: i18n("В процессе"), removable: false },
    { key: "onhold", label: i18n("Отложено"), removable: false },
    { key: "planning", label: i18n("Планирую"), removable: false },
  ];
  statusBuckets = settings.statusBuckets ? JSON.parse(JSON.stringify(settings.statusBuckets)) : builtinDefaults;
  archiveLabel = statuses.archive || i18n("Архив");
  hiddenStatusesState = new Set(settings.hiddenStatuses || []);
  renderStatusesList();

  const gradeScale = settings.gradeScale || null;
  scaleType = gradeScale?.type || "categorical";
  shelves = gradeScale?.shelves ? JSON.parse(JSON.stringify(gradeScale.shelves)) : [];
  document.getElementById("numericMax").value = gradeScale?.numericMax || (scaleType === "stars" ? 5 : 10);
  renderScaleTypeGrid();
  updateScaleBlocks();

  hiddenStatsState = new Set(settings.hiddenStatsBlocks || []);
  renderStatsList();

  typeLabels = { ...BUILTIN_TYPE_DEFAULTS, ...(settings.customTypes || {}) };
  const typeOverrides = labels.types || {};
  for (const [key, val] of Object.entries(typeOverrides)) {
    if (typeLabels[key] !== undefined) typeLabels[key] = val;
  }
  customTypeKeys = new Set(Object.keys(settings.customTypes || {}));
  hiddenTypes = new Set(settings.hiddenTypes || []);
  typePlural = JSON.parse(JSON.stringify(settings.customTypePlural || {}));

  typeColors = { ...(settings.typeColors || {}) };
  renderTypeColorsList();

  refreshShortcutsPanel();
  refreshTabKeyBindingsPanel();

  subtypeLabels = { ...BUILTIN_SUBTYPE_DEFAULTS, ...(settings.customSubtypes || {}) };
  const subtypeOverrides = labels.subtypes || {};
  for (const [key, val] of Object.entries(subtypeOverrides)) {
    if (subtypeLabels[key] !== undefined) subtypeLabels[key] = val;
  }
  customSubtypeKeys = new Set(Object.keys(settings.customSubtypes || {}));
  hiddenSubtypes = new Set(settings.hiddenSubtypes || []);

  const catOverrides = labels.categories || {};
  allCatLabels = { ...BUILTIN_CAT_DEFAULTS };
  for (const [key, label] of Object.entries(catOverrides)) {
    if (allCatLabels[key] !== undefined && label) allCatLabels[key] = label;
  }
  catColors = { ...(settings.categoryColors || {}) };
  customCatKeys = new Set();
  const savedCustomCats = settings.customCategories || {};
  for (const [key, label] of Object.entries(savedCustomCats)) {
    allCatLabels[key] = label;
    customCatKeys.add(key);
  }
  // Панель редактирования тегов/категорий убрана из настроек — то же
  // самое теперь делается инлайн прямо в редакторе отзыва. Состояние
  // выше по-прежнему подгружается и уходит обратно при сохранении
  // неизменным — просто больше не рендерится тут в список.

  customTags = settings.customTags || {};

  // Загрузка настроек ничего не «правит» — но делегированный слушатель
  // на #app видит те же input/change от программного заполнения полей
  // (renderPalette, renderTabsList и т.п. переписывают value). На
  // отдельной странице это было безобидно: флаг взводился до первого
  // взгляда человека и всё равно спрашивал бы только при уходе. Здесь
  // маршрут может открываться и закрываться десятки раз за сессию —
  // снимаем флаг явно, чтобы «уйти и потерять?» не всплывало на ровном
  // месте.
  settingsDirty = false;
}

// ══ ПОДПИСИ ═══════════════════════════════════
// Источник правды — DEFAULT_LABELS из js/theme.js. Панель строится
// по нему: добавили ключ в реестр — поле здесь появилось само,
// отдельно править эту страницу не нужно.
//
// Группы nav и statuses здесь не показываем: у них уже есть свои
// экраны («Вкладки» и «Оценки и статусы»), два места для одного и
// того же только запутали бы. sections — та же история: переехала
// в «Вкладки» (favTitles/favCharacters/favPersons, там же теперь
// видимость) и в «Тир-листы» (tierTitles, рядом с переименованием
// «Персонажи»). empty вообще убрана из редактируемых — это тексты
// «пусто»/«ничего не найдено», для обычного человека не то, что
// стоит настраивать; DEFAULT_LABELS.empty в js/theme.js остаётся
// как есть и продолжает работать, просто без своего поля здесь.
const LABEL_GROUP_TITLES = {
  site: i18n("Шапка сайта"),
  filters: i18n("Фильтры на вкладке «Отзывы»"),
  stats: i18n("Блоки статистики"),
  units: i18n("Единица коллекции (склонение)"),
};

const LABEL_KEY_TITLES = {
  "site.name": i18n("Название вместо TasteID"),
  "site.subtitle": i18n("Подзаголовок под названием"),
  "filters.search": i18n("Поиск"),
  "filters.type": i18n("Тип"),
  "filters.grade": i18n("Оценка"),
  "filters.source": i18n("Ссылки"),
  "filters.tags": i18n("Теги"),
  "filters.all": i18n("Кнопка «все»"),
  "stats.total": i18n("Заголовок общего блока"),
  "stats.completed": i18n("Подпись под числом за год"),
  "stats.types": i18n("Разбивка по типам"),
  "stats.grades": i18n("Блок оценок"),
  "stats.rewatch": i18n("Блок пересмотров"),
  "stats.tags": i18n("Блок тегов"),
  "stats.watchYears": i18n("По годам просмотра"),
  "stats.releaseYears": i18n("По годам выхода"),
  "stats.rewatchOne": i18n("Пересмотров: 1 …"),
  "stats.rewatchFew": i18n("Пересмотров: 2–4 …"),
  "stats.rewatchMany": i18n("Пересмотров: 5+ …"),
  "stats.emptyYear": i18n("За год ничего нет ({year} подставится)"),
  "stats.spotlightOne": i18n("Лучшее за год — одно ({year})"),
  "stats.spotlightMany": i18n("Лучшее за год — несколько ({year})"),
  "units.one": i18n("Одна штука (1 …)"),
  "units.few": i18n("Две-четыре (2 …)"),
  "units.many": i18n("Пять и больше (5 …)"),
};

function renderLabelsPanel(saved) {
  const box = document.getElementById("labelsGroups");
  const defaults = typeof DEFAULT_LABELS === "object" ? DEFAULT_LABELS : {};

  box.innerHTML = Object.entries(LABEL_GROUP_TITLES)
    .filter(([group]) => defaults[group])
    .map(([group, groupTitle]) => {
      const rows = Object.entries(defaults[group])
        .map(([key, fallback]) => {
          const path = `${group}.${key}`;
          const value = saved?.[group]?.[key] || "";
          return `<div style="margin-bottom:10px;">
            <label>${esc(LABEL_KEY_TITLES[path] || key)}</label>
            <input type="text" data-label-path="${esc(path)}"
                   value="${esc(value)}" placeholder="${esc(fallback)}">
          </div>`;
        })
        .join("");
      return `<h2 class="section-h">${esc(groupTitle)}</h2>${rows}`;
    })
    .join("");
}

// Собирает только заполненные поля: пустое означает «значение по
// умолчанию», и записывать его в настройки незачем — иначе при
// будущей смене формулировки по умолчанию она бы не подхватилась.
function collectLabelOverrides() {
  const out = {};
  document.querySelectorAll("[data-label-path]").forEach((input) => {
    const value = input.value.trim();
    if (!value) return;
    const [group, key] = input.dataset.labelPath.split(".");
    (out[group] = out[group] || {})[key] = value;
  });
  return out;
}

// Пустые объекты в site-settings.json не нужны — они копятся при
// каждом «сбросить» и потом читаются как «тут что-то настроено».
function prunePalette() {
  const out = {};
  for (const [skin, colors] of Object.entries(themeColors)) {
    // Палитры удалённых тем в файле не нужны — иначе они копятся
    // навсегда и читаются как настройки существующей темы.
    if (!THEME_PRESETS[skin]) continue;
    const kept = {};
    for (const [key, value] of Object.entries(colors || {})) {
      if (/^#[0-9a-f]{6}$/i.test(value)) kept[key] = value;
    }
    if (Object.keys(kept).length) out[skin] = kept;
  }
  return out;
}

async function saveSettings() {
  tabOrderState.forEach((id) => {
    const row = document.getElementById(`tabrow-${id}`);
    if (row && row.classList.contains("editing")) toggleTabEdit(id);
  });
  const rows = [...statusBuckets, { key: "archive" }];
  rows.forEach((b) => {
    const row = document.getElementById(`statusrow-${b.key}`);
    if (row && row.classList.contains("editing")) toggleStatusEdit(b.key);
  });
  tierCollections.forEach((c) => {
    const row = document.getElementById(`collrow-${c.id}`);
    if (row && row.classList.contains("editing")) toggleCollectionEdit(c.id);
  });
  {
    const row = document.getElementById("tiermoderow-titles");
    if (row && row.classList.contains("editing")) toggleTierModeEdit("titles");
  }
  FAV_SECTIONS.forEach((s) => {
    const row = document.getElementById(`favsecrow-${s.key}`);
    if (row && row.classList.contains("editing")) toggleFavSecEdit(s.key);
  });
  favCollections.forEach((c) => {
    const row = document.getElementById(`favcollrow-${c.id}`);
    if (row && row.classList.contains("editing")) toggleFavCollectionEdit(c.id);
  });

  const hiddenTabs = tabOrderState.filter((id) => hiddenTabsState.has(id));
  // Если главная вкладка оказалась скрыта — не даём сохранить такую комбинацию молча,
  // просто подстраховываемся и переключаем на первую видимую.
  if (hiddenTabs.includes(mainTabState)) {
    const firstVisible = tabOrderState.find((id) => !hiddenTabs.includes(id));
    if (firstVisible) mainTabState = firstVisible;
  }
  const hiddenStatuses = [...hiddenStatusesState];

  const hiddenStatsBlocks = [...hiddenStatsState];

  Object.keys(typeLabels).forEach((key) => {
    const input = document.getElementById(`type-input-${key}`);
    if (input) typeLabels[key] = input.value;
  });
  const customTypes = {};
  customTypeKeys.forEach((key) => {
    if (typeLabels[key] !== undefined) customTypes[key] = typeLabels[key];
  });
  const typeRenames = {};
  Object.keys(BUILTIN_TYPE_DEFAULTS).forEach((key) => {
    typeRenames[key] = typeLabels[key];
  });

  customTypeKeys.forEach((key) => {
    const i0 = document.getElementById(`type-plural-${key}-0`);
    const i1 = document.getElementById(`type-plural-${key}-1`);
    const i2 = document.getElementById(`type-plural-${key}-2`);
    if (!i0) return;
    const one = i0.value.trim(),
      few = i1.value.trim(),
      many = i2.value.trim();
    if (one && few && many) typePlural[key] = [one, few, many];
    else delete typePlural[key];
  });
  const customTypePlural = {};
  customTypeKeys.forEach((key) => {
    if (typePlural[key]) customTypePlural[key] = typePlural[key];
  });

  Object.keys(subtypeLabels).forEach((key) => {
    const input = document.getElementById(`subtype-input-${key}`);
    if (input) subtypeLabels[key] = input.value;
  });
  const customSubtypes = {};
  customSubtypeKeys.forEach((key) => {
    if (subtypeLabels[key] !== undefined) customSubtypes[key] = subtypeLabels[key];
  });
  const subtypeRenames = {};
  Object.keys(BUILTIN_SUBTYPE_DEFAULTS).forEach((key) => {
    subtypeRenames[key] = subtypeLabels[key];
  });

  Object.keys(allCatLabels).forEach((key) => {
    const input = document.getElementById(`cat-input-${key}`);
    if (input) allCatLabels[key] = input.value;
  });
  const categories = {};
  Object.keys(BUILTIN_CAT_DEFAULTS).forEach((key) => {
    categories[key] = allCatLabels[key];
  });
  const customCategoriesPayload = {};
  const categoryColors = {};
  Object.keys(allCatLabels).forEach((key) => {
    if (catColors[key]) categoryColors[key] = catColors[key];
  });
  customCatKeys.forEach((key) => {
    customCategoriesPayload[key] = allCatLabels[key];
  });

  const gradeScale = { type: scaleType, shelves };
  if (scaleType !== "categorical")
    gradeScale.numericMax = Number(document.getElementById("numericMax").value) || 10;

  const payload = {
    ...rawSettings,
    textScale,
    theme: selectedTheme,
    themeColors: prunePalette(),
    customTags,
    customCategories: customCategoriesPayload,
    categoryColors,
    customTypes,
    hiddenTypes: [...hiddenTypes],
    customTypePlural,
    typeColors,
    customSubtypes,
    hiddenSubtypes: [...hiddenSubtypes],
    hiddenTabs,
    tabOrder: tabOrderState,
    mainTab: mainTabState,
    hiddenStatsBlocks,
    gradeScale,
    statusBuckets,
    hiddenStatuses,
    tierCollections,
    hiddenTierModes: [...hiddenTierModesState],
    hiddenFavSections: [...hiddenFavSectionsState],
    removedFavSections: [...removedFavSections],
    favCollections,
    labels: {
      // Сначала то, что настроено на вкладке «Подписи», затем поля
      // из остальных экранов — они по этим же группам не пересекаются.
      ...collectLabelOverrides(),
      nav: { ...tabLabels },
      statuses: {
        archive: archiveLabel,
      },
      sections: {
        tierTitles: tierTitlesLabel,
        ...favSectionLabels,
      },
      types: typeRenames,
      categories,
      subtypes: subtypeRenames,
    },
  };

  // Глобальный акцент переехал в палитру темы при загрузке —
  // в файле он больше не нужен.
  delete payload.customAccent;

  const activePanel = document.querySelector(".panel.active").id.replace("panel-", "");
  const statusId = `status-${activePanel}`;
  flashStatus(statusId, true, i18n("Сохраняю..."));

  try {
    const res = await fetch("/api/save-site-settings", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    // Приложение — не сайт: страница и есть само хранилище, никакой
    // отдельно выложенной копии со своей задержкой публикации нет.
    flashStatus(statusId, data.ok, data.ok ? "Сохранено ✓" : i18n("Ошибка: ") + data.error);
    // previewPalette() выше красит только текущий экран вживую и кэш
    // для FOUC (localStorage, см. инлайновый скрипт в начале <head>)
    // не трогает. Без этого на следующей странице после сохранения
    // на долю секунды мелькнула бы прошлая тема — applyTheme() сама
    // перечитает уже сохранённый site-settings.json и обновит кэш.
    if (data.ok) applyTheme();
    // Сохранённая тема — это и есть «настоящая» тема документа:
    // откатывать предпросмотр при уходе с маршрута больше не к чему
    // (см. revertPalettePreview()).
    if (data.ok) sePrevSkin = selectedTheme;
    // Всё, что копилось несохранённым (см. markSettingsDirty выше),
    // теперь на сервере — предупреждать при уходе с маршрута больше
    // не о чем, пока не появится новая правка.
    if (data.ok) settingsDirty = false;
  } catch (e) {
    flashStatus(statusId, false, i18n("Ошибка: ") + e.message);
  }
}

registerRoute("#/settings-edit", { mount, unmount });
