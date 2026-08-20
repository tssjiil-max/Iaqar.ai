import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrokerCardReadinessBadge,
  scoreBrokerCardReadiness
} from "../public/js/broker-card-readiness-domain.js";

test("scoreBrokerCardReadiness returns four emoji levels", () => {
  const low = scoreBrokerCardReadiness({ propertyType: "شقة" });
  assert.equal(low.mark, "🔴");
  const high = scoreBrokerCardReadiness({
    propertyType: "شقة",
    purpose: "PURCHASE",
    city: "المدينة المنورة",
    district: "الرانوناء",
    budget: 500000,
    advertiserRole: "OWNER",
    contactPhone: "+966512345678",
    details: "تفاصيل",
    lifecycleStatus: "CONTACTED"
  });
  assert.ok(["🟢", "🟡"].includes(high.mark));
});

test("buildBrokerCardReadinessBadge includes score detail line", () => {
  const badge = buildBrokerCardReadinessBadge({
    propertyType: "شقة",
    city: "المدينة المنورة"
  });
  assert.ok(badge.mark);
  assert.ok(badge.detailLine.includes("%"));
});
