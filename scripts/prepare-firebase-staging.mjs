#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const root = new URL("../public/js/", import.meta.url);
const prod = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
const staging = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
let changed = 0;
for (const name of readdirSync(root).filter(n => n.endsWith(".js"))) {
  const path = new URL(name, root);
  const before = readFileSync(path, "utf8");
  if (!before.includes(prod)) continue;
  const after = before.replaceAll(prod, staging);
  writeFileSync(path, after, "utf8");
  changed++;
}
if (!changed) throw Error("No production Worker reference found; inspect build wiring before deployment");
console.log("Staging Worker references applied to", changed, "public JavaScript files");
