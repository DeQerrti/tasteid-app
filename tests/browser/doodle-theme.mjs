// Рисованная тема («Рисованный», тёмная и светлая): вид «скотч и маркер»
// на боковой панели, «Статусах», «Любимом» (окно записи, оба редактора) и
// «Отзывах» (окно и редактор отзыва), «Статистике», «Тир-листе» и почерк Shantell Sans.
//
// Проверяется (на ширине компьютера, в обеих темах, и на телефоне):
//   – файлы украшений /decor/doodle-*.svg и шрифт отдаются сервером;
//   – почерк – Shantell Sans, и он правда загружен (а не подменён
//     запасным шрифтом – так раньше было с Patrick Hand без кириллицы);
//   – вкладки статусов – надписи без капсул, у выбранной – мазок маркера;
//   – типы – словами без рамок, выбранный – бумажной наклейкой;
//   – карточка – полароид на скотче, одна на все вкладки; подпись идёт
//     сразу под названием, без дыры, даже если у соседа название длиннее;
//   – выбранный раздел боковой панели – мазок под словом;
//   – на телефоне карточки и вкладки не уезжают за край экрана.
//
// Запуск: node tests/browser/doodle-theme.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-doodle-"));
const current = (id, title, type) => ({
  id,
  title,
  type,
  status: "current",
  year: 2020 + id,
  date_start: `2024-0${id}-01`,
});
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    current(1, "Рисуется", "anime"),
    current(2, "Клеится", "manga"),
    current(3, "Сохнет", "movie"),
    current(4, "Очень длинное название, которое не влезает в одну строку", "show"),
    { id: 5, title: "Ждёт", type: "manga", status: "planning", year: 2020 },
    { id: 6, title: "Любимый", type: "book", status: "completed", year: 2010, favorite: true },
    // «Отзывы»: один ряд, у соседа название в две строки, у остальных – в одну.
    {
      id: 7,
      title: "Коротко",
      type: "game",
      status: "completed",
      year: 2024,
      grade: "etalon",
      date_end: "2025-03-03",
      tags: ["Драма"],
    },
    {
      id: 8,
      title: "Очень длинное название отзыва, которое займёт две строки",
      type: "anime",
      status: "completed",
      year: 2023,
      date_end: "2025-03-02",
    },
    {
      id: 9,
      title: "Тоже коротко",
      type: "movie",
      status: "completed",
      year: 2022,
      date_end: "2025-03-01",
    },
  ])
);

// «Любимое»: персонаж, персоны двух ролей (заголовки ролей) и запись
// своего раздела owner'а – любая фича «Любимого» обязана работать и для них.
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([
    { id: 1, name: "Художник", type: "character", from: "Альбом" },
    { id: 2, name: "Сэйю", type: "person", subtype: "seiyuu" },
    { id: 3, name: "Режиссёр", type: "person", subtype: "director" },
    { id: 4, name: "Опенинг", type: "openings", from: "Альбом" },
  ])
);
const settings = (theme) =>
  JSON.stringify({ theme, favCollections: [{ id: "openings", label: "Опенинги" }] });

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
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch();
const jsErrors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("pageerror", (e) => jsErrors.push(e.message));

console.log("Украшения и шрифт");
const files = [
  "doodle-swipe-1.svg",
  "doodle-swipe-2.svg",
  "doodle-swipe-3.svg",
  "doodle-vline.svg",
  "doodle-hline.svg",
  "doodle-wave.svg",
  "doodle-grain.svg",
  "doodle-box-dark.svg",
  "doodle-box-light.svg",
  "doodle-under-dark.svg",
  "doodle-under-light.svg",
  "doodle-caret-dark.svg",
  "doodle-caret-light.svg",
  "doodle-tape-bg-1.svg",
  "doodle-tape-bg-2.svg",
  "doodle-tape-bg-3.svg",
  "doodle-frame-dark.svg",
  "doodle-frame-light.svg",
  "doodle-loop.svg",
];
for (const name of files) {
  const res = await page.request.get(`${base}/decor/${name}`);
  ok(res.ok(), `/decor/${name} отдаётся`);
}
for (const name of [
  "shantell-sans-cyrillic-400-normal.woff2",
  "shantell-sans-cyrillic-600-normal.woff2",
]) {
  const res = await page.request.get(`${base}/fonts/${name}`);
  ok(res.ok(), `/fonts/${name} отдаётся`);
}

