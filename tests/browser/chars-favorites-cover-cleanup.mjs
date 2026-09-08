// Персонажи и "Любимое" — та же проверка, что tests/browser/
// cover-backup-cleanup.mjs делает для отзывов, только для двух других
// редакторов, которые пользуются тем же самым /api/backup-cover и тем
// же самым covers-backup/.
//
// favorites-edit.js больше не удаляет ничего сам за картинку персонажа/
// персоны (см. её же комментарий у favImageGallery в favorites-edit.js
// и у coverGallery в add-cover.js) — все резервные копии, когда-либо
// сделанные для записи, копятся и остаются на диске что при замене
// ссылки, что при уходе со страницы без сохранения; удалить может
// только явный крестик в мини-галерее (не проверяется здесь отдельно —
// см. cover-backup-cleanup.mjs, тот же компонент js/gallery-modal.js).
// chars-edit.js в этой правке не менялся вовсе — устроен иначе (весь
// тир-лист правится в памяти и пишется на диск разом кнопкой
// "Сохранить всё"): черновая копия обложки тайтла как удалялась сразу
// при замене (нечем перезаписать ещё не сохранённое), так и удаляется;
// старая копия, уже лежавшая на диске, — как и раньше, только после
// того, как saveAll() подтвердит новую версию. У персонажа в модалке
// добавления та же логика, что и раньше: черновая копия удаляется сразу
// же и при замене ссылки, и при закрытии модалки без добавления.
//
// Запуск: node tests/browser/chars-favorites-cover-cleanup.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-charsfavcleanup-"));
const port = 8971;
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
// backupCover() качает картинку на СЕРВЕРЕ — page.route() до него не
// достаёт, нужен настоящий, реально слушающий HTTP-сервер картинок
// (см. tests/browser/cover-backup-cleanup.mjs).
const sourceServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "image/png" });
  res.end(GREEN);
});
await new Promise((r) => sourceServer.listen(0, "127.0.0.1", r));
const sourcePort = sourceServer.address().port;
const imgUrl = (n) => `http://127.0.0.1:${sourcePort}/${n}.png`;

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

console.log("«Любимое»: замена ссылки, потом сохранение");
await page.goto(`http://127.0.0.1:${port}/#/favorites-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#f-name");
await page.fill("#f-name", "Тест любимого");
await page.fill("#f-image", imgUrl("fav-one"));
await page.waitForFunction(() => document.getElementById("f-image-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(listBackups().length === 1, `после первой ссылки один файл (сейчас: ${listBackups().length})`);

await page.fill("#f-image", imgUrl("fav-two"));
await page.waitForFunction(() => document.getElementById("f-image-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 2,
  `после замены ссылки старая копия НЕ удалена — теперь два файла (сейчас: ${listBackups().length})`
);

await page.click("#btn-save");
// Успешное сохранение НОВОЙ записи тут же вызывает resetFavToNew(),
// который сам стирает текст статуса вместе с остальной формой (см.
// тот же манёвр в tests/browser/cover-backup-cleanup.mjs) — ждём
// земли: запись действительно появилась в favorites.json.
await page.waitForFunction(
  async () =>
    (await (await fetch("/favorites.json")).json()).some((f) => f.name === "Тест любимого"),
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 2,
  `после сохранения обе копии на месте — image_gallery сохранил обе (сейчас: ${listBackups().length})`
);

console.log(
  "Персонажи: обложка тайтла — черновая замена, потом подтверждённое сохранение всего тир-листа"
);
await page.goto(`http://127.0.0.1:${port}/#/chars-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#btn-add-title");
await page.click("#btn-add-title");
await page.waitForSelector("#nt-name", { state: "visible" });
await page.fill("#nt-name", "Тест тайтл");
await page.fill("#nt-cover", imgUrl("cover-one"));
await page.waitForFunction(
  () => document.getElementById("nt-cover-backup").value.length > 0,
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 3,
  `плюс обложка тайтла — теперь три файла всего (сейчас: ${listBackups().length})`
);

await page.fill("#nt-cover", imgUrl("cover-two"));
await page.waitForFunction(
  () => document.getElementById("nt-cover-backup").value.length > 0,
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 3,
  `замена ссылки на обложку тайтла удалила черновую, всё ещё три файла (сейчас: ${listBackups().length})`
);

await page.click("#nt-submit-btn");
await page.waitForTimeout(300);
ok(
  listBackups().length === 3,
  `тайтл добавлен в память, файл обложки цел (сейчас: ${listBackups().length})`
);

console.log("Персонажи: модалка добавления — замена ссылки и закрытие без добавления");
await page.click(".add-char-btn");
await page.waitForSelector("#modal-overlay:not(.hidden)", { timeout: 5000 });
await page.waitForSelector("#m-img", { state: "visible", timeout: 5000 });
await page.fill("#m-name", "Герой");
await page.fill("#m-img", imgUrl("char-one"));
await page.waitForFunction(() => document.getElementById("m-img-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `плюс черновая копия персонажа — четыре файла (сейчас: ${listBackups().length})`
);

await page.fill("#m-img", imgUrl("char-two"));
await page.waitForFunction(() => document.getElementById("m-img-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `замена ссылки персонажа удалила черновую, всё ещё четыре файла (сейчас: ${listBackups().length})`
);

await page.click("#modal-overlay .modal-close, #modal-overlay [onclick*='closeModal']");
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 3,
  `закрытие модалки без добавления удалило черновую копию персонажа (сейчас: ${listBackups().length})`
);

console.log(
  "Сохранение всего тир-листа — файл обложки тайтла остаётся, ничего лишнего не появилось"
);
await page.click("#btn-save");
await page.waitForFunction(
  () => document.getElementById("status-msg")?.textContent?.includes("Сохранено"),
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 3,
  `после «Сохранить всё» по-прежнему три файла: тайтл и вся галерея любимого (сейчас: ${listBackups().length})`
);

console.log(
  "«Любимое»: черновик брошен уходом со страницы — файл остаётся (сама запись не сохранена)"
);
// Раньше это удаляло файл (discardScratchImageBackup при уходе с
// маршрута) – теперь favorites-edit.js ничего сам не чистит (см. её же
// комментарий у favImageGallery выше): бросить страницу, не сохранив
// форму, оставляет уже сделанную резервную копию на диске точно так
// же, как бросить её после замены ссылки. Сама ЗАПИСЬ при этом всё
// равно не попадает в favorites.json – туда что-либо пишет только
// saveEntry().
await page.goto(`http://127.0.0.1:${port}/#/favorites-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#f-name");
await page.fill("#f-name", "Брошенная запись");
await page.fill("#f-image", imgUrl("fav-abandoned"));
await page.waitForFunction(() => document.getElementById("f-image-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `черновик картинки создан — четыре файла (сейчас: ${listBackups().length})`
);
await page.goto(`http://127.0.0.1:${port}/#/chars-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#btn-add-title");
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `уход со страницы без сохранения НЕ удалил черновик — файл остался, всё ещё четыре (сейчас: ${listBackups().length})`
);
ok(
  !(await (
    await fetch(`http://127.0.0.1:${port}/favorites.json`)
  )
    .json()
    .then((f) => f.some((x) => x.name === "Брошенная запись"))),
  "брошенная запись не попала в favorites.json"
);

console.log("Персонажи: черновая обложка тайтла брошена кнопкой «Отмена», без сохранения");
await page.click("#btn-add-title");
await page.waitForSelector("#nt-name", { state: "visible" });
await page.fill("#nt-name", "Брошенный тайтл");
await page.fill("#nt-cover", imgUrl("cover-abandoned"));
await page.waitForFunction(
  () => document.getElementById("nt-cover-backup").value.length > 0,
  null,
  { timeout: 5000 }
);
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 5,
  `черновик обложки тайтла создан — пять файлов (сейчас: ${listBackups().length})`
);
await page.click('[onclick="toggleNewTitleForm(false)"]');
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `«Отмена» удалила черновик обложки, снова четыре файла (сейчас: ${listBackups().length})`
);

