/**
 * Patch firebase.json /m/:slug redirect to the given Worker base URL.
 * Used by staging deploy only — committed firebase.json keeps production Worker.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firebasePath = path.join(root, "firebase.json");
const workerBase = String(process.argv[2] || "").replace(/\/+$/, "");

if (!/^https:\/\/[a-z0-9.-]+\.iaqar-ai\.workers\.dev$/i.test(workerBase)) {
  console.error("patch-firebase-office-link-redirect: invalid worker base", workerBase);
  process.exit(1);
}

const config = JSON.parse(readFileSync(firebasePath, "utf8"));
const redirects = config?.hosting?.redirects;
if (!Array.isArray(redirects)) {
  console.error("patch-firebase-office-link-redirect: hosting.redirects missing");
  process.exit(1);
}

const redirect = redirects.find((row) => row?.source === "/m/:slug");
if (!redirect) {
  console.error("patch-firebase-office-link-redirect: /m/:slug redirect missing");
  process.exit(1);
}

redirect.destination = `${workerBase}/m/:slug`;
writeFileSync(firebasePath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`patch-firebase-office-link-redirect: /m/:slug → ${redirect.destination}`);
