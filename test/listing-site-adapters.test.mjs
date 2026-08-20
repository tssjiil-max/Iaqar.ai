/**
 * Listing site adapters + canonical intake regression tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTING_EXTRACTION_STATUS,
  matchListingAdapter,
  parseListingHtmlWithAdapter,
  resolveListingSourceSiteId,
  __test as adapterTest
} from "../worker/src/listing-site-adapters.mjs";
import { resolveCanonicalListingUrl, __test as intakeTest } from "../worker/src/canonical-listing-intake.mjs";
import { mergeCanonicalListingFields } from "../public/js/canonical-listing-intake-domain.js";
import { extractArabicOpportunityText } from "../public/js/opportunity-text-extraction.js";
import { matchOperationType } from "../public/js/reference-catalog.js";
import { buildDeduplicationFingerprint } from "../public/js/opportunity-intake-domain.js";

const AQAR_URL = "https://sa.aqar.fm/r/fd2f5397";
const AQAR_HTML = `<!DOCTYPE html><html><head>
<title>فيلا للبيع في المدينة المنورة</title>
<script id="__NEXT_DATA__" type="application/json">{
  "props":{"pageProps":{"listing":{
    "id":"fd2f5397",
    "title":"فيلا للبيع",
    "purpose":"sale",
    "category":{"name":"فيلا"},
    "city":{"name":"المدينة المنورة"},
    "area":291,
    "rooms":6,
    "livingRooms":1,
    "bathrooms":7,
    "streetWidth":20,
    "facade":"غربية",
    "age":"جديد",
    "usage":"سكني"
  }}}}
</script></head><body>فيلا للبيع المدينة المنورة</body></html>`;

const HARAJ_HTML = `<html><head><title>شقة للإيجار في الرياض حي النرجس</title>
<meta property="og:description" content="شقة للإيجار السعر 85000 المساحة 120"></head>
<body>شقة للإيجار حي النرجس 4 غرف</body></html>`;

const DEAL_HTML = `<html><head><title>فيلا للبيع - ديل</title>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"listing":{
  "title":"فيلا للبيع في جدة",
  "purpose":"sale",
  "category":"فيلا",
  "city":"جدة",
  "price":1200000
}}}}</script></head><body></body></html>`;

const BLOCKED_HTML = "<html><body>You have been blocked تم حظرك</body></html>";

test("A) aqar adapter: fd2f5397 resolves to owner_offer + sale + villa + Medina + area 291", () => {
  const adapter = matchListingAdapter(AQAR_URL);
  assert.equal(adapter.id, "aqar");
  const parsed = parseListingHtmlWithAdapter(AQAR_HTML, AQAR_URL, adapter);
  assert.equal(parsed.sourceSite, "aqar");
  assert.equal(parsed.externalListingId, "fd2f5397");
  assert.equal(parsed.extractionStatus, LISTING_EXTRACTION_STATUS.EXTRACTED);
  assert.equal(parsed.brokerFields.opportunityKind, "OFFER");
  assert.equal(parsed.brokerFields.purpose, "SALE");
  assert.match(parsed.brokerFields.propertyType, /فيلا/);
  assert.match(parsed.brokerFields.city, /المدينة المنورة/);
  assert.equal(parsed.brokerFields.area, 291);
  assert.notEqual(parsed.brokerFields.opportunityKind, "REQUEST");
  assert.notEqual(parsed.brokerFields.purpose, "RENT");
  assert.notEqual(parsed.brokerFields.propertyType, "دور");
});

test("A) polluted chrome text no longer defaults to rent buyer_request floor", () => {
  const polluted = `فيلا للبيع في المدينة المنورة
للإيجار شقق في الرياض
دور للإيجار
سكني
المساحة 291 متر
6 غرف
7 دورات مياه`;
  const parsed = extractArabicOpportunityText(polluted);
  assert.equal(parsed.legacyFields.purpose, "SALE");
  assert.equal(parsed.legacyFields.opportunityKind, "OFFER");
  assert.match(parsed.legacyFields.propertyType, /فيلا/);
  const op = matchOperationType(parsed.legacyFields, polluted, { focusText: "فيلا للبيع في المدينة المنورة" });
  assert.equal(op?.id, "sale");
});

test("B) haraj adapter extracts rent offer from listing page", () => {
  const adapter = matchListingAdapter("https://haraj.com.sa/12345678901");
  assert.equal(adapter.id, "haraj");
  const parsed = parseListingHtmlWithAdapter(HARAJ_HTML, "https://haraj.com.sa/12345678901", adapter);
  assert.equal(parsed.brokerFields.purpose, "RENT");
  assert.equal(parsed.brokerFields.opportunityKind, "OFFER");
  assert.match(parsed.brokerFields.propertyType, /شقة/);
});

test("B) haraj blocked page returns fallback_required without guessing", () => {
  const parsed = parseListingHtmlWithAdapter(BLOCKED_HTML, "https://haraj.com.sa/12345678901");
  assert.equal(parsed.extractionStatus, LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED);
  assert.equal(parsed.brokerFields, null);
});

test("C) deal adapter distinguishes sale offer", () => {
  const adapter = matchListingAdapter("https://dealapp.sa/property/abc-123");
  assert.equal(adapter.id, "deal");
  const parsed = parseListingHtmlWithAdapter(DEAL_HTML, "https://dealapp.sa/property/abc-123", adapter);
  assert.equal(parsed.brokerFields.purpose, "SALE");
  assert.equal(parsed.brokerFields.opportunityKind, "OFFER");
});

test("D) generic adapter handles unknown host without crash", () => {
  const adapter = matchListingAdapter("https://example.com/listing/1");
  assert.equal(adapter.id, "generic");
  const parsed = parseListingHtmlWithAdapter(
    "<html><head><title>أرض للبيع في الطائف</title></head><body>أرض للبيع</body></html>",
    "https://example.com/listing/1",
    adapter
  );
  assert.ok(parsed.rawText);
  assert.equal(parsed.brokerFields.purpose, "SALE");
});

test("E) canonical merge prefers structured aqar fields over noisy text parser", () => {
  const textFields = {
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    propertyType: "دور",
    city: "",
    area: null
  };
  const aqarParsed = adapterTest.parseAqarHtml(AQAR_HTML, AQAR_URL);
  const canonical = {
    adapterId: "aqar",
    brokerFields: aqarParsed.brokerFields,
    extractionStatus: "extracted",
    classificationStatus: "confirmed"
  };
  const merged = mergeCanonicalListingFields(textFields, canonical);
  assert.equal(merged.fields.purpose, "SALE");
  assert.equal(merged.fields.opportunityKind, "OFFER");
  assert.match(merged.fields.propertyType, /فيلا/);
});

test("F) duplicate fingerprint is stable for same normalized URL", async () => {
  const a = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "url",
    url: "https://sa.aqar.fm/r/fd2f5397/"
  });
  const b = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "url",
    url: "https://sa.aqar.fm/r/fd2f5397"
  });
  assert.equal(a, b);
});

test("G) security: internal hosts rejected by canonical resolver", async () => {
  const result = await resolveCanonicalListingUrl({
    originalUrl: "http://127.0.0.1/private",
    isPrivateOrLocalHost: (host) => host === "127.0.0.1"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_url");
});

test("G) security: canonical fetch uses redirect cap and returns blocked without text success", async () => {
  const result = await resolveCanonicalListingUrl({
    originalUrl: AQAR_URL,
    isPrivateOrLocalHost: () => false,
    fetchImpl: async () => new Response(BLOCKED_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html" }
    })
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "source_blocked");
});

test("registry resolves aqar haraj deal hosts", () => {
  assert.equal(resolveListingSourceSiteId("https://sa.aqar.fm/r/1"), "aqar");
  assert.equal(resolveListingSourceSiteId("https://haraj.com.sa/123"), "haraj");
  assert.equal(resolveListingSourceSiteId("https://dealapp.sa/share/x"), "deal");
});

test("سكني alone must not imply rent", () => {
  const parsed = extractArabicOpportunityText("فيلا للبيع المدينة المنورة سكني المساحة 291");
  assert.equal(parsed.legacyFields.purpose, "SALE");
});
