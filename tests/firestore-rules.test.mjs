/**
 * فحوص ثابتة لقواعد Firestore.
 * هذه ليست اختبارات محاكي: محاكي Firestore غير متاح في هذه البيئة (انظر docs/DECISIONS.md D-005).
 * الغرض منها منع سقوط شرط أمني مطلوب من الملف دون ملاحظة.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./helpers/app-dom.mjs";

const rules = readFileSync(join(repoRoot, "firestore.rules"), "utf8");
const compact = rules.replace(/\s+/g, " ");

test("every office document read still requires office membership", () => {
  assert.match(compact, /match \/offices\/\{officeId\} \{ allow read: if isOfficeMember\(officeId\);/);
  assert.equal(/allow read, write: if true/.test(compact), false);
});

test("office profile updates cannot change ownership or tenant fields", () => {
  assert.match(compact, /allow update: if canManage\(officeId\) && validOfficeProfile\(\) && ownershipPreserved\(officeId\)/);
  assert.match(compact, /request\.resource\.data\.ownerUid == resource\.data\.ownerUid/);
  assert.match(compact, /request\.resource\.data\.officeId == officeId/);
});

test("office name claims cannot be taken over by another office", () => {
  assert.match(compact, /resource\.data\.officeId == request\.resource\.data\.officeId/);
  assert.match(compact, /getAfter\(\/databases\/\$\(database\)\/documents\/offices\/\$\(request\.resource\.data\.officeId\)\)\.data\.officeNameKey == nameKey/);
  assert.equal(/allow create, update: if signedIn\(\) && request\.resource\.data\.officeId is string/.test(compact), false);
});

test("office name claims still enforce the four character minimum for non-admins", () => {
  assert.match(compact, /isPlatformAdmin\(\) \|\| nameKey\.size\(\) >= 4/);
  assert.match(compact, /isPlatformAdmin\(\) \|\| request\.resource\.data\.officeNameKey\.size\(\) >= 4/);
});

test("office settings documents have their own least-privilege rule block", () => {
  assert.match(compact, /match \/officeSettings\/\{settingId\}/);
  assert.match(compact, /settingId == 'notifications' && canManage\(officeId\)/);
  assert.match(compact, /settingId == 'cooperation' && canManage\(officeId\) && validCooperationMode\(request\.resource\.data\.mode\)/);
  assert.match(compact, /settingId == 'broker-' \+ request\.auth\.uid/);
  assert.match(compact, /request\.resource\.data\.brokerId == request\.auth\.uid/);
});

test("cooperation mode is restricted to the three approved values", () => {
  assert.match(compact, /mode in \['disabled', 'approval_required', 'smart_automatic'\]/);
});

test("the generic office wildcard excludes devices and office settings", () => {
  const wildcardMatches = compact.match(/collectionName in \['devices', 'officeSettings'\]/g) || [];
  assert.equal(wildcardMatches.length, 3, "read, create/update and delete must all exclude both collections");
  assert.match(compact, /match \/devices\/\{deviceId\} \{ allow read, write: if false; \}/);
});

test("cross-office writes are impossible: every office write validates officeId", () => {
  assert.match(compact, /allow create, update: if !\(collectionName in \['devices', 'officeSettings'\]\) && isOfficeMember\(officeId\) && request\.resource\.data\.officeId == officeId/);
  assert.match(compact, /match \/officeSettings\/\{settingId\}[^}]*request\.resource\.data\.officeId == officeId/);
});

test("system and integration collections stay closed to clients", () => {
  assert.match(compact, /match \/whatsapp_accounts\/\{phoneNumberId\} \{ allow read, write: if false; \}/);
  assert.match(compact, /match \/_system\/\{document=\*\*\} \{ allow read, write: if false; \}/);
  assert.match(compact, /match \/brokerApplications\/\{applicationId\} \{ allow create: if false;/);
});

test("the public office mirror is readable but only writable by the owning office", () => {
  assert.match(compact, /match \/publicOffices\/\{officeId\} \{ allow read: if true; allow create, update, delete: if canManage\(officeId\);/);
});
