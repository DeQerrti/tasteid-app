// ══════════════════════════════════════════════
//  ХРАНИЛИЩЕ НА ТЕЛЕФОНЕ
//
//  Тот же интерфейс, что у настольного electron/vault.js — шесть
//  методов, которых ждёт core/api.js: readJson, writeJson, saveMedia,
//  listImages, history, versionAt. Благодаря этому вся логика паспорта
//  (отзывы, любимое, тир-листы, импорт, настройки, история) работает
//  на телефоне тем же кодом, без второй реализации и без риска, что
//  два приложения разойдутся в поведении.
//
//  Под ним не node:fs, а файловая система телефона через Capacitor.
//  Папка — Documents/TasteID внутри данных приложения: те же файлы с
//  теми же именами, что на компьютере, так что паспорт переносится
//  копированием, а не конвертацией.
//
//  Чего здесь нет по сравнению с настольным:
//
//    Записи через временный файл с переименованием. На Android
//    переименование доступно, но Capacitor не обещает атомарности
//    поверх SAF, а половинчатая гарантия хуже честного отсутствия.
//    Зато .history пишется ДО перезаписи (как и на компьютере), так
//    что прошлая версия уже лежит рядом, даже если запись оборвётся.
// ══════════════════════════════════════════════

import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { isAllowedFile } from "../../core/files.js";

const DIR = Directory.Data;
const HISTORY_LIMIT = 50;

// Папка внутри данных приложения. Не корень: рядом лежит служебное
// хозяйство самого Capacitor, и мешать с ним паспорт незачем.
const ROOT = "TasteID";

const path = (...parts) => [ROOT, ...parts.filter(Boolean)].join("/");

// «Файла нет» приезжает от разных платформ по-разному, а отличать его
// от настоящей ошибки нужно везде: отсутствующий файл — это первый
// запуск, а не поломка.
function isMissing(e) {
  const m = String(e?.message || e).toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("not exist") ||
    m.includes("file not found") ||
    m.includes("no such file") ||
    m.includes("enoent")
  );
}

