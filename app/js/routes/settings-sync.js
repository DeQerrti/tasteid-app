// ══════════════════════════════════════════════
//  settings-sync.js – панель синхронизации через GitHub – часть роута #/settings-edit
//  Разбито из settings-edit.js (2972 строки) по секциям – читается
//  тем же способом, что и раньше: обычный глобальный скрипт, без
//  своего экспорта, подключается вместе с settings-edit.js и остальными
//  файлами этой же группы в index.html, в общей области видимости.
// ══════════════════════════════════════════════

// ── Синхронизация ────────────────────────────
// Вся логика, включая автосинхронизацию в фоне, – в app/js/sync.js,
// здесь только экран: две панели, «не подключено» и «подключено», и
// разбор конфликтов, если они есть. syncInFlight – общий с
// автосинхронизацией флаг (объявлен в sync.js): не дать ручной кнопке
// и подоспевшему фоновому запуску столкнуться на одном и том же пути.

function renderSyncPanel() {
  const box = document.getElementById("syncPanel");
  const config = getSyncConfig();
  box.innerHTML = config ? syncConnectedHtml(config) : syncSetupHtml();
  applyI18n(box);
  // Конфликт, найденный автосинхронизацией, мог случиться, пока
  // человек не смотрел на эту вкладку вовсе – открыв её, сразу
  // досчитываем ещё раз и показываем, что не так, а не заставляем
  // сперва самому нажать «Синхронизировать сейчас».
  if (config && localStorage.getItem(AUTOSYNC_CONFLICTS_KEY) === "1") startSync();
}

function syncSetupHtml() {
  return `
      <p class="sync-intro" data-i18n>
        Свободно и без своего сервера: приватный репозиторий на GitHub
        как общее хранилище для всех ваших устройств – телефона,
        компьютера, ещё одного компьютера. GitHub здесь единственный
        сервер, а токен и служебные данные синхронизации остаются
        только на этом устройстве.
      </p>
      <p class="sync-intro" data-i18n>
        После подключения синхронизация запускается сама – через
        какое-то время после того, как что-то сохранено, и при открытии
        приложения. Кнопка «Синхронизировать сейчас» останется – на
        случай, если не хочется ждать.
      </p>
      <ol class="sync-intro" style="padding-left:1.2em;display:flex;flex-direction:column;gap:.5em;">
        <li data-i18n>Заведите аккаунт на github.com, если его ещё нет – бесплатно.</li>
        <li>
          <span data-i18n>Создайте токен доступа –</span>
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=TasteID" target="_blank" rel="noopener" data-i18n>по этой ссылке</a><span data-i18n>, галочка «repo» уже отмечена. Внизу страницы – «Generate token».</span>
        </li>
        <li data-i18n>Скопируйте токен (он показывается один раз) и вставьте сюда.</li>
      </ol>
      <p class="panel-intro" data-i18n>
        Галочка «repo» даёт токену доступ ко всем вашим репозиториям на
        GitHub, не только к этому. Если репозиторий для синка уже
        создан и хочется ограничить токен только им – заведите вместо
        этого fine-grained-токен (Settings → Developer settings →
        Personal access tokens → Fine-grained tokens на github.com) с
        доступом к одному этому репозиторию и правом Contents: Read and write.
      </p>
      <div class="field">
        <label data-i18n>Токен доступа</label>
        <input type="password" id="sync-token" placeholder="ghp_…" autocomplete="off">
      </div>
      <div class="field">
        <label data-i18n>Название репозитория</label>
        <input type="text" id="sync-repo" value="tasteid-vault">
        <p class="panel-intro" data-i18n>
          Если такого репозитория ещё нет на вашем GitHub – создадим
          сами, приватным. Если уже есть (например, второе устройство
          его уже завело) – подключимся к нему.
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
    flashStatus("status-sync", false, i18n("Заполните токен и название репозитория."));
    return;
  }

  btn.disabled = true;
  flashStatus("status-sync", true, i18n("Проверяем токен…"));
  try {
    const user = await checkGithubUser(token);
    const config = { token, owner: user.login, repo };

    flashStatus("status-sync", true, i18n("Проверяем репозиторий…"));
    if (!(await repoExists(config))) {
      flashStatus("status-sync", true, i18n("Репозитория ещё нет – создаём…"));
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
        "Приложение забудет токен и репозиторий на этом устройстве. Сами данные – здесь и в репозитории – никуда не денутся, подключиться заново можно в любой момент."
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
    // резервную копию, – restoreBackup трогает только то, что
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
        i18n("Готово, но {n} файл(ов) изменились и здесь, и в репозитории – выберите, что оставить.", {
          n: result.conflicts.length,
        })
      );
      renderConflicts(config, result.conflicts);
    } else {
      // Сперва перерисовать («последняя синхронизация» обновится),
      // потом показать статус – иначе renderSyncPanel() тут же стирает
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
          ${i18n("Открывать первой")}
        </label>
      </div>
    `;
    })
    .join("");
  bindTabsDnd();
}

