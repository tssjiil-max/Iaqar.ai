import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_PHONE_CONTACT_LABEL,
  buildPhoneContactDisplayName,
  buildPhoneContactNote,
  buildPhoneContactVcard,
  phoneContactVcardFilename,
  validatePhoneContactSave
} from "../public/js/phone-contact-save-domain.js";
import { formatLocalPhoneDisplay } from "../public/js/advertiser-phone-domain.js";
import { buildOpportunityDetailsCoreHtml } from "../public/js/opportunity-details-ui.js";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";
import { JSDOM } from "jsdom";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("اسم الحفظ مع الاسم الشخصي: محمد أحمد — مالك", () => {
  assert.equal(
    buildPhoneContactDisplayName({
      displayName: "محمد أحمد",
      roleLabel: "مالك",
      isOwner: true,
      district: "الحرة الغربية"
    }),
    "محمد أحمد — مالك"
  );
});

test("اسم الحفظ للعميل: أبو أحمد — عميل", () => {
  assert.equal(
    buildPhoneContactDisplayName({
      displayName: "أبو أحمد",
      roleLabel: "عميل",
      isOwner: false,
      district: "الوبرة"
    }),
    "أبو أحمد — عميل"
  );
});

test("بدون اسم شخصي يستخدم وصفًا آمنًا مع الحي", () => {
  assert.equal(
    buildPhoneContactDisplayName({
      roleLabel: "مالك",
      isOwner: true,
      district: "الحرة الغربية"
    }),
    "مالك عقار — الحرة الغربية"
  );
  assert.equal(
    buildPhoneContactDisplayName({
      roleLabel: "عميل",
      isOwner: false,
      district: "العوالي"
    }),
    "عميل عقاري — العوالي"
  );
});

test("NOTE مختصر من صفة ونوع العقار والحي فقط", () => {
  assert.equal(
    buildPhoneContactNote({
      isOwner: true,
      roleLabel: "مالك",
      propertyType: "عمارة",
      purpose: "SALE",
      district: "الحرة الغربية"
    }),
    "مالك عقار — عرض عمارة للبيع — حي الحرة الغربية"
  );
  assert.equal(
    buildPhoneContactNote({
      isOwner: false,
      roleLabel: "عميل",
      propertyType: "شقة",
      purpose: "PURCHASE",
      district: "العوالي"
    }),
    "عميل — طلب شراء شقة — حي العوالي"
  );
});

test("العرض المحلي 05 من +966 و966 دون تغيير القيمة المخزنة", () => {
  assert.equal(formatLocalPhoneDisplay("+966552019909"), "0552019909");
  assert.equal(formatLocalPhoneDisplay("966552019909"), "0552019909");
  assert.equal(formatLocalPhoneDisplay("0552019909"), "0552019909");
});

test("VCF يحفظ الاسم والرقم الدولي وNOTE", () => {
  const payload = {
    phoneRaw: "+966552019909",
    displayName: "محمد أحمد",
    roleLabel: "مالك",
    isOwner: true,
    propertyType: "عمارة",
    purpose: "SALE",
    district: "الحرة الغربية"
  };
  const check = validatePhoneContactSave(payload);
  assert.equal(check.ok, true);
  assert.equal(check.displayName, "محمد أحمد — مالك");
  assert.equal(check.phoneE164, "+966552019909");
  assert.equal(check.phoneLocal, "0552019909");
  const vcard = buildPhoneContactVcard(payload);
  assert.match(vcard, /FN;CHARSET=UTF-8:محمد أحمد — مالك/);
  assert.match(vcard, /TEL;TYPE=CELL,VOICE:\+966552019909/);
  assert.match(vcard, /NOTE;CHARSET=UTF-8:مالك عقار — عرض عمارة للبيع — حي الحرة الغربية/);
  assert.equal(vcard.includes("TEL;TYPE=CELL:0552019909"), false);
  assert.equal(vcard.includes("officeId"), false);
  assert.equal(vcard.includes("opp_"), false);
  assert.equal(vcard.includes("واتساب"), false);
  assert.equal(vcard.includes("900000"), false);
  assert.match(phoneContactVcardFilename(check), /\.vcf$/);
  assert.match(phoneContactVcardFilename(check), /محمد أحمد/);
});

