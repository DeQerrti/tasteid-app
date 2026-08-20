// Иконки приложения для Android из app/icons/icon-512.png.
//
// Запускают руками, когда меняется логотип:
//   node scripts/android-icons.mjs
// Результат кладётся в android/app/src/main/res и коммитится — сборке
// APK ни этот скрипт, ни браузер не нужны.
//
// Рисует Chromium из playwright: другого способа изменить размер
// картинки в этом проекте нет (ни sharp, ни ImageMagick в зависимостях
// нет и тянуть их ради пяти файлов не стоит).
//
// Фон адаптивной иконки задан цветом в res/values/colors.xml — здесь
// только сами рисунки.
//
// Три вида иконок, потому что Android просит три:
//   ic_launcher            — обычная квадратная;
//   ic_launcher_round      — для лаунчеров с круглыми иконками;
//   ic_launcher_foreground — верхний слой «адаптивной» иконки, который
//                            система сама двигает и обрезает по своей
//                            форме, поэтому фон у него прозрачный, а
//                            рисунок ужат в безопасную середину.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright"));
  }
})();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android/app/src/main/res");
const SOURCE = join(ROOT, "app/icons/icon-512.png");

// Плотности экрана Android: mdpi — базовая, дальше кратно.
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const LAUNCHER = 48; // dp
const ADAPTIVE = 108; // dp, из них рисунку принадлежит середина
const SAFE = 0.62; // доля, дальше система может обрезать

const source = "data:image/png;base64," + readFileSync(SOURCE).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();

const shots = await page.evaluate(
  async ({ source, densities, launcher, adaptive, safe }) => {
    const img = new Image();
    img.src = source;
    await img.decode();

    const canvas = (size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      return [c, c.getContext("2d")];
    };

    // Прозрачный вариант логотипа: фон у исходника почти чёрный, а
    // буква белая, поэтому яркость пикселя и есть его непрозрачность.
    // Порог обязателен: «почти чёрный» — это не ноль, и без вычета фон
    // остался бы чуть заметным квадратом поверх фона иконки.
    const [cut, cutCtx] = canvas(img.width);
    cutCtx.drawImage(img, 0, 0);
    const pixels = cutCtx.getImageData(0, 0, img.width, img.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      pixels.data[i + 3] = Math.max(0, Math.min(255, Math.round((luma - 22) * 2)));
    }
    cutCtx.putImageData(pixels, 0, 0);

    const out = {};
    for (const [name, k] of Object.entries(densities)) {
      const size = Math.round(launcher * k);

      const [square, sq] = canvas(size);
      sq.drawImage(img, 0, 0, size, size);
      out[`mipmap-${name}/ic_launcher.png`] = square.toDataURL("image/png");

      const [round, rd] = canvas(size);
      rd.beginPath();
      rd.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      rd.clip();
      rd.drawImage(img, 0, 0, size, size);
      out[`mipmap-${name}/ic_launcher_round.png`] = round.toDataURL("image/png");

      const big = Math.round(adaptive * k);
      const inner = Math.round(big * safe);
      const [fore, fg] = canvas(big);
      fg.drawImage(cut, (big - inner) / 2, (big - inner) / 2, inner, inner);
      out[`mipmap-${name}/ic_launcher_foreground.png`] = fore.toDataURL("image/png");
    }
    return out;
  },
  { source, densities: DENSITY, launcher: LAUNCHER, adaptive: ADAPTIVE, safe: SAFE }
);

for (const [path, data] of Object.entries(shots)) {
  writeFileSync(join(RES, path), Buffer.from(data.split(",")[1], "base64"));
  console.log("  " + path);
}

await browser.close();
console.log("иконки готовы");
