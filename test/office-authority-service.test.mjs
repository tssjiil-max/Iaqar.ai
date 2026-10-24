/**
 * B-01 — the server-side authority operations that replace browser writes (D-020):
 *   POST /os/members/access            the office OWNER changes an existing staff member's role (broker/manager)
 *                                      or active flag; audited in offices/{o}/auditLogs.
 *   POST /admin/office/owner-transfer  a PLATFORM ADMIN moves ownership to an active member, atomically;
 *                                      audited in adminAuditLogs.
 * Authority comes from the verified token and the stored office (ownerUid / member doc), never from the body.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2, idTokenFor } from '../scripts/qa/office-os/server.mjs';

const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const MANAGER_A = 'uid-b01-manager-a';
const BROKER_A3 = 'uid-b01-broker-a3';
const ADMIN = 'uid-b01-platform-admin';

test.beforeEach(() => {
  h.store.seed(`offices/${OFFICE_A}`, { ...(h.store.get(`offices/${OFFICE_A}`) || {}), ownerUid: OWNER_A });
  h.store.seed(`offices/${OFFICE_A}/members/${OWNER_A}`, { uid: OWNER_A, role: 'owner', active: true });
  h.store.seed(`offices/${OFFICE_A}/members/${MANAGER_A}`, { uid: MANAGER_A, role: 'manager', active: true });
  h.store.seed(`offices/${OFFICE_A}/members/${BROKER_A2}`, { uid: BROKER_A2, role: 'broker', active: true, displayName: 'نواف الوسيط' });
  h.store.seed(`offices/${OFFICE_A}/members/${BROKER_A3}`, { uid: BROKER_A3, role: 'broker', active: true });
});

async function call(path, uid, body, claims = {}) {
  const headers = { 'content-type': 'application/json' };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid, claims)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
const access = (uid, body) => call('/os/members/access', uid, { officeId: OFFICE_A, ...body });
const transfer = (uid, body, claims) => call('/admin/office/owner-transfer', uid, { officeId: OFFICE_A, ...body }, claims);
const member = (uid) => h.store.get(`offices/${OFFICE_A}/members/${uid}`);
const officeAudit = () => h.store.list(`offices/${OFFICE_A}/auditLogs`).filter((a) => a.action === 'MEMBER_ACCESS_CHANGED');
const adminAudit = () => h.store.list('adminAuditLogs').filter((a) => a.action === 'office_owner_transferred');

// ── /os/members/access ────────────────────────────────────────────────────────────────────────────
test('owner promotes a broker to manager; the change is audited with before/after and the actor', async () => {
  const before = officeAudit().length;
  const r = await access(OWNER_A, { memberUid: BROKER_A3, role: 'manager' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(member(BROKER_A3).role, 'manager');
  assert.equal(member(BROKER_A3).updatedBy, OWNER_A);
  const entries = officeAudit();
  assert.equal(entries.length, before + 1);
  const entry = entries.at(-1);
  assert.equal(entry.actorUid, OWNER_A);
  assert.equal(entry.entityId, BROKER_A3);
  assert.deepEqual(JSON.parse(entry.detailsJson), { before: { role: 'broker', active: true }, after: { role: 'manager', active: true } });
});

test('owner deactivates and reactivates a staff member', async () => {
  assert.equal((await access(OWNER_A, { memberUid: BROKER_A3, active: false })).status, 200);
  assert.equal(member(BROKER_A3).active, false);
  assert.equal((await access(OWNER_A, { memberUid: BROKER_A3, active: true })).status, 200);
  assert.equal(member(BROKER_A3).active, true);
});

test('only the owner: a manager, a broker and another office\'s owner are refused and nothing changes', async () => {
  for (const uid of [MANAGER_A, BROKER_A2, OWNER_B]) {
    const r = await access(uid, { memberUid: BROKER_A3, role: 'manager' });
    assert.equal(r.status, 403, `${uid}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(member(BROKER_A3).role, 'broker');
});

test('no sign-in, no change', async () => {
  const r = await access('', { memberUid: BROKER_A3, role: 'manager' });
  assert.equal(r.status, 401);
  assert.equal(member(BROKER_A3).role, 'broker');
});

test('the owner cannot hand out owner/admin or any unknown role', async () => {
  for (const role of ['owner', 'admin', 'platformAdmin', 'superuser', '']) {
    const r = await access(OWNER_A, { memberUid: BROKER_A3, role });
    assert.equal(r.status, 400, `${role}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(member(BROKER_A3).role, 'broker');
});

test('the owner\'s own membership is out of reach here (ownership moves only through the platform)', async () => {
  const r = await access(OWNER_A, { memberUid: OWNER_A, active: false });
  assert.equal(r.status, 403);
  assert.equal(member(OWNER_A).active, true);
});

test('only existing members: an outsider cannot be added through this route', async () => {
  const r = await access(OWNER_A, { memberUid: 'uid-b01-outsider', role: 'manager' });
  assert.equal(r.status, 404);
  assert.equal(member('uid-b01-outsider'), null);
});

test('a request with nothing to change, or a non-boolean active flag, is rejected', async () => {
  assert.equal((await access(OWNER_A, { memberUid: BROKER_A3 })).status, 400);
  assert.equal((await access(OWNER_A, { memberUid: BROKER_A3, active: 'false' })).status, 400);
  assert.equal(member(BROKER_A3).active, true);
});

test('the body cannot redirect the change to another office: officeId B with office A\'s owner is refused', async () => {
  h.store.seed(`offices/${OFFICE_B}/members/uid-b01-broker-b`, { uid: 'uid-b01-broker-b', role: 'broker', active: true });
  const r = await call('/os/members/access', OWNER_A, { officeId: OFFICE_B, memberUid: 'uid-b01-broker-b', role: 'manager' });
  assert.equal(r.status, 403);
  assert.equal(h.store.get(`offices/${OFFICE_B}/members/uid-b01-broker-b`).role, 'broker');
});

// ── /admin/office/owner-transfer ──────────────────────────────────────────────────────────────────
test('platform admin transfers ownership to an active member, atomically, with an admin audit entry', async () => {
  const before = adminAudit().length;
  const r = await transfer(ADMIN, { newOwnerUid: MANAGER_A, reason: 'طلب المالك الموثّق بخطاب رسمي' }, { platformAdmin: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(h.store.get(`offices/${OFFICE_A}`).ownerUid, MANAGER_A);
  assert.equal(member(MANAGER_A).role, 'owner');
  assert.equal(member(MANAGER_A).active, true);
  assert.equal(member(OWNER_A).role, 'manager', 'the previous owner stays as a manager by default');
  const entries = adminAudit();
  assert.equal(entries.length, before + 1);
  const entry = entries.at(-1);
  assert.equal(entry.performedBy, ADMIN);
  assert.equal(entry.officeId, OFFICE_A);
  assert.equal(JSON.parse(entry.beforeJson).ownerUid, OWNER_A);
  assert.equal(JSON.parse(entry.afterJson).ownerUid, MANAGER_A);
});

test('the previous owner can be left as a broker or deactivated', async () => {
  assert.equal((await transfer(ADMIN, { newOwnerUid: MANAGER_A, reason: 'نقل الملكية بطلب موثّق', previousOwnerRole: 'broker' }, { platformAdmin: true })).status, 200);
  assert.equal(member(OWNER_A).role, 'broker');
  h.store.seed(`offices/${OFFICE_A}`, { ...h.store.get(`offices/${OFFICE_A}`), ownerUid: OWNER_A });
  h.store.seed(`offices/${OFFICE_A}/members/${OWNER_A}`, { uid: OWNER_A, role: 'owner', active: true });
  assert.equal((await transfer(ADMIN, { newOwnerUid: MANAGER_A, reason: 'نقل الملكية بطلب موثّق', previousOwnerRole: 'inactive' }, { platformAdmin: true })).status, 200);
  assert.equal(member(OWNER_A).active, false);
});

test('only a platform admin: the owner, a manager and an unsigned caller are refused', async () => {
  for (const uid of [OWNER_A, MANAGER_A]) {
    assert.equal((await transfer(uid, { newOwnerUid: MANAGER_A, reason: 'محاولة غير مخولة' })).status, 403);
  }
  assert.equal((await transfer('', { newOwnerUid: MANAGER_A, reason: 'محاولة غير مخولة' })).status, 401);
  assert.equal(h.store.get(`offices/${OFFICE_A}`).ownerUid, OWNER_A);
});

test('the new owner must already be an active member of that office', async () => {
  h.store.seed(`offices/${OFFICE_A}/members/uid-b01-inactive`, { uid: 'uid-b01-inactive', role: 'broker', active: false });
  for (const newOwnerUid of ['uid-b01-outsider', 'uid-b01-inactive', OWNER_B]) {
    const r = await transfer(ADMIN, { newOwnerUid, reason: 'نقل الملكية بطلب موثّق' }, { platformAdmin: true });
    assert.equal(r.status, 409, `${newOwnerUid}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(h.store.get(`offices/${OFFICE_A}`).ownerUid, OWNER_A);
});

test('a reason is required, the target must differ, and previousOwnerRole is validated', async () => {
  assert.equal((await transfer(ADMIN, { newOwnerUid: MANAGER_A, reason: '' }, { platformAdmin: true })).status, 400);
  assert.equal((await transfer(ADMIN, { newOwnerUid: OWNER_A, reason: 'نفس المالك الحالي' }, { platformAdmin: true })).status, 409);
  assert.equal((await transfer(ADMIN, { newOwnerUid: MANAGER_A, reason: 'نقل الملكية بطلب موثّق', previousOwnerRole: 'owner' }, { platformAdmin: true })).status, 400);
  assert.equal(h.store.get(`offices/${OFFICE_A}`).ownerUid, OWNER_A);
});

// ── Subscription (existing route) stays platform-only ─────────────────────────────────────────────
test('subscription changes stay platform-admin only (existing audited route)', async () => {
  const r = await call('/admin/office/subscription', OWNER_A, { officeId: OFFICE_A, subscriptionStatus: 'active' });
  assert.equal(r.status, 403);
});
