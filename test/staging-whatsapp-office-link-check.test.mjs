import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReport } from '../scripts/staging-whatsapp-office-link-check.mjs';

// All fixtures below are synthetic — no real office id, phone number, name or
// customer data. These exercise computeReport() in isolation (pure function,
// no network, no credentials), so they run the same locally and in CI.

const GOOD = {
  officeSlug: 'qa-slug',
  whatsappPhoneNumberId: 'qa-phone-1',
  claim: { officeId: 'qa-office-1' },
  office: { businessName: 'مكتب تجريبي', publicSlug: 'qa-slug' },
  publicOffice: { publicSlug: 'qa-slug' },
  conflictingOwnerIds: ['qa-office-1'], // itself only — not a conflict
  integration: { phoneNumberId: 'qa-phone-1', autoReplyEnabled: true },
  account: { officeId: 'qa-office-1', status: 'connected', platformType: 'CLOUD_API', metaPhoneStatus: 'CONNECTED', isOnBizApp: true }
};

test('happy path: everything matches -> firestoreSideReady is true, no blockers', () => {
  const report = computeReport(GOOD);
  assert.equal(report.officeId, 'qa-office-1');
  assert.equal(report.officeVerified, true);
  assert.equal(report.slugMatches, true);
  assert.equal(report.conflictingOffice, false);
  assert.equal(report.whatsappAccountFound, true);
  assert.equal(report.mappingMatches, true);
  assert.equal(report.agentNumberUsable, true);
  assert.equal(report.autoReplyEnabled, true);
  assert.equal(report.firestoreSideReady, true);
  assert.deepEqual(report.blockers, []);
});

test('negative: officeSlugClaims missing -> no officeId, blocked, not ready', () => {
  const report = computeReport({ ...GOOD, claim: null });
  assert.equal(report.officeId, null);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('officeSlugClaims')));
});

test('negative: phone number is linked to a DIFFERENT office -> mappingMatches false, blocked', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, officeId: 'some-other-office' } });
  assert.equal(report.mappingMatches, false);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('does not match resolved officeId')));
});

test('negative: another office also claims the same public slug -> conflictingOffice true, blocked', () => {
  const report = computeReport({ ...GOOD, conflictingOwnerIds: ['qa-office-1', 'qa-office-2'] });
  assert.equal(report.conflictingOffice, true);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('is also claimed by')));
});

test('negative: autoReplyEnabled is false (office itself has not opted in) -> blocked even if everything else matches', () => {
  const report = computeReport({ ...GOOD, integration: { ...GOOD.integration, autoReplyEnabled: false } });
  assert.equal(report.autoReplyEnabled, false);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('autoReplyEnabled is not true')));
});

test('negative: autoReplyEnabled missing entirely (no integrations/whatsapp doc) -> treated as false, blocked', () => {
  const report = computeReport({ ...GOOD, integration: null });
  assert.equal(report.autoReplyEnabled, false);
  assert.equal(report.firestoreSideReady, false);
});

test('negative: whatsapp_accounts.status is not "connected" (e.g. disconnected) -> blocked', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, status: 'disconnected' } });
  assert.equal(report.metaStatus, 'disconnected');
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('not "connected"')));
});

test('negative: platformType is not CLOUD_API -> agentNumberUsable false (mirrors agentNumber() exactly)', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, platformType: 'ON_PREMISE' } });
  assert.equal(report.agentNumberUsable, false);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('not "CLOUD_API"')));
});

test('negative: metaPhoneStatus is not CONNECTED (e.g. still migrating) -> agentNumberUsable false', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, metaPhoneStatus: 'MIGRATED' } });
  assert.equal(report.agentNumberUsable, false);
  assert.equal(report.firestoreSideReady, false);
});

test('negative: neither isOnBizApp nor isTestNumber is true -> agentNumberUsable false even with CLOUD_API + CONNECTED', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, isOnBizApp: false, isTestNumber: false } });
  assert.equal(report.agentNumberUsable, false);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('neither isOnBizApp nor isTestNumber')));
});

test('positive variant: isTestNumber true (instead of isOnBizApp) still makes the number usable', () => {
  const report = computeReport({ ...GOOD, account: { ...GOOD.account, isOnBizApp: false, isTestNumber: true } });
  assert.equal(report.agentNumberUsable, true);
});

test('negative: whatsapp_accounts/<phoneNumberId> does not exist at all -> whatsappAccountFound false, blocked', () => {
  const report = computeReport({ ...GOOD, account: null });
  assert.equal(report.whatsappAccountFound, false);
  assert.equal(report.mappingMatches, false);
  assert.equal(report.firestoreSideReady, false);
  assert.ok(report.blockers.some((b) => b.includes('does not exist')));
});

test('negative: offices/{officeId} itself does not exist (dangling slug claim) -> officeVerified false, blocked', () => {
  const report = computeReport({ ...GOOD, office: null });
  assert.equal(report.officeVerified, false);
  assert.equal(report.firestoreSideReady, false);
});

test('negative: office.publicSlug does not match the claimed slug -> slugMatches false, blocked', () => {
  const report = computeReport({ ...GOOD, office: { ...GOOD.office, publicSlug: 'a-different-slug' } });
  assert.equal(report.slugMatches, false);
  assert.equal(report.firestoreSideReady, false);
});

test('report never includes a secret-shaped field and blockers stay descriptive strings only', () => {
  const report = computeReport(GOOD);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /BEGIN PRIVATE KEY/);
  assert.doesNotMatch(serialized, /access_token/i);
  for (const b of report.blockers) assert.equal(typeof b, 'string');
});
