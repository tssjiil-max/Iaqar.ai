import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchesDuplicateCriteria,
  findDuplicateOpportunity
} from "../src/opportunity-duplicate.mjs";

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
