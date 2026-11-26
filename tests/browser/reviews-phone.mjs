// «Отзывы» и редактор отзыва на телефоне (owner, ноябрь 2026, по макету).
//
// Проверяется:
//   – верх вкладки – одной строкой: счётчик, лупа, сортировка, «Фильтры»,
//     «+»; поля поиска и кнопок отдельных фильтров не видно;
//   – лупа раскрывает поиск, поиск фильтрует, пустое поле без фокуса –
//     снова лупа;
//   – «Фильтры» – шторка «Тип / Оценка / Теги / Ссылки»; строка открывает
//     список шторкой у нижнего края; выбор – число на «Фильтрах» и капсула
//     под строкой; касание мимо закрывает список;
//   – редактор: поиск тайтла выше обложки, нижней «Сохранить отзыв» нет,
//     в шапке – «Сохранить»; категории тегов свёрнуты, раскрываются
//     нажатием, с выбранным тегом остаются раскрытыми;
//   – на компьютере всё как раньше.
//
// Запуск: node tests/browser/reviews-phone.mjs

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
  {
    id: 1,
    title: "Аниме А",
    type: "anime",
    status: "completed",
    year: "2020",
    date_end: "2026-01-02",
    review_full: "Текст",
  },
  {
    id: 2,
    title: "Аниме Б",
    type: "anime",
    status: "completed",
    year: "2021",
    date_end: "2026-02-02",
    review_full: "Текст",
  },
  {
    id: 3,
    title: "Фильм А",
    type: "movie",
    status: "completed",
    year: "2001",
    date_end: "2026-03-02",
    review_full: "Текст",
  },
  {
    id: 4,
    title: "Книга А",
    type: "book",
    status: "completed",
    year: "1999",
    date_end: "2025-03-02",
    review_full: "Текст",
  },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-rv-phone-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));

const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const jsErrors = [];
async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[aria-controls="tab-reviews"]');
  await page.waitForSelector("#rv-grid .review-card-wrap", { timeout: 15000 });
  return page;
}
const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const shown = (page) => page.$$eval("#rv-grid .review-card-wrap", (els) => els.length);

