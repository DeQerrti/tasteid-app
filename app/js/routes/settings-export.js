// ══════════════════════════════════════════════
//  «Настройки → Перенос → Экспорт»: все записи таблицей (CSV)
//  Для Excel, Google Таблиц, Numbers: забрать свои данные, поделиться
//  списком, посчитать что-то своё. В отличие от резервной копии (.json,
//  «Приложение»), это не для восстановления, а для чтения человеком –
//  поэтому статусы, типы и оценки подписаны словами, как в приложении.
//  Зависит от: config.js (TYPE_LABELS, activeStatusBuckets,
//  gradeValueLabel), theme.js (siteLabel), api.js (fetchReviews, cache).
// ══════════════════════════════════════════════

// Какие статусы выгружать – по умолчанию все. Живёт до перезагрузки.
const exportCsvSkip = new Set();

function exportCsvStatusLabel(key) {
  if (key === "completed") return siteLabel("statuses", "archive", i18n("Завершено"));
  return activeStatusBuckets().find((b) => b.key === key)?.label || key || "";
}

// Порядок статусов – как во вкладке «Статусы», законченное – последним.
function exportCsvStatusKeys(reviews) {
  const present = new Set(reviews.map((r) => r.status || ""));
  const ordered = [...activeStatusBuckets().map((b) => b.key), "completed"];
  return [...ordered.filter((k) => present.has(k)), ...[...present].filter((k) => !ordered.includes(k))];
}

// Числовая шкала («8/10») и звёзды – просто числом: Excel читает «8/10»
// как дату 8 октября и молча портит столбец. Названия полок – словом.
function exportCsvGrade(raw) {
  if (raw === null || raw === undefined || raw === "") return "";
  const scale = window.SITE_GRADE_SCALE;
  if (scale && scale.type !== "categorical") return String(raw);
  return gradeValueLabel(raw) || String(raw);
}

function exportCsvGradeHeader() {
  const scale = window.SITE_GRADE_SCALE;
  if (scale?.type === "stars") return i18n("Оценка (звёзд)");
  if (scale && scale.type !== "categorical") return i18n("Оценка (из {n})", { n: scale.numericMax || 10 });
  return i18n("Оценка");
}

// Русский Excel ждёт «;» (запятая у него – десятичный знак), английский –
// «,». Google Таблицы и Numbers понимают оба.
function exportCsvSeparator() {
  return I18N_CURRENT === "ru" ? ";" : ",";
}

// Ячейка в кавычках, если в ней разделитель, кавычка или перенос строки
// (текст отзыва – с абзацами). Начало с «=» или «@» Excel принял бы за
// формулу – такой ячейке ставим апостроф впереди.
function exportCsvCell(value, sep) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=@]/.test(s)) s = "'" + s;
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsvText(reviews) {
  const sep = exportCsvSeparator();
  const columns = [
    [i18n("Название"), (r) => r.title],
    [i18n("Тип"), (r) => TYPE_LABELS[r.type] || r.type],
    [i18n("Статус"), (r) => exportCsvStatusLabel(r.status)],
    [exportCsvGradeHeader(), (r) => exportCsvGrade(r.grade)],
    [i18n("Год выхода"), (r) => r.year],
    [i18n("Начато"), (r) => r.date_start],
    [i18n("Закончено"), (r) => r.date_end],
    [i18n("Пересмотров"), (r) => r.rewatch_count || ""],
    [i18n("Теги"), (r) => (r.tags || []).join(", ")],
    [i18n("В любимом"), (r) => (r.favorite ? i18n("да") : "")],
    [i18n("Отзыв"), (r) => ((r.review_full || "").trim() || (r.preview || "").trim()).replace(/\r\n/g, "\n")],
    [i18n("Ссылка"), (r) => r.url],
    [i18n("Ссылка 2"), (r) => r.url2],
  ];
  const lines = [columns.map(([head]) => exportCsvCell(head, sep)).join(sep)];
  for (const r of reviews) lines.push(columns.map(([, get]) => exportCsvCell(get(r), sep)).join(sep));
  // BOM – иначе Excel открывает UTF-8 как кракозябры вместо кириллицы.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function exportCsvPicked() {
  return (cache.reviews || []).filter((r) => !exportCsvSkip.has(r.status || ""));
}

function exportCsvSyncCount() {
  const n = exportCsvPicked().length;
  const count = document.getElementById("export-csv-count");
  if (count) count.textContent = `${n} ${plural(n, [i18n("запись"), i18n("записи"), i18n("записей")])}`;
  const btn = document.getElementById("export-csv-btn");
  if (btn) btn.disabled = !n;
}

async function loadExportPanel() {
  const box = document.getElementById("exportPanel");
  if (!box) return;
  try {
    await fetchReviews();
  } catch (e) {
    box.innerHTML = `<p class="panel-intro">${esc(i18n("Ошибка:"))} ${esc(e.message)}</p>`;
    return;
  }
  const reviews = cache.reviews || [];
  const counts = {};
  for (const r of reviews) counts[r.status || ""] = (counts[r.status || ""] || 0) + 1;
  const checks = exportCsvStatusKeys(reviews)
    .map(
      (key) => `<label class="export-csv-status">
        <input type="checkbox" data-no-dirty data-export-status="${esc(key)}" ${exportCsvSkip.has(key) ? "" : "checked"}>
        ${esc(exportCsvStatusLabel(key) || i18n("Без статуса"))} <span class="section-count">${counts[key]}</span>
      </label>`
    )
    .join("");
  box.innerHTML = `
    <p class="panel-intro">${i18n("Все записи одним файлом-таблицей (CSV): открывается в Excel, Google Таблицах и Numbers. По строке на тайтл, по столбцу на название, тип, статус, оценку, даты, теги, текст отзыва и ссылки.")}</p>
    ${
      reviews.length
        ? `<h2 class="section-h">${i18n("Что выгрузить")}</h2>
    <div class="export-csv-statuses">${checks}</div>
    <div class="export-csv-actions">
      <button type="button" class="btn" id="export-csv-btn">${i18n("Скачать таблицу")}</button>
      <span class="export-csv-count" id="export-csv-count"></span>
    </div>
    <p class="panel-intro">${i18n("Это копия для чтения: обратно в приложение таблица не загружается. Чтобы перенести всё целиком на другое устройство – резервная копия в «Приложении».")}</p>`
        : `<p class="panel-intro">${i18n("Пока выгружать нечего – в паспорте нет ни одной записи.")}</p>`
    }`;
  box.querySelectorAll("[data-export-status]").forEach((input) =>
    input.addEventListener("change", () => {
      if (input.checked) exportCsvSkip.delete(input.dataset.exportStatus);
      else exportCsvSkip.add(input.dataset.exportStatus);
      exportCsvSyncCount();
    })
  );
  document.getElementById("export-csv-btn")?.addEventListener("click", exportCsvDownload);
  exportCsvSyncCount();
}

// Тот же путь, что у резервной копии: <a download>, вставленная в
// документ, – на телефоне её перехватывает мобильная сборка и отдаёт в
// «Поделиться» (см. scripts/check-mobile-downloads.js).
function exportCsvDownload() {
  const reviews = exportCsvPicked();
  if (!reviews.length) return;
  const blob = new Blob([exportCsvText(reviews)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasteid-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