// Всё, что проверяем на вкладке «Статусы», – одним заходом в страницу.
const inspect = () => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const toggle = document.querySelector("#tab-now > .tl-mode-toggle");
  const btn = toggle.querySelector(".tl-mode-btn.active");
  const chip = document.querySelector("#tab-now .now-chip:not(.active)");
  const chipOn = document.querySelector("#tab-now .now-chip.active");
  const card = document.querySelector("#tab-now .review-card-wrap .card");
  const poster = card.querySelector(".card-poster");
  const tag = card.querySelector(".type-tag");
  const railLabel = document.querySelector("#rail .tab-btn.active .tab-label");
  const probe = document.createElement("i");
  probe.style.color = css(document.documentElement).getPropertyValue("--doodle-paper").trim();
  document.body.appendChild(probe);
  const paperRgb = css(probe).color;
  probe.remove();
  const grid = document.querySelector("#tab-now .grid-now").getBoundingClientRect();
  return {
    font: css(btn).fontFamily,
    fontReady: document.fonts.check('600 20px "Shantell Sans"', "Жж"),
    btnBg: css(btn).backgroundColor,
    btnBorder: css(btn).borderTopWidth,
    btnCase: css(btn).textTransform,
    swipe: css(btn, "::after").maskImage || css(btn, "::after").webkitMaskImage,
    chipBorder: css(chip).borderTopWidth,
    chipBg: css(chip).backgroundColor,
    chipOnBg: css(chipOn).backgroundColor,
    cardBg: css(card).backgroundColor,
    cardPad: css(card).paddingTop,
    tape: css(poster, "::after").backgroundImage,
    tagBg: css(tag).backgroundColor,
    railSwipe: railLabel
      ? css(railLabel, "::after").maskImage || css(railLabel, "::after").webkitMaskImage
      : "",
    paperRgb,
    // Кнопки – во внутренней полосе .tl-mode-scroll (hscrollRow, utils.js).
    toggleFits: (() => {
      const strip = toggle.querySelector(".tl-mode-scroll");
      return strip.scrollWidth <= strip.clientWidth + 1 || css(strip).overflowX === "auto";
    })(),
    gridFits: grid.right <= window.innerWidth + 1,
  };
};

for (const theme of ["doodle-dark", "doodle"]) {
  console.log(`Тема ${theme}`);
  writeFileSync(join(vaultDir, "site-settings.json"), settings(theme));
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.click('.tab-btn[data-label="nav.now"]');
  await page.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const look = await page.evaluate(inspect);

  ok(look.font.startsWith('"Shantell Sans"'), `почерк – Shantell Sans (${look.font})`);
  ok(look.fontReady, "Shantell Sans с кириллицей загружен");
  ok(
    look.btnBg === "rgba(0, 0, 0, 0)" && look.btnBorder === "0px" && look.btnCase === "none",
    "вкладки статусов – надписи без капсул и заглавных"
  );
  ok(/doodle-swipe-\d\.svg/.test(look.swipe || ""), "у выбранной вкладки – мазок маркера");
  ok(
    look.chipBorder === "0px" && look.chipBg === "rgba(0, 0, 0, 0)",
    "кнопки типов – словами, без рамок"
  );
  ok(look.chipOnBg === look.paperRgb, "выбранный тип – бумажной наклейкой");
  ok(
    look.cardBg === look.paperRgb && parseFloat(look.cardPad) >= 4,
    `карточка – полароид на бумаге (${look.cardPad})`
  );
  ok(/doodle-tape-bg-\d\.svg/.test(look.tape), "полароид приклеен скотчем (фоном)");
  ok(
    look.tagBg !== look.paperRgb && look.tagBg !== "rgba(0, 0, 0, 0)",
    "тип на обложке – наклейкой, отличной от бумаги полароида"
  );
  ok(
    /doodle-swipe-\d\.svg/.test(look.railSwipe || ""),
    "выбранный раздел панели – мазок под словом"
  );
}

