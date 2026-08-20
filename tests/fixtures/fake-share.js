// Подставное «поделиться» — только для проверки в браузере
// (см. tests/browser/mobile-bridge.mjs). Настоящее открывает системное
// окно выбора приложения, которого в проверке нет и быть не может.
// Подставляется на этапе сборки тестового бандла через --alias.
export const Share = {
  async share(options) {
    if (typeof window !== "undefined") window.__shared = options;
    return { activityType: "fake" };
  },
};
