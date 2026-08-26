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

const FAKES = {
  "@capacitor/filesystem": "./tests/fixtures/fake-filesystem.js",
  "@capacitor/share": "./tests/fixtures/fake-share.js",
  "@capacitor/status-bar": "./tests/fixtures/fake-status-bar.js",
  "@capacitor/app": "./tests/fixtures/fake-app.js",
};

// Возвращает путь к собранному файлу.
export function buildMobileBundle(name = "bundle.js") {
  const out = join(mkdtempSync(join(tmpdir(), "tasteid-bundle-")), name);
  execFileSync("npx", [
    "esbuild",
    "mobile/src/main.js",
    "--bundle",
    "--format=iife",
    ...Object.entries(FAKES).map(([pkg, fake]) => `--alias:${pkg}=${fake}`),
    `--outfile=${out}`,
  ]);
  return out;
}
