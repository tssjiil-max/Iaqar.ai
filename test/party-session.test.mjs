import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildPartyReviewUrl,
  buildPartySnapshot,
  createOpaquePartyToken,
  isOpaquePartyToken,
  PARTY_INVALID_COPY,
  PARTY_REPLY_RECORDED,
  PARTY_SESSION_STATUS,
  partySessionKey,
  readPartyTokenFromSearch,
  sanitizePartyPublicView
} from "../public/js/party-session-domain.js";
import {
  buildPartyErrorHtml,
  buildPartyShellHtml,
  partyShellHasBrokerChrome
} from "../public/js/party-shell-ui.js";
import {
  handlePartySessionGet,
  handlePartySessionMint,
  handlePartySessionReply
} from "../worker/src/party-session-service.js";

import {
  firestoreOfficeId,
  officeAuthorizationKey,
  officeIdsEquivalent
} from "../public/js/office-id-domain.js";

const root = path.resolve(import.meta.dirname, "..");

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

test("opaque tokens are hex-only and Base64 JSON is never a review URL", () => {
  const token = createOpaquePartyToken();
  assert.equal(isOpaquePartyToken(token), true);
  assert.equal(isOpaquePartyToken("eyJtYXRjaElkIjoibWF0Y2hfMSJ9"), false);
  assert.equal(buildPartyReviewUrl({ origin: "https://example.test", token: "eyJtYXRjaElkIjoibWF0Y2hfMSJ9" }), "");
  assert.equal(readPartyTokenFromSearch(`?cv2Party=${token}`), token);
  assert.equal(partySessionKey("match_1", "client"), "match_1__client");
  assert.notEqual(partySessionKey("match_1", "client"), partySessionKey("match_1", "owner"));
});

test("public party view never includes owner contact, scores, or ids", () => {
  const view = sanitizePartyPublicView({
    party: "client",
    status: PARTY_SESSION_STATUS.ACTIVE,
    officeName: "مكتب النور",
    snapshot: buildPartySnapshot({
      propertyType: "أرض",
      purpose: "SALE",
      salePrice: 500000,
      district: "عروة",
      area: 420,
      rooms: 0
    })
  });
  assert.equal(view.title, "عقار مناسب لطلبك");
  assert.equal(view.officeName, "مكتب النور");
  assert.equal(view.property.priceLabel.includes("500,000"), true);
  assert.equal(view.property.locationLabel, "حي عروة");
  assert.equal(view.property.propertyType, "أرض");
  assert.equal(view.property.purposeLabel, "للبيع");
  assert.equal(view.actions.map((item) => item.label).join("|"), "مهتم|أحتاج تفاصيل أكثر|غير مناسب");
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("matchId"), false);
  assert.equal(serialized.includes("ownerName"), false);
  assert.equal(serialized.includes("0511111111"), false);
  assert.equal(view.matchId, undefined);
  const sanitized = sanitizePartyPublicView({
    party: "client",
    snapshot: { typePurpose: "أرض", priceLabel: "اتصل 0512345678" }
  });
  assert.equal(JSON.stringify(sanitized).includes("0512345678"), false);
  assert.equal(sanitized.property.priceLabel.includes("051"), false);
});

test("owner view uses a different title and never includes client contact", () => {
  const view = sanitizePartyPublicView({
    party: "owner",
    status: PARTY_SESSION_STATUS.ACTIVE,
    officeName: "مكتب النور",
    snapshot: { typePurpose: "أرض للبيع", priceLabel: "500,000 ر.س", locationLabel: "حي عروة" }
  });
  assert.equal(view.title, "عميل مهتم بعقارك");
  assert.equal(view.ownerClientStatus, "يوجد عميل مهتم بعقارك");
  assert.equal(view.actions.some((item) => item.label === "العقار متاح"), true);
  assert.equal(view.actions.some((item) => item.label === "تأكيد الموعد"), false);
  assert.equal(JSON.stringify(view).includes("clientName"), false);
});

