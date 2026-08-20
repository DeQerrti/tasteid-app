#!/usr/bin/env node
// Что осталось без английского перевода.
//
// Ключ перевода — сам русский текст (см. шапку app/js/i18n.js), и у этого
// подхода есть слабое место: поправил русскую строку — перевод молча
// отвалился, интерфейс остался наполовину русским. Здесь это ловится.
//
// Ищем два вида обращений:
//   i18n("…") и i18n('…') в скриптах и в разметке
//   data-i18n / data-i18n-placeholder / data-i18n-title в разметке
//
// Запуск: node scripts/check-i18n.js [--list]

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const CYR = /[А-Яа-яЁё]/;

// Словарь читаем как текст и достаём ключи разбором — импортировать его
// нельзя, он рассчитан на браузер (вызывает i18nRegister).
const dictSrc = readFileSync(join(APP, "js", "i18n-en.js"), "utf8");
const known = new Set();
// \p{L} с флагом u — иначе кириллический ключ без кавычек (а prettier
// снимает кавычки со всего, что является допустимым идентификатором,
// и русские слова ими являются) обрезался бы на первой букве.
for (const m of dictSrc.matchAll(
  /(?:^\s*|[{,]\s*)(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([\p{L}_$][\p{L}\p{N}_$]*))\s*:/gmu
)) {
  const key = m[1] ?? m[2] ?? m[3];
  if (key && CYR.test(key)) known.add(key.replace(/\\"/g, '"').replace(/\\'/g, "'"));
}

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name === "fonts") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(js|html)$/.test(e.name) && !/i18n-en\.js$/.test(e.name)) files.push(full);
  }
};
walk(APP);
files.push(join(ROOT, "electron", "ui", "welcome.html"));

const missing = new Map(); // текст → где встретился

function note(raw, file) {
  // Тот же ключ, что получится в рантайме (см. applyI18n).
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (!text || !CYR.test(text) || known.has(text)) return;
  if (!missing.has(text)) missing.set(text, new Set());
  missing.get(text).add(relative(ROOT, file));
}

for (const file of files) {
  const src = readFileSync(file, "utf8");

  // i18n("…") — двойные и одинарные кавычки. Шаблонные строки с
  // подстановками сюда намеренно не попадают: их ключ собирается во
  // время выполнения, и статически его не узнать.
  for (const m of src.matchAll(/\bi18n\(\s*"((?:[^"\\]|\\.)*)"/g)) note(m[1], file);
  for (const m of src.matchAll(/\bi18n\(\s*'((?:[^'\\]|\\.)*)'/g)) note(m[1], file);

  // Разметка: значение атрибута либо собственный текст элемента.
  for (const m of src.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]*)"/g)) note(m[1], file);
  for (const m of src.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-i18n\b(?![-=])[^>]*>([^<]*)</gi)) {
    note(m[2], file);
  }
}

if (!missing.size) {
  console.log(`Переводы на месте: ${known.size} строк в словаре, непереведённого нет.`);
  process.exit(0);
}

console.log(`В словаре ${known.size} строк. Без перевода осталось ${missing.size}:\n`);
const list = [...missing.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
if (process.argv.includes("--list")) {
  // Готовые строки для вставки в словарь.
  for (const [text] of list) console.log(`  ${JSON.stringify(text)}: "",`);
} else {
  for (const [text, where] of list.slice(0, 60)) {
    console.log(`  ${JSON.stringify(text)}\n      ${[...where].join(", ")}`);
  }
  if (list.length > 60) console.log(`\n  …и ещё ${list.length - 60}. Полный список: --list`);
}
process.exitCode = 1;
