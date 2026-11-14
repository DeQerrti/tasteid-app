// Испорченный файл данных не должен молча превращаться в «пусто» и
// затираться следующим сохранением.
//
// Проверяется:
//   – site-settings.json испорчен: точечная правка настроек
//     (patchSiteSettings – ею пользуются выбор типа, статуса, источника,
//     горячие клавиши, тир-листы, импорт) отказывается сохранять, файл на
//     диске остаётся байт в байт прежним. Раньше в него записывался
//     объект из одной этой правки – все остальные настройки пропадали;
//   – окно настроек при испорченном файле тоже ничего не пишет по «Сохранить»;
//   – целый site-settings.json правится как раньше и остальные поля не теряет;
//   – файл тир-листа испорчен: редактор сообщает об этом, «Сохранить всё»
//     выключено, и даже прямой вызов saveAll() файл не трогает. Раньше
//     редактор открывался пустым и сохранял пустой список поверх;
//   – reviews.json или favorites.json испорчен: вкладки «Отзывы» и
//     «Любимое» показывают ошибку с именем файла, а не «пока ничего нет»;
//     файла нет вовсе – это по-прежнему просто пустой список.
//
// Запуск: node tests/browser/broken-files-not-overwritten.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-brokenfiles-"));
const settingsFile = join(vaultDir, "site-settings.json");
const tierFile = join(vaultDir, "characters-tier.json");
// Обрезанный на полуслове JSON – так выглядит файл после выключения
// компьютера посреди записи.
const BROKEN_SETTINGS = '{"theme":"classic","labels":{"nav":{"reviews":"Мои отзывы"}';
const BROKEN_TIER = '[{"id":1,"title":"Тема","tiers":[';
writeFileSync(join(vaultDir, "reviews.json"), "[]");
writeFileSync(settingsFile, BROKEN_SETTINGS);
writeFileSync(tierFile, BROKEN_TIER);

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
const base = `http://127.0.0.1:${port}`;

console.log("Испорченные настройки");
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof patchSiteSettings === "function");
const patchError = await page.evaluate(async () => {
  try {
    await window.patchSiteSettings((settings) => {
      settings.historyRetentionDays = 7;
    });
    return null;
  } catch (e) {
    return e.message;
  }
});
ok(!!patchError, `точечная правка отказалась сохранять (${patchError})`);
ok(/site-settings\.json/.test(patchError || ""), "в ошибке назван сам файл");
ok(readFileSync(settingsFile, "utf8") === BROKEN_SETTINGS, "файл настроек на диске не тронут");

await page.goto(base + "/#/settings-edit", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".side-tab", { timeout: 10000 });
await page.waitForFunction(() => typeof settingsLoadError === "string", null, { timeout: 10000 });
await page.evaluate(() => window.saveSettings());
ok(
  readFileSync(settingsFile, "utf8") === BROKEN_SETTINGS,
  "«Сохранить» в окне настроек тоже ничего не записало"
);

console.log("Целые настройки");
writeFileSync(settingsFile, JSON.stringify({ theme: "classic", textScale: 110 }));
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof patchSiteSettings === "function");
await page.evaluate(() =>
  window.patchSiteSettings((settings) => {
    settings.historyRetentionDays = 7;
  })
);
const healthy = JSON.parse(readFileSync(settingsFile, "utf8"));
ok(healthy.historyRetentionDays === 7, "правка записалась");
ok(healthy.theme === "classic" && healthy.textScale === 110, "остальные настройки на месте");

console.log("Испорченный тир-лист");
await page.goto(base + "/#/chars-edit", { waitUntil: "domcontentloaded" });
await page.waitForSelector("#btn-save", { timeout: 10000 });
await page.waitForFunction(
  () => document.getElementById("status-msg").textContent.trim().length > 0
);
ok(
  /characters-tier\.json/.test(await page.textContent("#status-msg")),
  "редактор сообщает, какой файл не читается"
);
ok(await page.$eval("#btn-save", (b) => b.disabled), "«Сохранить всё» выключено");
await page.evaluate(() => window.saveAll());
await page.waitForTimeout(300);
ok(readFileSync(tierFile, "utf8") === BROKEN_TIER, "файл тир-листа на диске не тронут");

console.log("Испорченные отзывы и «Любимое»");
const reviewsFile = join(vaultDir, "reviews.json");
const favFile = join(vaultDir, "favorites.json");
await page.goto(base + "/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.fetchVaultList === "function");
ok(
  (await page.evaluate(() => window.fetchVaultList("favorites.json"))).length === 0,
  "файла ещё нет – пустой список, не ошибка"
);
writeFileSync(reviewsFile, '[{"id":1,"title":"Тайтл"');
await page.evaluate(() => window.loadReviews());
const reviewsTab = await page.textContent("#tab-reviews");
ok(/reviews\.json/.test(reviewsTab), "вкладка «Отзывы» называет нечитаемый файл");
ok(!/Отзывов пока нет/.test(reviewsTab), "и не притворяется, что отзывов нет");

writeFileSync(reviewsFile, "[]");
writeFileSync(favFile, '[{"id":1,"name":"Персонаж"');
await page.evaluate(() => window.loadFavorites());
await page.waitForFunction(() =>
  /favorites\.json/.test(document.getElementById("tab-favorites").textContent)
);
ok(true, "вкладка «Любимое» называет нечитаемый файл");

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nиспорченные файлы не затираются");
