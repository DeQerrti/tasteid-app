// Подставной "стержень" Capacitor — только для сборки тестового бандла
// (см. tests/fixtures/mobile-bundle.js). Настоящий @capacitor/core сам
// переписывает window.Capacitor при загрузке (initCapacitorGlobal) —
// тем самым затирая тот, что проверка подставляет вручную через
// addInitScript, вместе с его isNativePlatform() === true. Мост после
// этого считал себя работающим не на телефоне и не ставился вовсе —
// тот же самый механизм уже описан в fake-app.js про @capacitor/app,
// но раньше main.js не импортировал @capacitor/core напрямую — тянул
// его только транзитивно через другие плагины, которые уже подменены.
// InstallPermissionPlugin (android/.../InstallPermissionPlugin.java) —
// первый случай, когда понадобился сам registerPlugin() из ядра.
//
// Методы возвращённого "плагина" ни один браузерный тест не вызывает —
// заглушка нужна только чтобы сборка и загрузка страницы не падали.
export function registerPlugin(name) {
  return new Proxy(
    {},
    {
      get: (target, prop) => {
        return async () => {
          throw new Error(`fake-core: ${name}.${String(prop)}() не реализован в тестах`);
        };
      },
    }
  );
}

// mobile/src/main.js импортирует именованный CapacitorHttp напрямую
// (не через registerPlugin(), как остальные плагины выше) – список
// с MyAnimeList по нику идёт через него в обход CORS. Ни один
// браузерный тест этот путь не дёргает – значит и здесь сама она
// не нужна, только чтобы импорт не падал при сборке тестового бандла.
export const CapacitorHttp = registerPlugin("CapacitorHttp");
