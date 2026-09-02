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

const SYNC_CONFIG_KEY = "tasteid_sync_config"; // { token, owner, repo }
const SYNC_STATE_KEY = "tasteid_sync_state"; // { files: {путь:{hash,sha}}, images: {путь:{hash,sha}}, lastSyncAt }

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

async function repoExists(config) {
  const res = await githubApi(config, `/repos/${config.owner}/${config.repo}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new SyncError(i18n("Не получилось проверить репозиторий."));
  return true;
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
// синхронизировался.
async function syncOne(config, path, localBase64, entry) {
  const localHash = await contentHash(localBase64);
  const remote = await getRemoteFile(config, path);

  const localChanged = !entry || entry.hash !== localHash;
  const remoteChanged = !entry || !remote || entry.sha !== remote.sha;

  if (!localChanged && !remoteChanged) {
    return { action: "none", hash: localHash, sha: remote?.sha };
  }

  if (!remote) {
    // В репозитории файла ещё нет вообще – отправляем, конфликтовать не с чем.
    const sha = await putRemoteFile(config, path, localBase64);
    return { action: "push", hash: localHash, sha };
  }

  if (localChanged && remoteChanged) {
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
    const sha = await putRemoteFile(config, path, localBase64, remote.sha);
    return { action: "push", hash: localHash, sha };
  }

  // Только remote изменился – забираем.
  return { action: "pull", base64: remote.base64, sha: remote.sha };
}

// ── Полная синхронизация ────────────────────────
// Возвращает { pushed, pulled, skipped, conflicts, pulledFiles, pulledImages }.
// pulledFiles/pulledImages готовы к передаче в /api/restore-backup –
// тем же путём, каким резервная копия восстанавливает файлы.
async function runSync(config, onProgress) {
  const state = getSyncState();
  const backup = await (await fetch("/api/export-backup")).json();

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

  let done = 0;
  for (const item of items) {
    onProgress?.(++done, items.length, item.path);

    const entry = state[item.kind][item.path];
    const outcome = await syncOne(config, item.path, item.base64, entry);

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

const AUTOSYNC_CONFLICTS_KEY = "tasteid_sync_has_conflicts";
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
  } catch {
    // Тихая синхронизация: сеть могла быть недоступна, токен – истечь.
    // Ручная кнопка покажет причину явно, если человек попробует сам.
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
