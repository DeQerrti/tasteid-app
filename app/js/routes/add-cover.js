// Часть редактора отзыва (#/add) – см. шапку app/js/routes/add.js про
// разбивку файла и про то, что порядок подключения между этими файлами
// не важен, add.js должен идти первым.

function previewCover(url) {
  const img = document.getElementById("cover-img");
  // Раньше проверялось только url.startsWith("http") – из-за этого превью
  // не показывалось после загрузки файла на сервер (относительный путь
  // вида "/covers/xxx.webp" такой проверке не проходил).
  if (url && url.trim()) {
    img.src = url;
    img.style.display = "block";
  } else img.style.display = "none";
}

// ── Галерея обложек ─────────────────────────────
// Раньше новая ссылка на обложку тихо стирала предыдущую резервную
// копию (см. историю discardScratchCoverBackup ниже) – если человек
// перебирал несколько картинок подряд, искал ту самую, старые терялись
// без возможности вернуться. Теперь все резервные копии, когда-либо
// сделанные для этого отзыва (в том числе до этой самой правки),
// копятся здесь и уходят на сервер вместе с отзывом – ничего не
// удаляется само, только по явному нажатию в галерее
// (openGalleryModal, js/gallery-modal.js).
let coverGallery = [];

function coverGalleryAdd(url) {
  if (!url || coverGallery.includes(url)) return;
  coverGallery.push(url);
}

function openCoverGallery() {
  if (!coverGallery.length) return;
  openGalleryModal({
    images: coverGallery,
    active: document.getElementById("f-cover-backup").value.trim() || null,
    onSelect: (url) => {
      document.getElementById("f-cover").value = "";
      document.getElementById("f-cover-backup").value = url || "";
      previewCover(url);
    },
    onDelete: async (url) => {
      await deleteMediaFile(url);
      coverGallery = coverGallery.filter((u) => u !== url);
    },
  });
}

// ── Инлайн-панель обложки – свёрнута за кнопкой «+ Добавить обложку»,
//    так же как источники ниже. ──
function openCoverPanel() {
  document.getElementById("cover-add-btn").classList.add("hidden");
  document.getElementById("cover-panel").classList.remove("hidden");
  document.getElementById("f-cover").focus();
}

function closeCoverPanel() {
  // Ничего не удаляем с диска – см. комментарий у coverGallery выше:
  // все уже сделанные резервные копии просто перестают быть частью
  // формы, а не стираются. Явное удаление – только через галерею.
  coverGallery = [];
  document.getElementById("f-cover").value = "";
  document.getElementById("f-cover-backup").value = "";
  document.getElementById("f-cover-upload").value = "";
  document.getElementById("f-cover-upload-name").textContent = "";
  document.getElementById("cover-upload-status").textContent = "";
  previewCover("");
  document.getElementById("cover-panel").classList.add("hidden");
  document.getElementById("cover-add-btn").classList.remove("hidden");
}

// Раскрыть/свернуть панель обложки по наличию значения – как у источников.
function syncCoverPanel() {
  const hasCover = document.getElementById("f-cover").value.trim().length > 0;
  document.getElementById("cover-add-btn").classList.toggle("hidden", hasCover);
  document.getElementById("cover-panel").classList.toggle("hidden", !hasCover);
}

async function uploadCoverFile() {
  const fileInput = document.getElementById("f-cover-upload");
  const status = document.getElementById("cover-upload-status");
  if (!fileInput.files.length) {
    status.textContent = i18n("Выберите файл");
    status.style.color = "var(--red-hi, #c0392b)";
    return;
  }
  const title = document.getElementById("f-title").value.trim() || "cover";
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Обрабатываю...");
  status.style.color = "";
  try {
    const keepOriginal = document.getElementById("f-cover-original")?.checked || false;
    const { base64, ext } = await encodeUploadFile(fileInput.files[0], keepOriginal);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "covers", filename: `${slug}.${ext}`, contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    document.getElementById("f-cover").value = "";
    document.getElementById("f-cover-backup").value = data.url;
    coverGalleryAdd(data.url);
    previewCover(data.url);
    status.textContent = i18n("Загружено ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

// ── Автобэкап картинки по ссылке – качается на сервере, чтобы не
//    упереться в CORS. Срабатывает через паузу после ввода, не на
//    каждую напечатанную букву. ──
let backupCoverTimer = null;

function scheduleBackupCover() {
  clearTimeout(backupCoverTimer);
  document.getElementById("f-cover-backup").value = "";
  backupCoverTimer = setTimeout(backupCoverNow, 1200);
}

async function backupCoverNow() {
  const url = document.getElementById("f-cover").value.trim();
  const status = document.getElementById("cover-upload-status");
  if (!url || !url.startsWith("http")) return;

  const title = document.getElementById("f-title").value.trim() || "cover";
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) +
    "-" +
    Date.now().toString(36).slice(-5);

  status.textContent = i18n("Делаю резервную копию обложки...");
  status.style.color = "";
  try {
    const original = document.getElementById("f-cover-original")?.checked || false;
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug, original }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    const backupUrl = data.url || "/" + data.path;
    document.getElementById("f-cover-backup").value = backupUrl;
    coverGalleryAdd(backupUrl);
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}
