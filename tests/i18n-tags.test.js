// У каждого встроенного тега – английский перевод.
//
// Теги хранятся в отзывах русскими строками и показываются через
// tagLabel() (app/js/utils.js). Пока переводы тегов нигде не
// применялись, шесть встроенных тегов без перевода никто не замечал –
// а check-i18n их не видит: имена тегов в config.js – ключи объекта, а не
// вызовы i18n(). Этот тест ловит пропуск.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");

test("у каждого встроенного тега с русскими буквами есть английский перевод", () => {
  const cfg = readFileSync(path.join(root, "app/js/config.js"), "utf8");
  const start = cfg.indexOf("const TAGS_MAP = {");
  const block = cfg.slice(start, cfg.indexOf("\n};", start));
  const tags = [...block.matchAll(/^\s*"?([^":\n{]+?)"?\s*:\s*\{/gm)].map((m) => m[1].trim());
  assert.ok(tags.length > 50, `теги нашлись (${tags.length})`);

  const en = readFileSync(path.join(root, "app/js/i18n-en.js"), "utf8");
  const dict = new Set(
    [...en.matchAll(/^\s*(?:"((?:[^"\\]|\\.)*)"|([\p{L}][\p{L}\p{N}_$]*))\s*:/gmu)].map(
      (m) => m[1] ?? m[2]
    )
  );
  const missing = tags.filter((t) => /[а-яё]/i.test(t) && !dict.has(t));
  assert.deepEqual(missing, [], `без перевода: ${missing.join(", ")}`);
});
