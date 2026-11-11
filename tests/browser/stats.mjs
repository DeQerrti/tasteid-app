// Вкладка «Статистика»: новые блоки (вкус в трёх словах, как оцениваешь
// типы, что поднимает/роняет оценку, люди, персонажи), резиновая
// раскладка на разных ширинах, переключение лет, скрытие блоков в
// настройках и снимок картинкой.
//
// Запуск: node tests/browser/stats.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
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

// Данные: тег «Злодей» стоит только у лучших оценок, «Скука» – только у
// худших; аниме оценено щедрее манги.
const reviews = [];
let id = 1;
const add = (type, grade, tags, year, end) =>
  reviews.push({
    id: id++,
    title: `T${id}`,
    type,
    status: "completed",
    grade,
    tags,
    year: String(year),
    date_end: end,
  });
for (let i = 0; i < 5; i++)
  add("anime", "rezonans", ["Злодей", "Общий"], 2010 + i, `2025-0${i + 1}-10`);
for (let i = 0; i < 5; i++) add("manga", "brak", ["Скука", "Общий"], 1990 + i, `2026-0${i + 1}-10`);
for (let i = 0; i < 4; i++) add("movie", "attrakcion", ["Общий"], 1300 + i, `2026-0${i + 1}-12`);
reviews[0].favorite = true;
reviews[0].rewatch_count = 2;

function vault(settings) {
  const dir = mkdtempSync(join(tmpdir(), "tasteid-stats-"));
  writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
  writeFileSync(
    join(dir, "favorites.json"),
    JSON.stringify([
      { id: 1, type: "character", name: "Герой", from: "T2", linked_review_ids: [1] },
      { id: 2, type: "person", subtype: "director", name: "Режиссёр", linked_review_ids: [1, 2] },
    ])
  );
  writeFileSync(join(dir, "site-settings.json"), JSON.stringify(settings || {}));
  return dir;
}

async function serve(dir, port) {
  const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.on("exit", () => server.kill());
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
    server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
  });
  return server;
}

const port = 8300 + (process.pid % 90);
const server = await serve(vault(), port);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  acceptDownloads: true,
});
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

async function openStats(p, base) {
  await p.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await p.click('.tab-btn[aria-controls="tab-stats"]');
  await p.waitForSelector("#tab-stats .sx-hero");
}
const layout = (p) =>
  p.evaluate(() => {
    const out = [...document.querySelectorAll("#tab-stats *")].filter((e) => {
      const r = e.getBoundingClientRect();
      const box = e.closest(".sx-card, .sx-hero")?.getBoundingClientRect();
      return box && r.width > 0 && r.right > box.right + 1;
    });
    return { hscroll: document.documentElement.scrollWidth > innerWidth, sticksOut: out.length };
  });

console.log("Блоки за всё время");
await openStats(page, `http://127.0.0.1:${port}`);
const keys = await page.$$eval("#tab-stats [data-stat-key]", (els) =>
  els.map((e) => e.dataset.statKey)
);
for (const k of [
  "taste",
  "donut",
  "grades",
  "lift",
  "lift-down",
  "watch-bars",
  "release-bars",
  "tags",
  "people",
  "rewatch",
  "characters",
]) {
  ok(keys.includes(k), `блок ${k} на месте`);
}
ok(
  (await page.textContent(".sx-words")).startsWith("Злодей"),
  "первое из трёх слов – тег, который поднимает оценку"
);
ok(
  (await page.textContent('[data-stat-key="lift-down"]')).includes("Скука"),
  "«Скука» – в том, что роняет оценку"
);
const typeOrder = await page.$$eval(".sx-type-name", (els) => els.map((e) => e.textContent.trim()));
ok(
  typeOrder[0] === "Аниме" && typeOrder[typeOrder.length - 1] === "Манга",
  `типы от щедрого к строгому (${typeOrder})`
);
ok(
  (await page.textContent('[data-stat-key="release-bars"]')).includes("до 1950"),
  "годы выхода – десятилетиями, старое – одной строкой"
);
ok(
  (await page.textContent('[data-stat-key="people"]')).includes("Режиссёр"),
  "«Твои люди» – из «Любимого»"
);

console.log("Резиновая раскладка");
for (const [w, h] of [
  [375, 812],
  [768, 1024],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const l = await layout(page);
  ok(
    !l.hscroll && l.sticksOut === 0,
    `${w}px: без горизонтальной прокрутки и вылезаний (${l.sticksOut})`
  );
}
await page.setViewportSize({ width: 1920, height: 1080 });
const titleSizes = await page.$$eval(".sx-card .sx-h", (els) => [
  ...new Set(els.map((e) => getComputedStyle(e).fontSize)),
]);
ok(titleSizes.length === 1, `заголовки всех карточек одного размера (${titleSizes})`);

console.log("Год");
await page.click('[data-stat-year-bar="2026"]');
await page.waitForFunction(
  () => document.querySelector(".tl-filter.active")?.dataset.statYear === "2026"
);
ok(
  (await page.textContent(".sx-kicker")).includes("2026"),
  "клик по столбику года открывает его итоги"
);
ok((await page.textContent(".sx-total-big")).includes("+"), "у года есть сравнение с прошлым");

console.log("Снимок картинкой");
await page.click('.tl-filter[data-stat-year="all"]');
await page.waitForSelector('[data-stat-key="lift"]');
await page.click("#stats-export-btn");
await page.waitForSelector("#stats-export-options label");
const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
await page.click('#stats-export-overlay [data-act="ok"]');
const download = await downloadPromise;
ok(
  download.suggestedFilename() === "stats-all-time.png",
  `картинка сохраняется (${download.suggestedFilename()})`
);

console.log("Скрытые в настройках блоки");
const port2 = port + 1;
const server2 = await serve(vault({ hiddenStatsBlocks: ["taste", "lift", "people"] }), port2);
await page.goto(`http://127.0.0.1:${port2}/`, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[aria-controls="tab-stats"]');
await page.waitForSelector("#tab-stats .sx");
const keys2 = await page.$$eval("#tab-stats [data-stat-key]", (els) =>
  els.map((e) => e.dataset.statKey)
);
ok(
  !keys2.includes("taste") && keys2.includes("counters"),
  "без «вкуса» шапка показывает только числа"
);
ok(
  !keys2.includes("lift") && !keys2.includes("lift-down") && !keys2.includes("people"),
  "скрытые блоки не показываются"
);
const lone = await page.$$eval("#tab-stats .sx-card.sx-solo", (els) =>
  els.map((e) => e.dataset.statKey)
);
ok(
  lone.length === 1 && lone[0] === "characters",
  `оставшийся без пары блок растянут на всю ширину (${lone})`
);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
server2.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
