import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const javascriptFiles = [
  "worker/src/index.js",
  "public/js/access-gate.js",
  "public/js/firebase-office.js",
  "public/js/fcm-fid.js",
  "public/js/design-config.js",
  "public/js/office-profile-core.js",
  "public/js/office-settings.js",
  "public/js/whatsapp-office.js",
  "public/js/workflow-office.js",
  "public/js/public-intake.js",
  "public/js/qrcode.js",
  "public/firebase-messaging-sw.js",
  "admin/link-office-phone-login.mjs",
  "admin/setup-platform-admin.mjs",
  "admin/verify-firebase-service-account.mjs"
];

for (const relativePath of javascriptFiles) {
  const path = new URL(relativePath, root);
  const result = spawnSync(process.execPath, ["--check", path.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, `${relativePath}: ${result.stderr || result.stdout}`);
}

const html = await readFile(new URL("public/index.html", root), "utf8");
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\ssrc=/.test(match[0]))
  .map(match => match[1])
  .filter(source => source.trim());
for (const [index, source] of inlineScripts.entries()) {
  new vm.Script(source, { filename: `public/index.html:inline-${index + 1}.js` });
}

const corePosition = html.indexOf('src="js/office-profile-core.js"');
const settingsPosition = html.indexOf('src="js/office-settings.js"');
assert.ok(corePosition >= 0 && settingsPosition > corePosition, "office profile core must load before settings");
assert.match(html, /<html lang="ar" dir="rtl">/);
assert.match(html, /id="officeSettingsBtn"/);
assert.match(html, /id="officeCoverSettingsBtn"/);
assert.match(html, /id="operationList"/);

const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", root), "utf8"));
assert.equal(manifest.lang, "ar");
assert.equal(manifest.dir, "rtl");
assert.equal(manifest.display, "standalone");

const firebaseConfig = JSON.parse(await readFile(new URL("firebase.json", root), "utf8"));
assert.equal(firebaseConfig.hosting.public, "public");
assert.equal(firebaseConfig.firestore.rules, "firestore.rules");

console.log(`Static build verified: ${javascriptFiles.length} JavaScript files, ${inlineScripts.length} inline script, PWA and Firebase config.`);
