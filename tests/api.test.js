// Тесты api и хранилища — на обычном Node, без Electron и без графики.
// Каждый тест работает в своей временной папке, так что порядок запуска
// ничего не решает и мусор после себя они не оставляют.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Vault } from "../electron/vault.js";
import { createServer, listen } from "../electron/server.js";

const APP_DIR = path.join(import.meta.dirname, "..", "app");

async function withServer(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasteid-test-"));
  const vault = new Vault(root);
  await vault.ensure();
  const server = createServer({ appDir: APP_DIR, getVault: () => vault });
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const api = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };

  try {
    await run({ api, base, vault, root });
  } finally {
    // Не просто server.close() — сервер теперь слушает один и тот же
    // предпочитаемый порт (см. server.js), и незакрытый до конца
    // предыдущий сервер иначе мог отдать следующему тесту порт, который
    // на самом деле ещё не освободился: тесты делят один процесс и,
    // значит, один и тот же адрес.
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

// ── Хранилище ──────────────────────────────────

test("пустое хранилище отдаёт пустые данные, а не ошибку", async () => {
  await withServer(async ({ base }) => {
    const reviews = await (await fetch(`${base}/reviews.json`)).json();
    const settings = await (await fetch(`${base}/site-settings.json`)).json();
    assert.deepEqual(reviews, []);
    assert.deepEqual(settings, {});
  });
});

test("запись переживает перезапуск и попадает в файл", async () => {
  await withServer(async ({ api, root }) => {
    await api("POST", "/api/save-review", {
      title: "Death Note",
      type: "anime",
      status: "completed",
    });
    const onDisk = JSON.parse(await fs.readFile(path.join(root, "reviews.json"), "utf8"));
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].title, "Death Note");
    assert.equal(onDisk[0].id, 1);
  });
});

test("временный файл не остаётся после записи", async () => {
  await withServer(async ({ api, root }) => {
    await api("POST", "/api/save-review", { title: "Berserk", type: "manga" });
    const files = await fs.readdir(root);
    assert.ok(!files.some((f) => f.endsWith(".tmp")), `остался мусор: ${files}`);
  });
});

test("прошлая версия уезжает в историю и оттуда восстанавливается", async () => {
  await withServer(async ({ api, base }) => {
    // В историю попадает то, что было ДО записи. Значит первое
    // сохранение архивировать нечего, и после трёх записей версий две.
    await api("POST", "/api/save-review", { title: "Первый", type: "anime" });
    await api("POST", "/api/save-review", { title: "Второй", type: "anime" });
    await api("POST", "/api/save-review", { title: "Третий", type: "anime" });

    const { data: history } = await api("GET", "/api/file-history?path=reviews.json");
    // Первая запись — сам живой файл (sha:"current"), не из .history —
    // за ней и идут три записи минус одна: две настоящие прошлые версии.
    assert.equal(history.versions[0].sha, "current");
    assert.equal(history.versions.length, 3, "текущая плюс две прошлые версии");

    // Самая старая версия — состояние после первого сохранения.
    const oldest = history.versions.at(-1).sha;
    const { data: at } = await api("GET", `/api/file-at-commit?path=reviews.json&sha=${oldest}`);
    assert.equal(at.data.length, 1);
    assert.equal(at.data[0].title, "Первый");

    await api("POST", "/api/restore-file-version", { path: "reviews.json", sha: oldest });
    const list = await (await fetch(`${base}/reviews.json`)).json();
    assert.equal(list.length, 1, "откат вернул состояние на тот момент");
    assert.equal(list[0].title, "Первый");
  });
});

