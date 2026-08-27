import test from "node:test";
import assert from "node:assert/strict";
import { runCooperationWorkflow } from "../worker/src/cooperation-workflow-service.js";
import { COOPERATION_ACTION, COOPERATION_STAGE } from "../public/js/cooperation-workflow-domain.js";

function memoryFirestore() {
  const docs = new Map();
  const fh = {
    firestoreString: (v) => ({ stringValue: String(v ?? "") }),
    firestoreTimestamp: (d) => ({ timestampValue: d.toISOString() }),
    firestoreInteger: (n) => ({ integerValue: String(n) }),
    firestoreBoolean: (b) => ({ booleanValue: b }),
    firestoreFieldsToJs: (fields = {}) => {
      const out = {};
      for (const [key, value] of Object.entries(fields || {})) {
        if (value?.stringValue != null) out[key] = value.stringValue;
        else if (value?.integerValue != null) out[key] = Number(value.integerValue);
        else if (value?.booleanValue != null) out[key] = value.booleanValue;
        else if (value?.timestampValue != null) out[key] = value.timestampValue;
      }
      return out;
    }
  };
  return {
    docs,
    fh,
    getFirestoreDocument: async ({ segments, allowMissing }) => {
      const key = segments.join("/");
      const doc = docs.get(key);
      if (!doc && allowMissing) return null;
      if (!doc) throw new Error(`missing ${key}`);
      return { fields: doc };
    },
    setFirestoreDocument: async ({ segments, fields }) => {
      docs.set(segments.join("/"), fields);
    },
    listCollectionDocuments: async () => [],
    firestoreFieldsToJs: fh.firestoreFieldsToJs,
    firestoreHelpers: fh
  };
}

test("runCooperationWorkflow uses top-level firestoreFieldsToJs from operationsDeps shape", async () => {
  const store = memoryFirestore();
  const cooperationId = "coop_dc04";
  const now = new Date().toISOString();
  store.docs.set(`cooperationRequests/${cooperationId}`, {
    id: { stringValue: cooperationId },
    cooperationTaskId: { stringValue: cooperationId },
    originatingOfficeId: { stringValue: "office-client" },
    targetOfficeId: { stringValue: "office-wadi" },
    clientOfficeId: { stringValue: "office-client" },
    propertyOfficeId: { stringValue: "office-wadi" },
    status: { stringValue: "ACCEPTED" },
    currentStage: { stringValue: COOPERATION_STAGE.ACCEPTED },
    clientPhone: { stringValue: "+966552382937" },
    ownerPhone: { stringValue: "+966552019909" },
    opportunityId: { stringValue: "req_1" },
    counterpartOpportunityId: { stringValue: "offer_1" },
    originListingJson: { stringValue: "{}" },
    counterpartListingJson: { stringValue: "{}" },
    completionConfirmationsJson: { stringValue: "{}" },
    matchReasonsJson: { stringValue: "[]" },
    createdAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
    schemaVersion: { integerValue: "2" }
  });

  const result = await runCooperationWorkflow({
    projectId: "proj",
    actorOfficeId: "office-client",
    actorUid: "broker-1",
    cooperationId,
    action: COOPERATION_ACTION.FOLLOW_CUSTOMER,
    accessToken: "token",
    deps: {
      getFirestoreDocument: store.getFirestoreDocument,
      setFirestoreDocument: store.setFirestoreDocument,
      listCollectionDocuments: store.listCollectionDocuments,
      firestoreFieldsToJs: store.firestoreFieldsToJs,
      firestoreHelpers: store.fh
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentStage, COOPERATION_STAGE.CUSTOMER_ACTION);
});
