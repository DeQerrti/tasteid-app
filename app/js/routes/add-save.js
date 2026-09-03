// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

function setStatus(type, text) {
  const el = document.getElementById("status");
  el.className = "status-msg" + (type ? " " + type : "");
  el.textContent = text;
}

// ── сохранение ─────────────────────────────────
async function saveReview() {
  const btn = document.getElementById("btn-save");

  const title = document.getElementById("f-title").value.trim();
  const url = document.getElementById("f-url").value.trim();
  const reviewFull = document.getElementById("f-review-full").value.trim();
  // Превью необязательно: если заполнили только полный текст, само
  // превью (короткий текст-заглушка для карточек/списков и признак
  // «отзыв не пустой» в фильтрах – js/reviews.js, js/now.js, js/stats.js)
  // подтягивается из полного текста, а не остаётся пустым.
  const preview = document.getElementById("f-preview").value.trim() || reviewFull;
  const status = document.getElementById("f-status").value;

  if (!title) {
    setStatus("err", i18n("Заполните название"));
    return;
  }

  // Подстраховка: если ссылку на обложку вписали и сразу сохранили, не
  // дожидаясь паузы в 1.2с – бэкап мог не успеть запуститься. Досылаем
  // его прямо сейчас и ждём завершения перед сохранением отзыва.
  const coverUrl = document.getElementById("f-cover").value.trim();
  if (coverUrl && coverUrl.startsWith("http") && !document.getElementById("f-cover-backup").value) {
    clearTimeout(backupCoverTimer);
    setStatus("", i18n("Делаю резервную копию обложки перед сохранением..."));
    await backupCoverNow();
  }

  const url2 = document.getElementById("f-url2").value.trim() || null;
  const source2 = document.getElementById("f-source2").value || null;

  const dateStart = document.getElementById("f-date-start")?.value || null;
  const dateEnd = document.getElementById("f-date-end")?.value || null;

  const cover = document.getElementById("f-cover").value.trim() || null;

  // Номер тайтла в чужой базе достаётся из самой ссылки на обложку –
  // ничего дополнительно вводить не нужно. Нужен он для будущего
  // импорта списков: там всё сходится по номерам, а не по названиям
  // (см. js/external-ids.js). Уже проставленные номера не затираем –
  // часть из них дозапрошена у API и в ссылке не лежит.
  const ids = mergeIds(editingIds, extractIdsFromCover(cover));

  const review = {
    title,
    url,
    type: document.getElementById("f-type").value,
    status,
    favorite: document.getElementById("f-favorite").checked || false,
    source: url ? document.getElementById("f-source").value : null,
    url2,
    source2: url2 ? source2 : null,
    year: document.getElementById("f-year").value.trim() || null,
    format: document.getElementById("f-format").value.trim() || null,
    cover,
    cover_backup: document.getElementById("f-cover-backup").value.trim() || null,
    date_start: dateStart,
    rewatch_count: parseInt(document.getElementById("rewatch-count").value, 10) || 0,
    date_end: dateEnd,
    preview: preview || null,
    review_full: reviewFull || null,
    grade: selectedGrade,
    tags: [...selectedTags],
    featured_tags_on_card: [...featuredCardTags].filter((t) => selectedTags.has(t)),
    no_tags_on_card: noTagsOnCard,
  };

  if (Object.keys(ids).length) review.ids = ids;

  if (editingId !== null) review._editId = editingId;

  btn.disabled = true;
  btn.textContent = i18n("Сохраняем…");
  setStatus("", "");

  try {
    const res = await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(review),
    });
    const data = await res.json();
    if (res.ok) {
      setStatus("ok", editingId !== null ? `«${title}» обновлён.` : `«${title}» сохранён.`);
      setAddDirty(false);
      // Отзыв только что сохранён с другой резервной копией (или вовсе
      // без неё) – прежняя больше никем не используется, теперь это
      // подтверждено, а не просто локальная правка в форме. Удалять
      // раньше этого момента было нельзя: несохранённый уход из
      // редактора должен был оставить отзыв таким, каким он был.
      if (originalCoverBackup && originalCoverBackup !== review.cover_backup) {
        deleteMediaFile(originalCoverBackup);
      }
      originalCoverBackup = review.cover_backup;
      // Тот же общий кэш, что читают favorites.js/tierlist.js между
      // вызовами fetchReviews() (js/api.js) – без сброса они ещё
      // мгновение показывали бы старые данные.
      cache.reviews = null;
      // Вкладка под /add спрятана через .hidden, а не разобрана, и сама
      // не перечитается, пока по ней не щёлкнут заново (js/api.js,
      // refreshOpenReviewsTab) – иначе после правки названия старое ещё
      // висело бы в «Отзывах», пока не переключиться туда-обратно.
      refreshOpenReviewsTab();
      if (editingId === null) {
        if (fromPassportModal) {
          // Секунда на «сохранён», чтобы было видно, что сохранение
          // случилось, – и сами закрываем модалку: человек остаётся
          // там же, на чужом паспорте, а не на пустой форме под
          // следующую запись, которую эта ветка не сбрасывает.
          setTimeout(() => closeAddView(), 900);
          return;
        }
        resetToNew();
      }
    } else {
      setStatus("err", i18n("Ошибка: ") + (data.error || i18n("неизвестная")));
    }
  } catch (e) {
    setStatus("err", i18n("Ошибка сети: ") + e.message);
  }

  btn.disabled = false;
  btn.textContent = editingId !== null ? "Сохранить изменения" : i18n("Сохранить отзыв");
}

// ── Признак несохранённых изменений ────────────
// addDirty сам по себе – обычный let: читать его снаружи (кроме
// модалки паспорта) некому. setAddDirty() – единственное место, которое
// решает, зеркалить ли значение в window.addDirty (см. шапку файла).
let addDirty = false;

function setAddDirty(value) {
  addDirty = value;
  if (fromPassportModal) window.addDirty = value;
}

function markAddDirty() {
  setAddDirty(true);
}

// В одиночном add.html router.js не подключён – там вызывает mount()
// напрямую его же собственный маленький скрипт-загрузчик (см. шапку
// файла и разметку add.html).
if (IN_SPA_SHELL) registerRoute("#/add", { mount, unmount });