console.log("Телефон");
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), settings("doodle-dark"));
await phone.goto(base + "/", { waitUntil: "domcontentloaded" });
await phone.click('.tab-btn[data-label="nav.now"]');
await phone.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });
await phone.waitForTimeout(400);
const small = await phone.evaluate(inspect);
ok(small.gridFits, "карточки не уезжают за край экрана");
ok(small.toggleFits, "вкладки статусов помещаются или прокручиваются");
ok(parseFloat(small.cardPad) >= 2, `поля полароида есть и на телефоне (${small.cardPad})`);
ok(
  /doodle-swipe-\d\.svg/.test(small.railSwipe || ""),
  "выбранный раздел нижней панели – мазок под словом"
);
await phone.close();

console.log("«Любимое»");
const fav = await browser.newPage({ viewport: { width: 1500, height: 900 } });
fav.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), settings("doodle-dark"));
await fav.goto(base + "/", { waitUntil: "domcontentloaded" });
await fav.click('.tab-btn[data-label="nav.favorites"]');
await fav.waitForSelector("#tab-favorites .tl-mode-btn.active", { timeout: 10000 });
const favLook = async (mode) => {
  await fav.click(`#tab-favorites .tl-mode-btn[data-mode="${mode}"]`);
  await fav.waitForSelector(
    `#tab-favorites #fav-mode-body > div:not([hidden]) :is(.card, .review-card-wrap)`,
    {
      timeout: 10000,
    }
  );
  await fav.waitForTimeout(300);
  return fav.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const body = document.querySelector("#fav-mode-body > div:not([hidden])");
    const btn = document.querySelector("#tab-favorites .tl-mode-btn.active");
    const card = body.querySelector(".card-char, .review-card-wrap .card");
    const poster = card.querySelector(".card-poster");
    const head = body.querySelector(".fav-role-head");
    const probe = document.createElement("i");
    probe.style.color = css(document.documentElement).getPropertyValue("--doodle-paper").trim();
    document.body.appendChild(probe);
    const paperRgb = css(probe).color;
    probe.remove();
    return {
      swipe: css(btn, "::after").maskImage || css(btn, "::after").webkitMaskImage,
      polaroid: css(card).backgroundColor,
      tape: css(poster, "::after").backgroundImage,
      headFont: head ? css(head).fontFamily : "",
      headTape: head ? css(head).backgroundImage : "",
      paperRgb,
    };
  });
};
const titlesLook = await favLook("favTitles");
ok(
  /doodle-swipe-\d\.svg/.test(titlesLook.swipe || ""),
  "вкладка раздела – мазок маркера, как в «Статусах»"
);
ok(titlesLook.polaroid === titlesLook.paperRgb, "тайтл – полароид, как во всех вкладках");
ok(/doodle-tape-bg-\d\.svg/.test(titlesLook.tape), "скотч – фоном (попадёт в снимок)");
for (const [mode, label] of [
  ["favCharacters", "персонаж"],
  ["openings", "запись своего раздела"],
]) {
  const look = await favLook(mode);
  ok(look.polaroid === look.paperRgb, `${label} – полароид на бумаге`);
  ok(/doodle-tape-bg-\d\.svg/.test(look.tape), `${label} – на скотче`);
}
const personsLook = await favLook("favPersons");
ok(
  personsLook.headFont.startsWith('"Shantell Sans"') &&
    /doodle-tape-bg-\d\.svg/.test(personsLook.headTape),
  "заголовок роли – почерком на полоске скотча"
);

// Окно записи.
await favLook("favCharacters");
await fav.click("#tab-favorites .card-char");
await fav.waitForSelector("#fav-modal-overlay:not(.hidden) .review-modal-title", {
  timeout: 10000,
});
const modal = await fav.evaluate(() => {
  const panel = document.querySelector("#fav-modal-overlay .review-modal-panel");
  return {
    tape: getComputedStyle(panel, "::before").backgroundImage,
    font: getComputedStyle(panel.querySelector(".review-modal-title")).fontFamily,
  };
});
ok(/doodle-tape-bg-\d\.svg/.test(modal.tape), "окно записи «приклеено» скотчем");
ok(modal.font.startsWith('"Shantell Sans"'), "имя в окне записи – почерком");

