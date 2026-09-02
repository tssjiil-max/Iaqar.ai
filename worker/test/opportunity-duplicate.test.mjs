import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesDuplicateCriteria,
  findDuplicateOpportunity
} from "../src/opportunity-duplicate.mjs";
import { resolveParsedOpportunityKind } from "../src/opportunity-message-classification.mjs";

test("matchesDuplicateCriteria requires phone plus property context", () => {
  const existing = {
    officeId: "office_a",
    contactPhone: "+966552019909",
    contactType: "buyer",
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    lifecycleStatus: "NEW"
  };
  assert.equal(
    matchesDuplicateCriteria(existing, {
      officeId: "office_a",
      phone: "0552019909",
      contactType: "buyer",
      kind: "client",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "العوالي"
    }),
    true
  );
  assert.equal(
    matchesDuplicateCriteria(existing, {
      officeId: "office_a",
      phone: "0552019909",
      contactType: "buyer",
      kind: "client",
      propertyType: "فيلا",
      city: "المدينة المنورة",
      district: "العوالي"
    }),
    false
  );
});

test("findDuplicateOpportunity returns first active match", () => {
  const hit = findDuplicateOpportunity([
    {
      id: "opp_old",
      data: {
        officeId: "office_a",
        contactPhone: "+966551111111",
        contactType: "buyer",
        opportunityKind: "REQUEST",
        propertyType: "شقة",
        city: "المدينة المنورة",
        district: "العوالي",
        lifecycleStatus: "ARCHIVED"
      }
    },
    {
      id: "opp_active",
      data: {
        officeId: "office_a",
        contactPhone: "+966552019909",
        contactType: "buyer",
        opportunityKind: "REQUEST",
        propertyType: "شقة",
        city: "المدينة المنورة",
        district: "العوالي",
        lifecycleStatus: "NEW"
      }
    }
  ], {
    officeId: "office_a",
    phone: "0552019909",
    contactType: "buyer",
    kind: "client",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي"
  });
  assert.equal(hit?.opportunityId, "opp_active");
});

test("owner rent offer and client lease request are never duplicates", () => {
  const ownerOffer = {
    officeId: "office_a",
    contactPhone: "+966552019909",
    contactType: "owner",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: 30000,
    area: 100,
    lifecycleStatus: "NEW"
  };
  assert.equal(matchesDuplicateCriteria(ownerOffer, {
    officeId: "office_a",
    phone: "0552019909",
    contactType: "buyer",
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: 30000,
    area: 100
  }), false);
});

test("different price or area stays a separate opportunity", () => {
  const existing = {
    officeId: "office_a",
    contactPhone: "+966552019909",
    contactType: "owner",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    priceOrBudget: 1,
    area: 75,
    lifecycleStatus: "NEW"
  };
  const base = {
    officeId: "office_a",
    phone: "0552019909",
    contactType: "owner",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي"
  };
  assert.equal(matchesDuplicateCriteria(existing, { ...base, priceOrBudget: 2, area: 75 }), false);
  assert.equal(matchesDuplicateCriteria(existing, { ...base, priceOrBudget: 1, area: 80 }), false);
  assert.equal(matchesDuplicateCriteria(existing, { ...base, priceOrBudget: 1, area: 75 }), true);
});

test("incomplete location never auto-merges by phone alone", () => {
  const existing = {
    officeId: "office_a",
    contactPhone: "+966552019909",
    contactType: "owner",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العوالي",
    lifecycleStatus: "NEW"
  };
  assert.equal(matchesDuplicateCriteria(existing, {
    officeId: "office_a",
    phone: "0552019909",
    contactType: "owner",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: ""
  }), false);
});

test("Arabic rent wording distinguishes client from owner", () => {
  assert.equal(resolveParsedOpportunityKind("عميل يبحث عن شقة للاستئجار").kind, "client_request");
  assert.equal(resolveParsedOpportunityKind("مطلوب شقة استئجار").kind, "client_request");
  assert.equal(resolveParsedOpportunityKind("شقة للإيجار من المالك مباشرة").kind, "owner_offer");
  assert.equal(resolveParsedOpportunityKind("عرض شقة للتأجير").kind, "owner_offer");
});
