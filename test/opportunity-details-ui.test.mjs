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
  assert.ok(owner.html.includes("opp-details--unified"));
  assert.ok(client.html.includes("opp-details--unified"));
  assert.ok(owner.html.includes("opp-details-data-table"));
  assert.ok(owner.html.includes("بيانات الفرصة"));
  assert.ok(owner.html.includes("السعر"));
  assert.ok(client.html.includes("الميزانية"));
  assert.ok(!owner.html.includes("listing-field-mark"));
  assert.ok(owner.html.includes("opp-details-row-status is-complete"));
  assert.ok(owner.html.includes("opp-details-row-status is-missing") || owner.html.includes("✕"));
  assert.ok(owner.html.includes("opp-details-missing-tag") || owner.html.includes("ناقص"));
  assert.ok(!owner.html.includes("opp-details-identity-card"));
  assert.ok(!owner.html.includes("opp-details-progress-ring"));
  assert.ok(!owner.html.includes("opp-details-title"));
});

test("data table uses clear row icons for each field", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_icons", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    price: 10000,
    area: 165.13,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.ok(html.includes("#i-home"));
  assert.ok(html.includes("#i-map-pin"));
  assert.ok(html.includes("#i-price-tag"));
  assert.ok(html.includes("#i-area"));
  assert.ok(html.includes("#i-user"));
  assert.ok(html.includes("#i-contact-save"));
  assert.equal(html.includes("#i-bell"), false);
  assert.equal(html.includes("#i-user-clock"), false);
  assert.equal(html.includes("#i-target"), false);
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
  assert.ok(html.includes("opp-details-missing-tag"));
  assert.ok(html.includes("ناقص"));
});

test("incomplete opportunities embed complete-missing button inside data table footer", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_partial_btn", {
    opportunityKind: "OFFER",
    propertyType: "فيلا",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة"
  });
  assert.ok(html.includes("opp-details-data-footer"));
  assert.ok(html.includes("oppDetailsRevealFormBtn"));
  assert.ok(html.includes("أكمل البيانات الناقصة"));
});

test("identity header helpers remain available for extended layouts", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_header_1258", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE"
  });
  assert.ok(!html.includes("opp-details-identity-card"));
  assert.ok(!html.includes("opp-details-status-dot"));
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
  assert.ok(!html.includes("opp-details-missing-dot"));
  assert.ok(!html.includes("🔴"));
  assert.ok(html.includes("الحي: عروة") || html.includes("حي عروة"));
  assert.ok(!html.includes("opp-details-progress-pct"));
  assert.ok(!html.includes("opp-details-progress-ring"));
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

test("all bank detail surfaces embed the unified data table", async () => {
  const { buildNeedsCompletionDetailHtml, buildReadyWorkspaceHtml } = await import("../public/js/opportunity-bank-workspace-ui.js");
  const record = {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    price: 900000,
    area: 1000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  };
  const incomplete = buildNeedsCompletionDetailHtml("opp_1258", record, {
    matchingReadinessMissing: ["priceOrBudget"],
    matchingReadiness: "NEEDS_COMPLETION",
    isReadyForMatching: false
  });
  const ready = buildReadyWorkspaceHtml("opp_1258", record, {});
  for (const html of [incomplete, ready]) {
    assert.ok(html.includes("opp-details-data-table"));
    assert.ok(html.includes("بيانات الفرصة"));
    assert.ok(html.includes("opp-details-row-status"));
    assert.ok(html.includes("المعلن وصفته"));
    assert.ok(html.includes("opp-contact-phone-input"));
    assert.ok(html.includes("js-save-phone-contact"));
    assert.ok(html.includes("#i-contact-save"));
    assert.ok(html.includes("حفظ الرقم في الجوال"));
    assert.ok(html.includes("opp-contact-name-input"));
  }
});

test("data table includes owner name field and save-to-phone action", () => {
  const { html, vm } = buildOpportunityDetailsCoreHtml("opp_contact", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    price: 10000,
    advertiserRole: "OWNER",
    advertiserDisplayName: "محمد",
    advertiserPhoneNormalized: "+966555000111"
  });
  assert.equal(vm.advertiserNameLabel, "اسم المالك");
  assert.equal(vm.contactPhoneLocal, "0555000111");
  assert.ok(html.includes("اسم المالك"));
  assert.ok(html.includes('value="محمد"'));
  assert.ok(html.includes("حفظ الرقم في الجوال"));
  assert.ok(html.includes("js-save-phone-contact"));
  assert.ok(html.includes("#i-contact-save"));
  assert.ok(html.includes("opp-details-row--contact-identity"));
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
