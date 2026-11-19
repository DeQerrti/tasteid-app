// Ряды кнопок одной строкой с прокруткой (js/utils.js: hscrollRow) –
// как годы в «Статистике», так теперь и вкладки «Статусов», «Любимого»,
// «Тир-листа» и чипы типов.
//
// Проверяется на ширине компьютера и телефона:
//   – ряд, в который кнопки не помещаются, – одна строка, а не перенос;
//   – затенён только тот край, за которым правда есть кнопки: сначала
//     правый, после прокрутки – оба, в конце – только левый;
//   – колесо мыши листает ряд вбок;
//   – выбранная кнопка за краем (последний статус) прокручивается в
//     видимую часть;
//   – ряд, который помещается, не затенён вовсе.
//
// Запуск: node tests/browser/hscroll-rows.mjs

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

const TYPES = ["anime", "manga", "manhwa", "movie", "show", "game", "book", "novel", "dorama"];
const STATUSES = [
  ["current", "В процессе"],
  ["onhold", "Отложено"],
  ["planning", "Планирую"],
  ["s1", "Пересматриваю сейчас"],
  ["s2", "Жду продолжения"],
  ["s3", "Брошено на середине"],
  ["s4", "Читаю с друзьями"],
  ["s5", "Последний статус"],
];
const reviews = [];
let id = 1;
for (const [key] of STATUSES)
  for (const type of TYPES)
    reviews.push({ id: id++, title: `${key} ${type}`, type, status: key, year: 2020 });
// Законченные с оценкой – для тир-листа: типы и годы.
for (const [i, type] of TYPES.entries())
  for (let y = 2010; y < 2026; y++)
    reviews.push({
      id: id++,
      title: `Готово ${type} ${y}`,
      type,
      status: "completed",
      grade: "etalon",
      date_end: `${y}-0${(i % 9) + 1}-10`,
    });

const favCollections = Array.from({ length: 9 }, (_, i) => ({
  id: `c${i}`,
  label: `Свой раздел номер ${i + 1}`,
}));
const favorites = [
  { id: 1, type: "character", name: "Персонаж" },
  ...favCollections.map((c, i) => ({ id: 100 + i, type: c.id, name: `Запись ${i}` })),
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-hscroll-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "favorites.json"), JSON.stringify(favorites));
writeFileSync(
  join(dir, "site-settings.json"),
  JSON.stringify({
    statusBuckets: STATUSES.map(([key, label]) => ({ key, label })),
    favCollections,
    tierCollections: [
      { id: "characters", label: "Персонажи" },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Тир-лист номер ${i + 1}` })),
    ],
  })
);

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

// Состояние ряда: одна ли строка, переполнен ли, какие края затенены.
const rowState = (page, sel) =>
  page.$eval(sel, (el) => {
    const first = el.querySelector("button, a");
    return {
      oneLine: el.getBoundingClientRect().height < first.getBoundingClientRect().height * 1.8,
      overflows: el.scrollWidth > el.clientWidth + 1,
      l: el.classList.contains("hs-l"),
      r: el.classList.contains("hs-r"),
      mask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
    };
  });

async function checkRow(page, sel, name) {
  await page.waitForSelector(sel);
  const s = await rowState(page, sel);
  ok(s.oneLine, `${name}: одна строка`);
  ok(s.overflows, `${name}: кнопки не помещаются – есть что листать`);
  ok(s.r && !s.l && s.mask !== "none", `${name}: в начале затенён только правый край`);
  await page.hover(sel);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  const mid = await rowState(page, sel);
  ok(mid.l, `${name}: колесо мыши листает вбок – затенился и левый край`);
  await page.$eval(sel, (el) => (el.scrollLeft = el.scrollWidth));
  await page.waitForTimeout(150);
  const end = await rowState(page, sel);
  ok(end.l && !end.r, `${name}: в конце затенён только левый край`);
}

for (const [w, h, label] of [
  [900, 800, "компьютер"],
  [390, 844, "телефон"],
]) {
  console.log(`\n── ${label} (${w}px) ──`);
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });

  console.log("Статусы");
  await page.click('.tab-btn[aria-controls="tab-now"]');
  await checkRow(page, "#tab-now .tl-mode-scroll", "вкладки статусов");
  await checkRow(page, "#now-chips", "чипы типов");
  // Последний статус выбран свайпом/кодом, пока ряд прокручен в начало.
  await page.$eval("#tab-now .tl-mode-scroll", (el) => (el.scrollLeft = 0));
  await page.$eval('#tab-now .tl-mode-btn[data-mode="s5"]', (b) => b.click());
  await page.waitForTimeout(250);
  const seen = await page.$eval("#tab-now .tl-mode-scroll", (el) => {
    const a = el.querySelector(".active").getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return a.left >= r.left - 1 && a.right <= r.right + 1;
  });
  ok(seen, "выбранный последний статус прокручен в видимую часть");

  console.log("Любимое");
  await page.click('.tab-btn[aria-controls="tab-favorites"]');
  await checkRow(page, "#tab-favorites .tl-mode-scroll", "разделы «Любимого»");
  const camOnRow = await page.$eval("#tab-favorites .fav-head", (head) => {
    const t = head.querySelector(".tl-mode-toggle").getBoundingClientRect();
    const a = head.querySelector("#fav-action-link").getBoundingClientRect();
    return Math.abs(t.top - a.top) < t.height;
  });
  ok(camOnRow, "кнопки справа – в одной строке с разделами, а не под ними");

  console.log("Тир-лист");
  await page.click('.tab-btn[aria-controls="tab-tierlist"]');
  await checkRow(page, "#tab-tierlist .tl-mode-scroll", "тир-листы");
  await checkRow(page, "#tab-tierlist .tl-filters", "типы тир-листа");
  await checkRow(page, "#tab-tierlist .tl-years", "годы тир-листа");

  await page.close();
}

console.log("\n── Ряд, который помещается ──");
// Три типа и обычные три статуса – всё помещается.
writeFileSync(
  join(dir, "reviews.json"),
  JSON.stringify(
    ["anime", "movie", "book"].map((type, i) => ({
      id: i + 1,
      title: type,
      type,
      status: "current",
    }))
  )
);
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));
const wide = await browser.newPage({ viewport: { width: 1600, height: 900 } });
wide.on("pageerror", (e) => jsErrors.push(e.message));
await wide.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
await wide.click('.tab-btn[aria-controls="tab-now"]');
await wide.waitForSelector("#now-chips .now-chip");
for (const [sel, name] of [
  ["#now-chips", "чипы типов"],
  ["#tab-now .tl-mode-scroll", "вкладки статусов"],
]) {
  const fits = await rowState(wide, sel);
  ok(
    !fits.overflows && !fits.l && !fits.r && fits.mask === "none",
    `${name} помещаются – без затенения`
  );
}
await wide.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
