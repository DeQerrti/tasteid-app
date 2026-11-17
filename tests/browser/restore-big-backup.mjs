// Резервная копия больше 64 МБ восстанавливается (restoreBackup в
// js/routes/settings-app.js).
//
// Раньше копия уходила на сервер одним запросом, а у приложения предел
// тела запроса 64 МБ – копию с картинками крупнее (обычный перенос с
// телефона на ПК) восстановить было нельзя: «Слишком большой запрос».
// Теперь – файлы данных, потом картинки пачками.
//
// Запуск: node tests/browser/restore-big-backup.mjs

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-bigrestore-"));
writeFileSync(join(vaultDir, "reviews.json"), "[]");

// 18 картинок по ~4 МБ base64 – больше 70 МБ в одном файле копии.
const IMAGE_COUNT = 18;
const chunk = Buffer.alloc(3 * 1024 * 1024, 7).toString("base64");
const images = {};
for (let i = 0; i < IMAGE_COUNT; i++) images[`covers-backup/big-${i}.webp`] = chunk;
const backup = {
  format: "tasteid-backup",
  files: { "reviews.json": [{ id: 1, title: "Из копии", type: "movie", status: "completed" }] },
  images,
};
const backupPath = join(mkdtempSync(join(tmpdir(), "tasteid-bigfile-")), "backup.json");
writeFileSync(backupPath, JSON.stringify(backup));
const sizeMb = Math.round(readFileSync(backupPath).length / 1024 / 1024);

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
await page.waitForSelector("#backup-file", { state: "attached", timeout: 15000 });

await page.setInputFiles("#backup-file", backupPath);
await page.waitForSelector('#confirm-dialog-overlay [data-act="ok"]', {
  timeout: 10000,
});
await page.click('#confirm-dialog-overlay [data-act="ok"]');
// Ждём итог: любой текст, кроме промежуточного «Восстанавливаем картинки…».
await page.waitForFunction(
  () => {
    const t = document.getElementById("status-backup")?.textContent?.trim() || "";
    return t && !t.startsWith("Восстанавливаем");
  },
  null,
  { timeout: 120000 }
);
const status = await page.textContent("#status-backup");
ok(
  /Восстановлено\. Обновляем/.test(status),
  `копия ${sizeMb} МБ восстановлена («${status.trim()}»)`
);

const restored = readdirSync(join(vaultDir, "covers-backup")).length;
ok(restored === IMAGE_COUNT, `все картинки на месте (${restored} из ${IMAGE_COUNT})`);
const reviews = JSON.parse(readFileSync(join(vaultDir, "reviews.json"), "utf8"));
ok(reviews[0]?.title === "Из копии", "отзывы из копии записались");
ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nбольшая резервная копия восстанавливается");
process.exit(0);
