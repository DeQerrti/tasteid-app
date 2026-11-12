// ══════════════════════════════════════════════
//  API – те же адреса, что были у сайта
//
//  Фронтенд переехал сюда без единой правки, и это не случайность: он
//  по-прежнему ходит за /api/save-review и /api/list-chars, ничего не
//  зная о том, что на другом конце теперь папка на диске, а не GitHub.
//  Поэтому здесь повторены и адреса, и форма ответов – вплоть до того,
//  что ошибка приезжает как { error: "…" }.
//
//  Чего здесь нет по сравнению с сайтом:
//
//    login / logout – некому логиниться. Приложение уже открыто тем, кто
//    его запустил, и пароль защищал бы папку от её же владельца.
//
//    Разбора кто такой sha и что делать при конфликте – файл на диске
//    один, и правит его один процесс.
// ══════════════════════════════════════════════

import { isAllowedFile, isDotSegment } from "./files.js";

// ── Общее ──────────────────────────────────────

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const date = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

// Порядок отзывов – тот же, что был на сайте: свежее сверху.
function sortReviews(list) {
  return list.sort((a, b) => {
    const da = new Date(b.date_end || b.date_start || b.date || 0);
    const db = new Date(a.date_end || a.date_start || a.date || 0);
    return da - db;
  });
}

// Две разные проверки, и это не придирка. Название коллекции или папки
// точек содержать не должно – из него получается имя файла на диске.
// А у самого файла точка есть всегда: light.webp. Одна общая проверка
// на оба случая отвергала бы любое имя картинки.
function isSafeName(name) {
  return typeof name === "string" && name.length > 0 && name.length < 100 && !/[/\\.]/.test(name);
}

function isSafeFileName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 200 &&
    !/[/\\]/.test(name) &&
    !isDotSegment(name)
  );
}

function collectionFile(collection) {
  return collection === "characters" ? "characters-tier.json" : `tier-${collection}.json`;
}

// "characters" исторически лежит в chars/, у остальных коллекций папка
// называется как сам id – так было на сайте, так остаётся и здесь.
function imageFolder(collection) {
  return !collection || collection === "characters" ? "chars" : collection;
}

// ── Отзывы ─────────────────────────────────────

async function saveReview({ vault, body }) {
  // Перестановка порядка любимых тайтлов.
  if (Array.isArray(body._reorder_favorites)) {
    const order = new Map(body._reorder_favorites.map((id, i) => [String(id), i]));
    const list = await vault.readJson("reviews.json", []);
    for (const r of list) {
      if (r.favorite === true && order.has(String(r.id))) r.fav_order = order.get(String(r.id));
    }
    await vault.writeJson("reviews.json", list);
    return { ok: true };
  }

  // Переименование или удаление тега во всех отзывах. Теги лежат в
  // отзывах строками, поэтому правку нельзя оставить только в
  // настройках: старые отзывы остались бы со строкой, которой больше
  // нет в справочнике – без подсказки и без цвета.
  if (body._rename_tag && typeof body._rename_tag === "object") {
    const from = String(body._rename_tag.from || "").trim();
    const to = String(body._rename_tag.to || "").trim();
    if (!from) throw new ApiError("Не указан тег");

    const list = await vault.readJson("reviews.json", []);
    let touched = 0;
    for (const r of list) {
      if (!Array.isArray(r.tags) || !r.tags.includes(from)) continue;
      touched++;
      // Через Set: переименование в уже существующий тег не должно
      // оставить дубль внутри одного отзыва.
      r.tags = [...new Set(r.tags.map((t) => (t === from ? to : t)).filter(Boolean))];
    }
    if (touched) await vault.writeJson("reviews.json", list);
    return { ok: true, touched };
  }

  // Массово поставить или снять «не показывать теги на карточке» сразу
  // во всех отзывах – переключатель в настройках (js/routes/settings-
  // edit.js). Пишет тот же флаг (no_tags_on_card), что и чекбокс в
  // редакторе одного отзыва (add.js): это разовое массовое действие, а
  // не отдельная настройка – дальше каждый отзыв просто хранит своё
  // значение. Оба направления симметричны: включение ставит флаг всем,
  // выключение снимает его вообще у всех, включая отзывы, где галочку
  // поставили вручную через редактор одного отзыва, а не этой кнопкой –
  // отдельно "чьих" галочек это были, приложение не помнит, и не должно.
  if (typeof body._hide_all_card_tags === "boolean") {
    const flag = body._hide_all_card_tags;
    const list = await vault.readJson("reviews.json", []);
    let touched = 0;
    for (const r of list) {
      if (r.no_tags_on_card === flag) continue;
      r.no_tags_on_card = flag;
      touched++;
    }
    if (touched) await vault.writeJson("reviews.json", list);
    return { ok: true, touched };
  }

  // Пересчёт оценок при смене типа шкалы (js/routes/settings-labels.js,
  // saveSettings()) – «Названия» ↔ «Числа»/«Звёзды» или смена макс.
  // значения у чисел/звёзд хранят/читают сырое значение по-разному, и
  // без пересчёта старые оценки просто переставали бы находить свою
  // полку под новой шкалой – не удалялись бы из файла, но пропадали
  // бы отовсюду, где их показывают. Карта строится на клиенте (там же,
  // где посчитана и новая шкала), сюда приезжает уже готовым
  // соответствием «старое сырое значение → новое», применяется одним
  // проходом и одной записью на диск.
  if (body._regrade_map && typeof body._regrade_map === "object") {
    const map = body._regrade_map;
    const list = await vault.readJson("reviews.json", []);
    let touched = 0;
    for (const r of list) {
      if (r.grade === null || r.grade === undefined) continue;
      const key = String(r.grade);
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      r.grade = map[key];
      touched++;
    }
    if (touched) await vault.writeJson("reviews.json", list);
    return { ok: true, touched };
  }

  if (!body.title) throw new ApiError("Нужно название");

  const list = await vault.readJson("reviews.json", []);
  const review = { ...body };
  const editId = review._editId;
  delete review._editId;

  if (editId !== undefined && editId !== null) {
    const idx = list.findIndex((r) => String(r.id) === String(editId) || r.title === editId);
    if (idx === -1) throw new ApiError(`Отзыв с id «${editId}» не найден`, 404);
    if (list[idx].fav_order !== undefined && review.fav_order === undefined) {
      review.fav_order = list[idx].fav_order;
    }
    if (list[idx].id !== undefined) review.id = list[idx].id;
    list[idx] = review;
  } else {
    review.id = list.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;
    list.unshift(review);
  }

  await vault.writeJson("reviews.json", sortReviews(list));
  return { ok: true, id: review.id };
}

async function deleteReview({ vault, body }) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("Нужен номер записи");

  const list = await vault.readJson("reviews.json", []);
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) throw new ApiError("Такой записи уже нет – возможно, её удалили раньше.", 404);

  const [removed] = list.splice(idx, 1);
  await vault.writeJson("reviews.json", list);
  return { ok: true, title: removed.title };
}

