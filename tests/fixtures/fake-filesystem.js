// Подставная файловая система телефона — только для проверки перехвата
// запросов в браузере (см. tests/mobile-bridge.test.mjs). В приложение
// не попадает: подставляется на этапе сборки тестового бандла через
// --alias, вместо @capacitor/filesystem.
const files = new Map();
const dirs = new Set();

const missing = (p) => {
  throw new Error(`File does not exist: ${p}`);
};

export const Directory = { Data: "DATA", Cache: "CACHE" };
export const Encoding = { UTF8: "utf8" };

export const Filesystem = {
  async mkdir({ path }) {
    dirs.add(path);
  },
  async readFile({ path }) {
    if (!files.has(path)) missing(path);
    return { data: files.get(path) };
  },
  async writeFile({ path, data }) {
    files.set(path, data);
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) dirs.add(dir);
  },
  async deleteFile({ path }) {
    files.delete(path);
  },
  async rmdir({ path }) {
    const prefix = path.endsWith("/") ? path : path + "/";
    for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
    for (const d of [...dirs]) if (d === path || d.startsWith(prefix)) dirs.delete(d);
  },
  async rename({ from, to }) {
    const prefix = from.endsWith("/") ? from : from + "/";
    for (const key of [...files.keys()]) {
      if (key === from) {
        files.set(to, files.get(key));
        files.delete(key);
      } else if (key.startsWith(prefix)) {
        files.set(to + key.slice(from.length), files.get(key));
        files.delete(key);
      }
    }
    for (const d of [...dirs]) {
      if (d === from) {
        dirs.add(to);
        dirs.delete(d);
      } else if (d.startsWith(prefix)) {
        dirs.add(to + d.slice(from.length));
        dirs.delete(d);
      }
    }
  },
  async readdir({ path }) {
    const prefix = path.endsWith("/") ? path : path + "/";
    const seen = new Map();
    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      seen.set(rest.split("/")[0], rest.includes("/") ? "directory" : "file");
    }
    for (const d of dirs) {
      if (!d.startsWith(prefix)) continue;
      const head = d.slice(prefix.length).split("/")[0];
      if (head) seen.set(head, "directory");
    }
    if (!seen.size && !dirs.has(path)) missing(path);
    return { files: [...seen].map(([name, type]) => ({ name, type })) };
  },
  async getUri({ path }) {
    return { uri: "file:///fake/" + path };
  },
};

// Чтобы тест мог заглянуть, что реально легло «на диск».
if (typeof window !== "undefined") window.__fakeFiles = files;
