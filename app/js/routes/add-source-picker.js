// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

// ── Источники ссылок – источник выбирается прямо в инлайн-меню под
//    кнопкой «+ Добавить источник», без похода в отдельную модалку.
//    Новые типы источников добавляются из того же меню и сохраняются
//    в settings.customSources (SOURCE_LABELS приходит из config.js) ──
const SOURCE_BUILTINS = ["teletype", "other"];
let openSourceDropdown = null; // 1 | 2 | null – какое меню типа сейчас открыто
// Ключ источника, у которого сейчас открыто инлайн-переименование
// (см. startRenameSourceType) – тот же приём, что у typeRenamePending
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
// показывается или прячется целиком – он появляется только по
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
  // резерв на будущее – например, автоопределение типа источника по URL
}

function renderTypeDropdown(n) {
  const ids = srcIds(n);
  const dd = document.getElementById(`src-type-dropdown-${n}`);
  const current = document.getElementById(ids.source).value || "teletype";
  const options = Object.entries(SOURCE_LABELS)
    .map(([key, label]) => {
      return `
    <div class="src-type-option${key === current ? " active" : ""}" data-type-key="${esc(key)}" onclick="selectSourceType(${n}, '${key}')">
      <span class="src-type-option-label">${esc(label)}</span>
      <span class="icon-btn src-type-rename" title="${i18n("Переименовать")}" onclick="event.stopPropagation(); startRenameSourceType(${n}, '${key}')">✎</span>
      <span class="icon-btn src-type-remove" title="${i18n("Удалить")}" onclick="event.stopPropagation(); removeSourceType('${key}')">✕</span>
    </div>`;
    })
    .join("");
  dd.innerHTML = `
    <div class="src-type-list">${options}</div>
    <div class="src-type-add-row">
      <button type="button" class="btn-new src-type-add-btn" onclick="showAddSourceTypeForm(${n})">${i18n("Добавить")}</button>
    </div>
    <div class="src-type-add-form hidden" id="src-type-add-form-${n}">
      <input type="text" id="src-type-new-name-${n}" placeholder="${i18n("Например: Дзен")}" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddSourceType(${n});}">
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
    statusEl.textContent = i18n("Введите название источника");
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
  const isBuiltin = SOURCE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.hiddenSources = settings.hiddenSources || [];
        if (!settings.hiddenSources.includes(key)) settings.hiddenSources.push(key);
      } else {
        settings.customSources = settings.customSources || {};
        delete settings.customSources[key];
      }
    });
    delete SOURCE_LABELS[key];
    document.dispatchEvent(new CustomEvent("tags-map-updated"));
    if (openSourceDropdown !== null) renderTypeDropdown(openSourceDropdown);
    // если удалённый тип был выбран в одном из полей – сбрасываем на Teletype
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

// Переименование – тот же приём, что у типа тайтла (startRenameTypePicker
// ниже): клик по ✎ подменяет подпись на текстовое поле прямо в строке
// списка, Enter/уход фокуса сохраняют, Esc отменяет. Встроенный
// источник (Teletype/Другое) переименовывается через labels.sources
// (оверрайд подписи, ключ в SOURCE_BUILTINS не меняется) и «удаляется»
// только в hiddenSources – свой удаляется по-настоящему, из
// customSources.
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

  const isBuiltin = SOURCE_BUILTINS.includes(key);
  try {
    await patchSiteSettings((settings) => {
      if (isBuiltin) {
        settings.labels = settings.labels || {};
        settings.labels.sources = settings.labels.sources || {};
        settings.labels.sources[key] = name;
      } else {
        settings.customSources = settings.customSources || {};
        settings.customSources[key] = name;
      }
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

