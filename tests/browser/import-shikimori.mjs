// Импорт по нику с Шикимори: список аниме и манги (номера Шикимори =
// номера MAL, идут в ids.mal) и «Любимое» профиля – тем же экраном
// проверки, что у AniList. Шикимори подменён, картинки отдаёт свой сервер.
//
// Отдельно проверяется, что номер тайтла Шикимори не принимается за номер
// AniList: отзыв с ids.anilist, случайно равным номеру Шикимори, не должен
// получить ♥ «из избранного профиля».
//
// Запуск: node tests/browser/import-shikimori.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
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

// Резервную копию картинки делает сервер приложения сам – page.route()
// туда не достаёт, нужен настоящий сервер картинок.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg+G+DHQ0tCQC2ik7BakjxzwAAAABJRU5ErkJggg==",
  "base64"
);
const imgServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "image/png" });
  res.end(PNG);
});
await new Promise((r) => imgServer.listen(0, "127.0.0.1", r));
const img = (n) => `http://127.0.0.1:${imgServer.address().port}/${n}.png`;

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-impshiki-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { id: 1, title: "Fate/Zero", type: "anime", status: "completed", ids: { mal: 10087 } },
    // Номер AniList совпадает с номером Шикимори у Fate/Zero – случайно.
    {
      id: 2,
      title: "Совсем другой тайтл",
      type: "anime",
      status: "completed",
      ids: { anilist: 10087 },
    },
  ])
);
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([{ id: 1, type: "person", subtype: "author", name: "Gen Urobuchi" }])
);

