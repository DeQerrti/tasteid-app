// Синхронизация не разносит пустоту и не удаляет массово.
//
// Настоящий app/js/sync.js в песочнице (node:vm) против подставного
// GitHub и подставного локального API – без браузера. Каждый сценарий
// здесь раньше терял данные:
//   – новое устройство с пустым хранилищем получало конфликт, и
//     «Оставить моё» отправляло [] в облако;
//   – пересозданный репозиторий выглядел как «всё удалили на другом
//     устройстве» – удалялись все картинки устройства;
//   – раздел тир-листа, заведённый на другом устройстве, всегда давал
//     конфликт;
//   – reviews.json, пропавший с диска, через секунды уезжал в облако
//     пустым;
//   – массовая пропажа картинок в репозитории удаляла их здесь.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const SRC = readFileSync(path.join(import.meta.dirname, "..", "app", "js", "sync.js"), "utf8");
const gitSha = (b64) => {
  const buf = Buffer.from(b64, "base64");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
};
const b64 = (o) => Buffer.from(JSON.stringify(o, null, 2), "utf8").toString("base64");
const fromB64 = (b) => JSON.parse(Buffer.from(b, "base64").toString("utf8"));
const CFG = { token: "t", owner: "o", repo: "r", branch: "main" };

function makeWorld({ localFiles, localImages = {}, remote, state }) {
  const ls = new Map();
  const log = { deleted: [], puts: [] };
  const remoteFiles = new Map(Object.entries(remote));
  const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
  const fetchStub = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (url.startsWith("https://api.github.com")) {
      const p = url.slice("https://api.github.com".length);
      if (/\/git\/trees\//.test(p)) {
        return json({
          tree: [...remoteFiles].map(([path, b]) => ({ type: "blob", path, sha: gitSha(b) })),
        });
      }
      let m;
      if ((m = /\/git\/blobs\/(\w+)/.exec(p))) {
        for (const b of remoteFiles.values()) if (gitSha(b) === m[1]) return json({ content: b });
        return json({}, 404);
      }
      if ((m = /\/contents\/(.+)$/.exec(p))) {
        const filePath = decodeURIComponent(m[1]);
        if (method === "GET") {
          const b = remoteFiles.get(filePath);
          return b ? json({ content: b, sha: gitSha(b), size: 1 }) : json({}, 404);
        }
        if (method === "PUT") {
          const body = JSON.parse(init.body);
          remoteFiles.set(filePath, body.content);
          log.puts.push(filePath);
          return json({ content: { sha: gitSha(body.content) } });
        }
      }
      return json({}, 404);
    }
    if (url.startsWith("/api/sync-manifest")) {
      const images = url.includes("images=0")
        ? {}
        : Object.fromEntries(Object.keys(localImages).map((k) => [k, { size: 1, mtime: 1 }]));
      return json({ ok: true, files: localFiles, images });
    }
    if (url.startsWith("/api/read-media")) {
      const p = new URL("http://x" + url).searchParams.get("path");
      return json({ ok: true, base64: localImages[p] });
    }
    if (url === "/api/delete-media") {
      const p = JSON.parse(init.body).path.slice(1);
      delete localImages[p];
      log.deleted.push(p);
      return json({ ok: true });
    }
    if (url === "/api/restore-backup") {
      const b = JSON.parse(init.body);
      Object.assign(localFiles, b.files || {});
      Object.assign(localImages, b.images || {});
      return json({ ok: true, restored: Object.keys(b.files || {}), failedImages: [] });
    }
    return json({}, 404);
  };
  const ctx = {
    window: {},
    localStorage: {
      getItem: (k) => (ls.has(k) ? ls.get(k) : null),
      setItem: (k, v) => ls.set(k, String(v)),
      removeItem: (k) => ls.delete(k),
    },
    fetch: fetchStub,
    i18n: (s) => s,
    crypto: globalThis.crypto,
    TextEncoder,
    btoa,
    atob,
    escape,
    unescape,
    setTimeout: () => 0,
    clearTimeout: () => {},
    console,
  };
  ctx.window.fetch = null;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (state) ctx.localStorage.setItem("tasteid_sync_state:default", JSON.stringify(state));
  const runSync = vm.runInContext("runSync", ctx);
  return { run: () => runSync(CFG), log, remoteFiles, localFiles, localImages };
}

const REVIEWS = [{ id: 1, title: "Важный отзыв" }];
const IMG = Buffer.from("PNGDATA").toString("base64");

