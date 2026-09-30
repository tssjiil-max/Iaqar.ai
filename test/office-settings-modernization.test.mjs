import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync(new URL('../public/os/views/shell.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../public/os/views/settings.js', import.meta.url), 'utf8');

// Regression: the gear must stay inside the new Office OS; it must never send the
// user to legacy.html for normal office settings.
test('office gear opens the new settings screen instead of legacy.html', () => {
  assert.match(shell, /active===\"repo\"\?\(\)=>go\(\"office\"\):\(\)=>go\(\"settings\"\)/);
  assert.doesNotMatch(shell, /إعدادات المكتب والبطاقة الرقمية والترخيص[\s\S]{0,180}legacyUrl/);
});

// The new settings page is intentionally for a one-person office: office identity,
// contact/licence data, public link and notifications — not broker assignment.
test('new settings page exposes office identity in Office OS', () => {
  assert.match(settings, /إعدادات المكتب/);
  assert.match(settings, /name:\s*\"officeName\"/);
  assert.match(settings, /name:\s*\"brokerName\"/);
  assert.match(settings, /name:\s*\"phone\"/);
  assert.match(settings, /name:\s*\"licenseNumber\"/);
  assert.match(settings, /رابط المكتب/);
  assert.doesNotMatch(settings, /listMembers\(/);
  assert.doesNotMatch(settings, /الوسطاء والإسناد والصلاحيات/);
});

// Header should use one shared office-display helper so a raw personal name such as
// «سلطان» can render as an office identity without changing stored data.
test('office header uses a display-name helper', () => {
  assert.match(shell, /officeDisplayName/);
});
