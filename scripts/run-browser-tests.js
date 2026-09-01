// Прогоняет tests/browser/*.mjs по очереди — те самые проверки в
// настоящем браузере (Playwright), которые раньше были только «ручной
// проверкой» и не входили ни в npm run check, ни в CI. Каждый файл
// сам печатает свои ✓/✗ и завершается кодом 1 при провале — этот скрипт
// просто собирает такие коды по всем файлам, чтобы один упавший тест не
// прятал остальные за собой.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "browser");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".mjs"))
  .sort();

let failed = 0;
for (const file of files) {
  console.log(`\n── ${file} ──`);
  const result = spawnSync(process.execPath, [path.join(DIR, file)], { stdio: "inherit" });
  if (result.status !== 0) failed++;
}

if (failed) {
  console.log(`\n${failed} из ${files.length} файлов провалились.`);
  process.exit(1);
}
console.log(`\nВсе ${files.length} браузерных проверок прошли.`);
