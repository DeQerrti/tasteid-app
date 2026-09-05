// ══════════════════════════════════════════════
//  СИНХРОНИЗАЦИЯ ЧЕРЕЗ GITHUB
//
//  Бесплатный способ синхронизировать несколько устройств (телефон,
//  компьютер, ещё один компьютер) без своего сервера: приватный
//  репозиторий на GitHub как общее хранилище, а сам GitHub – единственный
//  сервер во всей схеме.
//
//  Токен и служебное состояние синхронизации хранятся только на этом
//  устройстве (localStorage) и никогда не входят ни в резервную копию,
//  ни в паспорт – иначе токен уехал бы вместе с данными куда угодно,
//  куда их перенесут.
//
//  Payload синхронизации – то же самое, что отдаёт /api/export-backup:
//  общий с резервной копией формат, только едет не в файл на диск, а в
//  GitHub-репозиторий, файл за файлом. Внутри этого файла всё в одном
//  виде – base64, том самом, которым Contents API отдаёт и принимает
//  содержимое (файлы данных кодируются в base64 на границе, картинки в
//  экспорте и так уже в base64).
//
//  ПРОТОКОЛ. У каждого файла есть три состояния: что лежит локально
//  сейчас, что лежит в репозитории сейчас, и что было тут и там при
//  прошлой успешной синхронизации (state.files[путь] – хеш и sha).
//  Совпадает текущее с прошлым локальным – значит, здесь ничего не
//  менялось. Так же для удалённого. Отсюда четыре исхода:
//
//    ничего не менялось нигде       →  пропустить
//    менялось только здесь          →  отправить (push)
//    менялось только в репозитории  →  забрать (pull)
//    менялось и там, и там          →  конфликт, решает человек
//
//  Sha-версии GitHub попутно защищают от гонки: если кто-то другой
//  успел записать файл между чтением и отправкой, PUT с устаревшим sha
//  отклоняется сервером, а не тихо затирает чужую правку.
// ══════════════════════════════════════════════

// ── Ключи в localStorage – привязаны к хранилищу ────
// window.__TASTEID.vaultId – то же самое место, откуда i18n.js
// синхронно берёт lang (см. её же комментарий там): на компьютере его
// вписывает electron/protocol.js прямо в HTML, на телефоне –
// mobile/src/main.js тем же приёмом. Не меняется без полной
// перезагрузки страницы – переключение хранилища всегда её делает
// (см. switchVault() в settings-app.js), поэтому его можно прочитать
// один раз здесь же, при загрузке файла.
//
// Токен синхронизации, её состояние и загруженный чужой паспорт
// (см. GUEST_KEY в passports.js) – это данные ПРО ОДНО хранилище: у
// каждого свой репозиторий на GitHub, своя библиотека для сравнения.
// А localStorage при этом общий на всё приложение – один и тот же
// браузерный склад видит любое хранилище, открытое на этом
// устройстве, одинаково. Без разделения по хранилищу это означало:
// завёл новое (по описанию – "абсолютно чистое, с нуля") – а в нём
// тут же оказывалась синхронизация и загруженный чужой паспорт из
// старого. Хуже того – фоновая автосинхронизация нового, пустого
// хранилища тут же отправляла эту пустоту в чужой репозиторий, а
// следующая синхронизация СТАРОГО хранилища следом забирала пустоту
// обратно и стирала настоящие данные. Реальный случай, не гипотеза.
function currentVaultId() {
  return (typeof window !== "undefined" && window.__TASTEID?.vaultId) || "default";
}
function vaultScopedKey(base) {
  return `${base}:${currentVaultId()}`;
}

