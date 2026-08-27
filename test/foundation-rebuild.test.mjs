import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { resolveCanonicalOpportunity } from "../public/js/canonical-opportunity-domain.js";
import { mapOpportunityDetailsV2ViewModel } from "../public/js/opportunity-details-v2-domain.js";
import { completenessLine } from "../public/js/v2/opportunity-details/view-model.js";
import { buildOpportunityDataCardV2 } from "../public/js/v2/opportunity-details/data-card.js";
import {
  groupMatchItems,
  livingStageAfterPartyAction,
  LIVING_TASK_STAGE,
  matchGroupKey,
  rankMatchCandidates,
  snapshotHasPermittedDetail
} from "../public/js/match-group-domain.js";
import { mapOperationsItemsToDailyTasks } from "../src/v2/content/daily-tasks/domain.js";
import { buildDailyTaskCardHtml } from "../src/v2/content/daily-tasks/card.js";
import { currentContentView } from "../public/js/v2/domain.js";
import {
  buildPartySnapshot,
  buildShareSnapshot,
  revealedDetailFromSnapshot,
  sanitizePartyPublicView
} from "../public/js/party-session-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";
import { handlePartySessionGet, handlePartySessionMint, handlePartySessionReply, handlePartySessionBundle } from "../worker/src/party-session-service.js";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

import {
  firestoreOfficeId,
  officeAuthorizationKey,
  officeIdsEquivalent
} from "../public/js/office-id-domain.js";

function mockHelpers(store) {
  return {
    firestoreOfficeId: (value) => firestoreOfficeId(value),
    officeAuthorizationKey: (value) => officeAuthorizationKey(value),
    officeIdsEquivalent: (left, right) => officeIdsEquivalent(left, right),
    authorizeOfficeRequest: async () => {},
    assertFirebaseSecrets: () => {},
    getGoogleAccessToken: async () => "access-token",
    DEFAULT_PROJECT_ID: "iaqar-ai-staging",
    cleanText: (value) => String(value ?? "").replace(/\s+/g, " ").trim(),
    appError(code, status, message) {
      const error = new Error(message);
      error.code = code;
      error.status = status;
      throw error;
    },
    jsonResponse(body, status = 200) {
      return { status, body };
    },
    sha256Hex: async (value) => sha256Hex(value),
    firestoreFieldsToJs: (fields) => fields || {},
    firestoreString: (value) => ({ stringValue: String(value) }),
    firestoreBoolean: (value) => ({ booleanValue: Boolean(value) }),
    firestoreInteger: (value) => ({ integerValue: String(Number(value) || 0) }),
    firestoreTimestamp: (value) => ({ timestampValue: (value instanceof Date ? value : new Date(value)).toISOString() }),
    jsToFirestoreValue(value) {
      return { mapValue: { fields: value } };
    },
    consumePublicRateLimit: () => ({ ok: true }),
    publicRateLimitKey: ({ route }) => route,
    PUBLIC_RATE_LIMITS: { PUBLIC_PARTY: { limit: 60, windowMs: 60_000 } },
    async getFirestoreDocument({ segments }) {
      return store[segments.join("/")] || null;
    },
    async setFirestoreDocument({ segments, fields }) {
      const key = segments.join("/");
      const current = store[key]?.fields || {};
      const next = { ...current };
      for (const [name, value] of Object.entries(fields || {})) {
        next[name] = value?.stringValue !== undefined ? value.stringValue : value;
      }
      store[key] = { fields: next };
    }
  };
}

const INCOMPLETE = {
  id: "opp_incomplete",
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "العقار",
  city: "غير محدد",
  district: "",
  salePrice: 0,
  advertiserRole: "OWNER",
  contactPhone: "0511123456",
  area: 0
};

const COMPLETE = {
  id: "opp_complete",
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "السكب",
  salePrice: 850000,
  area: 1175,
  advertiserRole: "OWNER",
  contactPhone: "0511123456",
  streetWidth: 20,
  facing: "شمالية",
  plotNumber: "14"
};

