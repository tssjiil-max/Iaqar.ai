import test from "node:test";
import assert from "node:assert/strict";
import {
  SAVE_PHONE_CONTACT_LABEL,
  SAVE_PHONE_CONTACT_OPENED,
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

test("لا يُعاد تركيب الاسم إذا مُرّر الاسم الوصفي بالخطأ", () => {
  const input = {
    phoneRaw: "0511123456",
    roleLabel: "عميل",
    isOwner: false,
    district: "عروة",
    propertyType: "شقة",
    purpose: "RENT"
  };
  const check = validatePhoneContactSave(input);
  assert.equal(check.displayName, "عميل عقاري — عروة");
  const once = buildPhoneContactVcard(input);
  assert.match(once, /FN;CHARSET=UTF-8:عميل عقاري — عروة\r/);
  const twice = buildPhoneContactVcard({ ...input, displayName: check.displayName });
  assert.match(twice, /FN;CHARSET=UTF-8:عميل عقاري — عروة\r/);
  assert.equal(twice.includes("عميل عقاري — عروة — عميل"), false);
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

test("صف التواصل يعرض 05 في سطر LTR بدون زر حفظ", () => {
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
  assert.equal(saveBtn, null);
  assert.equal(phoneEl.textContent, "0511123456");
  assert.equal(phoneEl.getAttribute("dir"), "ltr");
  assert.ok(phoneEl.classList.contains("phone-ltr"));
  assert.ok(ready.html.includes("is-contact-row"));
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
  assert.ok(!ownerOnly.html.includes("js-save-phone-contact"));
  assert.ok(!ownerOnly.html.includes("data-contact-role"));
});

test("زر الحفظ ينشئ vCard واحدة بالاسم والرقم والوصف", async () => {
  const html = `
    <button type="button" class="js-save-phone-contact"
      data-contact-phone="+966552019909"
      data-contact-name="محمد أحمد"
      data-contact-role="مالك"
      data-contact-kind="owner"
      data-contact-property="عمارة"
      data-contact-purpose="SALE"
      data-contact-district="الحرة الغربية"
      data-contact-city="المدينة المنورة">${SAVE_PHONE_CONTACT_LABEL}</button>`;
  const dom = new JSDOM(`<!doctype html><html><body><div id="toast"></div>${html}</body></html>`, {
    url: "https://iaqar-ai-staging--staging-9c4b0k7h.web.app/",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const blobs = [];
  window.URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return "blob:test-vcard";
  };
  window.URL.revokeObjectURL = () => {};
  let downloads = 0;
  const createElement = window.document.createElement.bind(window.document);
  window.document.createElement = (tag) => {
    const node = createElement(tag);
    if (String(tag).toLowerCase() === "a") {
      node.click = () => { downloads += 1; };
    }
    return node;
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });
  Object.defineProperty(globalThis, "URL", { configurable: true, value: window.URL });
  Object.defineProperty(globalThis, "Blob", { configurable: true, value: window.Blob });
  if (window.File) {
    Object.defineProperty(globalThis, "File", { configurable: true, value: window.File });
  }
  const ui = await import(`../public/js/phone-contact-save-ui.js?click=${Date.now()}`);
  ui.bindPhoneContactSave(window.document);
  const button = window.document.querySelector(".js-save-phone-contact");
  assert.ok(button);
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(downloads, 1);
  assert.equal(blobs.length, 1);
  const vcard = buildPhoneContactVcard({
    phoneRaw: button.getAttribute("data-contact-phone"),
    displayName: button.getAttribute("data-contact-name"),
    roleLabel: button.getAttribute("data-contact-role"),
    personKind: button.getAttribute("data-contact-kind"),
    propertyType: button.getAttribute("data-contact-property"),
    purpose: button.getAttribute("data-contact-purpose"),
    district: button.getAttribute("data-contact-district"),
    city: button.getAttribute("data-contact-city")
  });
  assert.match(vcard, /FN;CHARSET=UTF-8:محمد أحمد — مالك/);
  assert.match(vcard, /TEL;TYPE=CELL,VOICE:\+966552019909/);
  assert.match(vcard, /NOTE;CHARSET=UTF-8:مالك عقار — عرض عمارة للبيع — حي الحرة الغربية/);
  assert.equal(vcard.includes("whatsapp"), false);
  assert.equal(vcard.includes("officeId"), false);
  assert.equal(window.document.getElementById("toast").textContent, SAVE_PHONE_CONTACT_OPENED);
});

test("بطاقة القائمة تعرض جدول البيانات بستة صفوف دون زر حفظ", () => {
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
  assert.equal(html.includes("js-save-phone-contact"), false);
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
