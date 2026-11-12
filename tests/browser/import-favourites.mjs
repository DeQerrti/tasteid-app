// Импорт по нику с AniList забирает и «Любимое» профиля: персонажей и
// людей с галочками, уже заведённых пропускает, привязывает записи к
// своим отзывам (и к только что импортированным), связывает персонажа с
// его сэйю, делает резервные копии картинок и ставит ♥ тайтлам из
// избранного. AniList подменён, картинки отдаёт свой сервер.
//
// Запуск: node tests/browser/import-favourites.mjs
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

// Картинки: резервную копию делает сервер приложения, он ходит за ними
// сам – page.route() туда не достаёт, нужен настоящий сервер картинок.
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-impfav-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { id: 1, title: "Fate/Zero", type: "anime", status: "completed", ids: { anilist: 10087 } },
  ])
);
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([{ id: 1, type: "person", subtype: "author", name: "Gen Urobuchi" }])
);

const port = 8100 + (process.pid % 90);
const base = `http://127.0.0.1:${port}`;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const FZ = { id: 10087, idMal: 10087, title: { romaji: "Fate/Zero", english: null } };
const NEW = { id: 777, idMal: 777, title: { romaji: "New Show", english: null } };
const listResponse = (type) => ({
  data: {
    MediaListCollection: {
      lists:
        type === "ANIME"
          ? [
              {
                isCustomList: false,
                entries: [
                  {
                    status: "COMPLETED",
                    score: 9,
                    repeat: 0,
                    startedAt: {},
                    completedAt: { year: 2025, month: 1, day: 2 },
                    media: {
                      ...NEW,
                      type: "ANIME",
                      format: "TV",
                      countryOfOrigin: "JP",
                      title: { ...NEW.title, native: null },
                      startDate: { year: 2024 },
                      coverImage: { large: img("new") },
                    },
                  },
                ],
              },
            ]
          : [],
    },
  },
});
const favResponse = {
  data: {
    User: {
      favourites: {
        characters: {
          nodes: [
            {
              id: 11,
              name: { full: "Kiritsugu Emiya", native: "衛宮切嗣" },
              image: { large: img("kiritsugu") },
              media: {
                nodes: [FZ],
                edges: [{ voiceActors: [{ name: { full: "Rikiya Koyama" } }] }],
              },
            },
            {
              id: 12,
              name: { full: "Saber", native: null },
              image: { large: img("saber") },
              media: { nodes: [FZ], edges: [] },
            },
          ],
        },
        staff: {
          nodes: [
            {
              id: 21,
              name: { full: "Urobuchi Gen", native: null },
              image: { large: img("gen") },
              primaryOccupations: ["Writer"],
              staffMedia: { nodes: [FZ] },
              characterMedia: { nodes: [] },
            },
            {
              id: 22,
              name: { full: "Rikiya Koyama", native: null },
              image: { large: img("rikiya") },
              primaryOccupations: ["Voice Actor"],
              staffMedia: { nodes: [] },
              characterMedia: { nodes: [FZ] },
            },
          ],
        },
        anime: { nodes: [FZ, NEW] },
        manga: { nodes: [] },
      },
    },
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.route("https://graphql.anilist.co/**", (route) => {
  const body = route.request().postDataJSON();
  const json = body.query.includes("favourites") ? favResponse : listResponse(body.variables.type);
  route.fulfill({ contentType: "application/json", body: JSON.stringify(json) });
});

await page.goto(`${base}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.click('[data-panel="import"]');
await page.waitForSelector("#imp-anilist-user");
await page.fill("#imp-anilist-user", "someone");
await page.click("#imp-anilist-go");
await page.waitForSelector(".imp-fav-grid", { timeout: 15000 });

console.log("Экран проверки");
ok((await page.locator(".imp-fav-card").count()) === 4, "4 карточки: 2 персонажа и 2 человека");
ok(
  (await page.locator(".imp-fav-card.is-dup").count()) === 1,
  "уже заведённый (Urobuchi Gen ↔ Gen Urobuchi) приглушён"
);
ok((await page.locator("[data-fav-key]:checked").count()) === 3, "новые отмечены по умолчанию");
await page.uncheck('[data-fav-key="c:12"]');

console.log("Перенос");
await page.click("#imp-run");
await page.waitForSelector(".imp-stat-label:has-text('в «Любимое»')", { timeout: 30000 });

const fav = await page.evaluate(async () =>
  (await fetch("/favorites.json?_=" + Date.now())).json()
);
const rev = await page.evaluate(async () => (await fetch("/reviews.json?_=" + Date.now())).json());
const by = (n) => fav.find((e) => e.name === n);
const fz = rev.find((r) => r.title === "Fate/Zero");
const added = rev.find((r) => r.title === "New Show");
ok(!!added, "тайтл из списка импортирован");
ok(!by("Saber"), "снятая галочка – Saber не заведён");
ok(fav.filter((e) => /urobuchi/i.test(e.name)).length === 1, "уже заведённый человек не задвоился");
ok(by("Kiritsugu Emiya")?.from === "Fate/Zero", "у персонажа «откуда»");
ok(by("Kiritsugu Emiya")?.linked_review_ids?.includes(fz.id), "персонаж привязан к своему отзыву");
ok(!!by("Kiritsugu Emiya")?.image_backup, "картинка с резервной копией");
ok(by("Rikiya Koyama")?.subtype === "seiyuu", "роль человека – сэйю");
ok(
  (by("Kiritsugu Emiya")?.linked_favorite_ids || []).includes(by("Rikiya Koyama")?.id),
  "персонаж связан со своим сэйю"
);
ok(fz.favorite === true, "♥ у тайтла из избранного, который уже был в паспорте");
ok(added?.favorite === true, "♥ и у тайтла, импортированного этим же разом");

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
imgServer.close();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
