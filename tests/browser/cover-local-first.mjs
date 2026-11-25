// Обложка: сначала копия с диска, потом внешняя ссылка (imgAttrs в
// js/utils.js).
//
// Реальный случай (ноябрь 2026): у владельца 205 из 282 обложек – ссылки
// на TMDB и AniList. Эти сайты у него то молчат (блокировки, VPN): запрос
// не падает с ошибкой, а просто висит. Раньше ссылка шла первой, а копия –
// только по событию error, поэтому карточки оставались пустыми, хотя копии
// лежали на диске. На компьютере через несколько минут срабатывал таймаут и
// обложки появлялись, на телефоне – нет.
//
// Проверяется (сайт «молчит» – запрос к нему не отвечает вовсе):
//   – копия есть – показывается сразу, и к молчащему сайту не уходит ни
//     одного запроса;
//   – копии нет на диске (не доехала синхронизацией), ссылка отвечает –
//     показывается по ссылке (запасной путь жив);
//   – есть только ссылка / только копия – как раньше;
//   – нет ничего рабочего – заглушка, а не битая картинка.
//
// Запуск: node tests/browser/cover-local-first.mjs

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

// Настоящий PNG 1×1 – чтобы naturalWidth был больше нуля.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64"
);

const HUNG = "https://hung.example"; // «молчит»: запрос не отвечает вовсе
const ALIVE = "https://alive.example"; // отвечает картинкой
const DEAD = "https://dead.example"; // сразу отказывает

// Кириллические имена – как у обложек владельца («сопрано-4ftu2.webp»).
const reviews = [
  {
    id: 1,
    title: "Копия есть, сайт молчит",
    type: "show",
    status: "current",
    cover: `${HUNG}/a.jpg`,
    cover_backup: "/covers-backup/сопрано-aaa11.png",
  },
  {
    id: 2,
    title: "Копии нет на диске, ссылка жива",
    type: "show",
    status: "current",
    cover: `${ALIVE}/b.png`,
    cover_backup: "/covers-backup/нет-такого-bbb22.png",
  },
  {
    id: 3,
    title: "Только ссылка",
    type: "anime",
    status: "current",
    cover: `${ALIVE}/c.png`,
  },
  {
    id: 4,
    title: "Только копия",
    type: "manga",
    status: "current",
    cover_backup: "/covers-backup/игра-на-слабо-ccc33.png",
  },
  {
    id: 5,
    title: "Ничего не работает",
    type: "game",
    status: "current",
    cover: `${DEAD}/e.png`,
    cover_backup: "/covers-backup/тоже-нет-eee55.png",
  },
];

const dir = mkdtempSync(join(tmpdir(), "tasteid-cover-first-"));
mkdirSync(join(dir, "covers-backup"));
writeFileSync(join(dir, "covers-backup", "сопрано-aaa11.png"), PNG);
writeFileSync(join(dir, "covers-backup", "игра-на-слабо-ccc33.png"), PNG);
writeFileSync(join(dir, "reviews.json"), JSON.stringify(reviews));
writeFileSync(join(dir, "site-settings.json"), JSON.stringify({}));

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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

const asked = { hung: 0, alive: 0, dead: 0 };
await page.route(`${HUNG}/**`, () => {
  asked.hung++; // ни fulfill, ни abort: запрос висит, как у молчащего сайта
});
await page.route(`${ALIVE}/**`, (route) => {
  asked.alive++;
  route.fulfill({ contentType: "image/png", body: PNG });
});
await page.route(`${DEAD}/**`, (route) => {
  asked.dead++;
  route.abort("connectionrefused");
});

await page.goto(`http://127.0.0.1:${port}/#/`, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[aria-controls="tab-now"]');
await page.waitForSelector("#tab-now .review-card-wrap img");

// Ждём, пока все пять картинок кончат грузиться (или упрутся в заглушку);
// у «молчащей» ссылки ждать нечего – если бы она шла первой, это место
// осталось бы пустым и тест упал бы по таймауту здесь.
await page.waitForFunction(
  () =>
    [...document.querySelectorAll("#tab-now .review-card-wrap img")].every(
      (img) => img.complete && img.naturalWidth > 0
    ),
  null,
  { timeout: 8000 }
);

const shown = await page.$$eval("#tab-now .review-card-wrap", (wraps) =>
  Object.fromEntries(
    wraps.map((w) => {
      const img = w.querySelector("img");
      return [
        w.dataset.title,
        { src: decodeURIComponent(img.currentSrc || img.src), w: img.naturalWidth },
      ];
    })
  )
);

console.log("Копия есть, сайт молчит");
const a = shown["копия есть, сайт молчит"];
ok(a && a.src.endsWith("/covers-backup/сопрано-aaa11.png") && a.w > 0, "показана копия с диска");
ok(asked.hung === 0, `к молчащему сайту не ушло ни одного запроса (${asked.hung})`);

console.log("Копии нет на диске, ссылка жива");
const b = shown["копии нет на диске, ссылка жива"];
ok(b && b.src.startsWith(ALIVE) && b.w > 0, "показана по ссылке – запасной путь работает");

console.log("Только ссылка / только копия");
const c = shown["только ссылка"];
ok(c && c.src.startsWith(ALIVE) && c.w > 0, "только ссылка – по ссылке");
const d = shown["только копия"];
ok(
  d && d.src.endsWith("/covers-backup/игра-на-слабо-ccc33.png") && d.w > 0,
  "только копия – с диска"
);

console.log("Ничего не работает");
const e = shown["ничего не работает"];
ok(e && e.src.startsWith("data:image/svg"), "вместо битой картинки – заглушка");

ok(!jsErrors.length, "ошибок JS нет" + (jsErrors.length ? ": " + jsErrors.join("; ") : ""));

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок не прошли.`);
  process.exit(1);
}
console.log("\nВсё прошло.");
