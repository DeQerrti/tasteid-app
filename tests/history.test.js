// История версий: что в ней остаётся (core/files.js, electron/vault.js).
//
// Раньше держались просто 50 последних версий, и серия быстрых
// сохранений (импорт с AniList, вечер с «+1» на счётчике серий)
// вытесняла состояние «до» – откатить неудачный импорт было нечем.
// Ещё версии одной миллисекунды сортировались неправильно, а сохранение
// без изменений плодило копии.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { historyToRemove, compareHistoryNames } from "../core/files.js";
import { Vault } from "../electron/vault.js";

const name = (ms, n) => {
  const stamp = new Date(ms).toISOString().replace(/[:.]/g, "-");
  return n ? `${stamp}-${n}.json` : `${stamp}.json`;
};

test("версии одной миллисекунды идут по порядку: «…Z.json» раньше «…Z-1.json»", () => {
  const t = Date.UTC(2026, 10, 17, 12);
  const sorted = [name(t, 2), name(t), name(t, 1)].sort(compareHistoryNames);
  assert.deepEqual(sorted, [name(t), name(t, 1), name(t, 2)]);
});

test("серия быстрых сохранений не вытесняет состояние перед ней", () => {
  const day = Date.UTC(2026, 10, 1);
  // Спокойные правки раз в день – 20 штук, потом импорт: 100 сохранений подряд по секунде.
  const calm = Array.from({ length: 20 }, (_, i) => name(day + i * 86400000));
  const importStart = day + 20 * 86400000;
  const burst = Array.from({ length: 100 }, (_, i) => name(importStart + i * 1000));
  const all = [...calm, ...burst];
  const removed = new Set(historyToRemove(all));
  const kept = all.filter((n) => !removed.has(n));
  assert.equal(kept.length, 50, "всего версий столько же");
  assert.ok(kept.includes(calm[calm.length - 1]), "состояние прямо перед импортом осталось");
  assert.ok(kept.includes(calm[0]), "и более ранние спокойные состояния тоже");
  assert.ok(
    burst.slice(-30).every((n) => kept.includes(n)),
    "последние 30 – всегда"
  );
});

test("сохранение без изменений не плодит версии, настоящая правка – кладёт", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tasteid-hist-"));
  try {
    const vault = new Vault(root);
    await vault.ensure();
    await vault.writeJson("reviews.json", [{ id: 1, title: "A" }]);
    await vault.writeJson("reviews.json", [{ id: 1, title: "A" }]);
    await vault.writeJson("reviews.json", [{ id: 1, title: "A" }]);
    assert.equal((await vault.history("reviews.json")).length, 0, "одинаковое – без версий");
    await vault.writeJson("reviews.json", [{ id: 1, title: "B" }]);
    const versions = await vault.history("reviews.json");
    assert.equal(versions.length, 1);
    assert.deepEqual(await vault.versionAt("reviews.json", versions[0].id), [
      { id: 1, title: "A" },
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
