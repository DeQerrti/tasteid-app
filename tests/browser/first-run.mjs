// Первый запуск: мастер (electron/ui/welcome.html) и первый экран
// пустого хранилища (firstRunHtml в js/now.js). Оба – по макету,
// одобренному owner'ом в ноябре 2026 (вариант «А» + новый мастер).
//
// Проверяется:
//   – пустое хранилище: в «Статусах» и «Отзывах» – «Паспорт пока пуст»
//     с источниками импорта, а не голое «Список пуст»;
//   – ссылка источника открывает импорт сразу с его карточкой и полем ника;
//   – где записи уже есть, первого экрана нет;
//   – мастер: у тем подписано «светлая/тёмная», у шкалы – пояснение,
//     три варианта, полки списком с описаниями, редактор по ссылке с
//     оформленными и подписанными полями, без обрезки списка;
//   – выбранная шкала записывается в настройки.
//
// Запуск: node tests/browser/first-run.mjs

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
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

async function withVault(reviews, run) {
  const dir = mkdtempSync(join(tmpdir(), "tasteid-firstrun-"));
  writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
  const port = await new Promise((resolve) => {
    const probe = http.createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const server = spawn("node", ["scripts/serve.js", dir, String(port)], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
    server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
  });
  try {
    await run(`http://127.0.0.1:${port}`, () => {
      try {
        return JSON.parse(readFileSync(join(dir, "site-settings.json"), "utf8"));
      } catch {
        return {};
      }
    });
  } finally {
    server.kill();
  }
}

const browser = await chromium.launch();
const jsErrors = [];
const newPage = async (w = 1400, h = 1000) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  return page;
};

console.log("Пустое хранилище");
await withVault([], async (base) => {
  const page = await newPage();
  await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tab-now .fr", { timeout: 10000 });
  ok(
    (await page.textContent("#tab-now .fr-title")).includes("Паспорт пока пуст"),
    "в «Статусах» – «Паспорт пока пуст»"
  );
  ok(!(await page.$("#tab-now .now-tools")), "без пустых фильтров «В процессе 0»");
  ok(!!(await page.$('#tab-now a.admin-add-btn[href="#/add"]')), "есть «Добавить первый отзыв»");
  const srcs = await page.$$eval("#tab-now .fr-src", (els) =>
    els.map((e) => e.getAttribute("href"))
  );
  ok(
    srcs.includes("#/settings-edit?panel=import&open=shiki") && srcs.length >= 8,
    `источники импорта ссылками (${srcs.length})`
  );

  await page.click('.tab-btn[data-label="nav.reviews"]');
  await page.waitForSelector("#tab-reviews .fr", { timeout: 10000 });
  ok(true, "в «Отзывах» – тот же первый экран");

  await page.click('#tab-reviews .fr-src[href$="open=shiki"]');
  await page.waitForSelector('[data-imp-card="shiki"] #imp-shiki-user', { timeout: 10000 });
  ok(true, "ссылка открыла импорт с карточкой Шикимори");
  ok(
    await page
      .waitForFunction(() => document.activeElement?.id === "imp-shiki-user", null, {
        timeout: 3000,
      })
      .then(
        () => true,
        () => false
      ),
    "поле ника – в фокусе"
  );
  await page.close();
});

console.log("Хранилище с записью");
await withVault([{ id: 1, title: "A", type: "anime", status: "plantowatch" }], async (base) => {
  const page = await newPage();
  await page.goto(`${base}/#/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tab-now .now-tools", { timeout: 10000 });
  ok(!(await page.$(".fr")), "первого экрана нет – обычные «Статусы»");
  await page.close();
});

console.log("Мастер");
await withVault([], async (base, settings) => {
  const page = await newPage(900, 800);
  // Выбор папки и создание хранилища – дело Electron; здесь подменяем.
  await page.route("**/api/app/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        route.request().url().includes("pick-vault") ? { path: "C:\\TasteID" } : {}
      ),
    })
  );
  await page.goto(`${base}/welcome`, { waitUntil: "domcontentloaded" });
  await page.click('[data-mode="new"]');
  await page.click("#btn-next");

  const tones = await page.$$eval(".pill-tone", (els) => els.map((e) => e.textContent.trim()));
  ok(tones.includes("светлая") && tones.includes("тёмная"), "у тем подписано «светлая/тёмная»");
  await page.click("#btn-next");

  ok((await page.textContent(".step-lead")).includes("полка"), "у шкалы есть пояснение про полки");
  ok((await page.$$("[data-scaletype]")).length === 3, "три варианта шкалы");
  ok(!(await page.isVisible("#btn-next")), "пока шкала не выбрана, «Создать паспорт» нет");

  await page.click('[data-scaletype="categorical"]');
  const notes = await page.$$eval(".shelf-view-note", (els) =>
    els.map((e) => e.textContent.trim())
  );
  ok(notes.length === 7 && notes.every(Boolean), "полки автора – списком, у каждой описание");

  await page.click('[data-scaletype="stars"]');
  const ranges = await page.$$eval(".shelf-view-note", (els) =>
    els.map((e) => e.textContent.trim())
  );
  ok(
    ranges[0] === "5★" && ranges.at(-1) === "1★",
    `у звёзд – какие оценки на полку (${ranges.join(", ")})`
  );

  await page.click("#btn-edit-shelves");
  const field = await page.$eval('#shelvesList input[data-f="name"]', (el) => ({
    label: el.getAttribute("aria-label"),
    bg: getComputedStyle(el).backgroundColor,
    surface: getComputedStyle(document.documentElement).getPropertyValue("--surface2").trim(),
  }));
  ok(!!field.label, "у полей есть подписи для читалок экрана");
  ok(
    field.bg !== "rgb(255, 255, 255)" && field.bg !== "rgba(0, 0, 0, 0)",
    `поля оформлены (${field.bg})`
  );
  ok(
    !!(await page.$eval("[data-remove]", (el) => el.getAttribute("aria-label"))),
    "у «✕» есть подпись"
  );
  const clipped = await page.$eval("#shelvesList", (el) => el.scrollHeight > el.clientHeight + 1);
  ok(!clipped, "список полок не обрезан");

  await page.click("#btn-next");
  await page.waitForFunction(() => document.getElementById("status")?.textContent !== "", null, {
    timeout: 5000,
  });
  await page.waitForTimeout(500);
  const saved = settings();
  ok(
    saved.gradeScale?.type === "stars" && saved.gradeScale?.numericMax === 5,
    "шкала записана: звёзды, 5"
  );
  await page.close();
});

ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nпервый запуск работает");
process.exit(0);