const port = 8100 + ((process.pid + 37) % 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const FZ = { id: 10087, name: "Fate/Zero", russian: "Судьба: Начало", kind: "tv" };
const API = {
  "/api/users/someone?is_nickname=1": { id: 42, nickname: "someone" },
  "/api/users/42/anime_rates": [
    {
      score: 9,
      status: "completed",
      rewatches: 2,
      anime: {
        id: 777,
        name: "New Show",
        russian: "Новое шоу",
        kind: "tv",
        aired_on: "2024-04-01",
        image: { original: img("new") },
      },
    },
    {
      score: 0,
      status: "planned",
      rewatches: 0,
      anime: {
        id: 778,
        name: "No Cover Show",
        kind: "ona",
        aired_on: null,
        image: { original: "/assets/globals/missing_original.jpg" },
      },
    },
  ],
  "/api/users/42/manga_rates": [
    {
      score: 7,
      status: "on_hold",
      rewatches: 0,
      manga: {
        id: 555,
        name: "Some Manhwa",
        kind: "manhwa",
        aired_on: "2019-01-01",
        image: { original: img("mh") },
      },
    },
  ],
  "/api/users/42/favourites": {
    animes: [{ id: 10087, name: "Fate/Zero", russian: "Судьба: Начало", image: "/x.jpg" }],
    mangas: [],
    ranobe: [],
    characters: [
      { id: 11, name: "Kiritsugu Emiya", russian: "Кирицугу Эмия", image: img("kiritsugu") },
      { id: 12, name: "Saber", russian: "Сэйбер", image: img("saber") },
    ],
    people: [],
    mangakas: [{ id: 21, name: "Urobuchi Gen", russian: "Гэн Уробути", image: img("gen") }],
    seyu: [{ id: 22, name: "Rikiya Koyama", russian: "Рикия Кояма", image: img("rikiya") }],
    producers: [],
  },
  "/api/characters/11": {
    image: { original: img("kiritsugu") },
    animes: [FZ],
    mangas: [],
    seyu: [{ id: 22, name: "Rikiya Koyama" }],
  },
  "/api/characters/12": { image: { original: img("saber") }, animes: [FZ], mangas: [], seyu: [] },
  "/api/people/21": { image: { original: img("gen") }, works: [{ anime: FZ }], roles: [] },
  "/api/people/22": {
    image: { original: img("rikiya") },
    works: [],
    roles: [{ characters: [], animes: [FZ] }],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
const asked = [];
await page.route("https://shikimori.io/api/**", (route) => {
  const url = new URL(route.request().url());
  asked.push(url.pathname + url.search);
  const key = url.pathname.endsWith("_rates") ? url.pathname : url.pathname + url.search;
  // Вторая страница списка – пусто (на первой меньше предела).
  const body = url.searchParams.get("page") > 1 ? [] : API[key];
  if (body === undefined)
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  route.fulfill({
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  });
});

await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.click('[data-panel="import"]');
await page.waitForSelector("#imp-shiki-user");

console.log("Неизвестный ник");
await page.fill("#imp-shiki-user", "nobody");
await page.click("#imp-shiki-go");
await page.waitForSelector("#imp-shiki-status.err", { timeout: 15000 });
ok(
  /не знает пользователя «nobody»/.test(await page.textContent("#imp-shiki-status")),
  "понятная ошибка с ником"
);

console.log("Список и экран проверки");
// Ссылка на профиль целиком – ник достаётся из неё.
await page.fill("#imp-shiki-user", "https://shikimori.io/someone/list/anime");
await page.click("#imp-shiki-go");
await page.waitForSelector(".imp-fav-grid", { timeout: 30000 });
ok(asked.includes("/api/users/someone?is_nickname=1"), "ник взят из вставленной ссылки");
ok(
  (await page.textContent(".imp-source-line")).includes("someone"),
  "в строке источника – Шикимори и ник"
);
ok((await page.locator(".imp-fav-card").count()) === 4, "4 карточки: 2 персонажа и 2 человека");
ok(
  (await page.locator(".imp-fav-card.is-dup").count()) === 1,
  "уже заведённый (Urobuchi Gen) приглушён"
);
await page.uncheck('[data-fav-key="c:12"]');

console.log("Перенос");
await page.click("#imp-run");
await page.waitForSelector(".imp-stat-label:has-text('в «Любимое»')", { timeout: 30000 });

const fav = await page.evaluate(async () =>
  (await fetch("/favorites.json?_=" + Date.now())).json()
);
const rev = await page.evaluate(async () => (await fetch("/reviews.json?_=" + Date.now())).json());
const by = (n) => fav.find((e) => e.name === n);
const show = rev.find((r) => r.title === "New Show");
const manhwa = rev.find((r) => r.title === "Some Manhwa");
const noCover = rev.find((r) => r.title === "No Cover Show");
ok(show?.ids?.mal === 777, "номер Шикимори записан как номер MAL");
ok(show?.year === "2024", "год из даты выхода");
ok(show?.rewatch_count === 2, "число пересмотров");
ok(manhwa?.type === "manhwa", "манхва распознана по виду");
ok(
  !!noCover && !/missing_/.test(noCover.cover || ""),
  "заглушка Шикимори вместо обложки не сохранена"
);
ok(by("Kiritsugu Emiya")?.from === "Fate/Zero", "у персонажа «откуда»");
ok(
  by("Kiritsugu Emiya")?.linked_review_ids?.includes(1),
  "персонаж привязан к своему отзыву по номеру MAL"
);
ok(!!by("Kiritsugu Emiya")?.image_backup, "картинка с резервной копией");
ok(by("Rikiya Koyama")?.subtype === "seiyuu", "роль из корзины «сэйю»");
ok(
  (by("Kiritsugu Emiya")?.linked_favorite_ids || []).includes(by("Rikiya Koyama")?.id),
  "персонаж связан со своим сэйю"
);
ok(!by("Saber"), "снятая галочка – Saber не заведён");
ok(fav.filter((e) => /urobuchi/i.test(e.name)).length === 1, "уже заведённый человек не задвоился");
ok(rev.find((r) => r.id === 1)?.favorite === true, "♥ у Fate/Zero из избранного профиля");
ok(
  !rev.find((r) => r.id === 2)?.favorite,
  "номер Шикимори не спутан с номером AniList – чужой отзыв без ♥"
);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
imgServer.close();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
