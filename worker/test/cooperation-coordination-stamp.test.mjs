import test from "node:test";
import assert from "node:assert/strict";
import {
  stampSharedCooperationCoordinationState,
  syncCooperationCoordinationFromCanonicalMatch
} from "../src/coordination-session-service.js";

function makeHelpers(state = {}) {
  const stores = {
    cooperationRequests: state.cooperationRequests || {},
    offices: state.offices || {}
  };
  return {
    firestoreString: (v) => ({ stringValue: String(v ?? "") }),
    firestoreTimestamp: (d) => ({ timestampValue: new Date(d).toISOString() }),
    firestoreFieldsToJs: (fields = {}) => {
      const out = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value && typeof value === "object" && "stringValue" in value) {
          out[key] = value.stringValue;
        }
      }
      return out;
    },
    getFirestoreDocument: async ({ segments, allowMissing }) => {
      const [root, id] = segments.length === 2
        ? [segments[0], segments[1]]
        : [segments[0], segments[1], segments[2], segments[3], segments[4]];
      if (segments[0] === "cooperationRequests") {
        const doc = stores.cooperationRequests[id];
        if (!doc) return allowMissing ? null : null;
        return { fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, { stringValue: String(v) }])) };
      }
      if (segments[0] === "offices") {
        const officeId = segments[1];
        const collection = segments[2];
        const docId = segments[3];
        const doc = stores.offices?.[officeId]?.[collection]?.[docId];
        if (!doc) return allowMissing ? null : null;
        return { fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, { stringValue: String(v) }])) };
      }
      return allowMissing ? null : null;
    },
    setFirestoreDocument: async ({ segments, fields }) => {
      const js = {};
      for (const [key, value] of Object.entries(fields)) {
        js[key] = value?.stringValue ?? "";
      }
      if (segments[0] === "cooperationRequests") {
        stores.cooperationRequests[segments[1]] = { ...stores.cooperationRequests[segments[1]], ...js };
        return;
      }
      if (segments[0] === "offices") {
        const officeId = segments[1];
        const collection = segments[2];
        const docId = segments[3];
        stores.offices[officeId] = stores.offices[officeId] || {};
        stores.offices[officeId][collection] = stores.offices[officeId][collection] || {};
        stores.offices[officeId][collection][docId] = {
          ...stores.offices[officeId][collection][docId],
          ...js
        };
      }
    },
    listCollectionDocuments: async ({ segments }) => {
      if (segments[0] === "cooperationRequests") {
        return Object.entries(stores.cooperationRequests).map(([id, fields]) => ({
          name: `cooperationRequests/${id}`,
          fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }]))
        }));
      }
      if (segments[0] === "offices" && segments[2] === "operations") {
        const officeId = segments[1];
        const ops = stores.offices?.[officeId]?.operations || {};
        return Object.entries(ops).map(([id, fields]) => ({
          name: `offices/${officeId}/operations/${id}`,
          fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }]))
        }));
      }
      return [];
    },
    _stores: stores
  };
}

test("accepted cross-office client bundle stamps cooperation and both operations", async () => {
  const helpers = makeHelpers({
    cooperationRequests: {
      coop_1: {
        status: "ACCEPTED",
        matchId: "mat_1",
        clientOfficeId: "2",
        propertyOfficeId: "3"
      }
    },
    offices: {
      2: {
        operations: {
          op_client: { type: "COOPERATION_MATCH", cooperationId: "coop_1" }
        }
      },
      3: {
        operations: {
          op_property: { type: "COOPERATION_MATCH", cooperationId: "coop_1" }
        }
      }
    }
  });

  const result = await stampSharedCooperationCoordinationState(helpers, {
    projectId: "iaqar-ai-staging",
    clientOfficeId: "2",
    matchId: "mat_1",
    accessToken: "token",
    coordinationOutcome: "AWAITING_OTHER_PARTY",
    coordinationClientSummary: "مهتم — يريد معاينة غدًا مساءً",
    coordinationOwnerSummary: "",
    ownerContactNeeded: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.cooperationId, "coop_1");
  assert.equal(result.ownerContactNeeded, true);
  const coop = helpers._stores.cooperationRequests.coop_1;
  assert.equal(coop.ownerContactNeeded, "true");
  assert.equal(coop.coordinationOutcome, "AWAITING_OTHER_PARTY");
  assert.equal(helpers._stores.offices["2"].operations.op_client.ownerContactNeeded, "true");
  assert.equal(helpers._stores.offices["3"].operations.op_property.ownerContactNeeded, "true");
  assert.equal(helpers._stores.offices["2"].operations.op_client.matchId, "mat_1");
  assert.equal(helpers._stores.offices["3"].operations.op_property.matchId, "mat_1");
});

test("sync from canonical match computes ownerContactNeeded without duplicate mat_*", async () => {
  const helpers = makeHelpers({
    cooperationRequests: {
      coop_1: {
        status: "ACCEPTED",
        matchId: "mat_1",
        clientOfficeId: "2",
        propertyOfficeId: "3"
      }
    },
    offices: {
      2: {
        matches: {
          mat_1: {
            coordinationOutcome: "AWAITING_OTHER_PARTY",
            coordinationClientSummary: "مهتم — يريد معاينة غدًا مساءً",
            ownerContactNeeded: ""
          }
        },
        operations: {
          op_client: { type: "COOPERATION_MATCH", cooperationId: "coop_1" }
        }
      },
      3: {
        operations: {
          op_property: { type: "COOPERATION_MATCH", cooperationId: "coop_1" }
        },
        matches: {}
      }
    }
  });

  const result = await syncCooperationCoordinationFromCanonicalMatch(helpers, {
    projectId: "iaqar-ai-staging",
    matchId: "mat_1",
    accessToken: "token"
  });

  assert.equal(result.ok, true);
  assert.equal(result.ownerContactNeeded, true);
  assert.equal(Object.keys(helpers._stores.offices["3"].matches || {}).length, 0);
  assert.equal(helpers._stores.offices["3"].operations.op_property.ownerContactNeeded, "true");
});

test("owner bundle clears ownerContactNeeded on shared cooperation state", async () => {
  const helpers = makeHelpers({
    cooperationRequests: {
      coop_1: {
        status: "ACCEPTED",
        matchId: "mat_1",
        clientOfficeId: "2",
        propertyOfficeId: "3",
        ownerContactNeeded: "true"
      }
    },
    offices: {
      2: {
        operations: { op_client: { type: "COOPERATION_MATCH", cooperationId: "coop_1", ownerContactNeeded: "true" } }
      },
      3: {
        operations: { op_property: { type: "COOPERATION_MATCH", cooperationId: "coop_1", ownerContactNeeded: "true" } }
      }
    }
  });

  await stampSharedCooperationCoordinationState(helpers, {
    projectId: "iaqar-ai-staging",
    clientOfficeId: "2",
    matchId: "mat_1",
    accessToken: "token",
    coordinationOutcome: "VIEWING_READY",
    coordinationClientSummary: "مهتم",
    coordinationOwnerSummary: "متاح",
    ownerContactNeeded: false
  });

  assert.equal(helpers._stores.cooperationRequests.coop_1.ownerContactNeeded, "");
  assert.equal(helpers._stores.offices["3"].operations.op_property.ownerContactNeeded, "");
});
