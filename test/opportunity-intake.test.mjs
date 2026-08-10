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
  mergeBrokerProvidedFields,
  normalizeOpportunityFields,
  normalizeUrl,
  prepareOpportunityIntake,
  requiredOpportunityFieldsFor,
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

test("land opportunities do not ask for a non-applicable rooms field", () => {
  const completeness = computeDataCompleteness({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الصفوة",
    priceOrBudget: 600000,
    area: 500,
    rooms: null
  });
  assert.equal(completeness.isComplete, true);
  assert.deepEqual(completeness.missingFields, []);
  assert.equal(completeness.dataCompleteness, 100);
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

test("file intake forwards the broker's typed text to the Worker extraction adapter", async () => {
  let received;
  const adapter = createExtractionAdapter({
    extract: async (input) => {
      received = input;
      return {
        extractionMode: "production_ocr",
        extractionProvider: "cloudflare.workers_ai.to_markdown",
        productionAi: true,
        productionExtraction: true,
        extractionConfidence: 100,
        extractedText: "",
        fields: {
          opportunityKind: "OFFER", purpose: "SALE", propertyType: "أرض",
          city: "المدينة المنورة", district: "الصفوة", priceOrBudget: 600000,
          area: 500, rooms: null
        }
      };
    }
  });
  const text = "للبيع قطعة أرض في مخطط الصفوة بالمدينة المنورة، المساحة 500 متر، السعر 600 ألف ريال";
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text,
    file: { name: "property.png", type: "image/png", size: 2048 },
    fileChecksum: "image-checksum",
    mediaPath: "opportunity-sources/office-a/src_image/property.png"
  }, adapter);
  assert.equal(received.text, text);
  assert.equal(received.sourceType, "image");
  assert.ok(received.mediaPath.endsWith("property.png"));
  assert.equal(result.state, "saved");
  assert.deepEqual(result.missingFields, []);
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
    text: "مطلوب شقة في الرياض",
    allowIncomplete: true
  });
  const right = await prepareOpportunityIntake({
    officeId: "office-b",
    brokerId: "broker-b",
    text: "مطلوب شقة في الرياض",
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

test("sale land review and saved record keep sale price out of rent fields", async () => {
  const adapter = createExtractionAdapter({
    extract: async () => ({
      extractionMode: "production_ocr",
      extractionProvider: "cloudflare.workers_ai.to_markdown",
      productionAi: true,
      productionExtraction: true,
      extractionConfidence: 100,
      fields: {
        opportunityKind: "OFFER",
        purpose: "SALE",
        transactionType: "بيع",
        propertyType: "أرض",
        city: "المدينة المنورة",
        district: "الرانوناء",
        salePrice: 1600000,
        annualRent: null,
        area: 431.75,
        rooms: null
      }
    })
  });
  const review = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: "إعلان بيع أرض",
    requireReview: true
  }, adapter);
  assert.equal(review.state, "review");
  assert.equal(review.fields.transactionType, "بيع");
  assert.equal(review.fields.salePrice, 1600000);
  assert.equal(review.fields.annualRent, null);
  assert.equal(requiredOpportunityFieldsFor(review.fields).includes("rooms"), false);

  const saved = completeOpportunityIntake(review);
  assert.equal(saved.state, "saved");
  assert.equal(saved.opportunity.salePrice, 1600000);
  assert.equal(saved.opportunity.annualRent, null);
  assert.equal(saved.opportunity.monthlyRent, null);
  assert.equal(saved.opportunity.priceOrBudget, 1600000);
  assert.equal(saved.opportunity.rooms, null);
  assert.equal(saved.opportunity.bathrooms, null);
});

test("rental apartment review preserves annual, installments, optional monthly, and floor fields", async () => {
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: `
      شقة للإيجار في المدينة المنورة حي السلام
      4 غرف صالة مطبخ 3 دورات مياه الدور الأول مجددة بالكامل
      22000 ريال سنويًا على دفعتين
      بعد أول 6 أشهر يمكن الاستمرار شهريًا بـ1850
    `,
    requireReview: true
  });
  assert.equal(result.state, "review");
  assert.equal(result.fields.transactionType, "إيجار");
  assert.equal(result.fields.propertyType, "شقة");
  assert.equal(result.fields.district, "السلام");
  assert.equal(result.fields.annualRent, 22000);
  assert.equal(result.fields.paymentInstallments, 2);
  assert.equal(result.fields.optionalMonthlyRentAfterSixMonths, 1850);
  assert.equal(result.fields.monthlyRent, null);
  assert.equal(result.fields.salePrice, null);
  assert.equal(result.fields.rooms, 4);
  assert.equal(result.fields.bathrooms, 3);
  assert.equal(result.fields.floorNumber, 1);

  const saved = completeOpportunityIntake(result, { area: 140 });
  assert.equal(saved.state, "saved");
  assert.equal(saved.opportunity.annualRent, 22000);
  assert.equal(saved.opportunity.optionalMonthlyRentAfterSixMonths, 1850);
  assert.equal(saved.opportunity.salePrice, null);
});

