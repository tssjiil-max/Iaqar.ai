import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhoneContactDisplayName,
  buildPhoneContactVcard,
  phoneContactVcardFilename,
  validatePhoneContactSave
} from "../public/js/phone-contact-save-domain.js";
import { buildOpportunityDetailsCoreHtml } from "../public/js/opportunity-details-ui.js";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";
import { JSDOM } from "jsdom";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("اسم الحفظ مع الاسم الشخصي: أبو أحمد عميل في الوبرة", () => {
  assert.equal(
    buildPhoneContactDisplayName({
      displayName: "أبو أحمد",
      roleLabel: "عميل",
      propertyType: "شقة",
      district: "الوبرة"
    }),
    "أبو أحمد عميل في الوبرة"
  );
});

test("اسم الحفظ بدون اسم شخصي: مالك عمارة في عروة", () => {
  assert.equal(
    buildPhoneContactDisplayName({
      roleLabel: "مالك",
      propertyType: "عمارة",
      district: "عروة"
    }),
    "مالك عمارة في عروة"
  );
});

test("VCF يحفظ الاسم الوصفي مع الرقم", () => {
  const check = validatePhoneContactSave({
    phoneRaw: "0511123456",
    displayName: "أبو أحمد",
    roleLabel: "عميل",
    district: "الوبرة"
  });
  assert.equal(check.ok, true);
  assert.equal(check.displayName, "أبو أحمد عميل في الوبرة");
  const vcard = buildPhoneContactVcard(check);
  assert.match(vcard, /FN;CHARSET=UTF-8:أبو أحمد عميل في الوبرة/);
  assert.match(vcard, /\+966511123456/);
  assert.match(phoneContactVcardFilename(check), /\.vcf$/);
  assert.match(phoneContactVcardFilename(check), /أبو أحمد/);
});

test("لا تُنشأ بطاقة إذا الرقم ناقص", () => {
  assert.equal(validatePhoneContactSave("").ok, false);
  assert.equal(buildPhoneContactVcard("123"), "");
});

test("أيقونة الحفظ تمرّر الاسم والصفة والحي من بيانات الفرصة", () => {
  const ready = buildOpportunityDetailsCoreHtml("opp_phone", {
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    purpose: "RENT",
    city: "المدينة المنورة",
    district: "الوبرة",
    price: 48000,
    area: 120,
    rooms: 3,
    advertiserRole: "CLIENT",
    advertiserDisplayName: "أبو أحمد",
    advertiserPhoneNormalized: "+966511123456"
  });
  assert.ok(ready.html.includes("js-save-phone-contact"));
  assert.ok(ready.html.includes("data-contact-name=\"أبو أحمد\""));
  assert.ok(ready.html.includes("data-contact-role=\"عميل\""));
  assert.ok(ready.html.includes("data-contact-district=\"الوبرة\""));
  assert.ok(ready.html.includes("data-contact-property=\"شقة\""));
  assert.equal(ready.vm.contactSaveDisplayName, "أبو أحمد عميل في الوبرة");

  const ownerOnly = buildOpportunityDetailsCoreHtml("opp_owner", {
    opportunityKind: "OFFER",
    propertyType: "عمارة",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    price: 900000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.equal(ownerOnly.vm.contactSaveDisplayName, "مالك عمارة في عروة");
  assert.ok(ownerOnly.html.includes("data-contact-role=\"مالك\""));
  assert.ok(ownerOnly.html.includes("data-contact-property=\"عمارة\""));
});

test("بطاقة القائمة تحمل أيقونة الحفظ دون تغيير عدد الصفوف", () => {
  const html = buildOpportunityListingCardInnerHtml({
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    purpose: "RENT",
    city: "المدينة المنورة",
    district: "عروة",
    budget: 48000,
    area: 120,
    rooms: 3,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966511123456"
  });
  const dom = new JSDOM(`<div id="root">${html}</div>`);
  assert.ok(html.includes("js-save-phone-contact"));
  assert.equal(dom.window.document.querySelectorAll(".opp-details-row").length, 6);
});

test("الصدفة تحمل أيقونة الحفظ ومسار الواجهة", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("id=\"i-contact-save\""));
  assert.ok(shell.includes("js/phone-contact-save-ui.js"));
  assert.ok(shell.includes(".opp-contact-save-btn"));
});
