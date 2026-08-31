#!/usr/bin/env node
// Проверка ссылок на собственные файлы в HTML-страницах.
//
// Зачем это появилось: при выкладке страницы стали ссылаться на стили и
// скрипты, которых в отданной браузеру версии не оказалось, и вёрстка
// разъехалась. Здесь ловится родственный, более грубый случай —
// страница ссылается на файл, которого в репозитории нет вообще.
// Опечатка в пути или переименование файла без правки ссылок больше не
// доедут до продакшна незамеченными.
//
// Заодно следим за версионным суффиксом ?v=N у стилей и скриптов: он
// нужен, чтобы после выкладки браузер не подсунул старую копию. Если
// у одной страницы суффикс есть, а у другой нет — это почти наверняка
// забытая правка, и о ней стоит сказать.
//
// Запуск: node scripts/check-assets.js

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Страницы приложения лежат в app/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const errors = [];
const warnings = [];

const htmlFiles = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const cssFiles = readdirSync(ROOT).filter((f) => f.endsWith(".css"));

// href="..." и src="..." — берём только собственные пути.
// Внешние (http…, //…), data: и якоря нас не касаются.
const REF = /(?:href|src)="([^"]+)"/g;

let checked = 0;
const versioned = new Map();

for (const page of htmlFiles) {
  const html = readFileSync(join(ROOT, page), "utf8");

  for (const [, raw] of html.matchAll(REF)) {
    // Ссылка на свой же файл, но записанная относительно страницы
    // (src="js/theme.js" вместо "/js/theme.js"). Работает она одинаково,
    // но мимо проверки ниже проходит незамеченной — и однажды так и
    // случилось: у index.html версии ?v= у половины скриптов тихо
    // отстали от остальных страниц, потому что сюда они не попадали.
    if (/^(?:js|icons)\//.test(raw) || /^[\w-]+\.(?:css|js)(?:\?|$)/.test(raw)) {
      errors.push(`${page}: ссылка на свой файл без ведущего слеша — ${raw}`);
      continue;
    }
    if (!raw.startsWith("/") || raw.startsWith("//")) continue;

    const [path, query] = raw.split("?");
    const rel = decodeURIComponent(path.slice(1));

    // Красивые адреса вида /add — это HTML-страница без расширения,
    // их разворачивает уже Cloudflare Pages.
    const candidates = [rel, `${rel}.html`];
    if (!candidates.some((c) => existsSync(join(ROOT, c)))) {
      errors.push(`${page}: ссылка ведёт в никуда — ${raw}`);
      continue;
    }
    checked++;

    if (/\.(css|js)$/.test(path)) {
      const v = /(?:^|&)v=([^&]+)/.exec(query || "")?.[1] ?? null;
      if (!versioned.has(path)) versioned.set(path, new Map());
      const byVersion = versioned.get(path);
      byVersion.set(v, [...(byVersion.get(v) || []), page]);
    }
  }
}

// То же самое для url(…) в стилях: тема «Мягкий ботанический» тянет
// картинки украшений из /decor, и опечатка в пути там ничего не ломает
// заметно — украшение просто не появляется. Такое молчаливое исчезновение
// как раз и надо ловить здесь.
const CSS_REF = /url\("([^"]+)"\)/g;

for (const sheet of cssFiles) {
  const css = readFileSync(join(ROOT, sheet), "utf8");
  for (const [, raw] of css.matchAll(CSS_REF)) {
    if (!raw.startsWith("/") || raw.startsWith("//")) continue;
    const rel = decodeURIComponent(raw.split("?")[0].slice(1));
    if (!existsSync(join(ROOT, rel))) {
      errors.push(`${sheet}: ссылка ведёт в никуда — ${raw}`);
      continue;
    }
    checked++;
  }
}

// Один и тот же файл с разными ?v= на разных страницах — забытая правка
for (const [path, byVersion] of versioned) {
  if (byVersion.size < 2) continue;
  const detail = [...byVersion.entries()]
    .map(([v, pages]) => `${v === null ? "без версии" : `v=${v}`}: ${pages.join(", ")}`)
    .join(" | ");
  warnings.push(`${path} подключается с разными версиями — ${detail}`);
}

for (const w of warnings) console.warn("  ! " + w);

if (errors.length) {
  console.error(`Проверка ссылок не пройдена (${errors.length}):`);
  for (const e of errors) console.error("  •", e);
  process.exit(1);
}

console.log(
  `Ссылки в порядке: ${htmlFiles.length} страниц, ${cssFiles.length} стилей, ` +
    `${checked} ссылок на свои файлы — все файлы на месте.`
);
