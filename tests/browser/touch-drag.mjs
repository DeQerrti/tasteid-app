// Перетаскивание пальцем — в настоящем браузере, настоящими касаниями.
//
// Порядок отзывов, порядок вкладок и тир-листы двигают перетаскиванием,
// а событий drag от касаний браузер не рождает: без app/js/touch-drag.js
// на телефоне всё это молча не работает. Проверка ровно об этом — что
// после жеста пальцем порядок действительно поменялся.
//
// Касания подаются через CDP (Input.dispatchTouchEvent), а не рассылкой
// событий из самой страницы: подделанным событиям тут веры нет — они
// проверяли бы сами себя.
//
// Запуск: node tests/browser/touch-drag.mjs [папка-хранилища]
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

const vaultDir = process.argv[2] || mkdtempSync(join(tmpdir(), "tasteid-touch-"));
const port = 8700 + (process.pid % 200);
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => failures.push("JS: " + e.message));
await page.route("**/*", (r) =>
  r.request().url().includes(`127.0.0.1:${port}`) ? r.continue() : r.abort()
);

const cdp = await context.newCDPSession(page);
const touch = (type, x, y) =>
  cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });

// Палец: нажать, подержать (иначе это прокрутка, а не захват), провести
// несколькими шагами — одним прыжком браузер не поверит, — и отпустить.
async function dragFinger(from, to) {
  await touch("touchStart", from.x, from.y);
  await page.waitForTimeout(400);
  for (let i = 1; i <= 8; i++) {
    await touch(
      "touchMove",
      from.x + ((to.x - from.x) * i) / 8,
      from.y + ((to.y - from.y) * i) / 8
    );
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(60);
  await touch("touchEnd", to.x, to.y);
  await page.waitForTimeout(200);
}

// Координаты касания — экранные, поэтому обе точки жеста должны
// оказаться на экране: списки длинные, и нужная строка легко уезжает
// за нижний край, где пальцем по ней никто не попадёт. Прокручиваем
// один раз, к первой, и меряем обе — вторая идёт следом за ней.
const pairOf = async (sel, a, b) => {
  const box = await page.evaluate(
    ([s, i, j]) => {
      const list = document.querySelectorAll(s);
      list[i].scrollIntoView({ block: "center" });
      const at = (el, k) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width * k, y: r.top + r.height * k };
      };
      // Отпускаем не в середину цели, а ниже и правее её: ровно в
      // середине «до» и «после» неразличимы, и страницы честно
      // оставляют всё как было — жест вышел бы вхолостую.
      return { from: at(list[i], 0.5), to: at(list[j], 0.75), height: innerHeight };
    },
    [sel, a, b]
  );
  await page.waitForTimeout(200);
  for (const p of [box.from, box.to]) {
    if (p.y < 0 || p.y > box.height) throw new Error(`${sel}: точка жеста вне экрана (y=${p.y})`);
  }
  return [box.from, box.to];
};

// Точка одного касания — там прокрутки не нужно, элемент наверху.
const centerOf = (sel, n) =>
  page.evaluate(
    ([s, i]) => {
      const r = document.querySelectorAll(s)[i].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    [sel, n]
  );

const idsOf = (sel, attr) =>
  page.evaluate(
    ([s, a]) => [...document.querySelectorAll(s)].map((el) => el.getAttribute(a)),
    [sel, attr]
  );

console.log("Порядок отзывов");
await page.goto(`http://127.0.0.1:${port}/#/reviews-order`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".dnd-item");
await page.waitForTimeout(600);

const before = await idsOf(".dnd-item", "data-id");
ok(before.length > 2, `список загрузился (${before.length} карточек)`);

await dragFinger(...(await pairOf(".dnd-item", 0, 2)));
const after = await idsOf(".dnd-item", "data-id");

ok(after[0] !== before[0], "первая карточка уехала с первого места");
ok(
  after.length === before.length && new Set(after).size === after.length,
  "ничего не потерялось и не задвоилось"
);
ok(after.includes(before[0]), "перетащенная карточка осталась в списке");

console.log("Список избранного");
await page.goto(`http://127.0.0.1:${port}/#/favorites-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".entry-row");
await page.waitForTimeout(600);
const favBefore = await idsOf(".entry-row", "data-id");
if (favBefore.length > 2) {
  // Строки избранного высокие: через одну вторая точка уже за краем.
  await dragFinger(...(await pairOf(".entry-row", 0, 1)));
  const favAfter = await idsOf(".entry-row", "data-id");
  ok(favAfter[0] !== favBefore[0], "запись избранного переехала");
  ok(new Set(favAfter).size === favBefore.length, "список избранного цел");
} else {
  ok(false, `в хранилище слишком мало избранного (${favBefore.length}) — проверить нечего`);
}

console.log("Тайтлы в редакторе персонажей");
await page.goto(`http://127.0.0.1:${port}/#/chars-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".title-item");
await page.waitForTimeout(600);
const titlesBefore = await idsOf(".title-item", "data-title-id");
await dragFinger(...(await pairOf(".title-item", 0, 2)));
const titlesAfter = await idsOf(".title-item", "data-title-id");
ok(titlesAfter[0] !== titlesBefore[0], "тайтл переехал");
ok(new Set(titlesAfter).size === titlesBefore.length, "список тайтлов цел");

console.log("Обычное нажатие не сломалось");
await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".side-tab");
await page.waitForTimeout(600);
const tabBox = await centerOf(".side-tab", 1);
await touch("touchStart", tabBox.x, tabBox.y);
await touch("touchEnd", tabBox.x, tabBox.y);
await page.waitForTimeout(300);
ok(
  await page.evaluate(() => document.querySelectorAll(".side-tab")[1].classList.contains("active")),
  "короткое касание всё ещё переключает вкладку"
);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nпалец таскает");
