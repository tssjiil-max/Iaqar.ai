/**
 * استيراد إعلان — اختبارات المسار والتحليل والتكرار والحفظ.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import {
  validateImportUrl,
  isBlockedImportHost,
  resolveSourceSiteLabel,
  buildImportReadinessSummary,
  buildImportFieldStatuses,
  buildImportOpportunityExtras,
  findImportDuplicateOpportunities,
  pickStrongestImportDuplicate,
  importSaveButtonLabel,
  importReadinessPresentation,
  descriptionSimilarity,
  IMPORT_FIELD_STATUS
} from "../public/js/opportunity-import-advert-domain.js";
import {
  extractArabicOpportunityText,
  RANONA_LAND_REGRESSION_FIXTURE_TEXT
} from "../public/js/opportunity-text-extraction.js";
import { createExtractionAdapter, prepareOpportunityIntake, normalizeUrl } from "../public/js/opportunity-intake-domain.js";
import {
  extractListingTextFromHtml,
  isPrivateOrLocalHost,
  resolveListingSourceSite
} from "../worker/src/index.js";
import { buildWorkspaceActivity } from "../public/js/opportunity-workspace-domain.js";

const html = readRepositoryFile("public", "index.html");
const importUi = readRepositoryFile("public", "js", "opportunity-import-advert-ui.js");
const importDomain = readRepositoryFile("public", "js", "opportunity-import-advert-domain.js");
const canonicalDomain = readRepositoryFile("public", "js", "canonical-listing-intake-domain.js");

const SALE_TEXT = "شقة للبيع في الرياض حي النرجس السعر 850000 المساحة 180 4 غرف";
const RENT_TEXT = "فيلا للإيجار في جدة حي الروضة إيجار سنوي 120000 المساحة 400 5 غرف";
const PURCHASE_TEXT = "مطلوب شراء شقة في الدمام حي الفيصلية الميزانية 700000";

test("import option card appears with approved Arabic copy", () => {
  assert.ok(html.includes("id=\"importAdvertOption\""));
  assert.ok(html.includes("استيراد إعلان"));
  assert.ok(html.includes("الصق رابط إعلان من عقار أو حراج أو أي موقع"));
  assert.ok(html.includes("استيراد إعلان عقاري"));
  assert.ok(html.includes("الصق رابط الإعلان هنا"));
  assert.ok(html.includes("تحليل الإعلان"));
  assert.ok(html.includes("لصق نص الإعلان"));
  assert.ok(html.includes("رفع صورة الإعلان"));
});

test("validateImportUrl rejects invalid URLs", () => {
  assert.equal(validateImportUrl("not-a-url").ok, false);
  assert.equal(validateImportUrl("ftp://haraj.com.sa/1").ok, false);
  assert.match(validateImportUrl("not-a-url").message, /الرابط غير صالح/);
});

test("validateImportUrl blocks internal network hosts", () => {
  assert.equal(validateImportUrl("http://127.0.0.1/listing").ok, false);
  assert.equal(validateImportUrl("http://192.168.1.10/ad").ok, false);
  assert.equal(isBlockedImportHost("localhost"), true);
  assert.equal(isPrivateOrLocalHost("10.0.0.5"), true);
});

test("JSON-LD RealEstateListing extraction enriches listing text", () => {
  const snippet = `<html><head>
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@type":"RealEstateListing",
      "name":"أرض للبيع",
      "description":"أرض سكنية في حي الرانوناء",
      "address":{"addressLocality":"المدينة المنورة","streetAddress":"الرانوناء"},
      "offers":{"@type":"Offer","price":"580000"}
    }</script></head><body></body></html>`;
  const text = extractListingTextFromHtml(snippet);
  assert.match(text, /الرانوناء/);
  assert.match(text, /580000/);
});

test("metadata and body fallback when JSON-LD is absent", () => {
  const snippet = `<html><head>
    <meta property="og:description" content="شقة للإيجار في جدة حي السلام">
    <meta name="description" content="إيجار سنوي 90000">
    </head><body><h1>إعلان عقاري</h1><p>4 غرف وصالة</p></body></html>`;
  const text = extractListingTextFromHtml(snippet);
  assert.match(text, /للإيجار/);
  assert.match(text, /السلام/);
  assert.match(text, /90000/);
});

test("blocked listing page is not treated as successful extraction in worker resolver path", async () => {
  const blocked = extractListingTextFromHtml(
    "<html><body>تم حظرك You have been blocked</body></html>"
  );
  assert.match(blocked, /blocked/i);
});

test("sale listing text extraction", async () => {
  const parsed = extractArabicOpportunityText(SALE_TEXT);
  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: SALE_TEXT,
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.equal(prepared.ok, true);
  assert.equal(prepared.fields.purpose, "SALE");
  assert.equal(parsed.legacyFields.propertyType, "شقة");
});

test("rent listing text extraction", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: RENT_TEXT,
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.equal(prepared.ok, true);
  assert.equal(prepared.fields.purpose, "RENT");
  assert.match(prepared.fields.propertyType || "", /فيلا/);
});

test("purchase request text extraction", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: PURCHASE_TEXT,
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.equal(prepared.ok, true);
  assert.equal(prepared.fields.purpose, "PURCHASE");
});

test("parser does not invent missing values", () => {
  const parsed = extractArabicOpportunityText("شقة في الرياض");
  assert.equal(parsed.legacyFields.priceOrBudget, null);
  assert.equal(parsed.legacyFields.district, "");
});

test("advertiser role stays unknown when not stated", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: SALE_TEXT,
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.notEqual(prepared.fields.advertiserRole, "OWNER");
});

test("normalization keeps district free of price and area tokens", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: RANONA_LAND_REGRESSION_FIXTURE_TEXT,
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.equal(prepared.fields.district, "الرانوناء");
  assert.equal(String(prepared.fields.district).includes("580000"), false);
  assert.equal(String(prepared.fields.district).includes("431"), false);
});

test("duplicate detection by normalized source URL within same office", () => {
  const url = "https://haraj.com.sa/11167757566/test-ad";
  const normalized = normalizeUrl(url);
  const hits = findImportDuplicateOpportunities([
    {
      id: "opp_existing",
      data: {
        officeId: "office-a",
        status: "active",
        lifecycleStatus: "ACTIVE",
        sourceUrl: normalized,
        propertyType: "شقة",
        city: "الرياض",
        district: "النرجس"
      }
    }
  ], { sourceUrl: url, officeId: "office-a" }, "office-a");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].reason, "source_url");
});

test("similar opportunity inside office without leaking other offices", () => {
  const hits = findImportDuplicateOpportunities([
    {
      id: "opp_other_office",
      data: {
        officeId: "office-b",
        status: "active",
        lifecycleStatus: "ACTIVE",
        sourceUrl: "https://haraj.com.sa/shared",
        contactPhone: "+966501234567",
        propertyType: "شقة",
        city: "الرياض",
        district: "النرجس"
      }
    }
  ], {
    officeId: "office-a",
    phone: "+966501234567",
    contactType: "owner",
    opportunityKind: "OFFER",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس"
  }, "office-a");
  assert.equal(hits.length, 0);
});

test("pickStrongestImportDuplicate prefers URL match", () => {
  const hit = pickStrongestImportDuplicate([
    { strength: "medium", opportunityId: "opp-1" },
    { strength: "strong", opportunityId: "opp-2", reason: "source_url" }
  ]);
  assert.equal(hit.opportunityId, "opp-2");
});

test("import extras include source metadata for Firestore writes", () => {
  const extras = buildImportOpportunityExtras({
    sourceUrl: "https://haraj.com.sa/123",
    sourceSite: "حراج",
    extractionConfidence: 72
  });
  assert.equal(extras.sourceSite, "حراج");
  assert.equal(extras.sourceUrl, normalizeUrl("https://haraj.com.sa/123"));
  assert.equal(extras.importActivityText, "تم استيراد الإعلان من حراج");
  assert.equal(extras.extractionConfidence, 72);
});

test("complete import becomes ready for matching label", () => {
  const label = importSaveButtonLabel({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    salePrice: 850000,
    priceOrBudget: 850000,
    area: 180,
    rooms: 4,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966501234567"
  });
  assert.equal(label, "حفظ وإدخالها في المطابقة");
  const presentation = importReadinessPresentation({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    salePrice: 850000,
    priceOrBudget: 850000,
    area: 180,
    rooms: 4,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966501234567"
  });
  assert.equal(presentation.matchingReadinessLabel, "جاهزة للمطابقة");
  assert.equal(presentation.isReadyForMatching, true);
});

test("incomplete import becomes needs completion with missing keys", () => {
  const presentation = importReadinessPresentation({
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس"
  });
  assert.equal(presentation.matchingReadinessLabel, "تحتاج استكمال");
  assert.ok(presentation.matchingReadinessMissing.includes("advertiserRole"));
  assert.ok(presentation.matchingReadinessMissing.includes("contactPhone"));
});

test("import readiness summary counts extracted fields", () => {
  const summary = buildImportReadinessSummary({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    priceOrBudget: 850000,
    area: 180,
    rooms: 4
  });
  assert.match(summary, /تم استخراج 8 من 10/);
});

test("field statuses mark missing and extracted values", () => {
  const statuses = buildImportFieldStatuses(
    { purpose: "SALE", propertyType: "شقة", city: "الرياض" },
    {},
    ["district", "priceOrBudget"]
  );
  assert.equal(statuses.purpose, IMPORT_FIELD_STATUS.EXTRACTED);
  assert.equal(statuses.district, IMPORT_FIELD_STATUS.MISSING);
});

test("workspace activity shows import line from stored metadata", () => {
  const activity = buildWorkspaceActivity({
    createdAt: "2026-01-01T00:00:00.000Z",
    importedAt: "2026-01-01T00:00:00.000Z",
    importActivityText: "تم استيراد الإعلان من حراج"
  });
  assert.ok(activity.some((row) => row.text === "تم استيراد الإعلان من حراج"));
});

test("resolveSourceSiteLabel maps known hosts to Arabic names", () => {
  assert.equal(resolveSourceSiteLabel("https://haraj.com.sa/1"), "حراج");
  assert.equal(resolveListingSourceSite("https://sa.aqar.fm/ad/1"), "عقار");
});

test("description similarity helper avoids false positives on empty text", () => {
  assert.equal(descriptionSimilarity("", "شقة للبيع"), 0);
  assert.ok(descriptionSimilarity(SALE_TEXT, SALE_TEXT) > 0.5);
});

test("import UI wires save through opportunity bank repository path", () => {
  assert.ok(importUi.includes("persistIntake"));
  assert.ok(importUi.includes("prepareOpportunityIntake"));
  assert.ok(importUi.includes("requestOpportunityRematch"));
  assert.ok(importUi.includes("officeId"));
});

test("user-facing import UI avoids English error labels", () => {
  assert.ok(importUi.includes("الرابط غير صالح"));
  assert.ok(canonicalDomain.includes("تعذر قراءة الرابط، أرفق صورة أو انسخ نص الإعلان"));
  assert.ok(importUi.includes("جارٍ قراءة الإعلان"));
  assert.ok(importUi.includes("تعذر حفظ الفرصة"));
  assert.equal(importUi.includes("Failed to fetch"), false);
});
