import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPhoneContactVcard,
  phoneContactVcardFilename,
  validatePhoneContactSave
} from "../public/js/phone-contact-save-domain.js";
import { buildOpportunityDetailsCoreHtml } from "../public/js/opportunity-details-ui.js";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";
import { JSDOM } from "jsdom";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("VCF يحفظ الرقم فقط دون اسم عميل أو مالك أو وسيط", () => {
  const check = validatePhoneContactSave("0511123456");
  assert.equal(check.ok, true);
  assert.equal(check.phoneE164, "+966511123456");
  const vcard = buildPhoneContactVcard("0511123456");
  assert.match(vcard, /BEGIN:VCARD/);
  assert.match(vcard, /\+966511123456/);
  assert.match(vcard, /0511123456/);
  assert.doesNotMatch(vcard, /مالك|عميل|وسيط/);
  assert.match(phoneContactVcardFilename("0511123456"), /\.vcf$/);
});

test("لا تُنشأ بطاقة إذا الرقم ناقص", () => {
  assert.equal(validatePhoneContactSave("").ok, false);
  assert.equal(buildPhoneContactVcard("123"), "");
});

test("أيقونة الحفظ تظهر بجانب رقم التواصل المكتمل فقط", () => {
  const ready = buildOpportunityDetailsCoreHtml("opp_phone", {
    opportunityKind: "OFFER",
    propertyType: "شقة",
    purpose: "RENT",
    city: "المدينة المنورة",
    district: "عروة",
    price: 48000,
    area: 120,
    rooms: 3,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966511123456"
  });
  assert.ok(ready.html.includes("js-save-phone-contact"));
  assert.ok(ready.html.includes("#i-contact-save"));
  assert.ok(ready.html.includes("حفظ الرقم في سجل الهاتف"));
  assert.ok(ready.html.includes("data-contact-phone=\"+966511123456\""));
  assert.ok(ready.html.includes("رقم التواصل"));
  assert.ok(ready.html.includes("المعلن وصفته"));

  const missing = buildOpportunityDetailsCoreHtml("opp_nophone", {
    opportunityKind: "OFFER",
    propertyType: "شقة",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "العريض"
  });
  assert.equal(missing.html.includes("js-save-phone-contact"), false);
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
