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
    if (method === "DELETE") {
      const entry = gh.files.get(filePath);
      if (!entry) return respond(404, { message: "Not Found" });
      const body = JSON.parse(req.postData() || "{}");
      if (body.sha !== entry.sha) return respond(409, { message: "sha does not match" });
      gh.files.delete(filePath);
      return respond(200, { commit: {} });
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

console.log("Удаление обложки на устройстве подчищает её и в репозитории");
// Имитируем файл, уже засинхронизированный раньше (смена обложки в
// add.js/chars-edit.js/favorites-edit.js кладёт такие в covers-backup —
// см. её же комментарий у deleteRemoteMedia в app/js/sync.js).
gh.files.set("covers-backup/старая.webp", { base64: WEBP, sha: nextSha() });
// deleteRemoteMedia ничем не сигналит о своём завершении (тихая
// попытка, см. её же комментарий в sync.js) — ждём фиксированную паузу.
await page.evaluate(() => window.deleteRemoteMedia("/covers-backup/старая.webp"));
await page.waitForTimeout(500);
ok(
  !gh.files.has("covers-backup/старая.webp"),
  "файл, удалённый на устройстве, пропал и из репозитория — не будет подтянут обратно как «новый»"
);

console.log(
  "Осиротевшая обложка, удалённая на ДРУГОМ устройстве, — не заливается обратно, а удаляется и здесь"
);
// Кладём файл прямо на подставной диск и синхронизируем по-настоящему –
// так у него появляется настоящая entry (hash+sha) в состоянии
// синхронизации, как будто эту обложку когда-то раньше отправили
// отсюда же (а не подделываем entry напрямую).
await page.evaluate(
  (webp) => window.__fakeFiles.set("TasteID/covers-backup/сирота.webp", webp),
  WEBP
);
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Готово"),
  null,
  { timeout: 8000 }
);
ok(
  gh.files.has("covers-backup/сирота.webp"),
  "осиротевшая обложка сначала правда легла в репозиторий"
);

// Другое устройство удалило её там (например, через поиск осиротевших
// обложек в «Истории версий») – это устройство об этом ничего не знает,
// файл у него всё ещё физически лежит на диске.
gh.files.delete("covers-backup/сирота.webp");
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Готово"),
  null,
  { timeout: 8000 }
);
const statusAfterRemoteDelete = await page.evaluate(
  () => document.getElementById("status-sync").textContent
);
ok(
  !gh.files.has("covers-backup/сирота.webp"),
  "не залилась обратно в репозиторий только из-за того, что физически ещё лежала здесь"
);
ok(
  !(await page.evaluate(() => window.__fakeFiles.has("TasteID/covers-backup/сирота.webp"))),
  "и здесь тоже удалилась вместо того, чтобы остаться висеть вечным сиротой"
);
ok(
  /убрано отсюда/i.test(statusAfterRemoteDelete),
  `статус честно сообщил про удаление (статус: «${statusAfterRemoteDelete}»)`
);

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
// Клик по .side-tab на ПК не трогает URL (см. её же комментарий у
// history.replaceState в startSync(), app/js/routes/settings-sync.js) –
// без явного проставления ?panel=sync перед перезагрузкой человек
// после неё оказывался на первой панели по умолчанию («Оформление»),
// а не на «Синхронизации», с которой только что что-то забрал: со
// стороны это выглядело как «забрало что-то и тут же само вышло из
// синхронизации».
ok(
  await page.evaluate(() => location.hash.includes("panel=sync")),
  "после перезагрузки адрес всё ещё указывает на панель «Синхронизация»"
);
ok(
  await page.evaluate(() => !!document.getElementById("sync-now-btn")),
  "и сама панель синхронизации правда открыта после перезагрузки, а не панель по умолчанию"
);

console.log("Картинка, заведённая только на другом устройстве, — её тут не было вообще никогда");
// В отличие от reviews.json (он существует локально хотя бы пустым и
// потому всегда участвует в сравнении), у картинки нет своего «пустого»
// состояния: до этого фикса такой файл ни разу не пытался бы
// скачаться, сколько ни синхронизируйся, — runSync() строил список для
// сравнения только обходом СВОЕГО диска.
gh.files.set("chars/Другой/новая.webp", { base64: WEBP, sha: nextSha() });
// Панель «Синхронизация» уже открыта сама, без клика по .side-tab –
// это и есть то, что чинит history.replaceState() перед перезагрузкой
// выше (см. её же комментарий в settings-sync.js): на телефоне сама
// перезагрузка теперь сразу входит в панель (drill-down), а не
// показывает список разделов, из которого нужно было бы кликнуть.
await page.click("#sync-now-btn");
await page.waitForFunction(
  () => document.getElementById("status-sync")?.textContent?.includes("Готово"),
  null,
  { timeout: 8000 }
);
const neverSeenImage = await page.evaluate(() =>
  window.__fakeFiles.get("TasteID/chars/Другой/новая.webp")
);
ok(
  !!neverSeenImage,
  "картинка, которой тут никогда не было, всё равно забралась при синхронизации"
);
// Картинка тоже пришла через pull – та же перезагрузка через 1200мс
// (см. её же комментарий у второй синхронизации выше), которую нужно
// пережить, прежде чем идти дальше, иначе она случится посреди
// действий следующей проверки.
await page.waitForTimeout(1800);
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
// Панель «Синхронизация» уже открыта сама после прошлой перезагрузки –
// см. её же комментарий у первого такого места выше.
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
// Панель «Синхронизация» уже открыта сама после перезагрузки, решившей
// конфликт, – см. её же комментарий у первого такого места выше.
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