// Ровно тот случай, ради которого история и заводилась: текущий файл
// испорчен. Сообщение о порче прямым текстом отправляет в историю
// версий — значит она обязана открываться, даже когда сам файл не
// читается. Один раз она из-за этого как раз и перестала открываться.
test("история версий открывается, даже если текущий файл испорчен", async () => {
  await withServer(async ({ api, root }) => {
    await api("POST", "/api/save-review", { title: "Первый", type: "anime" });
    await api("POST", "/api/save-review", { title: "Второй", type: "anime" });
    await fs.writeFile(path.join(root, "reviews.json"), "{ это не JSON", "utf8");

    const { status, data } = await api("GET", "/api/file-history?path=reviews.json");
    assert.equal(status, 200, "история не должна падать вместе с файлом");
    assert.ok(data.ok);
    // Одна прошлая версия плюс строка «текущая» — сам файл на месте,
    // пусть и нечитаемый, и восстанавливать собираются как раз поверх него.
    assert.equal(data.versions[0].sha, "current");
    assert.ok(
      data.versions.some((v) => v.sha !== "current"),
      "прошлые версии должны остаться видны"
    );
  });
});

test("запросы внахлёст не теряют правки и не путают историю", async () => {
  await withServer(async ({ api, base }) => {
    // Три сохранения, отправленные одновременно. Так и бывает: правка, а
    // следом перестановка порядка, пока первая ещё не ответила.
    //
    // Раньше здесь сходилось сразу три беды: одинаковое имя временного
    // файла (вторая запись падала), одинаковое имя версии в истории
    // (вторая затирала первую) и потерянная правка — все трое читали
    // один и тот же список и писали поверх друг друга.
    await Promise.all([
      api("POST", "/api/save-review", { title: "Первый", type: "anime" }),
      api("POST", "/api/save-review", { title: "Второй", type: "anime" }),
      api("POST", "/api/save-review", { title: "Третий", type: "anime" }),
    ]);

    const list = await (await fetch(`${base}/reviews.json`)).json();
    assert.equal(list.length, 3, "ни одна правка не потерялась");
    assert.deepEqual([...new Set(list.map((r) => r.id))].length, 3, "номера не повторяются");

    const { data } = await api("GET", "/api/file-history?path=reviews.json");
    assert.equal(data.versions.length, 3, "текущая плюс две прошлые версии");
    assert.equal(new Set(data.versions.map((c) => c.sha)).size, 3, "версии не затёрли друг друга");
  });
});

// ── Отзывы ─────────────────────────────────────

test("правка меняет запись, а не заводит новую", async () => {
  await withServer(async ({ api, base }) => {
    const { data: added } = await api("POST", "/api/save-review", { title: "Dune", type: "movie" });
    await api("POST", "/api/save-review", {
      title: "Dune",
      type: "movie",
      grade: "etalon",
      _editId: added.id,
    });
    const list = await (await fetch(`${base}/reviews.json`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].grade, "etalon");
    assert.equal(list[0].id, added.id);
  });
});

test("удаление убирает запись, повторное сообщает об этом", async () => {
  await withServer(async ({ api }) => {
    const { data: added } = await api("POST", "/api/save-review", {
      title: "Tenet",
      type: "movie",
    });
    const { data: gone } = await api("POST", "/api/delete-review", { id: added.id });
    assert.equal(gone.title, "Tenet");

    const { status, data } = await api("POST", "/api/delete-review", { id: added.id });
    assert.equal(status, 404);
    assert.match(data.error, /уже нет/);
  });
});

test("переименование тега проходит по всем отзывам и не плодит дублей", async () => {
  await withServer(async ({ api, base }) => {
    await api("POST", "/api/save-review", {
      title: "A",
      type: "anime",
      tags: ["Старый", "Другой"],
    });
    await api("POST", "/api/save-review", { title: "B", type: "anime", tags: ["Старый", "Новый"] });

    const { data } = await api("POST", "/api/save-review", {
      _rename_tag: { from: "Старый", to: "Новый" },
    });
    assert.equal(data.touched, 2);

    const list = await (await fetch(`${base}/reviews.json`)).json();
    const b = list.find((r) => r.title === "B");
    assert.deepEqual(b.tags, ["Новый"], "тег не должен задвоиться");
  });
});

// ── Импорт ─────────────────────────────────────

