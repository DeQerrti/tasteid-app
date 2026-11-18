// «Цели» (js/goals.js): окно из «Статистики» – по макету, одобренному
// owner'ом в ноябре 2026.
//
// Проверяется:
//   – кнопка «Цели» есть рядом с «Итогами» и открывает окно;
//   – без целей – подсказка с цифрами прошлого года и «Поставить цель»;
//   – цель добавляется и пишется в site-settings.json (goals);
//   – считается тем же «закончено в году», что и статистика;
//   – подробно про цель: сколько из скольких, обложки законченного;
//   – обложка открывает отзыв ПОВЕРХ окна, Esc закрывает только отзыв;
//   – число меняется и цель убирается через «Изменить»;
//   – годы в «Статистике» – одной строкой, без переноса.
//
// Запуск: node tests/browser/goals.mjs

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

const Y = new Date().getFullYear();
const reviews = [
  {
    id: 1,
    title: "Аниме 1",
    type: "anime",
    status: "completed",
    grade: "etalon",
    date_end: `${Y}-02-10`,
  },
  {
    id: 2,
    title: "Аниме 2",
    type: "anime",
    status: "completed",
    grade: "etalon",
    date_end: `${Y}-03-05`,
  },
  {
    id: 3,
    title: "Фильм 1",
    type: "movie",
    status: "completed",
    grade: "brak",
    date_end: `${Y}-01-20`,
  },
  { id: 4, title: "В процессе", type: "anime", status: "current", date_start: `${Y}-01-01` },
  {
    id: 5,
    title: "Книга прошлого года",
    type: "book",
    status: "completed",
    grade: "etalon",
    date_end: `${Y - 1}-05-01`,
  },
];
// Много лет – проверить, что строка годов не переносится.
for (let y = Y - 30; y < Y - 1; y++)
  reviews.push({
    id: 100 + y,
    title: `Старый ${y}`,
    type: "movie",
    status: "completed",
    grade: "etalon",
    date_end: `${y}-06-01`,
  });

const dir = mkdtempSync(join(tmpdir(), "tasteid-goals-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({ tagSet: "author" }));
const settings = () => JSON.parse(readFileSync(join(dir, "site-settings.json"), "utf8"));

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
await page.click('.tab-btn[aria-controls="tab-stats"]');
await page.waitForSelector("#tab-stats .stat-goals-btn", { timeout: 15000 });

console.log("Строка годов");
const row = await page.$eval("#tab-stats .stat-year-filters", (el) => ({
  h: el.getBoundingClientRect().height,
  btn: el.querySelector(".tl-filter").getBoundingClientRect().height,
  scrolls: el.scrollWidth > el.clientWidth,
}));
ok(
  row.h < row.btn * 1.6,
  `годы одной строкой (${Math.round(row.h)}px при кнопке ${Math.round(row.btn)}px)`
);
ok(row.scrolls, "лишние годы уходят в прокрутку");
const order = await page.$$eval("#tab-stats .stat-toolbar > *", (els) =>
  els.map((e) => e.className)
);
ok(
  order.findIndex((c) => c.includes("stat-goals-btn")) ===
    order.findIndex((c) => c.includes("stat-recap-btn")) - 1,
  "«Цели» – сразу перед «Итогами»"
);

console.log("Без целей");
await page.click(".stat-goals-btn");
await page.waitForSelector("#goals-overlay:not(.hidden) .gl-card");
const empty = await page.textContent("#goals-body .gl-empty");
ok(empty.includes(`в ${Y - 1} вы закончили`), "подсказка с цифрами прошлого года");
ok(!!(await page.$("[data-gl-add]")), "есть «Поставить цель»");

console.log("Добавить цель");
await page.click("[data-gl-add]");
await page.selectOption("[data-gl-new-type]", "anime");
await page.fill("[data-gl-new-n]", "5");
await page.click("[data-gl-add-ok]");
await page.waitForSelector(".gl-row");
ok(
  JSON.stringify(settings().goals) === JSON.stringify({ [Y]: [{ type: "anime", n: 5 }] }),
  "цель записана в настройки: " + JSON.stringify(settings().goals)
);
ok(settings().tagSet === "author", "остальные настройки не задеты");
const rowText = (await page.textContent(".gl-row")).replace(/\s+/g, " ");
ok(/Аниме.*2 \/ 5/.test(rowText), `закончено 2 аниме из 5 (${rowText.trim()})`);

await page.click("[data-gl-add]");
await page.selectOption("[data-gl-new-type]", "all");
await page.fill("[data-gl-new-n]", "10");
await page.click("[data-gl-add-ok]");
await page.waitForFunction(() => document.querySelectorAll(".gl-row").length === 2);
const first = (await page.textContent(".gl-row")).replace(/\s+/g, " ");
ok(/Всё вместе.*3 \/ 10/.test(first), `«Всё вместе» первой строкой, 3 из 10 (${first.trim()})`);

console.log("Подробно");
await page.click(".gl-row:nth-child(2) [data-gl-open]");
await page.waitForSelector(".gl-big");
ok(/^2\s*из 5$/.test((await page.textContent(".gl-big")).trim()), "2 из 5");
ok((await page.textContent(".gl-pace")).includes("осталось 3"), "до цели осталось 3");
ok((await page.$$(".gl-cover")).length === 2, "две обложки законченного");
ok(!(await page.$(".gl-bar em")), "черты «по графику» нет");

await page.click(".gl-cover");
await page.waitForSelector(".review-modal-overlay:not(.hidden)");
const topEl = await page.evaluate(
  () =>
    document
      .elementFromPoint(innerWidth / 2, innerHeight / 2)
      ?.closest(".review-modal-overlay, #goals-overlay")?.id
);
ok(topEl === "review-modal-overlay", `отзыв открылся поверх окна целей (${topEl})`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok(!(await page.$(".review-modal-overlay:not(.hidden)")), "Esc закрыл отзыв");
ok(await page.isVisible("#goals-overlay"), "а окно целей осталось");

console.log("Изменить и убрать");
await page.click("[data-gl-back]");
await page.click("[data-gl-edit]");
await page.fill('[data-gl-n="1"]', "7");
await page.click("[data-gl-edit]");
await page.waitForFunction(() => !document.querySelector("[data-gl-n]"));
ok(settings().goals[Y].find((g) => g.type === "anime")?.n === 7, "число цели поменялось на 7");
await page.click("[data-gl-edit]");
await page.click('[data-gl-del="0"]');
await page.waitForFunction(() => document.querySelectorAll(".gl-row").length === 1);
ok(
  JSON.stringify(settings().goals[Y]) === JSON.stringify([{ type: "anime", n: 7 }]),
  "«Всё вместе» убрана"
);

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok(!(await page.isVisible("#goals-overlay")), "Esc закрывает окно целей");

ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));
await browser.close();
server.kill();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nцели работают");
process.exit(0);
