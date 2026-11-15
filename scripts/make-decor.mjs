// Рисует украшения ботанической темы в app/decor/*.svg.
//
// Запускать руками, когда нужно поправить рисунок:  node scripts/make-decor.mjs
// Сами файлы лежат в репозитории – при сборке и в проверках скрипт не нужен.
//
// Все рисунки одноцветные (чёрным): в themes.css они подключены как
// mask-image, а цвет им задаёт палитра темы – так же, как у лианы
// /decor/vine.svg. Поэтому украшения перекрашиваются вместе с темой.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "decor");

const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g fill="#000" stroke="#000" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`;

// Лист вдоль оси X длиной L из точки (0,0); fat – толщина относительно длины.
const leaf = (L, fat = 0.24) => {
  const n = (v) => +v.toFixed(2);
  return `M0,0 C${n(L * 0.28)},${n(-L * fat)} ${n(L * 0.78)},${n(-L * fat * 0.8)} ${n(L)},0 C${n(L * 0.78)},${n(L * fat * 0.8)} ${n(L * 0.28)},${n(L * fat)} 0,0 Z`;
};
const placed = (d, x, y, deg) =>
  `<path d="${d}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${deg.toFixed(1)})" stroke-width="0"/>`;

// Ветвь папоротника: изогнутый стебель и пары листочков, мельчающих к концу.
function frond({ from, ctrl, to, maxL, pairs, spread = 64 }) {
  const q = (t, a, b, c) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  const dq = (t, a, b, c) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);
  let out = `<path d="M${from[0]},${from[1]} Q${ctrl[0]},${ctrl[1]} ${to[0]},${to[1]}" fill="none" stroke-width="${Math.max(1.4, maxL / 26).toFixed(1)}"/>`;
  for (let i = 0; i < pairs; i++) {
    const t = 0.1 + (i / (pairs - 1)) * 0.88;
    const x = q(t, from[0], ctrl[0], to[0]);
    const y = q(t, from[1], ctrl[1], to[1]);
    const ang =
      (Math.atan2(dq(t, from[1], ctrl[1], to[1]), dq(t, from[0], ctrl[0], to[0])) * 180) / Math.PI;
    const L =
      maxL * (0.28 + 0.72 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.9))) * (1 - t * 0.55);
    out += placed(leaf(L, 0.2), x, y, ang - spread) + placed(leaf(L, 0.2), x, y, ang + spread);
  }
  const tip = (Math.atan2(to[1] - ctrl[1], to[0] - ctrl[0]) * 180) / Math.PI;
  return out + placed(leaf(maxL * 0.3, 0.22), to[0], to[1], tip);
}

const FILES = {
  // Лист с черешком, наискось: отметка у выбранного пункта в строке.
  "leaf.svg": svg(
    24,
    24,
    `<path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z" stroke-width="0"/><path d="M2.5 21.5 L7 17" fill="none" stroke-width="1.6"/>`
  ),
  // Лист стоймя, черешком вниз: растёт из ветки под выбранной вкладкой.
  "leaf-up.svg": svg(
    16,
    22,
    `<path d="M8 21.2 V15.5" fill="none" stroke-width="1.5"/><path d="M8 17 C2.2 13.4 2.2 6.2 8 1 C13.8 6.2 13.8 13.4 8 17 Z" stroke-width="0"/>`
  ),
  // Ветка с листьями. Концы стебля на одной высоте и под одним углом,
  // поэтому повтор по горизонтали (repeat-x) не даёт шва.
  "branch.svg": svg(
    160,
    18,
    `<path d="M0 10 C27 6 53 6 80 10 S133 14 160 10" fill="none" stroke-width="1.4"/>` +
      placed(leaf(11, 0.3), 34, 7.2, -42) +
      placed(leaf(9, 0.3), 70, 9, 38) +
      placed(leaf(11, 0.3), 112, 12.6, 40) +
      placed(leaf(9, 0.3), 146, 11, -40)
  ),
  // Крупная ветвь папоротника из правого верхнего угла, свисает вниз и влево.
  "fern-top.svg": svg(
    520,
    620,
    frond({ from: [500, -10], ctrl: [470, 330], to: [150, 590], maxL: 120, pairs: 17 })
  ),
  // Ветвь из правого нижнего угла, тянется вверх и влево.
  "fern-bottom.svg": svg(
    460,
    420,
    frond({ from: [470, 430], ctrl: [330, 150], to: [40, 60], maxL: 96, pairs: 15 })
  ),
};

for (const [name, body] of Object.entries(FILES)) {
  writeFileSync(path.join(OUT, name), body);
  console.log(`${name}: ${body.length} байт`);
}
