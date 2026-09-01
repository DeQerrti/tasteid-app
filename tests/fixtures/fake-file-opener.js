// Подставной «открыватель файлов» — только для проверки в браузере
// (см. tests/browser/mobile-bridge.mjs). Настоящий живёт в
// @capawesome-team/capacitor-file-opener и открывает системный диалог
// «чем открыть», которого в проверке нет и быть не может.
//
// Заглушка нужна не только ради openFile(): этот плагин тоже тянет за
// собой @capacitor/core (см. её же комментарий в fake-app.js про
// initCapacitorGlobal, затирающий window.Capacitor) — без заглушки
// мост опять решил бы, что он не на телефоне, и не поставился бы вовсе.
// Подставляется на этапе сборки тестового бандла через --alias.
export const FileOpener = {
  async openFile(options) {
    if (typeof window !== "undefined") window.__openedFile = options;
  },
};
