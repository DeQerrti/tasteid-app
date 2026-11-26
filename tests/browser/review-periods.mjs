// Несколько отрезков дат у одного отзыва (owner, ноябрь 2026): посмотрел
// 7 дней, бросил, досмотрел ещё за 7 – это 14 дней, а не полтора года.
//
// Проверяется:
//   – окно отзыва: первый день → последний, дни – сумма отрезков,
//     «2 захода» раскрывает сами отрезки (вариант «А» по макету);
//   – редактор: отрезки из файла видны строками, итог «Всего N дней»;
//     третий отрезок добавляется и сохраняется, date_start/date_end –
//     первое начало и последний конец;
//   – пересекающиеся отрезки не сохраняются;
//   – убрать отрезки до одного – periods в файле пропадает;
//   – «В процессе»: новый отрезок начинается сегодня, конец прошлого
//     вписывается руками, у последнего конца в файле нет;
//   – отзыв с одним отрезком – редактор как раньше («Начато»/«Завершено»);
//   – телефон: строки отрезков помещаются в экран.
//
// Запуск: node tests/browser/review-periods.mjs

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
    title: "С перерывом",
    type: "anime",
    status: "completed",
    year: "2024",
    date_start: "2025-03-27",
    date_end: "2026-10-07",
    periods: [
      { start: "2025-03-27", end: "2025-04-02" },
      { start: "2026-10-01", end: "2026-10-07" },
    ],
    review_full: "Текст",
  },
  {
    id: 2,
    title: "Без перерыва",
    type: "movie",
    status: "completed",
    year: "2020",
    date_start: "2026-01-02",
    date_end: "2026-01-05",
    review_full: "Текст",
  },
  {
    id: 3,
    title: "Смотрю сейчас",
    type: "anime",
    status: "current",
    year: "2023",
    date_start: "2026-01-10",
  },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-periods-"));
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
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 20000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const readReview = async (id) =>
  (await (await fetch(`${base}/reviews.json?_=${Date.now()}`)).json()).find((r) => r.id === id);

const browser = await chromium.launch();
const jsErrors = [];
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
page.on("pageerror", (e) => jsErrors.push(e.message));

async function openEditor(id) {
  await page.goto(`${base}/#/add?edit=${id}`);
  await page.waitForFunction(
    () => document.getElementById("edit-banner")?.style.display === "flex"
  );
}
async function save() {
  await page.click("#btn-save");
  await page.waitForFunction(() =>
    /ok|err/.test(document.getElementById("status")?.className || "")
  );
  return page.$eval("#status", (el) => ({ ok: el.classList.contains("ok"), text: el.textContent }));
}

console.log("Окно отзыва");
await page.goto(`${base}/#/`);
await page.click('.tab-btn[aria-controls="tab-reviews"]');
await page.waitForSelector("#rv-grid .review-card-wrap");
await page.click('#rv-grid .review-card-wrap:has-text("С перерывом")');
await page.waitForSelector("#review-modal-body .review-dates");
const line = await page.textContent("#review-modal-body .review-dates");
ok(line.includes("27 марта 2025") && line.includes("7 октября 2026"), "первый день → последний");
ok(
  line.includes("14 дней") && !line.includes("560"),
  `дни – сумма отрезков (${line.replace(/\s+/g, " ")})`
);
ok(!(await page.isVisible(".review-periods")), "отрезки свёрнуты");
await page.click(".review-periods-btn");
ok(
  (await page.$$eval(".review-periods .review-period", (els) => els.length)) === 2 &&
    (await page.isVisible(".review-periods")),
  "«2 захода» раскрывает два отрезка"
);
await page.keyboard.press("Escape");

console.log("Редактор: отрезки из файла");
await openEditor(1);
ok((await page.$$eval(".ed-period-many", (els) => els.length)) === 2, "две строки отрезков");
ok((await page.textContent(".ed-period-sum")).includes("14 дней"), "итог – 14 дней");
ok(
  (await page.textContent(".ed-period-sum")).includes("560"),
  "рядом – сколько от первого дня до последнего"
);