test("TEST A: completeness matches visible incomplete values, not a hardcoded 6/6", () => {
  const canonical = resolveCanonicalOpportunity(INCOMPLETE);
  assert.equal(canonical.propertyType, "");
  assert.equal(canonical.city, "");
  assert.equal(canonical.price, "");
  const vm = mapOpportunityDetailsV2ViewModel(INCOMPLETE.id, INCOMPLETE);
  const html = buildOpportunityDataCardV2(vm);
  const line = completenessLine(vm);
  assert.equal(line.includes("6 من 6"), false);
  assert.match(html, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(html.includes("20,000"), false);
  assert.equal((html.match(/غير محدد/g) || []).length > 0, true);
});

test("TEST B: complete opportunity reports 6/6 from the same view-model", () => {
  const vm = mapOpportunityDetailsV2ViewModel(COMPLETE.id, COMPLETE);
  assert.equal(completenessLine(vm), "6 من 6 بيانات مكتملة");
  assert.match(vm.price, /850,000/);
  assert.match(vm.area, /1,175/);
  assert.equal(buildOpportunityDataCardV2(vm).includes("غير محدد"), false);
});

test("TEST C: one request + four matches collapse to one daily task", () => {
  const now = new Date("2026-08-25T10:00:00.000+03:00");
  const items = [1, 2, 3, 4].map((index) => ({
    operationType: "MATCH_REVIEW",
    matchId: `match_${index}`,
    opportunityId: "req_awali",
    clientRequestId: "req_awali",
    ownerOfferId: `offer_${index}`,
    matchGroupId: "req_awali",
    sourceCollection: "clients",
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    purpose: "PURCHASE",
    district: "العوالي",
    candidateSalePrice: 400000 + index * 25000,
    candidateArea: 100 + index * 5,
    opportunityScore: 90 - index,
    score: 80 - index
  }));
  const views = mapOperationsItemsToDailyTasks(items, now);
  assert.equal(views.length, 1);
  assert.equal(views[0].candidateCount, 4);
  assert.match(views[0].candidateCountLine, /4 عروض مناسبة/);
  assert.equal(views[0].id, "mg_req_awali");
});

test("TEST D: expanded match group ranks candidates by current scores", () => {
  const items = [
    { matchId: "m2", opportunityId: "req_1", clientRequestId: "req_1", ownerOfferId: "offer_2", opportunityScore: 70, candidateSalePrice: 400000, propertyType: "شقة", district: "العوالي" },
    { matchId: "m1", opportunityId: "req_1", clientRequestId: "req_1", ownerOfferId: "offer_1", opportunityScore: 95, isBestOpportunity: true, candidateSalePrice: 485000, candidateArea: 125, propertyType: "شقة", district: "العوالي" }
  ];
  const ranked = rankMatchCandidates(items);
  assert.equal(ranked[0].matchId, "m1");
  const grouped = groupMatchItems(items);
  assert.equal(grouped.length, 1);
  const views = mapOperationsItemsToDailyTasks(items.map((item) => ({ ...item, operationType: "MATCH_REVIEW" })));
  const html = buildDailyTaskCardHtml(views[0], { open: true });
  assert.match(html, /طلب العميل/);
  assert.match(html, /العرض المطابق/);
  assert.match(html, /مراجعة المطابقات/);
  assert.equal(html.includes("إرسال للمالك"), false);
  assert.match(html, /مرشح 1/);
});

test("TEST O/P: rejecting candidate 1 stays in the same group; exhausted group disappears", () => {
  const items = [
    { operationType: "MATCH_REVIEW", matchId: "m1", opportunityId: "req_1", clientRequestId: "req_1", ownerOfferId: "offer_1", opportunityScore: 90, livingStage: "CLIENT_REJECTED", rejectedMatchIds: ["m1"], propertyType: "شقة", district: "العوالي" },
    { operationType: "MATCH_REVIEW", matchId: "m2", opportunityId: "req_1", clientRequestId: "req_1", ownerOfferId: "offer_2", opportunityScore: 80, propertyType: "شقة", district: "العوالي" }
  ];
  const views = mapOperationsItemsToDailyTasks(items);
  assert.equal(views.length, 1);
  assert.equal(views[0].matchId, "m2");
  assert.match(views[0].statusLabel, /غير مناسبة/);
  const exhausted = mapOperationsItemsToDailyTasks([
    { operationType: "MATCH_REVIEW", matchId: "m1", opportunityId: "req_1", clientRequestId: "req_1", livingStage: "CLIENT_REJECTED", rejectedMatchIds: ["m1"] }
  ]);
  assert.equal(exhausted.length, 0);
});

test("TEST H/I: existing snapshot details reveal immediately; missing info needs broker", () => {
  const snapshot = buildPartySnapshot({
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    salePrice: 850000,
    area: 1175
  });
  assert.equal(snapshotHasPermittedDetail(snapshot, "detail_price"), true);
  assert.equal(snapshotHasPermittedDetail(snapshot, "detail_location"), false);
  const price = livingStageAfterPartyAction({ party: "client", action: "detail_price", followUp: true, snapshot });
  assert.equal(price.revealed, true);
  assert.equal(price.stage, LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS);
  const missing = livingStageAfterPartyAction({ party: "client", action: "detail_location", followUp: true, snapshot });
  assert.equal(missing.stage, LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO);
  assert.equal(revealedDetailFromSnapshot(snapshot, "detail_price").value.includes("850,000"), true);
});

test("TEST K: owner is contacted only when viewing is requested", () => {
  const interested = livingStageAfterPartyAction({ party: "client", action: "interested" });
  assert.equal(interested.ownerContactNeeded, false);
  const viewing = livingStageAfterPartyAction({ party: "client", action: "want_viewing", followUp: true });
  assert.equal(viewing.ownerContactNeeded, true);
  assert.equal(viewing.stage, LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION);
});

test("TEST F/Q: frozen share snapshot is what the party sees, even if the live offer later changes", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } },
    "offices/office-1/opportunities/offer_1": {
      fields: { opportunityKind: "OFFER", purpose: "SALE", propertyType: "أرض", district: "السكب", salePrice: 850000, area: 1175 }
    },
    "offices/office-1/matches/match_1": {
      fields: { ownerOfferId: "offer_1", clientRequestId: "req_1", opportunityId: "req_1", sourceCollection: "clients" }
    }
  };
  const helpers = mockHelpers(store);
  const minted = await handlePartySessionMint({
    request: { json: async () => ({ officeId: "office-1", matchId: "match_1", party: "client", offerId: "offer_1" }) },
    env: { DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: "iaqar-ai-staging" },
    requestId: "s1",
    helpers
  });
  store["offices/office-1/opportunities/offer_1"].fields.salePrice = 820000;
  const loaded = await handlePartySessionGet({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "s2",
    helpers,
    ip: "1.1.1.1"
  });
  assert.match(loaded.body.view.property.priceLabel, /850,000/);
  assert.equal(loaded.body.view.property.priceLabel.includes("820,000"), false);
  assert.equal(loaded.body.view.property.propertyType, "أرض");
  assert.equal(JSON.stringify(loaded.body.view.property).includes("820,000"), false);
});

