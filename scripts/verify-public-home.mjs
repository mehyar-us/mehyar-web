import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const live = process.argv.includes("--live");
for (const origin of live ? ["https://mehyar.us", "https://www.mehyar.us"] : [null]) {
  const html = origin ? await (await fetch(origin + "/?release=" + (process.env.GITHUB_SHA || Date.now()), {headers: {"Cache-Control": "no-cache"}})).text() : await readFile("dist/public/index.html", "utf8");
  assert(html.includes("Meet The Mayor."), "Approved Mayor homepage heading missing");
  assert(html.includes("mayor-avatar"), "Mayor avatar missing");
  assert(html.includes("Ask The Mayor free"), "Free Mayor entry missing");
  assert(html.includes("$14") && html.includes("Free"), "Published Mayor plans missing");
  assert(!html.includes("Is your website leaking money?"), "Old audit-first homepage returned");
  assert(html.includes("<main"), "Rendered homepage missing");
  console.log("Verified Mayor homepage:", origin || "build");
}
