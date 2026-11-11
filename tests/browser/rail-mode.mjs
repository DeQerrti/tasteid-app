// Вид боковой панели: меню из трёх видов вместо кнопки «свернуть».
// Проверяет: меню открывается, каждый вид ставит свой класс и ширину,
// выбор переживает перезагрузку, прежняя настройка «свёрнуто»
// (tasteid-rail-collapsed = "1") переносится как «Прятать», а на
// телефоне вид панели ничего не меняет (там она нижняя).
//
// Запуск: node tests/browser/rail-mode.mjs
// В npm run check не входит (нужен настоящий браузер), гоняется
// npm run test:browser и отдельным CI-джобом.

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-rail-mode-"));
const port = 8500 + (process.pid % 90);
const base = `http://127.0.0.1:${port}`;
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

const railWidth = () =>
  page.evaluate(() => Math.round(document.getElementById("rail").getBoundingClientRect().width));
const bodyClass = () => page.evaluate(() => document.body.className);
const pick = async (mode) => {
  await page.click("#rail-collapse-btn");
  await page.click(`.rail-mode-option[data-mode="${mode}"]`);
};

await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#rail-collapse-btn");

console.log("Меню вида панели");
await page.click("#rail-collapse-btn");
ok(await page.isVisible(".rail-mode-menu"), "кнопка открывает меню");
ok((await page.locator(".rail-mode-option").count()) === 3, "в меню три вида");
await page.keyboard.press("Escape");
ok(await page.isHidden(".rail-mode-menu"), "Escape закрывает меню");

console.log("Только иконки");
await pick("icons");
ok((await bodyClass()).includes("rail-icons"), "класс rail-icons на body");
ok((await railWidth()) <= 80, `рельса узкая (${await railWidth()}px)`);
ok(await page.isHidden("nav#rail .tab-label"), "подписи разделов скрыты");
ok(
  (await page.getAttribute('nav#rail .tab-btn[aria-controls="tab-reviews"]', "title")) !== null,
  "у иконок есть подсказка"
);
await page.reload({ waitUntil: "domcontentloaded" });
ok((await bodyClass()).includes("rail-icons"), "вид сохраняется после перезагрузки");

console.log("Прятать");
await pick("hidden");
ok((await bodyClass()).includes("rail-collapsed"), "класс rail-collapsed на body");
ok(!(await bodyClass()).includes("rail-icons"), "rail-icons снят");

console.log("Развёрнута");
await pick("full");
const cls = await bodyClass();
ok(!cls.includes("rail-collapsed") && !cls.includes("rail-icons"), "оба класса сняты");
ok((await railWidth()) > 150, `рельса широкая (${await railWidth()}px)`);

console.log("Старая настройка «свёрнуто» переносится как «Прятать»");
await page.evaluate(() => {
  localStorage.removeItem("tasteid-rail-mode");
  localStorage.setItem("tasteid-rail-collapsed", "1");
});
await page.reload({ waitUntil: "domcontentloaded" });
ok((await bodyClass()).includes("rail-collapsed"), "панель спрятана после обновления");
ok(
  (await page.evaluate(() => localStorage.getItem("tasteid-rail-mode"))) === "hidden",
  "записан вид hidden"
);

console.log("Телефон: вид панели не влияет на нижнюю панель");
await page.evaluate(() => localStorage.setItem("tasteid-rail-mode", "icons"));
await page.setViewportSize({ width: 375, height: 812 });
await page.reload({ waitUntil: "domcontentloaded" });
ok((await railWidth()) === 375, `нижняя панель на всю ширину (${await railWidth()}px)`);
ok(
  await page.isVisible('nav#rail .tab-btn[aria-controls="tab-reviews"] .tab-label'),
  "подписи вкладок видны"
);

ok(jsErrors.length === 0, `нет ошибок JS на странице (${jsErrors.join("; ")})`);

await browser.close();
server.kill();
if (failures.length) {
  console.log(`\n${failures.length} проверок провалилось`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
