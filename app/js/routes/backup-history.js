// ══════════════════════════════════════════════
//  РОУТ #/backup-history — история версий файлов данных
//  (см. план перехода на SPA, фаза 3.5)
//
//  Самый маленький из оставшихся — вся отрисовка уже жила в общем
//  js/backup-history.js (общий для этой страницы и панели «История
//  версий» внутри settings-edit.html — см. её же комментарий в начале
//  того файла), здесь только шапка и вызов initBackupHistoryPanel().
//  Он сам по себе IIFE и ничего не завязывает на глобальную область
//  видимости, кроме себя самого — конфликтов имён можно не бояться.
// ══════════════════════════════════════════════
(function () {
  let cleanupFns = [];
  let prevTitle = null;

  function on(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    cleanupFns.push(() => target.removeEventListener(type, handler, opts));
  }

  async function mount(container) {
    prevTitle = document.title;
    document.title = `TasteID — ${i18n("История версий")}`;

    container.innerHTML = `
      <header class="app-topbar">
        <a href="#" class="logo topbar-back" id="bh-back"><span class="arrow">&larr;</span>TasteID</a>
        <h1 class="topbar-title">${i18n("Бэкап и восстановление")}</h1>
      </header>
      <main class="bh-view">
        <h2 class="section-title" style="font-family:'Playfair Display',serif;font-weight:700;font-style:italic;font-size:1.2rem;color:var(--text-hi);margin-bottom:1rem;">${i18n("История версий")}</h2>
        <p class="hint">
          ${i18n(
            "Каждое сохранение файла — это отдельная версия, которая навсегда остаётся здесь, даже если текущая версия сломается. Выбери файл, найди нужную дату и либо скачай эту версию как JSON, либо восстанови её — тогда она станет текущей."
          )}
        </p>

        <div class="history-retention">
          <label for="history-retention-select">${i18n("Автоматически удалять версии старше:")}</label>
          <select id="history-retention-select" onchange="saveHistoryRetention(this.value)"></select>
          <button class="btn btn-ghost" onclick="pruneHistoryNow()" title="${i18n("Применить выбранный срок прямо сейчас, не дожидаясь автоматической чистки — по всем файлам сразу")}">${i18n("Почистить сейчас")}</button>
        </div>
        <div class="status-msg" id="status-history-retention"></div>

        <div class="file-tabs" id="fileTabs"></div>
        <div id="content"><div class="state-box"><div class="spinner"></div>${i18n("Загружаем…")}</div></div>
      </main>`;

    on(document.getElementById("bh-back"), "click", (e) => {
      e.preventDefault();
      leaveRoute();
    });
    on(document, "keydown", (e) => {
      if (e.key === "Escape") leaveRoute();
    });

    await initBackupHistoryPanel();
  }

  function unmount() {
    cleanupFns.forEach((fn) => fn());
    cleanupFns = [];
    document.title = prevTitle || document.title;
  }

  registerRoute("#/backup-history", { mount, unmount });
})();
