// Ботаническая тема («Мягкий ботанический», тёмная и светлая): вид
// «полевого дневника» на боковой панели и вкладке «Статусы».
//
// Проверяется (на ширине компьютера, в обеих темах):
//   – файлы украшений из /decor отдаются сервером;
//   – вкладки статусов – текстом на ветке, без капсул и заглавных букв;
//     лист под выбранной вкладкой стоит НА ветке и не выходит за неё вниз
//     (owner поправлял именно это);
//   – кнопки типов – тихой строкой, без рамок;
//   – карточка – лист гербария: поля вокруг обложки, тип – бумажным
//     ярлычком;
//   – выбранный раздел в боковой панели – на бумажном ярлычке.
//
// Запуск: node tests/browser/botanic-theme.mjs
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

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-botanic-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "Растёт",
      type: "anime",
      status: "current",
      year: 2024,
      date_start: "2024-03-01",
    },
    { id: 2, title: "Ждёт", type: "manga", status: "planning", year: 2020 },
    {
      id: 3,
      title: "Цветёт",
      type: "movie",
      status: "current",
      year: 2021,
      date_start: "2024-04-01",
    },
    {
      id: 4,
      title: "Любимый",
      type: "book",
      status: "completed",
      year: 2010,
      grade: "etalon",
      favorite: true,
      tags: ["Драма"],
      review_full: "Текст отзыва.",
    },
  ])
);
writeFileSync(
  join(vaultDir, "favorites.json"),
  JSON.stringify([
    { id: 1, name: "Садовник", type: "person", subtype: "director" },
    { id: 2, name: "Ботаник", type: "person", subtype: "author" },
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
const base = `http://127.0.0.1:${port}`;

// Главная – и дождаться стартовой вкладки. Приложение открывает последнюю
// вкладку (tasteid-last-tab), но узнаёт её только когда загрузит настройки
// (window.themeReady, затем клик в index.html). Нажатие на вкладку раньше
// этого перебивалось: во втором проходе темы приложение возвращало
// тир-лист, на котором закончился первый, и ожидание карточки в
// «Статусах» упиралось в таймаут (CI, ноябрь 2026).
async function gotoHome() {
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.themeReady !== undefined);
  await page.evaluate(() => Promise.resolve(window.themeReady));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

console.log("Украшения");
for (const name of ["leaf.svg", "leaf-up.svg", "branch.svg", "fern-top.svg", "fern-bottom.svg"]) {
  const res = await page.request.get(`${base}/decor/${name}`);
  ok(res.ok(), `/decor/${name} отдаётся`);
}

for (const theme of ["soft-dark", "soft"]) {
  console.log(`Тема ${theme}`);
  writeFileSync(join(vaultDir, "site-settings.json"), JSON.stringify({ theme }));
  await gotoHome();
  await page.click('.tab-btn[data-label="nav.now"]');
  // Видимую: во втором проходе первой в разметке бывает карточка соседнего
  // (скрытого) статуса – ожидание первой попавшейся время от времени
  // упиралось в таймаут в CI.
  await page.waitForSelector("#tab-now .review-card-wrap >> visible=true", { timeout: 10000 });

  // Ярлычок выбранного раздела проявляется плавно – ждём конца перехода.
  await page.waitForTimeout(500);
  const look = await page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const toggle = document.querySelector("#tab-now > .tl-mode-toggle");
    const btn = toggle.querySelector(".tl-mode-btn.active");
    const leaf = css(btn, "::after");
    const branch = css(toggle, "::after");
    // Низ листа и середина ветки – в пикселях от низа строки вкладок.
    const padBottom = parseFloat(css(toggle).paddingBottom);
    const leafBottom = padBottom + parseFloat(leaf.bottom);
    const branchMid = parseFloat(branch.bottom) + parseFloat(branch.height) / 2;
    const chip = document.querySelector("#tab-now .now-chip:not(.active)");
    const card = document.querySelector("#tab-now .review-card-wrap .card");
    const tag = card.querySelector(".type-tag");
    const rail = document.querySelector("#rail .tab-btn.active");
    const paper = css(document.documentElement).getPropertyValue("--paper").trim();
    const probe = document.createElement("i");
    probe.style.color = paper;
    document.body.appendChild(probe);
    const paperRgb = css(probe).color;
    probe.remove();
    return {
      btnBg: css(btn).backgroundColor,
      btnCase: css(btn).textTransform,
      btnStyle: css(btn).fontStyle,
      branchMask: branch.maskImage || branch.webkitMaskImage,
      leafBottom,
      branchMid,
      leafTop: leafBottom + parseFloat(leaf.height),
      padBottom,
      chipBorder: css(chip).borderTopWidth,
      cardPad: css(card).paddingLeft,
      tagBg: css(tag).backgroundColor,
      railBg: css(rail).backgroundColor,
      paperRgb,
    };
  });

  ok(
    look.btnBg === "rgba(0, 0, 0, 0)" && look.btnCase === "none" && look.btnStyle === "italic",
    "вкладки статусов – курсивом, без капсулы и заглавных"
  );
  ok(/branch\.svg/.test(look.branchMask || ""), "под вкладками статусов – ветка");
  ok(
    Math.abs(look.leafBottom - look.branchMid) <= 2,
    `лист стоит на ветке, а не выходит за неё (низ листа ${look.leafBottom.toFixed(1)}, ветка ${look.branchMid.toFixed(1)})`
  );
  ok(look.leafTop <= look.padBottom, "и не задевает название вкладки сверху");
  ok(look.chipBorder === "0px", "кнопки типов – без рамок");
  ok(parseFloat(look.cardPad) >= 8, `у обложки поля, как у листа гербария (${look.cardPad})`);
  ok(look.tagBg === look.paperRgb, "тип на карточке – бумажным ярлычком");

  // «Любимое» – в том же языке: ветка под разделами, листы гербария,
  // роли на ярлычках; при наведении в панели – не прежняя капсула.
  await page.click('.tab-btn[data-label="nav.favorites"]');
  await page.waitForSelector("#tab-favorites .review-card-wrap", { timeout: 10000 });
  const favTitles = await page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const head = css(document.querySelector("#tab-favorites > .fav-head"), "::after");
    const card = document.querySelector("#tab-favorites .review-card-wrap .card");
    const btn = document.querySelector("#tab-favorites .fav-head .tl-mode-btn.active");
    const order = document.querySelector("#fav-action-link .admin-add-btn");
    return {
      branchMask: head.maskImage || head.webkitMaskImage,
      cardPad: css(card).paddingLeft,
      btnCase: css(btn).textTransform,
      orderBorder: css(order).borderTopWidth,
      railRadius: css(document.querySelector("#rail .tab-btn:not(.active)")).borderTopLeftRadius,
    };
  });
  ok(/branch\.svg/.test(favTitles.branchMask || ""), "«Любимое»: под разделами – ветка");
  ok(favTitles.btnCase === "none", "«Любимое»: разделы – без заглавных букв");
  ok(parseFloat(favTitles.cardPad) >= 8, "«Любимое»: тайтл – лист гербария с полями");
  ok(favTitles.orderBorder === "0px", "«Любимое»: «Порядок» – строкой, без рамки");
  ok(favTitles.railRadius === "2px", "боковая панель: при наведении – ярлычок, а не капсула");

  await page.click('#tab-favorites .tl-mode-btn[data-mode="favPersons"]');
  await page.waitForSelector("#tab-favorites .card-char", { timeout: 10000 });
  const favPersons = await page.evaluate(() => {
    const css = (el) => getComputedStyle(el);
    const paper = css(document.documentElement).getPropertyValue("--paper").trim();
    const probe = document.createElement("i");
    probe.style.color = paper;
    document.body.appendChild(probe);
    const paperRgb = css(probe).color;
    probe.remove();
    return {
      charPad: css(document.querySelector("#tab-favorites .card-char")).paddingLeft,
      headBg: css(document.querySelector("#tab-favorites .fav-role-head")).backgroundColor,
      paperRgb,
    };
  });
  ok(parseFloat(favPersons.charPad) >= 7, "«Любимое»: персона – лист гербария с полями");
  ok(favPersons.headBg === favPersons.paperRgb, "«Любимое»: название роли – на бумажном ярлычке");
  ok(look.railBg === look.paperRgb, "выбранный раздел панели – на бумажном ярлычке");

  // Рамка на картинке – псевдоэлементом обёртки .card-poster: контур самой
  // картинки (outline) не попадал в снимок «Сохранить как картинку».
  const frame = await page.evaluate(() => {
    const poster = document.querySelector("#tab-favorites .card-char .card-poster");
    return poster ? getComputedStyle(poster, "::after").borderTopStyle : "нет обёртки";
  });
  ok(frame === "solid", `«Любимое»: рамка на картинке – на обёртке .card-poster (${frame})`);

  // Снимок собирается вне вкладки, в .fav-export, – правила темы должны
  // доставать и до него, иначе на картинке остаётся прежний вид.
  const exported = await page.evaluate(() => {
    const wrap = document.createElement("div");
    wrap.className = "fav-export";
    wrap.style.cssText = "position:fixed;left:-9999px;top:0;width:900px";
    wrap.innerHTML = `<div class="grid-chars">${document.querySelector("#tab-favorites .card-char").outerHTML}</div>`;
    document.body.appendChild(wrap);
    const pad = getComputedStyle(wrap.querySelector(".card-char")).paddingLeft;
    wrap.remove();
    return pad;
  });
  ok(parseFloat(exported) >= 4, `снимок «Любимого» берёт новый вид карточек (поля ${exported})`);

  // «Отзывы»: карточки – те же листы гербария; поиск и фильтры строкой;
  // открытый список фильтра – «страница дневника».
  await page.click('.tab-btn[data-label="nav.reviews"]');
  await page.waitForSelector("#tab-reviews .review-card-wrap", { timeout: 10000 });
  await page.click('#tab-reviews .rv-dd[data-dd="types"] .rv-dd-btn');
  await page.waitForSelector("#tab-reviews .rv-pop:not(.hidden)", { timeout: 5000 });
  const rv = await page.evaluate(() => {
    const css = (el, pseudo) => getComputedStyle(el, pseudo);
    const card = document.querySelector("#tab-reviews .review-card-wrap .card");
    return {
      cardPad: css(card).paddingLeft,
      frame: css(card.querySelector(".card-poster"), "::after").borderTopStyle,
      filterBorder: css(document.querySelector("#tab-reviews .rv-bar .rv-filter-btn"))
        .borderTopWidth,
      searchBorder: css(document.querySelector("#tab-reviews .rv-bar .rv-search-input"))
        .borderTopWidth,
      popRadius: css(document.querySelector("#tab-reviews .rv-pop:not(.hidden)"))
        .borderTopLeftRadius,
    };
  });
  ok(
    parseFloat(rv.cardPad) >= 8 && rv.frame === "solid",
    "«Отзывы»: карточка – лист гербария с рамкой"
  );
  ok(
    rv.filterBorder === "0px" && rv.searchBorder === "0px",
    "«Отзывы»: поиск и фильтры – строкой, без рамок"
  );
  ok(rv.popRadius === "4px", "«Отзывы»: открытый список фильтра – с почти прямыми углами");
  await page.keyboard.press("Escape");

  // Окно отзыва – «лист дневника»: почти прямые углы, шапка под пунктиром,
  // обложка на подложке с полями, теги прямоугольными рамками.
  await page.click("#tab-reviews .review-card-wrap");
  await page.waitForSelector("#review-modal-overlay:not(.hidden)", { timeout: 5000 });
  const win = await page.evaluate(() => {
    const css = (sel) => getComputedStyle(document.querySelector(sel));
    return {
      radius: css("#review-modal-overlay .review-modal-panel").borderTopLeftRadius,
      header: css("#review-modal-body .review-modal-header").borderBottomStyle,
      coverPad: css("#review-modal-body .review-modal-cover").paddingLeft,
      tagRadius: css("#review-modal-body .rtag").borderTopLeftRadius,
    };
  });
  ok(
    win.radius === "5px" && win.header === "dashed",
    "окно отзыва – лист дневника, шапка под пунктиром"
  );
  ok(parseFloat(win.coverPad) >= 8, `обложка в окне – на подложке с полями (${win.coverPad})`);
  ok(win.tagRadius === "2px", "теги в окне – прямоугольными рамками");
  await page.keyboard.press("Escape");

  // Редактор отзыва: поля строкой, заголовки разделов на ярлычках, оценка
  // строкой с ромбами.
  await page.goto(base + "/#/add?edit=4", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".add-view.ed .grade-btn", { timeout: 10000 });
  const ed = await page.evaluate(() => {
    const css = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo);
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    const probe = document.createElement("i");
    probe.style.color = paper;
    document.body.appendChild(probe);
    const paperRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      titleBorder: css("#f-title").borderTopWidth,
      titleLine: css("#f-title").borderBottomStyle,
      headBg: css(".add-view.ed .ed-h").backgroundColor,
      gradeBg: css(".add-view.ed .grade-btn").backgroundColor,
      gradeDot: css(".add-view.ed .grade-btn", "::before").opacity,
      paperRgb,
    };
  });
  ok(
    ed.titleBorder === "0px" && ed.titleLine === "solid",
    "редактор: поля – строкой с линией снизу"
  );
  ok(ed.headBg === ed.paperRgb, "редактор: заголовки разделов – на бумажных ярлычках");
  ok(
    ed.gradeBg === "rgba(0, 0, 0, 0)" && ed.gradeDot === "1",
    "редактор: оценка – строкой с ромбами"
  );

  // «Любимое»: окно записи – тот же лист дневника; редактор порядка –
  // листы гербария; редактор записи – поля строкой, заголовки ярлычками.
  await gotoHome();
  await page.click('.tab-btn[data-label="nav.favorites"]');
  await page.click('#tab-favorites .tl-mode-btn[data-mode="favPersons"]');
  await page.waitForSelector("#tab-favorites .card-char", { timeout: 10000 });
  await page.click("#tab-favorites .card-char");
  await page.waitForSelector("#fav-modal-overlay:not(.hidden)", { timeout: 5000 });
  const favWin = await page.evaluate(() => {
    const css = (sel) => getComputedStyle(document.querySelector(sel));
    return {
      radius: css("#fav-modal-overlay .review-modal-panel").borderTopLeftRadius,
      header: css("#fav-modal-body .review-modal-header").borderBottomStyle,
      coverPad: css("#fav-modal-body .review-modal-cover").paddingLeft,
    };
  });
  ok(
    favWin.radius === "5px" && favWin.header === "dashed" && parseFloat(favWin.coverPad) >= 7,
    "окно «Любимого» – лист дневника, картинка на подложке с полями"
  );
  await page.keyboard.press("Escape");

  await page.goto(base + "/#/favorites-order?section=favPersons", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(".ro-view .dnd-item", { timeout: 10000 });
  const order = await page.evaluate(() => ({
    pad: getComputedStyle(document.querySelector(".ro-view .dnd-item")).paddingLeft,
    num: getComputedStyle(document.querySelector(".ro-view .dnd-item-num")).backgroundColor,
    paper: (() => {
      const probe = document.createElement("i");
      probe.style.color = getComputedStyle(document.documentElement)
        .getPropertyValue("--paper")
        .trim();
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    })(),
  }));
  ok(
    parseFloat(order.pad) >= 7 && order.num === order.paper,
    "редактор порядка: листы гербария, номер – бумажным ярлычком"
  );

  await page.goto(base + "/#/favorites-edit?type=person", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#f-name", { timeout: 10000 });
  const fe = await page.evaluate(() => ({
    nameBorder: getComputedStyle(document.querySelector("#f-name")).borderTopWidth,
    headTransform: getComputedStyle(document.querySelector(".fe-view .fe-main > .section-title"))
      .transform,
  }));
  ok(
    fe.nameBorder === "0px" && fe.headTransform !== "none",
    "редактор записи «Любимого»: поля строкой, заголовки – ярлычками"
  );

  // «Статистика»: годы тихой строкой, заголовки блоков – ярлычками,
  // счётчики – через пунктир.
  await gotoHome();
  await page.click('.tab-btn[data-label="nav.stats"]');
  await page.waitForSelector("#tab-stats .sx-card > .section-title", { timeout: 10000 });
  const st = await page.evaluate(() => {
    // В тестовом хранилище одна оценённая запись: части блоков (другие
    // годы, счётчики по типам) может не быть – тогда и проверять нечего.
    const css = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : {};
    };
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim();
    document.body.appendChild(probe);
    const paperRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      yearBorder: css("#tab-stats .stat-year-filters .tl-filter").borderTopWidth,
      headBg: css("#tab-stats .sx-card > .section-title").backgroundColor,
      countersBorder: css("#tab-stats .stat-counters").borderTopStyle,
      paperRgb,
    };
  });
  ok(st.yearBorder === "0px", "«Статистика»: годы – тихой строкой, без рамок");
  ok(st.headBg === st.paperRgb, "«Статистика»: заголовки блоков – на бумажных ярлычках");
  ok(
    st.countersBorder === undefined || st.countersBorder === "dashed",
    "«Статистика»: счётчики по типам – через пунктир"
  );

  // Снимок статистики: веер обложек шапки на время снимка – одной готовой
  // картинкой (html2canvas сам веер рисовал без наклона и наложения), а
  // после снимка всё возвращается как было.
  const fan = await page.evaluate(async () => {
    const grid = document.querySelector("#tab-stats .stat-grid");
    const covers = [...grid.querySelectorAll(".sx-covers img")];
    if (!covers.length) return null;
    await Promise.all(covers.map((i) => i.decode().catch(() => {})));
    const before = grid.querySelectorAll("img").length;
    const restore = await window.statsBakeCoverFan(grid);
    const during = {
      added: grid.querySelectorAll("img").length - before,
      hidden: covers.every((i) => i.style.visibility === "hidden"),
    };
    restore();
    return {
      ...during,
      after: grid.querySelectorAll("img").length - before,
      shown: covers.every((i) => i.style.visibility === ""),
    };
  });
  ok(
    fan === null || (fan.added === 1 && fan.hidden),
    "снимок статистики: веер обложек подменён одной готовой картинкой"
  );
  ok(fan === null || (fan.after === 0 && fan.shown), "после снимка обложки возвращаются как были");

  // «Тир-лист»: вкладки на ветке, кнопки типов и годы тихой строкой,
  // «Подписи» – строкой, название полки – бумажным ярлычком.
  await gotoHome();
  await page.click('.tab-btn[data-label="nav.tierlist"]');
  await page.waitForSelector("#tab-tierlist .tl-row:not(.tl-row-empty) .tl-label-name", {
    timeout: 10000,
  });
  await page.waitForTimeout(600);
  const tl = await page.evaluate(async () => {
    const css = (sel, pseudo) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el, pseudo) : {};
    };
    const probe = document.createElement("i");
    probe.style.color = getComputedStyle(document.documentElement)
      .getPropertyValue("--paper")
      .trim();
    document.body.appendChild(probe);
    const paperRgb = getComputedStyle(probe).color;
    probe.remove();
    const toggle = css("#tab-tierlist > .tl-mode-toggle", "::after");
    const name = document.querySelector("#tab-tierlist .tl-row:not(.tl-row-empty) .tl-label-name");
    // Снимок (tlExport снимает полки той же html2canvas): ярлычок должен
    // выйти бумажным и на картинке.
    if (typeof window.html2canvas === "undefined") await window.loadHtml2Canvas();
    const rows = name.closest(".tl-rows");
    const restoreAnim = window.disableAnimations(rows);
    rows.classList.add("tl-exporting");
    const canvas = await window.html2canvas(rows, {
      scale: 1,
      logging: false,
      backgroundColor: null,
    });
    rows.classList.remove("tl-exporting");
    restoreAnim();
    const r = rows.getBoundingClientRect();
    const n = name.getBoundingClientRect();
    const px = canvas
      .getContext("2d")
      .getImageData(
        Math.round(n.left - r.left + 19),
        Math.round(n.top - r.top + n.height / 2),
        1,
        1
      ).data;
    return {
      paperRgb,
      shot: `rgb(${px[0]}, ${px[1]}, ${px[2]})`,
      tabCase: css("#tab-tierlist .tl-mode-btn").textTransform,
      branch: toggle.maskImage || toggle.webkitMaskImage,
      chipBorder: css("#tab-tierlist .tl-filters .now-chip").borderTopWidth,
      yearLeaf: css("#tab-tierlist .tl-year.active", "::before").maskImage || "",
      toolBorder: css("#tab-tierlist .tl-tool-btn").borderTopWidth,
      nameBg: getComputedStyle(name).backgroundColor,
      dot: css("#tab-tierlist .tl-row:not(.tl-row-empty) .tl-label-dot").display,
    };
  });
  ok(
    tl.tabCase === "none" && /branch\.svg/.test(tl.branch || ""),
    "«Тир-лист»: вкладки – текстом на ветке"
  );
  ok(
    [undefined, "0px"].includes(tl.chipBorder) && tl.toolBorder === "0px",
    "«Тир-лист»: кнопки типов и «Подписи» – без рамок"
  );
  ok(
    tl.yearLeaf === "" || /leaf\.svg/.test(tl.yearLeaf),
    "«Тир-лист»: годы – с листиком у выбранного"
  );
  ok(tl.nameBg === tl.paperRgb, "«Тир-лист»: название полки – на бумажном ярлычке");
  ok(tl.dot === undefined || tl.dot === "none", "«Тир-лист»: вместо точки – ромб на ярлычке");
  ok(tl.shot === tl.paperRgb, `снимок тир-листа: ярлычок полки бумажный (${tl.shot})`);
}

