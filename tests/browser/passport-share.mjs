// Обмен паспортом по коду (гист на GitHub) — в настоящем браузере, с
// подставным api.github.com/gists вместо настоящего.
//
// app/js/passports.js: createShareGist()/fetchGistPassport() сами по
// себе просто оборачивают fetch, но здесь важно всё вокруг — что
// панель ведёт себя как ожидается (токен для этого отдельный от
// токена синхронизации, блок свёрнут по умолчанию и не схлопывается
// сам собой при перерисовке), что созданный код и правда открывает
// тот же паспорт на другой стороне, и что неверный код даёт понятную
// ошибку, а не тишину.
//
// Запуск: node tests/browser/passport-share.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-share-"));
const port = 8700 + (process.pid % 200);
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

// Подставной Gist API: создание и чтение по id, ровно то, чем
// пользуются createShareGist()/fetchGistPassport() в passports.js.
// Настоящие id гистов — 32-символьный hex, поэтому и здесь такие же:
// extractGistId() в приложении ищет именно такую строку.
const gists = new Map();
let idCounter = 0;
const nextGistId = () => (++idCounter).toString(16).padStart(32, "a");

async function handleGithub(route) {
  const req = route.request();
  const url = new URL(req.url());
  const method = req.method();
  const p = url.pathname;
  const respond = (status, body) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  if (p === "/gists" && method === "POST") {
    const body = JSON.parse(req.postData() || "{}");
    const id = nextGistId();
    gists.set(id, body);
    return respond(201, { id, files: body.files });
  }
  const m = p.match(/^\/gists\/([^/]+)$/);
  if (m && method === "GET") {
    const g = gists.get(m[1]);
    if (!g) return respond(404, { message: "Not Found" });
    return respond(200, { files: g.files });
  }
  return respond(404, { message: "не подставлено в тесте: " + p });
}

const browser = await chromium.launch();
const context = await browser.newContext({ locale: "ru-RU" });
const page = await context.newPage();
page.on("pageerror", (e) => failures.push("JS: " + e.message));
await page.route("https://api.github.com/**", handleGithub);

await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".side-tab");
await page.evaluate(async () => {
  await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Берсерк", grade: "vyskazyvanie" }),
  });
});

console.log("Открытие панели «Обмен»");
await page.click('.side-tab[data-panel="passports"]');
await page.waitForTimeout(400);
ok(
  await page.evaluate(() => !!document.querySelector(".pp-share")),
  "блок «Поделиться кодом» есть"
);
ok(
  (await page.evaluate(() => document.querySelector(".pp-share > summary")?.textContent)) ===
    "Поделиться кодом, без файла",
  "заголовок свёрнут по умолчанию"
);

await page.click(".pp-share > summary");
await page.waitForTimeout(200);
ok(
  await page.evaluate(() => !!document.getElementById("pp-share-token")),
  "без токена показана настройка токена"
);
ok(
  await page.evaluate(() =>
    document.querySelector('a[href*="scopes=gist"]')?.href.includes("scopes=gist")
  ),
  "ссылка на создание токена ведёт сразу на форму с галочкой gist"
);

console.log("Сохранение токена и создание кода");
await page.fill("#pp-share-token", "ghp_sharetoken");
await page.click("#pp-share-save-token");
await page.waitForTimeout(300);
ok(
  (await page.evaluate(() => localStorage.getItem("tasteid_share_token"))) === "ghp_sharetoken",
  "токен сохранён отдельно от токена синхронизации"
);
ok(
  await page.evaluate(() => !!document.getElementById("pp-share-make")),
  "после сохранения токена показана кнопка «Создать код», а не форма настройки заново"
);

await page.click("#pp-share-make");
await page.waitForFunction(() => !!document.getElementById("pp-share-code-out"), null, {
  timeout: 5000,
});
const code = await page.evaluate(() => document.getElementById("pp-share-code-out").value);
ok(/^[0-9a-f]{32}$/.test(code), `код показан как обычная строка, не как файл: "${code}"`);
ok(gists.size === 1, "гист действительно создан один раз");
const createdItems = JSON.parse(Object.values([...gists.values()][0].files)[0].content).items;
ok(
  createdItems.some((i) => i.title === "Берсерк"),
  "в код зашит тот же паспорт, что строит buildMyPassport()"
);

console.log("Открытие чужого кода на приёмной стороне");
// Тот же браузерный контекст = тот же localStorage, что и своя запись
// выше, — значит нужен второй, чистый контекст ровно как у другого
// человека на другом устройстве.
const context2 = await browser.newContext({ locale: "ru-RU" });
const page2 = await context2.newPage();
page2.on("pageerror", (e) => failures.push("JS (приёмная сторона): " + e.message));
await page2.route("https://api.github.com/**", handleGithub);
await page2.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page2.waitForSelector(".side-tab");
await page2.click('.side-tab[data-panel="passports"]');
await page2.waitForTimeout(400);
await page2.click(".pp-share > summary");
await page2.waitForTimeout(200);
await page2.fill("#pp-share-code-in", code);
await page2.click("#pp-share-open");
await page2.waitForFunction(() => !!document.querySelector(".pp-loaded"), null, { timeout: 5000 });
ok(
  !!(await page2.evaluate(() => document.querySelector(".pp-loaded")?.textContent)),
  "чужой паспорт загрузился по коду, без файла — тем же путём, что и файловая загрузка"
);
const guest = await page2.evaluate(() =>
  JSON.parse(localStorage.getItem("tasteid_guest_passport"))
);
ok(
  guest?.items?.some((i) => i.title === "Берсерк"),
  "загруженный паспорт содержит правильные данные"
);

console.log("Неверный код");
await page2.evaluate(() => {
  window.guestPassport = null;
  localStorage.removeItem("tasteid_guest_passport");
  window.renderPassports();
});
await page2.waitForTimeout(200);
await page2.fill("#pp-share-code-in", "0000000000000000000000000000000000000000");
await page2.click("#pp-share-open");
await page2.waitForFunction(
  () => {
    const t = document.getElementById("pp-share-status")?.textContent || "";
    return t.length > 0 && t !== "Загружаем…";
  },
  null,
  { timeout: 5000 }
);
const errText = await page2.evaluate(() => document.getElementById("pp-share-status").textContent);
ok(/не найден/.test(errText), `несуществующий код даёт понятную ошибку, не тишину: "${errText}"`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nобмен по коду работает");
