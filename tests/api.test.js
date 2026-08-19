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
    assert.equal(history.versions.length, 2, "три записи — две прошлые версии");

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
    assert.equal(data.versions.length, 2, "три записи — две прошлые версии");
    assert.equal(new Set(data.versions.map((c) => c.sha)).size, 2, "версии не затёрли друг друга");
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

// ── Защита путей ───────────────────────────────

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

test("страницы приложения отдаются, красивые адреса тоже", async () => {
  await withServer(async ({ base }) => {
    for (const [url, expect] of [
      ["/", 200],
      ["/add", 200],
      ["/settings-edit", 200],
      ["/js/theme.js", 200],
      ["/style.css", 200],
      ["/нет-такого", 404],
    ]) {
      const res = await fetch(base + url);
      assert.equal(res.status, expect, `${url} → ${res.status}`);
    }
  });
});
