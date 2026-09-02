// Снимок большого тир-листа (кнопка "сохранить как картинку", фильтр
// "все") не должен терять верхние тиры — в настоящем браузере, с
// настоящим html2canvas-pro и настоящей вёрсткой тир-листа.
//
// Владелец показал скриншот: при фильтре "все" (сотни карточек сразу)
// верхние тиры на снимке выходят пустыми, хотя те же самые карточки в
// обычном виде приложения показываются нормально, и то же самое
// "только аниме"/"только фильмы" (меньше карточек) снималось без
// проблем. Две предыдущие версии объяснения (предел размера
// GPU-текстуры; waitForImages() сдаётся через жёсткие 8 секунд) владелец
// проверил вживую и обе не подтвердились — свежая консоль разработчика
// при повторе с фильтром "все" была пуста (не считая безобидного
// предупреждения самого html2canvas-pro про document.write()), то есть
// ни один кандидат в proxyImagesToDataUrls() не проваливался вовсе.
// Значит дело не в том, что картинка не загрузилась, а в том, что
// html2canvas клонирует DOM для рисования сразу после того, как
// proxyOne() подставил новый data:-URL в img.src, — а src это только
// "начали грузить", браузер ещё должен ДЕКОДИРОВАТЬ новые байты в
// растр. На сотнях карточек разом это не мгновенно, и часть успевала
// попасть в клон ещё до того, как их новый src действительно
// прорисовался — снаружи неотличимо от "картинки нет", но без единой
// ошибки в консоли, ровно как видел владелец. У отфильтрованного
// списка (в разы меньше карточек) декодирование почти всегда успевает
// закончиться за то же самое время. Исправлено явным
// `await img.decode()` в config.js сразу после подстановки нового src –
// вместо того, чтобы просто понадеяться, что браузер как-нибудь успеет
// сам.
//
// Этот же класс бага (holst нужного размера, данные на месте, но не
// прорисовались) не ловился бы старой версией теста ниже — она
// проверяла только размеры готового PNG и отсутствие ошибок в консоли,
// а не то, что внутри реально нарисовано. Поэтому здесь же теперь
// настоящая проверка пикселей: обложки специально ярко-зелёные, фон
// темы — нет, и верхняя полоса готового снимка обязана содержать
// зелёные пиксели, а не только иметь правильный размер.
//
// Запуск: node tests/browser/tierlist-export-scale.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

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

// PNG хранит ширину/высоту в IHDR: 8 байт сигнатуры, потом длина+тип
// чанка (8 байт), потом сама ширина/высота — по 4 байта, big-endian.
function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-tlscale-"));
mkdirSync(join(vaultDir, "covers-backup"), { recursive: true });
// Ярко-зелёный 8x8 – не для проверки цвета (PNG здесь не декодируется
// попиксельно), а чтобы при ручном разглядывании скриншота отличие от
// тёмного фона темы было сразу видно.
const GREEN_8X8 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNg+G+DHQ0tCQC2ik7BakjxzwAAAABJRU5ErkJggg==",
  "base64"
);

const GRADES = ["rezonans", "etalon", "vyskazyvanie", "attrakcion", "fon", "brak", "razocharo"];
const TYPES = ["anime", "manga", "film"];
const N = 260;
const reviews = [];
for (let i = 0; i < N; i++) {
  const backupName = `cover${i}.png`;
  writeFileSync(join(vaultDir, "covers-backup", backupName), GREEN_8X8);
  reviews.push({
    title: `Тайтл ${i}`,
    type: TYPES[i % TYPES.length],
    grade: GRADES[i % GRADES.length],
    year: 2000 + (i % 25),
    cover: `https://s4.anilist.invalid.test/${i}.png`,
    cover_backup: `/covers-backup/${backupName}`,
  });
}

const port = 8963;
const server = spawn("node", ["scripts/serve.js", vaultDir, String(port)], {
  stdio: ["ignore", "pipe", "inherit"],
});
process.on("exit", () => server.kill());
await new Promise((done, fail) => {
  const timer = setTimeout(() => fail(new Error("сервер не поднялся")), 10000);
  server.stdout.on("data", (d) => String(d).includes("http") && (clearTimeout(timer), done()));
});

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

