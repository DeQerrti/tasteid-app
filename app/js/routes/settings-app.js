// ══════════════════════════════════════════════
//  settings-app.js – настройки приложения, хранилища, резервная копия – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Настройки приложения ───────────────────────
// Всё здесь идёт через /api/app/*: страница в песочнице и до системы
// сама дотянуться не может. На сайте этих адресов нет, поэтому панель
// и не показывается – проверяем одним запросом при монтировании.
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
    // Синхронизация ходит в /api/export-backup и /api/restore-backup –
    // они есть у приложения (core/api.js), но не у голого сайта.
    document.getElementById("tab-sync").classList.remove("hidden");
  } catch {
    // Обычный браузер – панелей приложения просто нет.
  }
}

function zoomPercent(percent) {
  return Math.round(percent) + "%";
}

// process.platform называется "win32" у Electron/Node на Windows
// вообще всегда – даже на 64-битной и ARM64 системе: это имя унаследовано
// от старого Win32 API и разрядность в нём никогда не была закодирована.
// Показывать его как есть в «О программе» вводит в заблуждение (человек
// решает, что приложение 32-битное) – поэтому здесь расшифровываем
// платформу и разрядность (process.arch) в отдельности.
const PLATFORM_OS_NAMES = { win32: "Windows", darwin: "macOS", linux: "Linux", android: "Android" };
const PLATFORM_ARCH_NAMES = { x64: "64-bit", ia32: "32-bit", arm64: "ARM64" };
function platformLabel(platform, arch) {
  const os = PLATFORM_OS_NAMES[platform] || platform || "";
  const archLabel = PLATFORM_ARCH_NAMES[arch] || arch || "";
  return [os, archLabel].filter(Boolean).join(" ");
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
  document.getElementById("app-version").textContent =
    `TasteID ${appInfo.version || ""} · ${platformLabel(appInfo.platform, appInfo.arch)}`;

  // На телефоне нет проводника – вместо неработающих кнопок показываем
  // то, что там правда можно сделать. Масштаб же на телефоне свой,
  // через CSS zoom (см. applyMobileZoom в mobile/src/main.js) – секция
  // не скрывается, только сам механизм смены масштаба ниже другой.
  document.getElementById("app-vault-actions").classList.toggle("hidden", !!appInfo.mobile);
  document.getElementById("app-vault-mobile-note").classList.toggle("hidden", !appInfo.mobile);
  document.getElementById("app-updates-section")?.classList.toggle("hidden", !appInfo.mobile);
}