// ── Телефон: тот же язык, уменьшенный ──
console.log("Телефон (soft-dark)");
writeFileSync(join(vaultDir, "site-settings.json"), JSON.stringify({ theme: "soft-dark" }));
const phone = await browser.newPage({ viewport: { width: 390, height: 800 } });
phone.on("pageerror", (e) => jsErrors.push(e.message));
await phone.goto(base + "/", { waitUntil: "domcontentloaded" });
await phone.click('.tab-btn[data-label="nav.now"]');
await phone.waitForSelector("#tab-now .review-card-wrap", { timeout: 10000 });
await phone.waitForTimeout(500);
const small = await phone.evaluate(() => {
  const css = (el, pseudo) => getComputedStyle(el, pseudo);
  const paper = css(document.documentElement).getPropertyValue("--paper").trim();
  const probe = document.createElement("i");
  probe.style.color = paper;
  document.body.appendChild(probe);
  const paperRgb = css(probe).color;
  probe.remove();
  const toggle = document.querySelector("#tab-now > .tl-mode-toggle");
  const btn = toggle.querySelector(".tl-mode-btn.active");
  return {
    paperRgb,
    btnCase: css(btn).textTransform,
    branchMask: css(toggle, "::after").maskImage || css(toggle, "::after").webkitMaskImage,
    fits: (() => {
      // Кнопки – во внутренней полосе .tl-mode-scroll: лишние прокручиваются
      // (hscrollRow, utils.js), а ветка – у строки целиком и не уезжает.
      const strip = toggle.querySelector(".tl-mode-scroll");
      const r = strip.getBoundingClientRect();
      return (
        r.right <= window.innerWidth + 1 &&
        (strip.scrollWidth <= strip.clientWidth + 1 || getComputedStyle(strip).overflowX === "auto")
      );
    })(),
    cardPad: css(document.querySelector("#tab-now .review-card-wrap .card")).paddingLeft,
    tagBg: css(document.querySelector("#tab-now .type-tag")).backgroundColor,
    navBg: css(document.querySelector("#rail .tab-btn.active")).backgroundColor,
    navTransform: css(document.querySelector("#rail .tab-btn.active")).transform,
  };
});
ok(
  small.btnCase === "none" && /branch\.svg/.test(small.branchMask || ""),
  "вкладки статусов – текстом на ветке"
);
ok(small.fits, "вкладки статусов не уезжают за край (лишние – прокруткой, ветка под ними целиком)");
ok(parseFloat(small.cardPad) >= 3, `карточка – лист гербария с полями (${small.cardPad})`);
ok(small.tagBg === small.paperRgb, "тип на карточке – бумажным ярлычком");
ok(small.navBg === small.paperRgb, "выбранный раздел нижней панели – бумажный ярлычок");
ok(small.navTransform === "none", "и без поворота: в нижней панели ему тесно");