console.log("Телефон: строка");
const phone = await open(
  { width: 390, height: 844 },
  { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
);
const parts = [
  "#rv-count",
  "#rv-search-btn",
  '.rv-dd[data-dd="sort"] .rv-dd-btn',
  "#rv-filters-btn",
  ".rv-bar .rv-add",
];
const boxes = await Promise.all(parts.map((s) => box(phone, s)));
const mid = (b) => b.top + b.height / 2;
ok(
  boxes.every((b) => Math.abs(mid(b) - mid(boxes[0])) < 4),
  "счётчик и четыре кнопки – одной строкой"
);
ok(
  boxes.every((b) => b.right <= 390 && b.width > 0),
  "всё помещается в экран"
);
ok(
  boxes.slice(1).every((b) => b.width >= 40 && b.height >= 40),
  "кнопки не мельче 40px"
);
ok((await phone.textContent("#rv-count")).includes("4"), "в строке – число отзывов");
ok(!(await phone.isVisible("#rv-search")), "поле поиска свёрнуто");
ok(
  !(await phone.isVisible('.rv-dd[data-dd="types"] .rv-dd-btn')),
  "кнопок отдельных фильтров в строке нет"
);

console.log("Поиск");
await phone.click("#rv-search-btn");
ok(await phone.isVisible("#rv-search"), "лупа раскрыла поле");
ok(!(await phone.isVisible("#rv-count")), "счётчик на время поиска спрятан");
await phone.keyboard.type("фильм");
await phone.waitForTimeout(400);
ok((await shown(phone)) === 1, "поиск фильтрует");
await phone.fill("#rv-search", "");
await phone.waitForTimeout(400);
await phone.$eval("#rv-search", (el) => el.blur());
ok(
  !(await phone.isVisible("#rv-search")) && (await phone.isVisible("#rv-count")),
  "пустое поле без фокуса – снова счётчик и лупа"
);

console.log("Фильтры");
await phone.click("#rv-filters-btn");
const rows = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(rows.join("|") === "Тип|Оценка|Теги|Ссылки", `шторка: ${rows.join(", ")}`);
await phone.click('.action-sheet-item:has-text("Тип")');
await phone.waitForSelector('.rv-dd[data-dd="types"] .rv-pop:not(.hidden)');
const pop = await box(phone, '.rv-dd[data-dd="types"] .rv-pop');
ok(
  Math.abs(pop.bottom - 844) < 2 && pop.left <= 1 && pop.right >= 389,
  "список «Тип» – шторкой у нижнего края во всю ширину"
);
await phone.click('.rv-dd[data-dd="types"] .rv-opt[data-v="anime"]');
await phone.waitForTimeout(250);
ok((await shown(phone)) === 2, "выбор типа фильтрует");
ok(
  (await phone.textContent("#rv-filters-btn .rv-filters-n")) === "1",
  "на «Фильтрах» – число выбранного"
);
await phone.mouse.click(195, 30);
await phone.waitForTimeout(250);
ok(!(await phone.$(".rv-pop:not(.hidden)")), "касание мимо закрывает список");
ok(await phone.isVisible("#rv-sub .rv-chip"), "под строкой – капсула выбранного фильтра");
await phone.click("#rv-sub .rv-chip");
await phone.waitForTimeout(250);
ok(
  (await shown(phone)) === 4 && !(await phone.isVisible("#rv-sub")),
  "капсула снимает фильтр, пустой ряд под строкой исчезает"
);

console.log("Редактор");
await phone.goto(`${base}/#/add?edit=1`);
await phone.waitForSelector("#tags-grid .ed-cat");
await phone.waitForTimeout(300);
const lookup = await box(phone, "#ed-lookup");
const side = await box(phone, ".ed-side");
ok(lookup.top < side.top, "поиск тайтла – выше обложки");
ok(!(await phone.isVisible("#btn-save-bottom")), "нижней «Сохранить отзыв» нет");
ok((await phone.textContent("#btn-save")).trim() === "Сохранить", "в шапке – «Сохранить»");
const tagsShut = await phone.$$eval("#tags-grid .ed-cat", (cats) =>
  cats.every((c) => c.classList.contains("ed-cat-shut"))
);
ok(tagsShut, "категории тегов свёрнуты");
ok(!(await phone.isVisible("#tags-grid .ed-cat .tag-toggle")), "теги внутри свёрнутых не видны");
await phone.click("#tags-grid .ed-cat:first-child .ed-cat-name");
ok(
  await phone.isVisible("#tags-grid .ed-cat:first-child .tag-toggle"),
  "нажатие раскрывает категорию"
);
await phone.click("#tags-grid .ed-cat:first-child .tag-toggle");
await phone.waitForTimeout(200);
ok(
  !(await phone.$eval("#tags-grid .ed-cat:first-child", (c) =>
    c.classList.contains("ed-cat-shut")
  )),
  "с выбранным тегом категория раскрыта"
);
await phone.close();

console.log("Компьютер");
const desk = await open({ width: 1300, height: 900 });
ok(await desk.isVisible("#rv-search"), "поле поиска видно");
ok(await desk.isVisible('.rv-dd[data-dd="types"] .rv-dd-btn'), "кнопки фильтров видны");
ok(
  !(await desk.isVisible("#rv-filters-btn")) && !(await desk.isVisible("#rv-count")),
  "значков и счётчика в строке нет"
);
ok(await desk.isVisible("#rv-sort-label"), "у сортировки – подпись");
await desk.goto(`${base}/#/add?edit=1`);
await desk.waitForSelector("#tags-grid .ed-cat");
ok(!(await desk.isVisible("#btn-save-bottom")), "нижней «Сохранить» нет – только в шапке");
// Шапка липкая и в окне Electron прилипает под полосой кнопок окна
// (--app-titlebar из electron/chrome.js), а не уезжает под неё.
await desk.addStyleTag({ content: ":root { --app-titlebar: 32px; } body { padding-top: 32px; }" });
await desk.mouse.wheel(0, 1500);
await desk.waitForTimeout(300);
const barTop = (await box(desk, ".ed-bar")).top;
ok(
  (await desk.evaluate(() => scrollY)) > 0 && Math.abs(barTop - 32) < 1,
  `после прокрутки шапка под полосой окна (top=${barTop})`
);
ok(await desk.isVisible("#tags-grid .ed-cat .tag-toggle"), "категории тегов раскрыты");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
