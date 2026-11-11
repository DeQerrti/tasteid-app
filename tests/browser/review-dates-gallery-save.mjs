// Две ошибки, которые портили данные молча:
//
// 1. Даты отзыва. Редактор подставлял сегодняшнюю дату в пустое поле
//    «Начато» (оно у «Завершено» необязательное). Отзыв, где была только
//    дата завершения, после «открыл → сохранил» получал «Начато: сегодня» –
//    позже самого «Завершено». В реальном хранилище так испорчена 21
//    запись. Теперь пустое поле остаётся пустым, а сохранение с началом
//    позже конца не проходит.
//
// 2. Галерея картинок записи («Любимое», отзыв). Файл удалялся ДО
//    сохранения записи, ответ сервера не проверялся: при неудачной записи
//    она оставалась со ссылкой на уже стёртый файл. Теперь сначала
//    сохраняется запись, файл – только после успеха; при ошибке запись
//    откатывается, файл цел.
//
// Запуск: node tests/browser/review-dates-gallery-save.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-dates-gallery-"));
const port = 8600 + (process.pid % 90);
const base = `http://127.0.0.1:${port}`;

// Запись «Любимого» с двумя картинками в галерее – файлы кладём прямо
// на диск, без загрузки через интерфейс.
mkdirSync(join(vaultDir, "covers-backup"), { recursive: true });
writeFileSync(join(vaultDir, "covers-backup", "fav-a.webp"), "a");
writeFileSync(join(vaultDir, "covers-backup", "fav-b.webp"), "b");
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([
    {
      id: 1,
      type: "character",
      name: "Тест галереи",
      image: null,
      image_backup: "/covers-backup/fav-a.webp",
      image_gallery: ["/covers-backup/fav-a.webp", "/covers-backup/fav-b.webp"],
    },
  ])
);

const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const saveRes = await fetch(`${base}/api/save-review`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "Только дата завершения",
    type: "book",
    status: "completed",
    date_start: null,
    date_end: "2024-01-18",
  }),
});
const reviewId = (await saveRes.json()).id;
const readReview = async () =>
  (await (await fetch(`${base}/reviews.json?_=${Date.now()}`)).json()).find(
    (r) => r.id === reviewId
  );

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

