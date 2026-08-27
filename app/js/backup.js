// ══════════════════════════════════════════════
//  Плавающая кнопка «История» на админских страницах.
//
//  На сайте рядом с ней жили ещё две — «Бэкап» (скачать данные одним
//  архивом) и «Выйти». В приложении обе лишние, и не только на вид:
//
//    Бэкап архивом дублировал то, что здесь и так есть — папка
//    хранилища лежит на диске целиком, её копирует проводник, а
//    отдельная выгрузка паспорта есть в настройках. Заодно он тянул
//    JSZip с CDN на каждую админскую страницу — в офлайне это просто
//    несостоявшийся запрос.
//
//    Выйти было некуда: входа в приложении нет (см. «Админ без входа»
//    в README), и /api/logout здесь не существует — кнопка гарантированно
//    отвечала бы ошибкой.
//
//  Поэтому здесь остался только переход в «Историю версий».
// ══════════════════════════════════════════════

(function () {
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
    // На самой странице истории ссылка на неё же не нужна.
    if (/backup-history/.test(location.pathname)) return;

    const historyBtn = makeBtn(
      "history-btn",
      i18n("История"),
      i18n("Посмотреть все сохранённые версии данных и восстановить старую при необходимости"),
      "20px"
    );
    historyBtn.addEventListener("click", () => {
      // Хэш-маршрут (см. план перехода на SPA), а не файл напрямую —
      // отсюда (add.html/chars-edit.html/… — отдельные документы) это
      // всё равно полная навигация, но landing теперь на index.html,
      // который эту историю версий понимает сам, без отдельного файла.
      location.href = "/#/backup-history";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectButtons);
  } else {
    injectButtons();
  }
})();
