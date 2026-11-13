// Тир-лист после переделки: что обложка ведёт к отзыву, годы
// выбираются строкой, пустые тиры сжаты, метки не рвутся посреди слова,
// «Подписи» запоминаются, «Сохранить всё» в редакторе – наверху.
//
// Плюс старая ошибка, найденная по ходу: привязка вкладок тир-листа
// искала .tl-mode-btn по всему документу, а это общий класс вкладок
// «Статусов» и «Любимого». После захода в тир-лист клик по «Архиву» в
// «Статусах» переключал и тир-лист – в несуществующий режим «archive».
//
// Запуск: node tests/browser/tierlist-redesign.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

// Переменные самой страницы (app/js/tierlist.js, app/js/reviews.js) –
// читаются только внутри page.evaluate, где они и правда есть.
/* global tlState, _reviewModalReview */
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-tlredesign-"));
// Два отзыва с ОДИНАКОВЫМ названием (сезоны – у owner'а так бывает):
// клик обязан открыть именно свой, а не первый попавшийся по имени.
// Оценки только в четырёх тирах из семи – остальные пустые.
const reviews = [
  {
    title: "Двойник",
    type: "anime",
    grade: "etalon",
    year: 2020,
    status: "completed",
    date_end: "2021-03-01",
    review_full: "первый сезон",
  },
  {
    title: "Двойник",
    type: "anime",
    grade: "etalon",
    year: 2022,
    status: "completed",
    date_end: "2023-05-01",
    review_full: "второй сезон",
  },
  {
    title: "Фильм",
    type: "movie",
    grade: "attrakcion",
    year: 2019,
    status: "completed",
    date_end: "2021-07-01",
  },
  {
    title: "Манга",
    type: "manga",
    grade: "razocharo",
    year: 2018,
    status: "completed",
    date_end: "2023-01-10",
  },
  {
    title: "Смотрю",
    type: "anime",
    grade: "fon",
    year: 2024,
    status: "current",
    date_start: "2024-02-01",
  },
];
writeFileSync(join(vaultDir, "reviews.json"), JSON.stringify(reviews));

// Свободный порт у системы, а не зашитый (см. chars-favorites-cover-cleanup.mjs).
const port = await new Promise((resolve) => {
  const probe = http.createServer().listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});
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

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

console.log("Статусы → Тир-лист → «Архив» в Статусах");
await page.click('.tab-btn[data-label="nav.now"]');
await page.waitForSelector('#tab-now .tl-mode-btn[data-mode="archive"]', { timeout: 10000 });
await page.click('.tab-btn[data-label="nav.tierlist"]');
await page.waitForSelector("#tl-titles-rows", { timeout: 10000 });
await page.click('.tab-btn[data-label="nav.now"]');
await page.click('#tab-now .tl-mode-btn[data-mode="archive"]');
await page.waitForTimeout(400);
ok(
  (await page.evaluate(() => tlState.mode)) === "titles",
  "клик по «Архиву» в «Статусах» не трогает режим тир-листа"
);

console.log("Тир-лист: тайтлы");
await page.click('.tab-btn[data-label="nav.tierlist"]');
await page.waitForSelector("#tl-titles-rows .tl-poster", { timeout: 10000 });

const chips = await page.$$eval("#tab-tierlist .tl-filters [data-tl-type]", (els) =>
  els.map((e) => e.textContent.replace(/\s+/g, " ").trim())
);
ok(
  chips.some((t) => /Аниме 3$/.test(t)),
  `у чипов типов есть счётчики (${chips.join(" | ")})`
);

const empty = await page.$$eval("#tl-titles-rows .tl-row-empty", (rows) =>
  rows.map((r) => r.getBoundingClientRect().height)
);
ok(empty.length === 3, `пустых тиров три, они помечены tl-row-empty (получили ${empty.length})`);
ok(
  empty.every((h) => h < 50),
  `пустой тир – тонкая полоса, а не полная строка (высоты: ${empty.map(Math.round).join(", ")})`
);

const labelLines = await page.$$eval("#tl-titles-rows .tl-label-name", (els) =>
  els.map((e) => {
    const lh =
      parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.2;
    return [e.textContent, Math.round(e.getBoundingClientRect().height / lh)];
  })
);
const broken = labelLines.filter(([, lines]) => lines > 1);
ok(
  !broken.length,
  `метки тиров в одну строку${broken.length ? ": рвутся " + broken.map(([t]) => t).join(", ") : ""}`
);

// Второй «Двойник» – тот, у которого год выхода 2022.
await page.click('#tl-titles-rows .tl-poster[data-tl-title="Двойник"][data-tl-year="2022"]');
await page.waitForSelector("#review-modal-overlay:not(.hidden)", { timeout: 5000 });
ok(
  (await page.evaluate(() => _reviewModalReview?.review_full)) === "второй сезон",
  "клик по обложке открывает окно именно этого отзыва (одинаковые названия не путаются)"
);
ok(
  !(await page.$(".image-lightbox:not(.hidden)")),
  "вместо отзыва не открылась увеличенная картинка"
);
await page.keyboard.press("Escape");
await page.waitForSelector("#review-modal-overlay.hidden", { state: "attached", timeout: 5000 });

const years = await page.$$eval("#tab-tierlist [data-tl-year-btn]", (els) =>
  els.map((e) => e.textContent)
);
ok(
  years.join(",") === "Все годы,2024,2023,2021",
  `годы строкой: «Все годы» и годы по датам отзывов (${years.join(", ")})`
);
await page.click('#tab-tierlist [data-tl-year-btn="2023"]');
await page.waitForTimeout(200);
const in2023 = await page.$$eval("#tl-titles-rows .tl-poster", (els) =>
  els.map((e) => e.dataset.tlTitle).sort()
);
ok(
  in2023.join(",") === "Двойник,Манга",
  `год 2023 оставляет только его тайтлы (${in2023.join(", ")})`
);
ok(
  await page.$eval('#tab-tierlist [data-tl-year-btn="2023"]', (e) =>
    e.classList.contains("active")
  ),
  "выбранный год подсвечен"
);

await page.click("#tab-tierlist .tl-captions-btn");
ok(
  await page.evaluate(
    () =>
      document.getElementById("tab-tierlist").classList.contains("tl-captions") &&
      localStorage.getItem("tl-captions") === "1"
  ),
  "«Подписи» включают названия и запоминаются"
);
const caption = await page.$eval(
  "#tl-titles-rows .tl-poster",
  (e) => getComputedStyle(e, "::after").content
);
ok(/Двойник|Манга/.test(caption), `под обложкой название (${caption})`);

console.log("Редактор персонажей");
await page.goto(`http://127.0.0.1:${port}/#/chars-edit?collection=characters`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector(".app-topbar #btn-save", { timeout: 10000 });
ok(true, "«Сохранить всё» в верхней панели");
ok(!(await page.$(".save-bar #btn-save")), "и только там, без второй кнопки внизу");

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nтир-лист после переделки работает");
