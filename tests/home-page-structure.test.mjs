import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, indexHtml } from "./helpers/app-dom.mjs";

const publicDir = join(repoRoot, "public");

test("the approved page stays Arabic, RTL and mobile-first", () => {
  assert.match(indexHtml, /<html lang="ar" dir="rtl">/);
  assert.match(indexHtml, /name="viewport" content="width=device-width/);
  assert.match(indexHtml, /width:min\(100%,432px\)/);
});

test("there is no bottom navigation bar in the markup or the styles", () => {
  assert.equal(/<nav[\s>]/.test(indexHtml), false);
  assert.equal(/class="[^"]*\b(bottom-nav|tabbar|nav-bar)\b/.test(indexHtml), false);
  assert.equal(/position:\s*fixed;[^}]*bottom:\s*0/.test(indexHtml), false);
});

test("no separate deals page or deals route was introduced", () => {
  for (const file of ["deals.html", "sofqat.html", "الصفقات.html"]) {
    assert.equal(existsSync(join(publicDir, file)), false, `${file} must not exist`);
  }
  const hosting = JSON.parse(readFileSync(join(repoRoot, "firebase.json"), "utf8"));
  const rewrites = hosting.hosting.rewrites || [];
  assert.equal(rewrites.some(rule => /deal/i.test(rule.source)), false);
});

test("the office card exposes the logo and the cover as the only settings entry points", () => {
  assert.match(indexHtml, /id="officeSettingsBtn"[^>]*aria-label="فتح إعدادات المكتب"/);
  assert.match(indexHtml, /id="officeCoverBtn"[^>]*aria-label="فتح إعدادات المكتب"/);
  assert.equal(/<button[^>]*>\s*إعدادات المكتب\s*<\/button>/.test(indexHtml), false);
  assert.equal(/<span>إعدادات المكتب<\/span>/.test(indexHtml), false);
});

test("Office Settings markup contains every approved section", () => {
  for (const id of [
    "officeIdentityCard",
    "officeProfileForm",
    "officeLinkCard",
    "officeNotificationsCard",
    "opportunityBankCard",
    "officeCooperationCard"
  ]) {
    assert.ok(indexHtml.includes(`id="${id}"`), `${id} must exist`);
  }
  assert.ok(indexHtml.includes("بنك الفرص"));
  assert.ok(indexHtml.includes("السماح بالتعاون الذكي بين الوسطاء"));
});

test("the hidden attribute always wins over the layout styles", () => {
  assert.match(indexHtml, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("no email field is rendered anywhere in the office workspace page", () => {
  assert.equal(/type="email"/.test(indexHtml), false);
  assert.equal(/البريد الإلكتروني/.test(indexHtml), false);
});

test("the shared identity rules load before the settings controller", () => {
  const identityAt = indexHtml.indexOf("js/office-identity.js");
  const settingsAt = indexHtml.indexOf("js/office-settings.js");
  assert.ok(identityAt > -1 && settingsAt > -1);
  assert.ok(identityAt < settingsAt);
});

test("no API key or secret is embedded in client code", () => {
  const clientFiles = [
    "index.html",
    "js/office-identity.js",
    "js/office-settings.js",
    "js/whatsapp-office.js",
    "js/access-gate.js",
    "js/workflow-office.js",
    "js/firebase-office.js"
  ];
  const forbidden = [
    /AIza[0-9A-Za-z_-]{20,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(client_secret|app_secret|service_account)\s*[:=]\s*["'][^"']+["']/i
  ];
  for (const relative of clientFiles) {
    const content = readFileSync(join(publicDir, relative), "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(content), false, `${relative} must not contain secrets (${pattern})`);
    }
  }
});

test("the office identity module has no runtime dependency and works in both environments", () => {
  const source = readFileSync(join(publicDir, "js", "office-identity.js"), "utf8");
  assert.equal(/\brequire\(/.test(source), false);
  assert.equal(/\bimport\s/.test(source), false);
  assert.match(source, /module\.exports/);
  assert.match(source, /root\.IAQAR\.identity/);
});
