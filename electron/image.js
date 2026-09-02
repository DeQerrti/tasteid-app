// ══════════════════════════════════════════════
//  СЖАТИЕ КАРТИНОК – только для настольного приложения
//
//  core/api.js делят настольная версия и телефон, но это НЕ отсюда:
//  sharp – нативный модуль (собранные под платформу бинарники), его
//  нельзя затянуть в мобильный мост (mobile/src/main.js), который
//  esbuild собирает в один файл для WebView, – сборка бы просто
//  упала. Поэтому compressImage передаётся в core/api.js: backupCover()
//  снаружи, как необязательная зависимость (см. createServer() в
//  electron/server.js) – на телефоне вместо неё подставлена своя,
//  через canvas браузера (mobile/src/main.js).
//
//  Загрузка своего файла (add.js/chars-edit.js/favorites-edit.js) уже
//  давно сжимает картинку в браузере тем же способом (canvas → webp,
//  макс. 1200px, качество 0.85) перед отправкой на сервер – тут те же
//  самые числа, только для резервных копий обложек по внешней ссылке,
//  которые качает и сохраняет сам сервер (см. комментарий в
//  core/api.js: backupCover, почему это не может сделать браузер).
// ══════════════════════════════════════════════

import sharp from "sharp";

export async function compressImage(bytes) {
  const out = await sharp(Buffer.from(bytes))
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes: out, ext: "webp" };
}
