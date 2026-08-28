import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_STATUS,
  buildImportIdempotencyKey,
  importJobDocumentIdFromFingerprint,
  normalizeCanonicalParts,
  opportunityDocumentIdFromFingerprint,
  sourceDocumentIdFromFingerprint
} from "../src/canonical-intake-domain.js";
import {
  completeCanonicalAnalysis,
  startCanonicalIntake
} from "../src/canonical-intake-service.js";

const OFFICE_ID = "staging-logo-live-20260807";
const BROKER_ID = "broker-qa-1";
const INTAKE_TEXT = "طلب إيجار شقة المدينة المنورة حي الوبرة غرفتين ميزانية 16000 ريال جوال 0511123456";

function jsToFirestoreFields(obj = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) fields[key] = { nullValue: null };
    else if (typeof value === "number") fields[key] = { integerValue: String(value) };
    else if (typeof value === "boolean") fields[key] = { booleanValue: value };
    else fields[key] = { stringValue: String(value) };
  }
  return fields;
}

function firestoreFieldsToJs(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!value || typeof value !== "object") continue;
    if ("stringValue" in value) out[key] = value.stringValue;
    else if ("integerValue" in value) out[key] = Number(value.integerValue);
    else if ("booleanValue" in value) out[key] = value.booleanValue;
    else if ("nullValue" in value) out[key] = null;
    else if ("timestampValue" in value) out[key] = value.timestampValue;
  }
  return out;
}

function createCanonicalTestCtx(store = {}) {
  const writes = [];
  let parseCalls = 0;

  const ctx = {
    projectId: "iaqar-ai-staging",
    accessToken: "token",
    requestUrl: "https://worker.test",
    env: {},
    identity: { uid: BROKER_ID },
    firestoreOfficeId: (id) => String(id || "").trim(),
    cleanText: (value, max = 500) => String(value ?? "").trim().slice(0, max),
    appError: (code, status, message) => {
      const error = new Error(message || code);
      error.code = code;
      error.status = status;
      throw error;
    },
    getFirestoreDocument: async ({ segments, allowMissing = false }) => {
      const key = segments.join("/");
      const doc = store[key];
      if (!doc) {
        if (allowMissing) return null;
        throw new Error(`missing:${key}`);
      }
      return { fields: doc };
    },
    setFirestoreDocument: async ({ segments, fields }) => {
      const key = segments.join("/");
      store[key] = fields;
      writes.push({ key, fields });
    },
    firestoreFieldsToJs: firestoreFieldsToJs,
    compactFields: (fields) => fields,
    firestoreString: (value) => ({ stringValue: String(value) }),
    firestoreOptionalString: (value) => (
      value ? { stringValue: String(value) } : { nullValue: null }
    ),
    firestoreInteger: (value) => ({ integerValue: String(value) }),
    firestoreBoolean: (value) => ({ booleanValue: value }),
    firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() }),
    parseRealEstateMessage: (text) => {
      parseCalls += 1;
      return {
        kind: "client_request",
        propertyType: "شقة",
        city: "المدينة المنورة",
        district: "الوبرة",
        transactionType: "rent",
        price: 16000,
        rooms: 0,
        phone: "0511123456",
        senderName: ""
      };
    },
    opportunityPatchToFirestoreFields: jsToFirestoreFields,
    LIFECYCLE_STATUS: { NEW: "ACTIVE" },
    normalizeListingFetchUrl: () => "",
    fetchListingPage: async () => ({ ok: false }),
    extractImageTextFromMediaPath: async () => ({ ok: false }),
    extractAudioFromMediaPath: async () => ({ ok: false })
  };

  return {
    ctx,
    store,
    writes,
    getParseCalls: () => parseCalls,
    resetParseCalls: () => { parseCalls = 0; }
  };
}

test("duplicate complete canonical intake hydrates stored fields without rerunning parser", async () => {
  const { ctx, store, writes, getParseCalls, resetParseCalls } = createCanonicalTestCtx();
  const body = {
    officeId: OFFICE_ID,
    brokerId: BROKER_ID,
    contentType: "text",
    text: INTAKE_TEXT
  };

  const first = await startCanonicalIntake(body, ctx);
  assert.equal(first.duplicate, false);
  assert.equal(first.analysisStatus, ANALYSIS_STATUS.COMPLETE);
  assert.equal(first.fields?.purpose, "RENT");
  assert.equal(first.fields?.opportunityKind, "REQUEST");
  assert.equal(first.fields?.propertyType, "شقة");
  assert.equal(first.fields?.district, "الوبرة");
  assert.equal(first.fields?.priceOrBudget, 16000);
  assert.ok(first.fields?.contactPhone);

  const opportunityWrites = writes.filter((w) => w.key.includes("/opportunities/"));
  assert.ok(opportunityWrites.length >= 1);
  assert.ok(getParseCalls() >= 1);

  resetParseCalls();
  const writesBeforeDuplicate = writes.length;

  const duplicate = await startCanonicalIntake(body, ctx);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.analysisStatus, ANALYSIS_STATUS.COMPLETE);
  assert.equal(duplicate.opportunityId, first.opportunityId);
  assert.equal(duplicate.importJobId, first.importJobId);
  assert.equal(duplicate.fields?.purpose, first.fields?.purpose);
  assert.equal(duplicate.fields?.opportunityKind, first.fields?.opportunityKind);
  assert.equal(duplicate.fields?.propertyType, first.fields?.propertyType);
  assert.equal(duplicate.fields?.city, first.fields?.city);
  assert.equal(duplicate.fields?.district, first.fields?.district);
  assert.equal(duplicate.fields?.priceOrBudget, first.fields?.priceOrBudget);
  assert.equal(duplicate.fields?.contactPhone, first.fields?.contactPhone);
  assert.ok(Object.keys(duplicate.fields || {}).length > 0);
  assert.equal(getParseCalls(), 0);
  assert.equal(writes.length, writesBeforeDuplicate);

  const opportunityIds = new Set(
    writes
      .filter((w) => w.key.includes("/opportunities/"))
      .map((w) => w.key.split("/opportunities/")[1])
  );
  assert.equal(opportunityIds.size, 1);
});

test("duplicate pending canonical intake is not falsely marked complete", async () => {
  const parts = normalizeCanonicalParts({
    contentType: "text",
    text: INTAKE_TEXT
  });
  const idempotencyKey = await buildImportIdempotencyKey(OFFICE_ID, parts, "");
  const fingerprint = idempotencyKey.replace(/^ci_/, "");
  const opportunityId = opportunityDocumentIdFromFingerprint(fingerprint);
  const importJobId = importJobDocumentIdFromFingerprint(fingerprint);
  const sourceId = sourceDocumentIdFromFingerprint(fingerprint);
  const { ctx, writes, getParseCalls } = createCanonicalTestCtx({
    [`offices/${OFFICE_ID}/importJobs/${importJobId}`]: jsToFirestoreFields({
      analysisStatus: ANALYSIS_STATUS.PENDING,
      opportunityId,
      sourceId,
      retryCount: 0
    })
  });

  const result = await startCanonicalIntake({
    officeId: OFFICE_ID,
    brokerId: BROKER_ID,
    contentType: "text",
    text: INTAKE_TEXT
  }, ctx);

  assert.equal(result.duplicate, true);
  assert.equal(result.analysisStatus, ANALYSIS_STATUS.PENDING);
  assert.notEqual(result.analysisStatus, ANALYSIS_STATUS.COMPLETE);
  assert.equal(result.fields, undefined);
  assert.equal(getParseCalls(), 0);
  assert.equal(writes.length, 0);
});
