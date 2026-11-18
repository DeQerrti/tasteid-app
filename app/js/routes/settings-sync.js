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

  // Конфликт уже показан человеку и ждёт выбора ("Оставить моё"/"Взять
  // оттуда") – syncConnectedHtml() выше всегда рисует #sync-conflicts
  // пустым, а этот рендер мог случиться совсем не из-за конфликта
  // (например, повторный заход на вкладку) – восстанавливаем тот же
  // выбор на экране, а не тихо стираем его и уж тем более не запускаем
  // синхронизацию заново за спиной у человека.
  if (config && window.__syncConflicts?.length) {
    renderConflicts(window.__syncConfig, window.__syncConflicts);
    return;
  }
  // Конфликт, найденный автосинхронизацией, мог случиться, пока
  // человек не смотрел на эту вкладку вовсе – открыв её, сразу
  // досчитываем ещё раз и показываем, что не так, а не заставляем
  // сперва самому нажать «Синхронизировать сейчас».
  if (config && !syncInFlight && localStorage.getItem(AUTOSYNC_CONFLICTS_KEY) === "1") startSync();
}

// Страница создания репозитория на github.com с уже подставленными
// названием и «Private» (GitHub это умеет по параметрам адреса).
function syncNewRepoUrl(repo) {
  const params = new URLSearchParams({
    name: repo || "tasteid-vault",
    visibility: "private",
    description: "TasteID sync",
  });
  return `https://github.com/new?${params}`;
}

// Узкий (fine-grained) токен: имя, «без срока» и право на запись в
// содержимое репозитория GitHub подставляет сам. Сам репозиторий ссылкой
// выбрать нельзя (такого параметра у GitHub нет) – это человек отмечает
// руками, шаг 3 в инструкции.
const SYNC_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=TasteID&description=TasteID+sync&expires_in=none&contents=write";

function syncUpdateRepoLink() {
  const link = document.getElementById("sync-new-repo-link");
  const repo = document.getElementById("sync-repo")?.value.trim();
  if (link) link.href = syncNewRepoUrl(repo);
}

