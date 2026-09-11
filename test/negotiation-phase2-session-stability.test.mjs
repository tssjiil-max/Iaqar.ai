import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handlePartySessionMint } from "../worker/src/party-session-service.js";

const sha256Hex = (value) => createHash("sha256").update(String(value)).digest("hex");

function makeHelpers(store) {
  return {
    firestoreOfficeId: (value) => String(value || "").trim(),
    authorizeOfficeRequest: async () => {},
    assertFirebaseSecrets: () => {},
    getGoogleAccessToken: async () => "access-token",
    DEFAULT_PROJECT_ID: "iaqar-ai-staging",
    cleanText: (value) => String(value ?? "").replace(/\s+/g, " ").trim(),
    jsonResponse: (body, status = 200) => ({ status, body }),
    sha256Hex: async (value) => sha256Hex(value),
    firestoreFieldsToJs: (fields) => fields || {},
    firestoreString: (value) => ({ stringValue: String(value) }),
    jsToFirestoreValue: (value) => ({ mapValue: { fields: value } }),
    async getFirestoreDocument({ segments }) {
      return store[segments.join("/")] || null;
    },
    async setFirestoreDocument({ segments, fields }) {
      const key = segments.join("/");
      const next = { ...(store[key]?.fields || {}) };
      for (const [name, value] of Object.entries(fields || {})) {
        next[name] = value?.stringValue !== undefined ? value.stringValue : value;
      }
      store[key] = { fields: next };
    }
  };
}

const body = (party) => ({
  officeId: "office-1",
  matchId: "match-stable-1",
  party,
  offerId: "offer-stable-1",
  requestId: "request-stable-1"
});

async function mint(helpers, party, requestId) {
  return handlePartySessionMint({
    request: { json: async () => body(party) },
    env: { DEPLOYMENT_ENV: "staging", FIREBASE_PROJECT_ID: "iaqar-ai-staging" },
    requestId,
    helpers
  });
}

test("phase-2 keeps one stable opaque token per party for the same match", async () => {
  const store = {
    "offices/office-1": { fields: { officeName: "سلطان العقاري" } },
    "offices/office-1/matches/match-stable-1": { fields: {
      livingStage: "MATCH_FOUND",
      ownerOfferId: "offer-stable-1",
      clientRequestId: "request-stable-1"
    } },
    "offices/office-1/opportunities/offer-stable-1": { fields: {
      opportunityKind: "OFFER",
      propertyType: "شقة",
      purpose: "SALE",
      salePrice: 700000
    } }
  };
  const helpers = makeHelpers(store);

  const client1 = await mint(helpers, "client", "client-1");
  const client2 = await mint(helpers, "client", "client-2");
  const owner1 = await mint(helpers, "owner", "owner-1");
  const owner2 = await mint(helpers, "owner", "owner-2");

  assert.equal(client1.body.reused, false);
  assert.equal(client2.body.reused, true);
  assert.equal(client2.body.token, client1.body.token);
  assert.equal(owner1.body.reused, false);
  assert.equal(owner2.body.reused, true);
  assert.equal(owner2.body.token, owner1.body.token);
  assert.notEqual(client1.body.token, owner1.body.token);

  assert.equal(Object.keys(store).filter((key) => key.startsWith("offices/office-1/partySessions/")).length, 2);
  assert.equal(Object.keys(store).filter((key) => key.startsWith("offices/office-1/partySessionKeys/")).length, 2);
});
