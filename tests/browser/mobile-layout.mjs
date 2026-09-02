// Вёрстка на телефоне — в настоящем браузере.
//
// Страницы писались для сайта, который открывают с компьютера, и часть
// из них (правка отзывов, настройки) узкого экрана никогда не видела.
// Проверяем ровно две вещи, которые ломают телефон сильнее всего:
// горизонтальную прокрутку и слишком мелкие кнопки.
//
// Запуск: node tests/browser/mobile-layout.mjs [папка-хранилища]
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

const PHONE = { width: 390, height: 844 }; // примерно iPhone 14 / средний Android
const TAP = 40; // ниже этого в кнопку трудно попасть пальцем

// После перехода на SPA (фаза 4) отдельных файлов у редакторов нет:
// это хэш-маршруты внутри index.html. Отдельным документом остался
// только add.html — его открывает iframe модалки «Добавить из
// паспорта», и вёрстку там надо проверять именно как отдельную
// страницу. Смена одного лишь хэша перезагрузкой не считается —
// оболочка остаётся та же, маршрут перерисовывается по hashchange,
// поэтому ниже после перехода всё равно ждём (waitForTimeout).
const PAGES = [
  ["/", "паспорт"],
  ["/add.html", "правка отзыва"],
  ["/#/settings-edit", "настройки"],
  ["/#/chars-edit", "персонажи"],
  ["/#/favorites-edit", "избранное"],
  ["/#/reviews-order", "порядок"],
  ["/#/backup-history", "история версий"],
];

const vaultDir = process.argv[2] || mkdtempSync(join(tmpdir(), "tasteid-layout-"));
const port = 8300 + (process.pid % 400); // забытый сервер не мешает следующему запуску
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся за 10 с")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
  server.on("exit", (code) => fail(new Error("сервер упал, код " + code)));
});

const browser = await chromium.launch();
// hasTouch — не украшение: от него зависит `pointer: coarse`, а на нём
// держатся все правила «крупнее под палец» в style.css.
const page = await browser.newPage({
  viewport: PHONE,
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

// Чужие картинки (обложки с AniList и прочих) тут не нужны: они только
// тормозят проверку, а на ширину страницы не влияют — размер задаёт вёрстка.
await page.route("**/*", (route) =>
  route.request().url().includes(`127.0.0.1:${port}`) ? route.continue() : route.abort()
);

const problems = [];

for (const [path, name] of PAGES) {
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  const found = await page.evaluate((tap) => {
    const width = document.documentElement.clientWidth;
    const out = { scroll: document.documentElement.scrollWidth - width, wide: [], small: [] };

    const label = (el) => {
      const id = el.id ? "#" + el.id : "";
      const cls =
        typeof el.className === "string" && el.className.trim()
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 22);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` «${text}»` : ""}`;
    };

    // Полоса вкладок, которую нарочно листают вбок, — не беда: до
    // дальней кнопки палец дотянется. Беда — когда за край уехало
    // то, что никуда не прокручивается.
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };

    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const style = getComputedStyle(el);
      // Прозрачные элементы — это спрятанные <input type="file"> под
      // своей нарисованной кнопкой; нажимают не их.
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      if (el.offsetParent === null) continue;

      if (box.right > width + 1 && style.position !== "fixed" && !insideScroller(el)) {
        out.wide.push({ el: label(el), right: Math.round(box.right) });
      }

      const control = el.matches(
        "button,a[href],select,input:not([type=hidden]),textarea,.btn,[role=button]"
      );
      if (control && !el.querySelector("button,a[href],.btn")) {
        const size = Math.min(box.width, box.height);
        if (size < tap) out.small.push({ el: label(el), size: Math.round(size) });
      }
    }

    // Один и тот же класс на десятке одинаковых кнопок — одна и та же
    // проблема, поэтому в отчёт идёт по одному представителю.
    const byKind = (list, key) => {
      const seen = new Map();
      for (const item of list) {
        const kind = item.el.split("«")[0];
        if (!seen.has(kind)) seen.set(kind, item);
      }
      return [...seen.values()].sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 8);
    };
    out.wide = byKind(out.wide, "right");
    out.small = byKind(out.small, "size");
    return out;
  }, TAP);

  const bad = found.scroll > 1 || found.wide.length || found.small.length;
  console.log(`\n${bad ? "✗" : "✓"} ${name} (${path})`);
  if (found.scroll > 1) console.log(`   прокрутка вбок: +${found.scroll}px`);
  for (const w of found.wide) console.log(`   за экраном до ${w.right}px: ${w.el}`);
  for (const s of found.small) console.log(`   мелкая цель ${s.size}px: ${s.el}`);
  if (bad) problems.push(name);
}

// «Вкладки» внутри настроек отдельно от общего цикла выше: баг, который
// это поймал (#main схлопывался до ~200px из-за margin: 0 auto,
// написанного для десктопного #app-в-ряд и не сброшенного для мобильного
// #app-в-колонку), не считался ни горизонтальной прокруткой, ни мелкой
// целью — контент просто вписывался в узкий столбец, оставляя честную
// половину экрана пустой. Цикл выше проверяет вкладку «Настройки» только
// на панели по умолчанию («Оформление»), сюда её не заводя.
await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
await page.click('[data-panel="tabs"]');
await page.waitForSelector("#tabsList .tab-row");
const mainWidth = await page.evaluate(
  () => document.getElementById("main").getBoundingClientRect().width
);
const viewportWidth = PHONE.width;
if (mainWidth < viewportWidth - 40) {
  console.log(
    `\n✗ настройки → вкладки (#main шире не растянут: ${Math.round(mainWidth)}px из ${viewportWidth}px)`
  );
  problems.push("настройки → вкладки (узкая колонка)");
} else {
  console.log(`\n✓ настройки → вкладки (#main во всю ширину: ${Math.round(mainWidth)}px)`);
}

await browser.close();
server.kill();

console.log(
  problems.length ? `\nПроблемные страницы: ${problems.join(", ")}` : "\nвёрстка держит телефон"
);
process.exit(problems.length ? 1 : 0);