// Перенос списка из чужого сервиса. Разбор выгрузки и все решения о
// соответствии оценок и статусов остаются на фронтенде – сюда приезжает
// готовый список записей в нашем виде.
async function importReviews({ vault, body }) {
  const incoming = Array.isArray(body.items) ? body.items : null;
  if (!incoming || !incoming.length) throw new ApiError("Нечего импортировать");

  const list = await vault.readJson("reviews.json", []);

  // Индекс по всему, чем запись можно опознать. Номера надёжнее, но есть
  // не везде: у Letterboxd их нет вовсе, и для фильмов остаётся название
  // с типом и годом. Ключ, под которым оказалось больше одной записи,
  // выбрасываем – лучше завести дубль, чем переписать не ту запись.
  const keysOf = (r) => {
    const keys = [];
    for (const [base, value] of Object.entries(r.ids || {})) {
      if (value) keys.push(`${base}:${value}`);
    }
    const title = String(r.title || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
    keys.push(`t:${title}|${r.type || ""}|${r.year ? String(r.year).slice(0, 4) : ""}`);
    return keys;
  };

  const index = new Map();
  const ambiguous = new Set();
  for (const review of list) {
    for (const key of keysOf(review)) {
      if (index.has(key) && index.get(key) !== review) ambiguous.add(key);
      else index.set(key, review);
    }
  }
  for (const key of ambiguous) index.delete(key);

  let maxId = list.reduce((m, r) => Math.max(m, r.id ?? 0), 0);
  let added = 0;
  const addedIds = []; // для резервных копий обложек после переноса (setCoverBackups)
  let updated = 0;

  for (const raw of incoming) {
    const ids = {};
    if (raw.ids && typeof raw.ids === "object") {
      for (const key of [
        "mal",
        "anilist",
        "tmdb",
        "igdb",
        "hardcover_edition",
        "goodreads",
        "isbn13",
        "steam",
      ]) {
        const value = num(raw.ids[key]);
        if (value) ids[key] = value;
      }
    }
    const item = {
      title: str(raw.title),
      type: str(raw.type),
      status: str(raw.status),
      grade: str(raw.grade),
      year: str(raw.year),
      cover: str(raw.cover),
      rewatch_count: Number.isFinite(Number(raw.rewatch_count)) ? Number(raw.rewatch_count) : 0,
      date_start: date(raw.date_start),
      date_end: date(raw.date_end),
      ids: Object.keys(ids).length ? ids : undefined,
    };
    if (!item.title) continue;

    const existing = keysOf(item)
      .map((k) => index.get(k))
      .find(Boolean);
    if (existing) {
      if (!body.overwrite) continue;
      // Меняем только то, что пришло из выгрузки. Текст отзыва, флаг
      // «любимое» и теги – своё, нажитое, и импорт их не касается.
      // Статус и оценку – тоже только когда они в выгрузке есть. Раньше
      // пустое значение (тайтл без оценки на MAL, список без статусов)
      // записывалось поверх своего и молча стирало уже поставленную
      // оценку.
      if (item.status) existing.status = item.status;
      if (item.grade) existing.grade = item.grade;
      existing.rewatch_count = item.rewatch_count;
      if (item.date_start) existing.date_start = item.date_start;
      if (item.date_end) existing.date_end = item.date_end;
      existing.ids = { ...(existing.ids || {}), ...item.ids };
      for (const key of keysOf(existing)) if (!index.has(key)) index.set(key, existing);
      updated++;
      continue;
    }

    maxId++;
    list.push({
      title: item.title,
      url: null,
      type: item.type,
      status: item.status,
      favorite: false,
      source: null,
      url2: null,
      source2: null,
      year: item.year,
      format: null,
      cover: item.cover,
      cover_backup: null,
      date_start: item.date_start,
      rewatch_count: item.rewatch_count,
      date_end: item.date_end,
      favorites: null,
      grade: item.grade,
      tags: [],
      id: maxId,
      ids: item.ids,
    });
    // В индекс сразу: если запись встретится в выгрузке дважды, второй
    // раз она уже найдётся.
    const fresh = list[list.length - 1];
    for (const key of keysOf(fresh)) if (!index.has(key)) index.set(key, fresh);
    added++;
    addedIds.push(maxId);
  }

  if (added || updated) await vault.writeJson("reviews.json", sortReviews(list));
  return { ok: true, added, updated, added_ids: addedIds };
}

// Резервные копии обложек после импорта – пачкой, одной записью файла.
// Сами картинки скачивает /api/backup-cover (по одной, как редактор);
// сюда приходит только «у отзыва id копия такая-то». Сохранять каждый
// отзыв отдельно через /api/save-review нельзя: импорт – это сотни
// записей, и каждая переписала бы reviews.json и оставила свою версию
// в истории.
//
// Ставим копию, только если обложка за это время не сменилась и копии
// ещё нет: человек мог открыть отзыв и поставить свою, пока шёл импорт.
async function setCoverBackups({ vault, body }) {
  const items = Array.isArray(body?.items) ? body.items : [];
  const byId = new Map();
  for (const it of items) {
    if (it && it.id !== undefined && typeof it.cover === "string" && str(it.cover_backup)) {
      // Только свои же копии – путь в covers-backup, без выхода из папки.
      if (/^\/covers-backup\/[^/]+$/.test(it.cover_backup)) byId.set(String(it.id), it);
    }
  }
  if (!byId.size) return { ok: true, updated: 0 };
  const list = await vault.readJson("reviews.json", []);
  let updated = 0;
  for (const r of list) {
    const it = byId.get(String(r.id));
    if (!it || r.cover !== it.cover || r.cover_backup) continue;
    r.cover_backup = it.cover_backup;
    updated++;
  }
  if (updated) await vault.writeJson("reviews.json", list);
  return { ok: true, updated };
}

// ── Любимое ────────────────────────────────────

async function saveFavorite({ vault, body }) {
  const list = await vault.readJson("favorites.json", []);

  if (Array.isArray(body._reorder)) {
    const byId = new Map(list.map((r) => [String(r.id), r]));
    const reordered = body._reorder.map((id) => byId.get(String(id))).filter(Boolean);
    // Записи, не попавшие в новый порядок, дописываем в конец: потерять
    // их из-за неполного списка было бы хуже, чем сохранить не там.
    const inNew = new Set(body._reorder.map(String));
    for (const r of list) if (!inNew.has(String(r.id))) reordered.push(r);
    await vault.writeJson("favorites.json", reordered);
    return { ok: true };
  }

  // Удаление своего раздела «Любимого» (favorites-edit.js,
  // removeFavTypePicker) забирает с собой все записи этого раздела разом –
  // одним запросом, а не по одной на каждую, чтобы не оставить хранилище
  // в промежуточном состоянии, если что-то прервётся на середине списка.
  if (Array.isArray(body._deleteMany)) {
    const ids = new Set(body._deleteMany.map(String));
    const rest = list.filter((r) => !ids.has(String(r.id)));
    await vault.writeJson("favorites.json", rest);
    return { ok: true, deleted: list.length - rest.length };
  }

  if (body._delete !== undefined && body._delete !== null) {
    const id = String(body._delete);
    const rest = list.filter((r) => String(r.id) !== id);
    if (rest.length === list.length) throw new ApiError("Такой записи уже нет", 404);
    await vault.writeJson("favorites.json", rest);
    return { ok: true };
  }

  if (!body.name) throw new ApiError("Нужно имя");

  const entry = { ...body };
  const editId = entry._editId;
  delete entry._editId;

  if (editId !== undefined && editId !== null) {
    const idx = list.findIndex((r) => String(r.id) === String(editId));
    if (idx === -1) throw new ApiError(`Запись с id «${editId}» не найдена`, 404);
    entry.id = list[idx].id;
    list[idx] = entry;
  } else {
    entry.id = list.reduce((m, r) => Math.max(m, r.id ?? 0), 0) + 1;
    list.push(entry);
  }

  await vault.writeJson("favorites.json", list);
  return { ok: true, id: entry.id };
}

// ── Тир-листы ──────────────────────────────────

async function saveCharsTier({ vault, body }) {
  // Обратная совместимость: раньше телом был просто массив (всегда
  // коллекция "characters"), теперь ждём { collection, data }.
  const collection = Array.isArray(body) ? "characters" : body.collection;
  const data = Array.isArray(body) ? body : body.data;

  if (!isSafeName(collection)) throw new ApiError("Недопустимое название коллекции");
  if (!Array.isArray(data)) throw new ApiError("Ожидается массив тайтлов");

  await vault.writeJson(collectionFile(collection), data);
  return { ok: true };
}

// Удаление своего раздела тир-листа целиком – сам файл (tier-<id>.json)
// и его папка с картинками персонажей, а не просто снятие с настроек
// (см. removeTierCollectionSetting в settings-grades.js и
// deleteCurrentCollection в chars-edit.js: оба раньше писали data: []
// через saveCharsTier выше, оставляя опустевший файл и папку сиротами
// на диске навсегда). "characters" – встроенный раздел, а не свой,
// удалять его отсюда нельзя.
async function deleteTierCollection({ vault, body }) {
  const collection = body?.collection;
  if (!isSafeName(collection) || collection === "characters") {
    throw new ApiError("Недопустимое название коллекции");
  }
  await vault.deleteDataFile(collectionFile(collection));
  await vault.deleteMediaFolder(imageFolder(collection));
  // Раздел целиком, а не одна запись внутри общего файла (как при
  // удалении отзыва – там история остаётся не просто так, ссылка
  // должна остаться рабочей при откате). Здесь после удаления файла
  // сам раздел больше нигде не появится – ни вкладки в «Истории
  // версий» (initBackupHistoryPanel строит список вкладок из ЖИВЫХ
  // tierCollections в настройках), ни самого раздела, куда откатывать.
  // Без этой строки .history/tier-<id>.json/ оставался бы висеть
  // навсегда, недостижимый ни из одного места интерфейса.
  await vault.clearHistory(collectionFile(collection));
  return { ok: true };
}

// ── Картинки ───────────────────────────────────

async function listChars({ vault, query }) {
  const folder = query.get("folder");
  const collection = query.get("collection") || "characters";
  if (!isSafeName(collection) || (folder && !isSafeName(folder))) {
    throw new ApiError("Недопустимое название коллекции или папки");
  }
  return vault.listImages(imageFolder(collection), folder);
}

// Тело запроса – ровно то же, что слал сайт: { folder, filename,
// contentBase64, basePath }. Менять его значило бы править фронтенд.
//
// Расширение – раньше строго .webp (конвертация всегда шла через canvas
// в браузере перед отправкой). "Оригинальное качество" при загрузке
// (add-cover.js/chars-edit.js/favorites-edit.js) этот шаг сознательно
// пропускает и шлёт файл как есть – отсюда расширенный список.
const UPLOAD_IMAGE_EXTS = new Set(["webp", "png", "jpg", "jpeg", "gif"]);
async function uploadCharImage({ vault, body }) {
  const { folder, filename, contentBase64, basePath } = body;
  const base = isSafeName(basePath) ? basePath : "chars";
  if (folder && !isSafeName(folder)) throw new ApiError("Недопустимое название папки");
  if (!isSafeFileName(filename)) throw new ApiError("Недопустимое название файла");
  const ext = filename.toLowerCase().split(".").pop();
  if (!UPLOAD_IMAGE_EXTS.has(ext)) {
    throw new ApiError("Неподдерживаемый формат файла картинки");
  }
  if (!contentBase64 || typeof contentBase64 !== "string")
    throw new ApiError("Нет содержимого файла");

  const url = await vault.saveMedia(base, filename, base64ToBuffer(contentBase64), folder);
  return { ok: true, url };
}

// Реальный случай, из-за которого это появилось: сотня картинок
// персонажей одного тайтла, скопированных в папку прямо через
// проводник (см. её же историю у newTitleFolderSlug в chars-edit.js) –
// такие файлы никогда не проходят через сжатие (ни через canvas в
// браузере при обычной загрузке файла, ни через compressImage здесь
// при резервной копии по ссылке), остаются в оригинальном качестве и
// формате. Пережимает всё, кроме уже webp (см. её же проверку ext ниже) –
// webp здесь может появиться только одним способом: уже пройдя через
// это же самое сжатие раньше (оно единственное, что вообще производит
// webp на выходе). Пережимать такой файл заново – чистый минус: вес не
// уменьшится, а от повторного перекодирования картинка только потеряет
// в качестве.
//
// compressImage – тот же самый параметр, что и у backupCover ниже,
// только на телефоне за него отвечает canvas (mobile/src/main.js), а
// не sharp – сюда он приходит уже одинаковым по сигнатуре с обеих
// сторон, отдельно проверять платформу не нужно.
async function compressFolder({ vault, body, compressImage }) {
  if (!compressImage) throw new ApiError("Сжатие картинок здесь недоступно");
  const collection = body?.collection || "characters";
  const folder = body?.folder;
  if (collection !== "characters" && !isSafeName(collection)) {
    throw new ApiError("Недопустимое название коллекции");
  }
  if (!isSafeName(folder)) throw new ApiError("Недопустимое название папки");

  const base = imageFolder(collection);
  const { files } = await vault.listImages(base, folder);
  if (!files.length) return { ok: true, converted: 0, skipped: 0 };

  // Ключ – путь БЕЗ ведущего "/", раскодированный (см. её же историю у
  // decodeURIComponent в findOrphanedCovers): url из listImages уже
  // закодирован по сегментам (encodeURIComponent), а хранится в
  // персонажах/тайтлах то в закодированном виде, то в сыром – зависит
  // от того, как именно картинку когда-то добавили (см. её же разбор в
  // CLAUDE.md, раздел про поиск осиротевших файлов).
  const renameMap = new Map();
  let converted = 0;
  let skipped = 0;

  for (const f of files) {
    const oldRel = decodeURIComponent(f.url).replace(/^\/+/, "");
    const oldFilename = oldRel.split("/").pop();
    const ext = (oldFilename.split(".").pop() || "").toLowerCase();

    // webp – единственный формат, в который вообще умеет сжимать
    // compressImage (см. её же electron/image.js и mobile/src/main.js:
    // обе версии всегда возвращают ext: "webp"), а значит webp здесь
    // может появиться только одним способом – уже пройдя через это же
    // самое сжатие (при обычной загрузке через приложение или через эту
    // же кнопку раньше). Гонять его по кругу заново (расшифровка →
    // пересборка → webp quality 85) – чистый минус: вес не уменьшится
    // (уменьшать уже нечего), а от повторного перекодирования картинка
    // только потеряет в качестве. Настоящий смысл кнопки – файлы,
    // скопированные в папку напрямую мимо приложения (see comment above
    // compressCurrentFolder in chars-edit.js), те всегда в исходном
    // формате (png/jpg/…), не webp.
    if (ext === "webp") {
      skipped++;
      continue;
    }

    const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";

    const raw = base64ToBuffer(await vault.readMedia(oldRel));
    const { bytes: outBytes, ext: newExt } = await compressImage(raw, mime);
    const newFilename = oldFilename.replace(/\.[^.]+$/, "") + "." + newExt;

    await vault.saveMedia(base, newFilename, outBytes, folder);
    if (newFilename !== oldFilename) {
      await vault.deleteMedia(oldRel);
      renameMap.set(oldRel, `${base}/${folder}/${newFilename}`);
    }
    converted++;
  }

  // Та же логика, что и у repairCoverReferences ниже, только адресно
  // по тому, что мы сами только что переименовали здесь, – и, в
  // отличие от неё, чинит ещё и ch.img (не только ch.img_backup): у
  // персонажа, выбранного когда-то из уже загруженной галереи, путь
  // всегда лежит именно там (см. её же историю в findOrphanedCovers).
  // ch.img при этом хранится percent-encoded посегментно (см. её же
  // listImages выше и комментарий в findOrphanedCovers), а
  // cover_backup/ch.img_backup – сырым именем с диска. Поэтому здесь,
  // в отличие от repairCoverReferences (та чинит только сырые поля),
  // нужно восстанавливать кодировку у результата, а не только
  // ведущий слэш – иначе у персонажа из галереи ch.img после
  // пережатия стал бы валидным путём с живым пробелом/кириллицей,
  // который браузер не всегда поймёт как один и тот же ресурс.
  if (renameMap.size) {
    const fixRef = (value) => {
      if (!value) return value;
      const hadSlash = value.startsWith("/");
      const decoded = decodeURIComponent(value);
      const clean = decoded.replace(/^\/+/, "");
      const next = renameMap.get(clean);
      if (!next) return value;
      const wasEncoded = decoded !== value;
      const result = wasEncoded ? next.split("/").map(encodeURIComponent).join("/") : next;
      return hadSlash ? "/" + result : result;
    };

    const settings = await vault.readJson("site-settings.json", {});
    const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];
    const collectionIds = new Set([
      "characters",
      ...collections.map((c) => c.id).filter(isSafeName),
    ]);
    for (const id of collectionIds) {
      const titles = await vault.readJson(collectionFile(id), []);
      let touched = false;
      for (const title of titles) {
        const nextCover = fixRef(title.cover_backup);
        if (nextCover !== title.cover_backup) {
          title.cover_backup = nextCover;
          touched = true;
        }
        for (const list of title.tierlists || []) {
          for (const tier of list.tiers || []) {
            for (const ch of tier.chars || []) {
              const nextImg = fixRef(ch.img);
              if (nextImg !== ch.img) {
                ch.img = nextImg;
                touched = true;
              }
              const nextBackup = fixRef(ch.img_backup);
              if (nextBackup !== ch.img_backup) {
                ch.img_backup = nextBackup;
                touched = true;
              }
            }
          }
        }
      }
      if (touched) await vault.writeJson(collectionFile(id), titles);
    }
  }

  // Раздаём переименования наружу – файл на диске уже поправлен выше,
  // но открытый прямо сейчас редактор (chars-edit.js) держит свою же
  // копию тех же данных в памяти браузера, и туда эта запись не долетит
  // сама. Без этого правки на экране не совпадали бы с тем, что реально
  // на диске, до следующей полной перезагрузки страницы.
  return { ok: true, converted, skipped, renames: [...renameMap.entries()] };
}

