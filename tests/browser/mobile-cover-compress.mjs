// Резервная копия обложки по внешней ссылке сжимается в webp и на
// телефоне тоже — в настоящем браузере, тем же canvas-приёмом, каким
// add.js/chars-edit.js/favorites-edit.js уже год как сжимают файлы,
// загруженные вручную.
//
// На компьютере core/api.js: backupCover() сжимает через sharp
// (нативный модуль, electron/image.js) — его нельзя затянуть в
// мобильный мост, который esbuild собирает в один файл для WebView, и
// там вместо этого используется обычный canvas браузера
// (mobile/src/main.js: compressImage). Отдельная реализация — значит
// отдельная проверка, тем же приёмом, что и mobile-bridge.mjs: мост
// собирается заново и грузится в пустую страницу, а не в полноценный
// index.html.
//
// Запуск: node tests/browser/mobile-cover-compress.mjs
// playwright — обычная devDependency. В npm run check не входит (нужен
// настоящий браузер), но гоняется отдельным CI-джобом (npm run test:browser).

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import http from "node:http";
import { buildMobileBundle } from "../fixtures/mobile-bundle.js";

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

const out = buildMobileBundle();

// Настоящие HTTP-серверы для и страницы, и картинки-источника — не
// page.route(): Chromium не может определить "адресное пространство"
// мокнутой страницы, и Private Network Access блокирует любой fetch
// на loopback как обращение из "unknown", даже между двумя процессами
// одной машины.
const pageServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<html><body></body></html>");
});
await new Promise((r) => pageServer.listen(0, "127.0.0.1", r));
const pagePort = pageServer.address().port;

// Крупная сплошная PNG – специально больше 1200px по стороне, чтобы
// сжатие было чем измерить, и с CORS-заголовком, как у настоящих
// источников обложек (AniList, TMDB – см. комментарий в config.js:
// proxyImagesToDataUrls про Access-Control-Allow-Origin).
function bigPng() {
  // Ручной PNG-энкодер тут ни к чему — 2000x2000 сплошного цвета через
  // несжатые IDAT (без zlib-компрессии сборка была бы сложнее, а нам
  // важен исходный размер посчитанный, не полученный от настоящего
  // кодека). Проще: собираем через встроенный в Node zlib.
  const zlib = require("node:zlib");
  const width = 2000;
  const height = 2000;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = 90;
      raw[p + 1] = 60;
      raw[p + 2] = 150;
    }
  }
  const idat = zlib.deflateSync(raw);
  const crc32 = (buf) => {
    let c;
    const table = crc32.table || (crc32.table = makeCrcTable());
    c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function makeCrcTable() {
    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  }
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crc]);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = bigPng();
console.log(`синтетическая исходная PNG: ${png.length} байт`);

const imgServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" });
  res.end(png);
});
await new Promise((r) => imgServer.listen(0, "127.0.0.1", r));
const imgPort = imgServer.address().port;

const browser = await chromium.launch();
const page = await browser.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
await page.addInitScript(() => {
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => "android",
    convertFileSrc: (u) => u,
  };
});
await page.goto(`http://127.0.0.1:${pagePort}/blank`);
await page.addScriptTag({ path: out });
await page.waitForTimeout(200);

const result = await page.evaluate(async (imgPort) => {
  const res = await fetch("/api/backup-cover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: `http://127.0.0.1:${imgPort}/x.png`, filename: "big" }),
  });
  const data = await res.json();
  const bytes = window.__fakeFiles.get("TasteID/covers-backup/big.webp");
  return { data, savedBytes: bytes ? bytes.length : null, allKeys: [...window.__fakeFiles.keys()] };
}, imgPort);

console.log("ответ backup-cover:", result.data);
ok(result.data.ok === true, "запрос завершился успешно");
ok(result.data.url === "/covers-backup/big.webp", `сохранено как webp: "${result.data.url}"`);
ok(
  result.allKeys.includes("TasteID/covers-backup/big.webp"),
  "файл действительно лежит под этим именем в файловой системе телефона"
);
// Сплошной цвет и так сжимается PNG почти идеально — настоящий выигрыш
// в байтах для реальных фотографичных обложек куда больше (см. пример
// с sharp в tests/api.test.js). Здесь важно другое: файл действительно
// стал webp меньшего размера, а не просто переименован.
ok(
  result.savedBytes !== null && result.savedBytes < png.length,
  `сжатый файл меньше исходного (${result.savedBytes} байт против ${png.length})`
);
ok(jsErrors.length === 0, `без ошибок в консоли: ${jsErrors.join("; ")}`);

await browser.close();
pageServer.close();
imgServer.close();

if (failures.length) {
  console.log("\nПРОБЛЕМЫ:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("\nсжатие резервной копии обложки работает и на телефоне");
