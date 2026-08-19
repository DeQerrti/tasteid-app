// ══════════════════════════════════════════════
//  BACKUP — кнопка скачивания бэкапа JSON-данных
//  + LOGOUT — кнопка выхода (зовёт /api/logout)
//  Подключать на всех админских страницах.
//  Зависит от: JSZip (CDN, должен быть подключён раньше этого файла)
// ══════════════════════════════════════════════

(function () {
  const FILES = [
    { path: "/reviews.json", name: "reviews.json" },
    { path: "/favorites.json", name: "favorites.json" },
    { path: "/characters-tier.json", name: "characters-tier.json" },
  ];

  function makeBtn(id, text, title, right) {
    const btn = document.createElement("button");
    btn.id = id;
    btn.textContent = text;
    btn.title = title;

    Object.assign(btn.style, {
      position: "fixed",
      bottom: "20px",
      right: right,
      zIndex: "9999",
      padding: ".6rem 1.1rem",
      background: "var(--surface2, #1a1a1f)",
      border: "1px solid var(--border2, #333338)",
      borderRadius: "6px",
      color: "var(--text, #b8b0a8)",
      fontFamily: "'DM Sans', sans-serif",
      fontSize: ".85rem",
      letterSpacing: ".03em",
      cursor: "pointer",
      transition: "all .2s ease",
    });
    btn.onmouseenter = () => {
      btn.style.borderColor = "var(--green-hi, #6ab87a)";
      btn.style.color = "var(--text-hi, #f0ece6)";
    };
    btn.onmouseleave = () => {
      btn.style.borderColor = "var(--border2, #333338)";
      btn.style.color = "var(--text, #b8b0a8)";
    };
    document.body.appendChild(btn);
    return btn;
  }

  function injectButtons() {
    const backupBtn = makeBtn(
      "backup-btn",
      "⤓ Бэкап",
      "Скачать reviews.json + favorites.json + characters-tier.json одним архивом",
      "20px"
    );
    backupBtn.addEventListener("click", () => downloadBackup(backupBtn));

    // Не дублируем ссылку на саму себя, если мы уже на странице истории
    if (!/backup-history/.test(location.pathname)) {
      const historyBtn = makeBtn(
        "history-btn",
        "История",
        "Посмотреть все сохранённые версии данных и восстановить старую при необходимости",
        "130px"
      );
      historyBtn.addEventListener("click", () => { location.href = "/backup-history"; });

      const logoutBtn = makeBtn(
        "logout-btn",
        "⎋ Выйти",
        "Завершить сессию администратора на этом устройстве",
        "245px"
      );
      logoutBtn.addEventListener("click", () => doLogout(logoutBtn));
    } else {
      const logoutBtn = makeBtn(
        "logout-btn",
        "⎋ Выйти",
        "Завершить сессию администратора на этом устройстве",
        "130px"
      );
      logoutBtn.addEventListener("click", () => doLogout(logoutBtn));
    }
  }

  async function doLogout(btn) {
    if (!confirm("Выйти из режима администратора?")) return;
    const originalText = btn.textContent;
    btn.textContent = "⎋ Выходим...";
    btn.disabled = true;
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      window.location.href = "/login.html";
    } catch (err) {
      console.error("Logout failed:", err);
      btn.textContent = "✗ Ошибка";
      alert("Не удалось выйти 😢\n" + err.message);
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    }
  }

  async function downloadBackup(btn) {
    const originalText = btn.textContent;
    btn.textContent = "⤓ Собираю...";
    btn.disabled = true;

    try {
      if (typeof JSZip === "undefined") {
        throw new Error("JSZip не загружен");
      }

      const zip = new JSZip();

      const results = await Promise.all(
        FILES.map(f =>
          fetch(f.path + "?_=" + Date.now())
            .then(r => {
              if (!r.ok) throw new Error(`${f.name}: HTTP ${r.status}`);
              return r.text();
            })
            .then(text => ({ name: f.name, text }))
        )
      );

      results.forEach(({ name, text }) => zip.file(name, text));

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);

      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tasteid-backup-${date}.zip`;
      link.click();

      URL.revokeObjectURL(url);

      btn.textContent = "✓ Готово";
    } catch (err) {
      console.error("Backup failed:", err);
      btn.textContent = "✗ Ошибка";
      alert("Не удалось собрать бэкап 😢\n" + err.message);
    } finally {
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButtons);
  } else {
    injectButtons();
  }
})();
