// ══════════════════════════════════════════════
//  ХРАНИЛИЩЕ – папка с файлами на диске
//
//  Устроено как у Обсидиана: не база, а обычная папка, в которую можно
//  зайти проводником. Внутри те же файлы, что раньше лежали в
//  репозитории сайта, – так что перенос данных это копирование, а не
//  конвертация.
//
//    reviews.json           отзывы
//    favorites.json         любимое (персонажи, персоны, свои разделы)
//    characters-tier.json   тир-лист персонажей
//    tier-<id>.json         остальные коллекции тир-листа
//    site-settings.json     всё, что настраивается на экране настроек
//    covers/                обложки, загруженные с компьютера
//    covers-backup/         резервные копии внешних обложек
//    chars/                 картинки персонажей
//    .history/              прошлые версии файлов (см. ниже)
//
//  ЗАПИСЬ ИДЁТ ЧЕРЕЗ ВРЕМЕННЫЙ ФАЙЛ. Прямая запись поверх существующего
//  означает окно, в котором файл уже обрезан, а новое содержимое ещё не
//  дописано; выключение света в этот момент оставляет пустой reviews.json
//  и никакого способа это заметить. Пишем рядом и переименовываем –
//  переименование в пределах одной файловой системы атомарно, то есть
//  файл либо старый целиком, либо новый целиком.
//
//  ИСТОРИЯ. На сайте её давал гит: каждое сохранение было коммитом, и
//  «Историю версий» можно было отмотать. Здесь гита нет, поэтому перед
//  каждой перезаписью прошлая версия уезжает в .history. Это дешёвая
//  страховка и единственный способ откатить неудачный импорт – тот самый,
//  на который ссылается предупреждение при удалении отзыва.
// ══════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";
import { isAllowedFile, historyDate } from "../core/files.js";

// Сколько версий держим на файл. Пятьдесят сохранений – это заведомо
// больше, чем успеваешь наделать за один заход, а места они занимают
// столько же, сколько сам файл, то есть считанные мегабайты.
const HISTORY_LIMIT = 50;

// Счётчик для имён временных файлов – см. writeJson.
let writeCounter = 0;

// Какие имена файлов вообще допустимы – в core/files.js: те же правила
// нужны мобильной реализации хранилища, и разъезжаться им нельзя.
export class Vault {
  // trash: необязательный колбэк (реальный путь) => Promise – переносит
  // файл/папку в системную корзину вместо необратимого стирания. Внедряется
  // снаружи (electron/main.js передаёт shell.trashItem), а не завязано на
  // Electron напрямую – этот класс гоняется и в обычном Node, в тестах
  // (tests/api.test.js), где модуля electron просто нет. Без колбэка
  // (тесты, либо трэш недоступен) используется прямое удаление – только
  // для мест, где это явно допустимо (см. deleteMedia/clearHistory).
  constructor(root, { trash } = {}) {
    this.root = root;
    this.trash = trash || null;
  }

