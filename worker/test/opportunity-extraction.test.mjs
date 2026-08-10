import test from "node:test";
import assert from "node:assert/strict";
import {
  OpportunityExtractionError,
  extractOpportunitySource,
  htmlToVisibleText,
  normalizePublicSourceUrl,
  parseArabicNumberWords,
  parseExtractedOpportunityText
} from "../src/opportunity-extraction.js";

const COMPLETE_ARABIC = "عرض للبيع شقة في حي النرجس الرياض ٤ غرف مساحة 180 متر السعر 1200000 ريال";

test("direct Arabic text extracts only values present in the source", async () => {
  const extraction = await extractOpportunitySource({
    sourceType: "text",
    text: COMPLETE_ARABIC
  }, {});
  assert.deepEqual(extraction.fields, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    transactionType: "بيع",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    salePrice: 1200000,
    annualRent: null,
    monthlyRent: null,
    optionalMonthlyRentAfterSixMonths: null,
    paymentInstallments: null,
    budget: null,
    priceOrBudget: 1200000,
    area: 180,
    rooms: 4,
    bathrooms: null,
    floorNumber: null,
    advertiserPhoneNormalized: ""
  });
  assert.deepEqual(extraction.missingFields, []);
  assert.equal(extraction.productionExtraction, true);
  assert.equal(extraction.productionAi, false);
});

test("staging report sample extracts land fields and treats rooms as not applicable", async () => {
  const text = "للبيع قطعة أرض في مخطط الصفوة بالمدينة المنورة، المساحة 500 متر، السعر 600 ألف ريال";
  const extraction = await extractOpportunitySource({ sourceType: "text", text }, {});
  assert.deepEqual(extraction.fields, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الصفوة",
    salePrice: 600000,
    annualRent: null,
    monthlyRent: null,
    optionalMonthlyRentAfterSixMonths: null,
    paymentInstallments: null,
    budget: null,
    priceOrBudget: 600000,
    area: 500,
    rooms: null,
    bathrooms: null,
    floorNumber: null,
    advertiserPhoneNormalized: ""
  });
  assert.deepEqual(extraction.missingFields, []);
});

test("parser leaves absent values missing instead of inventing defaults", () => {
  const parsed = parseExtractedOpportunityText("مطلوب شقة في الرياض");
  assert.equal(parsed.fields.opportunityKind, "REQUEST");
  assert.equal(parsed.fields.propertyType, "شقة");
  assert.equal(parsed.fields.city, "الرياض");
  assert.equal(parsed.fields.district, "");
  assert.equal(parsed.fields.priceOrBudget, null);
  assert.ok(parsed.missingFields.includes("district"));
  assert.ok(parsed.missingFields.includes("purpose"));
  assert.equal(parsed.missingFields.includes("salePrice"), false);
  assert.equal(parsed.missingFields.includes("annualRent"), false);
});

test("sale land keeps sale price separate from every rent field", () => {
  const parsed = parseExtractedOpportunityText(
    "عرض مالك للبيع أرض في المدينة المنورة حي الرانوناء المساحة 500 م² السعر 1600000 ريال"
  );
  assert.equal(parsed.fields.transactionType, "بيع");
  assert.equal(parsed.fields.propertyType, "أرض");
  assert.equal(parsed.fields.salePrice, 1600000);
  assert.equal(parsed.fields.annualRent, null);
  assert.equal(parsed.fields.monthlyRent, null);
  assert.equal(parsed.fields.paymentInstallments, null);
  assert.equal(parsed.missingFields.includes("rooms"), false);
});

test("rental apartment separates annual and optional monthly rent and floor semantics", () => {
  const parsed = parseExtractedOpportunityText(`
    شقة للإيجار حي السلام
    4 غرف صالة مطبخ 3 دورات مياه
    الدور الأول مجددة بالكامل
    22000 ريال سنويًا على دفعتين
    بعد أول 6 أشهر يمكن الاستمرار شهريًا بـ1850
  `);
  assert.equal(parsed.fields.transactionType, "إيجار");
  assert.equal(parsed.fields.purpose, "RENT");
  assert.equal(parsed.fields.propertyType, "شقة");
  assert.equal(parsed.fields.district, "السلام");
  assert.equal(parsed.fields.annualRent, 22000);
  assert.equal(parsed.fields.paymentInstallments, 2);
  assert.equal(parsed.fields.optionalMonthlyRentAfterSixMonths, 1850);
  assert.equal(parsed.fields.monthlyRent, null);
  assert.equal(parsed.fields.salePrice, null);
  assert.equal(parsed.fields.rooms, 4);
  assert.equal(parsed.fields.bathrooms, 3);
  assert.equal(parsed.fields.floorNumber, 1);
});

