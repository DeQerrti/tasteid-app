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

// Функции самой страницы – читаются только внутри page.evaluate, где они и правда есть.
/* global patchSiteSettings, refreshTabKeyBindingsPanel */
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

console.log("Заголовок панели и вкладка «Вкладки»");
// Выбор темы выше – несохранённая правка: переход на другую панель спросил бы
// «Есть несохранённые изменения». Начинаем с чистой страницы.
await page.goto(`http://127.0.0.1:${port}/#/settings-edit`, { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#hide-tags-toggle", { timeout: 10000 });
const titleBox = await page.$eval("#settings-panel-title", (e) => {
  const r = e.getBoundingClientRect();
  return { w: r.width, h: r.height };
});
ok(
  titleBox.w <= 1 && titleBox.h <= 1,
  "заголовок «Оформление» над панелью на ПК не виден (он уже горит в сайдбаре)"
);
await page.click('.side-tab[data-panel="tabs"]');
await page.waitForSelector("#panel-tabs .tab-row");
const closeBottom = await page.$eval(".set-close", (e) => e.getBoundingClientRect().bottom);
const firstTop = await page.$eval("#panel-tabs .tab-row", (e) => e.getBoundingClientRect().top);
ok(firstTop > closeBottom, "содержимое панели начинается ниже крестика закрытия");
ok(
  (await page.$$(".set-add")).length === 3,
  "поле «Новый …» и кнопка – одной строкой в трёх блоках"
);
ok(
  (await page.$$eval(".set-add .btn", (els) => els.map((e) => e.textContent.trim()))).includes(
    "Добавить статус"
  ),
  "у статусов кнопка «Добавить статус»"
);
await page.click("#tabrow-reviews .icon-btn");
ok(
  await page.$eval("#tabrow-reviews", (e) => e.classList.contains("is-hidden")),
  "скрытая вкладка помечена (приглушена)"
);
const penLefts = await page.$$eval(
  '#tierModesList .tab-row .icon-btn[title="Переименовать"]',
  (els) => els.map((e) => Math.round(e.getBoundingClientRect().left))
);
ok(new Set(penLefts).size === 1, `карандаши в тир-листе в одну линию (${penLefts.join(", ")})`);

console.log("Вкладка «Статистика»");
// Скрытая выше вкладка – несохранённая правка: переход на другую панель спросил
// бы «Есть несохранённые изменения». Начинаем с чистой страницы.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#hide-tags-toggle", { timeout: 10000 });
await page.click('.side-tab[data-panel="stats"]');
await page.waitForSelector("#statsList .tab-row");
ok(
  (await page.$eval("#panel-stats > h2.section-h", (e) => e.textContent.trim())) ===
    "Что показывать",
  "над блоками заголовок «Что показывать» вместо абзаца с названием вкладки"
);
ok((await page.$$("#statsList .tab-row")).length === 12, "двенадцать блоков");
await page.click("#statsList .tab-row:nth-child(2) .icon-btn");
ok(
  await page.$eval("#statsList .tab-row:nth-child(2)", (e) => e.classList.contains("is-hidden")),
  "скрытый блок помечен (приглушён)"
);
ok(!(await page.$("#mk-typebar, .type-bar")), "над цветами типов нет полосы-образца");

console.log("Вкладка «Оценки»: названия полок переживают смену шкалы");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#hide-tags-toggle", { timeout: 10000 });
await page.click('.side-tab[data-panel="grades"]');
await page.waitForSelector("#catShelvesList .shelf-row");
ok(
  (await page.$eval('.side-tab[data-panel="grades"] .side-tab-label', (e) =>
    e.textContent.trim()
  )) === "Оценки",
  "вкладка называется «Оценки» (статусов в ней нет)"
);
ok((await page.$$("#scaleTypeGrid .scale-card")).length === 3, "три карточки шкалы с образцом");
// У стандартных полок описания уже есть и видны; у новой – пусто, поле скрыто за ссылкой.
await page.click('#categoricalBlock button[onclick="addShelfRow(true)"]');
const lastRow = "#catShelvesList .shelf-row:last-child";
ok(!(await page.$(`${lastRow} .shelf-desc`)), "у новой полки пустое поле описания не показано");
await page.click(`${lastRow} .shelf-desc-link`);
ok(!!(await page.$(`${lastRow} .shelf-desc`)), "по «+ описание» появляется поле описания");
// своё название первой полки
await page.fill(
  "#catShelvesList .shelf-row:nth-child(1) input[type=text]:not(.shelf-desc)",
  "Мой топ"
);
await page.press(
  "#catShelvesList .shelf-row:nth-child(1) input[type=text]:not(.shelf-desc)",
  "Tab"
);
// порядок: первую полку на третье место
await page.dragAndDrop(
  "#catShelvesList .shelf-row:nth-child(1) .shelf-grip",
  "#catShelvesList .shelf-row:nth-child(3)"
);
const names = () =>
  page.$$eval("#catShelvesList .shelf-row input[type=text]:not(.shelf-desc)", (els) =>
    els.map((e) => e.value)
  );
ok(
  (await names())[2] === "Мой топ",
  `полку можно перетащить (${(await names()).slice(0, 3).join(", ")})`
);
// Названия -> Числа -> Названия без диалога и без потери названия
await page.click('#scaleTypeGrid [data-scale="numeric"]');
await page.waitForSelector("#shelvesList .shelf-row");
ok(
  !(await page.$(".modal-overlay:not(.hidden)")),
  "переключение шкалы не спрашивает про сброс названий"
);
const numNames = await page.$$eval(
  "#shelvesList .shelf-row input[type=text]:not(.shelf-desc)",
  (els) => els.map((e) => e.value)
);
ok(numNames.includes("Мой топ"), `своё название перешло в «Числа» (${numNames.join(", ")})`);
await page.click('#scaleTypeGrid [data-scale="categorical"]');
await page.waitForSelector("#catShelvesList .shelf-row");
ok((await names())[2] === "Мой топ", "и вернулось в «Названия» на то же место");
// смена максимума не стирает названия
await page.click('#scaleTypeGrid [data-scale="numeric"]');
await page.waitForSelector("#shelvesList .shelf-row");
await page.fill("#numericMax", "5");
await page.press("#numericMax", "Tab");
const afterMax = await page.$$eval(
  "#shelvesList .shelf-row input[type=text]:not(.shelf-desc)",
  (els) => els.map((e) => e.value)
);
ok(afterMax.includes("Мой топ"), `смена максимума не сбрасывает названия (${afterMax.join(", ")})`);

console.log("Вкладка «Горячие клавиши»");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("#hide-tags-toggle", { timeout: 10000 });
await page.click('.side-tab[data-panel="shortcuts"]');
await page.waitForSelector("#shortcutsList .shortcut-row");
const fixedRows = await page.$$eval("#shortcutsList .shortcut-fixed .shortcut-desc", (els) =>
  els.map((e) => e.textContent.trim())
);
ok(
  fixedRows.includes("Листать отзывы в окне") && fixedRows.includes("Закрыть окно"),
  `в списке есть клавиши ← → и Esc без кнопки «Изменить» (${fixedRows.join(", ")})`
);
ok(
  !(await page.$("#shortcutsList .shortcut-fixed .btn-mini")),
  "у неперебиндиваемых клавиш кнопки «Изменить» нет"
);
ok(
  await page.$$eval("#tabKeyBindingsList .shortcut-row", (els) =>
    els.every(
      (e) =>
        e.children[1].classList.contains("shortcut-desc") &&
        e.children[2].classList.contains("shortcut-note")
    )
  ),
  "в клавишах вкладок после названия идёт пометка «по умолчанию»"
);
ok(
  (await page.$$("#panel-shortcuts .link-reset")).length === 1,
  "одна ссылка «Сбросить все клавиши»"
);
// своя клавиша вкладки и сброс одной ссылкой
await page.evaluate(async () => {
  await patchSiteSettings((s) => {
    s.tabKeyBindings = { reviews: { type: "key", code: "KeyR", label: "R" } };
  });
  window.SITE_TAB_KEYBINDINGS = { reviews: { type: "key", code: "KeyR", label: "R" } };
  refreshTabKeyBindingsPanel();
});
ok(
  (await page.$$eval("#tabKeyBindingsList .kbd", (els) => els.map((e) => e.textContent))).includes(
    "R"
  ),
  "своя клавиша вкладки видна"
);
await page.click("#panel-shortcuts .link-reset");
await page.waitForFunction(
  () => !document.querySelector("#tabKeyBindingsList").textContent.includes("R")
);
const saved = await page.evaluate(
  async () => (await (await fetch("/site-settings.json?_=" + Date.now())).json()).tabKeyBindings
);
ok(
  !saved || Object.keys(saved).length === 0,
  "«Сбросить все клавиши» сбрасывает и клавиши вкладок"
);

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nнастройки «Оформление» работают");
