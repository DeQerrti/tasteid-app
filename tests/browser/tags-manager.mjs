// Теги и категории в редакторе отзыва: создание тега прямо из поиска
// (в т.ч. с новой категорией), окно «Теги и категории» – затемнение на весь
// экран, правка/переименование/смена категории/удаление тега, имя и цвет
// категории, удаление категории с переносом тегов и вместе с тегами,
// массовое удаление неиспользуемых. Каждое действие сверяется с тем, что
// записалось в site-settings.json и reviews.json.
//
// Запуск: node tests/browser/tags-manager.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-tags-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "A",
      type: "anime",
      status: "completed",
      tags: ["Стеклище", "Проседает", "Философия"],
    },
    { id: 2, title: "B", type: "anime", status: "completed", tags: ["Стеклище", "Жесть"] },
    { id: 3, title: "C", type: "movie", status: "completed", tags: ["Проседает", "Комедия"] },
  ])
);
const settings = () => JSON.parse(readFileSync(join(vaultDir, "site-settings.json"), "utf8"));
const reviews = () => JSON.parse(readFileSync(join(vaultDir, "reviews.json"), "utf8"));
const withTag = (t) => reviews().filter((r) => (r.tags || []).includes(t)).length;

const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
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
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

await page.goto(`${base}/#/add`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#tag-q");

const confirm = () => page.click('#confirm-dialog-overlay:not(.hidden) [data-act="ok"]');
const openPanel = async () => {
  await page.click('.ed-tag-tools .btn-new:has-text("Управлять тегами")');
  await page.waitForSelector("#tm-body .tm-cat");
};
const catTags = (name) =>
  page.$$eval(
    "#tm-body .tm-cat",
    (els, n) => {
      const s = els.find((e) => e.querySelector(".tm-cat-name").textContent === n);
      return s ? [...s.querySelectorAll("[data-tm-tag]")].map((t) => t.dataset.tmTag) : null;
    },
    name
  );
const waitSettings = (fn) =>
  page
    .waitForFunction(() => true)
    .then(async () => {
      for (let i = 0; i < 50; i++) {
        try {
          if (fn(settings())) return true;
        } catch {}
        await page.waitForTimeout(100);
      }
      return false;
    });

console.log("Редактор");
ok(
  (await page.getAttribute("#tag-q", "placeholder")) === "Найти или создать тег",
  "поиск называется «Найти или создать тег»"
);
ok(
  (await page.locator(".ed-tag-tools .btn-new").count()) === 1,
  "одна кнопка вместо «Новый тег» + «Все теги»"
);

console.log("Жанр");
await openPanel();
const overlay = await page.evaluate(() => {
  const r = document.getElementById("tag-modal-overlay").getBoundingClientRect();
  return [r.width, r.height];
});
ok(overlay[0] === 1400 && overlay[1] === 1000, `затемнение на весь экран (${overlay})`);
const genre = await catTags("Жанр");
ok(
  genre?.length === 21 && genre.includes("Комедия"),
  `жанровые теги – в «Жанре» (${genre?.length})`
);
ok(!(await catTags("Атмосфера / эмоции")).includes("Комедия"), "а не в «Атмосфере»");
ok(
  (await page.textContent('[data-tm-tag="Стеклище"] .tm-n')) === "2",
  "у тега – в скольких отзывах он стоит"
);
await page.keyboard.press("Escape");
ok(await page.isHidden("#tag-modal-overlay"), "Escape закрывает окно");

console.log("Новый тег из поиска");
await page.fill("#tag-q", "Нуар");
await page.waitForSelector("#tag-create [data-create-cat]");
ok((await page.textContent("#tag-create .ed-create-label")).includes("Нуар"), "предлагает создать");
await page.click('#tag-create [data-create-cat="genre"]');
ok(await waitSettings((s) => s.customTags?.["Нуар"]?.cat === "genre"), "записан в «Жанр»");
ok((await page.textContent("#tags-picked")).includes("Нуар"), "сразу отмечен у отзыва");
ok((await page.inputValue("#tag-q")) === "", "поле поиска очищено");
await page.fill("#tag-q", "Крутой саундтрек");
await page.press("#tag-q", "Enter");
ok(
  await waitSettings((s) => s.customTags?.["Крутой саундтрек"]?.cat === "visual"),
  "Enter – в первую категорию"
);
await page.fill("#tag-q", "нуар");
ok(
  (await page.locator("#tag-create [data-create-cat]").count()) === 0,
  "существующий (без учёта регистра) создать не предлагает"
);
await page.fill("#tag-q", "Циммер");
await page.click("#tag-create-newcat");
await page.fill("#tag-create-catname", "Музыка");
await page.click('#tag-create [data-tm-sw="create"] .tm-sw[data-c="#4a8c5c"]');
await page.click("#tag-create-catgo");
ok(
  await waitSettings((s) => {
    const key = Object.entries(s.customCategories || {}).find(([, v]) => v === "Музыка")?.[0];
    return key && s.categoryColors?.[key] === "#4a8c5c" && s.customTags?.["Циммер"]?.cat === key;
  }),
  "новая категория с цветом и тег в ней – прямо из поиска"
);

console.log("Окно: только что отмеченные не считаются неиспользуемыми");
await openPanel();
ok(
  !(await page.getAttribute('[data-tm-tag="Нуар"]', "class")).includes("unused"),
  "«Нуар» отмечен у отзыва – не пунктиром"
);
await page.click("#tm-bulk");
await page.click('[data-tm-act="bulk-unused"]');
const pickedUnused = await page.$$eval("[data-tm-tag].picked", (els) =>
  els.map((e) => e.dataset.tmTag)
);
ok(
  !pickedUnused.includes("Нуар") && !pickedUnused.includes("Циммер"),
  "и под «Выбрать неиспользуемые» не попадают"
);
ok(
  !pickedUnused.includes("Стеклище") && pickedUnused.includes("Хоррор"),
  "используемые не выбраны, неиспользуемые – выбраны"
);
await page.click("#tm-bulk");

console.log("Переименовать тег из отзывов");
await page.click('[data-tm-tag="Стеклище"]');
await page.fill("#tm-t-name", "Стекло");
await page.fill("#tm-t-tip", "Больно и красиво");
await page.click('[data-tm-act="tag-save"]');
await page.waitForSelector('[data-tm-tag="Стекло"]');
ok(withTag("Стекло") === 2 && withTag("Стеклище") === 0, "переименован в обоих отзывах");
ok(
  settings().hiddenTags?.includes("Стеклище") &&
    settings().customTags?.["Стекло"]?.tip === "Больно и красиво",
  "встроенный скрыт, новый с подсказкой"
);

console.log("Сменить категорию тега");
await page.click('[data-tm-tag="Саспенс"]');
await page.selectOption("#tm-t-cat", "genre");
await page.press("#tm-t-tip", "Enter");
await page.waitForFunction(() => !document.getElementById("tm-t-name"));
ok((await catTags("Жанр")).includes("Саспенс"), "Enter в поле сохраняет, «Саспенс» в «Жанре»");

console.log("Категория: имя и цвет");
await page.click('.tm-cat:has(.tm-cat-name:text-is("Жанр")) [data-tm-cat]');
await page.fill("#tm-c-name", "Жанры");
await page.click('[data-tm-sw="cat"] .tm-sw[data-c="#7b3fa0"]');
await page.click('[data-tm-act="cat-save"]');
ok(
  await waitSettings(
    (s) => s.labels?.categories?.genre === "Жанры" && s.categoryColors?.genre === "#7b3fa0"
  ),
  "встроенная категория переименована, цвет задан"
);

console.log("Удалить тег");
await page.click('[data-tm-tag="Проседает"]');
await page.click('[data-tm-act="tag-delete"]');
await confirm();
await page.waitForFunction(() => !document.querySelector('[data-tm-tag="Проседает"]'));
ok(
  withTag("Проседает") === 0 && settings().hiddenTags.includes("Проседает"),
  "удалён и из отзывов"
);

console.log("Удалить категорию с тегами – перенос");
await page.click('.tm-cat:has(.tm-cat-name:text-is("Музыка")) [data-tm-cat]');
await page.click('[data-tm-act="cat-delete"]');
await page.waitForSelector(".tm-cat-delete-choice");
await page.selectOption("#tm-c-move", "visual");
await page.click('[data-tm-act="cat-delete-move"]');
await confirm();
await page.waitForFunction(
  () => ![...document.querySelectorAll(".tm-cat-name")].some((e) => e.textContent === "Музыка")
);
const s1 = settings();
ok(
  !Object.values(s1.customCategories || {}).includes("Музыка") &&
    s1.customTags["Циммер"].cat === "visual",
  "категория удалена, тег перенесён"
);

console.log("Удалить категорию вместе с тегами");
await page.click("#tm-newcat");
await page.fill("#tm-c-name", "Временная");
await page.click('[data-tm-act="cat-save"]');
await page.waitForSelector('.tm-cat-name:text-is("Временная")');
const tmpKey = Object.entries(settings().customCategories).find(([, v]) => v === "Временная")[0];
await page.evaluate((k) => window.tmSaveTag({ name: "Одноразовый", cat: k }), tmpKey);
await page.click('.tm-cat:has(.tm-cat-name:text-is("Временная")) [data-tm-cat]');
await page.click('[data-tm-act="cat-delete"]');
await page.click('[data-tm-act="cat-delete-all"]');
await confirm();
await page.waitForFunction(() => !document.querySelector('[data-tm-tag="Одноразовый"]'));
// Удаление идёт двумя записями настроек (сначала теги, потом категория) –
// ждём итога, а не первой из них.
ok(
  await waitSettings((s) => !s.customTags["Одноразовый"] && !s.customCategories[tmpKey]),
  "категория и её теги удалены"
);

console.log("Удалить неиспользуемые разом");
await page.click("#tm-bulk");
await page.click('[data-tm-act="bulk-unused"]');
await page.click('[data-tm-act="bulk-delete"]');
await confirm();
await page.waitForFunction(() => !document.querySelector('[data-tm-tag="Хоррор"]'));
const s2 = settings();
ok(
  s2.hiddenTags.includes("Хоррор") && !s2.hiddenTags.includes("Философия"),
  "неиспользуемые удалены, используемые на месте"
);
ok(withTag("Философия") === 1 && withTag("Комедия") === 1, "в отзывах ничего не пропало");

console.log("Телефон");
const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
phone.on("pageerror", (e) => jsErrors.push(e.message));
await phone.goto(`${base}/#/add`, { waitUntil: "domcontentloaded" });
await phone.waitForSelector("#tag-q");
await phone.click('.ed-tag-tools .btn-new:has-text("Управлять тегами")');
await phone.waitForSelector("#tm-body .tm-cat");
await phone.click("[data-tm-tag] >> nth=0");
ok(
  await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "без горизонтальной прокрутки"
);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
