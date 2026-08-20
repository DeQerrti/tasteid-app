// ══════════════════════════════════════════════
//  ХРАНИЛИЩЕ — папка с файлами на диске
//
//  Устроено как у Обсидиана: не база, а обычная папка, в которую можно
//  зайти проводником. Внутри те же файлы, что раньше лежали в
//  репозитории сайта, — так что перенос данных это копирование, а не
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
//  и никакого способа это заметить. Пишем рядом и переименовываем —
//  переименование в пределах одной файловой системы атомарно, то есть
//  файл либо старый целиком, либо новый целиком.
//
//  ИСТОРИЯ. На сайте её давал гит: каждое сохранение было коммитом, и
//  «Историю версий» можно было отмотать. Здесь гита нет, поэтому перед
//  каждой перезаписью прошлая версия уезжает в .history. Это дешёвая
//  страховка и единственный способ откатить неудачный импорт — тот самый,
//  на который ссылается предупреждение при удалении отзыва.
// ══════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";
import { isAllowedFile } from "../core/files.js";

// Сколько версий держим на файл. Пятьдесят сохранений — это заведомо
// больше, чем успеваешь наделать за один заход, а места они занимают
// столько же, сколько сам файл, то есть считанные мегабайты.
const HISTORY_LIMIT = 50;

// Счётчик для имён временных файлов — см. writeJson.
let writeCounter = 0;

// Какие имена файлов вообще допустимы — в core/files.js: те же правила
// нужны мобильной реализации хранилища, и разъезжаться им нельзя.
export class Vault {
  constructor(root) {
    this.root = root;
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

  // Чтение с умолчанием: отсутствующий файл — это не поломка, а первый
  // запуск. Пустой список отзывов и пустые настройки выглядят одинаково
  // и для приложения, и для человека.
  async readJson(name, fallback) {
    try {
      const raw = await fs.readFile(this.file(name), "utf8");
      return JSON.parse(raw);
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      // Битый JSON — отдельный случай, и молчать о нём нельзя: подсунуть
      // взамен пустой список значит предложить записать его поверх.
      if (e instanceof SyntaxError) {
        throw new Error(
          `Файл ${name} испорчен и не читается. Загляни в .history — там лежат прошлые версии.`
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

  // Прошлая версия — в .history/<файл>/<время>.json, старые подчищаются.
  async #archive(name, target) {
    let previous;
    try {
      previous = await fs.readFile(target);
    } catch {
      return; // первого сохранения архивировать нечего
    }
    const dir = path.join(this.root, ".history", name);
    await fs.mkdir(dir, { recursive: true });

    // Имя версии — это время, а два сохранения подряд укладываются в одну
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
        // Обратно из имени файла: двоеточия и точку вернули на место.
        date: f.replace(/\.json$/, "").replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ":$1:$2.$3Z"),
      }));
  }

  async versionAt(name, id) {
    if (!isAllowedFile(name)) throw new Error(`Неизвестный файл: ${name}`);
    if (!/^[\w-]{1,48}$/.test(id)) throw new Error("Неизвестная версия");
    const raw = await fs.readFile(path.join(this.root, ".history", name, `${id}.json`), "utf8");
    return JSON.parse(raw);
  }

  // ── Картинки ─────────────────────────────────
  // Наружу отдаём путь того же вида, что был на сайте (/covers/…,
  // /chars/<папка>/…): разметка и данные не должны заметить, что файл
  // теперь лежит на диске, а не в репозитории.
  //
  // base — covers, chars или id коллекции тир-листа; sub — необязательная
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

  async saveMedia(base, filename, buffer, sub) {
    const safeName = filename.replace(/[^\w.-]/g, "_").slice(-80);
    const dir = this.mediaDir(base, sub);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, safeName), buffer);
    return sub ? `/${base}/${sub}/${safeName}` : `/${base}/${safeName}`;
  }

  // Без папки — список папок, с папкой — список картинок в ней. Ровно
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
          // нет, файл доступен сразу — и обе ссылки совпадают.
          preview: url,
        };
      });
    return { files };
  }
}
