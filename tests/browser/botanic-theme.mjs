// Ботаническая тема («Мягкий ботанический», тёмная и светлая): вид
// «полевого дневника» на боковой панели и вкладке «Статусы».
//
// Проверяется (на ширине компьютера, в обеих темах):
//   – файлы украшений из /decor отдаются сервером;
//   – вкладки статусов – текстом на ветке, без капсул и заглавных букв;
//     лист под выбранной вкладкой стоит НА ветке и не выходит за неё вниз
//     (owner поправлял именно это);
//   – кнопки типов – тихой строкой, без рамок;
//   – карточка – лист гербария: поля вокруг обложки, тип – бумажным
//     ярлычком;
//   – выбранный раздел в боковой панели – на бумажном ярлычке.
//
// Запуск: node tests/browser/botanic-theme.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-botanic-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "Растёт",
      type: "anime",
      status: "current",
      year: 2024,
      date_start: "2024-03-01",
    },
    { id: 2, title: "Ждёт", type: "manga", status: "planning", year: 2020 },
    {
      id: 3,
      title: "Цветёт",
      type: "movie",
      status: "current",
      year: 2021,
      date_start: "2024-04-01",
    },
    {
      id: 4,
      title: "Любимый",
      type: "book",
      status: "completed",
      year: 2010,
      grade: "etalon",
      favorite: true,
    },
  ])
);
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([
    { id: 1, name: "Садовник", type: "person", subtype: "director" },
    { id: 2, name: "Ботаник", type: "person", subtype: "author" },
  ])
);

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
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

console.log("Украшения");
for (const name of ["leaf.svg", "leaf-up.svg", "branch.svg", "fern-top.svg", "fern-bottom.svg"]) {
  const res = await page.request.get(`${base}/decor/${name}`);
  ok(res.ok(), `/decor/${name} отдаётся`);
}

for (const theme of ["soft-dark", "soft"]) {
  console.log(`Тема ${theme}`);
  writeFileSync(join(vaultDir, "site-settings.json"), JSON.stringify({ theme }));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[data-label="nav.now"]');
  await page.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });

  // Ярлычок выбранного раздела проявляется плавно – ждём конца перехода.
  await page.waitForTimeout(500);
  const look = await page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const toggle = document.querySelector("#tab-now > .tl-mode-toggle");
    const btn = toggle.querySelector(".tl-mode-btn.active");
    const leaf = css(btn, "::after");
    const branch = css(toggle, "::after");
    // Низ листа и середина ветки – в пикселях от низа строки вкладок.
    const padBottom = parseFloat(css(toggle).paddingBottom);
    const leafBottom = padBottom + parseFloat(leaf.bottom);
    const branchMid = parseFloat(branch.bottom) + parseFloat(branch.height) / 2;
    const chip = document.querySelector("#tab-now .now-chip:not(.active)");
    const card = document.querySelector("#tab-now .review-card-wrap .card");
    const tag = card.querySelector(".type-tag");
    const rail = document.querySelector("#rail .tab-btn.active");
    const paper = css(document.documentElement).getPropertyValue("--paper").trim();
    const probe = document.createElement("i");
    probe.style.color = paper;
    document.body.appendChild(probe);
    const paperRgb = css(probe).color;
    probe.remove();
    return {
      btnBg: css(btn).backgroundColor,
      btnCase: css(btn).textTransform,
      btnStyle: css(btn).fontStyle,
      branchMask: branch.maskImage || branch.webkitMaskImage,
      leafBottom,
      branchMid,
      leafTop: leafBottom + parseFloat(leaf.height),
      padBottom,
      chipBorder: css(chip).borderTopWidth,
      cardPad: css(card).paddingLeft,
      tagBg: css(tag).backgroundColor,
      railBg: css(rail).backgroundColor,
      paperRgb,
    };
  });

  ok(
    look.btnBg === "rgba(0, 0, 0, 0)" && look.btnCase === "none" && look.btnStyle === "italic",
    "вкладки статусов – курсивом, без капсулы и заглавных"
  );
  ok(/branch\.svg/.test(look.branchMask || ""), "под вкладками статусов – ветка");
  ok(
    Math.abs(look.leafBottom - look.branchMid) <= 2,
    `лист стоит на ветке, а не выходит за неё (низ листа ${look.leafBottom.toFixed(1)}, ветка ${look.branchMid.toFixed(1)})`
  );
  ok(look.leafTop <= look.padBottom, "и не задевает название вкладки сверху");
  ok(look.chipBorder === "0px", "кнопки типов – без рамок");
  ok(parseFloat(look.cardPad) >= 8, `у обложки поля, как у листа гербария (${look.cardPad})`);
  ok(look.tagBg === look.paperRgb, "тип на карточке – бумажным ярлычком");

  // «Любимое» – в том же языке: ветка под разделами, листы гербария,
  // роли на ярлычках; при наведении в панели – не прежняя капсула.
  await page.click('.tab-btn[data-label="nav.favorites"]');
  await page.waitForSelector("#tab-favorites .review-card-wrap", { timeout: 10000 });
  const favTitles = await page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const head = css(document.querySelector("#tab-favorites > .fav-head"), "::after");
    const card = document.querySelector("#tab-favorites .review-card-wrap .card");
    const btn = document.querySelector("#tab-favorites .fav-head .tl-mode-btn.active");
    const order = document.querySelector("#fav-action-link .admin-add-btn");
    return {
      branchMask: head.maskImage || head.webkitMaskImage,
      cardPad: css(card).paddingLeft,
      btnCase: css(btn).textTransform,
      orderBorder: css(order).borderTopWidth,
      railRadius: css(document.querySelector("#rail .tab-btn:not(.active)")).borderTopLeftRadius,
    };
  });
  ok(/branch\.svg/.test(favTitles.branchMask || ""), "«Любимое»: под разделами – ветка");
  ok(favTitles.btnCase === "none", "«Любимое»: разделы – без заглавных букв");
  ok(parseFloat(favTitles.cardPad) >= 8, "«Любимое»: тайтл – лист гербария с полями");
  ok(favTitles.orderBorder === "0px", "«Любимое»: «Порядок» – строкой, без рамки");
  ok(favTitles.railRadius === "2px", "боковая панель: при наведении – ярлычок, а не капсула");

  await page.click('#tab-favorites .tl-mode-btn[data-mode="favPersons"]');
  await page.waitForSelector("#tab-favorites .card-char", { timeout: 10000 });
  const favPersons = await page.evaluate(() => {
    const css = (el) => getComputedStyle(el);
    const paper = css(document.documentElement).getPropertyValue("--paper").trim();
    const probe = document.createElement("i");
    probe.style.color = paper;
    document.body.appendChild(probe);
    const paperRgb = css(probe).color;
    probe.remove();
    return {
      charPad: css(document.querySelector("#tab-favorites .card-char")).paddingLeft,
      headBg: css(document.querySelector("#tab-favorites .fav-role-head")).backgroundColor,
      paperRgb,
    };
  });
  ok(parseFloat(favPersons.charPad) >= 7, "«Любимое»: персона – лист гербария с полями");
  ok(favPersons.headBg === favPersons.paperRgb, "«Любимое»: название роли – на бумажном ярлычке");
  ok(look.railBg === look.paperRgb, "выбранный раздел панели – на бумажном ярлычке");
}

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nботаническая тема на месте");