test("TEST G/J/N: client page keeps the listing and never leaks owner phone", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } },
    "offices/office-1/opportunities/offer_1": {
      fields: {
        opportunityKind: "OFFER",
        purpose: "SALE",
        propertyType: "أرض",
        district: "السكب",
        salePrice: 850000,
        area: 1175,
        advertiserPhoneNormalized: "0500000000",
        ownerName: "خالد"
      }
    },
    "offices/office-1/matches/match_1": {
      fields: { ownerOfferId: "offer_1", clientRequestId: "req_1" }
    }
  };
  const helpers = mockHelpers(store);
  const minted = await handlePartySessionMint({
    request: { json: async () => ({ officeId: "office-1", matchId: "match_1", party: "client", offerId: "offer_1" }) },
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "g1",
    helpers
  });
  const before = await handlePartySessionGet({
    token: minted.body.token, env: { DEPLOYMENT_ENV: "staging" }, requestId: "g2", helpers, ip: "1.1.1.1"
  });
  const html = buildPartyShellHtml(before.body.view);
  assert.match(html, /data-party-coordination-form|ما رأيك بالعقار؟/);
  assert.match(html, />مهتم</);
  assert.match(html, /850,000/);
  assert.equal(html.includes("0500000000"), false);
  const details = await handlePartySessionBundle({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: {
      json: async () => ({
        bundle: {
          interest: "interested",
          nextAction: "more_info",
          infoNeeds: ["price"]
        }
      })
    },
    requestId: "g3",
    helpers,
    ip: "1.1.1.1"
  });
  const detailsHtml = buildPartyShellHtml(details.body.view);
  assert.match(detailsHtml, /850,000/);
  assert.match(detailsHtml, /تم تسجيل ردك/);

  const mintedInterested = await handlePartySessionMint({
    request: { json: async () => ({ officeId: "office-1", matchId: "match_interest", party: "client", offerId: "offer_1" }) },
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "g4",
    helpers
  });
  store["offices/office-1/matches/match_interest"] = {
    fields: { ownerOfferId: "offer_1", clientRequestId: "req_1" }
  };
  const interested = await handlePartySessionBundle({
    token: mintedInterested.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: {
      json: async () => ({
        bundle: {
          interest: "interested",
          nextAction: "viewing",
          viewingWindows: ["tomorrow_evening"]
        }
      })
    },
    requestId: "g5",
    helpers,
    ip: "1.1.1.1"
  });
  const interestedHtml = buildPartyShellHtml(interested.body.view);
  assert.match(interestedHtml, /850,000/);
  assert.match(interestedHtml, /تم تسجيل ردك/);
  assert.match(interestedHtml, /مهتم|معاينة/);
});

