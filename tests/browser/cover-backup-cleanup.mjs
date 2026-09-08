// Резервные копии обложки больше не удаляются друг за другом сами —
// в настоящем браузере, на настоящем редакторе отзыва (add.html).
//
// Раньше вставка новой ссылки поверх старой тихо стирала предыдущую
// резервную копию (discardScratchCoverBackup) — владелец попросил
// обратное: пусть все резервные копии, когда-либо сделанные для этого
// отзыва, копятся в cover_gallery и остаются на диске, а не теряются
// без возможности вернуться. Единственный способ и правда удалить
// картинку теперь — явный крестик в мини-галерее (js/gallery-modal.js,
// openCoverGallery в add-cover.js). Здесь проверяется именно это: ни
// замена ссылки, ни очистка поля, ни сохранение, ни уход со страницы
// без сохранения сами по себе ничего не стирают — а явное удаление
// через галерею стирает.
//
// Запуск: node tests/browser/cover-backup-cleanup.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-covercleanup-"));
const port = 8964;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const GREEN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg+G+DHQ0tCQC2ik7BakjxzwAAAABJRU5ErkJggg==",
  "base64"
);

// backupCover() качает картинку на СЕРВЕРЕ (Node-процесс scripts/
// serve.js), а не в браузере — page.route() до него не достаёт вовсе.
// Нужен настоящий, реально слушающий HTTP-сервер картинок.
const sourceServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "image/png" });
  res.end(GREEN);
});
await new Promise((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
const sourcePort = sourceServer.address().port;
const coverUrl = (name) => `http://127.0.0.1:${sourcePort}/${name}.png`;

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

const listBackups = () => {
  try {
    return readdirSync(join(vaultDir, "covers-backup"));
  } catch {
    return [];
  }
};

await page.goto(`http://127.0.0.1:${port}/add.html`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#f-title");

console.log("Новый отзыв: вставляем ссылку, потом другую — обе должны остаться (галерея)");
await page.fill("#f-title", "Тест копий");
await page.click("#cover-add-btn");
await page.waitForSelector("#f-cover", { state: "visible" });
await page.fill("#f-cover", coverUrl("one"));
await page.waitForFunction(() => document.getElementById("f-cover-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 1,
  `после первой ссылки на диске один файл (сейчас: ${listBackups().length})`
);

await page.fill("#f-cover", coverUrl("two"));
await page.waitForFunction(() => document.getElementById("f-cover-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 2,
  `после замены ссылки старая копия НЕ удалена — на диске оба файла (сейчас: ${listBackups().length})`
);

console.log("Стираем ссылку целиком — обе копии всё равно остаются (стирается только поле формы)");
await page.fill("#f-cover", "");
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 2,
  `после стирания ссылки на диске по-прежнему оба файла (сейчас: ${listBackups().length})`
);

console.log("Сохранение отзыва не удаляет ни одну из накопленных копий");
await page.fill("#f-cover", coverUrl("three"));
await page.waitForFunction(() => document.getElementById("f-cover-backup").value.length > 0, null, {
  timeout: 5000,
});
await page.click("#btn-save");
// Успешное сохранение НОВОГО отзыва тут же вызывает resetToNew(),
// который сам стирает текст статуса вместе с остальной формой — ждать
// текста "сохранён" бессмысленно, он не успевает даже отрисоваться.
// Ждём земли: запись действительно появилась в reviews.json.
await page.waitForFunction(
  async () => (await (await fetch("/reviews.json")).json()).some((r) => r.title === "Тест копий"),
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 3,
  `после сохранения все три копии на месте, ни одна не потерялась (сейчас: ${listBackups().length})`
);

const savedId = await page.evaluate(
  async () => (await (await fetch("/reviews.json")).json())[0].id
);
const savedGallery = await page.evaluate(
  async (id) =>
    (await (await fetch("/reviews.json")).json()).find((r) => r.id === id).cover_gallery,
  savedId
);
ok(
  Array.isArray(savedGallery) && savedGallery.length === 3,
  `cover_gallery отзыва в reviews.json несёт все три ссылки (сейчас: ${savedGallery?.length})`
);

console.log(
  "Открыть на редактирование, вставить ещё одну ссылку, уйти БЕЗ сохранения — ничего не удаляется"
);
await page.goto(`http://127.0.0.1:${port}/add.html?edit=${savedId}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => document.getElementById("f-title")?.value === "Тест копий", null, {
  timeout: 5000,
});
await page.fill("#f-cover", coverUrl("four"));
await page.waitForFunction(() => document.getElementById("f-cover-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `новая ссылка добавила четвёртый файл, старые три никуда не делись (сейчас: ${listBackups().length})`
);

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `ушли без сохранения — все четыре копии всё ещё на диске (сейчас: ${listBackups().length})`
);

console.log("Явное удаление в мини-галерее — вот это уже правда удаляет файл");
await page.goto(`http://127.0.0.1:${port}/add.html?edit=${savedId}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => document.getElementById("f-title")?.value === "Тест копий", null, {
  timeout: 5000,
});
await page.click("#cover-img");
await page.waitForSelector("#gallery-modal-overlay:not(.hidden)", { timeout: 5000 });
const itemsBefore = await page.$$eval(
  "#gallery-modal-grid .gallery-modal-item",
  (els) => els.length
);
ok(
  itemsBefore === 3,
  `галерея сохранённого отзыва показывает три картинки (сейчас: ${itemsBefore})`
);
await page.click("#gallery-modal-grid .gallery-modal-item .gallery-modal-del");
await page.waitForSelector('.confirm-dialog-actions [data-act="ok"]', { timeout: 5000 });
await page.click('.confirm-dialog-actions [data-act="ok"]');
await new Promise((r) => setTimeout(r, 400));
ok(
  listBackups().length === 3,
  `удаление одной картинки из галереи и правда стёрло файл (сейчас: ${listBackups().length})`
);

console.log("JS ошибки:", jsErrors);

await browser.close();
server.kill();
sourceServer.close();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nгалерея обложек копится и удаляется только явно");
