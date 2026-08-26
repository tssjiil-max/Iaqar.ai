import { test } from "node:test";
import assert from "node:assert/strict";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

function hasValidInputFromValues(text, file) {
  return String(text || "").trim().length > 0 || Boolean(file);
}

test("hasValidInput: empty text and no file is invalid", () => {
  assert.equal(hasValidInputFromValues("", null), false);
  assert.equal(hasValidInputFromValues("   ", null), false);
});

test("hasValidInput: trimmed text is valid", () => {
  assert.equal(hasValidInputFromValues("ش", null), true);
  assert.equal(hasValidInputFromValues("  عرض  ", null), true);
});

test("hasValidInput: file alone is valid", () => {
  assert.equal(hasValidInputFromValues("", { name: "a.jpg" }), true);
});

test("add-opportunity.js wires syncExecuteButton on input", () => {
  const source = readRepositoryFile("public", "js", "add-opportunity.js");
  assert.ok(source.includes("function syncExecuteButton"));
  assert.ok(source.includes("addEventListener(\"input\", () => {"));
  assert.ok(source.includes("hasValidInputFromValues"));
});

test("index.html uses single-row grid for add opportunity", () => {
  const html = readRepositoryFile("public", "index.html");
  assert.ok(html.includes("grid-template-columns:minmax(0, 1fr) 96px"));
});

test("approved modern shell keeps إرسال, Workspace, and no old FAL banner", () => {
  const html = readRepositoryFile("public", "index.html");
  assert.equal(html.includes("license-banner"), false);
  assert.equal(html.includes("الهيئة العامة للعقار"), false);
  assert.match(html, /id="addOpportunitySubmit"[^>]*>إرسال<\/button>/);
  assert.equal(html.includes(">معالجة</button>"), false);
  assert.ok(html.includes("المهام اليومية"));
  assert.ok(html.includes("id=\"mainTabOperations\""));
  assert.ok(html.includes("id=\"oppTabBank\""));
  assert.ok(html.includes("office-name-bar"));
});

test("Review gate accepts real partial fields and rejects simulated or empty extraction", async () => {
  const { context, module } = await loadController();
  try {
    assert.equal(module.__test.canOpenReview({
      ok: true,
      fields: { propertyType: "أرض", city: "المدينة المنورة" },
      extraction: { extractionMode: "deterministic_text_parser" }
    }), true);
    assert.equal(module.__test.canOpenReview({
      ok: true,
      fields: { propertyType: "أرض", city: "المدينة المنورة" },
      extraction: { extractionMode: "simulated_fixture" }
    }), false);
    assert.equal(module.__test.canOpenReview({
      ok: true,
      fields: {},
      extraction: { extractionMode: "deterministic_text_parser" }
    }), false);
  } finally {
    context.close();
  }
});

