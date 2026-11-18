// Нейтральный набор тегов для нового хранилища и «Добавить набор автора»
// (NEUTRAL_TAG_NAMES в js/config.js, resolveTagSet в js/theme.js).
//
// Проверяется:
//   – пустое новое хранилище получает нейтральный набор, и это
//     запоминается в настройках (tagSet: "neutral");
//   – в нём нет жаргона и мата, жанры на месте;
//   – «Добавить набор автора» возвращает полный набор без перезагрузки;
//   – хранилище, где отзывы уже есть, остаётся на авторском наборе
//     (tagSet: "author") – его теги не теряют категории.
//
// Запуск: node tests/browser/tag-sets.mjs

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
  const dir = mkdtempSync(join(tmpdir(), "tasteid-tagset-"));
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

const openTags = async (page, base) => {
  await page.goto(`${base}/#/add`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tag-q");
  await page.waitForFunction(() => !!window.SITE_TAG_SET);
  await page.click('.ed-tag-tools .btn-new:has-text("Управлять тегами")');
  await page.waitForSelector("#tm-body .tm-cat");
};
const tagNames = (page) => page.$$eval("[data-tm-tag]", (els) => els.map((e) => e.dataset.tmTag));

console.log("Новое пустое хранилище");
await withVault([], async (base, settings) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await openTags(page, base);
  ok(settings().tagSet === "neutral", "набор запомнен как нейтральный");
  let names = await tagNames(page);
  ok(names.includes("Драма") && names.includes("Живые герои"), "жанры и понятные теги на месте");
  ok(
    !names.includes("Мета-дрочево") &&
      !names.includes("Картонные чары") &&
      !names.includes("Хорни вайб"),
    "жаргона и мата нет"
  );
  ok(!!(await page.$('[data-tm-act="author-set"]')), "есть кнопка «Добавить набор автора»");
  await page.click('[data-tm-act="author-set"]');
  await page.waitForFunction(
    () => !!document.querySelector('[data-tm-tag="Картонные чары"]'),
    null,
    {
      timeout: 5000,
    }
  );
  names = await tagNames(page);
  ok(names.includes("Картонные чары"), "набор автора появился без перезагрузки");
  ok(settings().tagSet === "author", "и запомнен в настройках");
  ok(!(await page.$('[data-tm-act="author-set"]')), "кнопка после этого скрыта");
  await page.close();
});

console.log("Хранилище, где отзывы уже есть");
await withVault(
  [{ id: 1, title: "A", type: "anime", status: "completed", tags: ["Картонные чары"] }],
  async (base, settings) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.on("pageerror", (e) => jsErrors.push(e.message));
    await openTags(page, base);
    ok(settings().tagSet === "author", "остаётся авторский набор и это запомнено");
    ok((await tagNames(page)).includes("Картонные чары"), "свои теги на месте");
    ok(!(await page.$('[data-tm-act="author-set"]')), "кнопки «Добавить набор автора» нет");
    await page.close();
  }
);

ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nнаборы тегов работают");
process.exit(0);
