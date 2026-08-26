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

// Инлайновые <script> каждой страницы — переиспользуются ниже второй
// проверкой, чтобы не парсить файлы дважды.
const inlineScriptsByPage = new Map(); // page -> объединённый текст всех инлайновых <script>

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
  const inlineBlocks = [
    ...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype="module")[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  inlineScriptsByPage.set(page, inlineBlocks.join("\n"));
  for (const block of inlineBlocks) {
    for (const name of declaredIn(block)) record(name, page);
  }

  for (const [name, sources] of perName) {
    if (sources.length > 1) {
      errors.push(
        `${page}: function ${name}() объявлена больше одного раза — ${sources.join(", ")}`
      );
    }
  }
}

// ── Проверка на будущее: SPA (см. docs/план перехода, фаза 0) ──
// Сегодня каждая страница — отдельный документ со своим чистым JS-
// контекстом, так что одноимённые верхнеуровневые объявления в РАЗНЫХ
// страницах никак не мешают друг другу. При переходе на SPA (общий
// долгоживущий документ вместо полной перезагрузки между страницами)
// это перестанет быть правдой: инлайновые скрипты всех переведённых на
// роутер страниц окажутся в одной области видимости разом. Проверка
// ниже эмулирует это заранее — ищет совпадающие имена НЕ в пределах
// одной страницы (это уже покрыто выше), а между инлайновыми скриптами
// разных страниц и общими /js/*.js файлами, — чтобы переименовывать
// заранее, а не в момент, когда страница уже переводится на роутер и
// вылезает SyntaxError или тихая подмена.
//
// «Верхний уровень» здесь значит буквально это — глубина вложенности
// по фигурным скобкам равна нулю, а не «мало отступа»: первая версия
// ориентировалась на отступ (⩽2 пробелов), но часть кода — переменные
// внутри вложенных функций/колбэков вроде `.map((r) => { const info =
// …` — тоже оказывается с маленьким отступом при коротких телах, и
// давала сотню ложных совпадений на обычных именах вроде info/row/box.
// Вместо этого текст «очищается» от строк/комментариев (чтобы фигурные
// скобки внутри них не считались) и по нему честно считается глубина
// { }: имя объявления попадает в проверку, только если оно встретилось
// на глубине 0, то есть не внутри какой-либо функции, блока или
// объектного литерала.
function stripStringsAndComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && text[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const TOP_LEVEL_FUNC = /\b(?:async\s+)?function\s+(\w+)\s*\(/g;
const TOP_LEVEL_BINDING = /\b(?:const|let|var)\s+(\w+)\s*=/g;

function topLevelNames(rawText) {
  const text = stripStringsAndComments(rawText);
  // Глубина в конце каждой позиции — по одному проходу вперёд, чтобы
  // потом для любого индекса совпадения быстро узнать глубину «до него».
  const depthAt = new Int32Array(text.length + 1);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    depthAt[i] = depth;
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
  }
  depthAt[text.length] = depth;

  const names = [];
  for (const m of text.matchAll(TOP_LEVEL_FUNC)) {
    if (depthAt[m.index] === 0) names.push(m[1]);
  }
  for (const m of text.matchAll(TOP_LEVEL_BINDING)) {
    if (depthAt[m.index] === 0) names.push(m[1]);
  }
  return names;
}

const spaPerName = new Map(); // имя -> [источники]
const spaRecord = (name, source) => {
  if (!spaPerName.has(name)) spaPerName.set(name, []);
  if (!spaPerName.get(name).includes(source)) spaPerName.get(name).push(source);
};

// Общие /js/*.js — по одному разу каждый, независимо от того, сколько
// страниц его подключают (это ожидаемое, безопасное совпадение).
const jsDir = join(ROOT, "js");
for (const file of readdirSync(jsDir)) {
  if (!file.endsWith(".js") || file === "mobile.bundle.js") continue;
  const text = readFileSync(join(jsDir, file), "utf8");
  for (const name of topLevelNames(text)) spaRecord(name, `js/${file}`);
}
// Инлайновый код каждой страницы — под её же именем как источник.
for (const [page, text] of inlineScriptsByPage) {
  for (const name of topLevelNames(text)) spaRecord(name, `inline: ${page}`);
}

const spaErrors = [];
for (const [name, sources] of spaPerName) {
  if (sources.length > 1) {
    spaErrors.push(`${name} — ${sources.join(", ")}`);
  }
}

if (errors.length || spaErrors.length) {
  if (errors.length) {
    console.error(`Повторные объявления функций (${errors.length}):`);
    for (const e of errors) console.error("  •", e);
  }
  if (spaErrors.length) {
    console.error(
      `\nСовпадающие имена верхнего уровня между страницами (${spaErrors.length}) — ` +
        `при переходе на SPA эти страницы окажутся в одной области видимости:`
    );
    for (const e of spaErrors) console.error("  •", e);
  }
  process.exit(1);
}

console.log(
  `Повторов не найдено: ${htmlFiles.length} страниц проверено (в т.ч. на будущее — SPA).`
);
