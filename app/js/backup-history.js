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
    } finally {
      busy = false;
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
    content.innerHTML = versions.map((v, i) => {
      const dt = v.date ? new Date(v.date) : null;
      const dateStr = dt ? dt.toLocaleString("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : i18n("дата неизвестна");
      const msg = firstLine(v.message);
      return `
      <div class="version-row">
        <div class="version-main">
          <div class="version-date">${esc(dateStr)}${i === 0 ? `<span class="version-badge">${i18n("текущая")}</span>` : ""}</div>
          <div class="version-msg" title="${esc(v.message)}">${esc(msg)}</div>
        </div>
        <div class="version-actions">
          <button class="btn-mini" onclick="downloadBackupVersion('${path}','${v.sha}')">${i18n("⤓ Скачать")}</button>
          ${i === 0 ? "" : `<button class="btn-mini danger" onclick="restoreBackupVersion('${path}','${v.sha}','${esc(dateStr).replace(/'/g, "\\'")}')" data-i18n>↺ Восстановить</button>`}
        </div>
      </div>`;
    }).join("");
  }

  function firstLine(s) {
    return String(s || "").split("\n")[0];
  }

  async function downloadBackupVersion(path, sha) {
    try {
      const res = await fetch(`/api/file-at-commit?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(sha)}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${path.replace(".json", "")}-${sha.slice(0, 7)}.json`;
      link.click();
      URL.revokeObjectURL(url);
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
})();
