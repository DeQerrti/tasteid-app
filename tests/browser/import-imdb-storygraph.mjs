// Импорт из IMDb и StoryGraph – бывшие «в планах» на экране импорта.
//
// IMDb: ratings.csv (всё оценённое) и watchlist.csv («посмотреть», есть
// столбец Position). Названия типов – в обоих видах, старом («tvSeries»)
// и новом («TV Series»); отдельные эпизоды пропускаются. Постер – у TMDB
// по номеру IMDb (/find), и для сериала тоже. Ответы TMDB подменены.
//
// StoryGraph: статусы read / currently-reading / to-read /
// did-not-finish, оценка с четвертинками, даты через «/», ISBN, текст
// отзыва – в новую запись, а уже написанный свой отзыв не трогается.
//
// Заголовки файлов – как в настоящих выгрузках сервисов; настоящими
// файлами owner'а не проверялось.
//
// Запуск: node tests/browser/import-imdb-storygraph.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-impimdb-"));
// Уже есть своя запись с написанным отзывом – импорт не должен его стереть.
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "Своя книга",
      type: "book",
      status: "completed",
      grade: "etalon",
      review_full: "мой текст",
    },
  ])
);

const IMDB_RATINGS = [
  "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
  'tt0111161,10,2023-05-12,The Shawshank Redemption,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,Movie,9.3,142,1994,"Drama",3000000,1994-10-14,Frank Darabont',
  'tt0903747,9,2022-01-02,Breaking Bad,Breaking Bad,https://www.imdb.com/title/tt0903747/,TV Series,9.5,49,2008,"Crime, Drama",2000000,2008-01-20,',
  "tt0959621,8,2022-01-03,Pilot,Pilot,https://www.imdb.com/title/tt0959621/,TV Episode,9.0,58,2008,Drama,40000,2008-01-20,Vince Gilligan",
  "tt0068646,7,2021-03-04,The Godfather,The Godfather,https://www.imdb.com/title/tt0068646/,movie,9.2,175,1972,Crime,2000000,1972-03-24,Francis Ford Coppola",
].join("\n");

const IMDB_WATCHLIST = [
  "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated",
  "1,tt1375666,2024-01-01,2024-01-01,,Inception,Inception,https://www.imdb.com/title/tt1375666/,Movie,8.8,148,2010,Sci-Fi,2500000,2010-07-16,Christopher Nolan,,",
].join("\n");

const STORYGRAPH = [
  "Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?",
  '"Пикник на обочине","Аркадий Стругацкий, Борис Стругацкий",,9785170908052,paperback,read,2023/01/01,2023/02/10,2023/02/01-2023/02/10,2,dark,medium,Plot,,,,,4.75,"Очень сильно.<br/>Перечитаю.",,,,No',
  '"Читаю сейчас",Автор,,,digital,currently-reading,2024/01/01,,,0,,,,,,,,,,,,,No',
  '"Брошенная",Автор,,,digital,did-not-finish,2024/01/01,,,0,,,,,,,,1.25,,,,,No',
  '"Своя книга",Автор,,,digital,read,2020/01/01,2020/05/05,,1,,,,,,,,5,"Чужой текст из выгрузки",,,,No',
].join("\n");

// Свободный порт у системы, а не зашитый (см. chars-favorites-cover-cleanup.mjs).
const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
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
const base = `http://127.0.0.1:${port}`;

// TMDB: ответ /find по номеру IMDb. Фильм – movie_results, сериал –
// tv_results (у него first_air_date вместо release_date).
const findCalls = [];
await page.route("https://api.themoviedb.org/3/**", (route) => {
  const url = new URL(route.request().url());
  const m = url.pathname.match(/\/find\/(tt\d+)$/);
  if (!m)
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  findCalls.push(m[1]);
  const body =
    m[1] === "tt0903747"
      ? {
          movie_results: [],
          tv_results: [{ id: 1396, poster_path: "/bb.jpg", first_air_date: "2008-01-20" }],
        }
      : {
          movie_results: [{ id: Number(m[1].slice(2)), poster_path: `/${m[1]}.jpg` }],
          tv_results: [],
        };
  route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});
await page.addInitScript(() => localStorage.setItem("tasteid_tmdb_key", "test-key"));

await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.click('[data-panel="import"]');
await page.waitForSelector(".imp-card");