test("TEST M/L: owner page identifies the property and never shows client phone", () => {
  const view = sanitizePartyPublicView({
    party: "owner",
    snapshot: buildPartySnapshot(COMPLETE),
    officeName: "مكتب النور"
  });
  assert.match(view.ownerClientStatus, /يوجد عميل مهتم بعقارك/);
  assert.equal(view.property.plotNumber, "14");
  const html = buildPartyShellHtml(view);
  assert.match(html, /أرض/);
  assert.match(html, /السكب/);
  assert.equal(JSON.stringify(view).includes("0511123456"), false);
  assert.equal(html.includes("clientPhone"), false);
});

test("TEST S: tab isolation stays in the content view mapper", () => {
  assert.equal(currentContentView({ hash: "" }, { main: "opportunities" }).name, "opportunities");
  assert.equal(currentContentView({ hash: "" }, { main: "operations" }).name, "tasks");
  const mount = readFileSync(path.join(root, "src", "v2", "content", "mount.js"), "utf8");
  assert.match(mount, /unmountDailyTasksContentV2/);
  assert.match(mount, /view\.name === "opportunities"/);
  assert.match(mount, /view\.name === "tasks"/);
});

test("TEST R: bank summary string is not also pushed into the status line helper", () => {
  const bank = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  assert.match(bank, /bankStatusAfterListRender/);
  assert.match(bank, /function bankStatusAfterListRender/);
  assert.equal((bank.match(/setStatus\(`\$\{rowsCountLabel\(\)\} — تم فتح التفاصيل`\)/g) || []).length, 0);
});

