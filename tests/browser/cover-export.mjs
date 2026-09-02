// Снимок (html2canvas) не должен стучаться к AniList/TMDB заново,
// если обложка уже когда-то сохранена резервной копией — в настоящем
// браузере, с настоящим локальным файлом на диске хранилища.
//
// Раньше при выгрузке тир-листа/статистики/любимого в картинку
// js/config.js: proxyImagesToDataUrls() всегда сперва шёл за оригиналом
// обложки напрямую (или через wsrv.nl), даже когда та же самая
// картинка уже лежит резервной копией на диске (core/api.js:
// backupCover) — у AniList есть защита от ботов, которая иногда
// отсеивает именно такой запрос "из ниоткуда", и обложка на снимке
// пропадала, хотя в приложении на живой странице показывалась и файл
// резервной копии был на месте. Теперь резервная копия (data-fallback,
// тот же адрес, что и обычный сбой картинки на странице) пробуется
// первой, без единого обращения наружу.
//
// Запуск: node tests/browser/cover-export.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-coverexp-"));
mkdirSync(join(vaultDir, "covers-backup"), { recursive: true });
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
writeFileSync(join(vaultDir, "covers-backup", "test.png"), PNG_1X1);

const port = 8960;
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

// resourceType() отличает обычную загрузку <img> (её браузер запускает
// сам, как только видит src в разметке, — это происходит на любой
// карточке и не имеет отношения к предмету проверки) от настоящего
// fetch()/xhr, которым proxyImagesToDataUrls() идёт за данными для
// html2canvas. Считаем только второе.
let fetchedExternal = false;
const flagExternalFetch = (route) => {
  const type = route.request().resourceType();
  if (type === "fetch" || type === "xhr") fetchedExternal = true;
  route.abort();
};
await page.route("https://s4.anilist.invalid.test/**", flagExternalFetch);
await page.route("https://wsrv.nl/**", flagExternalFetch);

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);

console.log("Есть резервная копия на диске");
const withBackup = await page.evaluate(async () => {
  const div = document.createElement("div");
  div.innerHTML =
    '<img src="https://s4.anilist.invalid.test/fake.png" data-fallback="/covers-backup/test.png" data-placeholder="data:image/png;base64,AAAA">';
  document.body.appendChild(div);
  const restore = await window.proxyImagesToDataUrls(div);
  const img = div.querySelector("img");
  const finalSrc = img.src;
  restore();
  const restoredSrc = img.src;
  div.remove();
  return { finalSrc, restoredSrc };
});
ok(
  withBackup.finalSrc.startsWith("data:image/png;base64,"),
  "картинка на снимке взята как data:-URL из локального файла резервной копии"
);
ok(!fetchedExternal, "ни AniList, ни wsrv.nl не тревожили — файл уже был на диске");
ok(
  withBackup.restoredSrc === "https://s4.anilist.invalid.test/fake.png",
  "restore() вернул исходный внешний адрес на живую страницу после снимка"
);

console.log("Резервной копии нет — старый путь (оригинал, потом wsrv.nl) не сломан");
fetchedExternal = false;
const withoutBackup = await page.evaluate(async () => {
  const div = document.createElement("div");
  div.innerHTML =
    '<img src="https://s4.anilist.invalid.test/nofallback.png" data-placeholder="data:image/png;base64,AAAA">';
  document.body.appendChild(div);
  const restore = await window.proxyImagesToDataUrls(div);
  const img = div.querySelector("img");
  const finalSrc = img.src;
  restore();
  div.remove();
  return { finalSrc };
});
ok(fetchedExternal, "без резервной копии всё ещё пробует оригинал/wsrv.nl, а не сдаётся сразу");
ok(
  withoutBackup.finalSrc === "data:image/png;base64,AAAA",
  "а когда и это не удалось — подставлена заглушка, а не пусто"
);
ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nснимок сначала берёт то, что уже на диске");
