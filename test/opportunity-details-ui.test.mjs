import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityDetailsCoreHtml,
  buildOpportunityDetailsViewModel,
  resolveOpportunityDetailsStatus
} from "../public/js/opportunity-details-ui.js";

test("owner offer and client request share unified details layout", () => {
  const owner = buildOpportunityDetailsCoreHtml("opp_owner_1", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    price: 900000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678",
    createdAt: "2026-08-16T10:00:00.000Z"
  });
  const client = buildOpportunityDetailsCoreHtml("opp_client_1", {
    opportunityKind: "REQUEST",
    contactType: "buyer",
    propertyType: "شقة",
    purpose: "RENT",
    city: "الرياض",
    district: "الوبرة",
    budget: 45000,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966598765432",
    createdAt: "2026-08-16T11:00:00.000Z"
  });

  assert.equal(owner.vm.recordKind, "owner_offer");
  assert.equal(client.vm.recordKind, "client_request");
  assert.ok(owner.html.includes("opp-details"));
  assert.ok(client.html.includes("opp-details"));
  assert.ok(owner.html.includes("عرض مالك"));
  assert.ok(client.html.includes("طلب عميل"));
  assert.ok(owner.html.includes("السعر"));
  assert.ok(client.html.includes("الميزانية"));
  assert.ok(!owner.html.includes("listing-field-mark"));
  assert.ok(owner.html.includes("opp-details-row-status is-complete"));
  assert.ok(owner.html.includes("opp-details-row-status is-missing") || owner.html.includes("✕"));
  assert.ok(!owner.html.includes("opp-details-missing-tag"));
  assert.ok(!owner.html.includes("opp-details-title"));
});

test("data table rows show checkmarks for complete and crosses for missing fields", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_partial_rows", {
    opportunityKind: "OFFER",
    propertyType: "فيلا",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة"
  });
  assert.ok(html.includes("opp-details-row-status is-complete"));
  assert.ok(html.includes("opp-details-row-status is-missing"));
  assert.ok(html.includes("✓"));
  assert.ok(html.includes("✕"));
  assert.ok(!html.includes("opp-details-missing-tag"));
});

test("identity header keeps kind on right and status pill with dot", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_header_1258", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE"
  });
  assert.ok(html.includes("opp-details-status-dot"));
  assert.ok(!html.includes("opp-details-title"));
});

test("completion progress reflects actual readiness fields", () => {
  const { vm, html } = buildOpportunityDetailsCoreHtml("opp_partial", {
    opportunityKind: "OFFER",
    propertyType: "فيلا",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة"
  }, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone", "advertiserRole"]
  });

  assert.equal(vm.progress.total, 7);
  assert.equal(vm.progress.completeCount, 4);
  assert.equal(vm.progress.pct, 57);
  assert.ok(html.includes("opp-details-missing-dot"));
  assert.ok(!html.includes("🔴"));
  assert.ok(html.includes("الحي: عروة") || html.includes("حي عروة"));
  assert.ok(html.includes("opp-details-progress-pct"));
  assert.ok(!html.includes("حي حي"));
});

test("ready status label uses existing readiness logic", () => {
  const status = resolveOpportunityDetailsStatus({
    lifecycleStatus: "ACTIVE",
    matchingReadiness: "READY"
  }, { isReadyForMatching: true });
  assert.equal(status.label, "جاهزة للمطابقة");
  assert.equal(status.cssClass, "is-ready");
});

test("matched and archived statuses map to unified badges", () => {
  const matched = resolveOpportunityDetailsStatus({ lifecycleStatus: "MATCHED" }, {});
  const archived = resolveOpportunityDetailsStatus({ lifecycleStatus: "ARCHIVED", archivedAt: "2026-01-01" }, {});
  assert.equal(matched.label, "تمت المطابقة");
  assert.equal(archived.label, "منتهية");
});

test("location row keeps city and district separate", () => {
  const vm = buildOpportunityDetailsViewModel("opp_loc", {
    city: "المدينة المنورة",
    district: "عروة",
    propertyType: "أرض",
    purpose: "SALE"
  });
  assert.equal(vm.locationCity, "المدينة المنورة");
  assert.equal(vm.locationDistrict, "عروة");
});
