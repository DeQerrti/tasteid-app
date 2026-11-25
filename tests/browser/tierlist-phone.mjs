// «Тир-лист» и его редактор на телефоне (owner, ноябрь 2026, по макету).
//
// Проверяется:
//   – тир-листы и «⋯» – одной строкой; «Новый тир-лист», «Редактор»,
//     «Подписи», камеры в строках не видно;
//   – у «Персонажей» размер – значком ⇕ в той же строке, ползунок
//     показывает число и меняет высоту; после смены игры значок на месте;
//   – «⋯»: Редактор, Подписи (вкл/выкл, переключаются), Новый тир-лист,
//     последним – «Сохранить как картинку»; без значков;
//   – шторка закрывается при смене экрана;
//   – редактор: «Сохранить» и «⋯» в шапке, «Переименовать»/«Удалить» –
//     в шторке; подпись тира – полосой над персонажами; ✕ тира виден;
//   – на компьютере – всё как раньше.
//
// Запуск: node tests/browser/tierlist-phone.mjs

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
    grade: "rezonans",
    date_end: "2026-01-02",
  },
  {
    id: 2,
    title: "Фильм А",
    type: "movie",
    status: "completed",
    grade: "etalon",
    date_end: "2025-01-02",
  },
];
const tier = (name, color, chars) => ({ name, color, chars });
const game = (id, title) => ({
  id,
  title,
  tierlists: [
    {
      id: "l1",
      label: "Дизайн",
      tiers: [tier("S", "#8844ff", [{ name: "Герой", img: "" }]), tier("A", "#3366cc", [])],
    },
    { id: "l2", label: "Сюжет", tiers: [tier("S", "#8844ff", [])] },
    { id: "l3", label: "Музыка", tiers: [tier("S", "#8844ff", [])] },
  ],
});

const dir = mkdtempSync(join(tmpdir(), "tasteid-tl-phone-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));
writeFileSync(
  join(dir, "characters-tier.json"),
  JSON.stringify([game("g1", "Игра 1"), game("g2", "Игра 2")])
);

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
  await page.click('.tab-btn[aria-controls="tab-tierlist"]');
  await page.waitForSelector("#tab-tierlist .tl-mode-btn", { timeout: 15000 });
  await page.waitForTimeout(300);
  return page;
}
const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const midY = (b) => b.top + b.height / 2;

console.log("Телефон: «Тайтлы»");
const phone = await open(
  { width: 390, height: 844 },
  { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
);
const row = await box(phone, "#tab-tierlist .tl-mode-scroll");
const more = await box(phone, "#tab-tierlist .tl-more-btn");
ok(Math.abs(midY(row) - midY(more)) < row.height, "тир-листы и «⋯» – одной строкой");
ok(more.right <= 390 && more.width >= 40, "«⋯» на экране и не мельче 40px");
ok(!(await phone.isVisible("#tl-add-collection-btn")), "«Новый тир-лист» в строке не видно");
ok(
  !(await phone.isVisible("#tab-tierlist .tl-head-tools")),
  "«Подписи» и камеры в строке не видно"
);

console.log("Телефон: «Персонажи»");
await phone.click('#tab-tierlist .tl-mode-btn[data-mode="characters"]');
await phone.waitForSelector("#tl-chars-rows");
const size = await box(phone, "#tab-tierlist .tl-mode-toggle #tl-size-btn");
ok(Math.abs(midY(size) - midY(more)) < 4, "размер – значком в строке с «⋯»");
ok(!(await phone.$(".tl-char-sub .tl-size")), "в строке списков размера нет");
await phone.click("#tl-size-btn");
ok((await phone.textContent("#tl-char-size-val2")).trim() === "200px", "в окошке – число");
await phone.$eval("#tl-char-size-slider", (s) => {
  s.value = "300";
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
ok((await phone.textContent("#tl-char-size-val2")).trim() === "300px", "ползунок меняет число");
await phone.keyboard.press("Escape");
await phone.$eval('#tab-tierlist [data-char-game="g2"]', (b) => b.click());
await phone.waitForTimeout(300);
ok(
  !!(await phone.$("#tab-tierlist .tl-mode-toggle #tl-size-btn")),
  "после смены игры размер на месте"
);
const lists = await phone.$$eval(
  "#tab-tierlist .tl-char-lists .tl-list-btn",
  (els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size
);
ok(lists === 1, "списки игры – одной строкой");

console.log("Шторка «⋯»");
await phone.click("#tab-tierlist .tl-more-btn");
const items = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(
  items.join("|") === "Редактор|Подписи|Новый тир-лист|Сохранить как картинку",
  `пункты: ${items.join(", ")}`
);
ok(!(await phone.$(".action-sheet svg")), "без значков");
ok(
  (await phone.textContent('.action-sheet-item:has-text("Подписи") .action-sheet-count')) ===
    "выкл",
  "видно, что подписи выключены"
);
await phone.click('.action-sheet-item:has-text("Подписи")');
await phone.waitForTimeout(200);
ok(
  await phone.$eval("#tab-tierlist", (t) => t.classList.contains("tl-captions")),
  "«Подписи» включают подписи"
);
await phone.click("#tab-tierlist .tl-more-btn");
await phone.evaluate(() => (location.hash = "#/chars-edit?collection=characters"));
await phone.waitForTimeout(500);
ok(!(await phone.$(".action-sheet")), "смена экрана закрывает шторку");

console.log("Редактор");
await phone.waitForSelector("#title-list > *");
ok((await phone.textContent("#btn-save")).trim() === "Сохранить", "в шапке – «Сохранить»");
ok(!(await phone.isVisible(".ce-bar-extra")), "«Переименовать»/«Удалить» в шапке не видно");
await phone.click(".ce-more-btn");
const ceItems = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(
  ceItems.join("|") === "Переименовать тир-лист|Удалить тир-лист",
  `шторка редактора: ${ceItems.join(", ")}`
);
await phone.mouse.click(195, 30);
await phone.$eval("#title-list > *", (el) => el.click());
await phone.waitForSelector(".tl-editor-row");
const label = await box(phone, ".tl-editor-row .tl-editor-label");
const cards = await box(phone, ".tl-editor-row .tl-editor-cards");
ok(label.bottom <= cards.top + 1 && label.width > 300, "подпись тира – полосой над персонажами");
ok(await phone.isVisible(".tl-editor-row .tl-row-del"), "✕ тира виден без наведения");
await phone.close();

console.log("Компьютер");
const desk = await open({ width: 1300, height: 900 });
ok(await desk.isVisible("#tl-add-collection-btn"), "«Новый тир-лист» виден");
ok(!(await desk.isVisible("#tab-tierlist .tl-more-btn")), "«⋯» нет");
await desk.click('#tab-tierlist .tl-mode-btn[data-mode="characters"]');
await desk.waitForSelector("#tl-chars-rows");
ok(!!(await desk.$(".tl-char-sub .tl-size")), "размер – на прежнем месте");
await desk.goto(`${base}/#/chars-edit?collection=characters`);
await desk.waitForSelector("#btn-save");
ok(
  (await desk.textContent("#btn-save")).trim() === "Сохранить всё",
  "«Сохранить всё» – как раньше"
);
ok(await desk.isVisible(".ce-bar-extra"), "«Переименовать»/«Удалить» видны");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
