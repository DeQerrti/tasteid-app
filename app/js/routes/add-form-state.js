// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

// ── заполнить форму ────────────────────────────
function fillForm(r) {
  editingIds = r.ids || {};
  document.getElementById("f-title").value = r.title || "";
  document.getElementById("f-year").value = r.year || "";
  document.getElementById("f-format").value = r.format || "";
  document.getElementById("f-cover").value = r.cover || "";
  document.getElementById("f-cover-backup").value = r.cover_backup || "";
  originalCoverBackup = r.cover_backup || null;
  document.getElementById("f-url").value = r.url || "";
  document.getElementById("f-preview").value = r.preview || "";
  document.getElementById("f-review-full").value = r.review_full || "";
  document.getElementById("f-source").value = r.source || "teletype";
  document.getElementById("f-type").value = r.type || "anime";
  document.getElementById("f-status").value = r.status || "completed";
  document.getElementById("f-url2").value = r.url2 || "";
  document.getElementById("f-source2").value = r.source2 || "";
  syncTypePickerLabel();
  // Без этого кнопка статуса всегда оставалась на подписи по умолчанию
  // ("Завершено"/Архив, см. разметку в mount()) – сам f-status.value
  // проставлялся выше верно, а подпись на кнопке с ним не сверялась.
  syncStatusPickerLabel();

  // Инлайн-панели источников и обложки – раскрыть/свернуть по наличию значения
  syncSourcePanel(1);
  syncSourcePanel(2);
  syncCoverPanel();

  // Переключатель «Любимое»
  document.getElementById("f-favorite").checked = r.favorite === true;
  syncFavToggle();

  // Разворачиваем разделы, в которых уже что-то заполнено
  collapseAllSections();
  openFilledSections(r);

  // Поля дат
  updateDateFields();
  const today = new Date().toISOString().slice(0, 10);
  const startEl = document.getElementById("f-date-start");
  const endEl = document.getElementById("f-date-end");
  if (startEl) startEl.value = r.date_start || today;
  const rewatchEl = document.getElementById("rewatch-count");
  if (rewatchEl) rewatchEl.value = r.rewatch_count || 0;
  if (endEl) endEl.value = r.date_end || today;

  previewCover(r.cover || "");

  selectedGrade = r.grade !== undefined && r.grade !== null ? r.grade : null;
  renderGradeInput();

  selectedTags = new Set(r.tags || []);
  document
    .querySelectorAll(".tag-toggle")
    .forEach((b) => b.classList.toggle("active", selectedTags.has(b.dataset.tag)));
  featuredCardTags = new Set(r.featured_tags_on_card || []);
  noTagsOnCard = !!r.no_tags_on_card;
  renderCardTagsList();
}

// ── сброс ──────────────────────────────────────
function resetToNew() {
  editingId = null;
  editingIds = {};
  originalCoverBackup = null;
  document.getElementById("edit-banner").style.display = "none";
  document.getElementById("danger-zone").hidden = true;
  document.getElementById("page-subtitle").textContent = i18n("Добавить отзыв");
  document.getElementById("btn-save").textContent = i18n("Сохранить отзыв");
  // Сбросить ?edit=ID/#/add?edit=ID, чтобы обновление страницы не
  // открыло снова правку уже сохранённого отзыва. В SPA меняется
  // только хэш, и replaceState (в отличие от location.hash = …) не
  // порождает hashchange, то есть маршрут не перемонтируется; в
  // одиночном add.html меняется обычный адрес документа.
  history.replaceState(null, "", IN_SPA_SHELL ? "#/add" : "add.html");

  ["f-title", "f-year", "f-format", "f-cover", "f-url", "f-preview", "f-url2", "f-review-full", "f-cover-backup"].forEach(
    (id) => (document.getElementById(id).value = "")
  );
  document.getElementById("f-source").value = "teletype";
  document.getElementById("f-source2").value = "";
  document.getElementById("f-type").value = "anime";
  document.getElementById("f-status").value = "planning";
  document.getElementById("rewatch-count").value = 0;
  syncTypePickerLabel();

  // Свернуть обе панели источников, панель обложки и выпадающие списки типов
  closeTypeDropdown();
  closeTypePickerDropdown();
  syncSourcePanel(1);
  syncSourcePanel(2);
  syncCoverPanel();

  // Сброс переключателя «Любимое»
  document.getElementById("f-favorite").checked = false;
  syncFavToggle();

  // Новый отзыв начинается с компактной формы
  collapseAllSections();

  document.getElementById("cover-img").style.display = "none";
  selectedGrade = null;
  selectedTags.clear();
  featuredCardTags.clear();
  noTagsOnCard = false;
  renderGradeInput();
  document.querySelectorAll(".tag-toggle").forEach((b) => b.classList.remove("active"));
  renderCardTagsList();
  document.getElementById("status").textContent = "";
  document.getElementById("status").className = "status-msg";
  updateDateFields();
}