// Редактор записи: поля были Cormorant (правило .fe-view input позже
// themes.css перебивало шрифт темы) – теперь почерк темы.
await fav.goto(base + "/#/favorites-edit?edit=1", { waitUntil: "domcontentloaded" });
await fav.waitForSelector(".fe-view #f-name, .fe-view input", { timeout: 10000 });
await fav.waitForTimeout(400);
const editor = await fav.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const input = document.querySelector(".fe-view input:not([type=checkbox]):not([type=file])");
  const title = document.querySelector(".fe-view .section-title");
  const save = document.querySelector(".app-topbar .ed-save");
  return {
    inputFont: css(input).fontFamily,
    labelCase: css(document.querySelector(".fe-view label")).textTransform,
    swipe: css(title, "::after").maskImage || css(title, "::after").webkitMaskImage,
    swipeH: parseFloat(css(title, "::after").height),
    saveBg: css(save).backgroundImage,
  };
});
ok(
  editor.inputFont.startsWith('"Shantell Sans"'),
  `поля редактора – почерком (${editor.inputFont})`
);
ok(editor.labelCase === "none", "подписи полей – не заглавными");
ok(
  /doodle-swipe-\d\.svg/.test(editor.swipe || "") && editor.swipeH > 5,
  "заголовок раздела редактора – мазок маркера"
);
ok(!/doodle-box/.test(editor.saveBg), "«Сохранить» в шапке – прежняя кнопка, а не рамка");

// Редактор порядка.
await fav.goto(base + "/#/favorites-order?section=favCharacters", {
  waitUntil: "domcontentloaded",
});
await fav.waitForSelector(".ro-view .dnd-item", { timeout: 10000 });
const order = await fav.evaluate(() => {
  const probe = document.createElement("i");
  probe.style.color = getComputedStyle(document.documentElement)
    .getPropertyValue("--doodle-paper")
    .trim();
  document.body.appendChild(probe);
  const paperRgb = getComputedStyle(probe).color;
  probe.remove();
  return {
    bg: getComputedStyle(document.querySelector(".ro-view .dnd-item")).backgroundColor,
    paperRgb,
  };
});
ok(order.bg === order.paperRgb, "редактор порядка – карточки-отпечатки");
await fav.close();

console.log("«Отзывы»");
const rv = await browser.newPage({ viewport: { width: 1500, height: 900 } });
rv.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), settings("doodle-dark"));
await rv.goto(base + "/", { waitUntil: "domcontentloaded" });
await rv.click('.tab-btn[data-label="nav.reviews"]');
await rv.waitForSelector("#tab-reviews .review-card-wrap", { timeout: 10000 });
await rv.waitForTimeout(500);
const reviews = await rv.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const probe = document.createElement("i");
  probe.style.color = css(document.documentElement).getPropertyValue("--doodle-paper").trim();
  document.body.appendChild(probe);
  const paperRgb = css(probe).color;
  probe.remove();
  // Зазор «название → год» у каждой карточки ряда. Раньше у карточки с
  // названием в одну строку год уезжал к низу: карточки ряда одной
  // высоты, а у .card-meta было margin-top: auto.
  const gaps = [...document.querySelectorAll("#tab-reviews .review-card-wrap")].map((w) => {
    const title = w.querySelector(".card-title").getBoundingClientRect();
    const meta = w.querySelector(".card-meta").getBoundingClientRect();
    return Math.round(meta.top - title.bottom);
  });
  const card = document.querySelector("#tab-reviews .review-card-wrap .card");
  const year = document.querySelector("#tab-reviews .year-divider .year-label");
  const search = document.querySelector("#tab-reviews .rv-bar .rv-search-input");
  const filter = document.querySelector("#tab-reviews .rv-bar .rv-dd-btn");
  return {
    gaps,
    cardBg: css(card).backgroundColor,
    paperRgb,
    yearSwipe: css(year, "::after").maskImage || css(year, "::after").webkitMaskImage,
    searchBg: css(search).backgroundImage,
    filterCase: css(filter).textTransform,
    filterGlyph: css(filter, "::after").content,
  };
});
ok(reviews.cardBg === reviews.paperRgb, "карточка отзыва – тот же полароид");
ok(
  reviews.gaps.length >= 3 && reviews.gaps.every((g) => g <= 12),
  `год сразу под названием, без дыры (зазоры: ${reviews.gaps.join(", ")})`
);
ok(/doodle-swipe-\d\.svg/.test(reviews.yearSwipe || ""), "год выделен маркером");
ok(/doodle-box-/.test(reviews.searchBg), "поиск – в рамке от руки");
ok(
  reviews.filterCase === "none" && reviews.filterGlyph === "none",
  "фильтры – словами, без «▾» (его нет в Shantell Sans – рисовался точкой)"
);