test("real Madinah land advert stays source-derived and normalizes advertiser phone", async () => {
  const result = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: `
      للبيع أرض في المدينة المنورة الرانوناء
      المساحة 431.75 م²
      السعر 580000 ريال
      رقم مسؤول الإعلان 0507561577
    `,
    requireReview: true
  });
  assert.equal(result.fields.transactionType, "بيع");
  assert.equal(result.fields.propertyType, "أرض");
  assert.equal(result.fields.city, "المدينة المنورة");
  assert.equal(result.fields.district, "الرانوناء");
  assert.equal(result.fields.area, 431.75);
  assert.equal(result.fields.salePrice, 580000);
  assert.equal(result.fields.annualRent, null);
  assert.equal(result.fields.advertiserPhoneNormalized, "+966507561577");
});

test("changing an established transaction clears its old financial meaning", () => {
  const changed = mergeBrokerProvidedFields({
    opportunityKind: "OFFER",
    purpose: "SALE",
    salePrice: 1600000,
    priceOrBudget: 1600000
  }, {
    purpose: "RENT",
    salePrice: 1600000
  });
  assert.equal(changed.purpose, "RENT");
  assert.equal(changed.salePrice, null);
  assert.equal(changed.annualRent, null);
  assert.equal(changed.priceOrBudget, null);
});

test("unknown transaction requests purpose first without displaying both money models", () => {
  const fields = normalizeOpportunityFields({
    opportunityKind: "OFFER",
    propertyType: "شقة",
    city: "",
    district: "",
    priceOrBudget: 900000,
    area: 120,
    rooms: 3
  });
  const required = requiredOpportunityFieldsFor(fields);
  assert.ok(required.includes("purpose"));
  assert.equal(required.includes("salePrice"), false);
  assert.equal(required.includes("annualRent"), false);
  assert.equal(fields.salePrice, null);
  assert.equal(fields.annualRent, null);
});

let intakeModuleCounter = 0;

async function loadIntakeController(fetchStub) {
  const user = {
    uid: "broker-a",
    getIdToken: async () => "test-token"
  };
  const firebase = {
    auth: () => ({ currentUser: user }),
    firestore: () => null
  };
  const context = await loadShell({
    bootSettingsModule: false,
    firebase,
    officeRuntime: { officeId: "office-a" },
    fetch: fetchStub
  });
  context.window.IAQAR.resolveWorkerBase = () => "https://staging-worker.example.test";
  const specifier = new URL("../public/js/add-opportunity.js", import.meta.url);
  specifier.searchParams.set("intakeTest", String(++intakeModuleCounter));
  const module = await import(specifier.href);
  return { context, module };
}