// Папка темы раньше появлялась на диске только вместе с первой
// загруженной в неё картинкой (см. saveMedia() выше) – значит, и в
// списке "Папка (источник)" её не было видно (listChars() читает папки
// прямо с диска), и открыть её проводником, чтобы скопом накидать туда
// заранее скачанные картинки, было некуда. Тема без единой картинки
// теперь тоже сразу получает свою (пустую) папку.
async function ensureCharsFolder({ vault, body }) {
  const { folder, basePath } = body;
  const base = isSafeName(basePath) ? basePath : "chars";
  if (!folder || !isSafeName(folder)) throw new ApiError("Недопустимое название папки");
  await vault.ensureMediaFolder(base, folder);
  return { ok: true };
}

// Копия обложки «на всякий случай»: внешние картинки живут ровно
// столько, сколько живёт чужой сайт. Скачиваем и кладём в хранилище.
//
// Папка – covers-backup, а не covers: это не то же самое, что ручная
// загрузка своей обложки (add.html шлёт её отдельным запросом, с
// basePath "covers"). Раньше здесь стояло "covers", и бэкап внешней
// обложки писался в ту же папку, что ручная загрузка – перенос с
// разъехавшимся именем сломался бы без предупреждения.
async function backupCover({ vault, body, compressImage }) {
  const { url, filename, original } = body;
  if (!url || typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new ApiError("Нужна корректная ссылка (http/https)");
  }
  if (!isSafeFileName(filename)) throw new ApiError("Недопустимое название файла");

  // Выдуманная строка вида "TasteID cover backup" не похожа ни на один
  // настоящий браузер – источники с защитой от ботов (AniList среди
  // них) такую тихо отсеивают: не 4xx с понятной причиной, а просто
  // обрыв соединения или пустой ответ, поэтому раньше это выглядело
  // как "ссылка недоступна", хотя сама ссылка открывалась в браузере
  // без проблем. Referer на домен самой картинки – тот же обычный
  // обход хотлинк-защиты, которая сверяет источник запроса со своим
  // же доменом, а не с конкретной страницей на нём.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: new URL(url).origin + "/",
      },
      signal: controller.signal,
    });
  } catch (e) {
    throw new ApiError(
      e.name === "AbortError"
        ? "Картинка не скачалась: сервер не ответил вовремя"
        : `Картинка не скачалась: ${e.message}`,
      502
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError(`Картинка не скачалась: ${res.status}`, 502);

  const type = res.headers.get("content-type") || "";
  let buffer = new Uint8Array(await res.arrayBuffer());

  // Ответ 200 – ещё не картинка: источник с защитой от ботов или
  // истёкшая ссылка нередко отдают с тем же 200 обычную HTML-страницу
  // («подтвердите, что вы не робот», «файл не найден»). Раньше такое
  // сохранялось под именем .jpg, и у отзыва появлялась «резервная
  // копия», которая не открывается. Формат определяем по первым байтам
  // самого файла – заголовку Content-Type верить нельзя в обе стороны
  // (CDN часто отдаёт картинку как application/octet-stream). Что не
  // опознано и не названо сервером картинкой – не сохраняем.
  const sniffed = sniffImageExt(buffer);
  if (!sniffed && !/^image\//i.test(type)) {
    throw new ApiError("По ссылке не картинка – резервная копия не сделана", 502);
  }
  let ext =
    sniffed ||
    (/png/.test(type) ? "png" : /webp/.test(type) ? "webp" : /gif/.test(type) ? "gif" : "jpg");

  // compressImage приходит снаружи (electron/image.js на компьютере –
  // sharp, mobile/src/main.js на телефоне – canvas браузера): само
  // API общее для обеих платформ, а нативный модуль sharp в мобильный
  // бандл затянуть нельзя. gif пропускаем – анимация не переживёт
  // перекодирование в статичный webp, лучше оставить оригинал как есть.
  // Само сжатие – необязательный шаг: не удалось – сохраняем
  // оригинал, как было раньше, а не роняем сохранение обложки из-за
  // этого. original – явный выбор человека хранить без сжатия вовсе
  // (настройки → «Оригинальное качество» рядом с полем ссылки).
  if (compressImage && !original && ext !== "gif") {
    try {
      const compressed = await compressImage(buffer, type);
      buffer = compressed.bytes;
      ext = compressed.ext;
    } catch {
      // сжатие не удалось – сохраняем оригинал
    }
  }

  const saved = await vault.saveMedia("covers-backup", `${filename}.${ext}`, buffer);
  return { ok: true, url: saved };
}

// Список с MyAnimeList по нику – так же, как список с AniList по нику
// (js/import.js, fetchAnilistUserList): открытый список отдаётся кому
// угодно, ключ не нужен. Но, в отличие от AniList, у этого эндпоинта
// нет заголовков CORS – это тот же JSON, которым сама страница списка
// подгружает следующую порцию при прокрутке, а не публичное API для
// сторонних приложений. Прямой fetch из браузера такой ответ увидеть
// не даст, поэтому запрос идёт отсюда, а не из js/import.js напрямую.
//
// Официальный API MAL (api.myanimelist.net) для этого не подходит: он
// требует OAuth-регистрацию приложения и вход пользователя, то есть
// то же самое усложнение, которого мы хотели избежать, добавляя вход
// по одному нику, как у AniList.
const MAL_LIST_PAGE = 300; // размер страницы у самого MAL, не наш выбор
const MAL_MAX_PAGES = 20; // с запасом – 6000 записей на список

// Сам HTTP-запрос вынесен наружу, как и compressImage чуть выше:
// на компьютере это обычный fetch (electron/server.js работает в
// Node, а не в браузере, и CORS для него не существует), а на
// телефоне core/api.js исполняется прямо во WebView (см. заголовок
// mobile/src/main.js) – там тот же fetch наткнулся бы на CORS, потому
// что у этого JSON-эндпоинта нет заголовка Access-Control-Allow-Origin.
// mobile/src/main.js подсовывает свою реализацию через нативный мост
// CapacitorHttp, у которого запрос уходит не из WebView, а с телефона
// напрямую.
const MAL_HTTP_TIMEOUT = 8000; // тот же запас, что и у backupCover() ниже

async function defaultMalHttpGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAL_HTTP_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// Возвращает { batch, fatal } вместо того, чтобы просто бросать или
// отдавать null: страница 0 у каждого из двух списков (аниме/манга) –
// частый и совершенно штатный случай 400 (список закрыт или пуст с
// этой стороны, см. ниже), но 400/429/сетевая ошибка НЕ на первой
// странице, когда предыдущие уже отдали данные, ведёт себя иначе –
// список только что успешно листался и вдруг перестал, и списывать
// это на «закрытый профиль» нечестно: профиль не закрывают на
// середине запроса. fatal здесь – сигнал наверх остановиться и
// пометить список как возможно неполный, а не тихо решить, что он
// на этом кончился.
async function fetchMalListPage(kind, username, offset, malHttpGet) {
  const url = `https://myanimelist.net/${kind}list/${encodeURIComponent(username)}/load.json?status=7&offset=${offset}`;
  const firstPage = offset === 0;
  let status, text;
  try {
    ({ status, text } = await malHttpGet(url));
  } catch {
    if (firstPage) {
      throw new ApiError(
        "Не получилось достучаться до MyAnimeList. Проверьте интернет и попробуйте ещё раз."
      );
    }
    return { batch: null, fatal: true };
  }
  // MAL отвечает тем же 400 "invalid request" и на несуществующего/чужого
  // закрытого пользователя, и на существующего, но с пустым списком этого
  // вида (например, только мангу кто-то и не вёл) – различить эти два
  // случая по ответу нечем, поэтому на первой странице это не ошибка,
  // а просто пустая страница; собрать список хотя бы частично важнее
  // точного диагноза.
  if (status === 400) return { batch: null, fatal: !firstPage };
  if (status === 429) {
    if (firstPage) {
      throw new ApiError(
        "MyAnimeList просит подождать – слишком много запросов подряд. Попробуйте через минуту."
      );
    }
    return { batch: null, fatal: true };
  }
  if (status < 200 || status >= 300) {
    if (firstPage)
      throw new ApiError(`MyAnimeList ответил ${status}. Попробуйте ещё раз через минуту.`, 502);
    return { batch: null, fatal: true };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { batch: null, fatal: false };
  }
  return { batch: Array.isArray(data) ? data : null, fatal: false };
}

async function fetchMalUserList({ body, malHttpGet }) {
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  if (!username) throw new ApiError("Нужен ник");
  const httpGet = malHttpGet || defaultMalHttpGet;

  const result = { anime: [], manga: [] };
  // truncated[kind] – список этого вида мог оказаться неполным: либо
  // страница где-то за первой всё-таки отказала (см. fatal выше),
  // либо упёрлись в MAL_MAX_PAGES, а последняя забранная страница
  // была ещё полной (значит за ней наверняка есть ещё). Настоящий
  // конец списка – страница короче MAL_LIST_PAGE – сюда не попадает.
  const truncated = { anime: false, manga: false };
  for (const kind of ["anime", "manga"]) {
    let page = 0;
    for (; page < MAL_MAX_PAGES; page++) {
      const { batch, fatal } = await fetchMalListPage(
        kind,
        username,
        page * MAL_LIST_PAGE,
        httpGet
      );
      if (fatal) {
        truncated[kind] = true;
        break;
      }
      if (!batch) break; // штатный конец/пустой список с этой стороны
      result[kind].push(...batch);
      if (batch.length < MAL_LIST_PAGE) break;
    }
    if (page === MAL_MAX_PAGES) truncated[kind] = true;
  }

  if (!result.anime.length && !result.manga.length) {
    throw new ApiError(
      `MyAnimeList не знает пользователя «${username}», либо его список закрыт настройками профиля.`
    );
  }
  return { ok: true, ...result, truncated };
}

// ── Steam: поиск игры по названию и библиотека профиля ──
// У Steam нет заголовков CORS ни у магазина, ни у Web API – со страницы
// их не спросить, поэтому запросы идут отсюда, тем же путём, что список
// MyAnimeList выше: на компьютере обычный fetch в Node, на телефоне –
// malHttpGet из mobile/src/main.js (нативный CapacitorHttp). Имя
// параметра историческое: это просто «GET мимо CORS», не только для MAL.
//
// Поиск – открытый (магазин, без ключа). Библиотека – только по ключу
// Steam Web API: ключ вводит человек, он хранится в localStorage его
// устройства (как ключ TMDB, см. js/import.js) и приходит сюда в теле
// запроса. Ни в файлы хранилища, ни в журнал он не пишется.
const STEAM_STORE_API = "https://store.steampowered.com/api";
const STEAM_WEB_API = "https://api.steampowered.com";
const STEAM_SEARCH_LIMIT = 10;

async function steamGetJson(httpGet, url) {
  let status, text;
  try {
    ({ status, text } = await httpGet(url));
  } catch {
    throw new ApiError(
      "Не получилось достучаться до Steam. Проверьте интернет и попробуйте ещё раз.",
      502
    );
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // не JSON – ниже решаем по статусу
  }
  return { status, data };
}

// Год выхода – из карточки игры в магазине («24 Apr, 2025»; у будущих
// бывает «Coming soon» или «Q3 2026» – тогда год, если он там есть).
function steamYear(details) {
  const m = /\b(19|20)\d{2}\b/.exec(details?.release_date?.date || "");
  return m ? Number(m[0]) : null;
}

// «Stellar Blade™» → «Stellar Blade»: знаки марки в названии отзыва ни к чему.
const steamName = (name) =>
  String(name || "")
    .replace(/[™®©]/g, "")
    .trim();

async function steamSearch({ body, malHttpGet }) {
  const term = typeof body?.term === "string" ? body.term.trim().slice(0, 200) : "";
  if (!term) throw new ApiError("Нужно название");
  const httpGet = malHttpGet || defaultMalHttpGet;

  // l=english – названия как у остальных игр в паспорте (латиницей).
  // По-русски Steam ищет через раз (проверено: один и тот же запрос
  // «ведьмак» то находит The Witcher 3, то ничего) – подсказка в
  // редакторе советует английское название.
  const search = await steamGetJson(
    httpGet,
    `${STEAM_STORE_API}/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`
  );
  if (search.status < 200 || search.status >= 300 || !search.data) {
    throw new ApiError(`Steam ответил ${search.status}. Попробуйте ещё раз через минуту.`, 502);
  }
  const apps = (search.data.items || [])
    .filter((it) => it && it.type === "app" && Number(it.id))
    .slice(0, STEAM_SEARCH_LIMIT);

  // В поиске вперемешку игры, саундтреки и дополнения, а года нет вовсе –
  // спрашиваем карточку каждой (параллельно). Оставляем только игры;
  // карточка не ответила – оставляем как есть, без года.
  const details = await Promise.all(
    apps.map(async (it) => {
      try {
        const r = await steamGetJson(
          httpGet,
          `${STEAM_STORE_API}/appdetails?appids=${Number(it.id)}&filters=basic,release_date&l=english`
        );
        return r.data?.[it.id]?.success ? r.data[it.id].data : null;
      } catch {
        return null;
      }
    })
  );
  return {
    ok: true,
    items: apps
      .map((it, i) => ({ it, d: details[i] }))
      .filter(({ d }) => !d || d.type === "game")
      .map(({ it, d }) => ({
        id: Number(it.id),
        name: steamName(d?.name || it.name),
        year: steamYear(d),
      })),
  };
}

// Ссылка на профиль, «короткое имя» из неё или 17-значный номер.
function parseSteamProfile(input) {
  const s = String(input || "")
    .trim()
    .replace(/\/+$/, "");
  const byId = /(?:^|\/profiles\/)(7656\d{13})$/.exec(s);
  if (byId) return { steamid: byId[1] };
  const vanity = /(?:steamcommunity\.com\/id\/)?([A-Za-z0-9_-]{2,64})$/.exec(s);
  return vanity ? { vanity: vanity[1] } : null;
}

async function steamLibrary({ body, malHttpGet }) {
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!/^[0-9A-Fa-f]{32}$/.test(key)) {
    throw new ApiError(
      "Ключ Steam – 32 знака из цифр и букв A–F. Проверьте, что он скопирован целиком."
    );
  }
  const profile = parseSteamProfile(body?.profile);
  if (!profile) throw new ApiError("Нужна ссылка на профиль Steam или его номер");
  const httpGet = malHttpGet || defaultMalHttpGet;
  const keyError = (status) =>
    status === 401 || status === 403
      ? new ApiError("Steam не принял ключ. Проверьте, что он скопирован целиком.", 400)
      : null;

  let steamid = profile.steamid;
  if (!steamid) {
    const r = await steamGetJson(
      httpGet,
      `${STEAM_WEB_API}/ISteamUser/ResolveVanityURL/v1/?key=${key}&vanityurl=${encodeURIComponent(profile.vanity)}`
    );
    const bad = keyError(r.status);
    if (bad) throw bad;
    steamid = r.data?.response?.success === 1 ? r.data.response.steamid : null;
    if (!steamid) {
      throw new ApiError(
        `Steam не знает профиль «${profile.vanity}». Вставьте ссылку на профиль целиком.`
      );
    }
  }

  const r = await steamGetJson(
    httpGet,
    `${STEAM_WEB_API}/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamid}&include_appinfo=1&include_played_free_games=1`
  );
  const bad = keyError(r.status);
  if (bad) throw bad;
  if (r.status < 200 || r.status >= 300 || !r.data) {
    throw new ApiError(`Steam ответил ${r.status}. Попробуйте ещё раз через минуту.`, 502);
  }
  // Закрытая «Игровая информация» – Steam отвечает 200 с пустым
  // response, без списка игр и без объяснения.
  const games = r.data.response?.games;
  if (!Array.isArray(games)) {
    throw new ApiError(
      "Steam не показывает игры этого профиля – откройте «Игровую информацию» в настройках приватности профиля."
    );
  }
  return {
    ok: true,
    games: games
      .filter((g) => Number(g.appid) && g.name)
      .map((g) => ({
        appid: Number(g.appid),
        name: steamName(g.name),
        minutes: Number(g.playtime_forever) || 0,
        lastPlayed: Number(g.rtime_last_played) || 0,
      })),
  };
}

