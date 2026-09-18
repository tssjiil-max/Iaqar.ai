import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.join(here, "..");
const servicePath = path.join(workerRoot, "src/match-current-claim-service.js");
assert.ok(fs.existsSync(servicePath), "current-match claim service must exist");

const { claimCurrentMatchForPairRule } = await import("../src/match-current-claim-service.js");
const { buildFirestoreUpdateWrite } = await import("../src/firestore-atomic-write-service.js");

const guardedWrite = buildFirestoreUpdateWrite({
  projectId: "demo-project",
  segments: ["offices", "office-1", "matchCurrentPointers", "pair_demo"],
  fields: { currentMatchId: { stringValue: "match-a" } },
  precondition: { exists: false }
});
assert.deepEqual(
  guardedWrite.currentDocument,
  { exists: false },
  "Firestore writes used for the pair pointer must carry a CAS precondition"
);

const state = {
  pointer: null,
  pointerVersion: 0,
  matches: new Map([
    ["old-match", { matchId: "old-match", pairRuleKey: "pair_demo", isCurrent: true, status: "active" }]
  ])
};

let firstAttemptLoads = 0;
let releaseFirstAttempts;
const firstAttemptBarrier = new Promise(resolve => { releaseFirstAttempts = resolve; });

function cloneSnapshot() {
  return {
    pointer: state.pointer ? { ...state.pointer } : null,
    currentMatches: [...state.matches.values()].map(item => ({ ...item }))
  };
}

async function loadSnapshot({ attempt }) {
  const snapshot = cloneSnapshot();
  if (attempt === 1) {
    firstAttemptLoads += 1;
    if (firstAttemptLoads === 2) releaseFirstAttempts();
    await firstAttemptBarrier;
  }
  return snapshot;
}

async function commitClaim({ targetMatchId, supersededMatchIds, pointer }) {
  const expectedUpdateTime = pointer?.updateTime || "";
  const actualUpdateTime = state.pointer?.updateTime || "";
  const expectedMissing = !pointer;
  const actualMissing = !state.pointer;
  if (expectedMissing !== actualMissing || expectedUpdateTime !== actualUpdateTime) {
    const error = new Error("forced CAS conflict");
    error.code = "FAILED_PRECONDITION";
    throw error;
  }

  const nextMatches = new Map([...state.matches.entries()].map(([id, value]) => [id, { ...value }]));
  for (const id of supersededMatchIds) {
    const previous = nextMatches.get(id) || { matchId: id, pairRuleKey: "pair_demo" };
    nextMatches.set(id, { ...previous, isCurrent: false, status: "superseded" });
  }
  const target = nextMatches.get(targetMatchId) || { matchId: targetMatchId, pairRuleKey: "pair_demo", status: "active" };
  nextMatches.set(targetMatchId, { ...target, isCurrent: true });

  state.pointerVersion += 1;
  state.matches = nextMatches;
  state.pointer = {
    currentMatchId: targetMatchId,
    updateTime: `v${state.pointerVersion}`
  };
}

const [first, second] = await Promise.all([
  claimCurrentMatchForPairRule({
    pairRuleKey: "pair_demo",
    targetMatchId: "match-a",
    loadSnapshot,
    commitClaim,
    maxAttempts: 5
  }),
  claimCurrentMatchForPairRule({
    pairRuleKey: "pair_demo",
    targetMatchId: "match-b",
    loadSnapshot,
    commitClaim,
    maxAttempts: 5
  })
]);

const current = [...state.matches.values()].filter(match => match.isCurrent === true && match.status !== "superseded");
assert.equal(current.length, 1, "concurrent claims must leave exactly one current match for a pairRuleKey");
assert.equal(current[0].matchId, state.pointer.currentMatchId, "pointer and current match must agree");
assert.equal(state.matches.get("old-match").isCurrent, false, "legacy current match must be superseded");
assert.ok(first.attempts > 1 || second.attempts > 1, "one concurrent contender must retry after CAS conflict");

const source = fs.readFileSync(path.join(workerRoot, "src/index.js"), "utf8");
const persistStart = source.indexOf("async function persistScoredMatch(");
const persistEnd = source.indexOf("\nasync function ", persistStart + 10);
assert.ok(persistStart >= 0 && persistEnd > persistStart, "persistScoredMatch block must exist");
const persistBlock = source.slice(persistStart, persistEnd);
assert.match(persistBlock, /claimCurrentMatchForPairRule\(/, "persistScoredMatch must claim current status through the CAS service");
assert.equal(persistBlock.includes("supersedeMatchesForPairKey("), false, "persistScoredMatch must not use list-then-patch supersede flow");
assert.match(persistBlock, /matchCurrentPointers/, "pairRuleKey must have a stable pointer document");
assert.match(persistBlock, /commitFirestoreWrites\(/, "target match, supersedes, and pointer must share one atomic commit");
assert.match(persistBlock, /precondition:/, "pair pointer write must be guarded by its observed version/existence");

console.log("match current race regression tests passed");
