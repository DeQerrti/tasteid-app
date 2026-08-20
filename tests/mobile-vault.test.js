// Мобильное хранилище — на подставном Capacitor Filesystem.
//
// Смысл теста не в самом Capacitor, а в том, что core/api.js работает
// поверх мобильного хранилища так же, как поверх настольного: те же
// отзывы, та же история версий, те же картинки. Если две реализации
// разойдутся, один и тот же паспорт станет вести себя по-разному на
// телефоне и на компьютере — а это ровно то, чего быть не должно.
//
// Настоящий Capacitor здесь не нужен и не поднимается: его плагин
// подменяется файловой системой во временной папке, а проверяется
// логика поверх него.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

// ── Подставной @capacitor/filesystem ───────────
// Реализуем ровно те методы, которыми пользуется mobile/src/vault.js,
// и с тем же поведением: readFile отдаёт { data }, readdir — { files }
// с полем type, отсутствующий файл роняет ошибку со словом "does not exist".
async function makeFakeFilesystem(root) {
  const abs = (p) => path.join(root, p);

  return {
    Directory: { Data: "DATA" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      async mkdir({ path: p }) {
        await fs.mkdir(abs(p), { recursive: true });
      },
      async readFile({ path: p, encoding }) {
        try {
          if (encoding) return { data: await fs.readFile(abs(p), "utf8") };
          return { data: (await fs.readFile(abs(p))).toString("base64") };
        } catch (e) {
          if (e.code === "ENOENT") throw new Error(`File does not exist: ${p}`);
          throw e;
        }
      },
      async writeFile({ path: p, data, encoding, recursive }) {
        if (recursive) await fs.mkdir(path.dirname(abs(p)), { recursive: true });
        if (encoding) await fs.writeFile(abs(p), data, "utf8");
        else await fs.writeFile(abs(p), Buffer.from(data, "base64"));
      },
      async deleteFile({ path: p }) {
        await fs.rm(abs(p), { force: true });
      },
      async readdir({ path: p }) {
        let entries;
        try {
          entries = await fs.readdir(abs(p), { withFileTypes: true });
        } catch (e) {
          if (e.code === "ENOENT") throw new Error(`Directory does not exist: ${p}`);
          throw e;
        }
        return {
          files: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          })),
        };
      },
      async getUri({ path: p }) {
        return { uri: pathToFileURL(abs(p)).href };
      },
    },
  };
}

// Модуль хранилища импортирует "@capacitor/filesystem" по имени, а
// пакета в тестах нет. Подменяем через loader-хук node:module — это
// честнее, чем прокидывать зависимость параметром только ради теста:
// проверяем тот же файл, который поедет в приложение.
async function loadVault(root) {
  const { register } = await import("node:module");
  const fake = await makeFakeFilesystem(root);
  globalThis.__fakeCapFs = fake;

  const loader = `
    export async function resolve(spec, ctx, next) {
      if (spec === "@capacitor/filesystem") return { url: "fake-capacitor:fs", shortCircuit: true };
      return next(spec, ctx);
    }
    export async function load(url, ctx, next) {
      if (url === "fake-capacitor:fs") {
        return {
          format: "module",
          shortCircuit: true,
          source: "const f = globalThis.__fakeCapFs;" +
                  "export const Filesystem = f.Filesystem;" +
                  "export const Directory = f.Directory;" +
                  "export const Encoding = f.Encoding;",
        };
      }
      return next(url, ctx);
    }`;
  register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

  const { MobileVault } = await import("../mobile/src/vault.js");
  return new MobileVault();
}