// Удаление файла обложки – резервной копии, которую заменила новая
// (см. js/routes/add.js: пасту новой ссылки на обложку раньше не
// сопровождалось удалением старого файла, и на диске годами копились
// заброшенные копии никому уже не нужных обложек). Та же история у
// favorites/ и title-covers/ – собственных загрузок «Любимого» и
// названий тир-листа (см. её же basePath в favorites-edit.js/
// chars-edit.js). Эти четыре плоские папки – чистка своих же файлов
// известных фич, а не удаление чего угодно из хранилища.
const DELETABLE_MEDIA_PATH = /^\/(covers|covers-backup|favorites|title-covers)\/[^/]+$/;

// Портрет персонажа – своя, вложенная форма: <раздел>/<тайтл>/<файл>
// (chars/ у встроенных «Персонажей», id коллекции у своих разделов тир-
// листа). Удаление ОДНОГО персонажа из тир-листа (deleteChar,
// chars-edit.js) не трогает файл на диске – значит, такие файлы тоже
// годятся в осиротевшие (см. findOrphanedCovers) и должны быть
// удаляемы по одному, а не только вместе со всей папкой раздела
// (deleteMediaFolder). <раздел> проверяем по тому же списку, что и
// vault.listAllMedia() (см. её же историю в electron/vault.js) – иначе
// это было бы удаление произвольного пути из двух сегментов.
async function isDeletableMediaPath(vault, relPath) {
  if (DELETABLE_MEDIA_PATH.test(relPath)) return true;
  const m = /^\/([^/]+)\/[^/]+\/[^/]+$/.exec(relPath);
  if (!m) return false;
  const base = m[1];
  if (base === "chars") return true;
  const settings = await vault.readJson("site-settings.json", {});
  const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];
  return collections.some((c) => c.id === base);
}