test("TEST E: sending the best candidate builds a party page from the linked offer", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } },
    "offices/office-1/opportunities/offer_best": {
      fields: {
        opportunityKind: "OFFER",
        purpose: "SALE",
        propertyType: "شقة",
        district: "العوالي",
        salePrice: 485000,
        area: 125
      }
    },
    "offices/office-1/matches/match_best": {
      fields: { ownerOfferId: "offer_best", clientRequestId: "req_awali", opportunityId: "req_awali" }
    }
  };
  const minted = await handlePartySessionMint({
    request: { json: async () => ({ officeId: "office-1", matchId: "match_best", party: "client", offerId: "offer_best" }) },
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "e1",
    helpers: mockHelpers(store)
  });
  const loaded = await handlePartySessionGet({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "e2",
    helpers: mockHelpers(store),
    ip: "1.1.1.1"
  });
  const html = buildPartyShellHtml(loaded.body.view);
  assert.match(html, /شقة/);
  assert.match(html, /العوالي/);
  assert.match(html, /485,000/);
  assert.match(html, /125/);
  assert.equal(html.includes("20,000"), false);
  assert.equal(html.includes(">العقار<"), false);
});

test("TEST T: livingStage survives remapping as the same match-group task", () => {
  const items = [1, 2, 3, 4].map((index) => ({
    operationType: "MATCH_REVIEW",
    matchId: `match_${index}`,
    opportunityId: "req_awali",
    clientRequestId: "req_awali",
    ownerOfferId: `offer_${index}`,
    matchGroupId: "req_awali",
    sourceCollection: "clients",
    opportunityKind: "REQUEST",
    propertyType: "شقة",
    district: "العوالي",
    livingStage: "WAITING_CLIENT",
    opportunityScore: 90 - index
  }));
  const first = mapOperationsItemsToDailyTasks(items);
  const reloaded = mapOperationsItemsToDailyTasks(items);
  assert.equal(first.length, 1);
  assert.equal(reloaded.length, 1);
  assert.equal(first[0].id, "mg_req_awali");
  assert.equal(reloaded[0].id, first[0].id);
  assert.equal(reloaded[0].livingStage, "WAITING_CLIENT");
  const html = buildDailyTaskCardHtml(reloaded[0]);
  assert.equal((html.match(/بانتظار رد العميل/g) || []).length, 1);
});

test("appointment confirmed copy appears once", () => {
  const views = mapOperationsItemsToDailyTasks([{
    operationType: "MATCH_REVIEW",
    matchId: "m_visit",
    opportunityId: "req_sakb",
    clientRequestId: "req_sakb",
    ownerOfferId: "offer_sakb",
    matchGroupId: "req_sakb",
    sourceCollection: "clients",
    propertyType: "أرض",
    district: "السكب",
    livingStage: "APPOINTMENT_CONFIRMED",
    viewingAt: "2026-08-26T15:00:00.000Z",
    candidateSalePrice: 850000,
    candidateArea: 1175
  }], new Date("2026-08-26T15:00:00.000Z"));
  assert.equal(views.length, 1);
  const html = buildDailyTaskCardHtml(views[0]);
  assert.equal((html.match(/الموعد مؤكد/g) || []).length, 1);
  assert.match(html, /الموعد مؤكد/);
  assert.equal(html.includes("معاينة اليوم"), false);
  assert.equal((html.match(/cv2-exec-status/g) || []).length, 0);
});

test("share snapshot envelope keeps office data canonical and party history frozen", () => {
  const share = buildShareSnapshot({
    shareId: "ps_1",
    matchId: "match_1",
    partyRole: "client",
    opportunityId: "offer_1",
    record: COMPLETE
  });
  assert.equal(share.snapshotVersion, 1);
  assert.equal(share.permitted.priceLabel.includes("850,000"), true);
  assert.equal(matchGroupKey({ clientRequestId: "req_1", opportunityId: "req_1", sourceCollection: "clients" }), "req_1");
});
