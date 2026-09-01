// Подсказки [data-tip] пальцем — в настоящем браузере, настоящими
// касаниями.
//
// Наведения на телефоне нет, и подсказок там не было вовсе — причём не
// потому, что событие не приходило: после касания браузер сам шлёт «как
// будто мышью» mouseover, а следом mouseout, и подсказка успевала
// появиться и пропасть в одном кадре. Поймать такое можно только
// настоящим касанием, поэтому касания подаются через CDP
// (Input.dispatchTouchEvent), а не рассылкой событий из самой страницы.
//
// Запуск: node tests/browser/touch-tips.mjs [папка-хранилища]
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).
//
// Хранилище нужно непустое: подсказки висят на тегах и оценках, а их
// неоткуда взять, если отзывов нет.

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

const vaultDir = process.argv[2] || mkdtempSync(join(tmpdir(), "tasteid-tips-"));
const port = 8900 + (process.pid % 90);
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

// Без своего хранилища (process.argv[2]) — обычный пустой временный
// каталог, а подсказкам взяться неоткуда: они висят на оценке и тегах
// конкретного отзыва. Заводим один отзыв сами, тем же /api, что и
// настоящее приложение — grade и tag берём из встроенных умолчаний
// (config.js: GRADES_DEF/TAGS_MAP), чтобы не зависеть от чужих настроек.
if (!process.argv[2]) {
  await fetch(`http://127.0.0.1:${port}/api/save-review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Tips Test",
      type: "anime",
      status: "completed",
      grade: "rezonans",
      tags: ["Топ рисовка"],
    }),
  });
}

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
async function tap(x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(450);
}

// Координаты считаем дважды: scrollIntoView сдвигает страницу, и
// померенное до прокрутки уже не там, куда придётся палец.
async function centerOf(selector) {
  const measure = () =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent.trim() };
    }, selector);
  const first = await measure();
  if (!first) return null;
  await page.waitForTimeout(250);
  return measure();
}

// Видно ли подсказку и не уехала ли она за край экрана.
const tipState = () =>
  page.evaluate(() => {
    const t = document.querySelector(".data-tip-tooltip");
    if (!t) return { shown: false, onScreen: false, text: "" };
    const r = t.getBoundingClientRect();
    return {
      shown: !t.classList.contains("hidden"),
      onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      text: t.textContent,
    };
  });

const openTab = async (id) => {
  await page.evaluate((t) => document.querySelector(`.tab-btn[aria-controls="${t}"]`)?.click(), id);
  await page.waitForTimeout(1600);
};

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

console.log("Оценка на карточке «Статусов»");
// По умолчанию открывается «Отзывы» (или последняя открытая вкладка) –
// «Статусы» больше не гарантированно первая, открываем её явно, как и
// другие вкладки ниже через openTab().
await openTab("tab-now");
const grade = await centerOf("#tab-now [data-tip]");
if (!grade) {
  ok(false, `в хранилище нет ни одной карточки с оценкой — проверять нечего`);
} else {
  await tap(grade.x, grade.y);
  const shown = await tipState();
  ok(shown.shown, "нажатие показывает подсказку, а не мигает ею невидимо");
  ok(shown.onScreen, "подсказка целиком на экране, а не за краем");
  ok(shown.text.length > 0, "в подсказке есть текст");

  await tap(grade.x, grade.y);
  ok(!(await tipState()).shown, "повторное нажатие по тому же убирает подсказку");

  await tap(grade.x, grade.y);
  await tap(8, 700);
  ok(!(await tipState()).shown, "нажатие мимо убирает подсказку");
}

console.log("Облако тегов в «Статистике»");
await openTab("tab-stats");
const statTag = await centerOf(".stat-tag[data-tip]");
if (statTag) {
  await tap(statTag.x, statTag.y);
  ok((await tipState()).shown, "тег в облаке объясняет себя по нажатию");
} else {
  ok(false, "в хранилище нет тегов — проверять нечего");
}

console.log("Тег на карточке отзыва открывает отзыв, а не подсказку");
await openTab("tab-reviews");
const cardTag = await centerOf("#rv-grid .rtag[data-tip]");
if (cardTag) {
  await tap(cardTag.x, cardTag.y);
  const modalOpen = await page.evaluate(
    () => !document.getElementById("review-modal-overlay").classList.contains("hidden")
  );
  ok(modalOpen, "нажатие по тегу открывает сам отзыв (карточка — это кнопка)");
  ok(!(await tipState()).shown, "и не вешает подсказку поверх открывшегося окна");

  const modalTag = await centerOf(".review-modal-tags .rtag[data-tip]");
  if (modalTag) {
    await tap(modalTag.x, modalTag.y);
    ok((await tipState()).shown, "а внутри отзыва тот же тег подсказку показывает");
  } else {
    ok(false, "в открытом отзыве не нашлось тегов");
  }
} else {
  ok(false, "в хранилище нет отзывов с тегами — проверять нечего");
}

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nподсказки открываются пальцем");
