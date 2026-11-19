// «Что посмотреть?» (js/now.js: nowOpenRandom): кнопка «Случайный» во
// вкладке «Статусы» и полоса «Может, это?» над карточками.
//
// Проверяется:
//   – кнопка есть, когда видно больше одного тайтла, и пропадает, когда
//     под фильтром остался один; кубик – svg, не смайл;
//   – выбор показывается полосой, окно отзыва само не открывается;
//   – «Другой» и повторный кубик не повторяют тайтл подряд;
//   – «Открыть» – окно того же отзыва, ✕ убирает полосу;
//   – выбор только из видимого: под чипом «Фильм» – только фильмы;
//   – сменили чип или статус так, что выбранного не видно, – полосы нет.
//
// Запуск: node tests/browser/random-pick.mjs

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

const reviews = [
  { id: 1, title: "Аниме А", type: "anime", status: "planning" },
  { id: 2, title: "Аниме Б", type: "anime", status: "planning" },
  { id: 3, title: "Аниме В", type: "anime", status: "planning" },
  { id: 4, title: "Фильм А", type: "movie", status: "planning" },
  { id: 5, title: "Фильм Б", type: "movie", status: "planning" },
  { id: 6, title: "Книга А", type: "book", status: "planning" },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-random-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));

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
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[aria-controls="tab-now"]');
await page.click('#tab-now .tl-mode-btn[data-mode="planning"]');
await page.waitForSelector("#tab-now .review-card-wrap", { timeout: 15000 });

const pickTitle = () => page.textContent("#now-pick .now-pick-title");

console.log("Кнопка");
ok(await page.isVisible("#now-random"), "«Случайный» видна (в «Планирую» 6 тайтлов)");
ok(!(await page.textContent("#now-random")).includes("🎲"), "без смайла – кубик нарисован линией");
ok(!!(await page.$("#now-random svg.now-dice")), "кубик – svg");

console.log("Полоса «Может, это?»");
await page.click("#now-random");
await page.waitForSelector("#now-pick");
const firstPick = await pickTitle();
ok(
  reviews.some((r) => r.title === firstPick),
  `над карточками полоса с тайтлом из списка («${firstPick}»)`
);
ok(!(await page.isVisible("#review-modal-overlay")), "окно отзыва само не открывается");
let prev = firstPick;
let repeats = 0;
for (let i = 0; i < 15; i++) {
  await page.click('#now-pick [data-pick="again"]');
  const t = await pickTitle();
  if (t === prev) repeats++;
  prev = t;
}
ok(repeats === 0, "«Другой» ни разу не выдал тот же тайтл подряд");
await page.click("#now-random");
ok((await pickTitle()) !== prev, "повторное нажатие кубика – тоже другой тайтл");
prev = await pickTitle();

await page.click('#now-pick [data-pick="open"]');
await page.waitForSelector("#review-modal-overlay:not(.hidden)");
ok((await page.textContent("#review-modal-title")) === prev, "«Открыть» – окно этого же отзыва");
await page.keyboard.press("Escape");
await page.waitForSelector("#review-modal-overlay.hidden", { state: "attached" });
ok(await page.isVisible("#now-pick"), "после окна полоса на месте");
await page.click('#now-pick [data-pick="close"]');
ok(!(await page.$("#now-pick")), "✕ убирает полосу");

console.log("Только видимое: чип «Фильм»");
await page.click('#now-chips .now-chip[data-type="movie"]');
const seen = new Set();
await page.click("#now-random");
await page.waitForSelector("#now-pick");
seen.add(await pickTitle());
for (let i = 0; i < 10; i++) {
  await page.click('#now-pick [data-pick="again"]');
  seen.add(await pickTitle());
}
ok(
  [...seen].every((t) => t.startsWith("Фильм")),
  `только фильмы: ${[...seen].join(", ")}`
);
ok(seen.size === 2, "и оба фильма попадаются");

console.log("Выбор пропал из списка – полоса уходит");
await page.click('#now-chips .now-chip[data-type="anime"]');
ok(!(await page.$("#now-pick")), "сменили чип на «Аниме» – полосы с фильмом нет");
await page.click("#now-random");
await page.waitForSelector("#now-pick");
await page.click('#tab-now .tl-mode-btn[data-mode="current"]');
await page.waitForTimeout(200);
ok(!(await page.$("#now-pick")), "сменили статус – полосы нет");
await page.click('#tab-now .tl-mode-btn[data-mode="planning"]');
await page.waitForSelector("#tab-now .review-card-wrap");

console.log("Один тайтл под фильтром");
await page.click('#now-chips .now-chip[data-type="book"]');
ok(!(await page.isVisible("#now-random")), "у одной книги кнопки нет");
await page.click('#now-chips .now-chip[data-type="all"]');
await page.fill("#now-search", "аниме б");
ok(!(await page.isVisible("#now-random")), "поиск оставил один тайтл – кнопки нет");
await page.fill("#now-search", "");
ok(await page.isVisible("#now-random"), "сбросили поиск – кнопка вернулась");

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