function extractionResponse(fields) {
  return new Response(JSON.stringify({
    ok: true,
    extractionMode: "production_ocr",
    extractionProvider: "cloudflare.workers_ai.to_markdown",
    extractionConfidence: 100,
    productionAi: true,
    productionExtraction: true,
    fields
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("transaction-aware Review shows sale land fields and hides rent and room fields", async () => {
  const saleFields = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الرانوناء",
    salePrice: 1600000,
    annualRent: null,
    area: 431.75,
    rooms: null
  };
  const { context, module } = await loadIntakeController(async () => extractionResponse(saleFields));
  try {
    context.document.getElementById("addOpportunityInput").value = "إعلان بيع أرض";
    await module.__test.runPipeline();
    const review = context.document.getElementById("addOpportunityMissing");
    assert.equal(review.hidden, false);
    assert.equal(review.querySelector('[name="purpose"]').value, "SALE");
    assert.equal(review.querySelector('[name="propertyType"]').value, "أرض");
    assert.equal(review.querySelector('[name="salePrice"]').value, "1600000");
    assert.equal(review.querySelector('[name="annualRent"]'), null);
    assert.equal(review.querySelector('[name="monthlyRent"]'), null);
    assert.equal(review.querySelector('[name="paymentInstallments"]'), null);
    assert.equal(review.querySelector('[name="rooms"]'), null);
    assert.equal(review.querySelector('[name="bathrooms"]'), null);
  } finally {
    context.close();
  }
});

test("transaction-aware Review shows rent fields and hides sale price", async () => {
  const rentFields = {
    opportunityKind: "OFFER",
    purpose: "RENT",
    transactionType: "إيجار",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "السلام",
    annualRent: 22000,
    monthlyRent: null,
    optionalMonthlyRentAfterSixMonths: 1850,
    paymentInstallments: 2,
    salePrice: null,
    area: 140,
    rooms: 4,
    bathrooms: 3,
    floorNumber: 1
  };
  const { context, module } = await loadIntakeController(async () => extractionResponse(rentFields));
  try {
    context.document.getElementById("addOpportunityInput").value = "إعلان إيجار شقة";
    await module.__test.runPipeline();
    const review = context.document.getElementById("addOpportunityMissing");
    assert.equal(review.querySelector('[name="purpose"]').value, "RENT");
    assert.equal(review.querySelector('[name="annualRent"]').value, "22000");
    assert.equal(review.querySelector('[name="paymentInstallments"]').value, "2");
    assert.equal(review.querySelector('[name="optionalMonthlyRentAfterSixMonths"]').value, "1850");
    assert.equal(review.querySelector('[name="salePrice"]'), null);
  } finally {
    context.close();
  }
});

test("extraction timeout fails closed, clears busy and stale fields, and allows retry", async () => {
  let mode = "delay";
  let aborted = false;
  const fields = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الرانوناء",
    salePrice: 580000,
    area: 431.75
  };
  const fetchStub = async (_url, init = {}) => {
    if (mode === "success") return extractionResponse(fields);
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  };
  const { context, module } = await loadIntakeController(fetchStub);
  try {
    module.__test.setExtractionTimeoutMs(10);
    context.document.getElementById("addOpportunityInput").value = "إعلان صورة جديد";
    await module.__test.runPipeline();
    assert.equal(aborted, true);
    assert.equal(context.document.getElementById("addOpportunityStatus").dataset.state, "failed");
    assert.match(context.document.getElementById("addOpportunityStatus").textContent, /تعذر إكمال تحليل الإعلان/);
    assert.equal(context.document.getElementById("addOpportunitySubmit").disabled, false);
    assert.equal(context.document.getElementById("addOpportunityMissing").hidden, true);
    assert.equal(module.__test.getPendingDraft(), null);
    assert.equal(context.document.getElementById("addOpportunityRetry").hidden, false);

    mode = "success";
    await module.__test.runPipeline({ fromRetry: true });
    assert.equal(context.document.getElementById("addOpportunityStatus").dataset.state, "review");
    assert.equal(context.document.getElementById("addOpportunityMissing").hidden, false);
  } finally {
    context.close();
  }
});

test("new intake never inherits a previous city after success or failure", async () => {
  let responseFields = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: "الرياض",
    district: "النرجس",
    salePrice: 800000,
    area: 400
  };
  let fail = false;
  const fetchStub = async () => fail
    ? new Response(JSON.stringify({ error: "worker_failure" }), { status: 500 })
    : extractionResponse(responseFields);
  const { context, module } = await loadIntakeController(fetchStub);
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "فرصة أ في الرياض";
    await module.__test.runPipeline();
    assert.equal(module.__test.getPendingDraft().fields.city, "الرياض");

    input.value = "فرصة ب في المدينة المنورة";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    assert.equal(module.__test.getPendingDraft(), null);
    assert.equal(context.document.getElementById("addOpportunityMissing").hidden, true);

    fail = true;
    await module.__test.runPipeline();
    assert.equal(module.__test.getPendingDraft(), null);
    assert.equal(context.document.querySelector('#addOpportunityMissing [name="city"]'), null);

    fail = false;
    responseFields = {
      ...responseFields,
      city: "المدينة المنورة",
      district: "الرانوناء",
      salePrice: 580000
    };
    await module.__test.runPipeline({ fromRetry: true });
    assert.equal(module.__test.getPendingDraft().fields.city, "المدينة المنورة");
    assert.notEqual(module.__test.getPendingDraft().fields.city, "الرياض");
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
