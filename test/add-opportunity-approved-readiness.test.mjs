import test from "node:test";
import assert from "node:assert/strict";
import { loadShell } from "./helpers/shell.mjs";

let instance = 0;

async function loadController() {
  const user = { uid: "broker-a", getIdToken: async () => "token" };
  const firebase = {
    auth: () => ({ currentUser: user }),
    firestore: () => null
  };
  const context = await loadShell({
    bootSettingsModule: false,
    firebase,
    officeRuntime: { officeId: "office-a", city: "المدينة المنورة" }
  });
  context.window.IAQAR.resolveWorkerBase = () => "https://staging-worker.example.test";
  const specifier = new URL("../public/js/add-opportunity.js", import.meta.url);
  specifier.searchParams.set("approvedReadinessTest", String(++instance));
  const module = await import(specifier.href);
  return { context, module };
}

test("approved advertiser role recomputes and persists READY_FOR_MATCHING on the reviewed opportunity", async () => {
  const { context, module } = await loadController();
  try {
    assert.equal(typeof module.__test.buildApprovedAdvertiserReviewPatch, "function");
    const patch = module.__test.buildApprovedAdvertiserReviewPatch({
      opportunityKind: "REQUEST",
      purpose: "PURCHASE",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "العزيزية",
      budget: 650000,
      priceOrBudget: 650000,
      advertiserRole: "UNKNOWN",
      contactPhone: "+966501234567"
    }, {
      advertiserRole: "CLIENT",
      advertiserPhoneNormalized: "+966501234567",
      advertiserContactStatus: "NOT_CONTACTED",
      marketingConsentStatus: "NOT_STARTED"
    });

    assert.equal(patch.advertiserRole, "CLIENT");
    assert.equal(patch.matchingReadiness, "READY_FOR_MATCHING");
    assert.deepEqual(patch.matchingReadinessMissing, []);
    assert.equal(patch.contactPhone, "+966501234567");
    assert.equal("propertyType" in patch, false, "review meta must not duplicate the whole opportunity");
  } finally {
    context.close();
  }
});
