// Настройки → «История версий»: версии по дням, обслуживание строками сверху.
//
// Проверяется:
//   – версии сгруппированы по дням, в строке только время, а секунды – в
//     подсказке (две версии в одну минуту иначе не отличить);
//   – одинаковая подпись «сохранение» в строках не повторяется;
//   – срок хранения и поиск неиспользуемых обложек – строками сверху, выше
//     переключателя файлов (раньше обложки были внизу, после всего списка);
//   – «Удалить всю историю» – тихая ссылка, а не боксовая кнопка;
//   – поиск неиспользуемых обложек по-прежнему отвечает.
//
// Запуск: node tests/browser/settings-history-panel.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-historypanel-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "Тайтл",
      type: "anime",
      grade: "etalon",
      status: "completed",
      date_end: "2024-01-01",
    },
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".side-tab", { timeout: 10000 });

// Несколько сохранений отзыва – каждое прошлое состояние уходит в историю.
await page.evaluate(async () => {
  for (const comment of ["a", "b", "c"]) {
    await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _editId: 1,
        id: 1,
        title: "Тайтл",
        type: "anime",
        grade: "etalon",
        status: "completed",
        date_end: "2024-01-01",
        review_full: comment,
      }),
    });
    await new Promise((r) => setTimeout(r, 30));
  }
});

await page.click('.side-tab[data-panel="backup"]');
await page.waitForSelector("#content .version-row", { timeout: 10000 });

console.log("Версии");
ok((await page.$$("#content .version-day")).length >= 1, "версии сгруппированы по дням");
const times = await page.$$eval("#content .version-row .version-date", (els) =>
  els.map((e) => ({ text: e.firstChild?.textContent.trim() || "", title: e.title || "" }))
);
const past = times.filter((t) => t.text !== "сейчас");
ok(past.length >= 3, `прошлых версий не меньше трёх (${past.length})`);
ok(
  past.every((t) => /^\d{2}:\d{2}$/.test(t.text)),
  "в строке только время, без даты"
);
ok(
  past.every((t) => /\d{2}:\d{2}:\d{2}/.test(t.title)),
  "полное время с секундами – в подсказке"
);
ok(
  !(await page.$$eval("#content .version-msg", (els) =>
    els.some((e) => e.textContent.trim() === "сохранение")
  )),
  "одинаковая подпись «сохранение» в строках не повторяется"
);
ok(
  await page.$eval(
    "#content .version-list-head .btn-mini.danger",
    (e) => getComputedStyle(e).borderTopStyle === "none"
  ),
  "«Удалить всю историю» – тихая ссылка без рамки"
);

console.log("Обслуживание");
ok(!!(await page.$("#panel-backup .set-row #history-retention-select")), "срок хранения – строкой");
const coversBtn = await page.$('#panel-backup .set-row button[onclick="scanOrphanedCovers()"]');
ok(!!coversBtn, "поиск неиспользуемых обложек – строкой");
ok(
  await page.evaluate(() => {
    const tabs = document.getElementById("fileTabs").getBoundingClientRect().top;
    return (
      document.querySelector('button[onclick="scanOrphanedCovers()"]').getBoundingClientRect()
        .bottom < tabs
    );
  }),
  "обложки выше переключателя файлов, а не внизу под списком"
);
await coversBtn.click();
await page.waitForFunction(
  () => document.getElementById("orphaned-covers-list").textContent.trim().length > 0
);
ok(true, "поиск неиспользуемых обложек отвечает");

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nистория версий работает");
