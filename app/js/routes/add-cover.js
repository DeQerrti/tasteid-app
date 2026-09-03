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

// ── Инлайн-панель обложки – свёрнута за кнопкой «+ Добавить обложку»,
//    так же как источники ниже. ──
function openCoverPanel() {
  document.getElementById("cover-add-btn").classList.add("hidden");
  document.getElementById("cover-panel").classList.remove("hidden");
  document.getElementById("f-cover").focus();
}

function closeCoverPanel() {
  discardScratchCoverBackup();
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

// ── Загрузка своей картинки как обложки (вместо/вместе со ссылкой) ──
function convertCoverToWebp(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const maxSide = Math.max(width, height);
      if (maxSide > 1200) {
        const scale = 1200 / maxSide;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error(i18n("Не удалось сконвертировать")));
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        },
        "image/webp",
        0.85
      );
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
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
    const base64 = await convertCoverToWebp(fileInput.files[0]);
    const res = await fetch("/api/upload-char-image", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePath: "covers", filename: slug + ".webp", contentBase64: base64 }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Ошибка загрузки"));

    // Обложка загружена напрямую – своя резервная копия ей не нужна.
    discardScratchCoverBackup();
    document.getElementById("f-cover").value = "";
    document.getElementById("f-cover-backup").value = data.url;
    previewCover(data.url);
    status.textContent = i18n("Загружено ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Ошибка: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

// ── Удаление заброшенных резервных копий обложки ────
// Раньше вставка новой ссылки на обложку поверх старой создавала
// новый файл в covers-backup/, а старый оставался лежать на диске
// вечно, никем больше не используемый. Удалять его сразу же безопасно
// только если он не совпадает с originalCoverBackup – это резервная
// копия, на которую УЖЕ ссылается сохранённый отзыв, и трогать её до
// подтверждённого сохранения новой нельзя: не сохранив правку и уйдя
// из редактора, человек ожидает увидеть отзыв таким же, каким он был.
// Сам запрос на удаление (deleteMediaFile) – общий с chars-edit.js и
// favorites-edit.js, живёт в utils.js.
function discardScratchCoverBackup() {
  const current = document.getElementById("f-cover-backup").value.trim();
  if (current && current !== originalCoverBackup) deleteMediaFile(current);
}

// ── Автобэкап картинки по ссылке – качается на сервере, чтобы не
//    упереться в CORS. Срабатывает через паузу после ввода, не на
//    каждую напечатанную букву. ──
let backupCoverTimer = null;

function scheduleBackupCover() {
  clearTimeout(backupCoverTimer);
  discardScratchCoverBackup();
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
    const res = await fetch("/api/backup-cover", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename: slug }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || i18n("Не удалось сохранить копию"));
    document.getElementById("f-cover-backup").value = data.url || "/" + data.path;
    status.textContent = i18n("Резервная копия сохранена ✓");
    status.style.color = "var(--green, #4a8c5c)";
  } catch (e) {
    status.textContent = i18n("Резервную копию сделать не удалось: ") + e.message;
    status.style.color = "var(--red-hi, #c0392b)";
  }
}

