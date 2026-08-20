import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  advertiserContactNameLabel,
  buildContactSavePatch,
  buildContactVcard,
  contactSaveFilename,
  resolveContactSaveDisplayName,
  validateContactSavePayload
} from "../public/js/phone-contact-save-domain.js";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";
import {
  readContactSavePayloadFromButton,
  savePhoneContactToDevice
} from "../public/js/phone-contact-save-ui.js";

test("contact name label follows advertiser role", () => {
  assert.equal(advertiserContactNameLabel("OWNER"), "اسم المالك");
  assert.equal(advertiserContactNameLabel("CLIENT"), "اسم العميل");
  assert.equal(advertiserContactNameLabel("BROKER"), "اسم الوسيط");
  assert.equal(advertiserContactNameLabel("DELEGATE"), "اسم المفوض");
  assert.equal(advertiserContactNameLabel(""), "اسم المالك أو العميل أو الوسيط");
});

test("vCard merges typed name with normalized Saudi mobile", () => {
  const payload = {
    displayName: "سلطان الصاعدي",
    phoneRaw: "0552019909"
  };
  const check = validateContactSavePayload(payload);
  assert.equal(check.ok, true);
  assert.equal(check.phoneE164, "+966552019909");
  assert.equal(check.phoneLocal, "0552019909");
  const vcard = buildContactVcard(payload);
  assert.ok(vcard.includes("BEGIN:VCARD"));
  assert.ok(vcard.includes("FN;CHARSET=UTF-8:سلطان الصاعدي"));
  assert.ok(vcard.includes("TEL;TYPE=CELL,VOICE:+966552019909"));
  assert.ok(vcard.includes("TEL;TYPE=CELL:0552019909"));
  assert.ok(contactSaveFilename(payload).endsWith(".vcf"));
  assert.ok(contactSaveFilename(payload).includes("0552019909"));
});

test("vCard rejects invalid phone and falls back to role when name is empty", () => {
  assert.equal(validateContactSavePayload({ displayName: "سلطان", phoneRaw: "123" }).ok, false);
  assert.equal(
    resolveContactSaveDisplayName({ displayName: "", roleLabel: "مالك", phoneLocal: "0552019909" }),
    "مالك"
  );
  const patch = buildContactSavePatch({ displayName: "", roleLabel: "مالك", phoneRaw: "0552019909" });
  assert.equal(patch.advertiserPhoneNormalized, "+966552019909");
  assert.equal(patch.advertiserDisplayName, undefined);
});

test("listing table payload reads live name and phone inputs", () => {
  const html = buildOpportunityListingCardInnerHtml({
    id: "opp_contact_1",
    opportunityKind: "REQUEST",
    advertiserRole: "CLIENT",
    advertiserDisplayName: "أبو محمد",
    advertiserPhoneNormalized: "+966501112233"
  });
  const dom = new JSDOM(`<div id="root">${html}</div>`);
  const button = dom.window.document.querySelector(".js-save-phone-contact");
  const payload = readContactSavePayloadFromButton(button);
  assert.equal(payload.opportunityId, "opp_contact_1");
  assert.equal(payload.displayName, "أبو محمد");
  assert.equal(payload.phoneRaw, "0501112233");
  assert.equal(payload.roleLabel, "عميل");
  assert.ok(html.includes("اسم العميل"));
});

test("savePhoneContactToDevice downloads a vcf when Web Share is unavailable", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.test/" });
  const previous = {
    document: globalThis.document,
    navigator: globalThis.navigator,
    URL: globalThis.URL
  };
  globalThis.document = dom.window.document;
  globalThis.navigator = { share: undefined, canShare: undefined };
  const objectUrls = [];
  globalThis.URL = {
    createObjectURL(blob) {
      objectUrls.push(blob);
      return "blob:https://example.test/contact";
    },
    revokeObjectURL() {}
  };
  const clicks = [];
  const originalCreate = dom.window.document.createElement.bind(dom.window.document);
  dom.window.document.createElement = (tag) => {
    const node = originalCreate(tag);
    if (tag === "a") {
      node.click = () => clicks.push({ href: node.href, download: node.download });
    }
    return node;
  };

  try {
    const result = await savePhoneContactToDevice({
      displayName: "سلطان",
      phoneRaw: "0512345678"
    });
    assert.equal(result.ok, true);
    assert.equal(result.method, "download");
    assert.equal(clicks.length, 1);
    assert.match(clicks[0].download, /\.vcf$/);
    assert.equal(result.patch.contactName, "سلطان");
    assert.equal(result.patch.advertiserPhoneNormalized, "+966512345678");
    assert.equal(objectUrls.length, 1);
  } finally {
    globalThis.document = previous.document;
    globalThis.navigator = previous.navigator;
    globalThis.URL = previous.URL;
  }
});
