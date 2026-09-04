// Синхронизация через GitHub — в настоящем браузере, на настоящей
// странице настроек, с подставным GitHub вместо настоящего api.github.com.
//
// app/js/sync.js сам по себе — чистые функции без DOM, но здесь важно
// не это, а то, что вокруг него: подключение (проверка токена, создание
// репозитория), отправка/забор файлов и картинок реальной кнопкой,
// решение конфликтов через UI, и то, что токен никогда не летит никуда,
// кроме api.github.com.
//
// Запуск: node tests/browser/sync.mjs [папка-хранилища]
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildMobileBundle } from "../fixtures/mobile-bundle.js";

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

console.log("sync.js подключён на всех страницах приложения");
// Автосинхронизация ловит сохранения через fetch. После перехода на SPA
// (см. план перехода, фаза 4) сохраняют только два отдельных документа —
// index.html (все маршруты) и add.html (он же в iframe-модалке паспорта).
// Если файл забудут подключить на одном из них, сохранённое там просто
// не попадёт в синхронизацию, и заметить это будет нечем.
for (const page of ["index", "add"]) {
  const html = readFileSync(new URL(`../../app/${page}.html`, import.meta.url), "utf8");
  ok(html.includes('src="/js/sync.js'), `app/${page}.html подключает sync.js`);
}

const vaultDir = process.argv[2] || mkdtempSync(join(tmpdir(), "tasteid-sync-"));
const port = 8900 + (process.pid % 200);
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

// Общая сборка на все проверки в браузере — см.
// tests/fixtures/mobile-bundle.js.
const bundleOut = buildMobileBundle("mobile.bundle.js");

// ── Подставной GitHub ────────────────────────────
// Не настоящий api.github.com, а его минимальный слепок: пользователь,
// репозиторий, и Contents API поверх файлов в памяти. Ровно то, чем
// пользуется app/js/sync.js — этого достаточно, чтобы проверить
// подключение, отправку/забор и конфликты, не завися от сети.
const gh = { login: "tester", repoExists: false, files: new Map() };
let shaCounter = 0;
const nextSha = () => `sha${++shaCounter}`;
const b64 = (text) => Buffer.from(text, "utf8").toString("base64");

async function handleGithub(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const p = url.pathname;
  const respond = (status, body) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (p === "/user" && method === "GET") return respond(200, { login: gh.login });

  if (/^\/repos\/[^/]+\/[^/]+$/.test(p) && method === "GET") {
    return gh.repoExists
      ? respond(200, { default_branch: "main" })
      : respond(404, { message: "Not Found" });
  }

  if (p === "/user/repos" && method === "POST") {
    gh.repoExists = true;
    return respond(201, { default_branch: "main" });
  }

  // Git Trees API – см. её же комментарий у getRepoTree() в app/js/sync.js:
  // один запрос на список всех файлов репозитория вместо одного на
  // каждый. Слепок собирается прямо из gh.files, а не хранится отдельно –
  // в тесте это одно и то же дерево, других веток тут не бывает.
  if (/^\/repos\/[^/]+\/[^/]+\/git\/trees\/main$/.test(p) && method === "GET") {
    return respond(200, {
      truncated: false,
      tree: [...gh.files.entries()].map(([path, entry]) => ({
        path,
        type: "blob",
        sha: entry.sha,
      })),
    });
  }

  const contentsMatch = p.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
  if (contentsMatch) {
    const filePath = decodeURIComponent(contentsMatch[1]);
    if (method === "GET") {
      const entry = gh.files.get(filePath);
      if (!entry) return respond(404, { message: "Not Found" });
      // GitHub режет base64 на строки — проверяем заодно, что sync.js
      // правда убирает эти переносы перед использованием.
      return respond(200, { content: entry.base64.replace(/(.{60})/g, "$1\n"), sha: entry.sha });
    }
    if (method === "PUT") {
      const body = JSON.parse(req.postData() || "{}");
      const sha = nextSha();
      gh.files.set(filePath, { base64: body.content, sha });
      return respond(200, { content: { sha } });
    }
  }
  return respond(404, { message: "не подставлено в тесте: " + p });
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 851 },
  hasTouch: true,
  isMobile: true,
  // Без этого mobile/src/main.js берёт язык из navigator.language, а
  // playwright по умолчанию отдаёт en-US — сообщения были бы
  // по-английски, а проверки ниже ищут русский текст.
  locale: "ru-RU",
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
// Порядок важен (см. tests/browser/backup.mjs): универсальный
// перехватчик регистрируется первым, точечные — после, потому что
// Playwright разбирает маршруты от последнего зарегистрированного к
// первому.
await page.route("**/*", (r) =>
  r.request().url().includes(`127.0.0.1:${port}`) ? r.continue() : r.abort()
);
await page.route(`**/js/mobile.bundle.js**`, (route) =>
  route.fulfill({ path: bundleOut, contentType: "text/javascript" })
);
await page.route("https://api.github.com/**", handleGithub);

await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
// Маршрут монтируется асинхронно (см. js/router.js).
await page.waitForSelector(".side-tab");
await page.waitForTimeout(600);
ok(
  await page.evaluate(() => typeof window.__syncBeforeQuit === "function"),
  "window.__syncBeforeQuit есть — то, что electron/main.js зовёт перед закрытием окна"
);

const WEBP = "UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA==";
await page.evaluate(async (webp) => {
  await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Локальная запись" }),
  });
  await fetch("/api/upload-char-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "Тайтл", filename: "картинка.webp", contentBase64: webp }),
  });
}, WEBP);

