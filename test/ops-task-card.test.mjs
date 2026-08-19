import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  buildOpsTaskFieldChecks,
  buildOpsTaskAdSummary,
  buildOpsTaskListingBodyHtml,
  isOpsOpportunityTaskItem
} from "../public/js/ops-task-card-domain.js";
import { primaryActionLabel } from "../public/js/operations-center-domain.js";

test("buildOpsTaskFieldChecks marks missing fields with incomplete state", () => {
  const checks = buildOpsTaskFieldChecks({
    recordType: "opportunity",
    propertyType: "شقة",
    city: "الرياض",
    district: "الورود",
    purpose: "RENT",
    annualRent: 50000,
    advertiserRole: "OWNER",
    contactPhone: "+966501234567"
  });
  assert.equal(checks.every((row) => row.complete), true);
  const partial = buildOpsTaskFieldChecks({
    recordType: "opportunity",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "ابيار علي"
  });
  const phone = partial.find((row) => row.key === "contactPhone");
  assert.equal(phone.complete, false);
});

test("buildOpsTaskAdSummary formats listing headline and specs", () => {
  const ad = buildOpsTaskAdSummary({
    recordType: "owner_offer",
    contactType: "owner",
    propertyType: "دور",
    purpose: "RENT",
    city: "الرياض",
    district: "الورود",
    annualRent: 50000,
    area: 120
  });
  assert.match(ad.headline, /دور/);
  assert.match(ad.location, /الرياض/);
  assert.ok(ad.specs.includes("ريال"));
});

test("buildOpsTaskListingBodyHtml renders check and cross marks", () => {
  const html = buildOpsTaskListingBodyHtml({
    recordType: "opportunity",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "ابيار علي",
    purpose: "SALE"
  });
  assert.ok(html.includes("ops-task-ad-headline"));
  assert.ok(html.includes("ops-task-field-check"));
  assert.ok(html.includes("✗"));
  assert.ok(html.includes("✓") || html.includes("✗"));
});

test("isOpsOpportunityTaskItem detects opportunity rows", () => {
  assert.equal(isOpsOpportunityTaskItem({ recordType: "opportunity" }), true);
  assert.equal(isOpsOpportunityTaskItem({ recordType: "operation" }), false);
});

test("primary action for incomplete opportunities is save", () => {
  assert.equal(primaryActionLabel({
    recordType: "opportunity",
    matchingReadiness: "NEEDS_COMPLETION"
  }), "حفظ الفرصة");
});

test("listing body renders in DOM with accessible field grid", () => {
  const dom = new JSDOM(`<div id="root"></div>`);
  const root = dom.window.document.getElementById("root");
  root.innerHTML = buildOpsTaskListingBodyHtml({
    recordType: "opportunity",
    propertyType: "فيلا",
    city: "جدة",
    district: "السلامة",
    purpose: "SALE",
    salePrice: 1200000,
    advertiserRole: "OWNER",
    contactPhone: "+966501234567"
  });
  assert.ok(root.querySelector(".ops-task-field-check.is-complete"));
  assert.equal(root.querySelectorAll(".ops-task-field-check").length, 7);
});