async function deleteMedia({ vault, body }) {
  const relPath = String(body.path || "");
  if (!(await isDeletableMediaPath(vault, relPath)))
    throw new ApiError("Недопустимый путь для удаления");
  await vault.deleteMedia(relPath.slice(1));
  return { ok: true };
}

// Формат картинки по её первым байтам (см. backupCover выше). null –
// не опознано: либо это не картинка, либо формат, которого здесь нет
// (avif, svg) – тогда решает Content-Type.
function sniffImageExt(bytes) {
  const at = (i, ...sig) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

// Uint8Array, а не Buffer: этот файл делят настольное приложение и
// телефон, а Buffer есть только в Node.
function base64ToBuffer(data) {
  const clean = String(data).replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Починка ссылок на обложки после разового сжатия ──
// В версиях 0.5.21–0.5.25 была кнопка "Сжать старые обложки": она
// пересжимала уже существующие файлы в covers-backup/ и при этом
// переименовывала их (расширение меняется на webp), но НЕ обновляла
// саму ссылку в reviews.json/favorites.json/тир-листах – те
// продолжали указывать на файл под старым именем, которого больше нет
// на диске. Кнопку убрали, но у тех, кто успел ею воспользоваться,
// ссылки остались сломанными – отсюда пустые обложки на карточках и в
// снимке тир-листа. Имя файла (без расширения) присваивается один раз
// при первой резервной копии и больше не меняется (см. slug в
// scheduleBackupCover, add.js) – меняется только расширение при
// сжатии, поэтому по имени без расширения можно надёжно найти, куда
// переехал файл, и поправить ссылку. Вызывается один раз тихо на
// старте (см. js/config.js) – если чинить нечего, ничего и не пишет.
async function repairCoverReferences({ vault }) {
  const all = await vault.listAllMedia();
  const existing = new Set(all);
  const byBase = new Map();
  for (const p of all) {
    if (!p.startsWith("covers-backup/")) continue;
    byBase.set(p.replace(/\.[^./]+$/, ""), p);
  }

  let fixed = 0;
  const fixRef = (value) => {
    if (!value) return value;
    const hadSlash = value.startsWith("/");
    const clean = value.replace(/^\/+/, "");
    if (existing.has(clean)) return value;
    const real = byBase.get(clean.replace(/\.[^./]+$/, ""));
    if (!real || real === clean) return value;
    fixed++;
    return hadSlash ? "/" + real : real;
  };

  const reviews = await vault.readJson("reviews.json", []);
  let reviewsTouched = false;
  for (const r of reviews) {
    const next = fixRef(r.cover_backup);
    if (next !== r.cover_backup) {
      r.cover_backup = next;
      reviewsTouched = true;
    }
  }
  if (reviewsTouched) await vault.writeJson("reviews.json", reviews);

  const favorites = await vault.readJson("favorites.json", []);
  let favoritesTouched = false;
  for (const f of favorites) {
    const next = fixRef(f.image_backup);
    if (next !== f.image_backup) {
      f.image_backup = next;
      favoritesTouched = true;
    }
  }
  if (favoritesTouched) await vault.writeJson("favorites.json", favorites);

  const settings = await vault.readJson("site-settings.json", {});
  const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];
  const collectionIds = new Set(["characters", ...collections.map((c) => c.id).filter(isSafeName)]);
  for (const id of collectionIds) {
    const titles = await vault.readJson(collectionFile(id), []);
    let touched = false;
    for (const title of titles) {
      const nextCover = fixRef(title.cover_backup);
      if (nextCover !== title.cover_backup) {
        title.cover_backup = nextCover;
        touched = true;
      }
      for (const list of title.tierlists || []) {
        for (const tier of list.tiers || []) {
          for (const ch of tier.chars || []) {
            const next = fixRef(ch.img_backup);
            if (next !== ch.img_backup) {
              ch.img_backup = next;
              touched = true;
            }
          }
        }
      }
    }
    if (touched) await vault.writeJson(collectionFile(id), titles);
  }

  return { ok: true, fixed };
}

// ── Один текст отзыва вместо «превью» и «полного» ──
// Раньше у отзыва было два текста: preview (пара предложений рядом с
// обложкой на карточке) и review_full (развёрнутый, по клику). Карточки
// текст давно не показывают, по клику открывается сразу весь отзыв, и
// preview остался полем, которое ни на что не влияет, но путает: часть
// отзывов хранила свой единственный текст именно в нём.
//
// Переносим: где был только preview – он становится текстом отзыва; где
// были оба – остаётся review_full; само поле preview из записи убирается
// в обоих случаях. Запускается тихо при каждом старте (см. js/config.js)
// и ничего не пишет, если переносить нечего. Прежняя версия файла, как
// при любой записи, уезжает в историю версий.
async function migratePreview({ vault }) {
  const list = await vault.readJson("reviews.json", []);
  let moved = 0;
  let dropped = 0;
  for (const r of list) {
    if (!r || typeof r !== "object" || !("preview" in r)) continue;
    const full = typeof r.review_full === "string" ? r.review_full.trim() : "";
    const preview = typeof r.preview === "string" ? r.preview.trim() : "";
    if (!full && preview) {
      r.review_full = preview;
      moved++;
    }
    delete r.preview;
    dropped++;
  }
  if (dropped) await vault.writeJson("reviews.json", list);
  return { ok: true, moved, dropped };
}

// ── Настройки ──────────────────────────────────

async function getSiteSettings({ vault }) {
  return vault.readJson("site-settings.json", {});
}

async function saveSiteSettings({ vault, body }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("Ожидается объект настроек");
  }
  await vault.writeJson("site-settings.json", body);
  return { ok: true };
}

