import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { officeDisplayName, officeProfilePatch } from '../public/os/domain/office-profile-domain.js';

const shell = fs.readFileSync(new URL('../public/os/views/shell.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../public/os/views/settings.js', import.meta.url), 'utf8');

test('office gear opens the new settings screen instead of legacy.html', () => {
  assert.match(shell, /active===\"repo\"\?\(\)=>go\(\"office\"\):\(\)=>go\(\"settings\"\)/);
  assert.doesNotMatch(shell, /إعدادات المكتب والبطاقة الرقمية والترخيص[\s\S]{0,180}legacyUrl/);
});

test('new settings page exposes office identity in Office OS', () => {
  assert.match(settings, /إعدادات المكتب/);
  assert.match(settings, /input\(\"officeName\"/);
  assert.match(settings, /input\(\"brokerName\"/);
  assert.match(settings, /input\(\"phone\"/);
  assert.match(settings, /input\(\"licenseNumber\"/);
  assert.match(settings, /رابط المكتب/);
  assert.doesNotMatch(settings, /listMembers\(/);
  assert.doesNotMatch(settings, /الوسطاء والإسناد والصلاحيات/);
});

test('office header decorates a raw personal office name without rewriting branded names', () => {
  assert.equal(officeDisplayName({ officeName: 'سلطان', brokerName: 'سلطان الصاعدي' }), 'مكتب سلطان العقاري');
  assert.equal(officeDisplayName({ officeName: 'مكتب الروابي العقاري', brokerName: 'سلطان الصاعدي' }), 'مكتب الروابي العقاري');
  assert.equal(officeDisplayName({ officeName: 'أصول', brokerName: 'سلطان الصاعدي' }), 'أصول');
});

test('office profile patch normalizes editable office identity fields', () => {
  assert.deepEqual(officeProfilePatch({
    officeName: '  مكتب سلطان العقاري  ',
    brokerName: ' سلطان الصاعدي ',
    phone: ' 0500000000 ',
    whatsapp: ' 0500000000 ',
    licenseNumber: ' 12345 ',
    city: ' المدينة المنورة '
  }), {
    officeName: 'مكتب سلطان العقاري',
    brokerName: 'سلطان الصاعدي',
    phone: '0500000000',
    whatsapp: '0500000000',
    licenseNumber: '12345',
    city: 'المدينة المنورة',
    officeNameKey: 'مكتب سلطان العقاري'
  });
});
