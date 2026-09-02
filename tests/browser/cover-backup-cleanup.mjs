// Заброшенные резервные копии обложки больше не копятся на диске —
// в настоящем браузере, на настоящем редакторе отзыва (add.html).
//
// Владелец заметил: вставляешь ссылку на обложку – создаётся резервная
// копия; вставляешь другую ссылку поверх – создаётся вторая, а первая
// остаётся лежать в covers-backup/ навсегда, никем больше не
// используемая. core/api.js: backupCover() создавал новый файл при
// каждой смене ссылки, но ничего не удаляло. Здесь проверяется, что
// js/routes/add.js теперь удаляет действительно ненужную копию – но с
// одним важным условием: копию, на которую ссылается уже СОХРАНЁННЫЙ
// отзыв, нельзя трогать раньше, чем сохранение подтвердит замену –
// иначе уход из редактора без сохранения испортил бы то, что видно на
// уже сохранённом отзыве.
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

console.log("Новый отзыв: вставляем ссылку, потом другую — старая копия должна исчезнуть");
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
  listBackups().length === 1,
  `после замены ссылки старая копия удалена, на диске всё ещё один файл (сейчас: ${listBackups().length})`
);

console.log("Стираем ссылку целиком — копия должна удалиться, раз отзыв ещё не сохранён с ней");
await page.fill("#f-cover", "");
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 0,
  `после стирания ссылки на диске пусто (сейчас: ${listBackups().length})`
);

console.log(
  "Сохранённый отзыв: правка + сохранение должны удалить старую копию только после успешного сохранения"
);
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
  listBackups().length === 1,
  `после сохранения на диске одна копия (сейчас: ${listBackups().length})`
);

console.log(
  "Открыть на редактирование, заменить обложку — старая должна уйти только после повторного сохранения"
);
const savedId = await page.evaluate(
  async () => (await (await fetch("/reviews.json")).json())[0].id
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
  listBackups().length === 2,
  `до сохранения правки — старая (сохранённая) копия ещё на месте, новая тоже уже создана (сейчас: ${listBackups().length})`
);

await page.click("#btn-save");
await page.waitForFunction(
  () => document.getElementById("status")?.textContent?.includes("обновлён"),
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 1,
  `после сохранения правки старая копия удалена, осталась одна новая (сейчас: ${listBackups().length})`
);

console.log(
  "Открыть на редактирование, стереть ссылку, уйти БЕЗ сохранения — копия должна остаться"
);
await page.goto(`http://127.0.0.1:${port}/add.html?edit=${savedId}`, {
  waitUntil: "domcontentloaded",
});
await page.waitForFunction(() => document.getElementById("f-title")?.value === "Тест копий", null, {
  timeout: 5000,
});
await page.fill("#f-cover", "");
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 1,
  `ушли без сохранения — старая (сохранённая) копия не тронута (сейчас: ${listBackups().length})`
);

console.log("JS ошибки:", jsErrors);

await browser.close();
server.kill();
sourceServer.close();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nзаброшенные копии больше не копятся");