test("completed reply hides actions and shows recorded copy", () => {
  const view = sanitizePartyPublicView({
    party: "client",
    status: PARTY_SESSION_STATUS.REPLIED,
    replyAction: "interested",
    snapshot: { typePurpose: "أرض للبيع" }
  });
  assert.equal(view.replied, true);
  assert.deepEqual(view.actions, []);
  assert.equal(view.replyLabel, "مهتم");
  assert.equal(view.followUpActions.some((item) => item.label === "أريد معاينة"), true);
  const html = buildPartyShellHtml(view);
  assert.match(html, new RegExp(PARTY_REPLY_RECORDED));
  assert.match(html, /مهتم/);
  assert.match(html, /أرض للبيع/);
  assert.match(html, /أريد معاينة/);
  assert.match(html, /المعلومات والصور كافية/);
  assert.equal(partyShellHasBrokerChrome(html), false);
});

test("party error page uses the invalid-link copy and no broker chrome", () => {
  const html = buildPartyErrorHtml();
  assert.match(html, new RegExp(PARTY_INVALID_COPY));
  assert.equal(partyShellHasBrokerChrome(html), false);
  assert.equal(html.includes("access-gate"), false);
});

test("access-gate IIFE returns before creating the role chooser when cv2Party is present", async () => {
  const { JSDOM } = await import("jsdom");
  const source = readFileSync(path.join(root, "public", "js", "access-gate.js"), "utf8");
  const token = "a".repeat(64);
  const dom = new JSDOM(`<!doctype html><html><body><div class="app"></div></body></html>`, {
    url: `https://example.test/?cv2Party=${token}`,
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  dom.window.eval(source);
  assert.equal(dom.window.document.documentElement.dataset.partyMode, "1");
  assert.equal(dom.window.document.documentElement.classList.contains("is-party-mode"), true);
  assert.equal(dom.window.document.getElementById("accessGate"), null);
  assert.equal(dom.window.document.body.classList.contains("access-locked"), false);
  assert.equal(dom.window.document.body.textContent.includes("أنا عميل"), false);
  assert.equal(dom.window.document.body.textContent.includes("أنا مالك"), false);
  assert.equal(dom.window.document.body.textContent.includes("تسجيل دخول مكتب"), false);
});

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

function mintRequest(body) {
  return { json: async () => body };
}

test("worker mints an opaque session and public GET returns only the sanitized view", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } }
  };
  const helpers = mockHelpers(store);
  const minted = await handlePartySessionMint({
    request: mintRequest({
      officeId: "office-1",
      matchId: "match_new_1",
      party: "client",
      offerId: "offer_urwah_1",
      requestId: "request_urwah_1",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      salePrice: 500000
    }),
    env: { DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: "iaqar-ai-staging" },
    requestId: "req-1",
    helpers
  });
  assert.equal(minted.body.ok, true);
  assert.equal(isOpaquePartyToken(minted.body.token), true);

  const loaded = await handlePartySessionGet({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-2",
    helpers,
    ip: "1.1.1.1"
  });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.view.title, "عقار مناسب لطلبك");
  assert.equal(loaded.body.view.officeName, "مكتب النور");
  assert.equal(loaded.body.view.property.typePurpose, "أرض للبيع");
  const serialized = JSON.stringify(loaded.body);
  assert.equal(serialized.includes("match_new_1"), false);
  assert.equal(serialized.includes("offer_urwah_1"), false);
  assert.equal(serialized.includes("ownerName"), false);
  assert.equal(serialized.includes(minted.body.token), false);
});

test("tampered or unknown tokens never reveal another session", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } }
  };
  const helpers = mockHelpers(store);
  const minted = await handlePartySessionMint({
    request: mintRequest({
      officeId: "office-1",
      matchId: "match_new_1",
      party: "client",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      salePrice: 500000
    }),
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-3",
    helpers
  });
  const tampered = `${minted.body.token.slice(0, -2)}ff`;
  const missing = await handlePartySessionGet({
    token: tampered,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-4",
    helpers,
    ip: "1.1.1.1"
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.message, PARTY_INVALID_COPY);
  assert.equal(missing.body.view, undefined);

  const invalid = await handlePartySessionGet({
    token: "not-a-token",
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-5",
    helpers,
    ip: "1.1.1.1"
  });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.body.message, PARTY_INVALID_COPY);
});

