// Экран импорта: источники карточками по видам. Открыта одна карточка за
// раз, внутри – пошаговая инструкция и свои поля; «в планах» – без кнопки;
// ключ TMDB живёт в своей карточке; файл из карточки доходит до экрана
// соответствий. На ширине телефона карточки в одну колонку и без
// горизонтальной прокрутки.
//
// Запуск: node tests/browser/import-screen.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-impscreen-"));
writeFileSync(join(vaultDir, "reviews.json"), "[]");

const port = 8100 + ((process.pid + 61) % 90);
const base = `http://127.0.0.1:${port}`;
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

await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.click('[data-panel="import"]');
await page.waitForSelector(".imp-card");

console.log("Карточки");
const groups = await page.locator(".imp-group").allTextContents();
ok(
  ["Аниме и манга", "Фильмы и сериалы", "Книги", "Игры", "Любое другое приложение"].every((g) =>
    groups.includes(g)
  ),
  `разделы по видам (${groups.join(", ")})`
);
ok((await page.locator(".imp-card-body").count()) === 0, "сначала все карточки свёрнуты");
ok(
  (await page.locator(".imp-card.is-planned [data-imp-open]").count()) === 0,
  "у карточек «в планах» нет кнопки"
);

console.log("Инструкции внутри");
const actionable = await page
  .locator("[data-imp-open]")
  .evaluateAll((els) => els.map((e) => e.dataset.impOpen));
for (const id of actionable) {
  await page.click(`[data-imp-open="${id}"]`);
  const card = page.locator(`[data-imp-card="${id}"]`);
  const steps = await card.locator(".imp-steps li").count();
  ok(steps >= 3, `${id}: пошаговая инструкция (${steps} шагов)`);
  ok((await page.locator(".imp-card-body").count()) === 1, `${id}: открыта только эта карточка`);
}
await page.click('[data-imp-open="mal"]');
ok(await page.locator("#imp-mal-user").isVisible(), "у ника – своё поле");
ok(
  await page.evaluate(() => document.activeElement?.id === "imp-mal-user"),
  "поле ника сразу в фокусе"
);
await page.click('[data-imp-open="mal"]');
ok((await page.locator(".imp-card-body").count()) === 0, "повторное нажатие сворачивает");

await page.click('[data-imp-open="tmdb"]');
ok(await page.locator("#imp-tmdb-key").isVisible(), "поле ключа TMDB – в его карточке");

console.log("Файл из карточки");
await page.click('[data-imp-open="goodreads"]');
await page.setInputFiles("#imp-file", {
  name: "goodreads_library_export.csv",
  mimeType: "text/csv",
  buffer: Buffer.from(
    "Book Id,Title,Author,My Rating,Exclusive Shelf\n1,Some Book,Someone,4,read\n"
  ),
});
await page.waitForSelector("#imp-run", { timeout: 15000 });
ok(
  (await page.textContent(".imp-source-line")).includes("Goodreads"),
  "файл узнан и дошёл до экрана соответствий"
);
await page.click("#imp-cancel");
await page.waitForSelector(".imp-card");

console.log("Телефон");
// На телефоне настройки начинаются со списка разделов – открываем заново.
const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
phone.on("pageerror", (e) => jsErrors.push(e.message));
await phone.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await phone.click('[data-panel="import"]');
await phone.click('[data-imp-open="shiki"]');
const layout = await phone.evaluate(() => {
  const cards = [...document.querySelectorAll(".imp-cards-grid")[0].children].map((c) =>
    c.getBoundingClientRect()
  );
  return {
    oneColumn: cards.every((r) => Math.abs(r.left - cards[0].left) < 2),
    noScroll: document.documentElement.scrollWidth <= window.innerWidth,
  };
});
ok(layout.oneColumn, "карточки в одну колонку");
ok(layout.noScroll, "нет горизонтальной прокрутки");

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
