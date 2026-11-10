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

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
  // Не "npx esbuild": на Windows npx – это npx.cmd, и execFileSync без
  // оболочки его не находит («spawnSync npx ENOENT») – из-за этого все
  // проверки с мобильным мостом на Windows не запускались вовсе. Тем же
  // node запускаем сам скрипт esbuild из node_modules – одинаково
  // работает везде.
  execFileSync(process.execPath, [
    require.resolve("esbuild/bin/esbuild"),
    "mobile/src/main.js",
    "--bundle",
    "--format=iife",
    ...Object.entries(FAKES).map(([pkg, fake]) => `--alias:${pkg}=${fake}`),
    `--outfile=${out}`,
  ]);
  return out;
}
