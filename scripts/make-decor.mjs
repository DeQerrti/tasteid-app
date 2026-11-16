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

// ── Рисованная тема («скотч и маркер», ноябрь 2026) ──
// Линии «от руки»: каждый штрих чуть дрожит, изогнут и заходит за угол.
// Случайность с постоянным зерном – при повторном запуске рисунки те же.
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const f1 = (n) => n.toFixed(1);
// Один штрих: квадратичная кривая с дрожащими концами и прогибом.
function stroke(r, x1, y1, x2, y2, j, bow) {
  const ax = x1 + (r() - 0.5) * j;
  const ay = y1 + (r() - 0.5) * j;
  const bx = x2 + (r() - 0.5) * j;
  const by = y2 + (r() - 0.5) * j;
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy) || 1;
  const off = (r() - 0.5) * 2 * bow;
  const t = 0.35 + r() * 0.3;
  return `M${f1(ax)} ${f1(ay)}Q${f1(ax + dx * t - (dy / L) * off)} ${f1(ay + dy * t + (dx / L) * off)} ${f1(bx)} ${f1(by)}`;
}
// Прямоугольник, обведённый два раза, со штрихами внахлёст на углах.
function roughRect(r, x, y, w, h, over = 4) {
  let d = "";
  for (let p = 0; p < 2; p++) {
    const o = () => over * (0.2 + r());
    d += stroke(r, x - o(), y, x + w + o(), y, 1.8, 1.5);
    d += stroke(r, x + w, y - o(), x + w, y + h + o(), 1.8, 1.5);
    d += stroke(r, x + w + o(), y + h, x - o(), y + h, 1.8, 1.5);
    d += stroke(r, x, y + h + o(), x, y - o(), 1.8, 1.5);
  }
  return d;
}
// Плавная кривая через точки (Catmull-Rom → кубические Безье).
function smooth(p) {
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p2;
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
function wave(r, w, h, amp, step) {
  const pts = [];
  const ph = r() * 6;
  for (let x = 2; x <= w - 2; x += step) {
    pts.push([x, h / 2 + amp * Math.sin(x / 6 + ph) + (r() - 0.5) * 1.2 + (x / w - 0.5) * 1.5]);
  }
  return smooth(pts);
}
// Мазок маркера: полоса с рваными краями и полоской «сухого» нажима.
function swipe(r, w, h) {
  const top = [];
  const bot = [];
  const tilt = (r() - 0.5) * 4;
  for (let i = 0; i <= 14; i++) {
    const x = 4 + ((w - 8) * i) / 14;
    top.push([x, h * 0.18 + (r() - 0.5) * 4 + tilt * (i / 14)]);
    bot.push([x, h * 0.86 + (r() - 0.5) * 4 + tilt * (i / 14)]);
  }
  const outline = [...top, [w - 1, h * 0.5], ...bot.reverse(), [2 + r() * 3, h * 0.55]];
  return (
    `<path d="${smooth(outline)}Z" stroke-width="0" opacity=".85"/>` +
    `<path d="M8 ${f1(h * 0.42)}L${f1(w - 10)} ${f1(h * 0.46 + tilt)}" fill="none" stroke-width="${f1(h * 0.25)}" opacity=".35"/>`
  );
}
// Полоска скотча с «зубчиками» оторванных концов.
function tape(r, w, h) {
  const left = [];
  const right = [];
  for (let i = 0; i <= 5; i++) left.push([(i % 2 ? 4 : 0) + r() * 2, (h * i) / 5]);
  for (let i = 5; i >= 0; i--) right.push([w - (i % 2 ? 4 : 0) - r() * 2, (h * i) / 5]);
  const pts = [...left, ...right].map(([x, y]) => `${f1(x)} ${f1(y)}`);
  return `<path d="M${pts.join("L")}Z" stroke-width="0"/>`;
}
const lines = (w, h, d, sw, color = "#000") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
const shapes = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none"><g fill="#000" stroke="#000" stroke-linecap="round">${body}</g></svg>\n`;

for (let k = 1; k <= 3; k++) {
  FILES[`doodle-tape-${k}.svg`] = shapes(90, 22, tape(rng(100 + k * 17), 90, 22));
  FILES[`doodle-swipe-${k}.svg`] = shapes(220, 40, swipe(rng(7 + k * 31), 220, 40));
}
// Линии боковой панели (маски): край панели, черта под логотипом, волна.
FILES["doodle-vline.svg"] = lines(
  8,
  600,
  stroke(rng(3), 4, 0, 3, 300, 2, 3) + stroke(rng(4), 3, 300, 5, 600, 2, 3),
  1.5
);
FILES["doodle-hline.svg"] = lines(300, 8, stroke(rng(5), 2, 4, 298, 3, 2, 2.5), 1.5);
FILES["doodle-wave.svg"] = lines(140, 12, wave(rng(6), 140, 12, 2, 10), 2.2);
// Поле поиска и выпадающий список: у input/select нет ::after, маску на
// них не повесить – эти три рисунка фоном, с цветом --text-dim каждой
// из двух тем прямо в файле.
for (const [skin, color] of [
  ["dark", "#a19e95"],
  ["light", "#7a7266"],
]) {
  FILES[`doodle-box-${skin}.svg`] = lines(260, 40, roughRect(rng(77), 4, 4, 252, 32), 1.5, color);
  FILES[`doodle-under-${skin}.svg`] = lines(400, 12, wave(rng(78), 400, 12, 1.4, 14), 1.6, color);
  FILES[`doodle-caret-${skin}.svg`] = lines(
    16,
    12,
    stroke(rng(79), 3, 3, 8, 9, 1, 0.5) + stroke(rng(80), 8, 9, 13, 2, 1, 0.5),
    1.8,
    color
  );
}
// Зерно бумаги: серые крапинки с прозрачностью, ложатся на оба фона.
FILES["doodle-grain.svg"] =
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .45 -.2"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>\n`;

// «Любимое»: скотч фоном, а не маской – с цветом прямо в файле. Снимок
// «Сохранить как картинку» (html2canvas) маски не рисует, а фон на
// ::after рисует. Цвет один на обе темы: полупрозрачный беж ложится и
// на тёмный, и на светлый фон.
for (let k = 1; k <= 3; k++) {
  FILES[`doodle-tape-bg-${k}.svg`] = shapes(90, 22, tape(rng(100 + k * 17), 90, 22)).replace(
    'fill="#000" stroke="#000"',
    'fill="rgb(222,206,164)" fill-opacity=".58" stroke="none"'
  );
}
// Рамка от руки для больших блоков (поиск на AniList, блок картинки в
// редакторе): штрих не растягивается вместе с блоком (non-scaling-stroke),
// иначе на широком блоке линии становились бы толстыми и сплюснутыми.
for (const [skin, color] of [
  ["dark", "#a19e95"],
  ["light", "#7a7266"],
]) {
  FILES[`doodle-frame-${skin}.svg`] = lines(
    400,
    120,
    roughRect(rng(9), 4, 4, 392, 112, 6),
    1.5,
    color
  ).replace("/></svg>", ' vector-effect="non-scaling-stroke"/></svg>');
}

for (const [name, body] of Object.entries(FILES)) {
  writeFileSync(path.join(OUT, name), body);
  console.log(`${name}: ${body.length} байт`);
}
