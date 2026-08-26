#!/usr/bin/env node
// Ссылка «скачать», по которой кликают, не вставив её в документ.
//
// На телефоне <a download> не скачивает ничего: нажатие просто
// пропадает. Поэтому mobile/src/main.js перехватывает такие нажатия и
// уводит файл в системное «поделиться» — одним слушателем на document.
//
// До document событие доходит только от элемента, который в документе и
// находится. Клик по ссылке, созданной через createElement и никуда не
// вставленной, всплывать некуда: перехватчик не срабатывает, и кнопка
// на Android молча не делает ничего. Ровно так и было со «Сохранить как
// картинку» в тир-листе и со «Скачать» в истории версий — обе
// перечислены в README как работающие.
//
// Проверка простая и намеренно тупая: если в куске кода ссылке задают
// download, то до её .click() должен встретиться appendChild/append/
// insertBefore. Тонкостей вроде «а вдруг вставили в другой функции»
// здесь нет и не надо: вставлять рядом — и есть правило.
//
// Запуск: node scripts/check-mobile-downloads.js

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const files = [
  ...readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(ROOT, f)),
  ...readdirSync(join(ROOT, "js"))
    .filter((f) => f.endsWith(".js") && f !== "mobile.bundle.js")
    .map((f) => join(ROOT, "js", f)),
];

// Имя переменной со ссылкой берём из самой строки «…download = …»:
// в разных местах она зовётся то link, то a.
const DOWNLOAD_ASSIGN = /(\w+)\s*\.\s*download\s*=/g;

const errors = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(DOWNLOAD_ASSIGN)) {
    const name = m[1];
    const rest = text.slice(m.index);
    const click = rest.search(new RegExp(`\\b${name}\\.click\\(\\)`));
    if (click === -1) continue; // ссылку куда-то отдают, а не кликают сами
    const before = rest.slice(0, click);
    if (new RegExp(`\\.(appendChild|append|insertBefore)\\(\\s*${name}\\b`).test(before)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    errors.push(
      `${file.slice(ROOT.length - 3)}:${line}: по «${name}» кликают, не вставив её в документ — ` +
        `на телефоне такое нажатие пропадает молча`
    );
  }
}

if (errors.length) {
  console.error(`Ссылки «скачать» мимо документа (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(`Ссылки «скачать» в порядке: ${files.length} файлов проверено.`);