async function mkdirp(dir) {
  try {
    await Filesystem.mkdir({ path: dir, directory: DIR, recursive: true });
  } catch (e) {
    // Уже существует — это не ошибка, а нормальное состояние.
    if (
      !String(e?.message || "")
        .toLowerCase()
        .includes("exist")
    )
      throw e;
  }
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export class MobileVault {
  constructor() {
    this.root = ROOT;
  }

  #file(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    return path(name);
  }

  async ensure() {
    for (const dir of ["", "covers", "covers-backup", "chars", ".history"]) {
      await mkdirp(dir ? path(dir) : ROOT);
    }
  }

  async readJson(name, fallback) {
    let raw;
    try {
      const res = await Filesystem.readFile({
        path: this.#file(name),
        directory: DIR,
        encoding: Encoding.UTF8,
      });
      raw = res.data;
    } catch (e) {
      if (isMissing(e)) return fallback;
      throw e;
    }
    try {
      return JSON.parse(raw);
    } catch {
      // Битый JSON — молчать нельзя: подсунуть взамен пустой список
      // значит предложить записать его поверх.
      throw new Error(
        `Файл ${name} испорчен и не читается. Загляни в .history — там лежат прошлые версии.`
      );
    }
  }

  async writeJson(name, data) {
    await this.ensure();
    const target = this.#file(name);
    await this.#archive(name, target);

    await Filesystem.writeFile({
      path: target,
      directory: DIR,
      data: JSON.stringify(data, null, 2) + "\n",
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return data;
  }

  // Прошлая версия — в .history/<файл>/<время>.json, старые подчищаются.
  async #archive(name, target) {
    let previous;
    try {
      const res = await Filesystem.readFile({
        path: target,
        directory: DIR,
        encoding: Encoding.UTF8,
      });
      previous = res.data;
    } catch {
      return; // первого сохранения архивировать нечего
    }

    const dir = path(".history", name);
    await mkdirp(dir);

    // Имя версии — время. Два сохранения подряд укладываются в одну
    // миллисекунду, поэтому при совпадении добавляем номер: без этого
    // вторая версия молча затирала первую.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const taken = new Set(await this.#list(dir));
    let slot = `${stamp}.json`;
    for (let n = 1; taken.has(slot) && n < 1000; n++) slot = `${stamp}-${n}.json`;

    await Filesystem.writeFile({
      path: `${dir}/${slot}`,
      directory: DIR,
      data: previous,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    const kept = [...taken, slot].sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY_LIMIT))) {
      await Filesystem.deleteFile({ path: `${dir}/${old}`, directory: DIR }).catch(() => {});
    }
  }

  async #list(dir) {
    try {
      const res = await Filesystem.readdir({ path: dir, directory: DIR });
      return res.files.map((f) => (typeof f === "string" ? f : f.name));
    } catch {
      return [];
    }
  }

  async history(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    const entries = await this.#list(path(".history", name));
    return entries
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .map((f) => ({
        id: f.replace(/\.json$/, ""),
        // Обратно из имени файла: двоеточия и точку вернули на место.
        date: f.replace(/\.json$/, "").replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z"),
      }));
  }

  async versionAt(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    const res = await Filesystem.readFile({
      path: `${path(".history", name)}/${id}.json`,
      directory: DIR,
      encoding: Encoding.UTF8,
    });
    return JSON.parse(res.data);
  }

  // ── Картинки ─────────────────────────────────
  // Имена проверяются по тем же правилам, что на компьютере: они
  // приходят из запроса, и без проверки в них можно было бы подставить
  // путь наружу хранилища.
  #safeSegment(name) {
    if (
      typeof name !== "string" ||
      !name ||
      name.length > 100 ||
      /[/\\]/.test(name) ||
      name.includes("..")
    ) {
      throw new Error(`Недопустимое имя папки: ${name}`);
    }
    return name;
  }

  mediaDir(base, sub) {
    const parts = [this.#safeSegment(base)];
    if (sub) parts.push(this.#safeSegment(sub));
    return path(...parts);
  }

  async saveMedia(base, filename, bytes, sub) {
    // [^\w.-] запрещал ВСЁ не-ASCII разом — кириллическое имя файла
    // превращалось в одни подчёркивания, и два разных файла в одной
    // папке могли затереть друг друга одним и тем же "______.webp".
    // Правильный список — не что разрешено, а что правда небезопасно
    // в имени файла: разделители пути и управляющие символы. Тот же
    // фикс — в electron/vault.js.
    const safeName = filename.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(-80);
    const dir = this.mediaDir(base, sub);
    await mkdirp(dir);
    await Filesystem.writeFile({
      path: `${dir}/${safeName}`,
      directory: DIR,
      data: bytesToBase64(bytes),
      recursive: true,
    });
    return sub ? `/${base}/${sub}/${safeName}` : `/${base}/${safeName}`;
  }

  // Без папки — список папок, с папкой — список картинок в ней. Ровно
  // так же отвечает настольная версия, и галерея в редакторе
  // персонажей рассчитывает именно на это.
  async listImages(base, sub) {
    let entries;
    try {
      const res = await Filesystem.readdir({ path: this.mediaDir(base, sub), directory: DIR });
      entries = res.files;
    } catch (e) {
      if (isMissing(e)) return sub ? { files: [] } : { folders: [] };
      throw e;
    }

    const named = entries.map((f) =>
      typeof f === "string" ? { name: f, type: "file" } : { name: f.name, type: f.type }
    );

    if (!sub) {
      return {
        folders: named
          .filter((e) => e.type === "directory")
          .map((e) => e.name)
          .sort(),
      };
    }

    const files = named
      .filter((e) => e.type !== "directory" && /\.(png|jpe?g|webp|gif)$/i.test(e.name))
      .map((e) => {
        const url = `/${base}/${sub}/${e.name}`
          .split("/")
          .map(encodeURIComponent)
          .join("/")
          .replace(/^%2F/, "/");
        return { name: e.name.replace(/\.[^.]+$/, ""), url, preview: url };
      });
    return { files };
  }

  // Содержимое одной картинки — для резервной копии (core/api.js:
  // exportBackup). Capacitor сам отдаёт файл в base64 — тем же видом,
  // которым его ждёт обратно writeMedia ниже.
  async readMedia(urlPath) {
    const parts = decodeURIComponent(urlPath)
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean)
      .map((p) => this.#safeSegment(p));
    if (!parts.length) throw new Error("Пустой путь");

    const res = await Filesystem.readFile({ path: path(...parts), directory: DIR });
    return res.data; // base64
  }

  // Обратная сторона readMedia — восстановление картинки из резервной
  // копии на тот же относительный путь, с которого она была снята.
  async writeMedia(relPath, base64) {
    const parts = decodeURIComponent(relPath)
      .replace(/^\/+/, "")
      .split("/")
      .filter(Boolean)
      .map((p) => this.#safeSegment(p));
    if (!parts.length) throw new Error("Пустой путь");
    const dir = parts.slice(0, -1).join("/");
    if (dir) await mkdirp(path(dir));
    await Filesystem.writeFile({
      path: path(...parts),
      directory: DIR,
      data: base64,
      recursive: true,
    });
  }

  // Все картинки хранилища одним списком, для резервной копии. Не
  // listImages — та отвечает под конкретную нужду интерфейса (список
  // папок ИЛИ список файлов в одной папке, порознь), а здесь нужно
  // найти вообще всё, не зная заранее, какие папки есть.
  async listAllMedia() {
    const IMG = /\.(png|jpe?g|webp|gif)$/i;
    const out = [];

    const walk = async (dir, rel) => {
      let entries;
      try {
        entries = (await Filesystem.readdir({ path: dir, directory: DIR })).files;
      } catch {
        return; // папки нет — и не надо, картинок в ней тоже нет
      }
      for (const raw of entries) {
        const entry = typeof raw === "string" ? { name: raw, type: "file" } : raw;
        if (entry.name === ".history") continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.type === "directory") await walk(`${dir}/${entry.name}`, childRel);
        else if (IMG.test(entry.name)) out.push(childRel);
      }
    };

    await walk(ROOT, "");
    return out.sort();
  }
}
