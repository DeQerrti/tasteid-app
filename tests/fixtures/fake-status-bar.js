// Подставная полоса состояния — только для проверки в браузере
// (см. tests/browser/mobile-bridge.mjs). Настоящая красит системную
// полосу поверх приложения, которой в проверке нет.
// Подставляется на этапе сборки тестового бандла через --alias.
export const Style = { Dark: "DARK", Light: "LIGHT" };

export const StatusBar = {
  async setBackgroundColor({ color }) {
    if (typeof window !== "undefined") window.__statusBar = { ...window.__statusBar, color };
  },
  async setStyle({ style }) {
    if (typeof window !== "undefined") window.__statusBar = { ...window.__statusBar, style };
  },
};