// ── Резервная копия ─────────────────────────────
// Не путать с «Паспортом» (см. фронтенд, passports.js): паспорт –
// урезанный слепок для показа чужим (без текста отзывов, без
// избранного, без тир-листов), никогда не пишется обратно в своё же
// хранилище. Здесь – противоположная задача: перенести СВОИ данные
// на другое устройство или откатиться после ошибки, то есть нужно
// всё и без потерь.
//
// На компьютере для этого хватало «скопируй папку»: хранилище – обычные
// файлы на диске. На телефоне такой папки не видно (см. mobile/src/
// vault.js), и без этого своё же приложение не давало перенести
// собственные данные никаким способом – только сравнить их с чужими.
//
// Картинки, загруженные вручную (обложка не по ссылке, фото персонажа
// с компьютера), тоже входят – читаются как есть, base64, под тем же
// относительным путём, каким лежат в хранилище (vault.listAllMedia /
// readMedia). Обложки по ссылке (AniList, TMDB) отдельно копировать не
// нужно: ссылка и так лежит в reviews.json.
const BACKUP_FORMAT = "tasteid-backup";
const BACKUP_VERSION = 1;

// Все файлы данных хранилища – общее для резервной копии и для
// синхронизации (syncManifest ниже): список один, чтобы новый файл
// данных не оказался в копии, но мимо синхронизации, или наоборот.
async function collectDataFiles(vault) {
  const settings = await vault.readJson("site-settings.json", {});
  const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];

  const files = {
    "reviews.json": await vault.readJson("reviews.json", []),
    "favorites.json": await vault.readJson("favorites.json", []),
    "characters-tier.json": await vault.readJson("characters-tier.json", []),
    "site-settings.json": settings,
  };
  for (const { id } of collections) {
    if (!isSafeName(id)) continue; // испорченная запись в настройках – не наша забота здесь
    const name = collectionFile(id);
    files[name] = await vault.readJson(name, []);
  }
  return files;
}

