import test from "node:test";
import assert from "node:assert/strict";
import {
  OpportunityExtractionError,
  extractOpportunitySource,
  htmlToVisibleText,
  normalizePublicSourceUrl,
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
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    priceOrBudget: 1200000,
    area: 180,
    rooms: 4
  });
  assert.deepEqual(extraction.missingFields, []);
  assert.equal(extraction.productionExtraction, true);
  assert.equal(extraction.productionAi, false);
});

test("parser leaves absent values missing instead of inventing defaults", () => {
  const parsed = parseExtractedOpportunityText("مطلوب شقة في الرياض");
  assert.equal(parsed.fields.opportunityKind, "REQUEST");
  assert.equal(parsed.fields.propertyType, "شقة");
  assert.equal(parsed.fields.city, "الرياض");
  assert.equal(parsed.fields.district, "");
  assert.equal(parsed.fields.priceOrBudget, null);
  assert.ok(parsed.missingFields.includes("district"));
  assert.ok(parsed.missingFields.includes("priceOrBudget"));
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