test("الحفظ ممكن بدون اسم شخصي", () => {
  const vcard = buildPhoneContactVcard({
    phoneRaw: "0552019909",
    isOwner: true,
    roleLabel: "مالك",
    propertyType: "عمارة",
    purpose: "SALE",
    district: "الحرة الغربية"
  });
  assert.match(vcard, /FN;CHARSET=UTF-8:مالك عقار — الحرة الغربية/);
  assert.match(vcard, /\+966552019909/);
});

test("لا تُنشأ بطاقة إذا الرقم ناقص", () => {
  assert.equal(validatePhoneContactSave("").ok, false);
  assert.equal(buildPhoneContactVcard("123"), "");
});

test("صف التواصل يعرض 05 في سطر LTR مع زر حفظ نصي", () => {
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
  const readyDom = new JSDOM(`<div id="root">${ready.html}</div>`);
  const phoneEl = readyDom.window.document.querySelector(".opp-contact-phone");
  const saveBtn = readyDom.window.document.querySelector(".js-save-phone-contact");
  assert.ok(phoneEl);
  assert.ok(saveBtn);
  assert.equal(phoneEl.textContent, "0511123456");
  assert.equal(phoneEl.getAttribute("dir"), "ltr");
  assert.ok(phoneEl.classList.contains("phone-ltr"));
  assert.equal(saveBtn.textContent.replace(/\s+/g, " ").trim().includes(SAVE_PHONE_CONTACT_LABEL), true);
  assert.equal(saveBtn.getAttribute("data-contact-phone"), "+966511123456");
  assert.equal(saveBtn.getAttribute("data-contact-name"), "أبو أحمد");
  assert.equal(saveBtn.getAttribute("data-contact-role"), "عميل");
  assert.equal(saveBtn.getAttribute("data-contact-kind"), "client");
  assert.equal(saveBtn.getAttribute("data-contact-district"), "الوبرة");
  assert.equal(ready.vm.contactSaveDisplayName, "أبو أحمد — عميل");
  assert.equal(ready.vm.contactPhoneLocal, "0511123456");
  assert.equal(ready.vm.contactPhone, "+966511123456");

  const fromDigits = buildOpportunityDetailsCoreHtml("opp_966", {
    opportunityKind: "OFFER",
    propertyType: "عمارة",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "الحرة الغربية",
    price: 900000,
    advertiserRole: "OWNER",
    advertiserDisplayName: "محمد أحمد",
    advertiserPhoneNormalized: "966552019909"
  });
  assert.ok(fromDigits.html.includes("0552019909"));
  assert.equal(fromDigits.vm.contactPhoneLocal, "0552019909");
  assert.equal(fromDigits.vm.contactSaveDisplayName, "محمد أحمد — مالك");

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
  assert.equal(ownerOnly.vm.contactSaveDisplayName, "مالك عقار — عروة");
  assert.ok(ownerOnly.html.includes("data-contact-role=\"مالك\""));
  assert.ok(ownerOnly.html.includes("data-contact-kind=\"owner\""));
});

test("بطاقة القائمة تحمل زر الحفظ دون تغيير عدد الصفوف", () => {
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
  assert.ok(html.includes(SAVE_PHONE_CONTACT_LABEL));
  assert.equal(dom.window.document.querySelectorAll(".opp-details-row").length, 6);
});

test("الصدفة تحمل أيقونة الحفظ ومسار الواجهة دون ادعاء تم الحفظ", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("id=\"i-contact-save\""));
  assert.ok(shell.includes("js/phone-contact-save-ui.js"));
  assert.ok(shell.includes(".opp-contact-save-btn"));
  assert.ok(shell.includes(".opp-contact-phone"));
  assert.ok(shell.includes("white-space:nowrap"));
  const ui = readRepositoryFile("public", "js/phone-contact-save-ui.js");
  const domain = readRepositoryFile("public", "js/phone-contact-save-domain.js");
  assert.ok(ui.includes("saveInFlight"));
  assert.ok(ui.includes("SAVE_PHONE_CONTACT_OPENED"));
  assert.ok(domain.includes("تم فتح حفظ جهة الاتصال"));
  assert.ok(domain.includes("جاري تجهيز جهة الاتصال..."));
  assert.equal(ui.includes("تم حفظ «"), false);
  assert.equal(ui.toLowerCase().includes("whatsapp"), false);
});
