// «Настройки → Перенос → Экспорт» (js/routes/settings-export.js):
// выгрузка записей таблицей CSV.
//
// Проверяется – по настоящему скачанному файлу:
//   – BOM в начале (иначе Excel покажет кириллицу кракозябрами) и «;»
//     разделителем (русский Excel);
//   – строка заголовков, по строке на запись;
//   – тип, статус и оценка – словами, как в приложении, свои статусы тоже;
//     законченное – «Завершено» (и при сохранённом старом «Архив»);
//   – текст отзыва с абзацами, кавычками и «;» – одной ячейкой;
//   – ячейка, начинающаяся с «=», не станет формулой;
//   – снятая галочка статуса убирает его записи и из счётчика, и из файла;
//   – числовая шкала – числом («8», а не «8/10» – Excel читает это датой).
//
// Запуск: node tests/browser/export-csv.mjs

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright"));
  }
})();

const failures = [];
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures.push(msg);
};

const reviews = [
  {
    id: 1,
    title: "Фильм с отзывом",
    type: "movie",
    status: "completed",
    grade: "etalon",
    year: "1999",
    date_start: "2026-01-02",
    date_end: "2026-01-05",
    rewatch_count: 2,
    favorite: true,
    tags: ["Топ визуал", "Без кринжа"],
    review_full: 'Первый абзац; с точкой с запятой.\n\nВторой – с "кавычками".',
    url: "https://example.com/film",
  },
  { id: 2, title: "=1+1 Формула", type: "anime", status: "planning" },
  { id: 3, title: "Своё", type: "game", status: "mine" },
  { id: 4, title: "Отложенная манга", type: "manga", status: "onhold", date_start: "2026-03-01" },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-export-csv-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
const settings = (extra) =>
  writeFileSync(
    join(dir, "site-settings.json"),
    JSON.stringify({
      statusBuckets: [
        { key: "current", label: "В процессе" },
        { key: "onhold", label: "Отложено" },
        { key: "planning", label: "Планирую" },
        { key: "mine", label: "Мой статус" },
      ],
      ...extra,
    })
  );
settings({});

const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const jsErrors = [];

// Простой разбор CSV с кавычками – ровно настолько, насколько нужно тесту.
function parseCsv(text, sep) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') ((cell += '"'), i++);
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) (row.push(cell), (cell = ""));
    else if (c === "\r" && text[i + 1] === "\n")
      (row.push(cell), rows.push(row), (row = []), (cell = ""), i++);
    else cell += c;
  }
  return rows;
}

async function openPanel() {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 900 },
    acceptDownloads: true,
  });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
  await page.click('[data-panel="export"]');
  await page.waitForSelector("#export-csv-btn");
  return page;
}

async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export-csv-btn")]);
  const path = join(dir, "out-" + Date.now() + ".csv");
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), text: readFileSync(path, "utf8") };
}

console.log("Панель");
let page = await openPanel();
const statuses = await page.locator(".export-csv-status").allTextContents();
ok(
  statuses.map((s) => s.replace(/\s+/g, " ").trim()).join("|") ===
    "Отложено 1|Планирую 1|Мой статус 1|Завершено 1",
  `статусы галочками с числом записей (${statuses.map((s) => s.replace(/\s+/g, " ").trim()).join(" | ")})`
);
ok((await page.textContent("#export-csv-count")).trim() === "4 записи", "счётчик – 4 записи");

console.log("Файл");
const { name, text } = await download(page);
ok(/^tasteid-\d{4}-\d{2}-\d{2}\.csv$/.test(name), `имя файла с датой (${name})`);
ok(text.charCodeAt(0) === 0xfeff, "BOM в начале – Excel поймёт кириллицу");
const rows = parseCsv(text.slice(1), ";");
const head = rows[0];
ok(
  head.slice(0, 4).join("|") === "Название|Тип|Статус|Оценка",
  `заголовки через «;» (${head.join(", ")})`
);
ok(rows.length === 5, `строка заголовков и 4 записи (${rows.length})`);
const col = (h) => head.indexOf(h);
const film = rows.find((r) => r[0] === "Фильм с отзывом");
ok(film[col("Тип")] === "Фильм", "тип словом");
// Законченное – тем же названием, что в выборе статуса в редакторе
// (labels.statuses.archive, по умолчанию «Завершено» – раньше было «Архив»).
ok(film[col("Статус")] === "Завершено", "статус законченного – «Завершено»");
ok(film[col("Оценка")] === "Эталон", `оценка – название полки (${film[col("Оценка")]})`);
ok(
  film[col("Начато")] === "2026-01-02" && film[col("Закончено")] === "2026-01-05",
  "даты как в файле (ГГГГ-ММ-ДД)"
);
ok(film[col("Теги")] === "Топ визуал, Без кринжа", "теги через запятую");
ok(film[col("В любимом")] === "да" && film[col("Пересмотров")] === "2", "любимое и пересмотры");
ok(
  film[col("Отзыв")] === 'Первый абзац; с точкой с запятой.\n\nВторой – с "кавычками".',
  "отзыв с абзацами, «;» и кавычками – одной ячейкой"
);
ok(film[col("Ссылка")] === "https://example.com/film", "ссылка");
ok(
  rows.find((r) => r[1] === "Игра")?.[col("Статус")] === "Мой статус",
  "свой статус – своим названием"
);
ok(
  rows.some((r) => r[0] === "'=1+1 Формула"),
  "название с «=» не станет формулой"
);

console.log("Галочки");
await page.click('[data-export-status="completed"]');
await page.click('[data-export-status="planning"]');
ok(
  (await page.textContent("#export-csv-count")).trim() === "2 записи",
  "сняли два статуса – 2 записи"
);
const part = parseCsv((await download(page)).text.slice(1), ";");
ok(
  part.length === 3 && !part.some((r) => r[0] === "Фильм с отзывом"),
  "в файле только отмеченные статусы"
);
await page.close();

console.log("Числовая шкала");
reviews[0].grade = 8;
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
// Заодно: в настройках осталось старое название по умолчанию «Архив» –
// показывается новое, «Завершено» (FROZEN_LABEL_DEFAULTS в theme.js).
settings({
  gradeScale: { type: "numeric", numericMax: 10, shelves: [] },
  labels: { statuses: { archive: "Архив" } },
});
page = await openPanel();
const num = parseCsv((await download(page)).text.slice(1), ";");
const gi = num[0].indexOf("Оценка (из 10)");
ok(gi > 0, `заголовок «Оценка (из 10)» (${num[0].slice(0, 4).join(", ")})`);
ok(num.find((r) => r[0] === "Фильм с отзывом")?.[gi] === "8", "оценка числом, а не «8/10»");
ok(
  num.find((r) => r[0] === "Фильм с отзывом")?.[2] === "Завершено",
  "сохранённое старое «Архив» – тоже «Завершено»"
);
await page.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