async function withVault(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasteid-mobile-"));
  try {
    const vault = await loadVault(root);
    await vault.ensure();
    await run({ vault, root });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

// Загружаем один раз: loader-хук ставится на процесс, а не на вызов.
let shared = null;
async function vaultOnce() {
  if (!shared) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasteid-mobile-"));
    shared = { vault: await loadVault(root), root };
    await shared.vault.ensure();
  }
  return shared;
}

test("пустое хранилище отдаёт умолчания, а не ошибку", async () => {
  const { vault } = await vaultOnce();
  assert.deepEqual(await vault.readJson("reviews.json", []), []);
  assert.deepEqual(await vault.readJson("site-settings.json", {}), {});
});

test("отзыв сохраняется тем же кодом, что и на компьютере", async () => {
  const { vault, root } = await vaultOnce();
  const { ROUTES } = await import("../core/api.js");

  const res = await ROUTES["POST /api/save-review"]({
    vault,
    body: { title: "Берсерк", type: "manga" },
  });
  assert.equal(res.ok, true);

  // Файл лежит на диске под тем же именем, что на компьютере, —
  // значит паспорт переносится копированием.
  const onDisk = JSON.parse(await fs.readFile(path.join(root, "TasteID", "reviews.json"), "utf8"));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].title, "Берсерк");
});

test("прошлая версия уезжает в историю и оттуда восстанавливается", async () => {
  const { vault } = await vaultOnce();
  const { ROUTES } = await import("../core/api.js");

  await ROUTES["POST /api/save-site-settings"]({ vault, body: { theme: "classic" } });
  await ROUTES["POST /api/save-site-settings"]({ vault, body: { theme: "soft-dark" } });

  const { versions } = await ROUTES["GET /api/file-history"]({
    vault,
    query: new URLSearchParams("path=site-settings.json"),
  });
  assert.equal(versions.length, 1, "две записи — одна прошлая версия");

  const { data } = await ROUTES["GET /api/file-at-commit"]({
    vault,
    query: new URLSearchParams(`path=site-settings.json&sha=${versions[0].sha}`),
  });
  assert.equal(data.theme, "classic", "в истории лежит то, что было до перезаписи");

  await ROUTES["POST /api/restore-file-version"]({
    vault,
    body: { path: "site-settings.json", sha: versions[0].sha },
  });
  assert.equal((await vault.readJson("site-settings.json", {})).theme, "classic");
});

test("картинка персонажа сохраняется и находится в галерее", async () => {
  const { vault } = await vaultOnce();
  const { ROUTES } = await import("../core/api.js");

  const { url } = await ROUTES["POST /api/upload-char-image"]({
    vault,
    body: {
      folder: "Берсерк",
      filename: "guts.webp",
      contentBase64: Buffer.from("картинка").toString("base64"),
    },
  });
  assert.equal(url, "/chars/Берсерк/guts.webp", "путь тот же, что на компьютере");

  const { folders } = await ROUTES["GET /api/list-chars"]({
    vault,
    query: new URLSearchParams(""),
  });
  assert.ok(folders.includes("Берсерк"));

  const { files } = await ROUTES["GET /api/list-chars"]({
    vault,
    query: new URLSearchParams("folder=Берсерк"),
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "guts");
});

test("коллекция с русским названием работает и на телефоне", async () => {
  const { vault } = await vaultOnce();
  const { ROUTES } = await import("../core/api.js");

  const res = await ROUTES["POST /api/save-chars-tier"]({
    vault,
    body: { collection: "опенинги-ab12", data: [{ id: "t1", title: "Тайтл", tierlists: [] }] },
  });
  assert.equal(res.ok, true);
  const back = await vault.readJson("tier-опенинги-ab12.json", []);
  assert.equal(back[0].title, "Тайтл");
});

test("наружу хранилища выйти нельзя", async () => {
  const { vault } = await vaultOnce();
  await assert.rejects(() => vault.readJson("../../secrets.json", null));
  await assert.rejects(() => vault.saveMedia("../..", "x.webp", new Uint8Array([1])));
  await assert.rejects(() => vault.listImages("chars", "../.."));
});

// withVault оставлен для будущих тестов, которым нужна своя чистая
// папка; сейчас все они делят одну и не мешают друг другу.
void withVault;
