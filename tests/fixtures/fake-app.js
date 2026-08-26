// Подставное «приложение» — только для проверки в браузере
// (см. tests/browser/mobile-bridge.mjs). Настоящее живёт в
// @capacitor/app и разговаривает с нативной частью.
//
// Заглушка нужна не только ради getInfo/exitApp: @capacitor/app тянет
// за собой @capacitor/core, а тот при загрузке САМ записывает
// window.Capacitor (initCapacitorGlobal) — то есть затирает тот
// Capacitor, который проверка ставит вручную через addInitScript,
// вместе с его isNativePlatform() === true. Мост после этого считал
// себя работающим не на телефоне и не ставился вовсе, а проверка
// падала на первом же запросе. Подставляется на этапе сборки
// тестового бандла через --alias.
export const App = {
  async getInfo() {
    return { id: "ru.tasteid.app", name: "TasteID", version: "0.0.0-test", build: "0" };
  },
  async addListener(event, handler) {
    if (typeof window !== "undefined") {
      window.__appListeners = { ...window.__appListeners, [event]: handler };
    }
    return { remove() {} };
  },
  async exitApp() {
    if (typeof window !== "undefined") window.__appExited = true;
  },
};
