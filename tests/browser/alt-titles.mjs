// Поиск по оригинальным названиям (owner, ноябрь 2026): «Frieren» не
// находило «Фрирен». js/alt-titles.js раз за запуск спрашивает AniList и
// Шикимори по номерам тайтлов и пишет названия в alt_titles.
//
// Проверяется (AniList и Шикимори подменены, в сеть ничего не уходит):
//   – после запуска у записи с номером в файле появились названия;
//   – «Отзывы» и «Статусы» находят тайтл по ромадзи, английскому и
//     русскому названию;
//   – повторный запуск не спрашивает уже известное;
//   – записи без номера (игра) не трогаются.
//
// Запуск: node tests/browser/alt-titles.mjs

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

const reviews = [
  {
    id: 1,
    title: "Фрирен",
    type: "anime",
    status: "completed",
    date_end: "2026-01-01",
    review_full: "Текст",
    ids: { anilist: 154587, mal: 52991 },
  },
  {
    id: 2,
    title: "Shingeki no Kyojin",
    type: "manga",
    status: "current",
    date_start: "2026-01-01",
    ids: { anilist: 53390, mal: 23390 },
  },
  {
    id: 3,
    title: "Pragmata",
    type: "game",
    status: "completed",
    date_end: "2026-01-02",
    review_full: "Текст",
  },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-alt-"));
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));

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
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 20000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});
const readAll = async () => (await fetch(`${base}/reviews.json?_=${Date.now()}`)).json();

const browser = await chromium.launch();
const jsErrors = [];
let anilistCalls = 0;
let shikiCalls = 0;
async function openApp() {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  page.on("console", (m) => m.text().startsWith("alt-titles:") && jsErrors.push(m.text()));
  await page.route("https://graphql.anilist.co/**", async (route) => {
    anilistCalls++;
    const ids = JSON.parse(route.request().postData()).variables.ids;
    const all = {
      154587: {
        id: 154587,
        title: {
          romaji: "Sousou no Frieren",
          english: "Frieren: Beyond Journey's End",
          native: "葬送のフリーレン",
        },
        synonyms: [],
      },
      53390: {
        id: 53390,
        title: { romaji: "Shingeki no Kyojin", english: "Attack on Titan", native: "進撃の巨人" },
        synonyms: [],
      },
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { Page: { media: ids.map((i) => all[i]).filter(Boolean) } } }),
    });
  });
  await page.route("**/api/shikimori", async (route) => {
    shikiCalls++;
    const path = JSON.parse(route.request().postData()).path;
    const list = path.startsWith("/api/animes")
      ? [{ id: 52991, name: "Sousou no Frieren", russian: "Провожающая в последний путь Фрирен" }]
      : [{ id: 23390, name: "Shingeki no Kyojin", russian: "Атака титанов" }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, status: 200, text: JSON.stringify(list) }),
    });
  });
  await page.goto(`${base}/#/`);
  return page;
}

console.log("Первый запуск");
let page = await openApp();
for (let i = 0; i < 40 && (await readAll()).filter((r) => r.alt_titles).length < 2; i++) {
  await page.waitForTimeout(500);
}
const all = await readAll();
const fr = all.find((r) => r.id === 1);
ok(fr.alt_titles.names.includes("Frieren: Beyond Journey's End"), "английское название от AniList");
ok(fr.alt_titles.names.includes("Провожающая в последний путь Фрирен"), "русское от Шикимори");
ok(!fr.alt_titles.names.includes("Фрирен"), "своё название не дублируется");
const aot = all.find((r) => r.id === 2);
ok(
  aot.alt_titles.names.includes("Атака титанов") &&
    !aot.alt_titles.names.includes("Shingeki no Kyojin"),
  "у манги – русское, своё ромадзи не повторено"
);
ok(!all.find((r) => r.id === 3).alt_titles, "игра без номера не тронута");

console.log("Поиск");
await page.click('.tab-btn[aria-controls="tab-reviews"]');
await page.waitForSelector("#rv-grid .review-card-wrap");
const shown = () =>
  page.$$eval("#rv-grid .review-card-wrap", (els) => els.map((e) => e.textContent));
for (const q of ["frieren", "葬送", "Beyond Journey"]) {
  await page.fill("#rv-search", q);
  await page.waitForTimeout(400);
  const t = await shown();
  ok(t.length === 1 && t[0].includes("Фрирен"), `«Отзывы»: «${q}» находит «Фрирен»`);
}
await page.click('.tab-btn[aria-controls="tab-now"]');
await page.waitForSelector("#tab-now .review-card-wrap");
await page.fill("#tab-now .now-search", "атака титанов");
await page.waitForTimeout(400);
const nowShown = await page.$$eval("#tab-now .review-card-wrap", (els) =>
  els.filter((e) => e.offsetParent !== null).map((e) => e.textContent)
);
ok(
  nowShown.length === 1 && nowShown[0].includes("Shingeki"),
  "«Статусы»: «атака титанов» находит «Shingeki no Kyojin»"
);
await page.close();

console.log("Повторный запуск");
const before = [anilistCalls, shikiCalls];
page = await openApp();
await page.waitForTimeout(6000);
ok(anilistCalls === before[0] && shikiCalls === before[1], "уже известное заново не спрашивается");
await page.close();

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
