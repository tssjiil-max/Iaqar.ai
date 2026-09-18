import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.join(here, "..");
const servicePath = path.join(workerRoot, "src/firestore-atomic-write-service.js");

assert.ok(fs.existsSync(servicePath), "atomic Firestore write service must exist");
const { buildFirestoreUpdateWrite, commitFirestoreWrites } = await import("../src/firestore-atomic-write-service.js");

const dealWrite = buildFirestoreUpdateWrite({
  projectId: "demo-project",
  segments: ["offices", "office-1", "deals", "deal-1"],
  fields: { dealId: { stringValue: "deal-1" }, optional: null }
});
const matchWrite = buildFirestoreUpdateWrite({
  projectId: "demo-project",
  segments: ["offices", "office-1", "matches", "match-1"],
  fields: { dealId: { stringValue: "deal-1" }, status: { stringValue: "negotiation" } }
});

assert.equal(dealWrite.update.name, "projects/demo-project/databases/(default)/documents/offices/office-1/deals/deal-1");
assert.deepEqual(dealWrite.update.fields, { dealId: { stringValue: "deal-1" } });
assert.deepEqual(dealWrite.updateMask.fieldPaths, ["dealId"]);
assert.deepEqual(matchWrite.updateMask.fieldPaths, ["dealId", "status"]);

let successCalls = 0;
let successRequest = null;
const successFetch = async (url, options) => {
  successCalls += 1;
  successRequest = { url, options };
  return { ok: true, json: async () => ({ commitTime: "2026-09-18T00:00:00Z", writeResults: [{}, {}] }) };
};
await commitFirestoreWrites({ projectId: "demo-project", accessToken: "token", writes: [dealWrite, matchWrite], fetchImpl: successFetch });
assert.equal(successCalls, 1, "Deal + Match must be sent in one Firestore commit request");
assert.match(successRequest.url, /\/documents:commit$/);
assert.equal(successRequest.options.method, "POST");
assert.deepEqual(JSON.parse(successRequest.options.body).writes, [dealWrite, matchWrite]);

let failureCalls = 0;
const failureFetch = async () => {
  failureCalls += 1;
  return { ok: false, status: 500, text: async () => "forced commit failure" };
};
await assert.rejects(
  commitFirestoreWrites({ projectId: "demo-project", accessToken: "token", writes: [dealWrite, matchWrite], fetchImpl: failureFetch }),
  /Firestore atomic commit failed/
);
assert.equal(failureCalls, 1, "Commit failure must not fall back to sequential writes");

const source = fs.readFileSync(path.join(workerRoot, "src/index.js"), "utf8");
const start = source.indexOf("async function createDealFromMatch(");
const end = source.indexOf("async function finalizeDealAndCloseSiblings(", start);
assert.ok(start >= 0 && end > start, "createDealFromMatch block must exist");
const block = source.slice(start, end);
const commitIndex = block.indexOf("await commitFirestoreWrites(");
const timelineIndex = block.indexOf("await addWorkflowTimeline(");
const orchestrationIndex = block.indexOf("await runRuntimeOrchestration(");
assert.ok(commitIndex >= 0, "createDealFromMatch must atomically commit Deal + Match linkage");
assert.ok(timelineIndex > commitIndex, "timeline must run only after the atomic commit succeeds");
assert.ok(orchestrationIndex > commitIndex, "orchestration must run only after the atomic commit succeeds");
const beforeTimeline = block.slice(0, timelineIndex);
assert.equal(beforeTimeline.includes("await setFirestoreDocument("), false, "core Deal/Match creation must not use sequential Firestore writes");
assert.match(beforeTimeline, /deals",dealId/);
assert.match(beforeTimeline, /matches",matchId/);
assert.equal((beforeTimeline.match(/buildFirestoreUpdateWrite\(/g) || []).length, 2, "atomic commit must contain Deal and Match writes");

console.log("deal-match atomicity regression tests passed");
