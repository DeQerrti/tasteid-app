// Конфиг приложения (electron/config-file.js): нечитаемый файл не должен
// молча превращаться в пустой и затираться первым же сохранением.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readConfigFile, writeConfigFile } from "../electron/config-file.js";

async function withDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tasteid-config-"));
  try {
    await run(path.join(dir, "config.json"), dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("конфига нет – первый запуск, а не поломка", async () => {
  await withDir(async (file) => {
    assert.deepEqual(await readConfigFile(file), { config: {}, broken: false });
  });
});

test("целый конфиг читается как есть", async () => {
  await withDir(async (file) => {
    const saved = { vaults: [{ id: "a", name: "Паспорт", path: "C:/x" }], currentVaultId: "a" };
    await writeConfigFile(file, saved);
    assert.deepEqual(await readConfigFile(file), { config: saved, broken: false });
  });
});

test("испорченный конфиг помечается и откладывается в сторону перед записью", async () => {
  await withDir(async (file, dir) => {
    const damaged = '{"vaults":[{"id":"a","name":"Паспорт","path":"C:/x"}';
    await fs.writeFile(file, damaged);

    const { config, broken } = await readConfigFile(file);
    assert.deepEqual(config, {});
    assert.equal(broken, true);

    await writeConfigFile(file, { zoom: 110 }, { broken });

    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { zoom: 110 });
    const aside = (await fs.readdir(dir)).filter((n) => n.startsWith("config.broken-"));
    assert.equal(aside.length, 1, "прежний файл сохранён рядом");
    assert.equal(await fs.readFile(path.join(dir, aside[0]), "utf8"), damaged);
  });
});

test("конфиг не того вида (массив) – тоже поломка, а не пустые настройки", async () => {
  await withDir(async (file) => {
    await fs.writeFile(file, "[]");
    assert.equal((await readConfigFile(file)).broken, true);
  });
});

test("обычная запись ничего не откладывает", async () => {
  await withDir(async (file, dir) => {
    await writeConfigFile(file, { zoom: 100 });
    await writeConfigFile(file, { zoom: 120 });
    assert.deepEqual(await fs.readdir(dir), ["config.json"]);
  });
});