console.log("Отзыв без даты начала: открыть и сохранить, ничего не трогая");
await page.goto(`${base}/add.html?edit=${reviewId}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("edit-banner")?.style.display === "flex");
ok((await page.inputValue("#f-date-start")) === "", "поле «Начато» пустое, а не сегодняшняя дата");
ok((await page.inputValue("#f-date-end")) === "2024-01-18", "поле «Завершено» – дата из файла");
await page.click("#btn-save");
await page.waitForFunction(
  () => document.getElementById("status")?.classList.contains("ok"),
  null,
  {
    timeout: 5000,
  }
);
let saved = await readReview();
ok(saved.date_start === null, `в файле date_start осталось пустым (сейчас: ${saved.date_start})`);
ok(saved.date_end === "2024-01-18", `в файле date_end не изменилось (сейчас: ${saved.date_end})`);

// Обе кнопки сохранения подписаны одинаково (раньше сверху «Сохранить
// изменения», снизу «Сохранить»), и в форме нет красной кнопки массового
// удаления тегов – оно теперь внутри списка тегов.
console.log("Кнопки редактора: одна подпись сохранения, удаление тегов в списке тегов");
const topLabel = (await page.textContent("#btn-save")).trim();
const bottomLabel = (await page.textContent("#btn-save-bottom")).trim();
ok(topLabel === bottomLabel, `подписи совпадают («${topLabel}» / «${bottomLabel}»)`);
ok(
  (await page.locator(".ed-tag-tools .btn-new-danger").count()) === 0,
  "у поиска тегов нет красной «Удалить»"
);
await page.click('.ed-tag-tools .btn-new:has-text("Все теги")');
await page.click("#tm-bulk-start-btn");
ok(await page.isVisible("#tm-bulk-bar"), "«Удалить несколько» в списке тегов включает выбор");
ok(await page.isHidden("#tm-bulk-start-btn"), "в режиме выбора ссылка «Удалить несколько» скрыта");
await page.evaluate(() => window.closeTagModal());
ok(await page.isHidden("#tag-modal-overlay"), "окно тегов закрывается");

console.log("Начало позже конца – сохранение не проходит");
await page.fill("#f-date-start", "2026-06-11");
await page.click("#btn-save");
await page.waitForFunction(
  () => document.getElementById("status")?.classList.contains("err"),
  null,
  {
    timeout: 5000,
  }
);
saved = await readReview();
ok(saved.date_start === null, `файл не изменился (date_start: ${saved.date_start})`);

console.log("Галерея: сервер не записал – файл не удаляется, запись откатывается");
await page.route("**/api/save-favorite", (route) =>
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "диск занят" }),
  })
);
const failed = await page.evaluate(async () => {
  const r = (await (await fetch("/favorites.json")).json())[0];
  const images = [...r.image_gallery];
  const fields = { gallery: "image_gallery", active: "image_backup", external: "image" };
  const persist = (x) => window.postRecordOrThrow("/api/save-favorite", { ...x, _editId: x.id });
  let error = null;
  try {
    await window.removeGalleryImage(r, images[0], images, fields, persist);
  } catch (e) {
    error = e.message;
  }
  return { error, active: r.image_backup, gallery: r.image_gallery };
});
ok(failed.error === "диск занят", `ошибка сервера дошла до вызывающего (сейчас: ${failed.error})`);
ok(existsSync(join(vaultDir, "covers-backup", "fav-a.webp")), "файл картинки остался на диске");
ok(
  failed.active === "/covers-backup/fav-a.webp" && failed.gallery.length === 2,
  "поля записи вернулись к прежним"
);

console.log("Галерея: сервер записал – запись без картинки, файл удалён");
await page.unroute("**/api/save-favorite");
await page.evaluate(async () => {
  const r = (await (await fetch("/favorites.json")).json())[0];
  const images = [...r.image_gallery];
  const fields = { gallery: "image_gallery", active: "image_backup", external: "image" };
  const persist = (x) => window.postRecordOrThrow("/api/save-favorite", { ...x, _editId: x.id });
  await window.removeGalleryImage(r, images[0], images, fields, persist);
});
const fav = (await (await fetch(`${base}/favorites.json?_=${Date.now()}`)).json())[0];
ok(
  fav.image_backup === "/covers-backup/fav-b.webp",
  `активной стала вторая картинка (сейчас: ${fav.image_backup})`
);
ok(fav.image_gallery.length === 1, `в галерее одна картинка (сейчас: ${fav.image_gallery.length})`);
ok(!existsSync(join(vaultDir, "covers-backup", "fav-a.webp")), "файл первой картинки удалён");

// 3. Оценка на карточке «Любимого». Раньше её искали по названию+типу
//    по всем отзывам и брали первый попавшийся – у отзывов-дублей (сезоны
//    под одним названием) карточка показывала чужую оценку. Новый отзыв
//    встаёт в начало списка, поэтому «не любимый» дубль заводим вторым:
//    старый поиск нашёл бы именно его.
console.log("«Любимое»: у дублей карточка показывает оценку своей записи");
const postReview = (body) =>
  fetch(`${base}/api/save-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
await postReview({
  title: "Дубль",
  type: "anime",
  status: "completed",
  grade: "rezonans",
  favorite: true,
});
await postReview({
  title: "Дубль",
  type: "anime",
  status: "completed",
  grade: "etalon",
  favorite: false,
});
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[aria-controls="tab-favorites"]');
await page.waitForSelector("#tab-favorites .review-card-wrap .card-grade-text", { timeout: 5000 });
const shown = await page.textContent("#tab-favorites .review-card-wrap .card-grade-text");
const expected = await page.evaluate(() => window.gradeValueLabel("rezonans"));
ok(shown === expected, `на карточке оценка любимой записи «${expected}» (сейчас: «${shown}»)`);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