ok((await page.locator(".imp-card.is-planned").count()) === 0, "карточек «в планах» больше нет");

async function importFile(cardId, name, text) {
  if (!(await page.locator(`[data-imp-card="${cardId}"] .imp-card-body`).count())) {
    await page.click(`[data-imp-open="${cardId}"]`);
  }
  ok(
    (await page.locator(`[data-imp-card="${cardId}"] .imp-steps li`).count()) >= 3,
    `${cardId}: есть шаги «куда нажать»`
  );
  await page.setInputFiles("#imp-file", {
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(text, "utf8"),
  });
  await page.waitForSelector("#imp-run", { timeout: 15000 });
  const source = await page.textContent(".imp-source-line");
  if (await page.locator("#imp-backup-covers").count()) await page.uncheck("#imp-backup-covers");
  await page.click("#imp-run");
  await page.waitForSelector("#imp-again", { timeout: 20000 });
  await page.click("#imp-again");
  await page.waitForSelector(".imp-card");
  return source;
}
const reviews = async () => JSON.parse(readFileSync(join(vaultDir, "reviews.json"), "utf8"));

console.log("IMDb: оценки");
const src1 = await importFile("imdb", "ratings.csv", IMDB_RATINGS);
ok(src1.includes("IMDb"), `файл узнан как IMDb (${src1.trim()})`);
let list = await reviews();
const shawshank = list.find((r) => r.title === "The Shawshank Redemption");
ok(shawshank?.type === "movie" && shawshank?.status === "completed", "фильм – просмотрен");
ok(shawshank?.ids?.imdb === "tt0111161", "номер IMDb сохранён как есть (tt…)");
ok(
  shawshank?.cover?.endsWith("/tt0111161.jpg"),
  `постер – по номеру через TMDB (${shawshank?.cover})`
);
ok(shawshank?.date_end === "2023-05-12", "дата оценки – датой просмотра");
ok(!!shawshank?.grade, "оценка разложена по полке");
const bb = list.find((r) => r.title === "Breaking Bad");
ok(bb?.type === "show", "«TV Series» – сериал");
ok(bb?.cover?.endsWith("/bb.jpg") && bb?.ids?.tmdb === 1396, "у сериала постер из tv_results");
ok(
  list.find((r) => r.title === "The Godfather")?.type === "movie",
  "старое написание «movie» тоже понято"
);
ok(!list.some((r) => r.title === "Pilot"), "отдельный эпизод пропущен");
ok(findCalls.includes("tt0903747"), "TMDB спрошен по номеру, а не по названию");

console.log("IMDb: «посмотреть»");
await importFile("imdb", "watchlist.csv", IMDB_WATCHLIST);
list = await reviews();
const inception = list.find((r) => r.title === "Inception");
ok(
  !!inception && inception.status !== "completed",
  `из watchlist – не «просмотрено» (${inception?.status})`
);
ok(!inception?.date_end, "без даты просмотра");

console.log("StoryGraph");
const src3 = await importFile("storygraph", "storygraph.csv", STORYGRAPH);
ok(src3.includes("StoryGraph"), `файл узнан как StoryGraph (${src3.trim()})`);
list = await reviews();
const picnic = list.find((r) => r.title === "Пикник на обочине");
ok(picnic?.type === "book" && picnic?.status === "completed", "прочитанное – прочитано");
ok(
  picnic?.date_start === "2023-02-01" && picnic?.date_end === "2023-02-10",
  "даты начала и конца из «/»-формата"
);
ok(picnic?.rewatch_count === 1, "два прочтения – один повтор");
ok(picnic?.ids?.isbn13 === 9785170908052, "ISBN сохранён");
ok(
  picnic?.review_full === "Очень сильно.\nПеречитаю.",
  `отзыв перенесён, переносы вместо <br/> (${JSON.stringify(picnic?.review_full)})`
);
ok(!!picnic?.grade, "оценка 4,75 разложена по полке");
ok(list.find((r) => r.title === "Читаю сейчас")?.status !== "completed", "«читаю» – не в архиве");
ok(
  list.find((r) => r.title === "Своя книга")?.review_full === "мой текст",
  "свой написанный отзыв импорт не перезаписал"
);

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nимпорт IMDb и StoryGraph работает");
