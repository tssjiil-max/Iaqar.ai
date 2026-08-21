import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "path";
import { createExplicitCooperationRequest } from "../src/cooperation-phase6-service.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function firestoreFieldsToJs(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (value && typeof value === "object" && "stringValue" in value) out[key] = value.stringValue;
    else if (value && typeof value === "object" && "booleanValue" in value) out[key] = value.booleanValue;
    else out[key] = value;
  }
  return out;
}

test("cooperation-phase6-service imports minimumSharedFields", () => {
  const src = readFileSync(path.join(root, "../src/cooperation-phase6-service.js"), "utf8");
  assert.match(src, /minimumSharedFields/);
  assert.match(src, /import \{[\s\S]*minimumSharedFields[\s\S]*\} from "\.\/cooperation-phase6-domain\.js"/);
});

test("createExplicitCooperationRequest does not throw ReferenceError on minimumSharedFields", async () => {
  const writes = [];
  const deps = {
    firestoreFieldsToJs,
    firestoreHelpers: {
      firestoreString: (value) => ({ stringValue: String(value) }),
      firestoreInteger: (value) => ({ integerValue: String(value) }),
      firestoreBoolean: (value) => ({ booleanValue: Boolean(value) }),
      firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() })
    },
    async getFirestoreDocument({ segments }) {
      const key = segments.join("/");
      if (key === "offices/office-a/officeSettings/cooperation") {
        return { fields: { mode: { stringValue: "APPROVAL_REQUIRED" } } };
      }
      if (key === "publicOffices/office-b" || key === "publicOffices/office-a") {
        return { fields: { officeName: { stringValue: "مكتب تجريبي" }, approvalStatus: { stringValue: "approved" }, accountStatus: { stringValue: "active" } } };
      }
      if (key === "offices/office-b") {
        return { fields: { approvalStatus: { stringValue: "approved" }, accountStatus: { stringValue: "active" } } };
      }
      if (key === "offices/office-a/opportunities/opp-1") {
        return { fields: { officeId: { stringValue: "office-a" }, propertyType: { stringValue: "شقة" }, city: { stringValue: "مكة" } } };
      }
      return null;
    },
    async setFirestoreDocument(args) {
      writes.push(args.segments.join("/"));
      return {};
    }
  };

  const result = await createExplicitCooperationRequest({
    projectId: "iaqar-ai-staging",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-1",
    targetOfficeId: "office-b",
    opportunityIds: ["opp-1"],
    scopeType: "single",
    message: "فرصة تعاون",
    accessToken: "token",
    deps
  });

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.ok(String(result.requestId || "").startsWith("coop_"));
  assert.ok(writes.some((pathValue) => pathValue.startsWith("cooperationRequests/")));
});
