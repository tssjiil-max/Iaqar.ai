import test from "node:test";
import assert from "node:assert/strict";
import {
  buildListingShareMessage,
  listingOfficeLink,
  whatsAppShareUrl,
  telegramShareUrl
} from "../public/js/listing-share-domain.js";

test("listing share excludes private phone by default", () => {
  const message = buildListingShareMessage({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    priceOrBudget: 900000,
    advertiserPhoneNormalized: "+966512345678"
  }, {
    officeName: "مكتب الاختبار",
    licenseNumber: "123456",
    officeId: "office-test",
    publicSlug: "test"
  });
  assert.match(message, /مكتب الاختبار/);
  assert.doesNotMatch(message, /966512345678/);
  assert.doesNotMatch(message, /صفة المعلن|الغرف|الحمامات/);
  assert.match(message, /شقة للبيع/);
  assert.match(message, /عبر مكتب:\nمكتب الاختبار/);
  assert.match(message, /رابط المكتب:/);
});

test("real office link is reused and registration is omitted when unavailable", () => {
  const profile = { officeName: "مكتب الاختبار", officeId: "office-test", publicSlug: "test", origin: "https://staging.example" };
  const link = listingOfficeLink(profile);
  const message = buildListingShareMessage({ id: "A-1", opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض" }, profile);
  assert.equal(link, "https://staging.example/m/test");
  assert.match(message, /أرض للشراء/);
  assert.match(message, /https:\/\/staging\.example\/m\/test/);
  assert.doesNotMatch(message, /للتعاون والتسجيل/);
});

test("registration link is included only when a real https link exists", () => {
  const base = { officeName: "مكتب", officeId: "office-a", origin: "https://staging.example" };
  assert.doesNotMatch(buildListingShareMessage({}, { ...base, registrationLink: "not-a-link" }), /للتعاون والتسجيل/);
  assert.match(buildListingShareMessage({}, { ...base, registrationLink: "https://join.example/office-a" }), /https:\/\/join\.example\/office-a/);
});

test("bank card has one hidden share menu with working action hooks", async () => {
  const { buildBankInboxCardHtml } = await import("../public/js/bank-inbox-card-ui.js");
  const html = buildBankInboxCardHtml({
    id: "opp-1", opportunityKind: "OFFER", purpose: "SALE", propertyType: "شقة",
    city: "المدينة المنورة", district: "العزيزية", priceOrBudget: 850000, area: 180,
    advertiserRole: "OWNER", advertiserPhoneNormalized: "+966500000000", sourceType: "whatsapp"
  });
  assert.equal((html.match(/data-cv2-inbox-item/g) || []).length, 1);
  assert.match(html, /bank-card-compact-meta[\s\S]*180[\s\S]*من واتساب/);
  assert.match(html, /data-bank-share-menu="opp-1" hidden/);
  for (const action of ["whatsapp", "telegram", "copy_text", "copy_link", "native"]) {
    assert.match(html, new RegExp(`data-bank-share-action="${action}"`));
  }
});

test("share URLs encode message text", () => {
  const url = whatsAppShareUrl("مرحبا");
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(telegramShareUrl("test").includes("t.me/share"), true);
});