// Обычная загрузка <img> (resourceType "image") реально проходит и
// отдаёт картинку — так же, как показывает владелец в обычном виде
// приложения. Настоящий fetch()/xhr в обход резервной копии не
// обслуживаем вовсе: если резервная копия используется как положено,
// до этого не должно дойти.
let externalFetchHit = 0;
await page.route("https://s4.anilist.invalid.test/**", (route) => {
  const type = route.request().resourceType();
  if (type === "fetch" || type === "xhr") {
    externalFetchHit++;
    route.abort();
    return;
  }
  route.fulfill({ contentType: "image/png", body: GREEN_8X8 });
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(300);

console.log("safeCaptureScale() как чистая функция");
const scaleChecks = await page.evaluate(() => {
  const fakeSmall = { scrollWidth: 900, scrollHeight: 1200 };
  const fakeHuge = { scrollWidth: 900, scrollHeight: 6800 }; // *2 = 13600, как в реальном разборе
  return {
    small: window.safeCaptureScale(fakeSmall, 2, 8000),
    huge: window.safeCaptureScale(fakeHuge, 2, 8000),
  };
});
ok(
  scaleChecks.small === 2,
  `небольшой холст — масштаб как просили, без урезания: ${scaleChecks.small}`
);
ok(
  scaleChecks.huge < 2 && scaleChecks.huge * 6800 <= 8000 + 1e-6,
  `холст за пределом — масштаб уменьшен так, чтобы уложиться в 8000px: ${scaleChecks.huge}`
);

// На телефоне порог по умолчанию заметно ниже десктопного (см.
// utils.js) — 8000 уже один раз оказался мал на реальном устройстве
// (верхние тиры срезало), хотя тот же холст безопасно укладывался в
// песочнице без настоящей видеокарты. window.Capacitor подделываем
// точно тем же способом, что и tests/browser/mobile-bridge.mjs.
const mobileDefault = await page.evaluate(() => {
  window.Capacitor = { isNativePlatform: () => true };
  const fakeHuge = { scrollWidth: 900, scrollHeight: 6800 };
  const scale = window.safeCaptureScale(fakeHuge, 2);
  delete window.Capacitor;
  return scale;
});
ok(
  mobileDefault < 2 && mobileDefault * 6800 <= 4096 + 1e-6,
  `на телефоне без явного maxDim потолок консервативнее — 4096, а не 8000: ${mobileDefault}`
);

// Настоящая причина сегодняшнего бага: waitForImages() раньше сдавался
// через фиксированные 8 секунд независимо от того, сколько картинок
// ждёт своей очереди. Подделываем 300 "картинок", которые становятся
// complete только через 9 секунд (дольше старого жёсткого предела, но
// короче нового — 300 * 50 = 15000мс) — раньше waitForImages() отдал
// бы управление на 8-й секунде с частью img.complete === false, теперь
// обязан дождаться всех. Реальное время теста — около 9 секунд, тот же
// порядок, что и у "зависший источник картинки" ниже по набору тестов.
console.log("waitForImages() ждёт пропорционально количеству картинок, а не жёсткие 8 секунд");
const waitedForAll = await page.evaluate(() => {
  const fakes = Array.from({ length: 300 }, () => ({ complete: false }));
  for (const f of fakes)
    setTimeout(() => {
      f.complete = true;
    }, 9000);
  return window.waitForImages(fakes).then(() => fakes.every((f) => f.complete));
});
ok(waitedForAll, "все 300 «картинок» дождались complete, ни одна не брошена на середине очереди");

console.log("Заливаем 260 отзывов на все типы и оценки");
await page.evaluate(async (reviews) => {
  for (const r of reviews) {
    await fetch("/api/save-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(r),
    });
  }
}, reviews);

console.log('Тир-лист, фильтр "все" — тот случай, что был пустым на скриншоте');
await page.click('.tab-btn[data-label="nav.tierlist"]');
await page.waitForSelector(".tl-rows", { timeout: 10000 });
await page.waitForTimeout(500);
const imgCount = await page.evaluate(() => document.querySelectorAll("#tl-titles-rows img").length);
ok(imgCount === N, `все ${N} карточек в разметке при фильтре "все" (получили ${imgCount})`);

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60000 }),
  page.click("#tl-export-btn"),
]);
const outPath = join(vaultDir, "export.png");
await download.saveAs(outPath);
const png = await import("node:fs").then((fs) => fs.promises.readFile(outPath));
const dims = pngDimensions(png);
console.log(`итоговый PNG: ${dims.width}×${dims.height}`);
// html2canvas округляет размеры до целых пикселей и учитывает рамки/
// отступы клона, так что итог не совпадает с расчётом до пикселя –
// важно, что он на порядок меньше прежних ~13600px при фиксированном
// scale:2, а не что он равен ровно 8000.
ok(
  Math.max(dims.width, dims.height) <= 8100,
  `итоговый холст не перешагнул безопасную границу: ${Math.max(dims.width, dims.height)}px`
);
ok(
  externalFetchHit === 0,
  "ни разу не понадобилось идти за оригиналом или через wsrv.nl — всё взято из резервных копий"
);
ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

// Настоящая проверка содержимого, а не только размера холста — см.
// заголовок файла. Обложки в этом тесте — сплошной ярко-зелёный цвет,
// фон темы — нет, так что зелёный пиксель в верхней полосе снимка
// однозначно значит "обложка первого тира нарисовалась".
const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
const topBandHeight = Math.max(1, Math.round(info.height * 0.05));
let greenPixelsInTopBand = 0;
for (let y = 0; y < topBandHeight; y++) {
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (g > 150 && g > r + 50 && g > b + 50) greenPixelsInTopBand++;
  }
}
ok(
  greenPixelsInTopBand > 0,
  `верхняя полоса снимка (первый тир) не пустая — найдено ${greenPixelsInTopBand} зелёных пикселей обложки`
);

await browser.close();
server.kill();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nбольшой тир-лист снимается целиком");
