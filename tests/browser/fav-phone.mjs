// «Любимое» на телефоне (owner, ноябрь 2026, вариант «А» по макету).
//
// Проверяется:
//   – разделов много (свои заводятся в настройках) – они одной строкой,
//     строка листается, выбранный раздел виден; «+» и «⋯» – в той же
//     строке, кнопок «Добавить» / «Порядок» / камеры на телефоне не видно;
//   – «⋯» открывает шторку: «Добавить», «Изменить порядок», «Сохранить
//     как картинку»; касание мимо закрывает; «Изменить порядок» ведёт в
//     редактор порядка этого раздела;
//   – у «Тайтлов» «+» нет (тайтл попадает в любимое из редактора отзыва);
//   – редактор порядка: «Сохранить» в шапке, 4 колонки; долгое нажатие
//     на карточку (contextmenu) не открывает панель «Размер шрифта /
//     Масштаб»;
//   – форма записи: поиск на AniList – выше картинки;
//   – длинное имя в окне персонажа не уезжает за край;
//   – «Статусы»: семь статусов – одной строкой, выбранный виден;
//   – на компьютере – кнопки, как раньше, значков нет; «Сохранить» в
//     редакторе порядка тоже в шапке.
//
// Запуск: node tests/browser/fav-phone.mjs

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
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

const collections = [
  "Жанры",
  "Опенинги",
  "Студии",
  "Композиторы",
  "Пейринги",
  "Цитаты",
  "Места",
].map((label, i) => ({
  id: "c" + i,
  label,
}));
const statuses = ["current", "onhold", "planning", "s1", "s2", "s3", "s4"];
const reviews = [
  ...statuses.map((status, i) => ({ id: 100 + i, title: "Тайтл " + i, type: "anime", status })),
  { id: 200, title: "Любимый фильм", type: "movie", status: "completed", favorite: true },
  { id: 201, title: "Любимая книга", type: "book", status: "completed", favorite: true },
];
const favorites = [
  { id: 1, type: "character", name: "Phosphophyllite", from: "Houseki no Kuni" },
  { id: 2, type: "character", name: "Альфа" },
  { id: 3, type: "character", name: "Бета" },
  { id: 4, type: "character", name: "Гамма" },
  { id: 5, type: "character", name: "Дельта" },
  { id: 6, type: "c0", name: "Сэйнэн" },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-fav-phone-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "favorites.json"), JSON.stringify(favorites));
writeFileSync(
  join(dir, "site-settings.json"),
  JSON.stringify({
    favCollections: collections,
    statusBuckets: [
      { key: "current", label: "В процессе", removable: false },
      { key: "onhold", label: "Отложено", removable: false },
      { key: "planning", label: "Планирую", removable: false },
      { key: "s1", label: "Пересматриваю", removable: true },
      { key: "s2", label: "Брошено", removable: true },
      { key: "s3", label: "Хочу перечитать", removable: true },
      { key: "s4", label: "Жду продолжения", removable: true },
    ],
  })
);

const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const jsErrors = [];
async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[aria-controls="tab-favorites"]');
  await page.waitForSelector("#tab-favorites .tl-mode-btn", { timeout: 15000 });
  return page;
}
const box = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
const visible = (page, sel) => page.isVisible(sel);

console.log("Телефон: вкладка");
const phone = await open(
  { width: 390, height: 844 },
  { hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
);
await phone.click('#tab-favorites .tl-mode-btn[data-mode="favCharacters"]');
await phone.waitForSelector("#tab-favorites .card-char");
const row = await phone.$eval("#tab-favorites .tl-mode-scroll", (el) => {
  const tops = [...el.querySelectorAll(".tl-mode-btn")].map((b) =>
    Math.round(b.getBoundingClientRect().top)
  );
  const a = el.querySelector(".active").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    count: tops.length,
    oneLine: new Set(tops).size === 1,
    scrolls: el.scrollWidth > el.clientWidth,
    activeSeen: a.left >= r.left - 1 && a.right <= r.right + 1,
  };
});
ok(row.count === 10, `все 10 разделов на месте (${row.count})`);
ok(row.oneLine && row.scrolls, "разделы – одной строкой, строка листается");
ok(row.activeSeen, "выбранный раздел виден");
const head = await box(phone, "#tab-favorites .fav-head .tl-mode-toggle");
const more = await box(phone, '#fav-action-link .fav-ico[aria-haspopup="menu"]');
const plus = await box(phone, '#fav-action-link a.fav-ico[href*="favorites-edit"]');
ok(
  Math.abs(more.top - head.top) < head.height && Math.abs(plus.top - head.top) < head.height,
  "«+» и «⋯» – в строке разделов"
);
ok(more.right <= 390 && plus.width >= 40, "значки на экране и не мельче 40px");
ok(
  !(await visible(phone, "#fav-action-link .admin-add-btn")) &&
    !(await visible(phone, "#fav-camera-btn")),
  "кнопок «Добавить» / «Порядок» / камеры не видно"
);

