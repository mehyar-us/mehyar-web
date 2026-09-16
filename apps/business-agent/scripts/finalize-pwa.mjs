import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const assets = (await readdir(new URL("../dist/assets/", import.meta.url)))
  .filter((name) => /\.(?:js|css)$/.test(name))
  .sort()
  .map((name) => `/assets/${name}`);
const path = new URL("../dist/sw.js", import.meta.url);
const source = await readFile(path, "utf8");
const version = createHash("sha256")
  .update(assets.join("|"))
  .update(source)
  .digest("hex")
  .slice(0, 12);
await writeFile(
  path,
  source
    .replace('"mayor-shell-v1"', JSON.stringify(`mayor-shell-${version}`))
    .replace(
      /const SHELL = \[[\s\S]*?\];/,
      `const SHELL = ${JSON.stringify(["/", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", ...assets])};`,
    ),
);
console.log(
  `PWA: precaching ${assets.length} public bundles, cache ${version}.`,
);
