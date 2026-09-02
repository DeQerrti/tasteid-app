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

  // На телефоне нет ни проводника, ни понятия масштаба окна – вместо
  // неработающих кнопок показываем то, что там правда можно сделать.
  document.getElementById("app-vault-actions").classList.toggle("hidden", !!appInfo.mobile);
  document.getElementById("app-vault-mobile-note").classList.toggle("hidden", !appInfo.mobile);
  document.getElementById("app-zoom-section").classList.toggle("hidden", !!appInfo.mobile);
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
          Несколько независимых хранилищ на одном устройстве – со своими
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
// не показывается у активного) – предупреждение разное для
// компьютера и телефона, потому что и последствия разные: на
// компьютере папка остаётся на диске и её можно открыть заново
// через «Открыть существующее», на телефоне отдельной папки для
// не-default хранилища больше не будет вообще.
async function removeVault(id) {
  const warn = appInfo.mobile
    ? i18n("Хранилище и все его данные будут стёрты с телефона. Продолжить?")
    : i18n(
        "Хранилище будет убрано из списка. Сама папка на диске никуда не денется – её можно будет открыть заново через «Открыть существующее»."
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
// а не легче. Цифра рядом обновляется вживую (input), а сам масштаб –
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

// ── Досоздание резервных копий обложек/аватарок ─
// Обложки и аватарки по ссылке получают резервную копию (/api/backup-
// cover) автоматически при каждом сохранении – но это добавилось не
// сразу, и старые записи, сохранённые раньше, своей копии не
// получили. Раз чужая ссылка (AniList и т.п.) может в любой момент
// перестать отдавать картинку, для них это разово досоздаётся здесь.
// Один и тот же приём, что и у самого backup-cover, только по кругу
// для reviews.json (обложки) и favorites.json (персонажи/персоны/
// свои разделы – тип записи тут ни при чём, копия нужна всем
// одинаково) – без нового серверного эндпоинта, теми же двумя, что
// уже вызываются по одной записи из /add и /favorites-edit.
function backfillSlug(name) {
  return (
    String(name || "item")
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5) +
    Math.random().toString(36).slice(-4)
  );
}

async function backfillCoverBackups() {
  const btn = document.getElementById("backfill-covers-btn");
  const status = document.getElementById("status-backfill-covers");
  btn.disabled = true;
  status.style.color = "";
  status.textContent = i18n("Смотрим, у кого нет резервной копии…");

  let done = 0;
  let failed = 0;

  try {
    const [reviews, favorites] = await Promise.all([
      fetch("/reviews.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : [])),
      fetch("/favorites.json?_=" + Date.now()).then((r) => (r.ok ? r.json() : [])),
    ]);

    const reviewTargets = reviews.filter((r) => r.cover && /^https?:\/\//.test(r.cover) && !r.cover_backup);
    const favTargets = favorites.filter((r) => r.image && /^https?:\/\//.test(r.image) && !r.image_backup);
    const total = reviewTargets.length + favTargets.length;

    if (!total) {
      flashStatus("status-backfill-covers", true, i18n("У всех уже есть резервная копия."));
      return;
    }

    for (const r of reviewTargets) {
      status.textContent = `${done + failed + 1} / ${total}…`;
      try {
        const backupRes = await fetch("/api/backup-cover", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: r.cover, filename: backfillSlug(r.title) }),
        });
        const backup = await backupRes.json();
        if (!backup.ok) throw new Error(backup.error || "backup-cover");

        const saveRes = await fetch("/api/save-review", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...r, _editId: r.id, cover_backup: backup.url || "/" + backup.path }),
        });
        const saved = await saveRes.json();
        if (!saveRes.ok || saved.error) throw new Error(saved.error || "save-review");
        done++;
      } catch {
        failed++;
      }
    }

    for (const r of favTargets) {
      status.textContent = `${done + failed + 1} / ${total}…`;
      try {
        const backupRes = await fetch("/api/backup-cover", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: r.image, filename: backfillSlug(r.name) }),
        });
        const backup = await backupRes.json();
        if (!backup.ok) throw new Error(backup.error || "backup-cover");

        const saveRes = await fetch("/api/save-favorite", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...r, _editId: r.id, image_backup: backup.url || "/" + backup.path }),
        });
        const saved = await saveRes.json();
        if (!saveRes.ok || saved.error) throw new Error(saved.error || "save-favorite");
        done++;
      } catch {
        failed++;
      }
    }

    // «Любимое» под этим маршрутом не перечитается само, пока по нему
    // не щёлкнуть заново – тот же сброс, что и у остальных действий,
    // трогающих reviews.json/favorites.json не через саму вкладку.
    refreshOpenReviewsTab();

    if (failed) {
      flashStatus(
        "status-backfill-covers",
        false,
        i18n("Готово: {done} из {total}, {failed} не удалось (ссылка недоступна?).", { done, total, failed })
      );
    } else {
      flashStatus("status-backfill-covers", true, i18n("Готово: резервных копий создано – {done}.", { done }));
    }
  } catch (err) {
    flashStatus("status-backfill-covers", false, i18n("Ошибка: ") + err.message);
  } finally {
    btn.disabled = false;
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