test("импорт узнаёт своих по номерам и не плодит дубли", async () => {
  await withServer(async ({ api }) => {
    await api("POST", "/api/save-review", {
      title: "Na Honjaman Level Up",
      type: "manhwa",
      ids: { anilist: 105398, mal: 121496 },
    });

    const { data } = await api("POST", "/api/import-reviews", {
      items: [
        { title: "Solo Leveling", type: "manhwa", status: "current", ids: { anilist: 105398 } },
        { title: "Death Note", type: "anime", status: "completed", ids: { mal: 1535 } },
      ],
    });
    assert.equal(data.added, 1, "уже заведённая запись не добавляется заново");
    assert.equal(data.updated, 0);
  });
});

test("импорт не трогает текст отзыва и «любимое» при перезаписи", async () => {
  await withServer(async ({ api, base }) => {
    await api("POST", "/api/save-review", {
      title: "Dune",
      type: "movie",
      year: "2021",
      preview: "мой текст",
      favorite: true,
      tags: ["Топ визуал"],
      grade: "etalon",
    });
    await api("POST", "/api/import-reviews", {
      overwrite: true,
      items: [{ title: "Dune", type: "movie", year: "2021", status: "completed", grade: "brak" }],
    });

    const list = await (await fetch(`${base}/reviews.json`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].preview, "мой текст");
    assert.equal(list[0].favorite, true);
    assert.deepEqual(list[0].tags, ["Топ визуал"]);
    assert.equal(list[0].grade, "brak", "оценка из выгрузки применяется");
  });
});

// ── Настройки ──────────────────────────────────

test("настройки сохраняются и читаются обратно", async () => {
  await withServer(async ({ api }) => {
    await api("POST", "/api/save-site-settings", { theme: "doodle-dark", hiddenTabs: ["stats"] });
    const { data } = await api("GET", "/api/site-settings");
    assert.equal(data.theme, "doodle-dark");
    assert.deepEqual(data.hiddenTabs, ["stats"]);
  });
});

// ── Картинки ───────────────────────────────────

