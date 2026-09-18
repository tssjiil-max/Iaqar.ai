import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/index.js"), "utf8");
const start = source.indexOf('if(action==="start_match"||action==="advance_match"){');
const end = source.indexOf('if(action==="add_match_followup"){', start);

assert.ok(start >= 0 && end > start, "advance_match workflow block must exist");
const block = source.slice(start, end);

const negotiationBranch = block.indexOf('const enteringNegotiation=next==="negotiation"&&!dealId;');
const loadIndex = block.indexOf("loadCoordinationSession(", negotiationBranch);
const gateIndex = block.indexOf("evaluateDealCreation(", negotiationBranch);
const deniedIndex = block.indexOf('throw appError("deal_not_serious_yet",409', negotiationBranch);
const createDealIndex = block.indexOf("await createDealFromMatch(", negotiationBranch);
const firstMatchWriteAfterBranch = block.indexOf("await setFirestoreDocument", negotiationBranch);

assert.ok(negotiationBranch >= 0, "negotiation transition must have an explicit guarded branch");
assert.ok(loadIndex > negotiationBranch, "advance_match must load authoritative coordinationSessions before negotiation");
assert.ok(gateIndex > loadIndex, "negotiation gate must be evaluated after loading coordinationSessions");
assert.ok(deniedIndex > gateIndex && deniedIndex < createDealIndex, "denied gate must stop the transition before Deal creation");
assert.ok(createDealIndex > gateIndex, "Deal creation must happen only after the negotiation gate succeeds");
assert.ok(firstMatchWriteAfterBranch > createDealIndex, "match write in the negotiation branch must happen only after successful gate and Deal creation");
assert.equal(block.includes("m.coordinationOutcome"), false, "advance_match must not gate negotiation from the match coordinationOutcome projection");

const gateSlice = block.slice(loadIndex, createDealIndex);
assert.match(gateSlice, /coordination\s*\}\);/, "evaluateDealCreation must receive the authoritative coordination session");

console.log("workflow negotiation gate regression tests passed");
