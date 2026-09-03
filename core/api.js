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

import { isAllowedFile } from "./files.js";

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
    !name.includes("..")
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
      existing.status = item.status;
      existing.grade = item.grade;
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
      preview: null,
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
  }

  if (added || updated) await vault.writeJson("reviews.json", sortReviews(list));
  return { ok: true, added, updated };
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
async function uploadCharImage({ vault, body }) {
  const { folder, filename, contentBase64, basePath } = body;
  const base = isSafeName(basePath) ? basePath : "chars";
  if (folder && !isSafeName(folder)) throw new ApiError("Недопустимое название папки");
  if (!isSafeFileName(filename)) throw new ApiError("Недопустимое название файла");
  if (!filename.toLowerCase().endsWith(".webp")) {
    throw new ApiError("Ожидается файл .webp (конвертация происходит в браузере перед отправкой)");
  }
  if (!contentBase64 || typeof contentBase64 !== "string")
    throw new ApiError("Нет содержимого файла");

  const url = await vault.saveMedia(base, filename, base64ToBuffer(contentBase64), folder);
  return { ok: true, url };
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
  const { url, filename } = body;
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
  let ext = /png/.test(type)
    ? "png"
    : /webp/.test(type)
      ? "webp"
      : /gif/.test(type)
        ? "gif"
        : "jpg";
  let buffer = new Uint8Array(await res.arrayBuffer());

  // compressImage приходит снаружи (electron/image.js на компьютере –
  // sharp, mobile/src/main.js на телефоне – canvas браузера): само
  // API общее для обеих платформ, а нативный модуль sharp в мобильный
  // бандл затянуть нельзя. gif пропускаем – анимация не переживёт
  // перекодирование в статичный webp, лучше оставить оригинал как есть.
  // Само сжатие – необязательный шаг: не удалось – сохраняем
  // оригинал, как было раньше, а не роняем сохранение обложки из-за
  // этого.
  if (compressImage && ext !== "gif") {
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

// Удаление файла обложки – резервной копии, которую заменила новая
// (см. js/routes/add.js: пасту новой ссылки на обложку раньше не
// сопровождалось удалением старого файла, и на диске годами копились
// заброшенные копии никому уже не нужных обложек). Область
// намеренно ограничена covers/covers-backup – это чистка своих же
// файлов конкретной фичи, а не удаление чего угодно из хранилища.
const DELETABLE_MEDIA_PATH = /^\/(covers|covers-backup)\/[^/]+$/;

async function deleteMedia({ vault, body }) {
  const relPath = String(body.path || "");
  if (!DELETABLE_MEDIA_PATH.test(relPath)) throw new ApiError("Недопустимый путь для удаления");
  await vault.deleteMedia(relPath.slice(1));
  return { ok: true };
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

async function exportBackup({ vault }) {
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
  if (!names.length) throw new ApiError("В файле нет ни одного известного файла хранилища");

  for (const name of names) {
    await vault.writeJson(name, files[name]);
  }

  // Картинки – по одной, и порченый или подставной путь роняет только
  // саму картинку, а не всё восстановление: остальное всё равно стоит
  // дописать. writeMedia сам отвергнет путь, ведущий наружу хранилища.
  let restoredImages = 0;
  const images = body.images;
  if (images && typeof images === "object" && !Array.isArray(images)) {
    for (const [relPath, base64] of Object.entries(images)) {
      if (typeof base64 !== "string" || !base64) continue;
      try {
        await vault.writeMedia(relPath, base64);
        restoredImages++;
      } catch {
        // см. комментарий выше
      }
    }
  }

  return { ok: true, restored: names, images: restoredImages };
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

// ── Таблица адресов ────────────────────────────

export const ROUTES = {
  "GET /api/site-settings": getSiteSettings,
  "GET /api/list-chars": listChars,
  "GET /api/file-history": fileHistory,
  "GET /api/file-at-commit": fileAtCommit,
  "POST /api/save-review": saveReview,
  "POST /api/delete-review": deleteReview,
  "POST /api/import-reviews": importReviews,
  "POST /api/save-favorite": saveFavorite,
  "POST /api/save-chars-tier": saveCharsTier,
  "POST /api/save-site-settings": saveSiteSettings,
  "GET /api/export-backup": exportBackup,
  "POST /api/restore-backup": restoreBackup,
  "POST /api/upload-char-image": uploadCharImage,
  "POST /api/backup-cover": backupCover,
  "POST /api/delete-media": deleteMedia,
  "POST /api/repair-cover-references": repairCoverReferences,
  "POST /api/restore-file-version": restoreFileVersion,
  "POST /api/clear-file-history": clearFileHistory,
  "POST /api/prune-history": pruneHistory,
};

export { ApiError };
