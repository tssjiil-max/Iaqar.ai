/**
 * REQUEST default role + advertiser phone normalization for readiness.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  inferAdvertiserRoleForOpportunity,
  isDirectOwnerSignal,
  mergeAdvertiserFieldsIntoOpportunity,
  validateAdvertiserPhoneLocalInput
} from "../public/js/advertiser-phone-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const REQUEST_BASE = {
  opportunityKind: "REQUEST",
  purpose: "LEASE_REQUEST",
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "الوبرة",
  budget: 16000,
  rooms: 2
};

test("REQUEST with missing explicit role defaults to CLIENT", () => {
  assert.equal(
    inferAdvertiserRoleForOpportunity({ opportunityKind: "REQUEST", explicitRole: "", existing: "" }),
    "CLIENT"
  );
  assert.equal(
    inferAdvertiserRoleForOpportunity({ opportunityKind: "REQUEST", explicitRole: "UNKNOWN", existing: "" }),
    "CLIENT"
  );
});

test("OFFER with directOwner signal and UNKNOWN role infers OWNER", () => {
  assert.equal(
    inferAdvertiserRoleForOpportunity({
      opportunityKind: "OFFER",
      explicitRole: "UNKNOWN",
      existing: "UNKNOWN",
      directOwner: true
    }),
    "OWNER"
  );
  assert.equal(
    inferAdvertiserRoleForOpportunity({
      opportunityKind: "OFFER",
      explicitRole: "",
      existing: "",
      sourceText: "عرض للإيجار مالك مباشر السعر 15000 ريال"
    }),
    "OWNER"
  );
  const merged = mergeAdvertiserFieldsIntoOpportunity(
    {
      opportunityKind: "OFFER",
      purpose: "RENT",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "الوبرة",
      priceOrBudget: 15000,
      annualRent: 15000,
      rooms: 2,
      sourceText: "عرض للإيجار مالك مباشر السعر 15000 ريال"
    },
    {
      advertiserPhoneLocal: "0551234567",
      advertiserRole: "UNKNOWN"
    }
  );
  assert.equal(merged.advertiserRole, "OWNER");
});

test("OFFER without directOwner signal keeps UNKNOWN role", () => {
  assert.equal(
    inferAdvertiserRoleForOpportunity({
      opportunityKind: "OFFER",
      explicitRole: "UNKNOWN",
      existing: "",
      directOwner: false
    }),
    "UNKNOWN"
  );
  assert.equal(
    inferAdvertiserRoleForOpportunity({
      opportunityKind: "OFFER",
      explicitRole: "",
      existing: "",
      sourceText: "عرض للإيجار شقة حي الوبرة"
    }),
    "UNKNOWN"
  );
  assert.equal(isDirectOwnerSignal({ directOwner: false }), false);
});

test("OFFER preserves explicit valid advertiser role", () => {
  assert.equal(
    inferAdvertiserRoleForOpportunity({
      opportunityKind: "OFFER",
      explicitRole: "BROKER",
      existing: "",
      directOwner: true
    }),
    "BROKER"
  );
  const merged = mergeAdvertiserFieldsIntoOpportunity(
    {
      opportunityKind: "OFFER",
      purpose: "RENT",
      sourceText: "مالك مباشر"
    },
    {
      advertiserRole: "DELEGATE",
      advertiserPhoneLocal: "0551234567"
    }
  );
  assert.equal(merged.advertiserRole, "DELEGATE");
});

test("UNKNOWN must not remain on normal REQUEST when role is determinable", () => {
  const role = inferAdvertiserRoleForOpportunity({
    opportunityKind: "REQUEST",
    explicitRole: "UNKNOWN",
    existing: "UNKNOWN"
  });
  assert.equal(role, "CLIENT");
  assert.notEqual(role, "UNKNOWN");
});

test("05 phone format normalizes to canonical E.164", () => {
  const check = validateAdvertiserPhoneLocalInput("0551234567");
  assert.equal(check.ok, true);
  assert.equal(check.e164, "+966551234567");
});

test("5 phone format normalizes to canonical E.164", () => {
  const check = validateAdvertiserPhoneLocalInput("551234567");
  assert.equal(check.ok, true);
  assert.equal(check.e164, "+966551234567");
});

test("+966 phone format normalizes to canonical E.164", () => {
  const check = validateAdvertiserPhoneLocalInput("+966551234567");
  assert.equal(check.ok, true);
  assert.equal(check.e164, "+966551234567");
});

test("invalid phone fails closed", () => {
  const check = validateAdvertiserPhoneLocalInput("12345");
  assert.equal(check.ok, false);
  assert.equal(check.e164, "");
});

test("merge populates normalized phone and readiness sees phone as PRESENT", () => {
  const merged = mergeAdvertiserFieldsIntoOpportunity(REQUEST_BASE, {
    advertiserPhoneLocal: "0551234567",
    advertiserRole: "UNKNOWN"
  });
  assert.equal(merged.advertiserPhoneNormalized, "+966551234567");
  assert.equal(merged.contactPhone, "+966551234567");
  assert.equal(merged.advertiserRole, "CLIENT");
  const readiness = evaluateMatchingReadiness(merged);
  assert.ok(!readiness.matchingReadinessMissing.includes("contactPhone"));
  assert.ok(!readiness.matchingReadinessMissing.includes("advertiserRole"));
});

test("readiness role and phone satisfied for complete REQUEST", () => {
  const merged = mergeAdvertiserFieldsIntoOpportunity(REQUEST_BASE, {
    advertiserPhoneLocal: "551234567"
  });
  assert.equal(merged.matchingReadiness, "READY_FOR_MATCHING");
  assert.deepEqual(merged.matchingReadinessMissing, []);
});
