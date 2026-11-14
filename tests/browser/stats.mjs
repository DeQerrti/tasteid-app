// Вкладка «Статистика»: новые блоки (вкус в трёх словах, как оцениваешь
// типы, что поднимает/роняет оценку, люди, персонажи), резиновая
// раскладка на разных ширинах, переключение лет, скрытие блоков в
// настройках и снимок картинкой.
//
// Запуск: node tests/browser/stats.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

// Функция самой страницы (app/js/image-lightbox.js) – вызывается только
// внутри page.evaluate, где она и правда есть.
/* global openImageLightbox */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

// Данные: тег «Злодей» стоит только у лучших оценок, «Скука» – только у
// худших; аниме оценено щедрее манги.
const reviews = [];
let id = 1;
const add = (type, grade, tags, year, end) =>
  reviews.push({
    id: id++,
    title: `T${id}`,
    type,
    status: "completed",
    grade,
    tags,
    year: String(year),
    date_end: end,
  });
for (let i = 0; i < 5; i++)
  add("anime", "rezonans", ["Злодей", "Общий"], 2010 + i, `2025-0${i + 1}-10`);
for (let i = 0; i < 5; i++) add("manga", "brak", ["Скука", "Общий"], 1990 + i, `2026-0${i + 1}-10`);
for (let i = 0; i < 4; i++) add("movie", "attrakcion", ["Общий"], 1300 + i, `2026-0${i + 1}-12`);
reviews[0].favorite = true;
reviews[0].rewatch_count = 2;
// Внешняя обложка, которая не открывается, и её резервная копия на диске –
// статистика должна показать копию (как карточки во всём приложении), а
// снимок – не остаться с пустым местом.
reviews[0].cover = "https://img.invalid/cover.jpg";
reviews[0].cover_backup = "/covers-backup/t2.png";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg+G+DHQ0tCQC2ik7BakjxzwAAAABJRU5ErkJggg==",
  "base64"
);

function vault(settings) {
  const dir = mkdtempSync(join(tmpdir(), "tasteid-stats-"));
  writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
  mkdirSync(join(dir, "covers-backup"));
  writeFileSync(join(dir, "covers-backup", "t2.png"), PNG);
  writeFileSync(join(dir, "covers-backup", "hero.png"), PNG);
  writeFileSync(
    join(dir, "favorites.json"),
    JSON.stringify([
      {
        id: 1,
        type: "character",
        name: "Герой",
        from: "T2",
        linked_review_ids: [1],
        image: "https://img.invalid/hero.jpg",
        image_backup: "/covers-backup/hero.png",
      },
      { id: 2, type: "person", subtype: "director", name: "Режиссёр", linked_review_ids: [1, 2] },
    ])
  );
  writeFileSync(join(dir, "site-settings.json"), JSON.stringify(settings || {}));
  return dir;
}

async function serve(dir, port) {
  const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.on("exit", () => server.kill());
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
    server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
  });
  return server;
}

const port = 8300 + (process.pid % 90);
const server = await serve(vault(), port);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  acceptDownloads: true,
});
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.route("https://img.invalid/**", (r) => r.fulfill({ status: 404, body: "" }));

async function openStats(p, base) {
  await p.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await p.click('.tab-btn[aria-controls="tab-stats"]');
  await p.waitForSelector("#tab-stats .sx-hero");
}
const layout = (p) =>
  p.evaluate(() => {
    const out = [...document.querySelectorAll("#tab-stats *")].filter((e) => {
      const r = e.getBoundingClientRect();
      const box = e.closest(".sx-card, .sx-hero")?.getBoundingClientRect();
      return box && r.width > 0 && r.right > box.right + 1;
    });
    return { hscroll: document.documentElement.scrollWidth > innerWidth, sticksOut: out.length };
  });