console.log(
  "Персонажи: черновая обложка тайтла и черновая картинка персонажа брошены уходом со всей страницы"
);
await page.click("#btn-add-title");
await page.waitForSelector("#nt-name", { state: "visible" });
await page.fill("#nt-name", "Ещё один брошенный тайтл");
await page.fill("#nt-cover", imgUrl("cover-abandoned-2"));
await page.waitForFunction(
  () => document.getElementById("nt-cover-backup").value.length > 0,
  null,
  { timeout: 5000 }
);
await page.click(".add-char-btn");
await page.waitForSelector("#modal-overlay:not(.hidden)", { timeout: 5000 });
await page.waitForSelector("#m-img", { state: "visible", timeout: 5000 });
await page.fill("#m-name", "Брошенный герой");
await page.fill("#m-img", imgUrl("char-abandoned"));
await page.waitForFunction(() => document.getElementById("m-img-backup").value.length > 0, null, {
  timeout: 5000,
});
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 6,
  `два новых черновика разом (тайтл + персонаж в открытой модалке) — шесть файлов (сейчас: ${listBackups().length})`
);
// page.goto на голый "/" (без хэша) – это уже полноценная навигация верхнего
// уровня в Playwright/CDP, а не мягкий переход внутри уже открытой страницы:
// без хэша в целевом URL нет гарантии, что браузер обойдётся без настоящей
// перезагрузки (см. коммит) – а тогда unmount() просто не успевает
// отработать до того, как контекст страницы обнулится. location.hash = ""
// изнутри уже загруженной страницы – то же самое, что делает клик по
// логотипу/кнопке «назад» в приложении, и гарантированно идёт через
// hashchange/renderRoute(), не трогая сам документ.
await page.evaluate(() => {
  location.hash = "";
});
await page.waitForFunction(() => !location.hash, null, { timeout: 5000 });
await new Promise((r) => setTimeout(r, 300));
ok(
  listBackups().length === 4,
  `уход со всего маршрута #/chars-edit удалил оба черновика (форма + открытая модалка), снова четыре файла (сейчас: ${listBackups().length})`
);
ok(
  !(await (
    await fetch(`http://127.0.0.1:${port}/characters-tier.json`)
  )
    .json()
    .then((list) => list.some((t) => t.title === "Ещё один брошенный тайтл"))),
  "брошенный тайтл не попал в characters-tier.json"
);

ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

await browser.close();
server.kill();
sourceServer.close();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nперсонажи (как и раньше) не копят заброшенные копии, любимое (нарочно) — копит");
