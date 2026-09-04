// ══════════════════════════════════════════════
//  settings-shortcuts.js – горячие клавиши – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Горячие клавиши ─────────────────────────────
// Перерисовывает только эту панель – не всю loadCurrentSettings(),
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
// страницей не управляется – без базового объекта они терялись бы при
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
  // человеком во все темы – в том числе в те, у которых есть свой
  // акцент по умолчанию. Переносим его в палитру текущей темы, но
  // только если своего у неё нет: тот же порядок, что и в theme.js.
  const themeHasOwnAccent = !!(THEME_PRESETS[selectedTheme] || {}).defaultAccent;
  if (settings.customAccent && !themeHasOwnAccent && !(themeColors[selectedTheme] || {}).accent) {
    (themeColors[selectedTheme] = themeColors[selectedTheme] || {}).accent = settings.customAccent;
  }
  renderThemeGrid();
  renderPalette();

  // «Скрыть теги на всех карточках» – реальное состояние по данным, а
  // не всегда «выключено»: раньше hideTagsAllOn сбрасывался в false при
  // каждом монтировании и никогда не пересчитывался, поэтому уже
  // спрятанные везде теги при повторном заходе в настройки снова
  // предлагали спрятать, а глазик никогда не показывал перечёркнутым.
  const reviewsForTagsToggle = await fetchReviews();
  hideTagsAllOn =
    reviewsForTagsToggle.length > 0 && reviewsForTagsToggle.every((r) => r.no_tags_on_card === true);
  syncHideTagsToggle();

  const labels = settings.labels || {};
  renderLabelsPanel(labels);
  // «Подписи» рисует свои заголовки групп только сейчас – сворачиваем
  // и их тоже (см. collapsibleizeSettingsSections()).
  collapsibleizeSettingsSections();
  tabLabels = { ...(labels.nav || {}) };
  hiddenTabsState = new Set(settings.hiddenTabs || []);
  const savedOrder = Array.isArray(settings.tabOrder) ? settings.tabOrder.filter((id) => TAB_DEFS_BY_ID[id]) : [];
  const missing = TAB_DEFS.map((t) => t.id).filter((id) => !savedOrder.includes(id));
  tabOrderState = [...savedOrder, ...missing];
  renderTabsList();
  updateSectionListHeadings();

  tierTitlesLabel = (labels.sections && labels.sections.tierTitles) || i18n("Тайтлы");
  hiddenTierModesState = new Set(settings.hiddenTierModes || []);

  // activeTierCollections() – тот же запасной вариант ([{id:"characters"}]),
  // что использует и сама вкладка «Тир-лист» (js/tierlist.js), пока
  // настроек ещё не было: показать в списке нечего материализовать
  // самим, раз показывать всё равно придётся встроенную «Персонажи».
  tierCollections = Array.isArray(settings.tierCollections)
    ? JSON.parse(JSON.stringify(settings.tierCollections))
    : activeTierCollections();
  {
    const knownTier = ["titles", ...tierCollections.map((c) => c.id)];
    const savedTierOrder = Array.isArray(settings.tierModeOrder)
      ? settings.tierModeOrder.filter((k) => knownTier.includes(k))
      : [];
    const missingTier = knownTier.filter((k) => !savedTierOrder.includes(k));
    tierModeOrderState = [...savedTierOrder, ...missingTier];
  }
  renderTierModesList();

  favSectionLabels = {
    favTitles: (labels.sections && labels.sections.favTitles) || i18n("Тайтлы"),
    favCharacters: (labels.sections && labels.sections.favCharacters) || i18n("Персонажи"),
    favPersons: (labels.sections && labels.sections.favPersons) || i18n("Персоны"),
  };
  hiddenFavSectionsState = new Set(settings.hiddenFavSections || []);
  removedFavSections = new Set(settings.removedFavSections || []);
  favCollections = settings.favCollections ? JSON.parse(JSON.stringify(settings.favCollections)) : [];
  {
    // Один порядок на встроенные разделы И свои (favCollections) – см.
    // её же комментарий у favSectionOrderedKeys() в settings-tabs.js:
    // favCollections нужно загрузить до этого места, иначе их id ещё
    // не с чем сверить.
    const known = [...FAV_SECTIONS.map((s) => s.key), ...favCollections.map((c) => c.id)];
    const saved = Array.isArray(settings.favSectionOrder)
      ? settings.favSectionOrder.filter((key) => known.includes(key))
      : [];
    const missing = known.filter((key) => !saved.includes(key));
    favSectionOrderState = [...saved, ...missing];
  }
  renderFavSectionsList();

  const statuses = labels.statuses || {};
  const builtinDefaults = [
    { key: "current", label: i18n("В процессе"), removable: false },
    { key: "onhold", label: i18n("Отложено"), removable: false },
    { key: "planning", label: i18n("Планирую"), removable: false },
  ];
  statusBuckets = settings.statusBuckets ? JSON.parse(JSON.stringify(settings.statusBuckets)) : builtinDefaults;
  archiveLabel = statuses.archive || i18n("Архив");
  hiddenStatusesState = new Set(settings.hiddenStatuses || []);
  statusOrderState = Array.isArray(settings.statusOrder) ? [...settings.statusOrder] : [];
  renderStatusesList();

  const gradeScale = settings.gradeScale || null;
  scaleType = gradeScale?.type || "categorical";
  shelves = gradeScale?.shelves ? JSON.parse(JSON.stringify(gradeScale.shelves)) : [];
  document.getElementById("numericMax").value = gradeScale?.numericMax || (scaleType === "stars" ? 5 : 10);
  // Снимок шкалы «как было до правки» – нужен в saveSettings(), чтобы
  // понять, требует ли новая шкала пересчёта уже поставленных оценок
  // (см. buildRegradeMap() в settings-labels.js). Копия, а не ссылка –
  // shelves ниже правится прямо в этом же массиве по месту.
  originalGradeScale = {
    type: scaleType,
    shelves: JSON.parse(JSON.stringify(shelves)),
    numericMax: Number(document.getElementById("numericMax").value) || 10,
  };
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
  // Панель редактирования тегов/категорий убрана из настроек – то же
  // самое теперь делается инлайн прямо в редакторе отзыва. Состояние
  // выше по-прежнему подгружается и уходит обратно при сохранении
  // неизменным – просто больше не рендерится тут в список.

  customTags = settings.customTags || {};

  // Загрузка настроек ничего не «правит» – но делегированный слушатель
  // на #app видит те же input/change от программного заполнения полей
  // (renderPalette, renderTabsList и т.п. переписывают value). На
  // отдельной странице это было безобидно: флаг взводился до первого
  // взгляда человека и всё равно спрашивал бы только при уходе. Здесь
  // маршрут может открываться и закрываться десятки раз за сессию –
  // снимаем флаг явно, чтобы «уйти и потерять?» не всплывало на ровном
  // месте.
  settingsDirty = false;
}