console.log("Блоки за всё время");
await openStats(page, `http://127.0.0.1:${port}`);
const keys = await page.$$eval("#tab-stats [data-stat-key]", (els) =>
  els.map((e) => e.dataset.statKey)
);
for (const k of [
  "taste",
  "donut",
  "grades",
  "lift",
  "lift-down",
  "watch-bars",
  "release-bars",
  "tags",
  "people",
  "rewatch",
  "characters",
]) {
  ok(keys.includes(k), `блок ${k} на месте`);
}
ok(
  (await page.textContent(".sx-words")).startsWith("Злодей"),
  "первое из трёх слов – тег, который поднимает оценку"
);
ok(
  (await page.textContent('[data-stat-key="lift-down"]')).includes("Скука"),
  "«Скука» – в том, что роняет оценку"
);
const typeOrder = await page.$$eval(".sx-type-name", (els) => els.map((e) => e.textContent.trim()));
ok(
  typeOrder[0] === "Аниме" && typeOrder[typeOrder.length - 1] === "Манга",
  `типы от щедрого к строгому (${typeOrder})`
);
ok(
  (await page.textContent('[data-stat-key="release-bars"]')).includes("до 1950"),
  "годы выхода – десятилетиями, старое – одной строкой"
);
ok(
  (await page.textContent('[data-stat-key="people"]')).includes("Режиссёр"),
  "«Твои люди» – из «Любимого»"
);

console.log("Раскрытие строк и приписки");
// Тип → сколько на каждой полке: у аниме все пять – «Резонанс».
const animeRow = page.locator(".sx-type[data-stat-expand]", { hasText: "Аниме" });
ok((await animeRow.getAttribute("aria-expanded")) === "false", "строка типа сначала свёрнута");
await animeRow.click();
const animeDetail = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".sx-type[data-stat-expand]")].find((r) =>
    r.textContent.includes("Аниме")
  );
  const det = row.nextElementSibling;
  return {
    hidden: det.hidden,
    rows: [...det.querySelectorAll(".sx-grow")].map((r) => r.textContent.replace(/\s+/g, "")),
  };
});
ok(
  !animeDetail.hidden && animeDetail.rows.join() === "Резонанс5",
  `клик по типу – полки (${animeDetail.rows})`
);
// Десятилетие → по годам: манга 1990–1994, по одной в год.
await page.locator(".sx-decade[data-stat-expand]", { hasText: "1990-е" }).click();
const years = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".sx-decade[data-stat-expand]")].find((r) =>
    r.textContent.includes("1990-е")
  );
  return [...row.nextElementSibling.querySelectorAll(".sx-decade-year")].map((r) =>
    r.textContent.replace(/\s+/g, "")
  );
});
ok(
  years.join() === "19941,19931,19921,19911,19901",
  `клик по десятилетию – годы, новые сверху (${years})`
);
// Вкладкой делятся снимком – у этих блоков подписей под заголовком нет.
for (const k of ["tags", "people", "rewatch", "characters"]) {
  ok(!(await page.$(`[data-stat-key="${k}"] .sx-explain`)), `у «${k}» нет приписки`);
}
ok(
  !(await page.textContent('[data-stat-key="lift-down"] .sx-explain')).includes("прощаешь"),
  "у «Что гарантированно роняет» – без «то, чего ты не прощаешь»"
);
// Лайтбокс без крестика закрывается кликом и по самой картинке.
await page.evaluate(() => openImageLightbox("/covers-backup/t2.png", "x"));
ok(!(await page.$(".image-lightbox-close")), "у увеличенной картинки нет крестика");
await page.click("#image-lightbox-img");
ok(
  await page.evaluate(() =>
    document.getElementById("image-lightbox-overlay").classList.contains("hidden")
  ),
  "клик по картинке закрывает её"
);