test("merge persist payload never rewrites createdAt or ownership fields", async () => {
  const { context, module } = await loadController();
  try {
    const stamp = { __serverTimestamp: true };
    const created = module.__test.buildOpportunityPersistPayload({
      opportunity: {
        city: "المدينة المنورة",
        brokerId: "broker-a",
        officeId: "office-a",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      reviewMeta: { brokerConfirmed: true },
      opportunityId: "opp_1",
      existingData: null,
      serverTimestamp: stamp
    });
    assert.equal(created.createdAt, stamp);

    const merged = module.__test.buildOpportunityPersistPayload({
      opportunity: {
        city: "جدة",
        brokerId: "broker-hijack",
        officeId: "office-b",
        createdAt: "1999-01-01T00:00:00.000Z",
        originatingOfficeId: "office-evil",
        deduplicationFingerprint: "new-fp"
      },
      reviewMeta: { brokerConfirmed: true },
      opportunityId: "opp_1",
      existingData: {
        brokerId: "broker-a",
        officeId: "office-a",
        originatingOfficeId: "office-a",
        originatingBrokerId: "broker-a",
        currentOwningOfficeId: "office-a",
        deduplicationFingerprint: "old-fp",
        createdAt: { seconds: 1 }
      },
      serverTimestamp: stamp
    });
    assert.equal("createdAt" in merged, false);
    assert.equal(merged.brokerId, "broker-a");
    assert.equal(merged.officeId, "office-a");
    assert.equal(merged.originatingOfficeId, "office-a");
    assert.equal(merged.deduplicationFingerprint, "old-fp");
    assert.equal(merged.city, "جدة");
    assert.equal(merged.brokerConfirmed, true);
  } finally {
    context.close();
  }
});

let controllerInstance = 0;

async function loadController(fetchStub = null) {
  const user = { uid: "broker-a", getIdToken: async () => "token" };
  const firebase = {
    auth: () => ({ currentUser: user }),
    firestore: () => null
  };
  const context = await loadShell({
    bootSettingsModule: false,
    firebase,
    officeRuntime: { officeId: "office-a", city: "الرياض" },
    fetch: fetchStub
  });
  context.window.IAQAR.resolveWorkerBase = () => "https://staging-worker.example.test";
  const specifier = new URL("../public/js/add-opportunity.js", import.meta.url);
  specifier.searchParams.set("executeTest", String(++controllerInstance));
  const module = await import(specifier.href);
  return { context, module };
}

test("sale-land Review shows sale price only and hides rent/building fields", async () => {
  const { context, module } = await loadController();
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = [
      "أرض للبيع",
      "المدينة المنورة",
      "حي الرانوناء،",
      "المساحة 431.75 م²",
      "السعر المطلوب 1600000 ريال",
      "جوال: 0507561577"
    ].join(" ");
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();

    assert.equal(context.document.getElementById("opportunityReviewOverlay").hidden, false);
    assert.equal(context.document.querySelector('[name="operationTypeId"]').value, "sale");
    assert.match(context.document.querySelector('[name="rawPropertyTypeText"]').value, /أرض/u);
    assert.match(context.document.querySelector('[name="rawCityText"]').value, /المدينة المنورة/u);
    assert.equal(context.document.querySelector('[name="salePrice"]').value, "1600000");
    for (const name of ["annualRent", "monthlyRent", "optionalMonthlyRent", "budget"]) {
      assert.equal(context.document.querySelector(`[name="${name}"]`), null, `${name} must not render`);
    }
    assert.equal(context.document.querySelector('[data-search-for="propertyTypeId"]'), null);
    assert.equal(context.document.querySelector('[name="advertiserPhoneLocal"]').value, "0507561577");
  } finally {
    context.close();
  }
});

test("rental Review shows rent fields and hides sale price", async () => {
  const { context, module } = await loadController();
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "شقة للإيجار حي السلام، 4 غرف صالة مطبخ 3 دورات مياه الدور الأول 22000 ريال سنويًا على دفعتين بعد أول 6 أشهر يمكن الاستمرار شهريًا بـ1850 ريال";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();

    assert.equal(context.document.querySelector('[name="operationTypeId"]').value, "rent");
    assert.equal(context.document.querySelector('[name="annualRent"]').value, "22000");
    assert.equal(context.document.querySelector('[name="rooms"]').value, "4");
    assert.equal(context.document.querySelector('[name="salePrice"]'), null);
    assert.equal(context.document.querySelector('[name="budget"]'), null);
    assert.ok(context.document.querySelector('[name="annualRent"]'));
    assert.equal(context.document.querySelector('[data-search-for="operationTypeId"]'), null);
  } finally {
    context.close();
  }
});

test("rent Review omits optional monthly field when extraction has no such meaning", async () => {
  const { context, module } = await loadController();
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "شقة للإيجار حي السلام، 4 غرف 3 دورات مياه الدور الأول 22000 ريال سنويًا على دفعتين";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();
    assert.ok(context.document.querySelector('[name="annualRent"]'));
    assert.equal(context.document.querySelector('[name="optionalMonthlyRent"]'), null);
    assert.equal(context.document.querySelector('[name="salePrice"]'), null);
  } finally {
    context.close();
  }
});

test("unknown transaction keeps plain location fields visible without catalog pickers", async () => {
  const { context, module } = await loadController();
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "أرض في المدينة المنورة حي الرانوناء، المساحة 431.75 م²";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();

    assert.equal(context.document.querySelector('[name="operationTypeId"]').value, "sale");
    assert.ok(context.document.querySelector('[name="rawPropertyTypeText"]'));
    assert.ok(context.document.querySelector('[name="rawCityText"]'));
    assert.ok(context.document.querySelector('[name="rawNeighborhoodText"]'));
    assert.equal(context.document.querySelector('[data-search-for="operationTypeId"]'), null);
    assert.equal(context.document.querySelector('[data-search-for="propertyTypeId"]'), null);
  } finally {
    context.close();
  }
});

