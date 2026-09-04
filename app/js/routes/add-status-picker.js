// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

// ── Статус – такой же пикер, как у типа ────────
// Был обычный <select>: он не давал добавить свой статус, хотя типы
// это уже умели. Теперь список общий по виду и поведению, а «своё»
// значение дописывается в statusBuckets внутри site-settings.json.
//
// Само значение по-прежнему лежит в поле f-status (hidden), поэтому
// заполнение и сохранение формы менять не пришлось.
//
// Встроенные статусы (как TYPE_BUILTINS у типов) – их нельзя вычеркнуть
// из DEFAULT_STATUS_BUCKETS в коде, поэтому «удаление» для них
// складывается в hiddenStatuses (тот же массив, что и глазок в
// настройках – там же можно вернуть обратно), а не по-настоящему
// стирает статус. У своих статусов удаление настоящее.
const STATUS_BUILTINS = ["current", "onhold", "planning"];

// Список всех доступных статусов. "completed" – не bucket, он всегда
// последний и неудаляемый: это конечное состояние, а не этап, и он
// не проходит через hiddenStatuses (см. её же комментарий в now.js) –
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
// Ключ статуса, у которого сейчас открыт инлайн-рендейм – тот же приём,
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
      <input type="text" id="status-picker-new-name" placeholder="${i18n("Например: Перечитываю")}" onkeydown="if(event.key==='Enter'){event.preventDefault();confirmAddStatus();}">
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
      // Если своих статусов ещё не задавали, в файле их нет вовсе –
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

// Переименование – тот же инлайн-приём, что и у типа (startRenameTypePicker):
// клик по ✎ подменяет подпись на текстовое поле, Enter/уход фокуса
// сохраняют, Esc отменяет. «Завершено» – не настоящий bucket (см.
// statusOptions), его подпись живёт в labels.statuses.archive, у
// обычных – прямо в statusBuckets.
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

