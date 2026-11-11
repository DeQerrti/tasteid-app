// «Любимое»: порядок любого раздела – сеткой на #/favorites-order, а не
// списком под формой редактора записи.
//
// Проверяет:
//  - перетаскивание в сетке персонажей и сохранение: записи раздела
//    меняются местами, записи других разделов в favorites.json стоят где
//    стояли;
//  - то же для своего раздела (заведённого в настройках);
//  - в редакторе записи больше нет списка всех записей, а удалить запись
//    можно кнопкой внизу формы;
//  - «Добавить» с вкладки открывает редактор сразу с типом раздела;
//  - превью карточки в редакторе повторяет введённое имя.
//
// Запуск: node tests/browser/favorites-order.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-fav-order-"));
// Разделы вперемешку – чтобы было видно, что чужие записи не двигаются.
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([
    { id: 1, type: "character", name: "Альфа" },
    { id: 2, type: "person", subtype: "director", name: "Режиссёр" },
    { id: 3, type: "character", name: "Бета" },
    { id: 4, type: "op", name: "Опенинг 1" },
    { id: 5, type: "character", name: "Гамма" },
    { id: 6, type: "op", name: "Опенинг 2" },
  ])
);
writeFileSync(
  join(vaultDir, "site-settings.json"),
  JSON.stringify({ favCollections: [{ id: "op", label: "Опенинги" }] })
);
const readFav = () => JSON.parse(readFileSync(join(vaultDir, "favorites.json"), "utf8"));