async function exportBackup({ vault }) {
  const files = await collectDataFiles(vault);

  // По одной и с перехватом: копия без одной картинки несравнимо лучше,
  // чем отсутствие копии вообще. Раньше первый же нечитаемый файл
  // (права, полпути удалённый файл, кривое имя) обрывал весь экспорт с
  // невнятной ошибкой – а на телефоне резервная копия это единственный
  // способ вынести свои данные наружу.
  const images = {};
  let skippedImages = 0;
  for (const relPath of await vault.listAllMedia()) {
    try {
      images[relPath] = await vault.readMedia(relPath);
    } catch {
      skippedImages++;
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    files,
    images,
    ...(skippedImages ? { skippedImages } : {}),
  };
}

async function restoreBackup({ vault, body }) {
  if (body?.format !== BACKUP_FORMAT) {
    throw new ApiError("Это не файл резервной копии TasteID");
  }
  const files = body.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new ApiError("В файле нет данных для восстановления");
  }

  // isAllowedFile – тот же список, что защищает vault.writeJson: имя не
  // из него значит, что файл в копии либо чужой, либо порченый, и
  // писать его на диск нельзя, каким бы ни было содержимое.
  //
  // Форма значения – тоже: site-settings.json везде читается как объект
  // (vault.readJson(..., {})), остальное – как список (vault.readJson(...,
  // [])). Запись значения не той формы не сломает сам файл – он
  // прекрасно распарсится обратно, – но сломает код, который его читает,
  // уже после того, как страница перезагрузится и ничего не заподозрит.
  const names = Object.keys(files).filter((name) => {
    if (!isAllowedFile(name)) return false;
    const value = files[name];
    return name === "site-settings.json"
      ? value !== null && typeof value === "object" && !Array.isArray(value)
      : Array.isArray(value);
  });

  // Картинки – по одной, и порченый или подставной путь роняет только
  // саму картинку, а не всё восстановление: остальное всё равно стоит
  // дописать. writeMedia сам отвергнет путь, ведущий наружу хранилища.
  const images = body.images;
  const hasImages =
    images && typeof images === "object" && !Array.isArray(images) && Object.keys(images).length;

  // Синхронизация иногда приносит только новые картинки без единого
  // изменившегося JSON-файла (см. её же комментарий у pullNewRemoteImage
  // в app/js/sync.js) – это не "пустая" резервная копия, а нормальный
  // случай, который не должен ронять восстановление до того, как оно
  // дошло до картинок ниже.
  if (!names.length && !hasImages) {
    throw new ApiError("В файле нет ни одного известного файла хранилища");
  }

  for (const name of names) {
    await vault.writeJson(name, files[name]);
  }

  // failedImages – какие именно картинки не записались. Одного счётчика
  // мало: синхронизация (app/js/sync.js) должна знать, какие пути нельзя
  // помечать «уже забрано», иначе незаписанная картинка больше никогда
  // не скачается.
  let restoredImages = 0;
  const failedImages = [];
  if (hasImages) {
    for (const [relPath, base64] of Object.entries(images)) {
      if (typeof base64 !== "string" || !base64) {
        failedImages.push(relPath);
        continue;
      }
      try {
        await vault.writeMedia(relPath, base64);
        restoredImages++;
      } catch {
        // см. комментарий выше
        failedImages.push(relPath);
      }
    }
  }

  return { ok: true, restored: names, images: restoredImages, failedImages };
}

// ── Синхронизация: что лежит в хранилище, без содержимого картинок ──
// Раньше синхронизация каждый раз брала полную резервную копию
// (exportBackup выше): все картинки хранилища читались с диска и
// кодировались в один JSON – через несколько секунд после ЛЮБОГО
// сохранения, даже если поменялась одна строчка в отзыве. На хранилище
// в сотню мегабайт картинок это сотни мегабайт памяти на каждую правку,
// а где-то за 350 МБ ответ перестаёт помещаться в одну строку вовсе, и
// синхронизация падает целиком.
//
// Здесь – только список: файлы данных целиком (они маленькие) и у
// каждой картинки размер с временем изменения. По ним sync.js понимает,
// что файл с прошлого раза не трогали, и не читает его вообще; саму
// картинку забирает поштучно (readMediaFile ниже) и только когда она
// правда нужна. ?images=0 – без обхода картинок, когда нужны только
// свежие файлы данных.
async function syncManifest({ vault, query }) {
  const files = await collectDataFiles(vault);
  const images = {};
  if (query?.get("images") !== "0") {
    // listAllMediaStat есть у обоих хранилищ; запасной путь – на случай
    // реализации без него: без размера и времени sync.js просто прочтёт
    // каждый файл, как раньше.
    const list = vault.listAllMediaStat
      ? await vault.listAllMediaStat()
      : (await vault.listAllMedia()).map((p) => ({ path: p }));
    for (const { path: relPath, size, mtime } of list) {
      images[relPath] = { size: size ?? null, mtime: mtime ?? null };
    }
  }
  return { ok: true, files, images };
}

// Одна картинка в base64 – под тем же относительным путём, каким её
// отдаёт список выше. Только картинки и только из папок с картинками:
// путь из запроса, и без проверки этим же адресом читался бы любой файл
// хранилища.
const READABLE_MEDIA_PATH = /^[^/.][^/]*(\/[^/]+){1,2}\.(png|jpe?g|webp|gif)$/i;
async function readMediaFile({ vault, query }) {
  const relPath = String(query.get("path") || "");
  if (!READABLE_MEDIA_PATH.test(relPath)) throw new ApiError("Недопустимый путь картинки");
  try {
    return { ok: true, base64: await vault.readMedia(relPath) };
  } catch {
    throw new ApiError("Картинка не читается", 404);
  }
}

// ── История версий ─────────────────────────────
// На сайте её давал гит. Здесь – папка .history, куда прошлая версия
// файла уезжает перед каждой перезаписью (см. vault.js).
//
// Какие файлы отслеживаются – решает isAllowedFile из vault.js, а не
// свой список: он уже включает и свои коллекции тир-листа (tier-<id>.json),
// заведённые в настройках. Отдельный список здесь однажды бы разъехался
// с тем, что реально пишется через vault.writeJson (и уже архивируется
// в .history), – а история как раз про то, что там накопилось.

