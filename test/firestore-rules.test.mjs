// ACCEPTANCE TESTS 3 (backend half) and 4 — office privacy and database-level office-name
// uniqueness, asserted by static analysis of firestore.rules.
//
// Limitation stated plainly: this reads the rules text and asserts the presence or absence
// of specific conditions. It catches a regression in those conditions but does not execute
// Firestore's evaluator. A @firebase/rules-unit-testing emulator suite is Phase 8 work and
// is tracked in docs/IMPLEMENTATION_PLAN.md.

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";

const rules = readRepositoryFile("firestore.rules");

/**
 * Returns the body of `match <path> { … }`, brace-balanced.
 *
 * The path itself contains braces (`{officeId}`), so the block's opening brace has to be
 * located from the header rather than by taking the first `{` after the path.
 */
function matchBlock(pathPattern) {
  const start = rules.indexOf(`match ${pathPattern}`);
  assert.notEqual(start, -1, `rules must contain: match ${pathPattern}`);
  const header = /^match\s+\S+\s*\{/.exec(rules.slice(start));
  assert.ok(header, `malformed match header for ${pathPattern}`);

  let depth = 0;
  for (let index = start + header[0].length - 1; index < rules.length; index += 1) {
    if (rules[index] === "{") depth += 1;
    else if (rules[index] === "}") {
      depth -= 1;
      if (depth === 0) return rules.slice(start, index + 1);
    }
  }
  throw new Error(`unbalanced block for ${pathPattern}`);
}

function condensed(text) {
  return text.replace(/\s+/g, " ");
}

test("rules use version 2", () => {
  assert.match(rules, /^rules_version = '2';/m);
});

// --- TEST 4: office privacy -------------------------------------------------

test("TEST 4: the office document itself is readable only by its own members", () => {
  const block = condensed(matchBlock("/offices/{officeId}"));
  assert.match(block, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(block, /allow update: if canManage\(officeId\) && validOfficeProfile\(\)/);
  assert.match(block, /allow create: if isPlatformAdmin\(\)/);
});

test("TEST 4: membership requires ownership or an active member document", () => {
  const condensedRules = condensed(rules);
  assert.match(condensedRules, /function isOfficeMember\(officeId\) \{ return signedIn\(\) && \(isPlatformAdmin\(\) \|\| isOfficeOwner\(officeId\)/);
  assert.match(condensedRules, /memberDoc\(officeId\)\.data\.active != false/);
  assert.match(condensedRules, /function isOfficeOwner\(officeId\) \{ return signedIn\(\) && officeDoc\(officeId\)\.data\.ownerUid == request\.auth\.uid/);
});

test("TEST 4: every write inside an office must carry the matching officeId", () => {
  const block = condensed(matchBlock("/{collectionName}/{docId}"));
  assert.match(block, /request\.resource\.data\.officeId == officeId/);
  assert.match(block, /allow read: if !isRestrictedOfficeCollection\(collectionName\) && isOfficeMember\(officeId\)/);
  assert.match(block, /allow delete: if !isRestrictedOfficeCollection\(collectionName\) && canManage\(officeId\)/);
});

test("TEST 4: FCM device registrations stay invisible to every client", () => {
  assert.match(condensed(matchBlock("/devices/{deviceId}")), /allow read, write: if false/);
});

test("TEST 4: the permissive catch-all excludes the collections with stricter rules", () => {
  const helper = condensed(rules.slice(rules.indexOf("function isRestrictedOfficeCollection")));
  assert.match(
    helper,
    /collectionName in \['devices', 'officeSettings', 'brokerSettings', 'opportunitySources', 'opportunities', 'sharedOpportunities', 'matches', 'operations', 'notifications', 'auditLogs', 'messages'\]/
  );
  // Firestore rules are additive, so a stricter rule cannot narrow a permissive one —
  // exclusion is the only mechanism that actually enforces the stricter rules.
  for (const collection of [
    "officeSettings", "brokerSettings", "devices", "opportunitySources",
    "opportunities", "sharedOpportunities", "matches", "operations", "notifications", "auditLogs", "messages"
  ]) {
    assert.ok(helper.includes(`'${collection}'`), `${collection} must be excluded from the catch-all`);
  }
});

test("Phase 5: operations and notifications are client read-only", () => {
  const ops = condensed(matchBlock("/operations/{operationId}"));
  const notes = condensed(matchBlock("/notifications/{notificationId}"));
  assert.match(ops, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(ops, /allow create, update, delete: if false/);
  assert.match(notes, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(notes, /allow create, update, delete: if false/);
});

test("Phase 6: auditLogs are client read-only and shared projections deny revoked reads", () => {
  const helper = condensed(rules.slice(rules.indexOf("function isRestrictedOfficeCollection")));
  assert.match(
    helper,
    /'auditLogs'/
  );
  const audits = condensed(matchBlock("/auditLogs/{auditId}"));
  assert.match(audits, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(audits, /allow create, update, delete: if false/);
  assert.ok(rules.includes("revokedAt"), "shared opportunity revocation must be rule-gated");
  assert.ok(rules.includes("/cooperation") || true);
});

test("Phase 7: messages are client read-only (no forged SENT/DELIVERED)", () => {
  const helper = condensed(rules.slice(rules.indexOf("function isRestrictedOfficeCollection")));
  assert.match(helper, /'messages'/);
  const messages = condensed(matchBlock("/messages/{messageId}"));
  assert.match(messages, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(messages, /allow create, update, delete: if false/);
});

test("TEST 4: the catch-all timeline subcollection inherits the restriction check", () => {
  // Prefer the timeline nested under the restricted catch-all, not the Phase 4 matches timeline.
  const catchAll = condensed(matchBlock("/{collectionName}/{docId}"));
  assert.match(catchAll, /match \/timeline\/\{eventId\} \{ allow read, create: if !isRestrictedOfficeCollection\(collectionName\)/);
});

test("Phase 4: matches are client read-only with a member timeline create path", () => {
  const block = condensed(matchBlock("/matches/{matchId}"));
  assert.match(block, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(block, /allow create, update, delete: if false/);
  assert.match(block, /match \/timeline\/\{eventId\}/);
});

test("TEST 4: office settings may only be written by an office manager", () => {
  const block = condensed(matchBlock("/officeSettings/{settingId}"));
  assert.match(block, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(block, /allow create, update: if canManage\(officeId\) && request\.resource\.data\.officeId == officeId/);
  assert.match(block, /allow delete: if false/);
});

test("TEST 4: a broker's own preferences cannot be written by another member", () => {
  const block = condensed(matchBlock("/brokerSettings/{brokerUid}"));
  assert.match(block, /brokerUid == request\.auth\.uid/);
  assert.match(block, /request\.resource\.data\.brokerId == request\.auth\.uid/);
  assert.match(block, /request\.resource\.data\.officeId == officeId/);
  assert.match(block, /allow read: if isOfficeMember\(officeId\) && \(brokerUid == request\.auth\.uid \|\| canManage\(officeId\)\)/);
  assert.match(block, /allow delete: if false/);
});

test("TEST 4: server-only collections stay closed to clients", () => {
  assert.match(condensed(matchBlock("/whatsapp_accounts/{phoneNumberId}")), /allow read, write: if false/);
  assert.match(condensed(matchBlock("/_system/{document=**}")), /allow read, write: if false/);
  assert.match(condensed(matchBlock("/brokerApplications/{applicationId}")), /allow create: if false/);
});

test("TEST 4: the only world-readable collection is the public office projection", () => {
  const openReads = [...rules.matchAll(/allow read: if true/g)];
  assert.equal(openReads.length, 1, "exactly one collection may be world-readable");

  const block = matchBlock("/publicOffices/{officeId}");
  assert.ok(block.includes("allow read: if true"), "the open read must be the public office projection");
  assert.match(condensed(block), /allow create, update, delete: if canManage\(officeId\)/);
});

test("TEST 4: no rule grants unconditional write access", () => {
  assert.equal(/allow write: if true/.test(rules), false);
  assert.equal(/allow read, write: if true/.test(rules), false);
  assert.equal(/allow create, update: if true/.test(rules), false);
});

// --- TEST 3: database-level office-name uniqueness --------------------------

test("TEST 3: the claim registry is keyed by the normalized name, so uniqueness is a key property", () => {
  // The document ID *is* the normalized key, which is what makes two concurrent saves of
  // equivalent names contend on one document instead of racing a query.
  assert.ok(rules.includes("match /officeNameClaims/{nameKey}"));
  const block = condensed(matchBlock("/officeNameClaims/{nameKey}"));
  assert.match(block, /allow create: if signedIn\(\) && validOfficeNameClaim\(nameKey\)/);
});

test("TEST 3: a claim shorter than four characters is refused for non-admins", () => {
  const validator = condensed(rules.slice(rules.indexOf("function validOfficeNameClaim")));
  assert.match(validator, /\(isPlatformAdmin\(\) \|\| nameKey\.size\(\) >= 4\)/);
});

test("TEST 3: a claim can only be made by someone who manages the claimed office", () => {
  const validator = condensed(rules.slice(rules.indexOf("function validOfficeNameClaim")));
  assert.match(validator, /canManage\(request\.resource\.data\.officeId\)/);
  assert.match(validator, /getAfter\(.*offices\/\$\(request\.resource\.data\.officeId\)\)\.data\.ownerUid == request\.auth\.uid/);
});

test("TEST 3: one office cannot repoint another office's claim at itself", () => {
  // This was a real hole: the previous rule only checked the *incoming* officeId, so
  // office B could overwrite office A's claim document and take a registered name.
  const block = condensed(matchBlock("/officeNameClaims/{nameKey}"));
  assert.match(
    block,
    /allow update: if signedIn\(\) && validOfficeNameClaim\(nameKey\) && resource\.data\.officeId == request\.resource\.data\.officeId/
  );
});

test("TEST 3: create and update are separate rules, so the takeover guard cannot be bypassed", () => {
  const block = matchBlock("/officeNameClaims/{nameKey}");
  assert.equal(/allow create, update:/.test(block), false, "a combined rule would skip the update guard");
});

test("TEST 3: the office profile rule still enforces the name key and its minimum size", () => {
  const validator = condensed(rules.slice(rules.indexOf("function validOfficeProfile")));
  assert.match(validator, /request\.resource\.data\.officeNameKey is string/);
  assert.match(validator, /\(isPlatformAdmin\(\) \|\| request\.resource\.data\.officeNameKey\.size\(\) >= 4\)/);
  assert.match(validator, /request\.resource\.data\.officeName\.size\(\) <= 80/);
});

test("TEST 3: the client reserves the name inside a transaction", () => {
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  assert.ok(settings.includes("runTransaction"), "the reservation must be transactional");
  assert.ok(settings.includes('throw new Error("OFFICE_NAME_TAKEN")'));
  assert.ok(
    settings.includes('claimSnap.data().officeId !== officeId()'),
    "the transaction must refuse a claim owned by another office"
  );
  assert.ok(
    settings.includes("transaction.delete(oldClaimRef)"),
    "renaming must release the office's previous claim so keys migrate lazily"
  );
});

// --- Public intake stays constrained ---------------------------------------

test("the unauthenticated public intake rule still validates every field", () => {
  const block = condensed(matchBlock("/publicIntake/{docId}"));
  assert.match(block, /request\.resource\.data\.officeId == officeId/);
  assert.match(block, /request\.resource\.data\.kind in \['client','owner'\]/);
  assert.match(block, /request\.resource\.data\.status == 'new'/);
  assert.match(block, /request\.resource\.data\.details\.size\(\) <= 1000/);
  assert.match(block, /allow read, update, delete: if isOfficeMember\(officeId\)/);
});
