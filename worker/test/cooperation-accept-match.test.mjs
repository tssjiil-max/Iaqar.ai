import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateActiveMatchContract,
  resolveCanonicalPairFromDocs
} from "../src/match-integrity-domain.js";
import {
  resolveAcceptedCooperationPair,
  runCooperationLifecycle
} from "../src/cooperation-phase6-service.js";

const requestDocOffice2 = {
  officeId: "2",
  opportunityKind: "REQUEST",
  propertyType: "شقة",
  district: "النرجس",
  city: "الرياض"
};
const offerDocOffice3 = {
  officeId: "3",
  opportunityKind: "OFFER",
  propertyType: "شقة",
  district: "النرجس",
  city: "الرياض"
};

test("cross-office active match contract accepts request on client office and offer on property office", () => {
  const ok = evaluateActiveMatchContract({
    requestId: "opp_req_2",
    offerId: "opp_off_3",
    requestDoc: requestDocOffice2,
    offerDoc: offerDocOffice3,
    officeId: "2",
    propertyOfficeId: "3"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.integrityStatus, "VALID");
});

test("resolveCanonicalPairFromDocs supports cross-office opportunity pair", () => {
  const resolved = resolveCanonicalPairFromDocs({
    officeId: "2",
    opportunityId: "opp_req_2",
    counterpartOpportunityId: "opp_off_3"
  }, {
    opp_req_2: requestDocOffice2,
    opp_off_3: offerDocOffice3
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requestId, "opp_req_2");
  assert.equal(resolved.offerId, "opp_off_3");
});

function firestoreHelpers() {
  const wrap = (value) => ({ stringValue: String(value) });
  return {
    firestoreString: (v) => wrap(v),
    firestoreInteger: (v) => ({ integerValue: String(Number(v) || 0) }),
    firestoreBoolean: (v) => ({ booleanValue: Boolean(v) }),
    firestoreTimestamp: (d) => ({ timestampValue: new Date(d).toISOString() })
  };
}

function makeStore(seed = {}) {
  const docs = structuredClone(seed);
  return {
    getFirestoreDocument: async ({ segments, allowMissing = false }) => {
      const key = segments.join("/");
      const doc = docs[key];
      if (!doc) {
        if (allowMissing) return null;
        throw new Error(`missing ${key}`);
      }
      return doc;
    },
    setFirestoreDocument: async ({ segments, fields }) => {
      const key = segments.join("/");
      docs[key] = { fields };
      return { ok: true };
    },
    deleteFirestoreDocument: async () => ({ ok: true }),
    firestoreFieldsToJs: (fields = {}) => {
      const out = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value?.stringValue != null) out[key] = value.stringValue;
        else if (value?.integerValue != null) out[key] = Number(value.integerValue);
        else if (value?.booleanValue != null) out[key] = value.booleanValue;
        else if (value?.timestampValue != null) out[key] = value.timestampValue;
        else if (value?.arrayValue?.values) {
          out[key] = value.arrayValue.values.map((row) => row.stringValue);
        }
      }
      return out;
    },
    docs
  };
}

test("resolveAcceptedCooperationPair resolves exact request and offer across offices", async () => {
  const store = makeStore({
    "offices/2/opportunities/opp_req_2": {
      fields: {
        officeId: { stringValue: "2" },
        opportunityKind: { stringValue: "REQUEST" }
      }
    },
    "offices/3/opportunities/opp_off_3": {
      fields: {
        officeId: { stringValue: "3" },
        opportunityKind: { stringValue: "OFFER" }
      }
    }
  });
  const pair = await resolveAcceptedCooperationPair({
    cooperation: {
      clientOfficeId: "2",
      propertyOfficeId: "3",
      opportunityId: "opp_off_3",
      counterpartOpportunityId: "opp_req_2"
    },
    projectId: "proj",
    accessToken: "token",
    getFirestoreDocument: store.getFirestoreDocument,
    firestoreFieldsToJs: store.firestoreFieldsToJs
  });
  assert.equal(pair.ok, true);
  assert.equal(pair.requestId, "opp_req_2");
  assert.equal(pair.offerId, "opp_off_3");
  assert.equal(pair.clientOfficeId, "2");
  assert.equal(pair.propertyOfficeId, "3");
});