  async #remove(target, { recursive } = {}) {
    // Отсутствующая цель – не ошибка (как и раньше с force:true) для
    // обоих путей: shell.trashItem, в отличие от fs.rm, на несуществующем
    // файле падает, а не молчит.
    try {
      await fs.access(target);
    } catch {
      return;
    }
    if (this.trash) {
      await this.trash(target);
      return;
    }
    await fs.rm(target, { recursive: !!recursive, force: true });
  }

  file(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    return path.join(this.root, name);
  }

  async ensure() {
    for (const dir of ["", "covers", "covers-backup", "chars", ".history"]) {
      await fs.mkdir(path.join(this.root, dir), { recursive: true });
    }
  }

  // Чтение с умолчанием: отсутствующий файл – это не поломка, а первый
  // запуск. Пустой список отзывов и пустые настройки выглядят одинаково
  // и для приложения, и для человека.
  async readJson(name, fallback) {
    try {
      const raw = await fs.readFile(this.file(name), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      // Битый JSON – отдельный случай, и молчать о нём нельзя: подсунуть
      // взамен пустой список значит предложить записать его поверх.
      if (e instanceof SyntaxError) {
        throw new Error(
          `Файл ${name} испорчен и не читается. Загляни в .history – там лежат прошлые версии.`
        );
      }
      throw e;
    }
  }

  async writeJson(name, data) {
    await this.ensure();
    const target = this.file(name);
    await this.#archive(name, target);

    const body = JSON.stringify(data, null, 2) + "\n";
    // Имя временного файла уникально на каждую запись. Раньше оно
    // складывалось из имени файла и номера процесса, то есть у двух
    // одновременных сохранений совпадало: обе писали в один и тот же
    // временный файл, первая его переименовывала, вторая падала на
    // «нет такого файла».
    const tmp = `${target}.${process.pid}.${Date.now().toString(36)}${(writeCounter++).toString(36)}.tmp`;
    try {
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return data;
  }

  // Прошлая версия – в .history/<файл>/<время>.json, старые подчищаются.
  async #archive(name, target) {
    let previous;
    try {
      previous = await fs.readFile(target);
    } catch {
      return; // первого сохранения архивировать нечего
    }
    const dir = path.join(this.root, ".history", name);
    await fs.mkdir(dir, { recursive: true });

    // Имя версии – это время, а два сохранения подряд укладываются в одну
    // миллисекунду: перестановка порядка сразу после правки, например.
    // Без счётчика вторая версия молча затирала первую, и история врала
    // ровно там, где нужнее всего.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let slot = path.join(dir, `${stamp}.json`);
    for (let n = 1; n < 1000; n++) {
      try {
        // wx: создать, но только если такого файла ещё нет.
        await fs.writeFile(slot, previous, { flag: "wx" });
        break;
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
        slot = path.join(dir, `${stamp}-${n}.json`);
      }
    }

    const kept = (await fs.readdir(dir)).sort();
    for (const old of kept.slice(0, Math.max(0, kept.length - HISTORY_LIMIT))) {
      await fs.rm(path.join(dir, old), { force: true });
    }
  }

  async history(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    const dir = path.join(this.root, ".history", name);
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .map((f) => ({
        id: f.replace(/\.json$/, ""),
        date: historyDate(f),
      }));
  }

  async versionAt(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    const raw = await fs.readFile(path.join(this.root, ".history", name, `${id}.json`), "utf8");
    return JSON.parse(raw);
  }

  // Стирает всю историю одного файла – текущая версия (сам файл вне
  // .history) не трогается, отменить откатом уже нечем.
  async clearHistory(name) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    await this.#remove(path.join(this.root, ".history", name), { recursive: true });
  }

  // Возраст поверх HISTORY_LIMIT – тот срезает по количеству, а при
  // редких, но долгих сохранениях пятидесяти версий хватает на годы.
  // Имя файла версии – и есть её дата (см. history()), читать stat()
  // незачем и на телефоне так же надёжно не вышло бы.
  async pruneHistoryByAge(maxAgeDays) {
    if (!maxAgeDays) return { removed: 0 };
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const root = path.join(this.root, ".history");
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return { removed: 0 };
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const versions = await this.history(entry.name).catch(() => []);
      for (const v of versions) {
        const t = Date.parse(v.date);
        if (Number.isNaN(t) || t >= cutoff) continue;
        await fs.rm(path.join(root, entry.name, `${v.id}.json`), { force: true }).catch(() => {});
        removed++;
      }
    }
    return { removed };
  }

  // ── Картинки ─────────────────────────────────
  // Наружу отдаём путь того же вида, что был на сайте (/covers/…,
  // /chars/<папка>/…): разметка и данные не должны заметить, что файл
  // теперь лежит на диске, а не в репозитории.
  //
  // base – covers, chars или id коллекции тир-листа; sub – необязательная
  // папка внутри (у персонажей это тайтл). Оба имени проверяются: они
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
    const parts = [this.root, this.#safeSegment(base)];
    if (sub) parts.push(this.#safeSegment(sub));
    return path.join(...parts);
  }

  // Создаёт папку под картинки темы заранее, ещё до первой загруженной
  // картинки – иначе она возникает только внутри saveMedia() и до тех
  // пор не видна ни в проводнике, ни в диалоге "Папка (источник)"
  // (тот читает список папок с диска, listImages() ниже).
  async ensureMediaFolder(base, sub) {
    await fs.mkdir(this.mediaDir(base, sub), { recursive: true });
    return true;
  }

  async saveMedia(base, filename, buffer, sub) {
    // [^\w.-] запрещал ВСЁ не-ASCII разом – кириллическое имя файла
    // (обложка/фото с кириллическим названием тайтла или персонажа)
    // превращалось в одни подчёркивания, и два разных файла в одной
    // папке могли затереть друг друга одним и тем же "______.webp".
    // Правильный список – не что разрешено, а что правда небезопасно
    // в имени файла: разделители пути и управляющие символы.
    const safeName = filename.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(-80);
    const dir = this.mediaDir(base, sub);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, safeName), buffer);
    return sub ? `/${base}/${sub}/${safeName}` : `/${base}/${safeName}`;
  }

  // Без папки – список папок, с папкой – список картинок в ней. Ровно
  // так же отвечал эндпоинт на сайте, и галерея в редакторе персонажей
  // рассчитывает именно на это.
  async listImages(base, sub) {
    let entries;
    try {
      entries = await fs.readdir(this.mediaDir(base, sub), { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return sub ? { files: [] } : { folders: [] };
      throw e;
    }

    if (!sub) {
      return {
        folders: entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort(),
      };
    }

    const files = entries
      .filter((e) => e.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(e.name))
      .map((e) => {
        const url = `/${base}/${sub}/${e.name}`
          .split("/")
          .map(encodeURIComponent)
          .join("/")
          .replace(/^%2F/, "/");
        return {
          name: e.name.replace(/\.[^.]+$/, ""),
          url,
          // На сайте preview был прямой ссылкой на GitHub: свежий файл
          // появлялся на домене только после выкладки. Здесь выкладки
          // нет, файл доступен сразу – и обе ссылки совпадают.
          preview: url,
        };
      });
    return { files };
  }

  // Все картинки хранилища одним списком, для резервной копии. Не
  // listImages – та отвечает под конкретную нужду интерфейса (список
  // папок ИЛИ список файлов в одной папке, порознь), а здесь нужно
  // найти вообще всё: covers/, chars/<тайтл>/, свои коллекции
  // тир-листа, – не зная заранее, какие из этих папок вообще есть.
  async listAllMedia() {
    const IMG = /\.(png|jpe?g|webp|gif)$/i;
    const out = [];

    const walk = async (dir, rel) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if (e.code === "ENOENT") return;
        throw e;
      }
      for (const entry of entries) {
        if (entry.name === ".history") continue; // прошлые версии – не картинки
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), childRel);
        else if (IMG.test(entry.name)) out.push(childRel);
      }
    };

    await walk(this.root, "");
    return out.sort();
  }

  // base64, а не Buffer – тот же вид, в котором отдаёт файл MobileVault
  // (Capacitor сам возвращает base64), так что exportBackup в
  // core/api.js не должен знать, на какой платформе он работает.
  async readMedia(relPath) {
    const parts = String(relPath)
      .split("/")
      .filter(Boolean)
      .map((p) => this.#safeSegment(p));
    if (!parts.length) throw new Error("Пустой путь");
    const buffer = await fs.readFile(path.join(this.root, ...parts));
    return buffer.toString("base64");
  }

  // Обратная сторона readMedia – восстановление картинки из резервной
  // копии на тот же относительный путь, с которого она была снята.
  async writeMedia(relPath, base64) {
    const parts = String(relPath)
      .split("/")
      .filter(Boolean)
      .map((p) => this.#safeSegment(p));
    if (!parts.length) throw new Error("Пустой путь");
    const target = path.join(this.root, ...parts);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, Buffer.from(base64, "base64"));
  }

  // Удаление одного файла – резервных копий обложек, которые заменила
  // новая (см. core/api.js: deleteMedia, js/routes/add.js). Уже
  // отсутствующий файл – не ошибка: цель («этого файла на диске нет»)
  // и так достигнута.
  async deleteMedia(relPath) {
    const parts = String(relPath)
      .split("/")
      .filter(Boolean)
      .map((p) => this.#safeSegment(p));
    if (!parts.length) throw new Error("Пустой путь");
    await this.#remove(path.join(this.root, ...parts));
  }
}