async function fileHistory({ vault, query }) {
  const path = query.get("path");
  if (!isAllowedFile(path)) throw new ApiError("Этот файл не отслеживается");
  const versions = await vault.history(path);
  // Форма ответа та же, что была у гита: фронтенд (backup-history.html)
  // её уже умеет читать – ok плюс versions с sha/date/message у каждой.
  const list = versions.map((v) => ({
    sha: v.id,
    date: v.date,
    message: "сохранение",
  }));
  // sha:"current" – не запись из .history (там лежат только прошлые
  // версии, см. #archive() в vault.js), а сам живой файл. Раньше
  // «текущей» в списке считалась просто самая новая архивная запись –
  // а это не то же самое: «Удалить всю историю» стирает .history
  // целиком, и без этой строки список после такой чистки выглядел так,
  // будто пропали и текущие данные тоже, хотя сам файл не тронут.
  //
  // try/catch обязателен: readJson намеренно бросает на испорченном
  // JSON, и без перехвата весь список версий переставал открываться
  // ровно тогда, когда он нужнее всего – сообщение о порче так и
  // говорит «загляни в историю», а история и не открывалась. Битый
  // текущий файл – не повод прятать прошлые версии, наоборот.
  let current = null;
  try {
    current = await vault.readJson(path, null);
  } catch {
    // Файл есть, но не читается – значит он точно есть, и строку
    // «текущая» показать надо (скачать её как JSON всё равно можно,
    // а восстанавливать поверх неё как раз и собираются).
    current = { __unreadable: true };
  }
  if (current !== null) list.unshift({ sha: "current", date: null, message: "текущая версия" });
  return { ok: true, versions: list };
}

async function fileAtCommit({ vault, query }) {
  const path = query.get("path");
  const sha = query.get("sha");
  if (!isAllowedFile(path)) throw new ApiError("Этот файл не отслеживается");
  return { ok: true, data: await vault.versionAt(path, sha) };
}

async function restoreFileVersion({ vault, body }) {
  const { path, sha } = body;
  if (!isAllowedFile(path)) throw new ApiError("Этот файл не отслеживается");
  const content = await vault.versionAt(path, sha);
  // Пишем как обычное сохранение: прошлая версия при этом сама уедет в
  // историю, то есть откат тоже можно откатить.
  await vault.writeJson(path, content);
  return { ok: true };
}

async function clearFileHistory({ vault, body }) {
  const path = body?.path;
  if (!isAllowedFile(path)) throw new ApiError("Этот файл не отслеживается");
  await vault.clearHistory(path);
  return { ok: true };
}

async function pruneHistory({ vault, body }) {
  const days = Number(body?.days) || 0;
  if (!days) throw new ApiError("Не указан срок");
  return { ok: true, ...(await vault.pruneHistoryByAge(days)) };
}

// ── Осиротевшие обложки ─────────────────────────
// Смена обложки удаляет старый файл (deleteMediaFile, js/utils.js), но
// удаление ЦЕЛОГО отзыва/раздела/персонажа – намеренно нет: ссылка
// должна остаться рабочей, если человек откатится через «Историю
// версий» (см. её же комментарий у deleteReview выше). Файл из-за этого
// остаётся лежать в хранилище навсегда, никем уже не используемый –
// причём не только в covers-backup/ (резервная копия по ссылке): та же
// судьба у covers/, favorites/ и title-covers/ (файл своей загрузки,
// см. её же basePath в add-cover.js/favorites-edit.js/chars-edit.js) и
// у chars/<тайтл>/ (портрет персонажа, ch.img_backup). Раньше отсюда
// проверялось только covers-backup/ – остальные три места молча
// накапливали свой мусор без единого способа его найти.
// findOrphanedCovers только находит такие файлы – ничего не удаляет
// сам; удаление явным списком идёт тем же путём, что и смена обложки
// (deleteMediaFile на фронтенде), чтобы заодно подчистить и копию в
// репозитории синхронизации (см. её же комментарий у deleteRemoteMedia
// в js/sync.js), а не заводить для этого отдельный, второй способ
// удаления файла.
async function findOrphanedCovers({ vault }) {
  const refs = new Set();
  const add = (value) => {
    if (!value) return;
    // decodeURIComponent – персонажи хранят img уже готовым к вставке в
    // <img src>, то есть с закодированными пробелами и т.п. (см. её же
    // построение в chars-edit.js: encodeURIComponent на каждый сегмент
    // пути), а vault.listAllMedia() ниже отдаёт настоящие, "сырые" имена
    // файлов с диска – без decode они никогда не совпадали бы даже для
    // персонажа, который прямо сейчас виден в тир-листе, стоит только
    // имени тайтла или файла содержать пробел или другой не-ASCII знак.
    let clean = String(value);
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // "%" не часть корректной escape-последовательности (редкий, но
      // возможный символ в имени файла) – используем как есть, лучше
      // отдать значение без decode, чем уронить весь поиск на нём.
    }
    refs.add(clean.replace(/^\/+/, ""));
  };

  const reviews = await vault.readJson("reviews.json", []);
  for (const r of reviews) {
    add(r.cover_backup);
    // cover_gallery – все резервные копии, когда-либо сделанные для
    // отзыва, не только активная сейчас (см. её же комментарий в
    // add-save.js): без этой строки поиск считал бы «осиротевшей»,
    // то есть годной к удалению, любую картинку из галереи, кроме
    // ровно одной текущей – хотя все они по-прежнему выбираемы через
    // саму галерею.
    for (const url of r.cover_gallery || []) add(url);
  }

  const favorites = await vault.readJson("favorites.json", []);
  for (const f of favorites) {
    add(f.image_backup);
    for (const url of f.image_gallery || []) add(url);
  }

  const settings = await vault.readJson("site-settings.json", {});
  const collections = Array.isArray(settings.tierCollections) ? settings.tierCollections : [];
  const collectionIds = new Set(["characters", ...collections.map((c) => c.id).filter(isSafeName)]);
  for (const id of collectionIds) {
    const titles = await vault.readJson(collectionFile(id), []);
    for (const title of titles) {
      add(title.cover_backup);
      for (const list of title.tierlists || []) {
        for (const tier of list.tiers || []) {
          for (const ch of tier.chars || []) {
            // img, а не только img_backup: у персонажа, выбранного прямо
            // из уже загруженной галереи (см. её же imgBackup = "" в
            // openModalAddChar, chars-edit.js), путь на диск лежит
            // именно в img – img_backup остаётся пустым, это поле
            // только для случая "вставили внешнюю ссылку, сделали
            // резервную копию". Без add(ch.img) такие персонажи всегда
            // считались бы осиротевшими, хотя видны в тир-листе.
            add(ch.img);
            add(ch.img_backup);
          }
        }
      }
    }
  }

  // vault.listAllMedia() сама уже ограничена папками, куда TasteID
  // вообще когда-либо кладёт картинки (см. её же историю в
  // electron/vault.js/mobile/src/vault.js) – значит, всё, что не попало
  // в refs выше, годится в осиротевшие независимо от того, в какой
  // именно из этих папок оно лежит.
  const all = await vault.listAllMedia();
  const orphans = all.filter((p) => !refs.has(p));
  return { ok: true, orphans };
}

// ── Таблица адресов ────────────────────────────

export const ROUTES = {
  "GET /api/site-settings": getSiteSettings,
  "GET /api/list-chars": listChars,
  "GET /api/file-history": fileHistory,
  "GET /api/file-at-commit": fileAtCommit,
  "POST /api/save-review": saveReview,
  "POST /api/delete-review": deleteReview,
  "POST /api/import-reviews": importReviews,
  "POST /api/set-cover-backups": setCoverBackups,
  "POST /api/save-favorite": saveFavorite,
  "POST /api/save-chars-tier": saveCharsTier,
  "POST /api/delete-tier-collection": deleteTierCollection,
  "POST /api/save-site-settings": saveSiteSettings,
  "GET /api/export-backup": exportBackup,
  "POST /api/restore-backup": restoreBackup,
  "GET /api/sync-manifest": syncManifest,
  "GET /api/read-media": readMediaFile,
  "POST /api/upload-char-image": uploadCharImage,
  "POST /api/ensure-chars-folder": ensureCharsFolder,
  "POST /api/compress-folder": compressFolder,
  "POST /api/backup-cover": backupCover,
  "POST /api/fetch-mal-list": fetchMalUserList,
  "POST /api/steam-search": steamSearch,
  "POST /api/steam-library": steamLibrary,
  "POST /api/delete-media": deleteMedia,
  "POST /api/repair-cover-references": repairCoverReferences,
  "POST /api/migrate-preview": migratePreview,
  "POST /api/restore-file-version": restoreFileVersion,
  "POST /api/clear-file-history": clearFileHistory,
  "POST /api/prune-history": pruneHistory,
  "GET /api/find-orphaned-covers": findOrphanedCovers,
};

export { ApiError };
