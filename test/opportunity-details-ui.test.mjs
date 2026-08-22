import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpportunityDetailsCoreHtml,
  buildOpportunityDetailsPageHtml,
  buildOpportunityDetailsViewModel,
  formatDisplayOpportunityId,
  resolveOpportunityDetailsStatus
} from "../public/js/opportunity-details-ui.js";

const referenceRecord = {
  opportunityKind: "OFFER",
  propertyType: "أرض",
  purpose: "SALE",
  city: "المدينة المنورة",
  district: "عروة",
  area: 1000,
  streetWidth: 20,
  facing: "شمالية",
  advertiserRole: "OWNER",
  createdAt: "2025-06-02T07:35:00.000Z"
};

test("owner offer and client request share unified details layout", () => {
  const owner = buildOpportunityDetailsCoreHtml("opp_owner_1", {
    ...referenceRecord,
    advertiserPhoneNormalized: "+966512345678",
    price: 900000
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
  assert.ok(!owner.html.includes("opp-details-row-status"));
  assert.ok(!owner.html.includes("✕"));
});

test("data table shows missing values as ناقص / غير محدد without checkmarks", () => {
  const { html } = buildOpportunityDetailsCoreHtml("opp_partial_rows", {
    opportunityKind: "OFFER",
    propertyType: "فيلا",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة"
  });
  assert.ok(html.includes("ناقص"));
  assert.ok(html.includes("غير محدد"));
  assert.ok(html.includes("is-row-complete"));
  assert.ok(html.includes("is-row-missing"));
  assert.ok(!html.includes("opp-details-row-status"));
  assert.ok(!html.includes("opp-details-missing-tag"));
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
  assert.ok(html.includes("البيانات الناقصة"));
  assert.ok(html.includes("السعر"));
  assert.ok(html.includes("رقم التواصل"));
  assert.ok(!html.includes("🔴"));
  assert.ok(html.includes("الحي: عروة"));
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
  assert.equal(vm.locationPrimary, "المدينة المنورة - حي عروة");
  assert.equal(vm.locationSecondary, "الحي: عروة");
});

test("phase 1 page matches reference structure and drops old chrome", () => {
  const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
  const { html } = buildOpportunityDetailsPageHtml("1258", {
    ...referenceRecord
  }, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  }, {
    entries: [
      { time: "10:40 ص", title: "مراجعة البيانات", result: "تم اكتشاف النواقص" },
      { time: "10:45 ص", title: "متابعة المالك", result: "تم فتح واتساب" },
      { time: "10:52 ص", title: "تحديد موعد", result: "غداً 9:15 ص" },
      { time: "10:58 ص", title: "إرسال الفرصة", result: "أرسلت إلى مكتب الجماوات" }
    ],
    followUp: { at: tomorrow, purpose: "معاينة العقار" }
  });

  assert.ok(html.includes("opp-details-page"));
  assert.ok(html.includes("opp-details-appbar"));
  assert.ok(html.includes("تفاصيل الفرصة"));
  assert.ok(html.includes("#1258"));
  assert.ok(html.includes("عرض مالك"));
  assert.ok(html.includes("ناقصة"));
  assert.ok(html.includes("نسبة اكتمال البيانات"));
  assert.ok(html.includes("بيانات الفرصة"));
  assert.ok(html.includes("أكمل البيانات الناقصة"));
  assert.ok(html.includes("تقرير اليوم"));
  assert.ok(html.includes("الموعد القادم"));
  assert.ok(html.includes("معاينة العقار"));
  assert.ok(!html.includes("إجراءات الفرصة"));
  assert.ok(!html.includes("bank-detail-head"));
  assert.ok(!html.includes("class=\"opp-details-title\""));
  assert.equal(formatDisplayOpportunityId("1258"), "1258");
});
