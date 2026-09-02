import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildOpportunityDetailsCoreHtml,
  buildOpportunityDetailsPageHtml,
  buildOpportunityDetailsViewModel,
  formatDisplayOpportunityId,
  resolveOpportunityDetailsStatus
} from "../public/js/opportunity-details-ui.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.join(root, "..", "public", "index.html"), "utf8");

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
  assert.ok(client.html.includes("طلب شقة للإيجار"));
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
  assert.ok(html.includes("opp-details-progress-top"));
  assert.ok(html.includes("opp-details-missing-badge"));
  assert.ok(html.includes("السعر"));
  assert.ok(html.includes("رقم التواصل"));
  assert.ok(!html.includes("🔴"));
  assert.ok(html.includes("المدينة المنورة - حي عروة"));
  assert.ok(!html.includes("حي حي"));
  assert.ok(!html.includes("الحي: عروة"));
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

test("unified details page has only identity, data table, and completion", () => {
  const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
  const { html } = buildOpportunityDetailsPageHtml("1258", {
    ...referenceRecord
  }, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  }, {
    entries: [
      { time: "10:40 ص", title: "مراجعة البيانات", result: "تم اكتشاف النواقص" }
    ],
    followUp: { at: tomorrow, purpose: "معاينة العقار" }
  });

  assert.ok(html.includes("opp-details-page"));
  assert.ok(html.includes("opp-details-appbar"));
  assert.ok(html.includes("opp-details-menu"));
  assert.ok(html.includes("bankDetailClose"));
  assert.ok(html.includes("تفاصيل الفرصة"));
  assert.ok(html.includes("#1258"));
  assert.ok(html.includes("عرض مالك"));
  assert.ok(html.includes("ناقصة"));
  assert.ok(html.includes("نسبة اكتمال البيانات"));
  assert.ok(html.includes("opp-details-progress-top"));
  assert.ok(html.includes("opp-details-missing-badge"));
  assert.ok(html.includes("بيانات الفرصة"));
  assert.ok(html.includes("استكمال البيانات"));
  const dataIdx = html.indexOf("بيانات الفرصة");
  const completionIdx = html.indexOf("نسبة اكتمال البيانات");
  const buttonIdx = html.indexOf("استكمال البيانات");
  assert.ok(dataIdx > 0 && dataIdx < completionIdx);
  assert.ok(completionIdx < buttonIdx);
  assert.ok(!html.includes("تقرير اليوم"));
  assert.ok(!html.includes("الموعد القادم"));
  assert.ok(!html.includes("معاينة العقار"));
  assert.ok(!html.includes("إجراءات الفرصة"));
  assert.ok(!html.includes("bank-detail-head"));
  assert.ok(!html.includes("class=\"opp-details-title\""));
  assert.equal(formatDisplayOpportunityId("1258"), "1258");
});

test("ready client request page matches the unified three-section layout", () => {
  const { html, vm } = buildOpportunityDetailsPageHtml("8871", {
    opportunityKind: "REQUEST",
    contactType: "buyer",
    propertyType: "شقة",
    purpose: "PURCHASE",
    city: "الرياض",
    district: "الياسمين",
    budget: 800000,
    area: 180,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966598765432",
    createdAt: "2026-08-16T11:00:00.000Z"
  }, { isReadyForMatching: true });

  assert.equal(vm.kindLabel, "طلب عميل");
  assert.equal(vm.status.label, "جاهزة للمطابقة");
  assert.equal(vm.priceLabel, "الميزانية");
  assert.ok(html.includes("طلب عميل"));
  assert.ok(html.includes("جاهزة للمطابقة"));
  assert.ok(html.includes("الميزانية"));
  assert.ok(html.includes("100% مكتملة"));
  assert.ok(html.includes("is-complete"));
  assert.ok(!html.includes("استكمال البيانات"));
  assert.ok(!html.includes("الفرصة جاهزة للمطابقة."));
  assert.ok(!html.includes("تقرير اليوم"));
  assert.ok(!html.includes("الموعد القادم"));
  assert.ok(!html.includes("data-workspace-action="));
});

test("details page order is data table, then completion, then complete button", () => {
  const { html } = buildOpportunityDetailsPageHtml("1258", referenceRecord, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  });
  const dataIdx = html.indexOf('aria-label="بيانات الفرصة"');
  const completionIdx = html.indexOf('aria-label="نسبة اكتمال البيانات"');
  const buttonIdx = html.indexOf("oppDetailsRevealFormBtn");
  assert.ok(dataIdx >= 0 && completionIdx >= 0 && buttonIdx >= 0);
  assert.ok(dataIdx < completionIdx && completionIdx < buttonIdx);
  assert.equal(html.split("opp-details-page").length - 1, 1);
  assert.ok(!html.includes("bank-detail-head"));
  assert.ok(!html.includes("data-workspace-action="));
});

test("opening details hides bank list chrome so the page is the only surface", () => {
  assert.ok(indexHtml.includes("html:has(.opp-details-page) .main-tabs"));
  assert.ok(indexHtml.includes("html:has(.opp-details-page) .sub-tabs"));
  assert.ok(indexHtml.includes(".opportunity-bank-panel > :not(#opportunityBankDetail)"));
  assert.ok(indexHtml.includes("html:has(.opp-details-page) .ops-detail-nav"));
  assert.match(indexHtml, /\.opp-details-page\s*\{[^}]*position:\s*fixed/);
});
