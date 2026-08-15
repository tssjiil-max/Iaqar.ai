import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDataCompleteness,
  normalizeContactStatus,
  normalizeOutcomeStatus,
  DATA_COMPLETENESS,
  CONTACT_STATUS,
  OUTCOME_STATUS
} from "../public/js/opportunity-status-domain.js";

test("normalizeDataCompleteness maps readiness to three domains", () => {
  const incomplete = normalizeDataCompleteness({ purpose: "SALE" });
  assert.equal(incomplete, DATA_COMPLETENESS.INCOMPLETE);

  const ready = normalizeDataCompleteness({
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    salePrice: 500000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.equal(ready, DATA_COMPLETENESS.READY_FOR_MATCHING);
});

test("normalizeContactStatus keeps no-response separate from archive", () => {
  assert.equal(
    normalizeContactStatus({ advertiserContactStatus: "NO_RESPONSE" }),
    CONTACT_STATUS.NO_RESPONSE
  );
  assert.equal(
    normalizeOutcomeStatus({ lifecycleStatus: "NEW", advertiserContactStatus: "NO_RESPONSE" }),
    OUTCOME_STATUS.ACTIVE
  );
});

test("normalizeContactStatus maps follow-up scheduling", () => {
  assert.equal(
    normalizeContactStatus({ lifecycleStatus: "FOLLOW_UP", nextFollowUpAt: "2026-08-16T10:00:00.000Z" }),
    CONTACT_STATUS.FOLLOW_UP_SCHEDULED
  );
});
