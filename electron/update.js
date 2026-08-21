// ══════════════════════════════════════════════
//  ПРОВЕРКА ОБНОВЛЕНИЙ
//
//  Ничего не качает и не подменяет само приложение — только спрашивает
//  GitHub, какой релиз сейчас последний (опубликованный, не черновик),
//  и если он новее установленной версии, предлагает открыть страницу
//  загрузки в браузере.
//
//  Полноценный автообновлятор (electron-updater) сюда нарочно не
//  заводится: это отдельный npm-пакет, который тянет за собой
//  изменения в package-lock.json, а нынешний рабочий процесс и так
//  публикует релиз черновиком для ручной проверки перед тем, как
//  показывать его людям. «/releases/latest» у GitHub черновики не
//  видит вообще — значит, ровно тот же порядок работает и здесь:
//  обновление предлагается только после того, как черновик
//  опубликован вручную.
// ══════════════════════════════════════════════

import https from "node:https";
import { shell } from "electron";

const REPO = "DeQerrti/tasteid-app";

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { "User-Agent": "TasteID-app", Accept: "application/vnd.github+json" } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on("error", reject);
  });
}

// "0.3.1" новее "0.3.0" — сравнение по числовым частям, без сторонних
// пакетов вроде semver: версии здесь всегда простые x.y.z.
function isNewer(latest, current) {
  const a = latest.replace(/^v/i, "").split(".").map(Number);
  const b = current.replace(/^v/i, "").split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function assetFor(assets, platform, arch) {
  const find = (re) => assets.find((a) => re.test(a.name));
  if (platform === "win32") return find(/\.exe$/i);
  if (platform === "linux") return find(/\.AppImage$/i);
  if (platform === "darwin") {
    return (arch === "arm64" && find(/arm64\.dmg$/i)) || find(/x64\.dmg$/i) || find(/\.dmg$/i);
  }
  return null;
}

// Возвращает { version, downloadUrl } если на GitHub есть версия новее
// текущей, иначе null. Сама ничего не показывает — решение, что делать
// с результатом (диалог, тихий пропуск), остаётся за вызывающим кодом.
export async function findUpdate(currentVersion) {
  const release = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`);
  const tag = release.tag_name || "";
  if (!tag || !isNewer(tag, currentVersion)) return null;
  const asset = assetFor(release.assets || [], process.platform, process.arch);
  return {
    version: tag.replace(/^v/i, ""),
    downloadUrl: asset?.browser_download_url || release.html_url,
  };
}

export function openDownload(update) {
  shell.openExternal(update.downloadUrl);
}
