// ══════════════════════════════════════════════
//  settings-labels.js – панель «Подписи» – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ══ ПОДПИСИ ═══════════════════════════════════
// Источник правды – DEFAULT_LABELS из js/theme.js. Панель строится
// по нему: добавили ключ в реестр – поле здесь появилось само,
// отдельно править эту страницу не нужно.
//
// Группы nav и statuses здесь не показываем: у них уже есть свои
// экраны («Вкладки» и «Оценки и статусы»), два места для одного и
// того же только запутали бы. sections – та же история: переехала
// в «Вкладки» (favTitles/favCharacters/favPersons, там же теперь
// видимость) и в «Тир-листы» (tierTitles, рядом с переименованием
// «Персонажи»). empty вообще убрана из редактируемых – это тексты
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
  "stats.spotlightOne": i18n("Лучшее за год – одно ({year})"),
  "stats.spotlightMany": i18n("Лучшее за год – несколько ({year})"),
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
// умолчанию», и записывать его в настройки незачем – иначе при
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

// Пустые объекты в site-settings.json не нужны – они копятся при
// каждом «сбросить» и потом читаются как «тут что-то настроено».
function prunePalette() {
  const out = {};
  for (const [skin, colors] of Object.entries(themeColors)) {
    // Палитры удалённых тем в файле не нужны – иначе они копятся
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
  // Если главная вкладка оказалась скрыта – не даём сохранить такую комбинацию молча,
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
      // из остальных экранов – они по этим же группам не пересекаются.
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

  // Глобальный акцент переехал в палитру темы при загрузке –
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
    // Приложение – не сайт: страница и есть само хранилище, никакой
    // отдельно выложенной копии со своей задержкой публикации нет.
    flashStatus(statusId, data.ok, data.ok ? "Сохранено ✓" : i18n("Ошибка: ") + data.error);
    // previewPalette() выше красит только текущий экран вживую и кэш
    // для FOUC (localStorage, см. инлайновый скрипт в начале <head>)
    // не трогает. Без этого на следующей странице после сохранения
    // на долю секунды мелькнула бы прошлая тема – applyTheme() сама
    // перечитает уже сохранённый site-settings.json и обновит кэш.
    if (data.ok) applyTheme();
    // Сохранённая тема – это и есть «настоящая» тема документа:
    // откатывать предпросмотр при уходе с маршрута больше не к чему
    // (см. revertPalettePreview()).
    if (data.ok) sePrevSkin = selectedTheme;
    // Всё, что копилось несохранённым (см. markSettingsDirty выше),
    // теперь на сервере – предупреждать при уходе с маршрута больше
    // не о чем, пока не появится новая правка.
    if (data.ok) settingsDirty = false;
  } catch (e) {
    flashStatus(statusId, false, i18n("Ошибка: ") + e.message);
  }
}

