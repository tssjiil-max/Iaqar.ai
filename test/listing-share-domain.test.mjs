import test from "node:test";
import assert from "node:assert/strict";
import {
  buildListingShareMessage,
  whatsAppShareUrl,
  telegramShareUrl
} from "../public/js/listing-share-domain.js";

test("listing share excludes private phone by default", () => {
  const message = buildListingShareMessage({
    opportunityKind: "OFFER",
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
});

test("share URLs encode message text", () => {
  const url = whatsAppShareUrl("مرحبا");
  assert.match(url, /^https:\/\/wa\.me\/\?text=/);
  assert.equal(telegramShareUrl("test").includes("t.me/share"), true);
});