// «Тир-лист» на телефоне: вкладки не уезжают за край, ярлычок полки влезает в
// узкую колонку названия.
await phone.click('.tab-btn[data-label="nav.tierlist"]');
await phone.waitForSelector("#tab-tierlist .tl-row:not(.tl-row-empty) .tl-label-name", {
  timeout: 10000,
});
await phone.waitForTimeout(500);
const tlSmall = await phone.evaluate(() => {
  const toggle = document.querySelector("#tab-tierlist > .tl-mode-toggle");
  const name = document.querySelector("#tab-tierlist .tl-row:not(.tl-row-empty) .tl-label-name");
  const col = name.closest(".tl-label").getBoundingClientRect();
  const r = name.getBoundingClientRect();
  return {
    fits: (() => {
      // Кнопки – во внутренней полосе .tl-mode-scroll: лишние прокручиваются
      // (hscrollRow, utils.js), а ветка – у строки целиком и не уезжает.
      const strip = toggle.querySelector(".tl-mode-scroll");
      const r = strip.getBoundingClientRect();
      return (
        r.right <= window.innerWidth + 1 &&
        (strip.scrollWidth <= strip.clientWidth + 1 || getComputedStyle(strip).overflowX === "auto")
      );
    })(),
    inCol: r.left >= col.left - 1 && r.right <= col.right + 1,
  };
});
ok(tlSmall.fits, "«Тир-лист»: вкладки не уезжают за край");
ok(tlSmall.inCol, "«Тир-лист»: ярлычок полки влезает в колонку названия");
await phone.close();

ok(!jsErrors.length, `без ошибок JS${jsErrors.length ? ": " + jsErrors.join("; ") : ""}`);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nботаническая тема на месте");
