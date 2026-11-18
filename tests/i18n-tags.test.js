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

// Нейтральный набор (NEUTRAL_TAG_NAMES) перечисляет теги по именам –
// опечатка или переименованный тег тихо выпали бы из набора.
test("каждый тег нейтрального набора есть среди встроенных", () => {
  const cfg = readFileSync(path.join(root, "app/js/config.js"), "utf8");
  const start = cfg.indexOf("const TAGS_MAP = {");
  const block = cfg.slice(start, cfg.indexOf("\n};", start));
  const builtin = new Set(
    [...block.matchAll(/^\s*"?([^":\n{]+?)"?\s*:\s*\{/gm)].map((m) => m[1].trim())
  );
  const nStart = cfg.indexOf("const NEUTRAL_TAG_NAMES = new Set([");
  // Первая строка набора подставляет все жанры фильтром по категории
  // ("genre") – имена тегов идут после неё.
  const nAll = cfg.slice(nStart, cfg.indexOf("]);", nStart));
  const nBlock = nAll.slice(nAll.indexOf('"genre")') + '"genre")'.length);
  const neutral = [...nBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(neutral.length >= 25, `набор нашёлся (${neutral.length})`);
  const unknown = neutral.filter((t) => !builtin.has(t));
  assert.deepEqual(unknown, [], `нет среди встроенных: ${unknown.join(", ")}`);
});