test("client and owner sessions stay distinct and replies persist", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "مكتب النور" } },
    "offices/office-1/matches/match_new_1": { fields: { livingStage: "MATCH_FOUND" } }
  };
  const helpers = mockHelpers(store);
  const client = await handlePartySessionMint({
    request: mintRequest({ officeId: "office-1", matchId: "match_new_1", party: "client", propertyType: "أرض", purpose: "SALE" }),
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-6",
    helpers
  });
  const owner = await handlePartySessionMint({
    request: mintRequest({ officeId: "office-1", matchId: "match_new_1", party: "owner", propertyType: "أرض", purpose: "SALE" }),
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-7",
    helpers
  });
  assert.notEqual(client.body.token, owner.body.token);
  const ownerView = await handlePartySessionGet({
    token: owner.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "req-8",
    helpers,
    ip: "2.2.2.2"
  });
  assert.equal(ownerView.body.view.title, "عميل مهتم بعقارك");

  const replied = await handlePartySessionReply({
    token: client.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: { json: async () => ({ action: "interested" }) },
    requestId: "req-9",
    helpers,
    ip: "3.3.3.3"
  });
  assert.equal(replied.body.view.replied, true);
  assert.equal(replied.body.view.replyLabel, "مهتم");
  assert.deepEqual(replied.body.view.actions, []);
  assert.equal(replied.body.view.followUpActions.some((item) => item.id === "want_viewing"), true);

  const again = await handlePartySessionReply({
    token: client.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: { json: async () => ({ action: "not_suitable" }) },
    requestId: "req-10",
    helpers,
    ip: "3.3.3.3"
  });
  assert.equal(again.body.view.replyLabel, "مهتم");
});

test("firestore rules deny client reads of party sessions and token hashes", () => {
  const rules = readFileSync(path.join(root, "firestore.rules"), "utf8");
  assert.match(rules, /'partySessions', 'partySessionKeys'/);
  assert.match(rules, /match \/partySessions\/\{sessionId\}/);
  assert.match(rules, /match \/partySessionTokens\/\{tokenHash\}/);
  assert.match(rules, /allow read, write: if false/);
});

const REAL_OFFER = {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "السكب",
  salePrice: 870000,
  area: 1175,
  streetWidth: 10,
  streetDirection: "جنوبي",
  facing: "جنوبية",
  depth: 47,
  plotNumber: "14",
  description: "أرض سكنية على شارعين",
  locationUrl: "https://maps.app.goo.gl/examplelisting",
  rooms: 0
};

const REQUEST_PLACEHOLDER = {
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "العقار",
  city: "غير محدد",
  district: "",
  budget: 20000,
  priceOrBudget: 20000,
  area: 0
};

function seedMatchStore(store) {
  store["offices/office-1"] = { fields: { officeName: "مكتب النور" } };
  store["offices/office-1/opportunities/offer_sakb"] = {
    fields: { ...REAL_OFFER, advertiserPhoneNormalized: "0500000000", ownerName: "خالد" }
  };
  store["offices/office-1/opportunities/req_sakb"] = { fields: REQUEST_PLACEHOLDER };
  store["offices/office-1/matches/match_sakb"] = {
    fields: {
      ownerOfferId: "offer_sakb",
      clientRequestId: "req_sakb",
      opportunityId: "offer_sakb",
      counterpartOpportunityId: "req_sakb",
      sourceCollection: "owners",
      counterpartCollection: "clients"
    }
  };
}

