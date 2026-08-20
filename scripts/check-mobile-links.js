#!/usr/bin/env node
// Внутренние ссылки вида href="/add" — только для сайта и Electron.
//
// На сайте и в electron/server.js такой адрес разворачивает сам сервер
// (пробует /add, потом /add.html). На телефоне сервера нет: Capacitor
// отдаёт файлы из app/ по буквальному имени, и там add.html, а не add.
// Ссылка без расширения на телефоне ведёт в никуда — и, судя по
// поведению WebView, страница в этом случае тихо откатывается на
// index.html, то есть кнопка «Добавить»/«Настройки»/… просто
// перекидывает на первую вкладку. Ровно так это и обнаружилось.
//
// check-assets.js такое пропускает нарочно — там оба варианта
// считаются рабочими, потому что для сайта и Electron это правда так.
// Здесь строже: для внутренней навигации разрешён только явный .html.
//
// Запуск: node scripts/check-mobile-links.js

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const pages = new Set(
  readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => basename(f, ".html"))
);
pages.delete("index"); // "/" — законный короткий адрес, не считается

const files = [
  ...readdirSync(ROOT).filter((f) => f.endsWith(".html")),
  ...readdirSync(join(ROOT, "js"))
    .filter((f) => f.endsWith(".js") && f !== "mobile.bundle.js")
    .map((f) => `js/${f}`),
];

const pattern = new RegExp(
  `(?:href="|location\\.href\\s*=\\s*")/(${[...pages].join("|")})(?=["?])`,
  "g"
);

const errors = [];

for (const file of files) {
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const m of text.matchAll(pattern)) {
    const line = text.slice(0, m.index).split("\n").length;
    errors.push(`${file}:${line}: ссылка на «/${m[1]}» без .html — на телефоне не откроется`);
  }
}

if (errors.length) {
  console.error(`Внутренние ссылки не пройдены (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(`Внутренние ссылки в порядке: ${files.length} файлов, ${pages.size} страниц.`);
