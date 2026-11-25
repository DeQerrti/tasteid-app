// «Статусы» на телефоне: два ряда кнопок вместо трёх (js/now.js:
// nowToolsHtml, bindNowTools; стили – index.html, «СТАТУСЫ НА ТЕЛЕФОНЕ»).
//
// Проверяется:
//   – на телефоне поиск, сортировка и кубик – значки в одной строке с
//     чипами типов, поле поиска спрятано;
//   – лупа раскрывает поле на месте чипов, поиск фильтрует; поле пустое
//     и ушёл фокус – снова лупа; с текстом – остаётся открытым;
//   – сортировка – настоящий <select> поверх значка, не та, что по
//     умолчанию, – значок подсвечен;
//   – выбран тип – подписи типа на обложках спрятаны, «Все» – видны;
//   – год на карточке целиком (не «202…»), у даты нет «с»;
//   – в классической теме статусы – вкладками с чертой под выбранной
//     (много статусов – см. fav-phone.mjs);
//   – на компьютере всё как было: значков нет, поле поиска видно, «с» есть.
//
// Запуск: node tests/browser/now-phone-tools.mjs

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
    title: "Очень длинное название манги",
    type: "manga",
    status: "current",
    year: "2026",
    date_start: "2026-08-30",
  },
  {
    id: 2,
    title: "Аниме Б",
    type: "anime",
    status: "current",
    year: "2024",
    date_start: "2025-08-30",
  },
  {
    id: 3,
    title: "Аниме В",
    type: "anime",
    status: "current",
    year: "2019",
    date_start: "2026-01-02",
  },
  {
    id: 4,
    title: "Фильм А",
    type: "movie",
    status: "current",
    year: "2001",
    date_start: "2026-03-04",
  },
  { id: 5, title: "Книга А", type: "book", status: "planning" },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-now-phone-"));
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
const jsErrors = [];

async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[aria-controls="tab-now"]');
  await page.click('#tab-now .tl-mode-btn[data-mode="current"]');
  await page.waitForSelector("#tab-now .review-card-wrap", { timeout: 15000 });
  await page.waitForTimeout(300);
  return page;
}
const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const visibleTags = (page) =>
  page.$$eval(
    "#tab-now .review-card-wrap:not(.now-hidden) .type-tag",
    (els) => els.filter((el) => getComputedStyle(el).display !== "none").length
  );

console.log("Телефон");
const phone = await open(
  { width: 390, height: 844 },
  { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
);

ok(!(await phone.isVisible("#now-search")), "поле поиска свёрнуто");
ok(await phone.isVisible("#now-search-btn"), "лупа видна");
const chips = await box(phone, "#now-chips");
const lupa = await box(phone, "#now-search-btn");
const sortWrap = await box(phone, ".now-sort-wrap");
const dice = await box(phone, "#now-random");
const sameRow = (a, b) => Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 4;
ok(
  sameRow(chips, lupa) && sameRow(chips, sortWrap) && sameRow(chips, dice),
  "чипы, лупа, сортировка и кубик – одной строкой"
);
ok(lupa.right <= 390 && dice.right <= 390, "значки не уходят за край экрана");

const underline = await phone.$eval(
  "#tab-now .tl-mode-btn.active",
  (b) => getComputedStyle(b).boxShadow
);
ok(/inset/.test(underline), "выбранный статус – с чертой снизу (классическая тема)");

console.log("Поиск");
await phone.click("#now-search-btn");
ok(await phone.isVisible("#now-search"), "лупа раскрыла поле");
ok(
  (await phone.evaluate(() => document.activeElement?.id)) === "now-search",
  "курсор сразу в поле"
);
ok(!(await phone.isVisible("#now-chips")), "чипы на время поиска убраны");
await phone.keyboard.type("аниме");
ok((await phone.$$("#tab-now .review-card-wrap:not(.now-hidden)")).length === 2, "поиск фильтрует");
await phone.evaluate(() => document.activeElement?.blur());
ok(await phone.isVisible("#now-search"), "с текстом поле не сворачивается");
await phone.fill("#now-search", "");
await phone.evaluate(() => document.getElementById("now-search").blur());
ok(
  !(await phone.isVisible("#now-search")) && (await phone.isVisible("#now-chips")),
  "пустое поле без фокуса – снова лупа и чипы"
);

console.log("Сортировка");
ok(
  !(await phone.$eval(".now-sort-wrap", (el) => el.classList.contains("now-sort-on"))),
  "по умолчанию значок не подсвечен"
);
await phone.selectOption("#now-sort", "title");
await phone.waitForTimeout(200);
ok(
  await phone.$eval(".now-sort-wrap", (el) => el.classList.contains("now-sort-on")),
  "другая сортировка – значок подсвечен"
);
const firstTitle = await phone.$eval("#tab-now .review-card-wrap", (el) =>
  el.getAttribute("aria-label")
);
ok(firstTitle === "Аниме Б", "сортировка по названию работает");
await phone.selectOption("#now-sort", "date");

console.log("Подпись типа");
ok((await visibleTags(phone)) === 4, "при «Все» подписи типа видны");
await phone.click('#now-chips .now-chip[data-type="anime"]');
ok((await visibleTags(phone)) === 0, "выбран тип – подписи спрятаны");
await phone.click('#now-chips .now-chip[data-type="all"]');
ok((await visibleTags(phone)) === 4, "снова «Все» – подписи вернулись");

console.log("Год и дата");
const meta = await phone.$eval('.review-card-wrap[data-review-id="1"] .card-meta-now', (el) => {
  const main = el.querySelector(".card-meta-main");
  return {
    yearCut: main.scrollWidth > main.clientWidth + 1,
    text: el.innerText.replace(/\s+/g, " ").trim(),
  };
});
ok(!meta.yearCut, "год не обрезан");
ok(meta.text === "2026 30.08", `год и дата без «с» (${meta.text})`);
await phone.close();

console.log("Компьютер");
const desk = await open({ width: 1200, height: 900 });
ok(await desk.isVisible("#now-search"), "поле поиска видно");
ok(!(await desk.isVisible("#now-search-btn")), "лупы нет");
ok(await desk.isVisible("#now-sort"), "сортировка – обычный список");
ok(!(await desk.isVisible(".now-sort-wrap .now-tool-icon")), "значка сортировки нет");
const deskDate = await desk.$eval('.review-card-wrap[data-review-id="1"] .card-meta-date', (el) =>
  el.innerText.trim()
);
ok(deskDate === "с 30.08", `дата с «с» (${deskDate})`);
await desk.click('#now-chips .now-chip[data-type="anime"]');
ok((await visibleTags(desk)) === 2, "подписи типа на компьютере не прячутся");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