test("новое пустое устройство забирает данные из облака, а не спорит с ними", async () => {
  const w = makeWorld({
    localFiles: { "reviews.json": [], "site-settings.json": {} },
    remote: { "reviews.json": b64(REVIEWS), "site-settings.json": b64({ theme: "classic" }) },
  });
  const r = await w.run();
  assert.equal(r.conflicts.length, 0, "конфликтов нет");
  assert.deepEqual(w.localFiles["reviews.json"], REVIEWS, "отзывы пришли на устройство");
  assert.deepEqual(fromB64(w.remoteFiles.get("reviews.json")), REVIEWS, "в облаке не стало пусто");
});

test("пересозданный репозиторий: картинки не удаляются, данные уезжают заново", async () => {
  const localImages = {
    "covers-backup/a.webp": IMG,
    "chars/Тайтл/b.webp": IMG,
    "covers/c.webp": IMG,
  };
  const state = {
    files: { "reviews.json": { hash: "x", sha: "old" } },
    images: Object.fromEntries(
      Object.keys(localImages).map((p) => [p, { hash: "x", sha: gitSha(IMG), size: 1, mtime: 1 }])
    ),
  };
  const w = makeWorld({
    localFiles: { "reviews.json": REVIEWS },
    localImages,
    remote: { "README.md": b64("readme") },
    state,
  });
  const r = await w.run();
  assert.equal(r.deletedLocally, 0);
  assert.equal(Object.keys(w.localImages).length, 3, "все картинки на месте");
  assert.ok(r.repoReset);
  assert.deepEqual(
    fromB64(w.remoteFiles.get("reviews.json")),
    REVIEWS,
    "отзывы отправлены в новый репозиторий"
  );
});

test("раздел тир-листа с другого устройства просто забирается", async () => {
  const tier = [{ id: "t1", title: "С телефона" }];
  const w = makeWorld({
    localFiles: { "tier-игры.json": [] },
    remote: { "tier-игры.json": b64(tier) },
    state: { files: {}, images: {} },
  });
  const r = await w.run();
  assert.equal(r.conflicts.length, 0);
  assert.deepEqual(w.localFiles["tier-игры.json"], tier);
});

test("файл, пропавший с диска, не уезжает в облако пустым – это конфликт", async () => {
  const remoteB = b64(REVIEWS);
  const w = makeWorld({
    localFiles: { "reviews.json": [] },
    remote: { "reviews.json": remoteB },
    state: { files: { "reviews.json": { hash: "old", sha: gitSha(remoteB) } }, images: {} },
  });
  const r = await w.run();
  assert.equal(r.pushed, 0, "ничего не отправлено");
  assert.equal(r.conflicts.length, 1);
  assert.ok(r.conflicts[0].localEmpty, "конфликт помечен как «здесь пусто»");
  assert.deepEqual(fromB64(w.remoteFiles.get("reviews.json")), REVIEWS, "в облаке данные целы");
});

test("массовая пропажа картинок в репозитории не удаляет их здесь", async () => {
  const localImages = {};
  const remote = { "reviews.json": b64(REVIEWS) };
  const images = {};
  for (let i = 0; i < 40; i++) {
    const p = `covers-backup/${i}.webp`;
    localImages[p] = IMG;
    images[p] = { hash: "x", sha: gitSha(IMG), size: 1, mtime: 1 };
    if (i < 5) remote[p] = IMG; // в репозитории осталось только 5 из 40
  }
  const w = makeWorld({
    localFiles: { "reviews.json": REVIEWS },
    localImages,
    remote,
    state: {
      files: { "reviews.json": { hash: "x", sha: gitSha(remote["reviews.json"]) } },
      images,
    },
  });
  const r = await w.run();
  assert.equal(r.deletedLocally, 0);
  assert.equal(r.blockedDeletes, 35, "удаление 35 картинок пропущено и названо");
  assert.equal(Object.keys(w.localImages).length, 40);
});

test("удаление одной картинки на другом устройстве по-прежнему доходит сюда", async () => {
  const localImages = {};
  const remote = { "reviews.json": b64(REVIEWS) };
  const images = {};
  for (let i = 0; i < 40; i++) {
    const p = `covers-backup/${i}.webp`;
    localImages[p] = IMG;
    images[p] = { hash: "x", sha: gitSha(IMG), size: 1, mtime: 1 };
    if (i !== 7) remote[p] = IMG;
  }
  const w = makeWorld({
    localFiles: { "reviews.json": REVIEWS },
    localImages,
    remote,
    state: {
      files: { "reviews.json": { hash: "x", sha: gitSha(remote["reviews.json"]) } },
      images,
    },
  });
  const r = await w.run();
  assert.equal(r.deletedLocally, 1);
  assert.deepEqual(w.log.deleted, ["covers-backup/7.webp"]);
});