const SYNC_CONFIG_KEY = vaultScopedKey("tasteid_sync_config"); // { token, owner, repo }
const SYNC_STATE_KEY = vaultScopedKey("tasteid_sync_state"); // { files: {путь:{hash,sha}}, images: {путь:{hash,sha}}, lastSyncAt }
// { message, at } последней неудачной попытки – фоновая runAutoSync()
// раньше падала совсем тихо (см. её же комментарий ниже): токен истёк
// или отозван – а панель настроек продолжала как ни в чём не бывало
// показывать «Подключено» и старую дату последней синхронизации,
// потому что ни то, ни другое не меняется при сбое. Разница видна
// только если руками нажать «Синхронизировать сейчас» и прочитать
// ошибку – через месяц-другой человек может об этом уже не вспомнить.
// Сохраняем последнюю ошибку сюда и показываем её в самой панели, пока
// её не сменит либо новая ошибка, либо успешная синхронизация.
const SYNC_LAST_ERROR_KEY = vaultScopedKey("tasteid_sync_last_error");
// Тот же флаг читают и ручная кнопка, и автосинхронизация – не важно,
// кто досчитал до конфликта последним, важно, что он есть или его нет
// (см. её же использование у runSync/clearSyncConfig ниже).
const AUTOSYNC_CONFLICTS_KEY = vaultScopedKey("tasteid_sync_has_conflicts");

// Мигрируем то, что уже сохранено под старым, общим на все хранилища
// ключом, – но только один раз и только если под новым, привязанным к
// хранилищу ключом ещё пусто (не затираем то, что уже разделили).
// Для всех, кто подключил синхронизацию до этого исправления, она
// продолжает работать без переподключения – просто теперь считается
// принадлежащей тому хранилищу, которое было открыто первым после
// обновления (обычно оно и есть единственное, которое у человека уже
// было). Хранилища, заведённые позже, начинают с чистого листа, как и
// должны.
(function migrateLegacySyncKeys() {
  const LEGACY_TO_SCOPED = {
    tasteid_sync_config: SYNC_CONFIG_KEY,
    tasteid_sync_state: SYNC_STATE_KEY,
    tasteid_sync_last_error: SYNC_LAST_ERROR_KEY,
    tasteid_sync_has_conflicts: AUTOSYNC_CONFLICTS_KEY,
  };
  try {
    for (const [legacyKey, scopedKey] of Object.entries(LEGACY_TO_SCOPED)) {
      if (legacyKey === scopedKey) continue; // "default" хранилище – уже тот же ключ
      if (localStorage.getItem(scopedKey) !== null) continue;
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) continue;
      localStorage.setItem(scopedKey, legacyValue);
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // localStorage недоступен (приватный режим и т.п.) – без миграции,
    // но не роняем остальной код из-за этого.
  }
})();

function recordSyncError(message) {
  try {
    localStorage.setItem(SYNC_LAST_ERROR_KEY, JSON.stringify({ message, at: new Date().toISOString() }));
  } catch {
    // localStorage недоступен (приватный режим и т.п.) – без плашки, но
    // хотя бы сама синхронизация уже отработала своё, ничего не роняем.
  }
}

function clearSyncError() {
  localStorage.removeItem(SYNC_LAST_ERROR_KEY);
}

function getSyncError() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_LAST_ERROR_KEY)) || null;
  } catch {
    return null;
  }
}

// ── Плашка о сломанной синхронизации ────────────
// Панель настроек и так показывает последнюю ошибку (см. её же
// комментарий у SYNC_LAST_ERROR_KEY выше), но человек заглядывает туда
// не каждый день – токен может быть мёртв неделями незамеченным.
// Плашка посреди экрана, как у обновления версии (см. showUpdateBanner
// в mobile/src/main.js – тот же приём: одна и та же .modal-overlay
// строится один раз и переиспользуется), не даёт синхронизации молча
// сломаться навсегда.
//
// Показываем один раз на каждую ОШИБКУ, а не один раз за сеанс: если
// человек нажал «Скрыть», а следом синхронизация подряд ещё раз
// упадёт с новой ошибкой (новым `at`), это уже другая проблема (или та
// же, но не решённая) – стоит напомнить снова, а не молчать до
// перезапуска.
const SYNC_ERROR_DISMISSED_KEY = vaultScopedKey("tasteid_sync_error_dismissed_at");
let syncErrorBannerEl = null;

function hideSyncErrorBanner() {
  syncErrorBannerEl?.classList.add("hidden");
}