test("картинка персонажа сохраняется и находится в галерее", async () => {
  await withServer(async ({ api, base }) => {
    const webp = Buffer.from("UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==", "base64");
    const { data: up } = await api("POST", "/api/upload-char-image", {
      folder: "Death Note",
      filename: "light.webp",
      contentBase64: webp.toString("base64"),
      basePath: "chars",
    });
    assert.equal(up.url, "/chars/Death Note/light.webp");

    const { data: folders } = await api("GET", "/api/list-chars?collection=characters");
    assert.deepEqual(folders.folders, ["Death Note"]);

    const { data: files } = await api(
      "GET",
      "/api/list-chars?folder=Death%20Note&collection=characters"
    );
    assert.equal(files.files.length, 1);
    assert.equal(files.files[0].name, "light");

    // И картинка действительно отдаётся по этому адресу.
    const res = await fetch(base + files.files[0].url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
  });
});

// Имя файла проверялось шаблоном [^\w.-] — \w matches только ASCII,
// и кириллическое имя (обложка/фото с кириллическим названием тайтла
// или персонажа — обычное дело для русскоязычного приложения)
// превращалось в одни подчёркивания. Два разных файла с разными
// кириллическими именами в одной папке при этом затирали друг друга.
test("картинки с кириллическими именами не затирают друг друга", async () => {
  await withServer(async ({ api }) => {
    const webp = Buffer.from("UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==", "base64").toString("base64");

    await api("POST", "/api/upload-char-image", {
      folder: "Евангелион",
      filename: "синдзи.webp",
      contentBase64: webp,
    });
    await api("POST", "/api/upload-char-image", {
      folder: "Евангелион",
      filename: "рей.webp",
      contentBase64: webp,
    });

    const { data: files } = await api(
      "GET",
      `/api/list-chars?folder=${encodeURIComponent("Евангелион")}&collection=characters`
    );
    assert.equal(files.files.length, 2, "оба файла должны остаться, а не слиться в один");

    const names = files.files.map((f) => f.name).sort();
    assert.deepEqual(names, ["синдзи", "рей"].sort());
  });
});

// ── Защита путей ───────────────────────────────

// Коллекции тир-листа заводят с русским названием, и slugify() в
// настройках намеренно сохраняет кириллицу в id. Проверки имён файлов
// при этом были [a-z0-9-] — такая коллекция не сохранялась вообще, а
// её картинки уезжали в папку, которую сервер потом не отдавал. На
// сайте это работало (файл лежал на GitHub), то есть баг завёлся
// именно при переезде — и молча: интерфейс про отказ не сообщал.
test("коллекция с русским названием сохраняется и отдаётся", async () => {
  await withServer(async ({ api, base }) => {
    const id = "опенинги-ab12"; // ровно то, что делает slugify("Опенинги")

    const { status: saved } = await api("POST", "/api/save-chars-tier", {
      collection: id,
      data: [{ id: "t1", title: "Тайтл", tierlists: [] }],
    });
    assert.equal(saved, 200, "тир-лист такой коллекции должен сохраняться");

    const file = await (await fetch(`${base}/tier-${encodeURIComponent(id)}.json`)).json();
    assert.equal(file[0].title, "Тайтл", "и читаться обратно по http");

    // Картинки коллекции лежат в папке, которая называется как id.
    const { data: up } = await api("POST", "/api/upload-char-image", {
      basePath: id,
      folder: "Тайтл",
      filename: "a.webp",
      contentBase64: Buffer.from("картинка").toString("base64"),
    });
    const img = await fetch(base + up.url.split("/").map(encodeURIComponent).join("/"));
    assert.equal(img.status, 200, "картинка из такой папки должна отдаваться");

    // История версий тоже должна знать про такой файл.
    const { status: hist } = await api(
      "GET",
      `/api/file-history?path=tier-${encodeURIComponent(id)}.json`
    );
    assert.equal(hist, 200);
  });
});

test("наружу хранилища выйти нельзя", async () => {
  await withServer(async ({ api, base }) => {
    const { status } = await api("GET", "/api/file-history?path=../../../etc/passwd");
    assert.equal(status, 400);

    const res = await fetch(`${base}/covers/..%2f..%2f..%2fetc%2fpasswd`);
    assert.ok(res.status === 404 || res.status === 400, `ожидали отказ, получили ${res.status}`);

    const { status: bad } = await api("POST", "/api/upload-char-image", {
      folder: "../../..",
      filename: "x.webp",
      contentBase64: "AA==",
    });
    assert.equal(bad, 400);
  });
});

// ── Резервная копия ─────────────────────────────
// Не путать с «паспортом» — тот урезанный и никогда не пишется обратно.
// Здесь — обратное: всё целиком, для себя, и с записью поверх текущих
// данных.

test("резервная копия увозит с собой отзывы, любимое, свои коллекции тир-листа и картинки", async () => {
  await withServer(async ({ api }) => {
    await api("POST", "/api/save-review", { title: "Evangelion", type: "anime" });
    await api("POST", "/api/save-favorite", { name: "Shinji", type: "character" });
    await api("POST", "/api/save-site-settings", {
      tierCollections: [{ id: "openings", label: "Опенинги" }],
    });
    await api("POST", "/api/save-chars-tier", {
      collection: "openings",
      data: [{ title: "Cruel Angel's Thesis" }],
    });
    const webp = Buffer.from("UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==", "base64");
    await api("POST", "/api/upload-char-image", {
      folder: "Evangelion",
      filename: "shinji.webp",
      contentBase64: webp.toString("base64"),
    });

    const { status, data } = await api("GET", "/api/export-backup");
    assert.equal(status, 200);
    assert.equal(data.format, "tasteid-backup");
    assert.equal(data.files["reviews.json"][0].title, "Evangelion");
    assert.equal(data.files["favorites.json"][0].name, "Shinji");
    assert.equal(data.files["tier-openings.json"][0].title, "Cruel Angel's Thesis");
    assert.deepEqual(data.files["site-settings.json"].tierCollections, [
      { id: "openings", label: "Опенинги" },
    ]);
    assert.equal(data.images["chars/Evangelion/shinji.webp"], webp.toString("base64"));
  });
});

test("восстановление возвращает картинки на то же место", async () => {
  await withServer(async ({ api, base }) => {
    const webp = Buffer.from("UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==", "base64");
    await api("POST", "/api/upload-char-image", {
      folder: "Death Note",
      filename: "light.webp",
      contentBase64: webp.toString("base64"),
    });
    const { data: backup } = await api("GET", "/api/export-backup");

    const { status, data: restored } = await api("POST", "/api/restore-backup", backup);
    assert.equal(status, 200);
    assert.equal(restored.images, 1);

    const img = await fetch(`${base}/chars/${encodeURIComponent("Death Note")}/light.webp`);
    assert.equal(img.status, 200, "картинка должна снова отдаваться после восстановления");
    assert.equal(Buffer.from(await img.arrayBuffer()).toString("base64"), webp.toString("base64"));
  });
});

test("восстановление из копии заменяет текущие данные, а не дополняет их", async () => {
  await withServer(async ({ api }) => {
    await api("POST", "/api/save-review", { title: "Старый отзыв", type: "anime" });
    const { data: backup } = await api("GET", "/api/export-backup");

    await api("POST", "/api/save-review", { title: "Новый, которого не было в копии" });

    const { status } = await api("POST", "/api/restore-backup", backup);
    assert.equal(status, 200);

    const reviews = await api("GET", "/reviews.json");
    assert.equal(
      reviews.data.length,
      1,
      "после восстановления должен остаться только тот, что был в копии"
    );
    assert.equal(reviews.data[0].title, "Старый отзыв");
  });
});

test("восстановление отказывает чужому и порченому файлу", async () => {
  await withServer(async ({ api }) => {
    const { status: wrongFormat } = await api("POST", "/api/restore-backup", {
      format: "что-то другое",
      files: { "reviews.json": [] },
    });
    assert.equal(wrongFormat, 400);

    const { status: noFiles } = await api("POST", "/api/restore-backup", {
      format: "tasteid-backup",
    });
    assert.equal(noFiles, 400);

    // Имя не из белого списка — например, попытка перезаписать что-то
    // за пределами хранилища — тихо отбрасывается, а не пишется как есть.
    const { status: sneaky, data } = await api("POST", "/api/restore-backup", {
      format: "tasteid-backup",
      files: { "../../../etc/passwd": "зло", "reviews.json": [] },
    });
    assert.equal(sneaky, 200);
    assert.deepEqual(data.restored, ["reviews.json"]);

    // reviews.json должен остаться списком, а не превратиться в строку —
    // иначе файл прекрасно распарсится, а вся страница после
    // перезагрузки упадёт на первом же .filter() по нему.
    const { status: wrongShape, data: shapeData } = await api("POST", "/api/restore-backup", {
      format: "tasteid-backup",
      files: { "reviews.json": "не список", "favorites.json": [] },
    });
    assert.equal(wrongShape, 200);
    assert.deepEqual(shapeData.restored, ["favorites.json"]);
  });
});

test("страницы приложения отдаются, красивые адреса тоже", async () => {
  await withServer(async ({ base }) => {
    for (const [url, expect] of [
      ["/", 200],
      // Красивый адрес без расширения: сервер сам пробует /add.html.
      // add.html — единственный оставшийся отдельный документ (грузится
      // в iframe модалки «Добавить из паспорта»), поэтому проверка
      // разворачивания адреса держится теперь на нём.
      ["/add", 200],
      ["/js/theme.js", 200],
      ["/style.css", 200],
      // Редакторы после перехода на SPA (фаза 4) — хэш-маршруты внутри
      // index.html (#/settings-edit и т.п.), отдельных файлов под них
      // больше нет. Хэш до сервера не доходит вовсе, а старый адрес
      // обязан честно отдавать 404, а не молча что-то показывать.
      ["/settings-edit", 404],
      ["/chars-edit", 404],
      ["/favorites-edit", 404],
      ["/reviews-order", 404],
      ["/backup-history", 404],
      ["/нет-такого", 404],
    ]) {
      const res = await fetch(base + url);
      assert.equal(res.status, expect, `${url} → ${res.status}`);
    }
  });
});
