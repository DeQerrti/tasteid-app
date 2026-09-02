// Раздел «Обновления на телефоне» в настройках → «Приложение» — в
// настоящем браузере, с настоящей вёрсткой settings-edit.js.
//
// Одного диалога с обновлением не хватает, чтобы объяснить, почему на
// телефоне (в отличие от компьютера) скачивание или установка apk
// может отказать, — Play Защита и телефоны не от Google каждый может
// вмешаться по-своему. Подробное пошаговое объяснение живёт отдельным
// разделом в настройках, и показываться должно только на телефоне —
// на компьютере обновление подписано и ставится без единого лишнего
// диалога системы, объяснять там нечего.
//
// Запуск: node tests/browser/mobile-update-settings.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-updatesettings-"));
const port = 8967;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();

async function openAppPanel(mobile) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 900 },
    locale: "ru-RU",
  });
  const page = await context.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(e.message));
  // /api/app/info существует только в electron/main.js – здесь его
  // подставляем напрямую, тем же способом, каким его реально отвечает
  // Electron (для компьютера) или мобильный мост (для телефона).
  await page.route("**/api/app/info", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        mobile,
        version: "0.5.25",
        platform: mobile ? "android" : "win32",
        arch: mobile ? undefined : "x64",
        vaultPath: mobile ? null : "/some/path",
        zoom: 100,
      }),
    })
  );
  await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".side-tab");
  await page.click('.side-tab[data-panel="app"]');
  await page.waitForTimeout(400);
  return { context, page, jsErrors };
}

console.log("На телефоне");
{
  const { context, page, jsErrors } = await openAppPanel(true);
  const state = await page.evaluate(() => {
    const sec = document.getElementById("app-updates-section");
    return {
      hidden: sec?.classList.contains("hidden"),
      heading: sec?.querySelector(".section-h")?.textContent,
      stepCount: sec?.querySelectorAll("li").length,
      mentionsShare: sec?.textContent.includes("Поделиться"),
      mentionsPlayProtect: sec?.textContent.includes("Play Защита"),
    };
  });
  ok(state.hidden === false, "раздел «Обновления на телефоне» показан");
  ok(state.heading === "Обновления на телефоне", `верный заголовок: "${state.heading}"`);
  ok(state.stepCount === 5, `пять шагов инструкции (получили ${state.stepCount})`);
  ok(state.mentionsShare, "объясняет, что делать через «Поделиться»/браузер");
  ok(state.mentionsPlayProtect, "упоминает Play Защиту как вероятную причину");
  ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);
  await context.close();
}

console.log("На компьютере — раздела быть не должно, объяснять там нечего");
{
  const { context, page, jsErrors } = await openAppPanel(false);
  const hidden = await page.evaluate(() =>
    document.getElementById("app-updates-section")?.classList.contains("hidden")
  );
  ok(hidden === true, "раздел скрыт на компьютере");
  ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);
  await context.close();
}

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nобъяснение обновлений на телефоне на месте");
