// Поиск тайтла в редакторе отзыва (add-lookup.js): источник по типу,
// заполнение формы, номера баз в сохранённом отзыве, TMDB только с
// ключом. Все внешние сервисы подменены – сеть не нужна.
//
// Запуск: node tests/browser/review-lookup.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-lookup-"));
const port = 8200 + (process.pid % 90);
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
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

// Картинки обложек – на несуществующем адресе, их загрузка не важна.
await page.route("https://img.invalid/**", (r) => r.fulfill({ status: 404, body: "" }));
await page.route("https://graphql.anilist.co/**", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        Page: {
          media: [
            {
              id: 151807,
              idMal: 121496,
              type: "MANGA",
              format: "MANGA",
              countryOfOrigin: "KR",
              episodes: null,
              chapters: 201,
              title: { romaji: "Na Honjaman Level Up", english: "Solo Leveling", native: null },
              startDate: { year: 2018 },
              coverImage: { extraLarge: "https://img.invalid/sl.jpg", large: null },
            },
          ],
        },
      },
    }),
  })
);
let tmdbAsked = 0;
await page.route("https://api.themoviedb.org/**", (route) => {
  tmdbAsked++;
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      results: [
        {
          id: 603,
          title: "Матрица",
          original_title: "The Matrix",
          release_date: "1999-03-30",
          poster_path: "/m.jpg",
        },
      ],
    }),
  });
});
await page.route("https://openlibrary.org/**", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      docs: [
        {
          title: "Пикник на обочине",
          author_name: ["Стругацкие"],
          first_publish_year: 1972,
          cover_i: 1,
          isbn: ["5170000000", "9785170000000"],
        },
      ],
    }),
  })
);

const pick = (type) => page.evaluate((t) => window.selectTypePicker(t), type);
const search = async (q) => {
  await page.fill("#ed-lookup-q", q);
  await page.click("#ed-lookup-btn");
  await page.waitForSelector(".ed-lookup-item");
};

await page.goto(`${base}/add.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#ed-lookup-q");

console.log("AniList: манхва");
await pick("manga");
await search("Solo Leveling");
await page.click(".ed-lookup-item");
ok((await page.inputValue("#f-title")) === "Na Honjaman Level Up", "название заполнено");
ok((await page.inputValue("#f-year")) === "2018", "год заполнен");
ok((await page.inputValue("#f-type")) === "manhwa", "корейская манга стала манхвой");
ok((await page.inputValue("#f-format")) === "201 глава", "формат – число глав");
ok((await page.inputValue("#f-cover")) === "https://img.invalid/sl.jpg", "обложка подставлена");
// Ждём именно ответ сервера на сохранение: перед ним редактор ещё делает
// резервную копию обложки (адрес подменён и недоступен – это не мешает).
const saveResponse = page.waitForResponse((r) => r.url().includes("/api/save-review"), {
  timeout: 30000,
});
await page.click("#btn-save");
await saveResponse;
const saved = await page.evaluate(async () =>
  (await (await fetch("/reviews.json?_=" + Date.now())).json()).find(
    (r) => r.title === "Na Honjaman Level Up"
  )
);
ok(
  saved?.ids?.anilist === 151807 && saved?.ids?.mal === 121496,
  `номера AniList и MAL в отзыве (${JSON.stringify(saved?.ids)})`
);

console.log("TMDB: без ключа поиск выключен, с ключом – работает");
await page.waitForTimeout(300);
await pick("movie");
ok(await page.isDisabled("#ed-lookup-btn"), "без ключа кнопка поиска выключена");
ok((await page.textContent("#ed-lookup-hint")).includes("TMDB"), "подсказка – где ввести ключ");
await page.evaluate(() => localStorage.setItem("tasteid_tmdb_key", "test-key"));
await pick("movie");
await search("Матрица");
await page.click(".ed-lookup-item");
ok(tmdbAsked === 1, "запрос ушёл в TMDB");
ok(
  (await page.inputValue("#f-title")) === "Матрица" &&
    (await page.inputValue("#f-year")) === "1999",
  "фильм заполнен"
);
ok((await page.inputValue("#f-type")) === "movie", "тип фильма не поменялся");

console.log("Open Library: книга");
await pick("book");
await search("Пикник");
await page.click(".ed-lookup-item");
ok((await page.inputValue("#f-title")) === "Пикник на обочине", "книга заполнена");
ok(
  (await page.inputValue("#f-cover")).includes("covers.openlibrary.org/b/id/1-L"),
  "обложка из Open Library"
);

console.log("Игры – без источника");
await pick("game");
ok(await page.isDisabled("#ed-lookup-btn"), "у игр поиск выключен с подсказкой");

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