test("real Madinah land advert extracts sale semantics and normalized advertiser phone", () => {
  const parsed = parseExtractedOpportunityText(`
    للبيع أرض في المدينة المنورة الرانوناء
    المساحة 431.75 م²
    السعر 580000 ريال
    رقم مسؤول الإعلان 0507561577
  `);
  assert.equal(parsed.fields.transactionType, "بيع");
  assert.equal(parsed.fields.propertyType, "أرض");
  assert.equal(parsed.fields.city, "المدينة المنورة");
  assert.equal(parsed.fields.district, "الرانوناء");
  assert.equal(parsed.fields.area, 431.75);
  assert.equal(parsed.fields.salePrice, 580000);
  assert.equal(parsed.fields.annualRent, null);
  assert.equal(parsed.fields.advertiserPhoneNormalized, "+966507561577");
});

test("public real-estate URL reads allowed HTML and parses visible listing text", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    return new Response(
      `<html><head><script>مدينة مختلقة</script></head><body><article>${COMPLETE_ARABIC}</article></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  };
  const extraction = await extractOpportunitySource({
    sourceType: "url",
    url: "https://listing.example.test/property/1"
  }, {}, { fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(extraction.fields.district, "النرجس");
  assert.equal(extraction.fields.city, "الرياض");
  assert.equal(extraction.extractedText.includes("مدينة مختلقة"), false);
  assert.equal(extraction.extractionMode, "public_url_content");
});

test("URL validation blocks private targets and honors robots.txt", async () => {
  for (const url of ["http://127.0.0.1/a", "http://192.168.1.2/a", "http://localhost/a"]) {
    assert.throws(() => normalizePublicSourceUrl(url), (error) =>
      error instanceof OpportunityExtractionError && error.code === "unsafe_source_url"
    );
  }
  await assert.rejects(
    extractOpportunitySource({
      sourceType: "url",
      url: "https://listing.example.test/private/1"
    }, {}, {
      fetchImpl: async () => new Response("User-agent: *\nDisallow: /private")
    }),
    (error) => error.code === "source_url_disallowed"
  );
});

test("image, screenshot, PDF, Word, and Excel use real document conversion output", async () => {
  const calls = [];
  const ai = {
    async toMarkdown(input) {
      calls.push(input);
      return { data: COMPLETE_ARABIC };
    }
  };
  for (const [sourceType, fileName, contentType] of [
    ["image", "offer.png", "image/png"],
    ["screenshot", "screenshot.png", "image/png"],
    ["pdf", "offer.pdf", "application/pdf"],
    ["word", "offer.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["excel", "offer.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
  ]) {
    const extraction = await extractOpportunitySource({
      sourceType,
      fileName,
      contentType,
      fileBytes: new Uint8Array([1, 2, 3])
    }, { AI: ai });
    assert.equal(extraction.fields.priceOrBudget, 1200000, sourceType);
    assert.deepEqual(extraction.missingFields, [], sourceType);
    assert.equal(extraction.extractionProvider, "cloudflare.workers_ai.to_markdown");
    assert.equal(extraction.productionExtraction, true);
  }
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.blob instanceof Blob));
});

test("typed listing text supplements a property photo with no readable ad text", async () => {
  const text = "للبيع قطعة أرض في مخطط الصفوة بالمدينة المنورة، المساحة 500 متر، السعر 600 ألف ريال";
  const extraction = await extractOpportunitySource({
    sourceType: "image",
    text,
    fileName: "property-photo.png",
    contentType: "image/png",
    fileBytes: new Uint8Array([1, 2, 3])
  }, { AI: { toMarkdown: async () => ({ data: "" }) } });
  assert.equal(extraction.extractionMode, "production_ocr");
  assert.equal(extraction.productionAi, true);
  assert.equal(extraction.userTextUsed, true);
  assert.equal(extraction.extractedText, "");
  assert.equal(extraction.fields.propertyType, "أرض");
  assert.equal(extraction.fields.city, "المدينة المنورة");
  assert.equal(extraction.fields.priceOrBudget, 600000);
  assert.deepEqual(extraction.missingFields, []);
});

test("Arabic audio uses production ASR transcript before field parsing", async () => {
  const calls = [];
  const ai = {
    async run(model, input) {
      calls.push({ model, input });
      return { text: COMPLETE_ARABIC };
    }
  };
  const extraction = await extractOpportunitySource({
    sourceType: "audio",
    fileName: "voice.mp3",
    contentType: "audio/mpeg",
    fileBytes: new Uint8Array([1, 2, 3])
  }, { AI: ai });
  assert.equal(calls[0].model, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(calls[0].input.language, "ar");
  assert.equal(extraction.extractionMode, "production_asr");
  assert.equal(extraction.productionAi, true);
  assert.equal(extraction.fields.rooms, 4);
});

test("spoken Arabic number words from Whisper map to contextual numeric fields", () => {
  assert.equal(parseArabicNumberWords("أربع"), 4);
  assert.equal(parseArabicNumberWords("مئة وثمانون"), 180);
  assert.equal(parseArabicNumberWords("مليون ومئتان ألف"), 1200000);
  for (const phrase of ["مائة وثمانين", "مئة وثمانون"]) {
    assert.equal(parseArabicNumberWords(phrase), 180);
  }
  for (const phrase of ["مائتان ألف", "مئتين ألف", "مائتين ألف"]) {
    assert.equal(parseArabicNumberWords(phrase), 200000);
  }

  const transcript = "عرض للبيع شقة في حي النرجس الرياض أربع غرف مساحة مئة وثمانون متر السعر مليون ومئتان ألف ريال";
  const parsed = parseExtractedOpportunityText(transcript);
  assert.equal(parsed.fields.rooms, 4);
  assert.equal(parsed.fields.area, 180);
  assert.equal(parsed.fields.priceOrBudget, 1200000);
  assert.deepEqual(parsed.missingFields, []);
});

test("missing AI output and unsupported files return explicit reasons", async () => {
  await assert.rejects(
    extractOpportunitySource({
      sourceType: "pdf",
      fileName: "empty.pdf",
      fileBytes: new Uint8Array([1])
    }, { AI: { toMarkdown: async () => ({ data: "" }) } }),
    (error) => error.code === "document_no_text" && /نص عقاري/.test(error.publicMessage)
  );
  await assert.rejects(
    extractOpportunitySource({
      sourceType: "audio",
      fileName: "silence.mp3",
      fileBytes: new Uint8Array([1])
    }, { AI: { run: async () => ({ text: "" }) } }),
    (error) => error.code === "audio_no_speech" && /كلام عربي/.test(error.publicMessage)
  );
  await assert.rejects(
    extractOpportunitySource({
      sourceType: "image",
      fileName: "offer.png",
      fileBytes: new Uint8Array([1])
    }, {}),
    (error) => error.code === "production_extraction_unavailable" && error.status === 503
  );
  await assert.rejects(
    extractOpportunitySource({ sourceType: "text", text: "ملف لا يحتوي على إعلان" }, {}),
    (error) => error.code === "no_property_data_found" && /بيانات عقارية/.test(error.publicMessage)
  );
});

test("HTML conversion strips executable and hidden content", () => {
  const visible = htmlToVisibleText(
    `<style>.x{display:none}</style><script>fake()</script>
     <script type="application/ld+json">{"name":"عرض شقة","description":"للبيع في الرياض حي النرجس","price":1200000,"numberOfRooms":4,"floorSize":{"value":180}}</script>
     <h1>عرض شقة</h1><p>حي النرجس</p>`
  );
  assert.equal(visible.includes("fake"), false);
  assert.match(visible, /عرض شقة/);
  assert.match(visible, /حي النرجس/);
  const parsed = parseExtractedOpportunityText(visible);
  assert.equal(parsed.fields.priceOrBudget, 1200000);
  assert.equal(parsed.fields.area, 180);
  assert.equal(parsed.fields.rooms, 4);
});
