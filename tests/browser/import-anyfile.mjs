// Импорт «любого файла»: незнакомый CSV (через точку с запятой, как
// сохраняет русский Excel) или JSON не отбрасывается ошибкой, а открывает
// шаг «Что в каких столбцах»: роли угаданы по заголовкам, одна роль – один
// столбец, значения столбца типа раскладываются по типам паспорта. Дальше
// – обычный экран соответствий со статусами из файла как есть, и перенос.
//
// Запуск: node tests/browser/import-anyfile.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-anyfile-"));
writeFileSync(join(vaultDir, "reviews.json"), "[]");

const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
// Записи без обложки импорт дозапрашивает у AniList – в тесте сети нет.
await page.route("https://graphql.anilist.co/**", (route) =>
  route.fulfill({ contentType: "application/json", body: '{"data":{"Page":{"media":[]}}}' })
);

await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.click('[data-panel="import"]');
await page.click('[data-imp-open="anyfile"]');

const roles = () => page.$$eval("[data-imp-col]", (s) => s.map((x) => x.value));
const upload = (name, text) =>
  page.setInputFiles("#imp-file", { name, mimeType: "text/plain", buffer: Buffer.from(text) });

console.log("CSV через точку с запятой, русские заголовки");
const csv = [
  "Название;Что это;Моя оценка;Статус;Когда закончил;Год;Постер;Заметка",
  'Дюна;книга;8;Прочитано;01.05.2024;1965;;"классика; перечитать"',
  "Arrival;фильм;10;Посмотрено;2023-02-11;2016;https://img.invalid/a.jpg;",
  "Hades;игра;9;Прохожу;;2020;;",
  "Пикник на обочине;книга;;Хочу прочитать;;1972;;",
  "Странное;комикс;5;Пройдено;;;;",
].join("\n");
await upload("моя-таблица.csv", csv);
await page.waitForSelector(".imp-cols", { timeout: 10000 });
ok(
  JSON.stringify(await roles()) ===
    JSON.stringify(["title", "type", "score", "status", "dateEnd", "year", "cover", ""]),
  `роли угаданы по заголовкам (${(await roles()).join(", ")})`
);
ok((await page.textContent(".imp-source-line")).includes("точку с запятой"), "разделитель узнан");
const typeVals = await page.$$eval("[data-imp-typeval]", (s) =>
  s.map((x) => `${x.dataset.impTypeval}=${x.value}`)
);
ok(
  typeVals.includes("книга=book") &&
    typeVals.includes("фильм=movie") &&
    typeVals.includes("игра=game"),
  `типы угаданы (${typeVals.join(", ")})`
);
ok(typeVals.includes("комикс="), "незнакомый тип не угадан наугад");

// Одна роль – один столбец: «Заметка» → «Название» снимает его с первого.
await page.selectOption('[data-imp-col="7"]', "title");
ok(
  (await roles())[0] === "" && (await roles())[7] === "title",
  "роль переехала, у прежнего столбца снята"
);
await page.selectOption('[data-imp-col="0"]', "title");
ok((await roles())[0] === "title" && (await roles())[7] === "", "и обратно");

console.log("Экран соответствий");
await page.click("#imp-columns-next");
await page.waitForSelector("#imp-run");
const statusLabels = await page.locator(".imp-from").allTextContents();
ok(
  ["Прочитано", "Посмотрено", "Прохожу", "Хочу прочитать"].every((s) =>
    statusLabels.some((t) => t.includes(s))
  ),
  "статусы из файла показаны как есть"
);
// Значение из файла → выбранный статус паспорта (в пустом хранилище
// встроенные: completed – «Архив», current, planning).
const mapped = await page.$$eval("[data-status]", (s) =>
  Object.fromEntries(
    s.map((x) => [
      x.closest(".imp-row").querySelector(".imp-from").firstChild.textContent.trim(),
      x.value,
    ])
  )
);
ok(
  mapped["Прочитано"] === "completed" &&
    mapped["Посмотрено"] === "completed" &&
    mapped["Прохожу"] === "current" &&
    mapped["Хочу прочитать"] === "planning",
  `статусы файла угаданы по смыслу (${JSON.stringify(mapped)})`
);
ok(
  (await page.textContent(".panel-intro:has-text('Шкала')")).includes("10"),
  "шкала оценок – из 10"
);
ok(
  (await page.locator(".imp-note:has-text('пропущено')").count()) === 1,
  "запись с неизвестным типом – пропущена с объяснением"
);
await page.uncheck("#imp-backup-covers");
await page.click("#imp-run");
await page.waitForSelector("#imp-again", { timeout: 20000 });

const list = await page.evaluate(async () => (await fetch("/reviews.json?_=" + Date.now())).json());
const by = (t) => list.find((r) => r.title === t);
ok(list.length === 4, `перенесено 4 записи (${list.length})`);
ok(
  by("Дюна")?.type === "book" && by("Дюна")?.date_end === "2024-05-01",
  "дата 01.05.2024 → 2024-05-01"
);
ok(by("Дюна")?.year === "1965", "год");
ok(by("Arrival")?.cover === "https://img.invalid/a.jpg", "обложка-ссылка");
ok(
  !!by("Arrival")?.grade && by("Arrival")?.grade !== by("Дюна")?.grade,
  "оценки разложены по полкам"
);
ok(by("Пикник на обочине")?.status && !by("Пикник на обочине")?.grade, "без оценки – без полки");
ok(!by("Странное"), "запись без типа не заведена");

console.log("JSON без столбца типа");
await page.click("#imp-again");
await upload(
  "notes.json",
  JSON.stringify({
    meta: { v: 1 },
    items: [
      { name: "Portal 2", stars: "★★★★½", nested: { a: 1 } },
      { name: "Celeste", stars: "★★★★★" },
    ],
  })
);
await page.waitForSelector(".imp-cols");
ok(
  JSON.stringify(await roles()) === JSON.stringify(["title", "score"]),
  "вложенные поля не стали столбцами"
);
await page.click("#imp-columns-next");
ok(
  (await page.textContent("#imp-status")).includes("Выберите"),
  "без типа дальше не пускает – просит выбрать"
);
await page.selectOption("#imp-typeall", "game");
await page.click("#imp-columns-next");
await page.waitForSelector("#imp-run");
ok((await page.textContent(".panel-intro:has-text('Шкала')")).includes("5"), "звёзды – шкала из 5");
await page.uncheck("#imp-backup-covers");
await page.click("#imp-run");
await page.waitForSelector("#imp-again", { timeout: 20000 });
const games = (
  await page.evaluate(async () => (await fetch("/reviews.json?_=" + Date.now())).json())
).filter((r) => r.type === "game");
ok(
  games.some((r) => r.title === "Portal 2") && games.some((r) => r.title === "Celeste"),
  "игры из JSON перенесены"
);

console.log("Знакомые форматы не сломались");
const gr = await page.evaluate(
  () =>
    window.parseImportFile(
      "Book Id;Title;Author;My Rating;Exclusive Shelf\n1;Some Book;Someone;4;read\n",
      "export.csv"
    ).source
);
ok(gr === "Goodreads", "Goodreads через точку с запятой узнаётся как Goodreads");
await page.click("#imp-again");
await upload("broken.json", "{ not json");
await page.waitForSelector("#imp-status.err");
ok((await page.textContent("#imp-status")).includes("JSON"), "битый JSON – понятная ошибка");

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