// Окно отзыва – снимается картинкой, поэтому в нём без масок.
await rv.click("#tab-reviews .review-card-wrap");
await rv.waitForSelector("#review-modal-overlay:not(.hidden) .review-modal-title", {
  timeout: 10000,
});
const rvModal = await rv.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const chip = document.querySelector("#review-modal-body .grade-chip");
  const panel = document.querySelector("#review-modal-overlay .review-modal-panel");
  return {
    titleFont: css(document.querySelector("#review-modal-body .review-modal-title")).fontFamily,
    chipBorder: chip ? css(chip).borderTopWidth : "",
    chipDot: chip ? css(chip, "::before").backgroundColor : "",
    tape: css(panel, "::before").backgroundImage,
  };
});
ok(rvModal.titleFont.startsWith('"Shantell Sans"'), "название в окне отзыва – почерком");
ok(
  rvModal.chipBorder === "0px" && rvModal.chipDot !== "rgba(0, 0, 0, 0)",
  "оценка в окне – словом с кружком цвета полки, без капсулы"
);
ok(/doodle-tape-bg-\d\.svg/.test(rvModal.tape), "окно отзыва «приклеено» скотчем");

// Редактор отзыва. Заодно ошибка, найденная по пути: превью рисуется до
// того, как в форму подставлен отзыв, и плашка типа оставалась «Аниме»
// (тип по умолчанию) у открытой на правку игры.
await rv.goto(base + "/#/add?edit=7", { waitUntil: "domcontentloaded" });
await rv.waitForSelector(".add-view.ed #f-title", { timeout: 10000 });
await rv.waitForFunction(() => document.getElementById("f-title")?.value === "Коротко", null, {
  timeout: 10000,
});
await rv.waitForTimeout(400);
const rvEditor = await rv.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const active = document.querySelector(".add-view.ed .grade-btn.active");
  return {
    tag: document.querySelector(".ed-preview .type-tag")?.textContent.trim(),
    inputFont: css(document.getElementById("f-title")).fontFamily,
    gradeLoop: active
      ? css(active, "::after").maskImage || css(active, "::after").webkitMaskImage
      : "",
    tagOn: css(document.querySelector(".add-view.ed .tag-toggle.active") || document.body)
      .backgroundColor,
  };
});
ok(rvEditor.tag === "Игра", `превью в редакторе – с плашкой своего типа (${rvEditor.tag})`);
ok(rvEditor.inputFont.startsWith('"Shantell Sans"'), "поля редактора отзыва – почерком");
ok(/doodle-loop\.svg/.test(rvEditor.gradeLoop || ""), "выбранная оценка обведена от руки");
ok(rvEditor.tagOn === reviews.paperRgb, "выбранный тег – бумажной наклейкой");
await rv.close();

