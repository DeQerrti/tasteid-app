// Значения с кавычками внутри onclick="…" (jsArg в js/utils.js).
//
// Раньше значение вставлялось как onclick="f('${esc(x)}')", а браузер
// раскодирует &#39; обратно в апостроф ДО выполнения кода атрибута: тег
// «Rock'n'roll» ломал клик, а составленный нарочно – выполнял чужой код
// (такой тег мог прийти из чужой резервной копии или синхронизации).
//
// Проверяется:
//   – тег с апострофом выбирается для карточки обычным кликом;
//   – тег-«инъекция» не выполняет код, а просто выбирается как текст.
//
// Запуск: node tests/browser/quotes-in-handlers.mjs

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

const APOS = "Rock'n'roll";
const EVIL = "x');window.__pwned=1;('";
const vaultDir = mkdtempSync(join(tmpdir(), "tasteid-quotes-"));
writeFileSync(
  join(vaultDir, "reviews.json"),
  JSON.stringify([
    {
      id: 1,
      title: "Песня",
      type: "movie",
      status: "completed",
      grade: "etalon",
      tags: [APOS, EVIL],
    },
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
await page.goto(`http://127.0.0.1:${port}/#/add?edit=1`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".card-tag-row", { state: "attached", timeout: 15000 });

const row = (name) =>
  page.locator(".card-tag-row", { has: page.locator(".card-tag-row-name", { hasText: name }) });
await row(APOS).dispatchEvent("click");
ok(
  (await row(APOS).getAttribute("class")).includes("selected"),
  "тег с апострофом выбирается кликом"
);
await row("__pwned").dispatchEvent("click");
ok(!(await page.evaluate(() => window.__pwned)), "тег-«инъекция» не выполняет код");
ok(
  (await row("__pwned").getAttribute("class")).includes("selected"),
  "и выбирается как обычный текст"
);
ok(jsErrors.length === 0, "без ошибок JS" + (jsErrors.length ? `: ${jsErrors.join("; ")}` : ""));

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} проверок не прошли`);
  process.exit(1);
}
console.log("\nкавычки в обработчиках безопасны");
process.exit(0);
