// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

// ── Тип тайтла – тот же паттерн выпадающего списка с инлайн-добавлением,
//    что и у источников (см. блок «Источники» выше). Свои типы хранятся
//    в customTypes/hiddenTypes/customTypePlural, переименования встроенных –
//    в labels.types (site-settings.json), правится прямо тут. ──
// Из config.js (MEDIA_TYPES) – единственного места, где перечислены
// встроенные типы.
const TYPE_BUILTINS = MEDIA_TYPES.map((t) => t.key);
let typePickerOpen = false;

function typeLabel(key) {
  return TYPE_LABELS[key] || TYPE_LABELS.anime;
}

function syncTypePickerLabel() {
  const key = document.getElementById("f-type").value || "anime";
  document.getElementById("type-picker-label").textContent = typeLabel(key);
}

// Ключ типа, у которого сейчас открыт инлайн-рендейм (см.
// startRenameTypePicker) – нужен, чтобы Enter (который сам вызывает
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
      <input type="text" id="type-picker-new-name" placeholder="${i18n("Например: Артбук")}" oninput="prefillTypePlural()" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddType();}">
      <div style="display:flex;gap:.4rem;margin-top:.4rem;">
        <input type="text" id="type-picker-plural-one" placeholder="${i18n("1 штука")}" style="font-size:.78rem;" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddType();}">
        <input type="text" id="type-picker-plural-few" placeholder="2–4" style="font-size:.78rem;" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddType();}">
        <input type="text" id="type-picker-plural-many" placeholder="5+" style="font-size:.78rem;" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddType();}">
      </div>
      <div class="hint" style="margin-top:.3rem;font-size:.68rem;">${i18n("Склонение подставилось автоматически (чёрн­овик) – поправьте, если неточно.")}</div>
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
  // любом другом языке – тогда решает русская эвристика. Без этой
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
    statusEl.textContent = i18n("Введите название типа");
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

// Встроенный тип нельзя вырезать из TYPE_LABELS в коде – «удаление»
// для него складывается в hiddenTypes, тем же приёмом, что и у тегов и
// категорий: он просто перестаёт появляться в списке. У своих типов
// удаление настоящее – стирает customTypes/customTypePlural целиком.
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

// Переименование – инлайн, прямо в строке списка: клик по ✎ подменяет
// подпись на текстовое поле, Enter/уход фокуса сохраняют, Esc отменяет.
// Встроенный тип переименовывается через labels.types (оверрайд
// подписи, ключ в TYPE_BUILTINS не меняется), свой – через сам
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

