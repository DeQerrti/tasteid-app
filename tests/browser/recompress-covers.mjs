// «Сжать старые обложки» в настройках → «Приложение» — в настоящем
// браузере, с настоящими файлами на диске и настоящим sharp.
//
// backupCover() сжимает новые копии сам, но копии, сохранённые до
// появления этой возможности, остались в исходном виде — core/api.js:
// recompressCovers() проходит по ним разом. Проверяется: старый
// несжатый PNG действительно сжимается и переименовывается в .webp,
// а уже сжатый .webp (как будто сохранённый уже новой версией) не
// трогается вовсе.
//
// Запуск: node tests/browser/recompress-covers.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, statSync, readdirSync } from "node:fs";
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
const sharp = require("sharp");

const failures = [];
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures.push(msg);
};

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-recompress-"));
mkdirSync(join(vaultDir, "covers-backup"), { recursive: true });

// "Старая" обложка — крупная, несжатая PNG, как backupCover() сохранял
// её до появления сжатия.
const bigPng = await sharp({
  create: { width: 2000, height: 2000, channels: 3, background: { r: 20, g: 140, b: 90 } },
})
  .png()
  .toBuffer();
writeFileSync(join(vaultDir, "covers-backup", "old-cover.png"), bigPng);

// Уже webp — как будто уже сжата этой же функцией раньше; трогать не должны.
const alreadyWebp = await sharp({
  create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 50, b: 50 } },
})
  .webp()
  .toBuffer();
writeFileSync(join(vaultDir, "covers-backup", "already-compressed.webp"), alreadyWebp);

const oldSize = statSync(join(vaultDir, "covers-backup", "old-cover.png")).size;
const webpSizeBefore = statSync(join(vaultDir, "covers-backup", "already-compressed.webp")).size;

const port = 8969;
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

console.log("Нажимаем «Сжать старые обложки»");
await page.click("#btn-recompress-covers");
await page.waitForFunction(
  () => document.getElementById("status-recompress")?.textContent?.includes("Готово"),
  null,
  { timeout: 15000 }
);
const statusText = await page.evaluate(
  () => document.getElementById("status-recompress").textContent
);
console.log("статус:", statusText);
ok(/сжато 1 из 1/.test(statusText), `статус называет верное количество: "${statusText}"`);

const filesAfter = readdirSync(join(vaultDir, "covers-backup"));
ok(
  filesAfter.includes("old-cover.webp") && !filesAfter.includes("old-cover.png"),
  `старый PNG переименован в webp (файлы: ${filesAfter})`
);
const newSize = statSync(join(vaultDir, "covers-backup", "old-cover.webp")).size;
ok(
  newSize < oldSize / 5,
  `новый файл заметно меньше исходного (${newSize} байт против ${oldSize})`
);

const webpSizeAfter = statSync(join(vaultDir, "covers-backup", "already-compressed.webp")).size;
ok(webpSizeAfter === webpSizeBefore, "уже сжатый webp не тронут (тот же размер байт в байт)");

console.log("Повторное нажатие — сжимать больше нечего");
await page.click("#btn-recompress-covers");
await page.waitForFunction(
  () => document.getElementById("status-recompress")?.textContent?.includes("нечего"),
  null,
  { timeout: 15000 }
);
ok(true, "второй проход сообщает, что сжимать больше нечего");

ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nстарые обложки пересжимаются по кнопке");