test("NEW INTAKE clears prior Riyadh context before Madinah extraction", async () => {
  const { context, module } = await loadController();
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "أرض للبيع في الرياض حي النرجس، المساحة 500 م² السعر المطلوب 600000 ريال";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();
    assert.match(context.document.querySelector('[name="rawCityText"]').value, /الرياض/u);

    input.value = "أرض للبيع في المدينة المنورة حي الرانوناء، المساحة 431.75 م² السعر المطلوب 580000 ريال";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    assert.equal(module.__test.getIntakeContext(), null);
    assert.equal(context.document.getElementById("opportunityReviewOverlay").hidden, true);

    await module.__test.startExecute();
    assert.match(context.document.querySelector('[name="rawCityText"]').value, /المدينة المنورة/u);
    assert.notEqual(context.document.querySelector('[name="rawCityText"]').value, "الرياض");
    assert.match(module.__test.getIntakeContext().listingText, /المدينة المنورة/);
  } finally {
    context.close();
  }
});

test("bare hostname/path is normalized and sent through the canonical intake pipeline", async () => {
  const calls = [];
  const fetchStub = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body || "{}") });
    if (String(url).includes("/pipeline/canonical-intake")) {
      return Response.json({
        ok: true,
        analysisStatus: "analysis_complete",
        opportunityId: "opp_test_url",
        importJobId: "job_test_url",
        idempotencyKey: "ci_test",
        fields: {
          propertyType: "أرض",
          city: "المدينة المنورة",
          district: "الرانوناء",
          purpose: "SALE",
          opportunityKind: "OFFER"
        },
        rawText: "أرض للبيع في المدينة المنورة حي الرانوناء",
        missingFields: ["salePrice", "area"],
        confidence: 72
      });
    }
    return Response.json({ ok: false, error: "unexpected_url" });
  };
  const { context, module } = await loadController(fetchStub);
  try {
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "a.aqar.fm/r/92f89b67";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    await module.__test.startExecute();
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/pipeline/canonical-intake"));
    assert.equal(calls[0].body.sourceUrl, "https://a.aqar.fm/r/92f89b67");
    assert.equal(context.document.getElementById("opportunityReviewOverlay").hidden, false);
  } finally {
    context.close();
  }
});

test("hanging extraction aborts into failed state and releases busy UI", async () => {
  let aborted = false;
  const fetchStub = async (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      aborted = true;
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });
  const { context, module } = await loadController(fetchStub);
  try {
    module.__test.setExtractionTimeoutMs(10);
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "https://example.test/listing";
    input.dispatchEvent(new context.window.Event("input", { bubbles: true }));
    const started = Date.now();
    await module.__test.startExecute();

    assert.equal(aborted, true);
    assert.ok(Date.now() - started < 1000);
    assert.equal(context.document.getElementById("addOpportunityStatus").dataset.state, "failed");
    assert.match(context.document.getElementById("addOpportunityStatus").textContent, /تعذر إكمال تحليل الإعلان/);
    assert.equal(context.document.getElementById("addOpportunitySubmit").disabled, false);
    assert.equal(context.document.getElementById("addOpportunitySubmit").textContent, "إرسال");
    assert.equal(context.document.getElementById("opportunityReviewOverlay").hidden, true);
    assert.equal(module.__test.getIntakeContext(), null);
    assert.equal(context.document.getElementById("addOpportunityRetry").hidden, false);
  } finally {
    context.close();
  }
});

test("voice-bound intake context approves when composer input is empty", async () => {
  const { context, module } = await loadController();
  try {
    const summary = "شقة للبيع الرياض النرجس 1200000";
    module.__test.setIntakeContextForTest({
      sourceIdentity: module.__test.intakeIdentity(summary, null),
      inputText: summary,
      listingText: summary,
      sourceType: "text"
    });
    assert.equal(
      module.__test.sourceMaterialChangedSinceIntake(),
      false
    );
    assert.equal(context.document.getElementById("addOpportunityInput").value, "");
  } finally {
    context.close();
  }
});

test("changed composer text still blocks approve with context_changed", async () => {
  const { context, module } = await loadController();
  try {
    const text = "أرض للبيع في الرياض حي النرجس";
    module.__test.setIntakeContextForTest({
      sourceIdentity: module.__test.intakeIdentity(text, null),
      inputText: text,
      listingText: text,
      sourceType: "text"
    });
    const input = context.document.getElementById("addOpportunityInput");
    input.value = "أرض للبيع في جدة حي السلام";
    assert.equal(module.__test.sourceMaterialChangedSinceIntake(), true);
  } finally {
    context.close();
  }
});
