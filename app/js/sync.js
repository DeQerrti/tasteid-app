// ══════════════════════════════════════════════
//  СИНХРОНИЗАЦИЯ ЧЕРЕЗ GITHUB
//
//  Бесплатный способ синхронизировать несколько устройств (телефон,
//  компьютер, ещё один компьютер) без своего сервера: приватный
//  репозиторий на GitHub как общее хранилище, а сам GitHub — единственный
//  сервер во всей схеме.
//
//  Токен и служебное состояние синхронизации хранятся только на этом
//  устройстве (localStorage) и никогда не входят ни в резервную копию,
//  ни в паспорт — иначе токен уехал бы вместе с данными куда угодно,
//  куда их перенесут.
//
//  Payload синхронизации — то же самое, что отдаёт /api/export-backup:
//  общий с резервной копией формат, только едет не в файл на диск, а в
//  GitHub-репозиторий, файл за файлом. Внутри этого файла всё в одном
//  виде — base64, том самом, которым Contents API отдаёт и принимает
//  содержимое (файлы данных кодируются в base64 на границе, картинки в
//  экспорте и так уже в base64).
//
//  ПРОТОКОЛ. У каждого файла есть три состояния: что лежит локально
//  сейчас, что лежит в репозитории сейчас, и что было тут и там при
//  прошлой успешной синхронизации (state.files[путь] — хеш и sha).
//  Совпадает текущее с прошлым локальным — значит, здесь ничего не
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
// бы побились. Картинок это не касается — они уже приходят и уходят
// готовым base64, эти функции их не трогают.
function textToBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}
function base64ToText(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

// ── GitHub REST API ─────────────────────────────

class SyncError extends Error {}

async function githubApi(config, path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError(
      i18n("Не получилось достучаться до GitHub — проверь соединение с интернетом.")
    );
  }

  if (res.status === 401) {
    throw new SyncError(i18n("GitHub не принял токен — проверь, что он не истёк и не отозван."));
  }
  if (res.status === 403) {
    const data = await res.json().catch(() => ({}));
    if (/rate limit/i.test(data.message || "")) {
      throw new SyncError(
        i18n("GitHub временно ограничил число запросов — попробуй через несколько минут.")
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

// Contents API отдаёт файл вместе с его sha — sha и есть версия файла
// для PUT ниже. 404 — файла ещё нет, это не ошибка. GitHub режет
// base64 на строки по 60 символов — переносы строк из content нужно
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
// или нет» — SHA-256 из Web Crypto есть везде, где есть этот код.
// Хешируем сам base64 — он у файла один и тот же при любом повторном
// экспорте того же содержимого, сравнивать удобнее, чем разбирать JSON.
async function contentHash(base64) {
  const bytes = new TextEncoder().encode(base64);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Один файл: решить, что с ним делать, и сделать ─
// localBase64 — текущее содержимое, уже в base64. entry — {hash, sha}
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
    // В репозитории файла ещё нет вообще — отправляем, конфликтовать не с чем.
    const sha = await putRemoteFile(config, path, localBase64);
    return { action: "push", hash: localHash, sha };
  }

  if (localChanged && remoteChanged) {
    // Раньше файл синхронизировался (entry есть), и с прошлого раза
    // успели поменять и здесь, и там — который из двух новее, решить
    // самим нечем. Без entry (первая синхронизация двух уже занятых
    // устройств) тоже конфликт: оба варианта не пустые, сравнивать не
    // с чем.
    return { action: "conflict", localBase64, remote, localHash };
  }

  if (localChanged) {
    const sha = await putRemoteFile(config, path, localBase64, remote.sha);
    return { action: "push", hash: localHash, sha };
  }

  // Только remote изменился — забираем.
  return { action: "pull", base64: remote.base64, sha: remote.sha };
}

// ── Полная синхронизация ────────────────────────
// Возвращает { pushed, pulled, skipped, conflicts, pulledFiles, pulledImages }.
// pulledFiles/pulledImages готовы к передаче в /api/restore-backup —
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
      // Состояние для конфликтных файлов не трогаем — конфликт должен
      // остаться конфликтом и при следующей синхронизации, пока
      // человек не выберет сторону через resolveConflict.
      result.conflicts.push({ kind: item.kind, path: item.path, ...outcome });
    }
  }

  state.lastSyncAt = new Date().toISOString();
  saveSyncState(state);

  return result;
}

// Применить решение по одному конфликту: "local" — отправить свою
// версию поверх удалённой, "remote" — забрать удалённую версию себе.
// При выборе "remote" возвращает содержимое (объект для файла, base64
// для картинки) — вызывающая сторона сама решает, как его записать
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
