// ══════════════════════════════════════════════
//  ФАЙЛ КОНФИГА ПРИЛОЖЕНИЯ (config.json в папке профиля)
//
//  Список хранилищ, текущее хранилище, масштаб, язык. Отдельным файлом
//  без единого импорта из electron – чтобы чтение и запись проверялись
//  обычным тестом на Node (tests/config-file.test.js).
//
//  Раньше чтение жило в main.js и на ЛЮБОЙ сбой отвечало пустым
//  объектом: нет файла (первый запуск) и «файл есть, но не прочитался»
//  (обрезан при выключении, занят другой программой) выглядели
//  одинаково. Приложение считало, что хранилищ нет, и первое же
//  сохранение (масштаб, язык, новая папка) записывало эту пустышку
//  поверх – список хранилищ пропадал уже насовсем.
//
//  Теперь нечитаемый файл помечается (broken), а перед первой записью
//  поверх него откладывается в сторону под именем config.broken-<время>.json:
//  данные из него можно достать руками, а не потерять молча.
// ══════════════════════════════════════════════

import { promises as fs } from "node:fs";
import path from "node:path";

// { config, broken }: broken – файл на диске есть, но прочитать или
// разобрать его не удалось. Нет файла – это первый запуск, не поломка.
export async function readConfigFile(file) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    return { config: {}, broken: e.code !== "ENOENT" };
  }
  try {
    const config = JSON.parse(raw);
    if (config && typeof config === "object" && !Array.isArray(config)) {
      return { config, broken: false };
    }
  } catch {
    // ниже – тот же ответ, что и для «разобралось, но не объект»
  }
  return { config: {}, broken: true };
}

// Откладывает нечитаемый файл в сторону. Возвращает новый путь или null,
// если отложить не вышло (тогда запись всё равно идёт – приложение
// должно работать, – но это уже худший случай, а не обычный).
export async function setAsideBrokenConfig(file) {
  const { dir, name, ext } = path.parse(file);
  const target = path.join(dir, `${name}.broken-${Date.now()}${ext}`);
  try {
    await fs.rename(file, target);
    return target;
  } catch {
    return null;
  }
}

export async function writeConfigFile(file, config, { broken = false } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (broken) await setAsideBrokenConfig(file);
  await fs.writeFile(file, JSON.stringify(config, null, 2));
}
