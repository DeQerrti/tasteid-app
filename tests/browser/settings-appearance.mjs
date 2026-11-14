// Настройки → «Оформление»: выключатель тегов, карточки тем, палитра.
//
// Проверяется:
//   – выключатель «Показывать теги на карточках» показывает настоящее
//     состояние: у всех скрыты – выключен, ни у кого – включён, у части –
//     «посередине» (aria-checked="mixed"); клик из «посередине» показывает
//     теги у всех, а не прячет;
//   – тема выбирается одним кликом по половине карточки (светлая/тёмная),
//     без попапа;
//   – палитра разложена по группам, а справа – образец настоящими
//     карточками отзывов.
//
// Запуск: node tests/browser/settings-appearance.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-setappearance-"));
const base = {
  type: "anime",
  grade: "etalon",
  status: "completed",
  date_end: "2024-01-01",
  cover: "x",
};
// Теги скрыты только у первого – «у части».
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { ...base, title: "Один", tags: ["Топ визуал"], no_tags_on_card: true },
    { ...base, title: "Два", tags: ["Топ визуал"] },
    { ...base, title: "Три", tags: ["Топ визуал"] },
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#hide-tags-toggle", { timeout: 10000 });
await page.waitForSelector(".theme-card", { timeout: 10000 });

const checked = () => page.getAttribute("#hide-tags-toggle", "aria-checked");
const hiddenCount = () =>
  page.evaluate(
    async () =>
      (await (await fetch("/reviews.json?_=" + Date.now())).json()).filter((r) => r.no_tags_on_card)
        .length
  );

console.log("Выключатель тегов");
ok((await checked()) === "mixed", "теги скрыты у части – выключатель «посередине»");
await page.click("#hide-tags-toggle");
await page.waitForFunction(
  () => document.getElementById("hide-tags-toggle").getAttribute("aria-checked") === "true"
);
ok((await hiddenCount()) === 0, "клик из «посередине» показывает теги у всех (скрыты у 0)");
await page.click("#hide-tags-toggle");
await page.waitForFunction(
  () => document.getElementById("hide-tags-toggle").getAttribute("aria-checked") === "false"
);
ok((await hiddenCount()) === 3, "клик из «включён» скрывает теги у всех");
ok(!(await page.$(".hide-tags-toggle")), "старой кнопки на всю ширину нет");

console.log("Темы");
ok((await page.$$(".theme-card")).length === 5, "пять карточек тем");
ok(!(await page.$(".theme-popover")), "попапа «светлая/тёмная» больше нет");
await page.click('.theme-half[data-theme="soft"]');
ok(
  (await page.getAttribute("html", "data-skin")) === "soft",
  "один клик по половине карточки переключает тему"
);
ok(
  (await page.getAttribute('.theme-half[data-theme="soft"]', "aria-pressed")) === "true",
  "выбранная половина отмечена"
);

console.log("Палитра");
const groups = await page.$$eval(".pal-group-title", (els) => els.map((e) => e.textContent.trim()));
ok(groups.join(",") === "Фоны,Линии,Текст,Акцент", `группы цветов (${groups.join(", ")})`);
ok((await page.$$("#paletteList input[type=color]")).length === 10, "десять цветов на месте");
ok((await page.$$(".pal-sample .card")).length >= 1, "справа образец настоящими карточками");

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nнастройки «Оформление» работают");
