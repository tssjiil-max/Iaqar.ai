#!/usr/bin/env node
/**
 * فحص بناء الجملة لكل ملفات JavaScript المنشورة.
 * هذا هو "البناء" في هذا المشروع: لا يوجد مجمّع حزم، والنشر يرفع الملفات كما هي.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  "worker/src/index.js",
  "public/js/access-gate.js",
  "public/js/firebase-office.js",
  "public/js/fcm-fid.js",
  "public/js/office-identity.js",
  "public/js/office-settings.js",
  "public/js/public-intake.js",
  "public/js/qrcode.js",
  "public/js/whatsapp-office.js",
  "public/js/workflow-office.js",
  "public/firebase-messaging-sw.js",
  "admin/link-office-phone-login.mjs",
  "admin/setup-platform-admin.mjs",
  "admin/verify-firebase-service-account.mjs"
];

let failures = 0;
for (const file of files) {
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    console.error(`MISSING ${file}`);
    failures += 1;
    continue;
  }
  try {
    execFileSync(process.execPath, ["--check", absolute], { stdio: "pipe" });
    console.log(`OK      ${file}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL    ${file}`);
    console.error(String(error.stderr || error.message));
  }
}

if (failures) {
  console.error(`\nSyntax check failed for ${failures} file(s).`);
  process.exit(1);
}
console.log(`\nSyntax check passed for ${files.length} file(s).`);
