// Нижняя панель вкладок на телефоне (owner, ноябрь 2026, вариант «Б»).
//
// Проверяется:
//   – «Настройки» – шестым местом той же ширины, что вкладки, а не узкой
//     кнопкой у края;
//   – подпись видна только у выбранной вкладки, у остальных – спрятана
//     визуально, но имя кнопки для экранного диктора осталось;
//   – смена вкладки переносит подпись;
//   – на компьютере в боковой панели подписи видны у всех.
//
// Запуск: node tests/browser/bottom-nav-phone.mjs

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

const dir = mkdtempSync(join(tmpdir(), "tasteid-nav-phone-"));
writeFileSync(
  join(dir, "reviews.json"),
  JSON.stringify([{ id: 1, title: "Тайтл", type: "anime", status: "current" }])
);
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
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const jsErrors = [];

const state = (page) =>
  page.evaluate(() => {
    const items = [
      ...document.querySelectorAll(
        "nav#rail .tab-btn:not([hidden]), nav#rail #admin-settings-link"
      ),
    ];
    return items.map((el) => {
      const label = el.querySelector(".tab-label, .admin-link-label");
      const r = label?.getBoundingClientRect();
      return {
        w: Math.round(el.getBoundingClientRect().width),
        active: el.classList.contains("active"),
        labelShown: !!r && r.width > 2 && r.height > 2,
        name: (el.getAttribute("aria-label") || label?.textContent || "").trim(),
      };
    });
  });

console.log("Телефон");
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
phone.on("pageerror", (e) => jsErrors.push(e.message));
await phone.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
await phone.click('.tab-btn[aria-controls="tab-now"]');
await phone.waitForTimeout(400);
let s = await state(phone);
ok(s.length === 6, `шесть мест в панели (${s.length})`);
ok(
  Math.max(...s.map((x) => x.w)) - Math.min(...s.map((x) => x.w)) <= 2,
  `все одной ширины (${s.map((x) => x.w).join(", ")})`
);
ok(
  s.filter((x) => x.labelShown).length === 1 && s.find((x) => x.labelShown)?.active,
  "подпись видна только у выбранной"
);
ok(
  s.every((x) => x.name),
  "у каждой кнопки есть имя для экранного диктора"
);
await phone.click('.tab-btn[aria-controls="tab-stats"]');
await phone.waitForTimeout(400);
s = await state(phone);
const shown = await phone.$eval(
  '.tab-btn[aria-controls="tab-stats"] .tab-label',
  (l) => l.getBoundingClientRect().width > 2
);
ok(shown && s.filter((x) => x.labelShown).length === 1, "подпись переехала на «Статистику»");
await phone.close();

console.log("Компьютер");
const desk = await browser.newPage({ viewport: { width: 1300, height: 900 } });
desk.on("pageerror", (e) => jsErrors.push(e.message));
await desk.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
await desk.waitForTimeout(800);
s = await state(desk);
ok(s.filter((x) => x.labelShown).length >= 5, "в боковой панели подписи у всех вкладок");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
