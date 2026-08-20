#!/usr/bin/env node
// Проверка ресурсов Android до того, как их увидит Gradle.
//
// Появилось после потерянной сборки: в комментарии к цвету было имя
// css-переменной с двумя дефисами, а в XML внутри комментария два
// дефиса подряд запрещены. Локально ничего не падало — упало через
// пять минут на сборочной машине, на этапе слияния ресурсов.
//
// Здесь ловится именно этот класс ошибок: XML в android/ проверяется
// на разбираемость, а комментарии — на запрещённые дефисы. Полноценным
// разбором ресурсов это не притворяется, до Gradle ему далеко.
//
// Запуск: node scripts/check-android.js

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android/app/src/main/res");

if (!existsSync(RES)) {
  console.log("Проекта Android нет — проверять нечего.");
  process.exit(0);
}

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".xml")) files.push(path);
  }
};
walk(RES);

const errors = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const where = relative(ROOT, file);

  // Комментарии: два дефиса подряд внутри — ошибка разбора XML, а не
  // придирка. Незакрытый комментарий — тем более.
  let from = 0;
  for (;;) {
    const open = text.indexOf("<!--", from);
    if (open === -1) break;
    const close = text.indexOf("-->", open + 4);
    if (close === -1) {
      errors.push(`${where}: комментарий не закрыт`);
      break;
    }
    const body = text.slice(open + 4, close);
    if (body.includes("--")) {
      const line = text.slice(0, open).split("\n").length;
      errors.push(
        `${where}:${line}: два дефиса подряд внутри комментария — XML такого не допускает`
      );
    }
    from = close + 3;
  }

  // Грубая проверка на парность: чаще всего ломается именно она.
  const opens = (text.match(/<[a-zA-Z]/g) || []).length;
  const closes = (text.match(/<\/[a-zA-Z]/g) || []).length + (text.match(/\/>/g) || []).length;
  if (closes > opens) errors.push(`${where}: закрывающих тегов больше, чем открывающих`);
}

if (errors.length) {
  console.error(`Ресурсы Android не пройдены (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(`Ресурсы Android в порядке: ${files.length} файлов XML.`);
