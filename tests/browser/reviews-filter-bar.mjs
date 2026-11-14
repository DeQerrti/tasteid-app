// Вкладка «Отзывы»: строка фильтров и «Архив» ушёл из «Статусов».
//
// Что проверяется (каждое – то, что без правки ломалось или не
// существовало):
//   – теги: «все выбранные» сужает список, «любой из них» расширяет
//     (раньше всегда работало как «любой»);
//   – тип можно выбрать несколько сразу;
//   – «Ссылки» строятся из настоящих источников, включая «Другое»
//     (раньше зашитый Teletype терял остальные);
//   – законченная запись без оценки и текста видна в «Отзывах» – в
//     «Статусах» «Архива» больше нет, и иначе она не показывалась бы нигде;
//   – старое сохранённое состояние фильтров (одно значение строкой)
//     переносится, а не пропадает;
//   – «/» открывает поиск и на русской раскладке (по физической клавише);
//   – заголовки годов и их исчезновение при сортировке по оценке.
//
// Запуск: node tests/browser/reviews-filter-bar.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

// Переменные самой страницы (app/js/reviews.js) – читаются только внутри
// page.evaluate, где они и правда есть.
/* global reviewModalBodyHtml, _reviewModalReview */
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-rvbar-"));
const base = { status: "completed", url: "", source: null };
const reviews = [
  {
    ...base,
    title: "Альфа",
    type: "anime",
    grade: "etalon",
    tags: ["Топ визуал", "Чистый кайф"],
    date_end: "2023-03-01",
    year: 2020,
    url: "https://teletype.in/a",
    source: "teletype",
  },
  {
    ...base,
    title: "Бета",
    type: "anime",
    grade: "attrakcion",
    tags: ["Топ визуал"],
    date_end: "2022-05-01",
    year: 2019,
    url: "https://youtu.be/b",
    source: "other",
  },
  {
    ...base,
    title: "Гамма",
    type: "manga",
    grade: "etalon",
    tags: ["Чистый кайф"],
    date_end: "2022-01-10",
    year: 2018,
  },
  // Законченная, но без оценки, текста и тегов.
  { ...base, title: "Дельта", type: "movie", date_end: "2021-07-01", year: 2017 },
  // Не завершена, но оценка есть – в «Отзывах» показывается.
  {
    ...base,
    title: "Эпсилон",
    type: "anime",
    status: "current",
    grade: "fon",
    date_start: "2024-02-01",
    year: 2024,
  },
  // Не завершена и без отзыва – в «Отзывах» нет.
  {
    ...base,
    title: "Зета",
    type: "anime",
    status: "current",
    date_start: "2024-03-01",
    year: 2024,
  },
];
writeFileSync(join(vaultDir, "reviews.json"), JSON.stringify(reviews));

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
const jsErrors = [];
const newPage = async (init) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  if (init) await page.addInitScript(init);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  return page;
};
const titles = (page) =>
  page.$$eval("#rv-grid .card-title", (els) => els.map((e) => e.textContent.trim()));
const openReviews = async (page) => {
  await page.click('.tab-btn[data-label="nav.reviews"]');
  await page.waitForSelector("#rv-grid .review-card-wrap", { timeout: 10000 });
};
const openDd = async (page, name) => {
  await page.click(`#tab-reviews .rv-dd[data-dd="${name}"] .rv-dd-btn`);
  await page.waitForSelector(`#tab-reviews .rv-dd[data-dd="${name}"] .rv-pop:not(.hidden)`);
};

const page = await newPage();

console.log("«Статусы» без «Архива», «Отзывы» с законченным без отзыва");
await page.click('.tab-btn[data-label="nav.now"]');
await page.waitForSelector("#tab-now .tl-mode-btn", { timeout: 10000 });
ok(
  !(await page.$('#tab-now .tl-mode-btn[data-mode="archive"]')),
  "в «Статусах» нет вкладки «Архив»"
);
await openReviews(page);
const all = await titles(page);
ok(all.length === 5, `в «Отзывах» пять записей (${all.join(", ")})`);
ok(all.includes("Дельта"), "законченная запись без оценки и текста видна");
ok(!all.includes("Зета"), "незавершённая без отзыва не показывается");

console.log("Годы и сортировка");
const years = await page.$$eval("#rv-grid .rv-year .year-label", (els) =>
  els.map((e) => e.textContent.trim())
);
ok(years.join(",") === "2024,2023,2022,2021", `годы идут от новых к старым (${years.join(",")})`);
ok(
  (await page.$eval("#tab-reviews .rv-sticky", (e) => getComputedStyle(e).position)) === "sticky",
  "строка фильтров закреплена"
);
await openDd(page, "sort");
await page.click('#tab-reviews .rv-pop [data-s="grade"]');
ok(!(await page.$("#rv-grid .rv-year")), "при сортировке по оценке заголовков годов нет");
ok((await titles(page))[0] === "Альфа" || (await titles(page))[0] === "Гамма", "сначала «Эталон»");
await page.click('#tab-reviews .rv-pop [data-s="date"]');
await page.keyboard.press("Escape");

console.log("Теги: «все выбранные» сужает, «любой из них» расширяет");
await openDd(page, "tags");
await page.click('#tab-reviews .rv-pop-tags .tag-toggle[data-tag="Топ визуал"]');
await page.click('#tab-reviews .rv-pop-tags .tag-toggle[data-tag="Чистый кайф"]');
let t = await titles(page);
ok(t.length === 1 && t[0] === "Альфа", `оба тега сразу – только «Альфа» (${t.join(", ")})`);
await page.click('#tab-reviews .rv-pop-tags [data-m="any"]');
t = await titles(page);
ok(t.length === 3, `«любой из них» – три записи (${t.join(", ")})`);
await page.click('#tab-reviews .rv-pop-tags [data-m="all"]');
await page.keyboard.press("Escape");
await page.click("#tab-reviews .rv-sub .rv-reset");
ok((await titles(page)).length === 5, "«Сбросить всё» возвращает все записи");

