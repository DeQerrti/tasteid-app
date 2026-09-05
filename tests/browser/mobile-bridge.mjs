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
// main.js сам вызывает checkForUpdate() (без force) сразу при разборе
// страницы — то есть ещё до addScriptTag() ниже вернёт управление, а
// значит и до того, как более специфичный page.route ниже (для теста
// "Обновление") успеет встать на место. Без этой затычки тут в CI, где
// есть настоящий доступ в интернет, этот самый первый, никем не
// ожидаемый вызов улетает на настоящий api.github.com и подмешивает
// туда реальный текущий релиз — тест ниже тогда видит чужой,
// непредсказуемый текст диалога вместо того, что сам подставил.
await page.route("https://api.github.com/repos/**/releases/latest", (r) =>
  r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ tag_name: "v0.0.1", html_url: "", assets: [] }),
  })
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
// blob: URL, а не "capacitor://"/"_cap_" – см. её же комментарий у
// vaultSrc в mobile/src/main.js: байты читаются один раз через
// vault.readMedia() и оборачиваются в настоящий Blob, а не отдаются
// через виртуальный адрес Capacitor.
ok(src.startsWith("blob:"), "адрес картинки переписан на blob-адрес с уже прочитанными байтами");

console.log("Масштаб");
// applyMobileZoom() пишет прямо в document.documentElement.style.zoom —
// той же странице, что грузит мост, поэтому проверяется без всякого
// нативного плагина: обычный CSS.
const zoomDefault = await page.evaluate(() => document.documentElement.style.zoom);
ok(
  zoomDefault === "100%",
  `по умолчанию 100%, применяется ещё при разборе скрипта: "${zoomDefault}"`
);

const zoomAfterSet = await page.evaluate(async () => {
  const r = await fetch("/api/app/zoom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ percent: 150 }),
  });
  const data = await r.json();
  return {
    response: data.zoom,
    style: document.documentElement.style.zoom,
    stored: localStorage.getItem("tasteid_zoom"),
  };
});
ok(zoomAfterSet.response === 150, "/api/app/zoom отвечает применённым процентом");
ok(zoomAfterSet.style === "150%", "CSS zoom меняется сразу же, без перезагрузки");
ok(zoomAfterSet.stored === "150", "масштаб сохраняется в localStorage — переживёт перезапуск");

// «Перезапуск приложения» — localStorage переживает, style.zoom нет
// (свежий документ). Масштаб обязан примениться заново до первой же
// отрисовки, а не только по действию человека в настройках.
await page.reload();
await page.addScriptTag({ path: out });
await page.waitForTimeout(200);
const zoomAfterReload = await page.evaluate(() => document.documentElement.style.zoom);
ok(
  zoomAfterReload === "150%",
  `сохранённый масштаб применяется заново при следующем запуске: "${zoomAfterReload}"`
);

// Значение вне 50–200% отсекается так же, как на компьютере (electron/main.js).
const zoomClamped = await page.evaluate(async () => {
  const r = await fetch("/api/app/zoom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ percent: 9000 }),
  });
  return (await r.json()).zoom;
});
ok(zoomClamped === 200, `слишком большой процент обрезается до максимума: ${zoomClamped}`);

console.log("Обновление — релиз без apk ещё не молчит");
// build.yml собирает Windows/Mac/Linux и Android параллельными джобами,
// каждый заливает свой файл в один и тот же релиз по готовности — apk
// у Android обычно самый долгий. Если проверка обновления попадает
// ровно в эту паузу, среди assets ещё нет ни одного .apk, и
// checkForUpdate() подставляет ссылку на страницу релиза вместо файла.
// Раньше именно этот случай сразу и молча уходил в «Поделиться» — без
// единого слова объяснения, хотя через минуту-другую apk появился бы
// сам. Теперь ветка показывает причину и оставляет «Поделиться»
// отдельным осознанным нажатием, а не тем, что срабатывает само.
// showUpdateBanner/checkForUpdate — внутри IIFE-бандла, снаружи не видны
// (в проде их и не зовут напрямую — ровно тот же /api/app/check-update,
// что и кнопка «Проверить обновления» в настройках). Подделываем ответ
// GitHub заранее через page.route, дальше идём тем же путём, что и
// настоящая проверка.
await page.route("https://api.github.com/repos/**/releases/latest", (r) =>
  r.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      tag_name: "v9.9.9",
      html_url: "https://github.com/DeQerrti/tasteid-app/releases/tag/v9.9.9",
      assets: [
        { name: "TasteID-Setup-9.9.9.exe", browser_download_url: "https://example.invalid/x.exe" },
      ],
    }),
  })
);
await page.evaluate(async () => {
  await fetch("/api/app/check-update", { method: "POST", body: "{}" });
});
const updateNoApk = await page.evaluate(async () => {
  const textBefore = document.getElementById("update-dialog-text").textContent;
  document.getElementById("update-dialog-update").click();
  await new Promise((r) => setTimeout(r, 50));
  return {
    textBefore,
    textAfterClick: document.getElementById("update-dialog-text").textContent,
    btnLabelAfterClick: document.getElementById("update-dialog-update").textContent,
    sharedYet: window.__shared || null,
  };
});
ok(!updateNoApk.sharedYet, "первый клик по «Обновить» не открывает «Поделиться» сам по себе");
ok(
  /пока нет файла для Android|doesn't have an Android file/i.test(updateNoApk.textAfterClick),
  `показана настоящая причина, а не тишина: "${updateNoApk.textAfterClick}"`
);
ok(
  /^(Поделиться|Share)$/.test(updateNoApk.btnLabelAfterClick),
  `кнопка стала «Поделиться» для второго, уже осознанного нажатия: "${updateNoApk.btnLabelAfterClick}"`
);

await page.evaluate(() => {
  delete window.__shared;
}); // сброс перед вторым кликом
const sharedAfterSecondClick = await page.evaluate(async () => {
  document.getElementById("update-dialog-update").click();
  await new Promise((r) => setTimeout(r, 50));
  return window.__shared;
});
ok(
  sharedAfterSecondClick?.url === "https://github.com/DeQerrti/tasteid-app/releases/tag/v9.9.9",
  "второй, уже осознанный клик по «Поделиться» открывает страницу релиза"
);

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