function showSyncErrorBanner(error) {
  if (!syncErrorBannerEl) {
    syncErrorBannerEl = document.createElement("div");
    syncErrorBannerEl.id = "sync-error-overlay";
    syncErrorBannerEl.className = "modal-overlay hidden";
    syncErrorBannerEl.innerHTML =
      '<div class="modal confirm-dialog">' +
      '<div class="confirm-dialog-text" id="sync-error-text"></div>' +
      '<div class="confirm-dialog-actions">' +
      '<button type="button" class="btn btn-ghost" id="sync-error-dismiss"></button>' +
      '<button type="button" class="btn btn-primary" id="sync-error-settings"></button>' +
      "</div></div>";
    document.body.appendChild(syncErrorBannerEl);
  }

  const textEl = syncErrorBannerEl.querySelector("#sync-error-text");
  const dismissBtn = syncErrorBannerEl.querySelector("#sync-error-dismiss");
  const settingsBtn = syncErrorBannerEl.querySelector("#sync-error-settings");

  textEl.textContent = i18n("Синхронизация с GitHub не работает: {message}", { message: error.message });
  dismissBtn.textContent = i18n("Скрыть");
  settingsBtn.textContent = i18n("Настройки");

  const dismiss = () => {
    localStorage.setItem(SYNC_ERROR_DISMISSED_KEY, error.at);
    hideSyncErrorBanner();
  };
  dismissBtn.onclick = dismiss;
  settingsBtn.onclick = () => {
    localStorage.setItem(SYNC_ERROR_DISMISSED_KEY, error.at);
    hideSyncErrorBanner();
    openSettingsPanel("sync");
  };

  syncErrorBannerEl.classList.remove("hidden");
}

function checkSyncErrorBanner() {
  if (!getSyncConfig()) return;
  const error = getSyncError();
  if (!error || localStorage.getItem(SYNC_ERROR_DISMISSED_KEY) === error.at) return;
  showSyncErrorBanner(error);
}

function getSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
}

function clearSyncConfig() {
  localStorage.removeItem(SYNC_CONFIG_KEY);
  localStorage.removeItem(SYNC_STATE_KEY);
  localStorage.removeItem(AUTOSYNC_CONFLICTS_KEY);
  localStorage.removeItem(SYNC_LAST_ERROR_KEY);
  localStorage.removeItem(SYNC_ERROR_DISMISSED_KEY);
  hideSyncErrorBanner();
}

// Переход на вкладку «Синхронизация» в настройках из плашки об ошибке
// выше – через хэш-навигацию: #/settings-edit сам может быть уже
// открыт (тогда просто перечитает ?panel= заново, см. её же комментарий
// в settings-edit.js) или ещё нет (тогда смонтируется с нуля сразу на
// нужном разделе).
function openSettingsPanel(panel) {
  location.hash = `#/settings-edit?panel=${panel}`;
}

function getSyncState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_STATE_KEY));
    return raw && typeof raw === "object" ? { files: {}, images: {}, ...raw } : { files: {}, images: {} };
  } catch {
    return { files: {}, images: {} };
  }
}

function saveSyncState(state) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

// ── base64 ↔ текст ──────────────────────────────
// btoa/atob работают побайтово: для текста с кириллицей это не то же
// самое, что сам текст, и без прохода через UTF-8 многобайтные символы
// бы побились. Картинок это не касается – они уже приходят и уходят
// готовым base64, эти функции их не трогают.
function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}
function base64ToText(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

// ── GitHub REST API ─────────────────────────────

class SyncError extends Error {}

// config.token может отсутствовать – например, чтение секретного гиста
// по id не требует авторизации вовсе. Раньше здесь всегда стоял
// заголовок Authorization: Bearer undefined – GitHub принимал его не
// как «без токена», а как настоящий, но неверный токен, и отвечал 401
// там, где анонимный запрос прошёл бы.
async function githubApi(config, path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method,
      // GitHub отдаёт список файлов репозитория (getRepoTree ниже) с
      // обычными заголовками кеширования – две синхронизации подряд
      // (например, сразу после создания нового файла) иначе могли бы
      // получить старый список из кеша браузера, ещё не знающий об
      // только что созданном файле. Дальше код решает "этого файла
      // нет" и пытается создать его снова без sha – GitHub отвечает
      // "sha wasn't supplied", хотя файл уже есть. Синхронизации важна
      // именно свежая правда, не что угодно из кеша.
      cache: "no-store",
      headers: {
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError(
      i18n("Не получилось достучаться до GitHub – проверьте соединение с интернетом.")
    );
  }

  if (res.status === 401) {
    throw new SyncError(i18n("GitHub не принял токен – проверьте, что он не истёк и не отозван."));
  }
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if (/rate limit/i.test(data.message || "")) {
      throw new SyncError(
        i18n("GitHub временно ограничил число запросов – попробуйте через несколько минут.")
      );
    }
    throw new SyncError(i18n("У токена не хватает прав на этот репозиторий."));
  }
  return res;
}

