// Счётчик сезонов/серий и томов/глав в окне отзыва (js/progress.js) и
// «Итоги» в «Статистике» (js/recap.js).
//
// Проверяется:
//   – у записи «В процессе» в окне есть счётчик: у сериала сезон и серия,
//     у манги том и глава; у игры и у завершённого его нет;
//   – «+1» и ввод числа записываются в reviews.json, а закрытие окна
//     дописывает сразу, не дожидаясь паузы;
//   – у манги «+1» не подставляет «Том 1» сам (томов может не быть);
//   – досмотренный сезон предлагает начать следующий;
//   – «Итоги ✦» открывают окно с четырьмя видами, вид и год
//     переключаются, выбранный вид запоминается, Esc закрывает;
//   – цифры «Итогов» сходятся с данными (сколько завершено в году);
//   – «Сохранить как картинку» отдаёт png.
//
// Запуск: node tests/browser/recap-progress.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

/* global cache, openReviewModal, closeReviewModal */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-recap-"));
const done = (title, type, grade, end, extra = {}) => ({
  title,
  type,
  grade,
  status: "completed",
  date_start: end,
  date_end: end,
  tags: ["Жесть"],
  ...extra,
});
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify(
    [
      { title: "Сериал", type: "show", status: "current", date_start: "2026-10-01" },
      { title: "Манга", type: "manga", status: "current", date_start: "2026-10-01" },
      { title: "Игра", type: "game", status: "current", date_start: "2026-10-01" },
      done("Первый", "anime", "etalon", "2026-03-10", { review_full: "Текст" }),
      done("Второй", "movie", "attrakcion", "2026-03-20"),
      done("Третий", "manga", "brak", "2026-07-02", { date_start: "2026-05-01", year: "1999" }),
      done("Прошлогодний", "book", "fon", "2025-06-01"),
    ].map((r, i) => ({ id: i + 1, ...r }))
  )
);

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
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
});
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => typeof openReviewModal === "function" && typeof cache !== "undefined"
);
await page.evaluate(async () => {
  if (!cache.reviews) cache.reviews = await (await fetch("/reviews.json")).json();
});

const open = (title) =>
  page.evaluate((t) => openReviewModal(cache.reviews.find((r) => r.title === t)), title);
const close = () => page.evaluate(() => closeReviewModal());
const onDisk = (title) =>
  page.evaluate(
    async (t) =>
      (await (await fetch("/reviews.json?_=" + Date.now())).json()).find((r) => r.title === t)
        .progress,
    title
  );
const block = "#review-modal-body .rv-progress";

console.log("Счётчик");
await open("Сериал");
ok(!!(await page.$(block)), "у сериала «В процессе» счётчик есть");
ok((await page.textContent(block)).includes("Сезон"), "у сериала – сезон и серия");
await page.click(`${block} [data-progress-step="inner:1"]`);
await page.click(`${block} [data-progress-step="inner:1"]`);
await page.fill(`${block} [data-progress-field="inner_total"]`, "2");
await page.press(`${block} [data-progress-field="inner_total"]`, "Enter");
ok(
  (await page.textContent(block)).includes("начать сезон 2"),
  "досмотренный сезон предлагает начать следующий"
);
await page.waitForTimeout(1500);
let p = await onDisk("Сериал");
ok(
  p?.inner === 2 && p?.inner_total === 2 && p?.outer === 1,
  `записалось через секунду (${JSON.stringify(p)})`
);
await page.click(`${block} [data-progress-act="next"]`);
await close();
await page.waitForTimeout(400);
p = await onDisk("Сериал");
ok(
  p?.outer === 2 && p?.inner === 1 && p?.inner_total === null,
  `«начать сезон 2» и закрытие сразу (${JSON.stringify(p)})`
);

await open("Манга");
ok((await page.textContent(block)).includes("Том"), "у манги – том и глава");
await page.click(`${block} [data-progress-step="inner:1"]`);
await close();
await page.waitForTimeout(400);
p = await onDisk("Манга");
ok(
  p?.inner === 1 && p?.outer === null,
  `у манги «+1» не ставит «Том 1» сам (${JSON.stringify(p)})`
);

await open("Игра");
ok(!(await page.$(block)), "у игры счётчика нет");
await close();
await open("Первый");
ok(!(await page.$(block)), "у завершённого счётчика нет");
await close();

console.log("Итоги");
await page.click('.tab-btn[aria-controls="tab-stats"]');
await page.waitForSelector(".stat-recap-btn", { timeout: 10000 });
await page.click(".stat-recap-btn");
await page.waitForSelector("#recap-overlay:not(.hidden) .recap-card");
ok((await page.$$(".recap-view")).length === 4, "четыре вида");
ok(
  (await page.getAttribute(".recap-years .tl-filter.active", "data-recap-year")) === "2026",
  "по умолчанию – последний год"
);
ok((await page.textContent(".recap-lead")).includes("3"), "в 2026 завершено три тайтла");
for (const v of ["poster", "chronicle", "changes", "summary"]) {
  await page.click(`[data-recap-view="${v}"]`);
  ok(!!(await page.$(`.recap-card[data-view="${v}"]`)), `вид «${v}» открывается`);
}
await page.click('[data-recap-view="changes"]');
await page.click('[data-recap-year="2025"]');
ok((await page.textContent(".recap-year")).includes("2025"), "год переключается");
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }),
  page.click("#recap-export-btn"),
]);
ok(
  /\.png$/.test(download.suggestedFilename()),
  `снимок картинкой (${download.suggestedFilename()})`
);
await page.keyboard.press("Escape");
ok(!!(await page.$("#recap-overlay.hidden")), "Esc закрывает");
await page.click(".stat-recap-btn");
ok(!!(await page.$('.recap-card[data-view="changes"]')), "выбранный вид запомнился");

ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nсчётчик и «Итоги» работают");
// Явно: иначе запущенный выше сервер держит процесс живым, и общий прогон
// (scripts/run-browser-tests.js) ждёт этот тест вечно.
process.exit(0);
