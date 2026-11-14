// Настройки → «Приложение»: строки «название слева, действие справа».
//
// Вкладка «Приложение» есть только в настоящем приложении (отвечает
// /api/app/info), поэтому ответ подставляется. Проверяется:
//   – шесть строк, путь и версия показаны текстом, а не полями в рамке;
//   – кнопки на месте и с теми же обработчиками (на них завязаны другие тесты);
//   – на телефоне блок «Открыть в проводнике / Сменить папку» остаётся скрытым
//     (display: flex у строки не должен перебивать класс hidden).
//
// Запуск: node tests/browser/settings-app-panel.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-apppanel-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { title: "Тайтл", type: "anime", grade: "etalon", status: "completed", date_end: "2024-01-01" },
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
const jsErrors = [];
const openPanel = async (info) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => jsErrors.push(e.message));
  await page.route("**/api/app/info", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(info) })
  );
  await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tab-app:not(.hidden)", { timeout: 10000 });
  await page.click("#tab-app");
  await page.waitForSelector("#panel-app.active .set-row");
  return page;
};

console.log("Компьютер");
const page = await openPanel({
  vaultPath: "C:\\Данные\\TasteID",
  zoom: 100,
  version: "0.7.12",
  platform: "win32",
  arch: "x64",
});
ok((await page.$$("#panel-app .set-row")).length === 6, "шесть строк");
ok(
  (await page.$eval("#app-vault-path", (e) => e.textContent)) === "C:\\Данные\\TasteID",
  "путь к папке показан"
);
ok((await page.$eval("#app-version", (e) => e.textContent)).includes("0.7.12"), "версия показана");
ok(
  (await page.$eval("#app-vault-path", (e) => getComputedStyle(e).borderTopStyle)) === "none",
  "путь – текст без пунктирной рамки"
);
ok(
  !!(await page.$('#panel-app button[onclick="exportBackup()"]')),
  "кнопка резервной копии на месте"
);
ok(
  !!(await page.$("#backup-file")) && !!(await page.$("#btn-check-update")),
  "восстановление и проверка обновлений на месте"
);
ok(
  await page.$eval("#app-vault-actions", (e) => getComputedStyle(e).display !== "none"),
  "на компьютере кнопки папки видны"
);
await page.close();

console.log("Телефон");
const phone = await openPanel({
  vaultPath: "",
  zoom: 100,
  version: "0.7.12",
  platform: "android",
  arch: "arm64",
  mobile: true,
});
await phone.waitForSelector("#app-vault-actions.hidden", { state: "attached" });
ok(
  await phone.$eval("#app-vault-actions", (e) => getComputedStyle(e).display === "none"),
  "на телефоне кнопки папки скрыты"
);
ok(
  await phone.$eval("#app-vault-mobile-note", (e) => getComputedStyle(e).display !== "none"),
  "вместо них – пояснение про внутреннюю папку"
);
await phone.close();

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nпанель «Приложение» работает");
