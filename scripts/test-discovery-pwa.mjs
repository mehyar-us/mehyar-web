import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile, stat } from "node:fs/promises";
const worker = await readFile("dist/public/sw.js", "utf8"),
  handlers = {},
  store = new Map();
let online = true;
const key = (r) => (typeof r === "string" ? r : r.url);
const cache = {
  async addAll(paths) {
    for (const p of paths) {
      await stat(
        "dist/public" +
          (p === "/" ? "/index.html" : p.endsWith("/") ? p + "index.html" : p),
      );
      store.set(p, new Response(p));
    }
  },
  async put(r, v) {
    store.set(key(r), v);
  },
  async match(r) {
    return store.get(key(r))?.clone();
  },
};
const sandbox = {
  URL,
  Response,
  console,
  self: {
    location: { origin: "http://localhost:4175" },
    addEventListener(n, fn) {
      handlers[n] = fn;
    },
    skipWaiting() {},
    clients: { async claim() {} },
  },
  caches: {
    async open() {
      return cache;
    },
    async keys() {
      return ["mehyar-shell-v4-shell", "other-app-cache"];
    },
    async delete(k) {
      assert(k.startsWith("mehyar-shell-"));
    },
  },
  fetch: async () => {
    if (!online) throw new Error("Offline");
    return new Response("network");
  },
};
vm.runInNewContext(worker, sandbox);
let installing;
handlers.install({
  waitUntil(p) {
    installing = p;
  },
});
await installing;
assert(store.size > 6, "Hashed bundles must be precached");
assert([...store.keys()].some((k) => k.endsWith(".js")));
const fetchEvent = async (path, mode = "navigate", method = "GET") => {
  let response;
  handlers.fetch({
    request: { url: "http://localhost:4175" + path, mode, method },
    respondWith(p) {
      response = p;
    },
  });
  return response ? await response : null;
};
for (const path of [
  "/api/explore",
  "/q/client-secret",
  "/proposals/client-secret",
  "/billing/success",
  "/audit/report?token=secret",
  "/unsubscribe?token=secret",
  "/explore?private=value",
  "/admin/center",
])
  assert.equal(await fetchEvent(path), null, path);
assert.equal(await fetchEvent("/explore/", "navigate", "POST"), null);
assert.equal((await fetchEvent("/explore/")).status, 200);
online = false;
assert.equal((await fetchEvent("/explore/")).status, 200);
const fallback = await fetchEvent("/industries/retail");
assert.equal(await fallback.text(), "/offline.html");
assert(
  ![...store.keys()].some((k) => /token|private|client-secret|\/api\//.test(k)),
);
console.log(
  "Passed built precache existence, hashed entry assets, offline shell/deep fallback and private/API/query/transaction cache exclusions. Browser installation/update evidence is separate.",
);
