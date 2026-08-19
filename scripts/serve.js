// Запуск того же сервера без Electron.
//
// Нужен по двум причинам. Первая — разработка: страницы и api правятся и
// проверяются в обычном браузере, без пересборки приложения. Вторая
// важнее: так api покрывается тестами, которые бегают в обычном Node, без
// графики и без установленного Electron. Проверять хранилище через окно
// приложения было бы и медленно, и почти невозможно на сервере сборки.
//
//   node scripts/serve.js ./путь-к-хранилищу [порт]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../electron/vault.js";
import { createServer } from "../electron/server.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.join(HERE, "..", "app");

const root = path.resolve(process.argv[2] || "./vault");
const port = Number(process.argv[3]) || 8123;

const vault = new Vault(root);
await vault.ensure();

const server = createServer({ appDir: APP_DIR, getVault: () => vault });
server.listen(port, "127.0.0.1", () => {
  console.log(`TasteID: http://127.0.0.1:${port}`);
  console.log(`хранилище: ${root}`);
});
