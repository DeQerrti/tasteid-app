// Мобильный мост — в настоящем браузере.
//
// tests/mobile-vault.test.js проверяет логику поверх файловой системы
// телефона, а здесь — то, чего в Node не проверить: подмена fetch и
// переписывание адресов картинок. Смысл в том, что страница остаётся
// нетронутой: она по-прежнему делает fetch("/api/save-review") и
// <img src="/chars/…">, а мост уводит это в файловую систему.
//
// Запуск: node tests/browser/mobile-bridge.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).
//
// Все плагины Capacitor подменяются на этапе сборки (--alias) — и
// файловая система, и «поделиться», и полоса состояния, и само
// приложение. Из-за этого @capacitor/core в тестовый бандл не попадает,
// и window.Capacitor задаётся здесь вручную. На устройстве его создаёт
// сам Capacitor.

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createRequire } from "node:module";
import { buildMobileBundle } from "../fixtures/mobile-bundle.js";

// Свой playwright в зависимостях не держим, поэтому подходит и
// глобальный: до него import по имени не достаёт, ищем руками.
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    const root = execFileSync("npm", ["root", "-g"]).toString().trim();
    return require(join(root, "playwright"));
  }
})();

const failures = [];
const ok = (cond, msg) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) failures.push(msg);
};

const out = buildMobileBundle();

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => failures.push("JS: " + e.message));

await page.addInitScript(() => {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    convertFileSrc: (u) => u.replace("file://", "http://localhost/_cap_"),
  };
});

await page.route("**/blank", (r) =>
  r.fulfill({ contentType: "text/html", body: "<html><body></body></html>" })
);
await page.goto("http://localhost/blank");
await page.addScriptTag({ path: out });
await page.waitForTimeout(200);

console.log("Данные");
const empty = await page.evaluate(async () => (await fetch("/reviews.json")).json());
ok(Array.isArray(empty) && empty.length === 0, "пустое хранилище отдаёт [], а не 404");

const saved = await page.evaluate(async () => {
  const r = await fetch("/api/save-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Берсерк", type: "manga" }),
  });
  return r.json();
});
ok(saved.ok === true, "отзыв сохраняется тем же /api, что на компьютере");

const back = await page.evaluate(async () => (await fetch("/reviews.json")).json());
ok(back.length === 1 && back[0].title === "Берсерк", "и читается обратно");

const onDisk = await page.evaluate(() => [...window.__fakeFiles.keys()]);
ok(onDisk.includes("TasteID/reviews.json"), "файл лежит под тем же именем, что на компьютере");

console.log("Границы перехвата");
const info = await page.evaluate(async () => (await fetch("/api/app/info")).json());
ok(info.mobile === true, "страница опознаёт себя как приложение");

const passthrough = await page.evaluate(async () => {
  try {
    await fetch("https://example.invalid/x");
    return "ушёл в сеть";
  } catch {
    return "ушёл в сеть"; // домен не резолвится — важно, что не перехвачен
  }
});
ok(passthrough === "ушёл в сеть", "внешние адреса не перехватываются");

console.log("Картинки");
const src = await page.evaluate(async () => {
  await fetch("/api/upload-char-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder: "Берсерк", filename: "guts.webp", contentBase64: btoa("x") }),
  });
  const img = document.createElement("img");
  img.src = "/chars/Берсерк/guts.webp";
  document.body.appendChild(img);
  await new Promise((r) => setTimeout(r, 300));
  return img.getAttribute("src");
});
ok(src.includes("_cap_"), "адрес картинки переписан на тот, что отдаёт Capacitor");

console.log("Полоса состояния");
const bar = await page.evaluate(async () => {
  const send = (bg) =>
    fetch("/api/app/set-titlebar-colors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bg }),
    });
  await send("#0a0a0c");
  const dark = { ...window.__statusBar };
  await send("#f5f2ec");
  return { dark, light: { ...window.__statusBar } };
});
ok(bar.dark.color === "#0a0a0c", "цвет полосы берётся из темы страницы");
ok(
  bar.dark.style === "DARK" && bar.light.style === "LIGHT",
  "значки на полосе переключаются под светлую и тёмную тему"
);

console.log("Файл на вынос");
const shared = await page.evaluate(async () => {
  const blob = new Blob(['{"format":"tasteid-passport"}'], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "passport-2026-01-01.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Страница отзывает ссылку сразу — как и настоящая.
  URL.revokeObjectURL(url);
  await new Promise((r) => setTimeout(r, 300));
  return { shared: window.__shared, files: [...window.__fakeFiles.keys()] };
});
ok(!!shared.shared, "нажатие на «скачать» не пропало, а ушло в системное «поделиться»");
ok(shared.files.includes("passport-2026-01-01.json"), "файл при этом действительно создан");

await browser.close();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nмост работает");