async function checkGithubUser(token) {
  const res = await githubApi({ token }, "/user");
  if (!res.ok) throw new SyncError(i18n("Не получилось проверить токен."));
  return res.json(); // { login, ... }
}

// Возвращает данные репозитория (в т.ч. default_branch – нужен ниже
// для Git Trees API) или null, если репозитория ещё нет.
async function getRepoInfo(config) {
  const res = await githubApi(config, `/repos/${config.owner}/${config.repo}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError(i18n("Не получилось проверить репозиторий."));
  return res.json();
}

async function createRepo(config) {
  const res = await githubApi({ token: config.token }, "/user/repos", {
    method: "POST",
    body: {
      name: config.repo,
      private: true,
      description: i18n("Хранилище TasteID для синхронизации между устройствами"),
      auto_init: true,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new SyncError(data.message || i18n("Не получилось создать репозиторий."));
  }
  return res.json();
}

// config.branch – ветка репозитория, нужна Git Trees API ниже. У новых
// подключений (см. connectSync()) она уже приходит вместе с остальным
// конфигом – сюда попадают только конфиги, сохранённые до появления
// этого поля: тогда спрашиваем и запоминаем на будущее, чтобы не
// делать этот же запрос при каждой следующей синхронизации.
async function ensureBranch(config) {
  if (config.branch) return config.branch;
  const info = await getRepoInfo(config);
  config.branch = info?.default_branch || "main";
  saveSyncConfig(config);
  return config.branch;
}

// ── Список файлов репозитория одним запросом ────
// Раньше syncOne() узнавал состояние КАЖДОГО файла отдельным запросом
// Contents API – при 800+ файлах в хранилище это 800+ запросов на
// каждую синхронизацию, даже когда поменялась одна запись. Git Trees
// API отдаёт путь и sha сразу всех файлов репозитория одним запросом –
// runSync() дальше зовёт Contents API поштучно только для файлов,
// которые эта сверка и правда пометила спорными (см. её же комментарий
// у syncOne).
async function getRepoTree(config) {
  const branch = await ensureBranch(config);
  const res = await githubApi(
    config,
    `/repos/${config.owner}/${config.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
  if (res.status === 404) return new Map(); // ветки/коммитов ещё нет – пустой репозиторий
  if (!res.ok) throw new SyncError(i18n("Не получилось получить список файлов репозитория."));
  const data = await res.json();
  // truncated – список неполный (десятки тысяч файлов, за пределы
  // этого приложения на практике не выходит, но на всякий случай не
  // делаем вид, что список полный: null дальше по коду включает
  // прежний, поштучный способ проверки для этой конкретной синхронизации.
  if (data.truncated) return null;
  const map = new Map();
  for (const entry of data.tree || []) {
    if (entry.type === "blob") map.set(entry.path, entry.sha);
  }
  return map;
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// Contents API отдаёт файл вместе с его sha – sha и есть версия файла
// для PUT ниже. 404 – файла ещё нет, это не ошибка. GitHub режет
// base64 на строки по 60 символов – переносы строк из content нужно
// убрать перед использованием.
async function getRemoteFile(config, path) {
  const res = await githubApi(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new SyncError(i18n("Не получилось прочитать файл из репозитория: {path}", { path }));
  }
  const data = await res.json();
  return { base64: data.content.replace(/\n/g, ""), sha: data.sha };
}

async function putRemoteFile(config, path, base64, sha) {
  const res = await githubApi(
    config,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`,
    {
      method: "PUT",
      body: { message: i18n("Синхронизация TasteID"), content: base64, ...(sha ? { sha } : {}) },
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // Отправляли без sha, думая, что файла на GitHub ещё нет (см. её
    // же комментарий у cache: "no-store" в githubApi – обычно дело в
    // кеше), а он там уже есть – GitHub отвечает как раз про sha.
    // Не роняем синхронизацию из-за одного файла: узнаём настоящий
    // sha и пробуем ещё раз, один раз.
    if (!sha && /sha/i.test(data.message || "")) {
      const remote = await getRemoteFile(config, path);
      if (remote) return putRemoteFile(config, path, base64, remote.sha);
    }
    throw new SyncError(data.message || i18n("Не получилось отправить файл: {path}", { path }));
  }
  return (await res.json()).content.sha;
}

// ── Хеш содержимого ──────────────────────────────
// Не для защиты, а для короткого и быстрого сравнения «то же самое
// или нет» – SHA-256 из Web Crypto есть везде, где есть этот код.
// Хешируем сам base64 – он у файла один и тот же при любом повторном
// экспорте того же содержимого, сравнивать удобнее, чем разбирать JSON.
async function contentHash(base64) {
  const bytes = new TextEncoder().encode(base64);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Один файл: решить, что с ним делать, и сделать ─
// localBase64 – текущее содержимое, уже в base64. entry – {hash, sha}
// из прошлой синхронизации, либо undefined, если файл ещё ни разу не
// синхронизировался. remoteTree – Map(путь → sha) из getRepoTree(),
// одна на всю синхронизацию: с её помощью решаем, менялся ли файл в
// репозитории, без отдельного запроса на каждый файл. Содержимое
// (Contents API, отдельный запрос) тянем только там, где sha одного
// bulk-списка не хватает – сравнить контент при споре или правда
// забрать то, что изменилось только на стороне репозитория.
async function syncOne(config, path, localBase64, entry, remoteTree) {
  const localHash = await contentHash(localBase64);

  // remoteTree === null – Git Trees API вернул усечённый список (см.
  // её же комментарий у getRepoTree): для этой синхронизации бы
  // рискнули пропустить часть файлов, поэтому просто возвращаемся к
  // прежнему способу – проверить именно этот файл отдельным запросом.
  if (!remoteTree) return syncOneByFetch(config, path, localBase64, localHash, entry);

  const remoteSha = remoteTree.get(path);
  const localChanged = !entry || entry.hash !== localHash;
  const remoteChanged = !entry || remoteSha === undefined || entry.sha !== remoteSha;

  if (!localChanged && !remoteChanged) {
    return { action: "none", hash: localHash, sha: remoteSha };
  }

  if (remoteSha === undefined) {
    // В репозитории файла ещё нет вообще – отправляем, конфликтовать не с чем.
    const sha = await putRemoteFile(config, path, localBase64);
    return { action: "push", hash: localHash, sha };
  }

  if (localChanged && remoteChanged) {
    // Спорный файл – здесь и только здесь нужно настоящее содержимое
    // с той стороны, не только его sha из общего списка.
    const remote = await getRemoteFile(config, path);
    if (!remote) {
      // Файл успели удалить в промежутке между списком и этим запросом
      // (гонка, крайне маловероятная) – отправляем свою версию, как при
      // отсутствующем файле выше.
      const sha = await putRemoteFile(config, path, localBase64);
      return { action: "push", hash: localHash, sha };
    }
    // Сперва самый частый случай: содержимое совпадает. Так бывает не
    // только «на всякий случай» – так выглядит любая синхронизация без
    // entry: переустановили приложение, почистили данные браузера,
    // завели второе устройство из скопированной папки. Файлы при этом
    // байт в байт одинаковые, и разрешать тут нечего – но без этой
    // проверки каждый из них (включая каждую картинку!) уезжал в
    // конфликты, и человек получал список на сотни строк, где надо
    // руками выбрать сторону, хотя стороны две одинаковые.
    if ((await contentHash(remote.base64)) === localHash) {
      return { action: "none", hash: localHash, sha: remote.sha };
    }
    // Содержимое правда разное: и здесь, и там поменяли с прошлого раза
    // (или прошлого раза не было вовсе, и оба варианта не пустые) –
    // который новее, решить самим нечем.
    return { action: "conflict", localBase64, remote, localHash };
  }

  if (localChanged) {
    // Remote не менялся – его sha из общего списка уже точно тот, что
    // нужен для PUT, отдельным запросом за содержимым идти незачем.
    const sha = await putRemoteFile(config, path, localBase64, remoteSha);
    return { action: "push", hash: localHash, sha };
  }

  // Только remote изменился – содержимое нужно забрать по-настоящему,
  // одного sha для этого недостаточно.
  const remote = await getRemoteFile(config, path);
  if (!remote) {
    // Файл удалили в репозитории в промежутке между списком и этим
    // запросом – ничего не делаем, следующая синхронизация разберётся
    // по свежему списку.
    return { action: "none", hash: localHash, sha: entry?.sha };
  }
  return { action: "pull", base64: remote.base64, sha: remote.sha };
}

// Картинка, которой на этом устройстве ещё нет вообще (ни файла, ни
// записи в state.images – см. её же комментарий у newRemoteImages в
// runSync). syncOne() сюда не подходит: он с самого начала считает
// хеш ЛОКАЛЬНОГО содержимого и сравнивает его с удалённым – а тут
// сравнивать нечего, содержимого нет никакого, только сам факт, что
// путь есть у кого-то другого. Тянем прямо, без разговора о конфликте:
// конфликтовать может только с чем-то, что уже есть с нашей стороны.
async function pullNewRemoteImage(config, path) {
  const remote = await getRemoteFile(config, path);
  if (!remote) return { action: "none" }; // сняли из репозитория в last-second – и ладно
  return { action: "pull", base64: remote.base64, sha: remote.sha };
}

// Прежний, поштучный способ – запасной вариант на случай усечённого
// bulk-списка (см. её же комментарий у syncOne). Логика ровно та же,
// что была раньше, просто больше не единственный путь.
async function syncOneByFetch(config, path, localBase64, localHash, entry) {
  const remote = await getRemoteFile(config, path);

  const localChanged = !entry || entry.hash !== localHash;
  const remoteChanged = !entry || !remote || entry.sha !== remote.sha;

  if (!localChanged && !remoteChanged) {
    return { action: "none", hash: localHash, sha: remote?.sha };
  }

  if (!remote) {
    const sha = await putRemoteFile(config, path, localBase64);
    return { action: "push", hash: localHash, sha };
  }

  if (localChanged && remoteChanged) {
    if ((await contentHash(remote.base64)) === localHash) {
      return { action: "none", hash: localHash, sha: remote.sha };
    }
    return { action: "conflict", localBase64, remote, localHash };
  }

  if (localChanged) {
    const sha = await putRemoteFile(config, path, localBase64, remote.sha);
    return { action: "push", hash: localHash, sha };
  }

  return { action: "pull", base64: remote.base64, sha: remote.sha };
}

// ── Полная синхронизация ────────────────────────
// Возвращает { pushed, pulled, skipped, conflicts, pulledFiles, pulledImages }.
// pulledFiles/pulledImages готовы к передаче в /api/restore-backup –
// тем же путём, каким резервная копия восстанавливает файлы.
async function runSync(config, onProgress) {
  const state = getSyncState();
  const backup = await (await fetch("/api/export-backup")).json();
  // Один запрос на весь список файлов репозитория вместо одного на
  // каждый файл (см. её же комментарий у getRepoTree/syncOne) – самая
  // частая синхронизация (несколько файлов реально изменились из
  // сотен) обходится парой запросов вместо сотен.
  const remoteTree = await getRepoTree(config);

  const result = {
    pushed: 0,
    pulled: 0,
    skipped: 0,
    conflicts: [],
    pulledFiles: {},
    pulledImages: {},
  };

  const items = [
    ...Object.entries(backup.files).map(([path, value]) => ({
      kind: "files",
      path,
      base64: textToBase64(JSON.stringify(value, null, 2)),
    })),
    ...Object.entries(backup.images).map(([path, base64]) => ({ kind: "images", path, base64 })),
  ];

  // Картинки, заведённые впервые на ДРУГОМ устройстве, – их здесь ещё
  // никогда не было, а backup.images выше собран обходом СВОЕГО диска
  // (vault.listAllMedia()): то, чего на диске нет, туда и не попадает.
  // Без этого шага такой файл не пропадал бы после ошибки – он вообще
  // ни разу не пытался бы скачаться, сколько ни синхронизируйся:
  // JSON-файлы (reviews.json и т.п.) всегда есть локально хотя бы
  // пустыми и потому всегда участвуют в сравнении, а у картинки нет
  // такого «пустого» состояния, с которого можно было бы стартовать.
  // Раз мы уже потратили один bulk-запрос на remoteTree – раздать
  // остаток списка не стоит лишних запросов.
  const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
  if (remoteTree) {
    for (const path of remoteTree.keys()) {
      if (IMG_EXT.test(path) && !(path in backup.images)) {
        items.push({ kind: "images", path, isNewRemote: true });
      }
    }
  }

  let done = 0;
  for (const item of items) {
    onProgress?.(++done, items.length, item.path);

    const entry = state[item.kind][item.path];
    const outcome = item.isNewRemote
      ? await pullNewRemoteImage(config, item.path)
      : await syncOne(config, item.path, item.base64, entry, remoteTree);

    if (outcome.action === "none") {
      result.skipped++;
      state[item.kind][item.path] = { hash: outcome.hash, sha: outcome.sha };
    } else if (outcome.action === "push") {
      result.pushed++;
      state[item.kind][item.path] = { hash: outcome.hash, sha: outcome.sha };
    } else if (outcome.action === "pull") {
      result.pulled++;
      state[item.kind][item.path] = { hash: await contentHash(outcome.base64), sha: outcome.sha };
      if (item.kind === "images") result.pulledImages[item.path] = outcome.base64;
      else result.pulledFiles[item.path] = JSON.parse(base64ToText(outcome.base64));
    } else if (outcome.action === "conflict") {
      // Состояние для конфликтных файлов не трогаем – конфликт должен
      // остаться конфликтом и при следующей синхронизации, пока
      // человек не выберет сторону через resolveConflict.
      result.conflicts.push({ kind: item.kind, path: item.path, ...outcome });
    }
  }

  state.lastSyncAt = new Date().toISOString();
  saveSyncState(state);
  // Тот же флаг читают и ручная кнопка, и автосинхронизация – не важно,
  // кто досчитал до конфликта последним, важно, что он есть или его нет.
  localStorage.setItem(AUTOSYNC_CONFLICTS_KEY, result.conflicts.length ? "1" : "");

  return result;
}

// Применить решение по одному конфликту: "local" – отправить свою
// версию поверх удалённой, "remote" – забрать удалённую версию себе.
// При выборе "remote" возвращает содержимое (объект для файла, base64
// для картинки) – вызывающая сторона сама решает, как его записать
// (через /api/restore-backup).
async function resolveConflict(config, conflict, choice) {
  const state = getSyncState();

  if (choice === "local") {
    const sha = await putRemoteFile(config, conflict.path, conflict.localBase64, conflict.remote.sha);
    state[conflict.kind][conflict.path] = { hash: conflict.localHash, sha };
    saveSyncState(state);
    return null;
  }

  const hash = await contentHash(conflict.remote.base64);
  state[conflict.kind][conflict.path] = { hash, sha: conflict.remote.sha };
  saveSyncState(state);
  return conflict.kind === "images"
    ? conflict.remote.base64
    : JSON.parse(base64ToText(conflict.remote.base64));
}

// ══════════════════════════════════════════════
//  АВТОСИНХРОНИЗАЦИЯ
//
//  Кнопку «Синхронизировать сейчас» после каждого отзыва никто не
//  нажимает – значит, без этого блока второе устройство почти всегда
//  видело бы протухшие данные. Вместо того чтобы звать sync-функции из
//  десятка мест по разным страницам (легко забыть одно – и оно тихо
//  выпадет из синхронизации), подписываемся на сам fetch: он общий,
//  через него проходит любое сохранение, на любой странице, и на
//  компьютере, и на телефоне. Файл подключён везде (см. app/*.html),
//  поэтому перехват стоит один раз здесь, а не на каждой странице.
//
//  Синхронизация идёт не на каждое сохранение, а через паузу (debounce)
//  после последнего – иначе печать отзыва или перетаскивание тир-листа
//  били бы по GitHub API запросом на каждый шаг.
//
//  Тихо – без сообщений об ошибке (сети может не быть, это не повод
//  прерывать человека) и без принудительной перезагрузки страницы: если
//  что-то забрали с другого устройства, оно просто ляжет на диск и
//  подхватится следующей загрузкой страницы, а не сорвёт то, что
//  человек как раз печатает. Конфликт тем же способом молча оставляем
//  висеть – до него дойдёт человек сам, через вкладку «Синхронизация»,
//  туда же, где решает конфликты вручную.
// ══════════════════════════════════════════════

const AUTOSYNC_DELAY = 8000;
const AUTOSYNC_ON_OPEN_DELAY = 3000;

// Общий флаг на кнопку «Синхронизировать сейчас» и на автосинхронизацию:
// без него ручной клик и подоспевший фоновый запуск могли бы одновременно
// написать один и тот же путь в состоянии синхронизации.
let syncInFlight = false;

let autoSyncTimer = null;

function scheduleAutoSync(delayMs = AUTOSYNC_DELAY) {
  if (!getSyncConfig()) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(runAutoSync, delayMs);
}

async function runAutoSync() {
  const config = getSyncConfig();
  if (!config || syncInFlight) return;
  syncInFlight = true;
  try {
    const result = await runSync(config);
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
    clearSyncError();
    hideSyncErrorBanner();
  } catch (e) {
    // Сама попытка тихая – никакого алерта посреди работы с чем-то
    // другим, сеть могла быть просто недоступна прямо сейчас. Но не
    // молчим совсем: причина остаётся в localStorage до следующего
    // успеха и всплывает плашкой на панели настроек, как только
    // человек туда заглянет – см. её же комментарий у SYNC_LAST_ERROR_KEY.
    // А поверх неё – ещё и плашка посреди экрана (см. её же комментарий
    // у SYNC_ERROR_DISMISSED_KEY), сама попытка при этом всё равно
    // тихая: никакого alert() посреди чего-то другого.
    recordSyncError(e.message);
    checkSyncErrorBanner();
  } finally {
    syncInFlight = false;
  }
}

function isAutoSyncTrigger(pathname, method) {
  if (method !== "POST") return false;
  if (!pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/api/app/")) return false; // настройки самого приложения – не хранилище
  return pathname !== "/api/restore-backup" && pathname !== "/api/export-backup";
}

(function installAutoSyncTrigger() {
  if (typeof window === "undefined" || !window.fetch) return;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      const method = (
        init?.method ||
        (typeof input === "object" && input?.method) ||
        "GET"
      ).toUpperCase();
      const pathname = url.split("?")[0].replace(/^[a-z]+:\/\/[^/]+/i, "");
      if (res.ok && isAutoSyncTrigger(pathname, method)) scheduleAutoSync();
    } catch {
      // Разбор адреса не должен ронять сам запрос.
    }
    return res;
  };
})();

// Сразу после открытия страницы тоже стоит попробовать: вдруг с
// другого устройства уже есть что забрать, а на этой странице никто
// ничего сохранять и не планировал.
if (typeof window !== "undefined") scheduleAutoSync(AUTOSYNC_ON_OPEN_DELAY);

// Плашка о сломанной синхронизации – по уже накопленной ошибке
// (localStorage), не дожидаясь новой попытки: если токен истёк неделю
// назад, следующая же автосинхронизация выше просто повторит ту же
// ошибку, а до неё (AUTOSYNC_ON_OPEN_DELAY) человек уже мог уйти с
// открытой страницы. document.body ещё может быть не готов на самом
// первом такте разбора – ждём DOMContentLoaded, как и остальной запуск
// приложения (см. её же приём в js/reviews.js).
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(checkSyncErrorBanner, 1500));
}

// Перед закрытием приложения – то самое место, где стоит успеть
// отправить накопленное: закрыв TasteID, человек с большой вероятностью
// не откроет его снова в ближайшие минуты, чтобы это сделала обычная
// отложенная автосинхронизация сама. Зовёт electron/main.js через
// executeJavaScript перед выходом (см. app.on("before-quit")); на
// телефоне у Android нет надёжного «перед закрытием», это только для
// компьютера.
window.__syncBeforeQuit = async () => {
  clearTimeout(autoSyncTimer);
  await runAutoSync();
};
