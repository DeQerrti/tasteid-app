// «Проверить оставленные копии» в настройках → «Приложение» — в
// настоящем браузере, с настоящими файлами на диске.
//
// Отдельная история от сжатия: файл обложки, чей отзыв давно удалён,
// занимает место без всякой пользы — ни add.js (правит только то, что
// меняется в текущей правке), ни recompressCovers (уменьшает размер,
// но не решает, нужен ли файл вообще) этого не ловят. core/api.js:
// findOrphanCovers() сверяет covers/ и covers-backup/ со всеми
// cover_backup из reviews.json, а удаление — отдельным подтверждённым
// шагом (deleteOrphanCovers), не автоматически.
//
// Запуск: node tests/browser/orphan-covers.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-orphancovers-"));
mkdirSync(join(vaultDir, "covers-backup"), { recursive: true });
mkdirSync(join(vaultDir, "covers"), { recursive: true });

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg+G+DHQ0tCQC2ik7BakjxzwAAAABJRU5ErkJggg==",
  "base64"
);
writeFileSync(join(vaultDir, "covers-backup", "used.webp"), PNG);
writeFileSync(join(vaultDir, "covers-backup", "orphan1.webp"), PNG);
writeFileSync(join(vaultDir, "covers", "orphan2.webp"), PNG);

// reviews.json ссылается только на used.webp — orphan1/orphan2 ничьи.
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([{ id: 1, title: "Тест", cover_backup: "/covers-backup/used.webp" }])
);

const port = 8970;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

await page.route("**/api/app/info", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      mobile: false,
      version: "0.5.25",
      platform: "linux",
      vaultPath: vaultDir,
      zoom: 100,
    }),
  })
);

await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".side-tab");
await page.click('.side-tab[data-panel="app"]');
await page.waitForTimeout(400);

console.log("Проверка");
await page.click("#btn-find-orphans");
await page.waitForFunction(
  () => document.getElementById("status-orphans")?.textContent?.includes("Найдено"),
  null,
  { timeout: 5000 }
);
const foundText = await page.evaluate(() => document.getElementById("status-orphans").textContent);
ok(/Найдено 2/.test(foundText), `нашёл оба ничьих файла, не тронув используемый: "${foundText}"`);
ok(
  await page.evaluate(
    () => !document.getElementById("btn-delete-orphans").classList.contains("hidden")
  ),
  "кнопка «Удалить найденное» появилась"
);

console.log("Удаление требует подтверждения");
await page.click("#btn-delete-orphans");
await page.waitForSelector(".confirm-dialog-actions", { timeout: 3000 });
const cancelBtn = page.locator(".confirm-dialog-actions button", { hasText: "Отмена" });
await cancelBtn.click();
await page.waitForTimeout(200);
ok(
  readdirSync(join(vaultDir, "covers-backup")).includes("orphan1.webp"),
  "отмена в диалоге ничего не удалила"
);

console.log("Подтверждённое удаление");
await page.click("#btn-delete-orphans");
await page.waitForSelector(".confirm-dialog-actions", { timeout: 3000 });
await page.locator(".confirm-dialog-actions button", { hasText: "Удалить" }).last().click();
await page.waitForFunction(
  () => document.getElementById("status-orphans")?.textContent?.includes("Удалено"),
  null,
  { timeout: 5000 }
);
const deletedText = await page.evaluate(
  () => document.getElementById("status-orphans").textContent
);
ok(/Удалено файлов: 2/.test(deletedText), `удалил оба ничьих файла: "${deletedText}"`);

const backupFiles = readdirSync(join(vaultDir, "covers-backup"));
const coversFiles = readdirSync(join(vaultDir, "covers"));
ok(backupFiles.includes("used.webp"), "используемый файл в covers-backup остался");
ok(!backupFiles.includes("orphan1.webp"), "ничейный файл в covers-backup удалён");
ok(!coversFiles.includes("orphan2.webp"), "ничейный файл в covers удалён");

ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nоставленные копии находятся и удаляются только с подтверждения");
