import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpportunityDetailsV2ViewModel } from "../public/js/opportunity-details-v2-domain.js";
import { buildFieldEditorV2 } from "../public/js/v2/opportunity-details/editor.js";
import { buildOpportunityDataCardV2 } from "../public/js/v2/opportunity-details/data-card.js";
import { persistOpportunityField } from "../public/js/v2/opportunity-details/data.js";
import {
  buildContactVCard,
  buildDeviceContactPayload,
  contactsWriteApiAvailable,
  saveDeviceContact
} from "../public/js/v2/opportunity-details/save-device-contact.js";

test("contact name uses advertiser and office, or مالك عقار fallback", () => {
  assert.equal(
    buildDeviceContactPayload({
      phone: "0511123456",
      advertiserName: "أحمد محمد",
      officeName: "مكتب عروة العقاري"
    }).name,
    "أحمد محمد - مكتب عروة العقاري"
  );
  assert.equal(
    buildDeviceContactPayload({
      phone: "+966511123456",
      advertiserName: "",
      officeName: "مكتب عروة العقاري"
    }).name,
    "مالك عقار - مكتب عروة العقاري"
  );
});

test("device contact uses normalized E.164 and rejects invalid numbers", () => {
  const ok = buildDeviceContactPayload({ phone: "0511123456", officeName: "مكتب عروة العقاري" });
  assert.equal(ok.ok, true);
  assert.equal(ok.e164, "+966511123456");
  assert.equal(ok.local, "0511123456");
  const bad = buildDeviceContactPayload({ phone: "123", officeName: "مكتب عروة العقاري" });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "invalid_phone");
});

test("vCard contains name and cell number without uploading contacts", () => {
  const payload = buildDeviceContactPayload({
    phone: "0511123456",
    advertiserName: "أحمد محمد",
    officeName: "مكتب عروة العقاري"
  });
  const vcf = buildContactVCard(payload);
  assert.match(vcf, /BEGIN:VCARD/);
  assert.match(vcf, /FN:أحمد محمد - مكتب عروة العقاري/);
  assert.match(vcf, /TEL;TYPE=CELL:\+966511123456/);
  assert.match(vcf, /ORG:مكتب عروة العقاري/);
  assert.equal(vcf.includes("navigator.contacts.select"), false);
});

test("Contact Picker select-only is not treated as a write API", () => {
  assert.equal(contactsWriteApiAvailable({ select() {} }), false);
  assert.equal(contactsWriteApiAvailable({ save() {} }), true);
});

test("Contacts write API success is confirmed and does not fake it", async () => {
  const result = await saveDeviceContact(
    { phone: "0511123456", advertiserName: "أحمد محمد", officeName: "مكتب عروة العقاري" },
    { contacts: { async save() { return { id: "c1" }; } } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.method, "contacts-api");
  assert.equal(result.confirmed, true);
  assert.equal(result.message, "تم حفظ جهة الاتصال");
});

test("vCard fallback reports prepared, never fake saved, when write API is missing", async () => {
  let opened = "";
  const result = await saveDeviceContact(
    { phone: "0511123456", officeName: "مكتب عروة العقاري" },
    {
      contacts: { select() { throw new Error("must not read contacts"); } },
      openVCard(text) {
        opened = text;
        return { ok: true, mode: "download" };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.method, "vcard");
  assert.equal(result.confirmed, false);
  assert.equal(result.message, "تم تجهيز جهة الاتصال للإضافة.");
  assert.match(opened, /TEL;TYPE=CELL:\+966511123456/);
});

test("failed vCard open is not reported as success", async () => {
  const result = await saveDeviceContact(
    { phone: "0511123456", officeName: "مكتب عروة العقاري" },
    { openVCard() { return { ok: false, mode: "none" }; } }
  );
  assert.equal(result.ok, false);
  assert.equal(result.message, "تعذر فتح حفظ جهة الاتصال على هذا الجهاز.");
});

test("contact editor has device-save action separate from opportunity save", () => {
  const contact = buildFieldEditorV2("contactNumber", { contactNumber: "0511123456" });
  assert.match(contact, /حفظ الرقم/);
  assert.match(contact, /حفظ في جهات الاتصال/);
  assert.match(contact, /id="cv2EditorContactSave"/);
  assert.equal(contact.includes("bankUnifiedForm"), false);
  const price = buildFieldEditorV2("price", { priceLabel: "السعر" });
  assert.equal(price.includes("حفظ في جهات الاتصال"), false);
  assert.match(price, />حفظ</);
});

test("existing phone row shows a compact device-contact action", () => {
  const html = buildOpportunityDataCardV2(mapOpportunityDetailsV2ViewModel("ready", {
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    advertiserRole: "OWNER",
    advertiserDisplayName: "أحمد محمد",
    salePrice: 1000,
    area: 1000,
    contactPhone: "0511123456"
  }));
  assert.match(html, /data-cv2-row="contact"/);
  assert.match(html, /data-cv2-save-device-contact/);
  assert.match(html, /0511123456/);
});

test("missing phone row does not show the device-contact action", () => {
  const html = buildOpportunityDataCardV2(mapOpportunityDetailsV2ViewModel("missing", {
    purpose: "SALE",
    propertyType: "أرض",
    matchingReadinessMissing: ["contactPhone"]
  }));
  const contactRow = html.slice(html.indexOf("data-cv2-row=\"contact\""));
  assert.equal(contactRow.includes("data-cv2-save-device-contact"), false);
});

test("device contact helper is not the opportunity persist path", () => {
  assert.equal(typeof persistOpportunityField, "function");
  assert.equal(String(saveDeviceContact).includes("persistOpportunityField"), false);
  assert.equal(String(saveDeviceContact).includes("firestore"), false);
});