// ── инит по параметрам ─────────────────────────
// params – URLSearchParams в обоих случаях: из хэша через роутер
// (#/add?edit=ID) или из location.search в одиночном add.html
// (?edit=ID или ?fromPassport=1&title=…&type=…&year=…&cover=…).
async function initAddPage(params) {
  updateDateFields();

  // Из чужого паспорта: там нет ни текста отзыва, ни оценки – только
  // название, тип, год и, если автор паспорта указывал обложку внешней
  // ссылкой (а не локальным файлом), сама эта ссылка. Добавляются они
  // не поверх ничьего чужого отзыва, а как новый, свой – editingId не
  // трогаем, fillForm() сам по себе ничего не редактирует.
  //
  // Проверяем не только сам параметр, но и что родитель – правда наша
  // модалка (window.parent !== window и у него правда есть
  // closeAddFromPassportModal): прямое открытие ссылки с
  // fromPassport=1 в обычной вкладке ведёт себя как обычное добавление
  // с подставленными полями, а не пытается закрыть несуществующую модалку.
  if (params.get("fromPassport")) {
    try {
      fromPassportModal =
        window.parent !== window && typeof window.parent.closeAddFromPassportModal === "function";
    } catch {
      // window.parent из другого источника бросил бы SecurityError – у
      // нас такого не бывает (тот же процесс), но проверка не должна
      // ронять форму.
    }
    // В модалке своя шапка ни к чему: логотип и «На главную» дублируют
    // крестик самой модалки, а места странице и так отведено немного.
    if (fromPassportModal) document.querySelector(".app-topbar")?.classList.add("hidden");
    fillForm({
      title: params.get("title") || "",
      type: params.get("type") || "",
      year: params.get("year") || "",
      cover: params.get("cover") || "",
    });
    // fillForm() просто ставит .value – событие oninput на это не
    // реагирует, поэтому свою резервную копию обложки, как при ручной
    // вставке ссылки, запускаем явно.
    if (params.get("cover")) scheduleBackupCover();
    document.getElementById("page-subtitle").textContent = i18n("Добавить отзыв");
    return;
  }

  const editId = params.get("edit");
  if (!editId) return;

  try {
    const res = await fetch("/reviews.json?_=" + Date.now());
    const data = await res.json();
    const review = data.find((r) => String(r.id) === editId || encodeURIComponent(r.title) === editId);
    if (!review) {
      setStatus("err", i18n("Отзыв с таким ID не найден"));
      return;
    }
    editingId = review.id ?? review.title;
    fillForm(review);
    document.getElementById("edit-banner").style.display = "flex";
    document.getElementById("edit-title-hint").textContent = review.title;
    document.getElementById("page-subtitle").textContent = i18n("Редактировать отзыв");
    document.getElementById("btn-save").textContent = i18n("Сохранить изменения");
    document.title = `TasteID – ${i18n("Редактировать отзыв")}`;
    // Удаляем строго по номеру записи. У совсем старых записей номера
    // может не оказаться – тогда кнопки просто нет: удалять по названию
    // нельзя, под одним названием лежат разные записи.
    document.getElementById("danger-zone").hidden = typeof review.id !== "number";
    // fillForm() трогает те же поля, что и человек руками, – на
    // делегированный input/change слушатель это не похоже (значения
    // ставятся из кода, событий не будет), но renderGradeInput() и
    // прочее могли успеть пометить форму грязной. Она только что
    // открыта – считаем её чистой.
    setAddDirty(false);
  } catch (e) {
    setStatus("err", i18n("Не удалось загрузить отзыв: ") + e.message);
  }
}

// ── удаление ───────────────────────────────────
// Спрашиваем один раз, но по-человечески: с названием записи, чтобы было
// видно, что удаляется именно то. Обещание про «Историю версий» настоящее –
// reviews.json там отслеживается и откатывается целиком.
async function deleteReview() {
  if (typeof editingId !== "number") return;

  const title = document.getElementById("f-title").value.trim() || i18n("эту запись");
  if (
    !(await confirmDialog(
      i18n(
        "Удалить «{name}»?\n\nЗапись пропадёт из «Отзывов», «Любимого» и «Тир-листа».\nВернуть её можно будет только откатом в «Истории версий».",
        { name: title }
      )
    ))
  )
    return;

  setStatus("", i18n("Удаляем…"));
  try {
    const res = await fetch("/api/delete-review", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Сервер ответил ${res.status}`);

    // В приложении никакой выкладки нет: файл на диске уже переписан,
    // ждать нечего.
    setStatus("ok", i18n("«{name}» удалена.", { name: data.title }));
    // Тот же общий кэш, что читают favorites.js/tierlist.js между
    // вызовами fetchReviews() (js/api.js) – без сброса они ещё
    // мгновение показывали бы уже удалённую запись.
    cache.reviews = null;
    refreshOpenReviewsTab(); // вкладка под /add молча висит с уже несуществующей карточкой (js/api.js)
    // Форма после удаления показывает то, чего уже нет, – уходим.
    // Флаг «есть несохранённое» сбрасываем явно: иначе уход спросил бы
    // «уйти без сохранения», хотя запись только что удалена, а не
    // брошена недописанной.
    setAddDirty(false);
    document.getElementById("danger-zone").hidden = true;
    document.getElementById("btn-save").disabled = true;
    addLeaveTimer = setTimeout(() => closeAddView(), 1800);
  } catch (e) {
    setStatus("err", i18n("Не удалось удалить: ") + e.message);
  }
}

