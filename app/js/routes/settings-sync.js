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
        GitHub – бесплатный сайт, на котором разработчики хранят код;
        здесь он просто чужое хранилище вместо своего сервера, которого
        у TasteID нет. Приватный (закрытый от посторонних) репозиторий
        на нём – общая папка для всех ваших устройств: телефон,
        компьютер и любое ещё устройство с этим приложением по очереди
        кладут туда свои изменения и забирают чужие. Токен и служебные
        данные синхронизации при этом остаются только на этом
        устройстве, на github.com уходят только сами данные приложения.
      </p>
      <p class="sync-intro" data-i18n>
        После подключения синхронизация запускается сама – через
        какое-то время после того, как что-то сохранено, и при открытии
        приложения. Кнопка «Синхронизировать сейчас» останется – на
        случай, если не хочется ждать.
      </p>
      <ol class="sync-intro" style="padding-left:1.2em;display:flex;flex-direction:column;gap:.5em;">
        <li data-i18n>Если аккаунта на github.com ещё нет – заведите, это бесплатно и нужна только почта.</li>
        <li>
          <span data-i18n>Заведите токен – это как пароль, но не от всего аккаунта, а только на одно конкретное разрешение (в данном случае – работать с репозиториями от вашего имени). Откройте</span>
          <a href="https://github.com/settings/tokens/new?scopes=repo&description=TasteID" target="_blank" rel="noopener" data-i18n>эту ссылку</a><span data-i18n>: откроется страница на github.com, где галочка «repo» уже отмечена – ничего менять не нужно, только пролистать вниз страницы и нажать зелёную кнопку «Generate token».</span>
        </li>
        <li data-i18n>
          На той же странице, чуть выше кнопки, есть поле «Expiration»
          («Срок действия») – если хочется, чтобы синхронизация работала
          постоянно, выберите там «No expiration» («Без срока»). Любой
          конкретный срок (7/30/60/90 дней) означает, что через него
          токен перестанет действовать и синхронизация молча остановится
          – придётся завести новый токен и подключаться заново.
        </li>
        <li data-i18n>
          GitHub покажет длинную строку, начинающуюся на «ghp_» или
          «github_pat_», – это и есть токен. Он показывается только
          один раз, поэтому сразу скопируйте его (кнопка со значком
          копирования рядом с ним на странице github.com) и вставьте в
          поле ниже.
        </li>
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
          Просто оставьте как есть, если не уверены, что означает это
          название, – это техническое имя папки-хранилища на GitHub,
          самим внешним видом приложения оно никак не пользуется. Если
          такого репозитория ещё нет на вашем GitHub – создадим сами,
          приватным. Если уже есть (например, второе устройство его уже
          завело) – подключимся к нему: на всех устройствах должно быть
          одно и то же название, иначе они будут синхронизировать
          разные хранилища и не увидят данные друг друга.
        </p>
      </div>
      <button class="btn btn-primary" onclick="connectSync()" id="sync-connect-btn" data-i18n>Подключить</button>
      <div class="status-msg" id="status-sync"></div>
    `;
}

function syncConnectedHtml(config) {
  const state = getSyncState();
  const last = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString(dateLocale()) : i18n("ещё не было");
  // Фоновая синхронизация падает тихо (см. её же комментарий у
  // recordSyncError() в sync.js) – «Подключено» и дата последней
  // синхронизации сами по себе при сбое не меняются, и открыв эту
  // панель месяц спустя, можно не заметить, что синхронизации давно
  // нет (истёкший или отозванный токен – самый частый случай). Плашка
  // ниже показывает последнюю ошибку, даже если её вызвал не сам
  // человек нажатием кнопки, а фоновый запуск где-то между делом –
  // и остаётся видна, пока её не сменит либо новая ошибка, либо
  // успешная синхронизация (см. clearSyncError()).
  const lastError = getSyncError();
  const errorHtml = lastError
    ? `<p class="panel-intro" style="color:var(--red-hi);">
        ${i18n("Последняя попытка синхронизации не удалась ({when}): {message}", {
          when: new Date(lastError.at).toLocaleString(dateLocale()),
          message: esc(lastError.message),
        })}
      </p>`
    : "";
  return `
      <p class="panel-intro">
        ${i18n("Подключено к")}
        <a href="https://github.com/${esc(config.owner)}/${esc(config.repo)}" target="_blank" rel="noopener">${esc(config.owner)}/${esc(config.repo)}</a>.
        ${i18n("Последняя синхронизация: {when}.", { when: last })}
      </p>
      ${errorHtml}
      <div class="row" style="gap:10px;flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="startSync()" id="sync-now-btn" data-i18n>Синхронизировать сейчас</button>
        <button class="btn btn-ghost" onclick="disconnectSync()" data-i18n>Отключить</button>
      </div>
      <div class="status-msg" id="status-sync"></div>
      <div id="sync-progress"></div>
      <div id="sync-conflicts"></div>
      <div class="field" id="sync-token-field">
        <button type="button" class="btn btn-ghost" onclick="revealSyncToken()" id="sync-token-reveal-btn" data-i18n>Показать токен</button>
        <p class="panel-intro" data-i18n>
          Тот же токен, что был вставлен при подключении, – пригодится,
          если решите подключить ещё одно устройство позже, когда
          страница github.com с этим токеном уже наверняка будет
          закрыта.
        </p>
      </div>
    `;
}

function revealSyncToken() {
  const config = getSyncConfig();
  if (!config) return;
  const field = document.getElementById("sync-token-field");
  field.innerHTML = `
      <label data-i18n>Токен доступа</label>
      <div class="row" style="gap:10px;">
        <input type="text" id="sync-token-display" value="${esc(config.token)}" readonly style="flex:1;">
        <button type="button" class="btn btn-ghost" onclick="copySyncToken()" data-i18n>Скопировать</button>
      </div>
    `;
  applyI18n(field);
}

async function copySyncToken() {
  const config = getSyncConfig();
  if (!config) return;
  try {
    await navigator.clipboard.writeText(config.token);
    flashStatus("status-sync", true, i18n("Токен скопирован."));
  } catch {
    flashStatus(
      "status-sync",
      false,
      i18n("Не получилось скопировать – выделите его в поле выше и скопируйте вручную.")
    );
  }
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
    let repoInfo = await getRepoInfo(config);
    if (!repoInfo) {
      flashStatus("status-sync", true, i18n("Репозитория ещё нет – создаём…"));
      repoInfo = await createRepo(config);
    }
    // default_branch нужен Git Trees API при синхронизации (см. её же
    // комментарий у ensureBranch в sync.js) – раз уж он и так пришёл
    // вместе с остальными данными о репозитории, сохраняем сразу, а не
    // спрашиваем отдельным запросом при первой же синхронизации.
    config.branch = repoInfo.default_branch || "main";

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
      clearSyncError();
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
    // Тот же приём, что и у «Готово» чуть выше: сперва перерисовать
    // панель – плашка последней ошибки (см. syncConnectedHtml()) сразу
    // покажет то же самое, чем не только эта конкретная попытка, но и
    // любая следующая фоновая обернётся, если причина не разовая.
    recordSyncError(e.message);
    renderSyncPanel();
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
        <input type="text" id="tabinput-${id}" value="${tabLabels[id] || def.def}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTabEdit('${id}')">✎</button>
      </div>
    `;
    })
    .join("");
  bindTabsDnd();
}