console.log("Шторка «⋯»");
await phone.click('#fav-action-link .fav-ico[aria-haspopup="menu"]');
const items = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(
  items.join("|") === "Добавить|Изменить порядок|Сохранить как картинку",
  `пункты шторки (${items.join(", ")})`
);
await phone.mouse.click(195, 60);
ok(!(await phone.$(".action-sheet")), "касание мимо закрывает шторку");

await phone.click('#tab-favorites .tl-mode-btn[data-mode="favTitles"]');
await phone.waitForTimeout(200);
ok(!(await phone.$('#fav-action-link a.fav-ico[href*="favorites-edit"]')), "у «Тайтлов» «+» нет");
await phone.click('#fav-action-link .fav-ico[aria-haspopup="menu"]');
const titleItems = await phone.$$eval(".action-sheet .action-sheet-label", (els) =>
  els.map((e) => e.textContent)
);
ok(!titleItems.includes("Добавить"), "у «Тайтлов» в шторке нет «Добавить»");
await phone.click('.action-sheet-item:has-text("Изменить порядок")');
await phone.waitForSelector("#ro-grids .dnd-item");
ok(
  phone.url().includes("section=favTitles"),
  "«Изменить порядок» – в редактор порядка этого раздела"
);

console.log("Редактор порядка");
const save = await box(phone, "#ro-btn-save");
const bar = await box(phone, ".app-topbar");
ok(save.top >= bar.top && save.bottom <= bar.bottom + 1, "«Сохранить» – в шапке");
ok(!(await phone.$(".save-bar")), "внизу плашки «Сохранить порядок» больше нет");
await phone.goto(`${base}/#/favorites-order?section=favCharacters`);
await phone.waitForSelector("#ro-grids .dnd-item");
const cols = await phone.$eval(
  "#ro-grids .dnd-grid",
  (g) => getComputedStyle(g).gridTemplateColumns.split(" ").length
);
ok(cols === 4, `4 колонки (${cols})`);
await phone.$eval("#ro-grids .dnd-item", (el) => {
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: r.left + 10,
      clientY: r.top + 10,
    })
  );
});
await phone.waitForTimeout(300);
ok(
  !(await phone.$("#qa-text-scale")),
  "долгое нажатие на карточку не открывает «Размер шрифта / Масштаб»"
);

console.log("Форма записи");
await phone.goto(`${base}/#/favorites-edit?type=character`);
await phone.waitForSelector("#fe-lookup-q");
const lookup = await box(phone, "#fe-lookup");
const imgbox = await box(phone, ".fe-imgbox");
const name = await box(phone, ".fe-main .field input");
ok(lookup.top < imgbox.top, "поиск на AniList – выше картинки");
ok(name.width > 390 - 60, `поля во всю ширину (${Math.round(name.width)}px)`);

console.log("Окно персонажа");
await phone.goto(`${base}/#/`);
await phone.click('.tab-btn[aria-controls="tab-favorites"]');
await phone.click('#tab-favorites .tl-mode-btn[data-mode="favCharacters"]');
await phone.click('#tab-favorites .card-char[data-fav-id="1"]');
await phone.waitForSelector("#fav-modal-title");
const fits = await phone.$eval("#fav-modal-title", (el) => el.scrollWidth <= el.clientWidth + 1);
ok(fits, "длинное имя целиком в окне");
await phone.keyboard.press("Escape");

console.log("Статусы");
await phone.click('.tab-btn[aria-controls="tab-now"]');
await phone.click('#tab-now .tl-mode-btn[data-mode="s4"]');
await phone.waitForTimeout(250);
const now = await phone.$eval("#tab-now .tl-mode-scroll", (el) => {
  const tops = [...el.querySelectorAll(".tl-mode-btn")].map((b) =>
    Math.round(b.getBoundingClientRect().top)
  );
  const a = el.querySelector(".active").getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    n: tops.length,
    oneLine: new Set(tops).size === 1,
    seen: a.left >= r.left - 1 && a.right <= r.right + 1,
  };
});
ok(now.n === 7 && now.oneLine, "7 статусов – одной строкой");
ok(now.seen, "выбранный последний статус виден");
await phone.close();

console.log("Компьютер");
const desk = await open({ width: 1300, height: 900 });
await desk.click('#tab-favorites .tl-mode-btn[data-mode="favCharacters"]');
ok(await visible(desk, "#fav-action-link .admin-add-btn"), "кнопки «Добавить» / «Порядок» видны");
ok(await visible(desk, "#fav-camera-btn"), "камера видна");
ok(!(await visible(desk, "#fav-action-link .fav-ico")), "значков «+» / «⋯» нет");
await desk.goto(`${base}/#/favorites-order?section=favCharacters`);
await desk.waitForSelector("#ro-grids .dnd-item");
ok(await visible(desk, ".app-topbar #ro-btn-save"), "«Сохранить» в шапке и на компьютере");
await desk.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