const port = 8400 + (process.pid % 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

// Перетащить карточку с id from на левую половину карточки с id to
// (встаёт перед ней) – обычными событиями drag, как это делает мышь.
async function dragBefore(from, to) {
  await page.evaluate(
    ({ from, to }) => {
      const src = document.querySelector(`#ro-grids .dnd-item[data-id="${from}"]`);
      const dst = document.querySelector(`#ro-grids .dnd-item[data-id="${to}"]`);
      const dt = new DataTransfer();
      const r = dst.getBoundingClientRect();
      const at = {
        clientX: r.left + 2,
        clientY: r.top + r.height / 2,
        bubbles: true,
        dataTransfer: dt,
      };
      src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      dst.dispatchEvent(new DragEvent("dragover", { ...at, cancelable: true }));
      dst.dispatchEvent(new DragEvent("drop", { ...at, cancelable: true }));
      src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    },
    { from, to }
  );
}
async function saveOrder() {
  await page.click("#ro-btn-save");
  await page.waitForFunction(
    () => document.getElementById("ro-save-status")?.classList.contains("ok"),
    null,
    {
      timeout: 5000,
    }
  );
}

console.log("Порядок персонажей сеткой");
await page.goto(`${base}/#/favorites-order?section=favCharacters`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("#ro-grids .dnd-item");
ok((await page.locator("#ro-grids .dnd-item").count()) === 3, "в сетке три персонажа");
await dragBefore(5, 1);
await saveOrder();
ok(
  JSON.stringify(readFav().map((r) => r.id)) === JSON.stringify([5, 2, 1, 4, 3, 6]),
  `персонажи переставлены, остальные на месте (${readFav().map((r) => r.id)})`
);

console.log("Порядок своего раздела");
await page.goto(`${base}/#/favorites-order?section=op`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('#ro-grids .dnd-item[data-id="6"]');
ok(
  (await page.textContent(".ro-view .section-title")).includes("Опенинги"),
  "заголовок – имя своего раздела"
);
await dragBefore(6, 4);
await saveOrder();
ok(
  JSON.stringify(readFav().map((r) => r.id)) === JSON.stringify([5, 2, 1, 6, 3, 4]),
  `опенинги переставлены, остальные на месте (${readFav().map((r) => r.id)})`
);

console.log("Редактор записи: без списка, с удалением и превью");
await page.goto(`${base}/#/favorites-edit?edit=3`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.getElementById("f-name")?.value === "Бета");
ok(
  (await page.locator(".entry-row, #list-header, .entries-list").count()) === 0,
  "списка всех записей нет"
);
ok(await page.isVisible("#fe-danger"), "кнопка удаления записи видна");
await page.fill("#f-name", "Бета-превью");
ok(
  (await page.textContent("#fe-preview .card-title")).trim() === "Бета-превью",
  "превью повторяет имя"
);
await page.fill("#f-name", "Бета");
await page.click("#fe-danger .link-danger");
await page.click(".confirm-dialog .btn-primary, .confirm-dialog [data-act='ok']");
await page.waitForFunction(
  () => document.getElementById("status")?.classList.contains("ok"),
  null,
  { timeout: 5000 }
);
ok(!readFav().some((r) => r.id === 3), "запись удалена из favorites.json");

console.log("«Добавить» – сразу с типом раздела");
await page.goto(`${base}/#/favorites-edit?type=op`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#f-type", { state: "attached" });
await page.waitForFunction(() => document.getElementById("f-type").value === "op", null, {
  timeout: 5000,
});
ok((await page.inputValue("#f-type")) === "op", "тип новой записи – свой раздел");
ok(await page.isHidden("#fe-danger"), "у новой записи кнопки удаления нет");

console.log("Модалка отзыва показывает, кто из этого тайтла в любимом");
const reviewId = (
  await (
    await fetch(`${base}/api/save-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Тайтл со связями", type: "anime", status: "completed" }),
    })
  ).json()
).id;
const fav = readFav();
fav.find((r) => r.id === 1).linked_review_ids = [reviewId];
writeFileSync(join(vaultDir, "favorites.json"), JSON.stringify(fav));
await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => typeof window.openReviewModal === "function");
await page.evaluate(async (id) => {
  const list = await (await fetch("/reviews.json")).json();
  window.openReviewModal(list.find((r) => r.id === id));
}, reviewId);
await page.waitForSelector(".review-linked-favs .card-char", { timeout: 5000 });
ok(
  (await page.textContent(".review-linked-favs")).includes("Альфа"),
  "в модалке отзыва – связанный персонаж"
);
await page.click(".review-linked-favs .card-char");
ok(
  (await page.textContent("#fav-modal-title")).trim() === "Альфа",
  "клик открывает анкету персонажа"
);

// Автозаполнение с AniList – сам AniList подменён: проверяется, что
// форма заполняется и отзыв привязывается по номеру AniList (ids), а
// сэйю из «Любимого» – по имени в обратном порядке слов.
console.log("Автозаполнение персонажа с AniList");
await fetch(`${base}/api/save-review`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "Совсем другое название",
    type: "anime",
    status: "completed",
    ids: { anilist: 777 },
  }),
});
const favNow = readFav();
favNow.push({ id: 50, type: "person", subtype: "seiyuu", name: "Koyama Rikiya" });
writeFileSync(join(vaultDir, "favorites.json"), JSON.stringify(favNow));
await page.route("https://graphql.anilist.co/**", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        Page: {
          characters: [
            {
              id: 1,
              name: { full: "Kiritsugu Emiya", native: "衛宮切嗣" },
              image: { large: "https://example.invalid/k.png" },
              media: {
                nodes: [
                  {
                    id: 777,
                    idMal: null,
                    title: { romaji: "Fate/Zero", english: null, native: null },
                  },
                ],
                edges: [{ voiceActors: [{ name: { full: "Rikiya Koyama" } }] }],
              },
            },
          ],
        },
      },
    }),
  })
);
await page.goto(`${base}/#/favorites-edit?type=character`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#fe-lookup-q");
await page.fill("#fe-lookup-q", "Kiritsugu");
await page.press("#fe-lookup-q", "Enter");
await page.click(".fe-lookup-item");
ok((await page.inputValue("#f-name")) === "Kiritsugu Emiya", "имя заполнено");
ok((await page.inputValue("#f-from")) === "Fate/Zero", "«Откуда» заполнено");
ok(
  (await page.inputValue("#f-image")) === "https://example.invalid/k.png",
  "ссылка на картинку заполнена"
);
ok(
  (await page.textContent("#linked-titles-list")).includes("Совсем другое название"),
  "отзыв привязан по номеру AniList, хоть название и другое"
);
ok(
  (await page.textContent("#linked-favorites-groups")).includes("Koyama Rikiya"),
  "сэйю из «Любимого» привязан"
);
await page.unroute("https://graphql.anilist.co/**");

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
