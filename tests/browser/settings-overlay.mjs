// Настройки окном поверх приложения (как в Obsidian) и одна полоса
// «Сохранить» вместо пяти кнопок по панелям.
//
// Проверяется: на ПК #/settings-edit не прячет приложение, а открывается
// окном (#view-root.route-overlay); закрывается ✕, Escape и кликом по
// затемнению; цифры 1–5 под открытым окном не переключают вкладки;
// полоса «Сохранить» появляется после правки, сохраняет на диск и
// пропадает; старые адреса ?panel=labels / ?panel=vaults ведут на новые
// места; у клавиш вкладок вместо «не задано» – цифра по умолчанию; на
// телефоне настройки по-прежнему на весь экран, без окна.
//
// Запуск: node tests/browser/settings-overlay.mjs
// playwright – обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), гоняется в CI отдельным джобом (npm run test:browser).

/* global settingsDirty */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-setoverlay-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    { title: "Тайтл", type: "anime", grade: "etalon", status: "completed", date_end: "2024-01-01" },
  ])
);

// Свободный порт у системы, а не зашитый (см. chars-favorites-cover-cleanup.mjs).
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const jsErrors = [];
// С первой строкой стека: «Cannot set properties of null» без места
// ошибки ничего не говорит.
const errText = (e) => `${e.message} @ ${(e.stack || "").split("\n")[1]?.trim() || "?"}`;
page.on("pageerror", (e) => jsErrors.push(errText(e)));
const base = `http://127.0.0.1:${port}/`;
const isOpen = () => page.evaluate(() => location.hash.startsWith("#/settings-edit"));
const openSettings = async (hash = "#/settings-edit") => {
  await page.evaluate((h) => (location.hash = h), hash);
  await page.waitForSelector("#view-root:not(.hidden) #sidebar .side-tab", { timeout: 10000 });
};

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.click('.tab-btn[data-label="nav.tierlist"]');
await page.waitForSelector("#tab-tierlist:not(.hidden)");

console.log("ПК: окно поверх приложения");
await openSettings();
ok(
  await page.evaluate(() =>
    document.getElementById("view-root").classList.contains("route-overlay")
  ),
  "у #view-root класс окна"
);
ok(
  await page.evaluate(
    () => getComputedStyle(document.getElementById("shell-root")).display !== "none"
  ),
  "приложение под окном не спрятано"
);
ok(await page.isVisible("#se-close"), "✕ виден");
ok(
  (await page.$$('button[onclick="saveSettings()"]:not(#set-savebar-save)')).length === 0,
  "пяти кнопок «Сохранить» по панелям больше нет – только полоса"
);
ok(await page.isHidden("#set-savebar"), "полоса «Сохранить» скрыта, пока правок нет");

const tabBefore = await page.evaluate(
  () => document.querySelector(".tab-content:not(.hidden)")?.id
);
await page.keyboard.press("Digit1");
await page.waitForTimeout(250);
ok(
  (await page.evaluate(() => document.querySelector(".tab-content:not(.hidden)")?.id)) ===
    tabBefore,
  "цифра под открытым окном не переключает вкладку приложения"
);

console.log("Полоса «Сохранить»");
await page.click('.side-tab[data-panel="grades"]');
await page.waitForSelector("#catShelvesList .shelf-row input[type=text]");
const shelf = page.locator("#catShelvesList .shelf-row input[type=text]").first();
const oldName = await shelf.inputValue();
await shelf.fill(oldName + " 2");
await shelf.dispatchEvent("change");
await page.waitForSelector("#set-savebar:not([hidden])", { timeout: 3000 });
ok(true, "после правки полоса появилась");
await page.click("#set-savebar-save");
await page.waitForFunction(() => !settingsDirty, null, { timeout: 5000 });
await page.waitForSelector("#set-savebar[hidden]", { state: "attached", timeout: 3000 });
ok(true, "после сохранения полоса пропала");
const saved = JSON.parse(readFileSync(join(vaultDir, "site-settings.json"), "utf8"));
ok(JSON.stringify(saved).includes(oldName + " 2"), "правка записана в site-settings.json");

console.log("Горячие клавиши вкладок");
await page.click('.side-tab[data-panel="shortcuts"]');
const keys = await page.$$eval("#tabKeyBindingsList .shortcut-keys", (els) =>
  els.map((e) => e.textContent.trim())
);
ok(
  keys[0]?.startsWith("1") && keys[4]?.startsWith("5"),
  `вместо «не задано» – цифры по умолчанию (${keys.join(" | ")})`
);

console.log("Закрытие: Escape, затемнение, ✕");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
ok(!(await isOpen()), "Escape закрывает");
await openSettings();
await page.mouse.click(10, 450);
await page.waitForTimeout(400);
ok(!(await isOpen()), "клик по затемнению закрывает");
await openSettings();
await page.click("#se-close");
await page.waitForTimeout(400);
ok(!(await isOpen()), "✕ закрывает");
ok(
  (await page.evaluate(() => document.body.style.overflow)) === "",
  "после закрытия страница снова прокручивается"
);

console.log("Старые адреса разделов");
await openSettings("#/settings-edit?panel=labels");
await page.waitForTimeout(400);
ok(
  (await page.evaluate(() => document.querySelector(".side-tab.active")?.dataset.panel)) ===
    "appearance",
  "?panel=labels открывает «Оформление» (там теперь «Подписи»)"
);
ok(
  !!(await page.$("#panel-appearance #labelsGroups .set-sec")),
  "группы «Подписей» внутри «Оформления»"
);
ok(
  await page.evaluate(
    () => !!document.querySelector("#labelsGroups .set-sec.collapsed .set-sec-toggle")
  ),
  "свёрнутые группы со стрелкой-переключателем"
);

console.log("Телефон: без окна, на весь экран");
const phone = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
phone.on("pageerror", (e) => jsErrors.push(errText(e)));
await phone.goto(base + "#/settings-edit", { waitUntil: "domcontentloaded" });
await phone.waitForSelector("#view-root:not(.hidden) #sidebar .side-tab", { timeout: 10000 });
ok(
  !(await phone.evaluate(() =>
    document.getElementById("view-root").classList.contains("route-overlay")
  )),
  "на телефоне класса окна нет"
);
ok(
  await phone.evaluate(() => document.getElementById("shell-root").classList.contains("hidden")),
  "приложение спрятано, как раньше"
);
ok(await phone.isHidden("#se-close"), "✕ на телефоне не показывается");

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nнастройки окном работают");
