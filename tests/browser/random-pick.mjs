// «Что посмотреть?» (js/now.js: nowOpenRandom): кнопка «Случайный» во
// вкладке «Статусы».
//
// Проверяется:
//   – кнопка есть, когда в статусе больше одного тайтла, и пропадает,
//     когда под фильтром остался один;
//   – выбор только из видимого: под чипом «Фильм» – только фильмы;
//   – открывается окно отзыва с кнопкой «Другой», и «Другой» не повторяет
//     тайтл подряд;
//   – обычный клик по карточке открывает окно БЕЗ «Другой».
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

const modalTitle = () => page.textContent("#review-modal-title");
const closeModal = async () => {
  await page.keyboard.press("Escape");
  await page.waitForSelector("#review-modal-overlay.hidden", { state: "attached" });
};

console.log("Кнопка");
ok(await page.isVisible("#now-random"), "«Случайный» видна (в «Планирую» 6 тайтлов)");

console.log("Выбор из всего статуса");
await page.click("#now-random");
await page.waitForSelector("#review-modal-overlay:not(.hidden)");
const firstPick = await modalTitle();
ok(
  reviews.some((r) => r.title === firstPick),
  `открылся отзыв из списка («${firstPick}»)`
);
ok(await page.isVisible(".review-reroll-btn"), "в окне есть «Другой»");
let prev = await modalTitle();
let repeats = 0;
for (let i = 0; i < 15; i++) {
  await page.click(".review-reroll-btn");
  const t = await modalTitle();
  if (t === prev) repeats++;
  prev = t;
}
ok(repeats === 0, "«Другой» ни разу не выдал тот же тайтл подряд");
await closeModal();

console.log("Только видимое: чип «Фильм»");
await page.click('#now-chips .now-chip[data-type="movie"]');
const seen = new Set();
await page.click("#now-random");
await page.waitForSelector("#review-modal-overlay:not(.hidden)");
seen.add(await modalTitle());
for (let i = 0; i < 10; i++) {
  await page.click(".review-reroll-btn");
  seen.add(await modalTitle());
}
ok(
  [...seen].every((t) => t.startsWith("Фильм")),
  `только фильмы: ${[...seen].join(", ")}`
);
ok(seen.size === 2, "и оба фильма попадаются");
await closeModal();

console.log("Один тайтл под фильтром");
await page.click('#now-chips .now-chip[data-type="book"]');
ok(!(await page.isVisible("#now-random")), "у одной книги кнопки нет");
await page.click('#now-chips .now-chip[data-type="all"]');
await page.fill("#now-search", "аниме б");
ok(!(await page.isVisible("#now-random")), "поиск оставил один тайтл – кнопки нет");
await page.fill("#now-search", "");
ok(await page.isVisible("#now-random"), "сбросили поиск – кнопка вернулась");

console.log("Обычный клик по карточке");
await page.click("#tab-now .review-card-wrap");
await page.waitForSelector("#review-modal-overlay:not(.hidden)");
ok(!(await page.$(".review-reroll-btn")), "окно с карточки – без «Другой»");
await closeModal();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
