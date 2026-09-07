import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCompletionSessionSubmission,
  buildCompletionPublicView,
  mintCompletionSession,
  verifyCompletionSessionToken
} from "../src/data-completion-service.js";

const opportunity = {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "فيلا",
  city: "المدينة المنورة",
  district: "العوالي",
  priceOrBudget: 1500000,
  advertiserRole: "OWNER"
};

test("minted completion session stores only token hash and an opaque session id", async () => {
  const minted = await mintCompletionSession({
    officeId: "office-1",
    opportunityId: "opp-secret-123",
    opportunity,
    now: new Date("2026-09-07T05:00:00.000Z")
  });

  assert.equal(minted.ok, true);
  assert.match(minted.sessionId, /^cmp_[A-Za-z0-9_-]+$/);
  assert.equal(minted.sessionId.includes("opp-secret-123"), false);
  assert.equal("token" in minted.record, false);
  assert.ok(minted.record.tokenHash.length >= 64);
  assert.deepEqual(minted.record.allowedFields, ["contactPhone"]);
});

test("completion token verification accepts the minted token and rejects another", async () => {
  const minted = await mintCompletionSession({
    officeId: "office-1",
    opportunityId: "opp-1",
    opportunity,
    now: new Date("2026-09-07T05:00:00.000Z")
  });

  assert.deepEqual(
    await verifyCompletionSessionToken(minted.record, minted.token, new Date("2026-09-07T06:00:00.000Z")),
    { ok: true }
  );
  assert.equal(
    (await verifyCompletionSessionToken(minted.record, "wrong-token", new Date("2026-09-07T06:00:00.000Z"))).ok,
    false
  );
});

test("public completion view does not expose raw internal ids or token hash", async () => {
  const minted = await mintCompletionSession({
    officeId: "office-1",
    opportunityId: "opp-1",
    opportunity,
    now: new Date("2026-09-07T05:00:00.000Z")
  });
  const view = buildCompletionPublicView({
    session: minted.record,
    opportunity,
    office: { name: "سلطان العقاري", brokerName: "سلطان", licenseNumber: "123456" }
  });

  const text = JSON.stringify(view);
  assert.equal(text.includes("opp-1"), false);
  assert.equal(text.includes(minted.record.tokenHash), false);
  assert.equal(view.office.name, "سلطان العقاري");
  assert.deepEqual(view.session.allowedFields, ["contactPhone"]);
});

test("submission patches only session-approved fields and closes when complete", async () => {
  const minted = await mintCompletionSession({
    officeId: "office-1",
    opportunityId: "opp-1",
    opportunity,
    now: new Date("2026-09-07T05:00:00.000Z")
  });

  const result = applyCompletionSessionSubmission({
    session: minted.record,
    opportunity,
    patch: {
      contactPhone: "+966500000010",
      officeId: "attacker-office",
      district: "غير مسموح"
    },
    now: new Date("2026-09-07T06:00:00.000Z")
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { contactPhone: "+966500000010" });
  assert.equal(result.isComplete, true);
  assert.equal(result.isReadyForMatching, true);
  assert.equal(result.session.status, "COMPLETED");
});