console.log("Подключение");
await page.click('.side-tab[data-panel="sync"]');
await page.waitForTimeout(300);
ok(
  await page.evaluate(() => !!document.getElementById("sync-token")),
  "без подключения показывается форма настройки"
);

await page.fill("#sync-token", "ghp_testtoken");
await page.fill("#sync-repo", "tasteid-vault");
await page.click("#sync-connect-btn");
await page.waitForTimeout(500);
ok(
  await page.evaluate(() => !!document.getElementById("sync-now-btn")),
  "после подключения показана кнопка «Синхронизировать сейчас»"
);
ok(gh.repoExists, "репозитория не было — приложение создало его само");
// getSyncConfig(), а не голый ключ localStorage – он теперь привязан к
// хранилищу (см. её же комментарий у vaultScopedKey в app/js/sync.js).
const savedConfig = await page.evaluate(() => window.getSyncConfig());
ok(
  savedConfig?.owner === "tester" && savedConfig?.repo === "tasteid-vault" && savedConfig?.token,
  "токен, владелец и репозиторий сохранились на устройстве"
);

console.log("Первая синхронизация — всё только здесь, значит, всё отправляется");
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Готово"),
  null,
  { timeout: 8000 }
);
const afterPush = await page.evaluate(() => document.getElementById("status-sync").textContent);
ok(/отправлено 5/.test(afterPush), `все 5 файлов ушли в репозиторий (статус: «${afterPush}»)`);
ok(
  gh.files.has("reviews.json") && gh.files.has("chars/Тайтл/картинка.webp"),
  "и данные, и картинка действительно легли в подставной репозиторий"
);
const pushedTitle = JSON.parse(
  Buffer.from(gh.files.get("reviews.json").base64, "base64").toString("utf8")
)[0]?.title;
ok(pushedTitle === "Локальная запись", "содержимое файла в репозитории — то самое, что отправляли");

console.log("Вторая синхронизация — поменялось только в репозитории, значит, забираем");
gh.files.set("reviews.json", {
  base64: b64(JSON.stringify([{ title: "Пришло с другого устройства" }], null, 2)),
  sha: nextSha(),
});
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Готово"),
  null,
  { timeout: 8000 }
);
// Проверяем сразу, не дожидаясь перезагрузки страницы (она идёт через
// 1200мс, но здесь важна не сама перезагрузка, а что запись правда
// легла в хранилище): в тестовой подмене Capacitor.Filesystem файлы
// живут только в памяти вкладки, и настоящая перезагрузка страницы
// снесла бы их вместе со всем остальным — на телефоне это настоящий
// диск, там так не бывает.
const pulledFile = await page.evaluate(() => window.__fakeFiles.get("TasteID/reviews.json"));
ok(
  JSON.parse(pulledFile || "[]")[0]?.title === "Пришло с другого устройства",
  "после забора локальные данные заменились содержимым из репозитория"
);
await page.waitForTimeout(1800); // теперь дать перезагрузке случиться, прежде чем идти дальше
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(600);

console.log("Третья синхронизация — поменялось и здесь, и там, значит, конфликт");
await page.evaluate(async () => {
  await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Правка прямо перед конфликтом" }),
  });
});
gh.files.set("reviews.json", {
  base64: b64(JSON.stringify([{ title: "Другая правка в репозитории" }], null, 2)),
  sha: nextSha(),
});
await page.click('.side-tab[data-panel="sync"]');
await page.waitForTimeout(300);
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.querySelectorAll("#sync-conflicts .edit-banner").length > 0,
  null,
  { timeout: 8000 }
);
ok(true, "конфликт показан человеку, а не решён молча за него");

await page.click("#sync-conflicts button[onclick*=\"'remote'\"]");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Конфликты решены"),
  null,
  { timeout: 8000 }
);
const afterConflict = await page.evaluate(() => window.__fakeFiles.get("TasteID/reviews.json"));
ok(
  JSON.parse(afterConflict || "[]")[0]?.title === "Другая правка в репозитории",
  "выбор «Взять оттуда» подставил версию из репозитория"
);
await page.waitForTimeout(1800); // дать перезагрузке случиться, прежде чем отключаться
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(600);

console.log("Автосинхронизация — сохранение без нажатия кнопки и без открытой вкладки");
// Ни вкладку «Синхронизация», ни саму кнопку не трогаем — сохранение
// проходит через тот же fetch, что и на любой другой странице
// приложения, и должно само дойти до репозитория через паузу.
await page.evaluate(async () => {
  await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Автосинхронизация без кнопки" }),
  });
});
let autoPushed = false;
for (let i = 0; i < 20 && !autoPushed; i++) {
  await page.waitForTimeout(500);
  const entry = gh.files.get("reviews.json");
  const title = entry && JSON.parse(Buffer.from(entry.base64, "base64").toString("utf8"))[0]?.title;
  if (title === "Автосинхронизация без кнопки") autoPushed = true;
}
ok(
  autoPushed,
  "изменение само дошло до репозитория через паузу после сохранения — без нажатия «Синхронизировать сейчас»"
);

console.log("Отключение");
await page.click('.side-tab[data-panel="sync"]');
await page.waitForTimeout(300);
await page.evaluate(() => (window.confirmDialog = async () => true));
await page.click('#panel-sync button[onclick="disconnectSync()"]');
await page.waitForTimeout(300);
ok(
  await page.evaluate(() => window.getSyncConfig() === null),
  "отключение стирает токен и репозиторий с устройства"
);
ok(
  await page.evaluate(() => !!document.getElementById("sync-token")),
  "после отключения снова показана форма настройки"
);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nсинхронизация работает");
