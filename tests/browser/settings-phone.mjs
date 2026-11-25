// «Настройки» на телефоне (owner, ноябрь 2026, по макету).
//
// Проверяется (сенсорный экран, pointer: coarse):
//   – ползунок «Размер шрифта» – линия, а не серая плашка: фон – тонкая
//     полоска посередине, рамки нет (во всех трёх темах);
//   – переключатель «Показывать теги» – дорожка 44×24, а нажимается вся
//     высота 44 (раньше становился квадратом 44×44);
//   – «Горячие клавиши» на телефоне спрятаны, на компьютере – на месте;
//   – в классической теме строки «Вкладок» – одной карточкой, значки
//     без рамок.
//
// Запуск: node tests/browser/settings-phone.mjs

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

const dir = mkdtempSync(join(tmpdir(), "tasteid-set-phone-"));
writeFileSync(
  join(dir, "reviews.json"),
  JSON.stringify([{ id: 1, title: "Т", type: "anime", status: "current" }])
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

for (const theme of ["classic", "soft", "doodle"]) {
  console.log(`Телефон, тема ${theme}`);
  writeFileSync(join(dir, "site-settings.json"), JSON.stringify({ theme }));
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('.side-tab[data-panel="appearance"]');
  await page.waitForTimeout(500);
  if (theme === "classic") {
    ok(!(await page.isVisible('.side-tab[data-panel="shortcuts"]')), "«Горячие клавиши» спрятаны");
  }
  await page.click('.side-tab[data-panel="appearance"]');
  await page.waitForSelector("#text-scale-slider");
  await page.waitForTimeout(300);
  const slider = await page.$eval("#text-scale-slider", (el) => {
    const cs = getComputedStyle(el);
    return { img: cs.backgroundImage, color: cs.backgroundColor, border: cs.borderTopWidth };
  });
  ok(
    /gradient/.test(slider.img) && /rgba\(0, 0, 0, 0\)|transparent/.test(slider.color),
    "ползунок – полоска, а не плашка"
  );
  ok(slider.border === "0px", "у ползунка нет рамки");
  const sw = await page.$eval("#hide-tags-toggle", (el) => {
    const r = el.getBoundingClientRect();
    const track = getComputedStyle(el, "::before");
    return { h: Math.round(r.height), tw: track.width, th: track.height };
  });
  ok(
    sw.h >= 44 && sw.tw === "44px" && sw.th === "24px",
    `переключатель: нажимается на ${sw.h}px, дорожка ${sw.tw}×${sw.th}`
  );
  if (theme === "classic") {
    await page.$eval('.side-tab[data-panel="tabs"]', (b) => b.click());
    await page.waitForSelector("#tabsList .tab-row");
    const card = await page.$eval("#tabsList", (el) => getComputedStyle(el).borderTopLeftRadius);
    ok(parseFloat(card) >= 10, "строки «Вкладок» – одной скруглённой карточкой");
    const icon = await page.$eval(
      "#tabsList .tab-row .icon-btn",
      (el) => getComputedStyle(el).borderTopWidth
    );
    ok(icon === "0px", "значки в строках – без рамок");
  }
  await page.close();
}

console.log("Компьютер");
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));
const desk = await browser.newPage({ viewport: { width: 1300, height: 900 } });
desk.on("pageerror", (e) => jsErrors.push(e.message));
await desk.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await desk.waitForSelector('.side-tab[data-panel="shortcuts"]');
ok(await desk.isVisible('.side-tab[data-panel="shortcuts"]'), "«Горячие клавиши» на месте");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