test("ACCEPT creates mat_* and populates cooperation and operation matchId", async () => {
  const matchWrites = [];
  let materializeCalls = 0;
  const store = makeStore({
    "cooperationRequests/coop_test": {
      fields: {
        status: { stringValue: "PENDING" },
        originatingOfficeId: { stringValue: "3" },
        targetOfficeId: { stringValue: "2" },
        clientOfficeId: { stringValue: "2" },
        propertyOfficeId: { stringValue: "3" },
        opportunityId: { stringValue: "opp_off_3" },
        counterpartOpportunityId: { stringValue: "opp_req_2" },
        opportunityIds: {
          arrayValue: { values: [{ stringValue: "opp_off_3" }] }
        },
        permissions: {
          mapValue: {
            fields: {
              readOnly: { booleanValue: true },
              contactVisible: { booleanValue: false }
            }
          }
        }
      }
    },
    "offices/2/officeSettings/cooperation": {
      fields: { mode: { stringValue: "APPROVAL_REQUIRED" } }
    },
    "offices/3/opportunities/opp_off_3": {
      fields: {
        officeId: { stringValue: "3" },
        opportunityKind: { stringValue: "OFFER" }
      }
    }
  });

  const upsertCooperationOperations = async ({ cooperation }) => {
    assert.equal(cooperation.matchId, "mat_coop_accept");
    return { results: [{ officeId: "2", operation: { matchId: cooperation.matchId } }] };
  };

  const materializeAcceptedCooperationMatch = async () => {
    materializeCalls += 1;
    matchWrites.push("mat_coop_accept");
    await store.setFirestoreDocument({
      projectId: "proj",
      segments: ["offices", "2", "matches", "mat_coop_accept"],
      accessToken: "token",
      fields: {
        matchId: { stringValue: "mat_coop_accept" },
        requestId: { stringValue: "opp_req_2" },
        offerId: { stringValue: "opp_off_3" }
      }
    });
    return {
      ok: true,
      matchId: "mat_coop_accept",
      duplicate: false,
      requestId: "opp_req_2",
      offerId: "opp_off_3"
    };
  };

  const result = await runCooperationLifecycle({
    projectId: "proj",
    actorOfficeId: "2",
    actorUid: "broker-2",
    cooperationId: "coop_test",
    action: "ACCEPT",
    accessToken: "token",
    deps: {
      ...store,
      firestoreHelpers: firestoreHelpers(),
      upsertCooperationOperations,
      materializeAcceptedCooperationMatch
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.matchId, "mat_coop_accept");
  assert.equal(materializeCalls, 1);
  assert.equal(matchWrites.length, 1);

  const coopDoc = await store.getFirestoreDocument({
    projectId: "proj",
    segments: ["cooperationRequests", "coop_test"],
    accessToken: "token"
  });
  const coop = store.firestoreFieldsToJs(coopDoc.fields);
  assert.equal(coop.matchId, "mat_coop_accept");
});

test("repeated ACCEPT reuses same matchId without duplicate materialization side effects", async () => {
  let materializeCalls = 0;
  const store = makeStore({
    "cooperationRequests/coop_repeat": {
      fields: {
        status: { stringValue: "ACCEPTED" },
        originatingOfficeId: { stringValue: "3" },
        targetOfficeId: { stringValue: "2" },
        clientOfficeId: { stringValue: "2" },
        propertyOfficeId: { stringValue: "3" },
        opportunityId: { stringValue: "opp_off_3" },
        counterpartOpportunityId: { stringValue: "opp_req_2" },
        matchId: { stringValue: "mat_existing" },
        opportunityIds: {
          arrayValue: { values: [{ stringValue: "opp_off_3" }] }
        },
        permissions: {
          mapValue: {
            fields: {
              readOnly: { booleanValue: true },
              contactVisible: { booleanValue: false }
            }
          }
        }
      }
    },
    "offices/2/officeSettings/cooperation": {
      fields: { mode: { stringValue: "APPROVAL_REQUIRED" } }
    },
    "offices/3/opportunities/opp_off_3": {
      fields: {
        officeId: { stringValue: "3" },
        opportunityKind: { stringValue: "OFFER" }
      }
    }
  });

  const materializeAcceptedCooperationMatch = async ({ existingMatchId }) => {
    materializeCalls += 1;
    return {
      ok: true,
      matchId: existingMatchId || "mat_existing",
      duplicate: true
    };
  };

  const result = await runCooperationLifecycle({
    projectId: "proj",
    actorOfficeId: "2",
    actorUid: "broker-2",
    cooperationId: "coop_repeat",
    action: "ACCEPT",
    accessToken: "token",
    deps: {
      ...store,
      firestoreHelpers: firestoreHelpers(),
      materializeAcceptedCooperationMatch
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.matchId, "mat_existing");
  assert.equal(materializeCalls, 1);
});

test("non-ACCEPT states do not materialize a match", async () => {
  let materializeCalls = 0;
  const store = makeStore({
    "cooperationRequests/coop_reject": {
      fields: {
        status: { stringValue: "PENDING" },
        originatingOfficeId: { stringValue: "3" },
        targetOfficeId: { stringValue: "2" },
        clientOfficeId: { stringValue: "2" },
        propertyOfficeId: { stringValue: "3" },
        opportunityId: { stringValue: "opp_off_3" },
        counterpartOpportunityId: { stringValue: "opp_req_2" },
        opportunityIds: {
          arrayValue: { values: [{ stringValue: "opp_off_3" }] }
        },
        permissions: {
          mapValue: {
            fields: {
              readOnly: { booleanValue: true },
              contactVisible: { booleanValue: false }
            }
          }
        }
      }
    },
    "offices/2/officeSettings/cooperation": {
      fields: { mode: { stringValue: "APPROVAL_REQUIRED" } }
    }
  });

  const materializeAcceptedCooperationMatch = async () => {
    materializeCalls += 1;
    return { ok: true, matchId: "mat_should_not_run" };
  };

  const result = await runCooperationLifecycle({
    projectId: "proj",
    actorOfficeId: "2",
    actorUid: "broker-2",
    cooperationId: "coop_reject",
    action: "REJECT",
    accessToken: "token",
    deps: {
      ...store,
      firestoreHelpers: firestoreHelpers(),
      materializeAcceptedCooperationMatch
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "REJECTED");
  assert.equal(materializeCalls, 0);
  assert.equal(result.matchId, "");
});
