#!/usr/bin/env node
// «Шапка» страниц не должна расходиться (см. план перехода на SPA,
// фаза 1). Заводилась, когда у каждой из 7 страниц app/*.html был свой
// собственный <head>: ничего не мешало поправить, например,
// антимигание темы или версию общего скрипта только в одном файле —
// все семь оставались согласованы случайно, а не потому что что-то это
// гарантирует.
//
// После фазы 4 отдельных документов осталось два: index.html
// (постоянная оболочка SPA — все редакторы стали её хэш-маршрутами) и
// add.html, который живёт отдельно нарочно: его грузит iframe модалки
// «Добавить из паспорта» (openAddFromPassportModal() в js/passports.js)
// — это осознанная изоляция, а не недоделанный переход. Именно поэтому
// проверка нужна до сих пор: два <head> — это уже два места, где можно
// разойтись, и у add.html своя копия скрипта антимигания темы, без
// которой при заходе не с первой загрузки вернулась бы вспышка
// дефолтной темы. Список страниц читается из app/ (readdirSync), а не
// зашит здесь, — файлы удалялись фазой 4 без правок этого скрипта.
//
// Проверяется:
//  1. Инлайновый <script> антимигания темы в начале <head> — должен
//     быть побайтово одинаковым на всех страницах, где есть.
//  2. Каждый общий /js/*.js и *.css файл — везде, где на него ссылаются,
//     версия в ?v=N должна совпадать. Разъехавшаяся версия означает,
//     что где-то забыли обновить кэш-бастер при правке файла.
//
// Запуск: node scripts/check-shared-head.js

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html"));

const errors = [];

// ── 1. Антимигание темы — побайтово одинаково везде, где есть ──
const FOUC_SCRIPT = /<script>\s*\n\/\/ Тема из кэша[\s\S]*?<\/script>/;
const foucByPage = new Map();
for (const page of htmlFiles) {
  const html = readFileSync(join(ROOT, page), "utf8");
  const m = html.match(FOUC_SCRIPT);
  if (m) foucByPage.set(page, m[0]);
}
if (foucByPage.size > 0) {
  const [firstPage, firstText] = [...foucByPage.entries()][0];
  for (const [page, text] of foucByPage) {
    if (text !== firstText) {
      errors.push(
        `Скрипт антимигания темы в ${page} отличается от ${firstPage} — должен быть побайтово одинаковым на всех страницах.`
      );
    }
  }
}
if (foucByPage.size < htmlFiles.length) {
  const missing = htmlFiles.filter((p) => !foucByPage.has(p));
  if (missing.length) {
    errors.push(`Нет скрипта антимигания темы: ${missing.join(", ")}.`);
  }
}

// ── 2. Версии общих /js/*.js и *.css — одна и та же везде ──
// [\w./-]+ (со слэшем), а не только [\w.-]+ — иначе, например,
// js/routes/reviews-order.js (см. фазу 2, роут #/reviews-order)
// молча выпадал бы из проверки: слэш внутри пути не совпадал с
// прежним классом символов, регулярка на таком src просто не
// срабатывала целиком.
const REF = /<(?:script src|link rel="stylesheet" href)="\/([\w./-]+\.(?:js|css))\?v=(\d+)"/g;
const versionsByFile = new Map(); // имя -> Map(версия -> [страницы])

for (const page of htmlFiles) {
  const html = readFileSync(join(ROOT, page), "utf8");
  for (const m of html.matchAll(REF)) {
    const [, file, version] = m;
    if (!versionsByFile.has(file)) versionsByFile.set(file, new Map());
    const byVersion = versionsByFile.get(file);
    if (!byVersion.has(version)) byVersion.set(version, []);
    byVersion.get(version).push(page);
  }
}

for (const [file, byVersion] of versionsByFile) {
  if (byVersion.size > 1) {
    const detail = [...byVersion.entries()]
      .map(([v, pages]) => `?v=${v} (${pages.join(", ")})`)
      .join(" vs ");
    errors.push(`${file}: версия разъехалась между страницами — ${detail}`);
  }
}

// ── 3. Фавиконки — на каждой странице ──
// Разъехалось само по себе один раз: у settings-edit.html не было ни
// одной из трёх ссылок ниже, пока их не завели явно (вкладка в браузере/
// Electron просто оставалась без иконки). index.html может добавлять
// сверху PWA-специфичное (manifest, 16x16, theme-color) — это законно,
// проверяется только базовый набор, общий для всех.
const REQUIRED_ICON_LINKS = [
  '<link rel="icon" type="image/x-icon" href="/icons/favicon.ico">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">',
  '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">',
];
for (const page of htmlFiles) {
  const html = readFileSync(join(ROOT, page), "utf8");
  for (const link of REQUIRED_ICON_LINKS) {
    if (!html.includes(link)) {
      errors.push(`${page}: нет фавиконки — отсутствует ${link}`);
    }
  }
}

if (errors.length) {
  console.error(`Шапка страниц разъехалась (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(
  `Шапка согласована: ${htmlFiles.length} страниц, ${versionsByFile.size} общих файлов проверено.`
);
