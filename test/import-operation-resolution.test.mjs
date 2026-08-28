/**
 * resolveImportOperationTypeId — REQUEST rent vs purchase operation resolution.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mapOperationToBrokerFields } from "../public/js/reference-catalog.js";
import {
  buildImportSimplifiedReviewDefaults,
  importSimplifiedReviewValuesToBrokerFields,
  resolveImportOperationTypeId
} from "../public/js/import-advert-review-domain.js";

test("REQUEST + RENT resolves to rent", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "REQUEST", purpose: "RENT" }),
    "rent"
  );
});

test("REQUEST + LEASE_REQUEST resolves to rent", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "REQUEST", purpose: "LEASE_REQUEST" }),
    "rent"
  );
});

test("REQUEST + PURCHASE resolves to purchase", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "REQUEST", purpose: "PURCHASE" }),
    "purchase"
  );
});

test("OFFER + RENT unchanged", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "OFFER", purpose: "RENT" }),
    "rent"
  );
});

test("OFFER + SALE unchanged", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "OFFER", purpose: "SALE" }),
    "sale"
  );
});

test("OFFER + PURCHASE unchanged (defaults to sale)", () => {
  assert.equal(
    resolveImportOperationTypeId({ opportunityKind: "OFFER", purpose: "PURCHASE" }),
    "sale"
  );
});

test("downstream rent REQUEST maps to LEASE_REQUEST never PURCHASE", () => {
  const operationTypeId = resolveImportOperationTypeId({
    opportunityKind: "REQUEST",
    purpose: "RENT"
  });
  const broker = mapOperationToBrokerFields(operationTypeId, "REQUEST");
  assert.equal(broker.purpose, "LEASE_REQUEST");
  assert.equal(broker.opportunityKind, "REQUEST");
  assert.notEqual(broker.purpose, "PURCHASE");
});

test("simplified review defaults preserve rent request semantics through submit mapping", () => {
  const extractionFields = {
    opportunityKind: "REQUEST",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "الوبرة",
    budget: 16000,
    rooms: 2
  };
  const defaults = buildImportSimplifiedReviewDefaults(extractionFields, "طلب إيجار شقة", {});
  assert.equal(defaults.operationTypeId, "rent");
  assert.equal(defaults.purpose, "RENT");

  const broker = importSimplifiedReviewValuesToBrokerFields({
    opportunityKind: "REQUEST",
    purpose: defaults.purpose,
    operationTypeId: defaults.operationTypeId,
    rawCityText: "المدينة المنورة",
    rawNeighborhoodText: "الوبرة",
    rawPropertyTypeText: "شقة",
    budget: "16000",
    rooms: "2",
    extractedSnapshot: {
      opportunityKind: "REQUEST",
      purpose: "RENT"
    }
  });
  assert.equal(broker.purpose, "LEASE_REQUEST");
  assert.notEqual(broker.purpose, "PURCHASE");
  assert.equal(broker.budget, 16000);
});