console.log("«Статистика»");
const st = await browser.newPage({ viewport: { width: 1500, height: 900 } });
st.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), settings("doodle-dark"));
await st.goto(base + "/", { waitUntil: "domcontentloaded" });
await st.click('.tab-btn[data-label="nav.stats"]');
await st.waitForSelector("#tab-stats .sx-card", { timeout: 10000 });
await st.waitForTimeout(500);
const stats = await st.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const probe = document.createElement("i");
  probe.style.color = css(document.documentElement).getPropertyValue("--doodle-paper").trim();
  document.body.appendChild(probe);
  const paperRgb = css(probe).color;
  probe.remove();
  const card = document.querySelector("#tab-stats .sx-card");
  const title = card.querySelector(".section-title");
  // Блоки снимает «Сохранить как картинку» (statsExport: .stat-grid), а
  // html2canvas маски не рисует: маска здесь выйдет на снимке сплошным
  // прямоугольником. Строка годов над блоками в снимок не входит – у неё
  // затенённый край маской (.hscroll) законно.
  const masked = [];
  for (const el of document.querySelectorAll("#tab-stats .stat-grid *")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const m = css(el, pseudo).maskImage || css(el, pseudo).webkitMaskImage;
      if (m && m !== "none") masked.push(el.className + (pseudo || ""));
    }
  }
  return {
    frame: css(card).backgroundImage,
    tape: css(card, "::before").backgroundImage,
    yearOn: css(document.querySelector("#tab-stats .stat-year-filters .tl-filter.active"))
      .backgroundColor,
    titleFont: css(title).fontFamily,
    titleMark: css(title, "::after").backgroundColor,
    titleStack: css(title).zIndex,
    masked,
    paperRgb,
  };
});
ok(/doodle-frame-/.test(stats.frame), "блок обведён рамкой от руки");
ok(/doodle-tape-bg-\d\.svg/.test(stats.tape), "блок приклеен полоской скотча");
ok(stats.yearOn === stats.paperRgb, "выбранный год – бумажной наклейкой");
ok(stats.titleFont.startsWith('"Shantell Sans"'), "заголовки блоков – почерком");
ok(
  stats.titleMark !== "rgba(0, 0, 0, 0)" && stats.titleStack === "0",
  "маркер под заголовком – фигурой; z-index: 0, а не isolation (его не понимает снимок)"
);
ok(
  !stats.masked.length,
  `во вкладке нет масок (снимок их не рисует)${stats.masked.length ? ": " + stats.masked.slice(0, 5).join(", ") : ""}`
);
await st.close();

console.log("«Тир-лист»");
const tl = await browser.newPage({ viewport: { width: 1500, height: 900 } });
tl.on("pageerror", (e) => jsErrors.push(e.message));
writeFileSync(join(vaultDir, "site-settings.json"), settings("doodle-dark"));
await tl.goto(base + "/", { waitUntil: "domcontentloaded" });
await tl.click('.tab-btn[data-label="nav.tierlist"]');
await tl.waitForSelector("#tab-tierlist .tl-row:not(.tl-row-empty)", { timeout: 10000 });
await tl.waitForTimeout(500);
const tier = await tl.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const row = document.querySelector("#tab-tierlist .tl-row:not(.tl-row-empty)");
  const tape = css(row, "::before");
  const name = row.querySelector(".tl-label-name");
  // Снимок (captureTallElement) берёт каждую полку строго по её рамке:
  // торчащий наружу скотч обрезался бы. И ни одной маски – снимок их не рисует.
  const masked = [];
  for (const el of document.querySelectorAll("#tab-tierlist .tl-rows *")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const m = css(el, pseudo).maskImage || css(el, pseudo).webkitMaskImage;
      if (m && m !== "none") masked.push(el.className + (pseudo || ""));
    }
  }
  return {
    frame: css(row).backgroundImage,
    tape: tape.backgroundImage,
    tapeTop: parseFloat(tape.top),
    nameFont: css(name).fontFamily,
    mark: css(name, "::after").backgroundColor,
    masked,
  };
});
ok(/doodle-frame-/.test(tier.frame), "полка обведена рамкой от руки");
ok(
  /doodle-tape-bg-\d\.svg/.test(tier.tape) && tier.tapeTop >= 0,
  "скотч – внутри полки (иначе снимок его обрезает)"
);
ok(
  tier.nameFont.startsWith('"Shantell Sans"') && tier.mark !== "rgba(0, 0, 0, 0)",
  "название полки – почерком, с маркером цвета полки"
);
ok(
  !tier.masked.length,
  `в полках нет масок${tier.masked.length ? ": " + tier.masked.slice(0, 5).join(", ") : ""}`
);
await tl.close();

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nрисованная тема на месте");
