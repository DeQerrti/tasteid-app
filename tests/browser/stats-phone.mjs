// «Статистика», «Итоги» и «Цели» на телефоне (owner, ноябрь 2026, по макету).
//
// Проверяется:
//   – годы и «⋯» – одной строкой; «Цели», «Итоги», камеры в строке не
//     видно; «⋯» – шторка «Итоги ✦ / Цели / Сохранить как картинку»,
//     пункты открывают свои окна;
//   – «Лицо вкуса»: обложки в ряду – на одной высоте, даже когда у
//     соседей названия разной длины;
//   – «Итоги»: годы одной строкой, выбранный – в видимой части; название
//     и ✕ – одной строкой;
//   – «Цели»: ✕ – в строке с названием, а не под ним;
//   – на компьютере – кнопки, как раньше, «⋯» нет.
//
// Запуск: node tests/browser/stats-phone.mjs

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

// Двенадцать лет – строка годов заведомо длиннее экрана; любимые с оценкой
// и названиями разной длины – для «Лица вкуса».
const reviews = [];
for (let i = 0; i < 12; i++) {
  const year = 2015 + i;
  reviews.push({
    id: i + 1,
    title: i % 3 === 0 ? "Очень длинное название тайтла, которое займёт три строки" : "Кратко " + i,
    type: i % 2 ? "anime" : "movie",
    status: "completed",
    grade: "rezonans",
    favorite: true,
    year: String(year - 1),
    date_end: `${year}-03-0${(i % 8) + 1}`,
  });
}

const dir = mkdtempSync(join(tmpdir(), "tasteid-stats-phone-"));
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
  await page.click('.tab-btn[aria-controls="tab-stats"]');
  await page.waitForSelector("#tab-stats .sx-card", { timeout: 15000 });
  await page.waitForTimeout(300);
  return page;
}
const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());

console.log("Телефон: строка годов");
const phone = await open(
  { width: 390, height: 844 },
  { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
);
const years = await box(phone, "#tab-stats .stat-year-filters");
const more = await box(phone, "#tab-stats .stat-more-btn");
ok(
  Math.abs(years.top + years.height / 2 - (more.top + more.height / 2)) < years.height / 2 + 4,
  "годы и «⋯» – одной строкой"
);
ok(more.right <= 390 && more.width >= 40, "«⋯» на экране и не мельче 40px");
for (const sel of [".stat-goals-btn", ".stat-recap-btn", "#stats-export-btn"]) {
  ok(!(await phone.isVisible(`#tab-stats .stat-toolbar ${sel}`)), `${sel} в строке не видно`);
}

console.log("Шторка «⋯»");
await phone.click("#tab-stats .stat-more-btn");
const items = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(items.join("|") === "Итоги ✦|Цели|Сохранить как картинку", `пункты: ${items.join(", ")}`);
await phone.click('.action-sheet-item:has-text("Итоги")');
await phone.waitForSelector("#recap-overlay:not(.hidden) .recap-years");

console.log("Итоги");
const rTitle = await box(phone, "#recap-overlay .recap-title");
const rClose = await box(phone, '#recap-overlay .recap-actions .icon-btn[aria-label="Закрыть"]');
ok(
  Math.abs(rTitle.top + rTitle.height / 2 - (rClose.top + rClose.height / 2)) < rTitle.height,
  "название и ✕ – одной строкой"
);
const rYears = await phone.$eval("#recap-overlay .recap-years", (row) => {
  const tops = new Set(
    [...row.querySelectorAll(".tl-filter")].map((b) => Math.round(b.getBoundingClientRect().top))
  );
  return { oneLine: tops.size === 1, scrolls: row.scrollWidth > row.clientWidth };
});
ok(rYears.oneLine && rYears.scrolls, "годы – одной строкой с прокруткой");
await phone.$eval("#recap-overlay .recap-years .tl-filter:last-child", (b) => b.click());
await phone.waitForTimeout(300);
const seen = await phone.$eval("#recap-overlay .recap-years", (row) => {
  const a = row.querySelector(".active").getBoundingClientRect();
  const r = row.getBoundingClientRect();
  return a.left >= r.left - 1 && a.right <= r.right + 1;
});
ok(seen, "выбранный ранний год – в видимой части");
await phone.keyboard.press("Escape");
await phone.waitForTimeout(300);

console.log("Цели");
await phone.click("#tab-stats .stat-more-btn");
await phone.click('.action-sheet-item:has-text("Цели")');
await phone.waitForSelector("#goals-overlay:not(.hidden) .recap-title");
const gTitle = await box(phone, "#goals-overlay .recap-title");
const gClose = await box(phone, "#goals-overlay [data-gl-close]");
ok(
  Math.abs(gTitle.top + gTitle.height / 2 - (gClose.top + gClose.height / 2)) < gTitle.height,
  "✕ – в строке с названием"
);
await phone.click("#goals-overlay [data-gl-close]");
await phone.waitForTimeout(300);

console.log("Лицо вкуса");
const tops = await phone.$$eval(".sx-faces .sx-face img", (imgs) => {
  const rows = new Map();
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    const key = Math.round(r.bottom / 40);
    rows.set(key, [...(rows.get(key) || []), Math.round(r.top)]);
  }
  return [...rows.values()].filter((t) => t.length > 1);
});
ok(
  tops.length > 0 && tops.every((t) => Math.max(...t) - Math.min(...t) <= 1),
  "обложки в ряду – на одной высоте"
);
await phone.close();

console.log("Компьютер");
const desk = await open({ width: 1300, height: 900 });
ok(await desk.isVisible("#tab-stats .stat-goals-btn"), "«Цели» видны");
ok(await desk.isVisible("#tab-stats .stat-recap-btn"), "«Итоги» видны");
ok(!(await desk.isVisible("#tab-stats .stat-more-btn")), "«⋯» нет");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
