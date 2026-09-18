import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/index.js"), "utf8");
const start = source.indexOf('if(action==="create_deal"){');
const end = source.indexOf('if(action==="advance_deal"||action==="set_deal_stage"){', start);

assert.ok(start >= 0 && end > start, "create_deal workflow block must exist");
const block = source.slice(start, end);

const loadIndex = block.indexOf("loadCoordinationSession(");
const gateIndex = block.indexOf("evaluateDealCreation(");
const createDealIndex = block.indexOf("await createDealFromMatch(");

assert.ok(loadIndex >= 0, "create_deal must load authoritative coordinationSessions");
assert.ok(gateIndex > loadIndex, "create_deal must evaluate the gate after loading coordinationSessions");
assert.ok(createDealIndex > gateIndex, "Deal creation must happen only after the authoritative gate succeeds");
assert.equal(block.includes("m.coordinationOutcome"), false, "create_deal must not use the match coordinationOutcome projection");

const gateSlice = block.slice(loadIndex, createDealIndex);
assert.match(gateSlice, /evaluateDealCreation\(\{match:m,coordination\}\)/, "create_deal must pass the authoritative coordination session to evaluateDealCreation");

console.log("create_deal coordination gate regression tests passed");
