// ══════════════════════════════════════════════
//  Список версий файлов данных — скачать старую как JSON или
//  восстановить её как текущую.
//
//  Общий для двух мест: backup-history.html (отдельная страница,
//  открывается с плавающей кнопки «История» на формах) и панели
//  «История версий» в settings-edit.html. Обе используют одни и те же
//  id разметки (#fileTabs, #content) — просто в первом случае они на
//  всю страницу, во втором лежат внутри одной из панелей настроек.
//  Поэтому вызывается не сразу при загрузке файла, а явно —
//  initBackupHistoryPanel() — и может быть вызван позже, когда панель
//  открыли впервые.
// ══════════════════════════════════════════════

(function () {
  const BASE_FILES = [
    { path: "reviews.json",         label: i18n("Отзывы") },
    { path: "favorites.json",       label: i18n("Любимое") },
    { path: "characters-tier.json", label: i18n("Персонажи") },
    { path: "site-settings.json",   label: i18n("Настройки") },
  ];

  let FILES = BASE_FILES.slice();
  let currentPath = FILES[0].path;
  const versionsCache = {}; // path -> versions[]
  let inApp = false; // приложение публикует правки сразу, сайту нужны ~30с на выкладку
  let busy = false;

  async function initBackupHistoryPanel() {
    if (busy) return;
    busy = true;
    try {
      const locked = document.getElementById("locked");
      const app = document.getElementById("app");
      if (typeof isAdmin !== "function" || !isAdmin()) {
        if (locked) locked.classList.remove("hidden");
        return;
      }
      if (app) app.classList.remove("hidden");

      inApp = await isAppContext();

      // Свои коллекции тир-листа — из настроек, не зашиты списком: список
      // однажды бы разъехался с тем, что человек сам завёл на вкладке
      // «Тир-листы». «Персонажи» уже есть выше под своим файлом — не дублируем.
      FILES = BASE_FILES.slice();
      try {
        const res = await fetch("/site-settings.json?_=" + Date.now());
        const settings = await res.json();
        const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];
        for (const c of collections) {
          if (c.id === "characters") continue;
          FILES.push({ path: `tier-${c.id}.json`, label: c.label || c.id });
        }
      } catch {
        // Настройки не прочитались — остаёмся с базовым списком файлов.
      }

      if (!FILES.some(f => f.path === currentPath)) currentPath = FILES[0].path;
      renderFileTabs();
      loadVersions(currentPath);
      initHistoryRetention();
    } finally {
      busy = false;
    }
  }

  // ── Хранить версии не дольше ───────────────────
  // Лимит по количеству (50 на файл, см. vault.js) не спасает того, кто
  // сохраняет редко, но подолгу — этих пятидесяти версий хватит на годы.
  // Возраст — отдельный, необязательный предел поверх количества,
  // выключен по умолчанию, чтобы ничего не терялось молча для тех, кому
  // это не нужно.
  const RETENTION_OPTIONS = [
    { value: "", label: i18n("Не удалять автоматически") },
    { value: "7", label: i18n("Старше недели") },
    { value: "30", label: i18n("Старше месяца") },
    { value: "182", label: i18n("Старше полугода") },
  ];

  async function initHistoryRetention() {
    const select = document.getElementById("history-retention-select");
    if (!select) return;
    select.innerHTML = RETENTION_OPTIONS.map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
    try {
      const settings = await currentSiteSettings();
      select.value = settings.historyRetentionDays ? String(settings.historyRetentionDays) : "";
    } catch {
      // Настройки не прочитались — остаёмся на «не удалять автоматически».
    }
  }

  async function saveHistoryRetention(value) {
    const statusEl = document.getElementById("status-history-retention");
    try {
      await patchSiteSettings((settings) => {
        settings.historyRetentionDays = value ? Number(value) : null;
      });
      if (statusEl) { statusEl.textContent = i18n("Сохранено."); statusEl.className = "status-msg ok"; }
    } catch (e) {
      if (statusEl) { statusEl.textContent = e.message; statusEl.className = "status-msg err"; }
    }
  }

  async function pruneHistoryNow() {
    const select = document.getElementById("history-retention-select");
    const days = select?.value ? Number(select.value) : null;
    if (!days) {
      backupToast(i18n("Сначала выбери, версии старше какого срока чистить."), false);
      return;
    }
    try {
      const res = await fetch("/api/prune-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Object.keys(versionsCache).forEach(k => delete versionsCache[k]);
      loadVersions(currentPath);
      backupToast(i18n("Удалено версий: {n}", { n: data.removed }), true);
    } catch (e) {
      backupToast(i18n("Не удалось почистить: {msg}", { msg: e.message }), false);
    }
  }

  async function clearFileHistory(path) {
    if (!(await confirmDialog(
      i18n("Удалить всю историю файла «{file}»?\n\nТекущая версия не пострадает — удалятся только прошлые.", { file: path }),
      i18n("Удалить")
    ))) return;
    try {
      const res = await fetch("/api/clear-file-history", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      delete versionsCache[path];
      loadVersions(path);
      backupToast(i18n("История очищена ✓"), true);
    } catch (e) {
      backupToast(i18n("Не удалось удалить: {msg}", { msg: e.message }), false);
    }
  }

  function renderFileTabs() {
    const container = document.getElementById("fileTabs");
    if (!container) return;
    container.innerHTML = FILES.map(f => `
      <button class="file-tab${f.path === currentPath ? " active" : ""}" onclick="selectBackupFile('${f.path}')">${f.label}</button>
    `).join("");
  }

  function selectBackupFile(path) {
    currentPath = path;
    renderFileTabs();
    loadVersions(path);
  }

  async function loadVersions(path) {
    const content = document.getElementById("content");
    if (!content) return;
    if (versionsCache[path]) {
      renderVersions(path, versionsCache[path]);
      return;
    }
    content.innerHTML = `<div class="state-box"><div class="spinner"></div>${i18n("Загружаем историю…")}</div>`;
    try {
      const res = await fetch(`/api/file-history?path=${encodeURIComponent(path)}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      versionsCache[path] = data.versions;
      if (path === currentPath) renderVersions(path, data.versions);
    } catch (e) {
      if (path === currentPath) {
        content.innerHTML = `<div class="state-box">Ошибка загрузки: ${esc(e.message)}</div>`;
      }
    }
  }

  function renderVersions(path, versions) {
    const content = document.getElementById("content");
    if (!content) return;
    if (!versions.length) {
      content.innerHTML = `<div class="state-box">${i18n("Пока нет истории для этого файла.")}</div>`;
      return;
    }
    // sha:"current" — не запись из .history, а сам живой файл (см.
    // fileHistory() в core/api.js): «Удалить всю историю» её не
    // трогает, поэтому и в счётчике, и в кнопке участвуют только
    // настоящие прошлые версии.
    const pastCount = versions.filter(v => v.sha !== "current").length;
    const head = `
      <div class="version-list-head">
        <span class="version-list-count">${i18n("Версий: {n}", { n: pastCount })}</span>
        ${pastCount ? `<button class="btn-mini danger" onclick="clearFileHistory('${path}')" title="${esc(i18n("Стереть все прошлые версии этого файла целиком, независимо от возраста — не только старые"))}">${i18n("Удалить всю историю")}</button>` : ""}
      </div>`;
    content.innerHTML = head + versions.map((v) => {
      const isCurrent = v.sha === "current";
      const dt = v.date ? new Date(v.date) : null;
      const dateStr = isCurrent ? i18n("сейчас") :
        dt ? dt.toLocaleString(dateLocale(), { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : i18n("дата неизвестна");
      const msg = firstLine(v.message);
      return `
      <div class="version-row">
        <div class="version-main">
          <div class="version-date">${esc(dateStr)}${isCurrent ? `<span class="version-badge">${i18n("текущая")}</span>` : ""}</div>
          <div class="version-msg" title="${esc(v.message)}">${esc(msg)}</div>
        </div>
        <div class="version-actions">
          <button class="btn-mini" onclick="downloadBackupVersion('${path}','${v.sha}')">${i18n("⤓ Скачать")}</button>
          ${isCurrent ? "" : `<button class="btn-mini danger" onclick="restoreBackupVersion('${path}','${v.sha}','${esc(dateStr).replace(/'/g, "\\'")}')" data-i18n>↺ Восстановить</button>`}
        </div>
      </div>`;
    }).join("");
  }

  function firstLine(s) {
    return String(s || "").split("\n")[0];
  }

  async function downloadBackupVersion(path, sha) {
    try {
      // "current" — не запись из .history (её там нет), а сам живой
      // файл: он и так отдаётся по своему обычному адресу.
      const url0 = sha === "current"
        ? `/${path}?_=${Date.now()}`
        : `/api/file-at-commit?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(sha)}`;
      const res = await fetch(url0, { credentials: "include" });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error || `HTTP ${res.status}`);
      const data = sha === "current" ? raw : (raw.ok ? raw.data : (() => { throw new Error(raw.error || "Ошибка"); })());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${path.replace(".json", "")}-${sha.slice(0, 7)}.json`;
      // В документ, а не мимо: на телефоне <a download> не скачивает
      // ничего, нажатие перехватывает mobile/src/main.js слушателем на
      // document — а до document клик по неприсоединённой ссылке не
      // доходит. Без этого «Скачать» в истории версий на Android молча
      // не делало ничего. Отзыв blob-ссылки — следующим кадром, иначе
      // перехватчик не успеет её прочитать (он и написан так, чтобы
      // забрать содержимое сразу, но revoke в той же строке опережал
      // даже его).
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      backupToast("Не удалось скачать: " + e.message, false);
    }
  }

  async function restoreBackupVersion(path, sha, dateStr) {
    if (!(await confirmDialog(i18n("Восстановить «{file}» до версии от {date}?\n\nЭто заменит текущий файл — все изменения после этой версии будут потеряны (но останутся в истории, их тоже можно будет восстановить обратно).", { file: path, date: dateStr }), i18n("Восстановить")))) {
      return;
    }
    try {
      const res = await fetch("/api/restore-file-version", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, sha }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      delete versionsCache[path];
      backupToast(inApp ? "Восстановлено ✓" : i18n("Восстановлено ✓ (сайт обновится через ~30 секунд)"), true);
      loadVersions(path);
    } catch (e) {
      backupToast("Не удалось восстановить: " + e.message, false);
    }
  }

  function backupToast(text, ok) {
    const el = document.createElement("div");
    el.className = "toast " + (ok ? "ok" : "err");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  window.initBackupHistoryPanel = initBackupHistoryPanel;
  window.selectBackupFile = selectBackupFile;
  window.downloadBackupVersion = downloadBackupVersion;
  window.restoreBackupVersion = restoreBackupVersion;
  window.saveHistoryRetention = saveHistoryRetention;
  window.pruneHistoryNow = pruneHistoryNow;
  window.clearFileHistory = clearFileHistory;
})();