console.log("Редактор: третий отрезок");
await page.click(".ed-period-add");
ok((await page.$$eval(".ed-period-many", (els) => els.length)) === 3, "добавилась третья строка");
ok(
  await page.$eval(
    '.ed-period[data-i="2"] input[data-k="start"]',
    (el) => el === document.activeElement
  ),
  "фокус – в начале нового отрезка"
);
await page.fill('.ed-period[data-i="2"] input[data-k="start"]', "2026-11-01");
await page.fill('.ed-period[data-i="2"] input[data-k="end"]', "2026-11-03");
ok((await page.textContent(".ed-period-sum")).includes("17 дней"), "итог пересчитался – 17 дней");
let res = await save();
ok(res.ok, "сохранено");
let r = await readReview(1);
ok(r.periods?.length === 3, "в файле три отрезка");
ok(
  r.date_start === "2025-03-27" && r.date_end === "2026-11-03",
  "date_start/date_end – края отрезков"
);

console.log("Пересечение не сохраняется");
await page.fill('.ed-period[data-i="2"] input[data-k="start"]', "2026-10-05");
res = await save();
ok(!res.ok && res.text.includes("3"), `ошибка про отрезок 3 (${res.text})`);
ok((await readReview(1)).periods[2].start === "2026-11-01", "файл не изменился");

console.log("Убрать отрезки до одного");
await page.click('.ed-period[data-i="2"] .ed-period-del');
await page.click('.ed-period[data-i="1"] .ed-period-del');
ok(!(await page.$(".ed-period-many")), "одна строка – прежний вид");
ok(
  (await page.inputValue("#f-date-start")) === "2025-03-27" &&
    (await page.inputValue("#f-date-end")) === "2025-04-02",
  "в полях – оставшийся отрезок"
);
res = await save();
r = await readReview(1);
ok(res.ok && !r.periods && r.date_end === "2025-04-02", "в файле periods нет, даты – оставшиеся");

console.log("В процессе");
await openEditor(3);
ok(!(await page.$("#f-date-end")), "у одного отрезка – только «Начато»");
await page.click(".ed-period-add");
ok(
  await page.$eval(
    '.ed-period[data-i="0"] input[data-k="end"]',
    (el) => el === document.activeElement
  ),
  "фокус – в конце прошлого отрезка"
);
const today = await page.evaluate("todayLocalISO()");
ok(
  (await page.inputValue('.ed-period[data-i="1"] input[data-k="start"]')) === today,
  "новый отрезок начинается сегодня"
);
ok(
  (await page.textContent('.ed-period[data-i="1"]')).includes("идёт сейчас"),
  "у последнего – «идёт сейчас»"
);
await page.fill('.ed-period[data-i="0"] input[data-k="end"]', "2026-01-15");
res = await save();
r = await readReview(3);
ok(
  res.ok &&
    r.periods?.length === 2 &&
    r.periods[1].end === null &&
    r.date_start === "2026-01-10" &&
    !r.date_end,
  "сохранено: у последнего отрезка и у записи конца нет"
);

console.log("Один отрезок – как раньше");
await openEditor(2);
ok(!(await page.$(".ed-period-many")), "строк отрезков нет");
ok(
  (await page.inputValue("#f-date-start")) === "2026-01-02" &&
    (await page.inputValue("#f-date-end")) === "2026-01-05",
  "«Начато»/«Завершено» из файла"
);
res = await save();
r = await readReview(2);
ok(res.ok && r.periods === null && r.date_end === "2026-01-05", "сохранение не тронуло даты");

console.log("Телефон");
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
phone.on("pageerror", (e) => jsErrors.push(e.message));
await phone.goto(`${base}/#/add?edit=3`);
await phone.waitForSelector(".ed-period-many");
const right = await phone.$$eval(".ed-period-many", (rows) =>
  Math.max(...rows.map((row) => row.getBoundingClientRect().right))
);
ok(right <= 390, `строки отрезков помещаются в экран (${Math.round(right)}px)`);
await phone.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
