// Рисованная тема («Рисованный», тёмная и светлая): вид «скотч и маркер»
// на боковой панели и вкладке «Статусы» и почерк Shantell Sans.
//
// Проверяется (на ширине компьютера, в обеих темах, и на телефоне):
//   – файлы украшений /decor/doodle-*.svg и шрифт отдаются сервером;
//   – почерк – Shantell Sans, и он правда загружен (а не подменён
//     запасным шрифтом – так раньше было с Patrick Hand без кириллицы);
//   – вкладки статусов – надписи без капсул, у выбранной – мазок маркера;
//   – типы – словами без рамок, выбранный – бумажной наклейкой;
//   – карточка – отпечаток с полями на скотче, без коробки вокруг;
//   – выбранный раздел боковой панели – мазок под словом;
//   – на телефоне карточки и вкладки не уезжают за край экрана.
//
// Запуск: node tests/browser/doodle-theme.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-doodle-"));
const current = (id, title, type) => ({
  id,
  title,
  type,
  status: "current",
  year: 2020 + id,
  date_start: `2024-0${id}-01`,
});
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    current(1, "Рисуется", "anime"),
    current(2, "Клеится", "manga"),
    current(3, "Сохнет", "movie"),
    current(4, "Очень длинное название, которое не влезает в одну строку", "show"),
    { id: 5, title: "Ждёт", type: "manga", status: "planning", year: 2020 },
  ])
);

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
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const jsErrors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("pageerror", (e) => jsErrors.push(e.message));

console.log("Украшения и шрифт");
const files = [
  "doodle-tape-1.svg",
  "doodle-tape-2.svg",
  "doodle-tape-3.svg",
  "doodle-swipe-1.svg",
  "doodle-swipe-2.svg",
  "doodle-swipe-3.svg",
  "doodle-vline.svg",
  "doodle-hline.svg",
  "doodle-wave.svg",
  "doodle-grain.svg",
  "doodle-box-dark.svg",
  "doodle-box-light.svg",
  "doodle-under-dark.svg",
  "doodle-under-light.svg",
  "doodle-caret-dark.svg",
  "doodle-caret-light.svg",
];
for (const name of files) {
  const res = await page.request.get(`${base}/decor/${name}`);
  ok(res.ok(), `/decor/${name} отдаётся`);
}
for (const name of [
  "shantell-sans-cyrillic-400-normal.woff2",
  "shantell-sans-cyrillic-600-normal.woff2",
]) {
  const res = await page.request.get(`${base}/fonts/${name}`);
  ok(res.ok(), `/fonts/${name} отдаётся`);
}

// Всё, что проверяем на вкладке «Статусы», – одним заходом в страницу.
const inspect = () => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const toggle = document.querySelector("#tab-now > .tl-mode-toggle");
  const btn = toggle.querySelector(".tl-mode-btn.active");
  const chip = document.querySelector("#tab-now .now-chip:not(.active)");
  const chipOn = document.querySelector("#tab-now .now-chip.active");
  const card = document.querySelector("#tab-now .review-card-wrap .card");
  const poster = card.querySelector(".card-poster");
  const tag = card.querySelector(".type-tag");
  const railLabel = document.querySelector("#rail .tab-btn.active .tab-label");
  const probe = document.createElement("i");
  probe.style.color = css(document.documentElement).getPropertyValue("--doodle-paper").trim();
  document.body.appendChild(probe);
  const paperRgb = css(probe).color;
  probe.remove();
  const grid = document.querySelector("#tab-now .grid-now").getBoundingClientRect();
  return {
    font: css(btn).fontFamily,
    fontReady: document.fonts.check('600 20px "Shantell Sans"', "Жж"),
    btnBg: css(btn).backgroundColor,
    btnBorder: css(btn).borderTopWidth,
    btnCase: css(btn).textTransform,
    swipe: css(btn, "::after").maskImage || css(btn, "::after").webkitMaskImage,
    chipBorder: css(chip).borderTopWidth,
    chipBg: css(chip).backgroundColor,
    chipOnBg: css(chipOn).backgroundColor,
    cardBg: css(card).backgroundColor,
    cardBorder: css(card).borderTopWidth,
    posterPad: css(poster).paddingTop,
    posterBg: css(poster).backgroundColor,
    tape: css(poster, "::after").maskImage || css(poster, "::after").webkitMaskImage,
    tagBg: css(tag).backgroundColor,
    railSwipe: railLabel
      ? css(railLabel, "::after").maskImage || css(railLabel, "::after").webkitMaskImage
      : "",
    paperRgb,
    toggleFits: toggle.scrollWidth <= toggle.clientWidth + 1 || css(toggle).overflowX === "auto",
    gridFits: grid.right <= window.innerWidth + 1,
  };
};

for (const theme of ["doodle-dark", "doodle"]) {
  console.log(`Тема ${theme}`);
  writeFileSync(join(vaultDir, "site-settings.json"), JSON.stringify({ theme }));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[data-label="nav.now"]');
  await page.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const look = await page.evaluate(inspect);

  ok(look.font.startsWith('"Shantell Sans"'), `почерк – Shantell Sans (${look.font})`);
  ok(look.fontReady, "Shantell Sans с кириллицей загружен");
  ok(
    look.btnBg === "rgba(0, 0, 0, 0)" && look.btnBorder === "0px" && look.btnCase === "none",
    "вкладки статусов – надписи без капсул и заглавных"
  );
  ok(/doodle-swipe-\d\.svg/.test(look.swipe || ""), "у выбранной вкладки – мазок маркера");
  ok(
    look.chipBorder === "0px" && look.chipBg === "rgba(0, 0, 0, 0)",
    "кнопки типов – словами, без рамок"
  );
  ok(look.chipOnBg === look.paperRgb, "выбранный тип – бумажной наклейкой");
  ok(look.cardBg === "rgba(0, 0, 0, 0)" && look.cardBorder === "0px", "у карточки нет коробки");
  ok(
    parseFloat(look.posterPad) >= 4 && look.posterBg === look.paperRgb,
    `обложка – отпечаток с полями (${look.posterPad})`
  );
  ok(/doodle-tape-\d\.svg/.test(look.tape || ""), "обложка приклеена скотчем");
  ok(look.tagBg === look.paperRgb, "тип на обложке – бумажной наклейкой");
  ok(
    /doodle-swipe-\d\.svg/.test(look.railSwipe || ""),
    "выбранный раздел панели – мазок под словом"
  );
}

console.log("Телефон");
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), JSON.stringify({ theme: "doodle-dark" }));
await phone.goto(base + "/", { waitUntil: "domcontentloaded" });
await phone.click('.tab-btn[data-label="nav.now"]');
await phone.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });
await phone.waitForTimeout(400);
const small = await phone.evaluate(inspect);
ok(small.gridFits, "карточки не уезжают за край экрана");
ok(small.toggleFits, "вкладки статусов помещаются или прокручиваются");
ok(parseFloat(small.posterPad) >= 2, `поля отпечатка есть и на телефоне (${small.posterPad})`);
ok(
  /doodle-swipe-\d\.svg/.test(small.railSwipe || ""),
  "выбранный раздел нижней панели – мазок под словом"
);
await phone.close();

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nрисованная тема на месте");
