// Сборка мобильного моста с подставными плагинами Capacitor.
//
// Одна на все проверки в браузере (mobile-bridge, backup, sync): раньше
// каждая держала свой список --alias, и списки разъехались. Стоило
// mobile/src/main.js завести ещё один плагин (@capacitor/app — ради
// версии приложения и кнопки «назад»), как в бандл приезжал настоящий
// @capacitor/core вместе с ним: тот при загрузке САМ записывает
// window.Capacitor и затирал подставной, поставленный проверкой через
// addInitScript. Мост после этого считал, что работает не на телефоне,
// и не ставился вовсе — проверки падали на первом же запросе, причём
// каждая по-своему и не там, где настоящая причина.
//
// Отсюда правило: новый плагин Capacitor в mobile/src — новая заглушка
// рядом и новая строка здесь. Одна, а не три.

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const FAKES = {
  "@capacitor/filesystem": "./tests/fixtures/fake-filesystem.js",
  "@capacitor/share": "./tests/fixtures/fake-share.js",
  "@capacitor/status-bar": "./tests/fixtures/fake-status-bar.js",
  "@capacitor/app": "./tests/fixtures/fake-app.js",
  "@capawesome-team/capacitor-file-opener": "./tests/fixtures/fake-file-opener.js",
  "@capacitor/core": "./tests/fixtures/fake-core.js",
};

// Возвращает путь к собранному файлу.
export function buildMobileBundle(name = "bundle.js") {
  const out = join(mkdtempSync(join(tmpdir(), "tasteid-bundle-")), name);
  // Через сам модуль esbuild, а не запуском его из командной строки –
  // оба способа запуска зависят от системы:
  //   "npx esbuild" – на Windows npx это npx.cmd, и execFileSync без
  //   оболочки его не находит («spawnSync npx ENOENT»): проверки с
  //   мобильным мостом на Windows не запускались вовсе;
  //   "node node_modules/esbuild/bin/esbuild" – на Windows это скрипт, а
  //   на Linux установка подменяет этот файл настоящей программой, и
  //   node падает на ней с SyntaxError (так один раз уже сломали CI).
  // buildSync одинаков везде.
  buildSync({
    absWorkingDir: ROOT,
    entryPoints: ["mobile/src/main.js"],
    bundle: true,
    format: "iife",
    alias: FAKES,
    outfile: out,
    logLevel: "warning",
  });
  return out;
}