// На макбуке и в мобильном банере обновление показывает себя само,
// если найдено, – здесь только статус для случаев, когда нечего
// показывать (уже последняя версия) или уже показано (диалог/банер
// всплыл отдельно, поверх этой же страницы).
async function checkForUpdateNow() {
  const btn = document.getElementById("btn-check-update");
  if (btn) btn.disabled = true;
  flashStatus("status-update", true, i18n("Проверяем…"));
  try {
    const data = await appApi("/api/app/check-update", {});
    if (data.status === "latest") flashStatus("status-update", true, i18n("У вас последняя версия."));
    else if (data.status === "error") flashStatus("status-update", false, i18n("Не удалось проверить обновления."));
    // «Качается» – самый частый случай успеха, и раньше он показывал
    // пустую строку: человек жал кнопку и не получал вообще никакой
    // реакции, хотя обновление уже нашлось.
    else if (data.status === "downloading")
      flashStatus(
        "status-update",
        true,
        i18n("Найдена версия {v} – качаем, предложим установить.", { v: data.version || "" })
      );
    else if (data.status === "dev")
      flashStatus("status-update", true, i18n("Запущено из исходников – обновления не проверяются."));
    else flashStatus("status-update", true, "");
  } catch (e) {
    flashStatus("status-update", false, e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Панель «Хранилища» ─────────────────────────
// Список {id, name} приходит из appInfo (тот же /api/app/info, что
// уже дёргает detectApp()) – отдельного запроса не нужно, разве что
// appInfo ещё не готов при самом первом клике по вкладке.
//
// На компьютере «Добавить» – это выбор папки: новой или уже
// существующей (например, скопированной с другого устройства
// вручную). На телефоне выбирать нечего – там только имя, а папку
// заводит сама MobileVault.
async function renderVaultsPanel() {
  const box = document.getElementById("vaultsPanel");
  try {
    if (!appInfo) appInfo = await appApi("/api/app/info");
    box.innerHTML = `
        <p class="panel-intro" data-i18n>
          Несколько независимых хранилищ на одном устройстве
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
            ? `<button class="icon-btn" title="${i18n("Удалить хранилище")}" onclick="removeVault('${v.id}')">✕</button>`
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
// остальное с нуля – как и при «Сменить папку» на прошлой версии
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
    // нет – вызов бросает «prompt() is not supported.», то есть на
    // компьютере обе кнопки заканчивались ошибкой, а хранилище так и
    // не заводилось (см. js/utils.js).
    if (mode === "mobile") {
      const name = await promptDialog(i18n("Имя нового хранилища:"), i18n("Новое хранилище"));
      if (name === null) return; // отмена
      await appApi("/api/app/add-vault", { name: name.trim() });
    } else if (mode === "new") {
      // Как в Обсидиане: выбираем не саму папку хранилища, а место, где
      // её завести – саму папку под введённым именем создаёт бэкенд
      // (createSubfolder, см. её же комментарий у use-vault в
      // electron/main.js), а не занимает выбранную папку целиком, какой
      // бы она ни была.
      const picked = await appApi("/api/app/pick-vault", { mode });
      if (!picked.path) return; // отмена в системном диалоге выбора папки
      const name = await promptDialog(i18n("Имя нового хранилища:"), i18n("Хранилище"));
      if (name === null) return;
      await appApi("/api/app/use-vault", { path: picked.path, name: name.trim(), createSubfolder: true });
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
// не показывается у активного). И на телефоне, и на компьютере это
// теперь настоящее удаление: папка/раздел стираются с диска, а не
// только забываются из списка (см. её же комментарий у remove-vault в
// electron/main.js и /api/app/remove-vault в mobile/src/main.js).
// На компьютере это по-настоящему безвозвратно и трогает файлы,
// которые человек мог сложить в эту же папку сам, – одного окна
// подтверждения тут мало: просим напечатать название хранилища,
// тем же приёмом, каким GitHub подтверждает удаление репозитория.
async function removeVault(id) {
  const vault = (appInfo.vaults || []).find((v) => v.id === id);
  const name = vault?.name || id;
  if (appInfo.mobile) {
    if (
      !(await confirmDialog(
        i18n("Хранилище и все его данные будут стёрты с телефона. Продолжить?"),
        i18n("Удалить")
      ))
    ) {
      return;
    }
  } else {
    const typed = await promptDialog(
      i18n(
        "Это навсегда удалит папку хранилища «{name}» со всем содержимым – отзывами, картинками, историей версий. Отменить не получится.\n\nЧтобы подтвердить, напечатайте название хранилища:",
        { name }
      ),
      "",
      i18n("Удалить навсегда")
    );
    if (typed !== name) {
      if (typed !== null) flashStatus("status-vaults", false, i18n("Название не совпало – хранилище не тронуто."));
      return;
    }
  }
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
// а не легче. Цифра рядом обновляется вживую (input), а сам масштаб –
// только когда отпустили (change).
function previewZoom(percent) {
  document.getElementById("app-zoom-value").textContent = zoomPercent(Number(percent));
  // И на компьютере, и на телефоне масштаб применяется только по
  // onchange (setZoom ниже) – пока ползунок ещё тащат, только подпись
  // процента. Раньше на телефоне применяли сразу по каждому движению –
  // сам интерфейс (в том числе ползунок) едет вместе с масштабом прямо
  // под пальцем, и попасть в нужное значение труднее, а не легче, там
  // же, где и на компьютере.
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
// Не путать с «Паспортом»: тот – урезанный слепок для показа чужим,
// этот – всё целиком и только для себя (core/api.js: exportBackup /
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
  input.value = ""; // тот же файл ещё раз выбрать иначе не получится – onchange не сработает
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
      throw new Error(i18n("Это не похоже на файл резервной копии – внутри не JSON."));
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

