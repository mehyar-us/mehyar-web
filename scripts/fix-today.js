#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const file = path.resolve(process.argv[2] || "client/src/pages/AdminToday.tsx");
let t = fs.readFileSync(file, "utf8");
// Broken pattern is literal "*** ${token}" (three asterisks then space then ${token})
const re = /authorization: +\*{3,} +\$\{token\}/g;
const n = (t.match(re) || []).length;
t = t.replace(re, 'authorization: "Bearer " + token');
fs.writeFileSync(file, t, "utf8");
console.log(`Fixed ${n} occurrences in ${file}`);
