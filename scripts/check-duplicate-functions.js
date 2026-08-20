#!/usr/bin/env node
// Повторные объявления функций внутри одной страницы.
//
// Все <script> без type="module" на одной странице — общая область
// видимости: если что-то объявлено дважды (одноимённая функция в двух
// разных местах одного файла, или в файле и подключённом /js/*.js),
// вторая версия молча подменяет первую. Ровно так однажды сломалась
// кнопка «Добавить» у типа источника в add.html: showAddTypeForm(n) и
// confirmAddType(n) были объявлены для источников, а следом на той же
// странице — ещё раз, без параметров, для типа тайтла. Побеждало
// второе объявление, и клик по «источнику» тихо дёргал чужую форму.
//
// Здесь для каждой страницы собирается тот же набор скриптов, что
// подключает браузер (её собственный код + свои /js/*.js), и в нём
// ищутся функции с одинаковым именем.
//
// Запуск: node scripts/check-duplicate-functions.js

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const FUNC_DECL = /^(?:async\s+)?function\s+(\w+)\s*\(/gm;

function declaredIn(text) {
  return [...text.matchAll(FUNC_DECL)].map((m) => m[1]);
}

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const errors = [];

for (const page of htmlFiles) {
  const html = readFileSync(join(ROOT, page), "utf8");

  // Свои /js/*.js в порядке подключения — mobile.bundle.js и vendor
  // сюда не входят: это уже собранный чужой код, не часть общей
  // области видимости страниц.
  const scripts = [...html.matchAll(/<script src="\/js\/([\w-]+\.js)(?:\?[^"]*)?"/g)]
    .map((m) => m[1])
    .filter((f) => f !== "mobile.bundle.js");

  const perName = new Map(); // имя -> [источники]
  const record = (name, source) => {
    if (!perName.has(name)) perName.set(name, []);
    perName.get(name).push(source);
  };

  for (const file of scripts) {
    const full = join(ROOT, "js", file);
    if (!existsSync(full)) continue;
    for (const name of declaredIn(readFileSync(full, "utf8"))) record(name, `js/${file}`);
  }
  // Инлайновые <script> самой страницы — без src, без type="module".
  for (const m of html.matchAll(
    /<script(?![^>]*\bsrc=)(?![^>]*\btype="module")[^>]*>([\s\S]*?)<\/script>/g
  )) {
    for (const name of declaredIn(m[1])) record(name, page);
  }

  for (const [name, sources] of perName) {
    if (sources.length > 1) {
      errors.push(
        `${page}: function ${name}() объявлена больше одного раза — ${sources.join(", ")}`
      );
    }
  }
}

if (errors.length) {
  console.error(`Повторные объявления функций (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(`Повторов не найдено: ${htmlFiles.length} страниц проверено.`);