console.log("Несколько типов сразу");
await openDd(page, "types");
await page.click('#tab-reviews .rv-pop [data-v="anime"]');
await page.click('#tab-reviews .rv-pop [data-v="manga"]');
t = await titles(page);
ok(t.length === 4 && !t.includes("Дельта"), `аниме + манга – четыре записи (${t.join(", ")})`);
await page.keyboard.press("Escape");
await page.click("#tab-reviews .rv-sub .rv-reset");

console.log("Ссылки – из настоящих источников");
await openDd(page, "sources");
const srcLabels = await page.$$eval(
  "#tab-reviews .rv-dd[data-dd='sources'] .rv-opt > span:nth-child(2)",
  (els) => els.map((e) => e.textContent.trim())
);
ok(
  srcLabels.length === 2 && srcLabels.includes("Teletype") && srcLabels.includes("Другое"),
  `в списке Teletype и «Другое» (${srcLabels.join(", ")})`
);
await page.click('#tab-reviews .rv-pop [data-v="other"]');
t = await titles(page);
ok(t.length === 1 && t[0] === "Бета", `«Другое» – запись с YouTube (${t.join(", ")})`);
await page.keyboard.press("Escape");
await page.click("#tab-reviews .rv-sub .rv-reset");

console.log("Окно отзыва: листание, теги рядом с обложкой");
await page.click("#rv-grid .review-card-wrap >> nth=1");
await page.waitForSelector("#review-modal-overlay:not(.hidden) .review-nav-count");
const countText = () => page.$eval(".review-nav-count", (e) => e.textContent.trim());
ok((await countText()) === "2 / 5", "счётчик «2 / 5» по текущему списку");
const first = await page.$eval(".review-modal-title", (e) => e.textContent);
await page.keyboard.press("ArrowRight");
ok((await countText()) === "3 / 5", "→ листает вперёд");
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
ok((await countText()) === "1 / 5", "← листает назад");
ok(await page.$eval("#review-side-prev", (e) => e.disabled), "на первом отзыве «назад» недоступно");
await page.keyboard.press("ArrowRight");
ok(
  (await page.$eval(".review-modal-title", (e) => e.textContent)) === first,
  "и возвращается к тому же отзыву"
);
// Свайп: влево – следующий, вправо – предыдущий
const swipe = (from, to) =>
  page.evaluate(
    ([a, b]) => {
      const t = document.querySelector(".review-modal-title");
      const touch = (x) => new Touch({ identifier: 1, target: t, clientX: x, clientY: 300 });
      t.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [touch(a)],
          changedTouches: [touch(a)],
        })
      );
      t.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(b)] })
      );
    },
    [from, to]
  );
await swipe(300, 150);
ok((await countText()) === "3 / 5", "свайп влево – следующий");
await swipe(150, 300);
ok((await countText()) === "2 / 5", "свайп вправо – предыдущий");
// Перерисовка окна (так делает смена обложки в галерее) не теряет листание
await page.evaluate(
  () =>
    (document.getElementById("review-modal-body").innerHTML =
      reviewModalBodyHtml(_reviewModalReview))
);
ok((await countText()) === "2 / 5", "после перерисовки окна листание на месте");
ok(
  !!(await page.$(".review-modal-header > .review-modal-tags")) ||
    !!(await page.$(".review-modal-header .review-modal-main")),
  "шапка окна – сеткой"
);
ok(!(await page.$(".rm-cat")), "подписей категорий тегов нет");
await page.keyboard.press("Escape");
// Из «Статусов» соседнего списка нет – листания нет
await page.click('.tab-btn[data-label="nav.now"]');
await page.waitForSelector("#tab-now .tl-mode-btn");
await page.click("#tab-now .tl-mode-btn >> nth=0");
await page.waitForTimeout(300);
const card = await page.$("#tab-now .review-card-wrap");
if (card) {
  await card.click();
  await page.waitForSelector("#review-modal-overlay:not(.hidden)");
  ok(!(await page.$(".review-nav-count")), "из «Статусов» окно открывается без листания");
  await page.keyboard.press("Escape");
}
await openReviews(page);

console.log("«/» на русской раскладке");
await page.click("body", { position: { x: 5, y: 5 } });
await page.evaluate(() =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: ".", code: "Slash", bubbles: true }))
);
await page.waitForTimeout(150);
ok((await page.evaluate(() => document.activeElement?.id)) === "rv-search", "поле поиска в фокусе");
await page.fill("#rv-search", "дельт");
t = await titles(page);
ok(t.length === 1 && t[0] === "Дельта", "поиск по названию работает");
await page.close();

console.log("Старое сохранённое состояние фильтров переносится");
const old = await newPage(() => {
  localStorage.setItem(
    "tasteid-rv-filters",
    JSON.stringify({ type: "manga", grade: "all", source: "all", search: "", tags: [] })
  );
});
await openReviews(old);
t = await titles(old);
ok(t.length === 1 && t[0] === "Гамма", `старый фильтр «manga» остался (${t.join(", ")})`);
ok((await old.$$("#tab-reviews .rv-chip")).length === 1, "и виден чипом");
await old.close();

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nстрока фильтров «Отзывов» работает");
