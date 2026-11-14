// Настройки → «Оценки»: смена типа шкалы у человека, у которого своей шкалы
// в файле ещё нет (стандартные полки).
//
// Раньше «шкала как была до правки» для такого человека была пустым списком
// полок, и при первом же переходе с «Названий» на «Числа»/«Звёзды» пересчёту
// оценок не с чего было считать: все поставленные оценки оставались
// строками-ключами («etalon»), числовая шкала их не понимала, и отзывы
// выглядели без оценки.
//
// Запуск: node tests/browser/settings-grade-scale.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-gradescale-"));
const base = { type: "anime", status: "completed", date_end: "2024-01-01" };
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { ...base, title: "Лучший", grade: "rezonans" },
    { ...base, title: "Средний", grade: "attrakcion" },
    { ...base, title: "Худший", grade: "razocharo" },
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
await page.waitForSelector(".side-tab", { timeout: 10000 });
await page.click('.side-tab[data-panel="grades"]');
await page.waitForSelector("#catShelvesList .shelf-row");

const gradesOf = () =>
  page.evaluate(async () =>
    Object.fromEntries(
      (await (await fetch("/reviews.json?_=" + Date.now())).json()).map((r) => [r.title, r.grade])
    )
  );

console.log("Смена типа шкалы без своей шкалы в файле");
await page.click('#scaleTypeGrid [data-scale="numeric"]');
await page.waitForSelector("#shelvesList .shelf-row");
await page.click("#set-savebar-save");
await page.waitForTimeout(1500);
const g = await gradesOf();
ok(
  typeof g["Лучший"] === "number" &&
    typeof g["Средний"] === "number" &&
    typeof g["Худший"] === "number",
  `оценки стали числами (${JSON.stringify(g)})`
);
ok(
  g["Лучший"] > g["Средний"] && g["Средний"] > g["Худший"],
  "порядок оценок сохранился: лучший выше среднего, средний выше худшего"
);

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nсмена шкалы без своей шкалы в файле работает");
