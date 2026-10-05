import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "dist/public";
const html = await readFile(`${root}/index.html`, "utf8");
const assets = [
  ...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g),
].map((m) => m[1]);
// Include entry's statically imported JS so first offline reload does not need the network.
const all = new Set(assets);
for (const path of assets.filter((p) => p.endsWith(".js"))) {
  const source = await readFile(`${root}${path}`, "utf8");
  for (const match of source.matchAll(/from["']\.\/([^"']+\.js)["']/g))
    all.add(`/assets/${match[1]}`);
}
let worker = await readFile(`${root}/sw.js`, "utf8");
const version = createHash("sha256")
  .update(html + worker)
  .digest("hex")
  .slice(0, 12);
worker = worker
  .replace("'discovery-dev'", JSON.stringify(version))
  .replace(
    "const PRECACHE = [",
    `const PRECACHE = [${[...all].map((p) => JSON.stringify(p)).join(",")},`,
  );
await writeFile(`${root}/sw.js`, worker);
console.log(
  `Discovery PWA ${version}: ${all.size} entry assets precached; private/transaction paths excluded.`,
);
