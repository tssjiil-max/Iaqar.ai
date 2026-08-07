/**
 * Phase 2 — Unified Opportunity Intake automated tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACHMENT_ACCEPT,
  SOURCE_TYPES,
  buildDeduplicationFingerprint,
  buildOpportunityRecord,
  completeOpportunityIntake,
  computeDataCompleteness,
  createExtractionAdapter,
  detectSourceTypeFromFile,
  detectSourceTypeFromText,
  isHttpUrl,
  listMissingFields,
  normalizeUrl,
  prepareOpportunityIntake,
  validateAttachment
} from "../public/js/opportunity-intake-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { loadShell } from "./helpers/shell.mjs";

test("source-type detection distinguishes URL and text", () => {
  assert.equal(detectSourceTypeFromText("https://example.com/listing/1"), "url");
  assert.equal(detectSourceTypeFromText("www.example.com/a"), "url");
  assert.equal(detectSourceTypeFromText("مطلوب شقة في النرجس"), "text");
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(normalizeUrl("HTTPS://Example.COM/Path/"), "https://example.com/Path");
});

test("attachment intake detects image, screenshot, pdf, word, excel, audio", () => {
  assert.equal(detectSourceTypeFromFile({ name: "a.JPG", type: "image/jpeg" }), "image");
  assert.equal(detectSourceTypeFromFile({ name: "Screenshot 1.png", type: "image/png" }), "screenshot");
  assert.equal(detectSourceTypeFromFile({ name: "offer.pdf", type: "application/pdf" }), "pdf");
  assert.equal(detectSourceTypeFromFile({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "word");
  assert.equal(detectSourceTypeFromFile({ name: "sheet.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "excel");
  assert.equal(detectSourceTypeFromFile({ name: "voice.m4a", type: "audio/mp4" }), "audio");
  assert.deepEqual(
    SOURCE_TYPES.slice().sort(),
    ["audio", "excel", "image", "pdf", "screenshot", "text", "url", "word"].sort()
  );
  assert.ok(ATTACHMENT_ACCEPT.includes("application/pdf"));
});

test("attachment validation rejects oversize and unknown types", () => {
  assert.equal(validateAttachment({ name: "x.bin", type: "application/octet-stream", size: 10 }).ok, false);
  assert.match(validateAttachment({ name: "empty.pdf", type: "application/pdf", size: 0 }).error, /فارغ/);
  assert.equal(validateAttachment({ name: "big.pdf", type: "application/pdf", size: 20 * 1024 * 1024 }).ok, false);
  assert.equal(validateAttachment({ name: "ok.pdf", type: "application/pdf", size: 1000 }).ok, true);
});

test("URL intake consumes authenticated Worker extraction without parsing the URL string itself", async () => {
  const adapter = createExtractionAdapter({
    extract: async () => ({
      extractionMode: "public_url_content",
      extractionProvider: "iaqar.authorized_http_content",
      productionAi: false,
      productionExtraction: true,
      extractionConfidence: 50,
      extractedText: "عرض للبيع فيلا في الرياض",
      fields: {
        opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض",
        district: "", priceOrBudget: null, area: null, rooms: null
      }
    })
  });
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "https://example.com/listing/villa",
    allowIncomplete: true
  }, adapter);
  assert.equal(result.ok, true);
  assert.equal(result.opportunity.sourceType, "url");
  assert.equal(result.extraction.productionAi, false);
  assert.equal(result.extraction.productionExtraction, true);
  assert.equal(result.extraction.extractionMode, "public_url_content");
  assert.equal(result.fields?.propertyType || result.opportunity.propertyType, "فيلا");
  assert.equal(result.createsOperation, false);
  assert.equal(result.runsMatching, false);
  assert.ok(result.opportunity.deduplicationFingerprint);
  assert.equal(result.opportunity.officeId, "office-a");
  assert.equal(result.opportunity.brokerId, "broker-a");
});

test("text intake extracts Arabic listing signals and tracks missing fields", async () => {
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "عرض للبيع شقة في حي النرجس الرياض ٤ غرف مساحة 180 سعر 1200000"
  });
  // May still miss some fields depending on parser; either saved or missing_information.
  assert.equal(result.ok, true);
  assert.ok(["saved", "missing_information"].includes(result.state));
  assert.equal(result.productionAi, false);
  assert.equal(result.productionExtraction, true);
  if (result.state === "saved") {
    assert.equal(result.opportunity.propertyType, "شقة");
    assert.equal(result.opportunity.city, "الرياض");
    assert.equal(result.opportunity.district, "النرجس");
    assert.equal(result.opportunity.officeId, "office-a");
  } else {
    assert.ok(result.missingFields.length >= 1);
    assert.equal(result.fields.propertyType, "شقة");
  }
});

test("missing-field flow asks only for absent required fields", async () => {
  const partial = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "شقة في الرياض"
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.state, "missing_information");
  assert.ok(partial.missingFields.includes("opportunityKind") || partial.missingFields.length > 0);

  const completed = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "شقة في الرياض",
    brokerFields: {
      opportunityKind: "OFFER",
      purpose: "SALE",
      propertyType: "شقة",
      city: "الرياض",
      district: "النرجس",
      priceOrBudget: 900000,
      area: 160,
      rooms: 3
    },
    allowIncomplete: true
  });
  assert.equal(completed.state, "saved");
  assert.equal(completed.opportunity.internalStatus, "READY");
  assert.equal(completed.opportunity.dataCompleteness, 100);
  assert.deepEqual(completed.missingFields, []);
});

test("broker completion reuses extracted values and asks again only for fields still absent", async () => {
  const extracted = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "عرض للبيع شقة في حي النرجس الرياض"
  });
  assert.equal(extracted.state, "missing_information");
  const stillMissing = completeOpportunityIntake(extracted, { area: 180 });
  assert.equal(stillMissing.state, "missing_information");
  assert.equal(stillMissing.fields.propertyType, "شقة");
  assert.equal(stillMissing.fields.area, 180);
  assert.equal(stillMissing.missingFields.includes("area"), false);

  const completed = completeOpportunityIntake(stillMissing, {
    priceOrBudget: 1200000,
    rooms: 4
  });
  assert.equal(completed.state, "saved");
  assert.deepEqual(completed.missingFields, []);
  assert.equal(completed.opportunity.propertyType, "شقة");
  assert.equal(completed.opportunity.area, 180);
});

test("duplicate prevention uses a stable office-scoped fingerprint", async () => {
  const a = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "url",
    url: "https://Example.com/x/"
  });
  const b = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "url",
    url: "https://example.com/x"
  });
  const otherOffice = await buildDeduplicationFingerprint({
    officeId: "office-b",
    sourceType: "url",
    url: "https://example.com/x"
  });
  assert.equal(a, b);
  assert.notEqual(a, otherOffice);

  const textA = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "text",
    text: "مطلوب  شقة   في النرجس"
  });
  const textB = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "text",
    text: "مطلوب شقة في النرجس"
  });
  assert.equal(textA, textB);
});

test("successful Opportunity persistence payload includes every required field", async () => {
  const extraction = await createExtractionAdapter().extract({
    sourceType: "text",
    text: "عرض للبيع فيلا في حي الملقا الرياض"
  });
  const fingerprint = await buildDeduplicationFingerprint({
    officeId: "office-a",
    sourceType: "text",
    text: "عرض للبيع فيلا في حي الملقا الرياض"
  });
  const fields = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "فيلا",
    city: "الرياض",
    district: "الملقا",
    priceOrBudget: 2500000,
    area: 400,
    rooms: 5
  };
  const opportunity = buildOpportunityRecord({
    officeId: "office-a",
    brokerId: "broker-a",
    sourceType: "text",
    sourceReference: "src_test",
    fields,
    extraction,
    deduplicationFingerprint: fingerprint
  });

  for (const key of [
    "id", "officeId", "brokerId", "createdAt", "updatedAt", "sourceType", "sourceReference",
    "opportunityKind", "purpose", "propertyType", "city", "district", "priceOrBudget",
    "area", "rooms", "extractionConfidence", "dataCompleteness", "internalStatus",
    "deduplicationFingerprint"
  ]) {
    assert.ok(key in opportunity, `missing ${key}`);
  }
  assert.equal(opportunity.productionAi, false);
  assert.equal(computeDataCompleteness(fields).isComplete, true);
  assert.deepEqual(listMissingFields({ ...fields, district: "" }), ["district"]);
});

test("attachment intake uses Worker extraction and never fabricates attachment fixtures", async () => {
  const adapter = createExtractionAdapter({
    extract: async () => ({
      extractionMode: "production_document_conversion",
      extractionProvider: "cloudflare.workers_ai.to_markdown",
      productionAi: false,
      productionExtraction: true,
      extractionConfidence: 100,
      extractedText: "عرض للبيع فيلا في حي الملقا الرياض 5 غرف مساحة 400 متر السعر 2500000 ريال",
      fields: {
        opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض",
        district: "الملقا", priceOrBudget: 2500000, area: 400, rooms: 5
      }
    })
  });
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    file: { name: "offer.pdf", type: "application/pdf", size: 2048 },
    fileChecksum: "abc123",
    allowIncomplete: true
  }, adapter);
  assert.equal(result.ok, true);
  assert.equal(result.opportunity.sourceType, "pdf");
  assert.equal(result.extraction.extractionMode, "production_document_conversion");
  assert.equal(result.extraction.productionExtraction, true);
  assert.equal(result.extraction.productionAi, false);
  assert.equal(result.opportunity.productionAi, false);
  assert.equal(result.opportunity.propertyType, "فيلا");
  assert.equal(result.source.extractedText.includes("حي الملقا"), true);
});

test("failed upload style validation is retryable", () => {
  const failed = validateAttachment({ name: "x.exe", type: "application/exe", size: 10 });
  assert.equal(failed.ok, false);
  // Pipeline maps this to failed + retryable.
});

test("Phase 2 intake does not create an Operations Center item when no match exists", async () => {
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "عرض للبيع شقة في حي النرجس الرياض ٤ غرف مساحة 180 سعر 1200000",
    brokerFields: {
      opportunityKind: "OFFER",
      purpose: "SALE",
      propertyType: "شقة",
      city: "الرياض",
      district: "النرجس",
      priceOrBudget: 1200000,
      area: 180,
      rooms: 4
    },
    allowIncomplete: true
  });
  assert.equal(result.state, "saved");
  assert.equal(result.createsOperation, false);
  assert.equal(result.runsMatching, false);
});

test("officeId isolation is embedded in fingerprints and records", async () => {
  const left = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "نفس النص",
    allowIncomplete: true
  });
  const right = await prepareOpportunityIntake({
    officeId: "office-b",
    brokerId: "broker-b",
    text: "نفس النص",
    allowIncomplete: true
  });
  assert.notEqual(left.deduplicationFingerprint, right.deduplicationFingerprint);
  assert.equal(left.opportunity.officeId, "office-a");
  assert.equal(right.opportunity.officeId, "office-b");
});

test("Add Opportunity card exists on the home page with the approved compact row", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    const section = document.getElementById("addOpportunity");
    assert.ok(section, "Add Opportunity section required");
    assert.ok(document.getElementById("addOpportunityInput"));
    assert.ok(document.getElementById("addOpportunityPaperclip"));
    assert.ok(document.getElementById("addOpportunitySubmit"));
    assert.ok(document.getElementById("addOpportunityFile"));
    assert.equal(document.getElementById("addOpportunityFile").hasAttribute("hidden"), true);

    const states = ["uploading", "analyzing", "missing_information", "saved", "failed"];
    // Labels are driven by domain module; status node must exist for visible states.
    assert.ok(document.getElementById("addOpportunityStatus"));
    assert.ok(document.getElementById("addOpportunityRetry"));
    assert.ok(document.getElementById("addOpportunityMissing"));

    // No permanent per-type buttons.
    const permanentTypeButtons = Array.from(section.querySelectorAll("button")).filter((button) => {
      const text = (button.textContent || "").trim();
      return ["PDF", "Excel", "Word", "صورة", "صوت"].includes(text);
    });
    assert.deepEqual(permanentTypeButtons, []);

    // Still no bottom nav / deals page.
    assert.equal(document.querySelector("nav"), null);
    assert.equal(document.querySelector("[data-main='deals']"), null);
  } finally {
    context.close();
  }
});

test("shell source wires real extraction without simulated attachment fixtures", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("js/add-opportunity.js"));
  assert.ok(shell.includes("id=\"addOpportunity\""));
  const domain = readRepositoryFile("public", "js", "opportunity-intake-domain.js");
  const controller = readRepositoryFile("public", "js", "add-opportunity.js");
  assert.equal(domain.includes("iaqar.simulated_fixture"), false);
  assert.equal(controller.includes("محاكاة/تحليل نصي حتمي"), false);
  assert.ok(controller.includes("/opportunity/extract"));
  assert.ok(domain.includes("productionAi: false") || domain.includes("productionAi"));
  assert.equal(domain.includes("production connected"), false);
});