// Не подключено: короткие шаги – сразу, над полями (раньше всё было под
// свёрнутым «Как это работает», и новичок видел поля «Токен» и
// «Репозиторий» раньше, чем узнавал, откуда их взять). Токен –
// узкий, только на один репозиторий (ноябрь 2026, по аудиту): прежний
// классический с галочкой «repo» давал доступ ко ВСЕМ репозиториям
// человека, и утечка токена открывала их все. Узкий не умеет создавать
// репозитории – поэтому репозиторий человек создаёт сам (шаг 2), а
// приложение к нему подключается. Классический остался запасным путём
// в «Как это работает».
function syncSetupHtml() {
  return `
      <p class="panel-intro" data-i18n>
        Синхронизация между вашими устройствами через приватный репозиторий
        на GitHub – бесплатно и без своего сервера.
      </p>
      <ol class="sync-intro sync-steps">
        <li data-i18n>Если аккаунта на github.com ещё нет – заведите, это бесплатно и нужна только почта.</li>
        <li>
          <span data-i18n>Создайте приватный репозиторий – общую папку для ваших устройств:</span>
          <a id="sync-new-repo-link" href="${esc(syncNewRepoUrl("tasteid-vault"))}" target="_blank" rel="noopener" data-i18n>открыть страницу создания</a><span data-i18n>. Название и «Private» уже подставлены – нажмите зелёную кнопку «Create repository». Если синхронизация уже подключена на другом устройстве, этот шаг пропустите: репозиторий уже есть.</span>
        </li>
        <li>
          <span data-i18n>Создайте токен – пропуск только к этому репозиторию:</span>
          <a href="${esc(SYNC_TOKEN_URL)}" target="_blank" rel="noopener" data-i18n>открыть страницу токена</a><span data-i18n>. Имя, срок «без срока» и право на запись уже подставлены. Одно нужно выбрать руками: в разделе «Repository access» отметьте «Only select repositories» и выберите в списке репозиторий из шага 2. Потом внизу страницы – зелёная кнопка «Generate token».</span>
        </li>
        <li data-i18n>
          GitHub покажет длинную строку, начинающуюся на «github_pat_», – это
          и есть токен. Он показывается только один раз: сразу скопируйте его
          и вставьте в поле ниже.
        </li>
      </ol>
      <div class="field">
        <label data-i18n>Токен доступа</label>
        <input type="password" id="sync-token" placeholder="github_pat_…" autocomplete="off">
      </div>
      <div class="field">
        <label data-i18n>Название репозитория</label>
        <input type="text" id="sync-repo" value="tasteid-vault" oninput="syncUpdateRepoLink()">
      </div>
      <button class="btn btn-primary" onclick="connectSync()" id="sync-connect-btn" data-i18n>Подключить</button>
      <div class="status-msg" id="status-sync"></div>
      <details class="sync-how">
        <summary data-i18n>Как это работает и что делать, если не получилось</summary>
        <div class="sync-how-body">
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
      <p class="panel-intro" data-i18n>
        Название репозитория – техническое имя папки-хранилища на GitHub.
        На всех устройствах оно должно быть одним и тем же, иначе они
        будут синхронизировать разные хранилища и не увидят данные друг
        друга. Если не уверены – оставьте «tasteid-vault».
      </p>
      <p class="panel-intro">
        <span data-i18n>Если с токеном на один репозиторий не получается, можно завести классический токен:</span>
        <a href="https://github.com/settings/tokens/new?scopes=repo&description=TasteID" target="_blank" rel="noopener" data-i18n>эта ссылка</a><span data-i18n> откроет страницу, где галочка «repo» уже отмечена. С ним репозиторий из шага 2 можно не создавать – приложение заведёт его само. Но такой токен даёт доступ ко всем вашим репозиториям на GitHub, а не к одному, – поэтому он только запасной вариант.</span>
      </p>
        </div>
      </details>
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
  // Одна строка: слева «● Подключено к репозиторию» и время последней
  // синхронизации, справа главная кнопка, а «Показать токен» и «Отключить» –
  // тихими ссылками рядом (раньше «Отключить» стоял вплотную к главной кнопке,
  // а «Показать токен» – отдельным рядом ниже через большой зазор).
  return `
      <div class="set-row sync-row">
        <div class="set-row-main">
          <div class="set-row-title"><span class="sync-dot" aria-hidden="true"></span>${i18n("Подключено к")}
            <a href="https://github.com/${esc(config.owner)}/${esc(config.repo)}" target="_blank" rel="noopener">${esc(config.owner)}/${esc(config.repo)}</a></div>
          <div class="set-row-sub">${i18n("Последняя синхронизация: {when}.", { when: last })}</div>
        </div>
        <div class="set-row-ctl">
          <button class="btn btn-primary" onclick="startSync()" id="sync-now-btn" data-i18n>Синхронизировать сейчас</button>
          <span class="set-links">
            <button type="button" class="link-btn" onclick="revealSyncToken()" id="sync-token-reveal-btn" data-i18n>Показать токен</button>
            <button type="button" class="link-btn" onclick="disconnectSync()" data-i18n>Отключить</button>
          </span>
        </div>
      </div>
      ${errorHtml}
      <div class="status-msg" id="status-sync"></div>
      <div id="sync-progress"></div>
      <div id="sync-conflicts"></div>
      <div class="field" id="sync-token-field"></div>
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
      // Узкий токен (шаг 3 инструкции) создавать репозитории не умеет, а
      // репозиторий, к которому его не допустили, GitHub для него
      // показывает как несуществующий. Пробуем создать (получится с
      // классическим токеном), а не вышло – объясняем, что сделать, вместо
      // голого «Resource not accessible by personal access token».
      flashStatus("status-sync", true, i18n("Репозитория ещё нет – создаём…"));
      try {
        repoInfo = await createRepo(config);
      } catch {
        throw new Error(
          i18n(
            "Репозиторий «{repo}» не найден, или токен к нему не допущен. Если репозиторий ещё не создан – создайте его (шаг 2) и нажмите «Подключить» снова. Если создан – проверьте, что при создании токена в «Repository access» был выбран именно он, и что название здесь совпадает с названием на GitHub.",
            { repo }
          )
        );
      }
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
  if (syncInFlight) {
    // Молчаливый return тут раньше означал "нажатие вообще без следа" –
    // если синхронизация уже идёт в фоне (запущена автосинком при
    // открытии приложения или после сохранения где-то ещё, и на большом
    // хранилище может занимать минуту и больше), нажатие кнопки просто
    // ничего не делало, и со стороны выглядело так, будто кнопка не
    // работает. Теперь хотя бы видно, что дело не в этом.
    flashStatus("status-sync", true, i18n("Синхронизация уже идёт в фоне – подождите немного."));
    return;
  }
  syncInFlight = true;
  const btn = document.getElementById("sync-now-btn");
  if (btn) btn.disabled = true;
  const conflictsEl = document.getElementById("sync-conflicts");
  if (conflictsEl) conflictsEl.innerHTML = "";
  flashStatus("status-sync", true, i18n("Синхронизируем…"));

  try {
    const config = getSyncConfig();
    // Синхронизация – это долгий цикл await'ов (по файлу за раз), и всё
    // это время человек мог уйти с вкладки "Синхронизация" (или вовсе
    // с #/settings-edit) – #sync-progress к следующему тику прогресса
    // мог уже не существовать. Без проверки document.getElementById(...)
    // .textContent = ... на null падало с "Cannot set properties of
    // null" прямо посреди фоновой синхронизации – и это тут же
    // становилось видимой пользователю "ошибкой синхронизации", хотя
    // сама синхронизация к этому моменту уже сделала своё дело.
    const result = await runSync(config, (done, total, path) => {
      const progressEl = document.getElementById("sync-progress");
      if (progressEl) progressEl.textContent = `${done} / ${total}: ${path}`;
    });
    const progressEl = document.getElementById("sync-progress");
    if (progressEl) progressEl.textContent = "";

    // Забранные файлы и картинки runSync записывает в хранилище сам и
    // сам проверяет, что запись прошла (см. её же комментарий в
    // js/sync.js) – здесь остаётся только показать итог.

    if (result.conflicts.length) {
      flashStatus(
        "status-sync",
        false,
        i18n("Готово, но изменились и здесь, и в репозитории файлы: {n} – выберите, что оставить.", {
          n: result.conflicts.length,
        })
      );
      renderConflicts(config, result.conflicts);
      // Перезагрузка страницы ниже – только для случая без конфликтов.
      // Раньше она была общей на оба случая: если в том же заходе
      // что-то ещё и забралось успешно (обычное дело – конфликт часто
      // только в одном файле из многих), страница перезагружалась через
      // 1.2 секунды и стирала только что показанный выбор "Оставить
      // моё"/"Взять оттуда" ещё до того, как человек успевал его
      // увидеть – а на перезагруженной странице конфликт всё ещё не
      // решён (localStorage это помнит), и цикл "конфликт → тихая
      // перезагрузка → конфликт" мог повторяться бесконечно.
      return;
    }
    // Сперва перерисовать («последняя синхронизация» обновится),
    // потом показать статус – иначе renderSyncPanel() тут же стирает
    // status-sync вместе со всей панелью, и человек не успевает
    // увидеть «Готово» ни на миг.
    clearSyncError();
    renderSyncPanel();
    // deletedLocally – файлы, которые кто-то удалил на другом
    // устройстве, пока они ещё физически лежали здесь (см. её же
    // комментарий у syncOne в js/sync.js); отдельной строкой, только
    // когда такое правда случилось, чтобы не загромождать обычный
    // статус на пустом месте.
    let doneMsg = i18n("Готово: отправлено {pushed}, забрано {pulled}, без изменений {skipped}.", result);
    if (result.deletedLocally) {
      doneMsg += " " + i18n("Убрано отсюда как удалённое на другом устройстве: {n}.", { n: result.deletedLocally });
    }
    // Файлы, изменённые и здесь, и на другом устройстве, которые удалось
    // слить по записям без вопроса (tryMergeConflict в js/sync.js).
    if (result.merged) {
      doneMsg += " " + i18n("Правки с двух устройств объединены: {n}.", { n: result.merged });
    }
    // Синхронизация хотела удалить слишком много картинок разом и не
    // стала (см. SYNC_MASS_DELETE_MIN в js/sync.js) – об этом обязательно
    // сказать, иначе непонятно, почему картинки в репозитории и здесь
    // расходятся.
    if (result.blockedDeletes) {
      doneMsg +=
        " " +
        i18n(
          "В репозитории не хватает {n} картинок, которые есть здесь. Удалять их отсюда не стали – похоже на сбой, а не на удаление. Если вы правда удаляли их на другом устройстве, удалите и здесь вручную.",
          { n: result.blockedDeletes }
        );
    }
    if (result.repoReset) {
      doneMsg += " " + i18n("Репозиторий был пуст – данные этого устройства отправлены в него заново.");
    }
    // Пропущенные картинки называем по именам: «не читается» без имени
    // файла – ровно то, с чем нельзя ничего сделать.
    if (result.unreadable?.length) {
      doneMsg +=
        " " +
        i18n("Не прочитались и пропущены: {list}.", {
          list: result.unreadable.slice(0, 3).join(", ") + (result.unreadable.length > 3 ? "…" : ""),
        });
    }
    flashStatus("status-sync", true, doneMsg);

    if (Object.keys(result.pulledFiles).length || Object.keys(result.pulledImages).length) {
      // Клик по .side-tab на ПК не трогает URL вовсе (переключение чисто
      // визуальное, сайдбар и так виден всегда – см. её же комментарий в
      // settings-edit.js), так что адресная строка оставалась на
      // "#/settings-edit" без ?panel=sync, даже когда открыта именно
      // «Синхронизация». Перезагрузка страницы без этой строки после
      // себя открывала панель по умолчанию («Оформление»), а не ту, на
      // которой стояли, – человек только что забрал что-то с другого
      // устройства и тут же оказывался неизвестно где, будто его
      // "выкинуло" из синхронизации.
      history.replaceState(null, "", "#/settings-edit?panel=sync");
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
  window.__syncConflicts = conflicts;
  window.__syncConfig = config;
  // Панель настроек могла закрыться, пока синхронизация ещё шла (см. её
  // же комментарий у #sync-progress в startSync()) – состояние конфликта
  // выше уже сохранено (renderSyncPanel() при следующем открытии вкладки
  // его восстановит, см. её же комментарий там), а вот саму разметку
  // писать уже некуда.
  if (!box) return;
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
}

async function pickConflict(index, choice) {
  const conflict = window.__syncConflicts[index];
  // Здесь файл пустой, а в репозитории – нет (см. syncEmptyLocalFile в
  // js/sync.js): «Оставить моё» сотрёт эти данные на всех устройствах.
  // Такое бывает только по ошибке – спрашиваем отдельно.
  if (
    choice === "local" &&
    conflict.localEmpty &&
    !(await confirmDialog(
      i18n(
        "На этом устройстве «{path}» пустой, а в репозитории в нём есть данные. Если оставить пустой, данные пропадут на всех устройствах. Точно оставить пустой?",
        { path: conflict.path }
      ),
      i18n("Оставить пустой"),
      i18n("Отмена"),
      { strict: true }
    ))
  ) {
    return;
  }
  try {
    // «Взять оттуда» resolveConflict записывает в хранилище сам (см. её
    // же комментарий в js/sync.js); не записалось – бросит ошибку, и
    // конфликт останется в списке.
    await resolveConflict(window.__syncConfig, conflict, choice);
    window.__syncConflicts.splice(index, 1);
    if (window.__syncConflicts.length) {
      renderConflicts(window.__syncConfig, window.__syncConflicts);
    } else {
      document.getElementById("sync-conflicts").innerHTML = "";
      localStorage.setItem(AUTOSYNC_CONFLICTS_KEY, "");
      flashStatus("status-sync", true, i18n("Конфликты решены."));
      // См. её же комментарий у похожей перезагрузки в startSync() выше –
      // без этой строки перезагрузка открывала бы панель по умолчанию
      // вместо «Синхронизации».
      if (choice === "remote") {
        history.replaceState(null, "", "#/settings-edit?panel=sync");
        setTimeout(() => location.reload(), 900);
      }
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
      <div class="tab-row${hiddenTabsState.has(id) ? " is-hidden" : ""}" id="tabrow-${id}" data-id="${id}" draggable="true">
        <span class="drag-handle" title="${i18n("Перетащить")}">⠿</span>
        ${eyeButton(hiddenTabsState.has(id), `hiddenTabsState.has('${id}') ? hiddenTabsState.delete('${id}') : hiddenTabsState.add('${id}'); renderTabsList(); settingsDirty = true;`)}
        <span class="tab-name" id="tabname-${id}">${tabLabels[id] || def.def}</span>
        <input type="text" id="tabinput-${id}" value="${tabLabels[id] || def.def}" onkeydown="if(event.key==='Enter')this.blur();">
        <button class="icon-btn" title="${i18n("Переименовать")}" onclick="toggleTabEdit(${jsArg(id)})">✎</button>
      </div>
    `;
    })
    .join("");
  bindTabsDnd();
}

