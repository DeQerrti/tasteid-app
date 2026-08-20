// Резервная копия — в настоящем браузере, на настоящей странице
// настроек, с настоящей подменой Capacitor.
//
// tests/api.test.js проверяет /api/export-backup и /api/restore-backup
// сами по себе; здесь — то, чего оттуда не видно: работает ли кнопка
// на реальной странице (settings-edit.html), не съедает ли скачивание
// перехват fetch на телефоне, и не срабатывает ли восстановление без
// подтверждения (confirmDialog) — это разрушающее действие, и без
// диалога один случайный тап заменил бы все отзывы.
//
// Запуск: node tests/browser/backup.mjs [папка-хранилища]
// Нужен playwright. В npm run check не входит — ручная проверка.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
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

const vaultDir = process.argv[2] || mkdtempSync(join(tmpdir(), "tasteid-backup-"));
const port = 8800 + (process.pid % 200);
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

// Мобильный бандл с подставными Capacitor-плагинами — та же сборка,
// что и в tests/browser/mobile-bridge.mjs.
const bundleOut = join(mkdtempSync(join(tmpdir(), "tasteid-backup-bundle-")), "mobile.bundle.js");
execFileSync("npx", [
  "esbuild",
  "mobile/src/main.js",
  "--bundle",
  "--format=iife",
  "--alias:@capacitor/filesystem=./tests/fixtures/fake-filesystem.js",
  "--alias:@capacitor/share=./tests/fixtures/fake-share.js",
  "--alias:@capacitor/status-bar=./tests/fixtures/fake-status-bar.js",
  `--outfile=${bundleOut}`,
]);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 851 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => failures.push("JS: " + e.message));
await page.addInitScript(() => {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    convertFileSrc: (u) => u,
  };
});
// Порядок важен: Playwright разбирает маршруты от последнего
// зарегистрированного к первому, и универсальный перехватчик,
// зарегистрированный ПОСЛЕ точечного, забрал бы себе и запрос за
// mobile.bundle.js — точечная подмена так и не сработала бы, и вместо
// собранного с подставными плагинами файла ушёл бы настоящий бандл с
// настоящим @capacitor/core, который сам перезаписывает window.Capacitor.
await page.route("**/*", (r) =>
  r.request().url().includes(`127.0.0.1:${port}`) ? r.continue() : r.abort()
);
await page.route(`**/js/mobile.bundle.js**`, (route) =>
  route.fulfill({ path: bundleOut, contentType: "text/javascript" })
);

console.log("Скачивание (мобильный путь: fetch → «поделиться»)");
await page.goto(`http://127.0.0.1:${port}/settings-edit.html`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
const WEBP = "UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==";
await page.evaluate(async (webp) => {
  await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Стенд-ап Икс" }),
  });
  await fetch("/api/upload-char-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "Евангелион", filename: "синдзи.webp", contentBase64: webp }),
  });
}, WEBP);
await page.click('.side-tab[data-panel="app"]');
await page.waitForTimeout(400);
console.log(
  "тест: панель приложения",
  await page.evaluate(() => ({
    panelActive: document.getElementById("panel-app")?.classList.contains("active"),
    buttonExists: !!document.querySelector('#panel-app button[onclick="exportBackup()"]'),
    buttonVisible:
      document.querySelector('#panel-app button[onclick="exportBackup()"]')?.offsetParent !== null,
  }))
);

await page.click('#panel-app button[onclick="exportBackup()"]');
await page.waitForTimeout(400);
const shared = await page.evaluate(() => window.__shared);
ok(!!shared, "нажатие на «Скачать резервную копию» ушло в системное «поделиться», а не пропало");
// shareFile() кладёт файл в Directory.Cache под именем как есть, без
// префикса TasteID/ — это не хранилище, а разовый файл «на вынос»
// (см. mobile/src/main.js: shareFile).
const savedFiles = await page.evaluate(() => [...window.__fakeFiles.keys()]);
const backupPath = savedFiles.find((f) => f.startsWith("tasteid-backup"));
ok(!!backupPath, "файл резервной копии действительно лёг на диск");

// atob() отдаёт «двоичную строку» (один код символа — один байт), а
// не текст: русские буквы в UTF-8 занимают больше байта, и без
// TextDecoder JSON.parse собрал бы их неверно. Тот же способ, каким
// это read обратно делает MobileVault на телефоне.
const backupContent = await page.evaluate((path) => {
  const b64 = window.__fakeFiles.get(path).replace(/^data:[^;]+;base64,/, "");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}, backupPath);
ok(backupContent?.format === "tasteid-backup", "в файле правда резервная копия, а не что-то ещё");
ok(
  backupContent?.files?.["reviews.json"]?.[0]?.title === "Стенд-ап Икс",
  "отзыв, сохранённый только что, попал в копию"
);
ok(
  backupContent?.images?.["chars/Евангелион/синдзи.webp"] === WEBP,
  "загруженная вручную картинка тоже попала в копию"
);

console.log("Восстановление требует подтверждения");
const confirmSeen = await page.evaluate(async () => {
  const original = window.confirmDialog;
  let called = false;
  window.confirmDialog = async () => {
    called = true;
    return false; // отказываемся — восстановления быть не должно
  };
  const dt = new DataTransfer();
  const file = new File(
    [JSON.stringify({ format: "tasteid-backup", files: { "reviews.json": [] } })],
    "b.json",
    { type: "application/json" }
  );
  dt.items.add(file);
  const input = document.getElementById("backup-file");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  window.confirmDialog = original;
  return called;
});
ok(confirmSeen, "восстановление спрашивает подтверждение, прежде чем что-то менять");
const stillThere = await page.evaluate(async () => (await fetch("/reviews.json")).json());
ok(
  stillThere.length === 1 && stillThere[0].title === "Стенд-ап Икс",
  "отказ от подтверждения ничего не стёр"
);

console.log("Восстановление после подтверждения действительно заменяет данные");
await page.evaluate(async (webp) => {
  window.confirmDialog = async () => true;
  const dt = new DataTransfer();
  const file = new File(
    [
      JSON.stringify({
        format: "tasteid-backup",
        files: { "reviews.json": [{ title: "Из резервной копии", id: 1 }] },
        images: { "chars/Другой/пришло.webp": webp },
      }),
    ],
    "b.json",
    { type: "application/json" }
  );
  dt.items.add(file);
  const input = document.getElementById("backup-file");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}, WEBP);
await page.waitForTimeout(600);
const restored = await page.evaluate(async () => (await fetch("/reviews.json")).json());
ok(
  restored.length === 1 && restored[0].title === "Из резервной копии",
  "после подтверждения данные заменились содержимым файла"
);
const restoredImage = await page.evaluate(() =>
  window.__fakeFiles.get("TasteID/chars/Другой/пришло.webp")
);
ok(restoredImage === WEBP, "картинка из резервной копии тоже легла на диск, туда, откуда её брали");

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nрезервная копия работает");