test("client and owner party pages resolve the linked offer not request placeholders", async () => {
  const store = {};
  seedMatchStore(store);
  const helpers = mockHelpers(store);
  const client = await handlePartySessionMint({
    request: mintRequest({
      officeId: "office-1",
      matchId: "match_sakb",
      party: "client",
      offerId: "offer_sakb",
      requestId: "req_sakb",
      opportunityId: "req_sakb",
      propertyType: "العقار",
      salePrice: 20000
    }),
    env: { DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: "iaqar-ai-staging" },
    requestId: "acc-1",
    helpers
  });
  const owner = await handlePartySessionMint({
    request: mintRequest({
      officeId: "office-1",
      matchId: "match_sakb",
      party: "owner",
      offerId: "offer_sakb",
      requestId: "req_sakb"
    }),
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-2",
    helpers
  });
  const clientView = await handlePartySessionGet({
    token: client.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-3",
    helpers,
    ip: "8.8.8.8"
  });
  const ownerView = await handlePartySessionGet({
    token: owner.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-4",
    helpers,
    ip: "8.8.8.8"
  });
  for (const loaded of [clientView, ownerView]) {
    const property = loaded.body.view.property;
    assert.equal(property.propertyType, "أرض");
    assert.equal(property.city, "المدينة المنورة");
    assert.equal(property.district, "السكب");
    assert.equal(property.priceLabel.includes("870,000"), true);
    assert.equal(property.areaLabel.includes("1,175"), true);
    assert.equal(property.streetDirection, "جنوبي");
    assert.equal(property.streetWidthLabel, "10 م");
    assert.equal(property.plotNumber, "14");
    const html = buildPartyShellHtml(loaded.body.view);
    assert.match(html, /أرض/);
    assert.match(html, /المدينة المنورة/);
    assert.match(html, /السكب/);
    assert.match(html, /870,000/);
    assert.match(html, /1,175/);
    assert.equal(html.includes("العقار والغرض"), false);
    assert.equal(html.includes(">العقار<"), false);
    assert.equal(html.includes("غير محدد"), false);
    assert.equal(html.includes("20,000"), false);
    assert.equal(html.includes("0500000000"), false);
    assert.equal(html.includes("خالد"), false);
    assert.match(html, /عرض الموقع/);
    const visible = html.replace(/<[^>]+>/g, " ");
    assert.equal(visible.includes("maps.app.goo.gl"), false);
    assert.equal(JSON.stringify(loaded.body).includes("0500000000"), false);
  }
  assert.match(buildPartyShellHtml(ownerView.body.view), /يوجد عميل مهتم بعقارك/);
  const reload = await handlePartySessionGet({
    token: client.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-5",
    helpers,
    ip: "8.8.8.8"
  });
  assert.equal(reload.body.view.property.priceLabel, clientView.body.view.property.priceLabel);
});

test("needs_details keeps property data and stores the requested item", async () => {
  const store = {};
  seedMatchStore(store);
  const helpers = mockHelpers(store);
  const minted = await handlePartySessionMint({
    request: mintRequest({ officeId: "office-1", matchId: "match_sakb", party: "client", offerId: "offer_sakb" }),
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-6",
    helpers
  });
  const replied = await handlePartySessionReply({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: { json: async () => ({ action: "needs_details" }) },
    requestId: "acc-7",
    helpers,
    ip: "9.9.9.9"
  });
  const html = buildPartyShellHtml(replied.body.view);
  assert.match(html, /870,000/);
  assert.match(html, /تم تسجيل ردك/);
  assert.match(html, /أحتاج تفاصيل أكثر/);
  assert.match(html, /السعر/);
  assert.match(html, /الموقع/);
  assert.match(html, /الصور/);
  assert.match(html, /المواصفات/);
  assert.match(html, /سؤال آخر/);
  const follow = await handlePartySessionReply({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    request: { json: async () => ({ action: "detail_photos" }) },
    requestId: "acc-8",
    helpers,
    ip: "9.9.9.9"
  });
  assert.equal(follow.body.view.followUpLabel, "الصور");
  assert.deepEqual(follow.body.view.followUpActions, []);
  const again = await handlePartySessionGet({
    token: minted.body.token,
    env: { DEPLOYMENT_ENV: "staging" },
    requestId: "acc-9",
    helpers,
    ip: "9.9.9.9"
  });
  assert.equal(again.body.view.property.propertyType, "أرض");
  assert.equal(again.body.view.followUpLabel, "الصور");
});

test("generic placeholders never become runtime property values", () => {
  const snapshot = buildPartySnapshot({
    opportunityKind: "OFFER",
    propertyType: "العقار",
    city: "غير محدد",
    budget: 20000
  });
  assert.equal(snapshot.propertyType, "");
  assert.equal(snapshot.city, "");
  assert.equal(snapshot.priceLabel, "");
  const html = buildPartyShellHtml(sanitizePartyPublicView({ party: "client", snapshot }));
  assert.equal(html.includes("20,000"), false);
  assert.equal(html.includes(">العقار<"), false);
  assert.equal(html.includes("غير محدد"), false);
});

test("matching engine files are not part of the party-link change", () => {
  const matching = readFileSync(path.join(root, "worker", "src", "matching-engine.js"), "utf8");
  const domain = readFileSync(path.join(root, "public", "js", "matching-domain.js"), "utf8");
  assert.equal(matching.includes("cv2Party"), false);
  assert.equal(domain.includes("cv2Party"), false);
  assert.equal(matching.includes("partySessions"), false);
});

test("copied public v2 mount skips broker bootstrap in party mode", () => {
  const mount = readFileSync(path.join(root, "src", "v2", "content", "mount.js"), "utf8");
  assert.match(mount, /dataset\.partyMode === "1"/);
});