console.log("Резиновая раскладка");
for (const [w, h] of [
  [375, 812],
  [768, 1024],
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const l = await layout(page);
  ok(
    !l.hscroll && l.sticksOut === 0,
    `${w}px: без горизонтальной прокрутки и вылезаний (${l.sticksOut})`
  );
}
await page.setViewportSize({ width: 1920, height: 1080 });
const titleSizes = await page.$$eval(".sx-card .sx-h", (els) => [
  ...new Set(els.map((e) => getComputedStyle(e).fontSize)),
]);
ok(titleSizes.length === 1, `заголовки всех карточек одного размера (${titleSizes})`);

console.log("Год");
await page.click('[data-stat-year-bar="2026"]');
await page.waitForFunction(
  () => document.querySelector(".tl-filter.active")?.dataset.statYear === "2026"
);
ok(
  (await page.textContent(".sx-kicker")).includes("2026"),
  "клик по столбику года открывает его итоги"
);
ok((await page.textContent(".sx-total-big")).includes("+"), "у года есть сравнение с прошлым");

console.log("Снимок картинкой");
await page.click('.tl-filter[data-stat-year="all"]');
await page.waitForSelector('[data-stat-key="lift"]');
await page.click("#stats-export-btn");
await page.waitForSelector("#stats-export-options label");
const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
await page.click('#stats-export-overlay [data-act="ok"]');
const download = await downloadPromise;
ok(
  download.suggestedFilename() === "stats-all-time.png",
  `картинка сохраняется (${download.suggestedFilename()})`
);

console.log("Картинки статистики: битая внешняя ссылка → резервная копия");
// Раньше у картинок статистики не было data-fallback: битая ссылка
// оставалась пустым местом и на странице, и на снимке.
await page.waitForFunction(() =>
  [...document.querySelectorAll("#tab-stats .stat-grid img")].some((i) =>
    (i.getAttribute("src") || "").includes("/covers-backup/t2.png")
  )
);
const statImgs = await page.$$eval("#tab-stats .stat-grid img", (els) =>
  els.map((i) => ({ src: i.getAttribute("src") || "", ok: i.complete && i.naturalWidth > 0 }))
);
ok(
  statImgs.filter((i) => i.src.includes("img.invalid")).length === 0,
  "ни одной картинки с битой внешней ссылкой не осталось"
);
ok(
  statImgs.some((i) => i.src.includes("/covers-backup/hero.png")),
  "у персонажа тоже подставилась копия"
);

console.log("Снимок на широком окне (zoom у статистики)");
// ≥2300px: у #tab-stats CSS zoom, который html2canvas не понимает – между
// словами на снимке выходили дыры. На время снимка zoom снимается.
await page.setViewportSize({ width: 2560, height: 1440 });
await page.waitForTimeout(200);
const zoomBefore = await page.evaluate(
  () => getComputedStyle(document.getElementById("tab-stats")).zoom
);
await page.evaluate(() => {
  window.__zoomAtCapture = null;
  const orig = window.html2canvas;
  window.html2canvas = (el, opts) => {
    window.__zoomAtCapture = getComputedStyle(document.getElementById("tab-stats")).zoom;
    return orig(el, opts);
  };
});
await page.click("#stats-export-btn");
await page.waitForSelector("#stats-export-options label");
const wideDownload = page.waitForEvent("download", { timeout: 30000 });
await page.click('#stats-export-overlay [data-act="ok"]');
await wideDownload;
ok(zoomBefore !== "1", `на широком окне zoom действует (${zoomBefore})`);
ok((await page.evaluate(() => window.__zoomAtCapture)) === "1", "во время снимка zoom снят");
ok(
  (await page.evaluate(() => getComputedStyle(document.getElementById("tab-stats")).zoom)) ===
    zoomBefore,
  "после снимка zoom вернулся"
);
await page.setViewportSize({ width: 1920, height: 1080 });

console.log("Скрытые в настройках блоки");
const port2 = port + 1;
const server2 = await serve(vault({ hiddenStatsBlocks: ["taste", "lift", "people"] }), port2);
await page.goto(`http://127.0.0.1:${port2}/`, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[aria-controls="tab-stats"]');
await page.waitForSelector("#tab-stats .sx");
const keys2 = await page.$$eval("#tab-stats [data-stat-key]", (els) =>
  els.map((e) => e.dataset.statKey)
);
ok(
  !keys2.includes("taste") && keys2.includes("counters"),
  "без «вкуса» шапка показывает только числа"
);
ok(
  !keys2.includes("lift") && !keys2.includes("lift-down") && !keys2.includes("people"),
  "скрытые блоки не показываются"
);
const lone = await page.$$eval("#tab-stats .sx-card.sx-solo", (els) =>
  els.map((e) => e.dataset.statKey)
);
ok(
  lone.length === 1 && lone[0] === "characters",
  `оставшийся без пары блок растянут на всю ширину (${lone})`
);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
server2.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
