import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getRecordMandate, mandateFloor, setRecordMandate } from "../worker/src/office-os/mandate-service.js";
import { mandateDecision } from "../public/os/domain/direct-match-domain.js";

function fixture() {
  const docs = new Map();
  const key = (p) => p.join("/");
  const store = {
    async get(p) { const d = docs.get(key(p)); return d ? structuredClone({ id: p.at(-1), ...d }) : null; },
    async set(p, data) { docs.set(key(p), { ...docs.get(key(p)), ...structuredClone(data) }); },
    async create(p, data) { if (docs.has(key(p))) return false; await this.set(p, data); return true; }
  };
  const ctx = { store, now: () => new Date("2026-10-18T20:00:00Z"), deps: { sha256Hex: async (s) => createHash("sha256").update(s).digest("hex"), appError: (code, status, message) => Object.assign(Error(message), { code, status }) } };
  store.set(["offices", "o1", "opportunities", "villa"], { officeId: "o1", opportunityKind: "OFFER", priceOrBudget: 1_500_000, salePrice: 1_500_000, lifecycleStatus: "ACTIVE" });
  store.set(["offices", "o1", "opportunities", "req"], { officeId: "o1", opportunityKind: "REQUEST", priceOrBudget: 1_500_000, lifecycleStatus: "ACTIVE" });
  const audits = () => [...docs].filter(([k]) => k.startsWith("offices/o1/auditLogs/")).map(([, d]) => d);
  return { ctx, docs, audits };
}
const MANAGER = { uid: "owner", isManager: true }, BROKER = { uid: "b1", isManager: false };

test("only the manager sets or reads the owner's floor", async () => {
  const f = fixture();
  await assert.rejects(setRecordMandate(f.ctx, { officeId: "o1", actor: BROKER, recordId: "villa", floor: 1_400_000, source: "اتصال مع المالك" }), (e) => e.status === 403);
  await assert.rejects(getRecordMandate(f.ctx, { officeId: "o1", actor: BROKER, recordId: "villa" }), (e) => e.status === 403);
  const set = await setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 1_400_000, source: "اتصال مع المالك اليوم" });
  assert.equal(set.mandate.floor, 1_400_000);
  assert.equal((await getRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa" })).mandate.source, "اتصال مع المالك اليوم");
});

test("the floor needs its source, belongs to offers only, and never exceeds the listed price", async () => {
  const f = fixture();
  await assert.rejects(setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 1_400_000, source: "" }), (e) => e.code === "mandate_source_required");
  await assert.rejects(setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 1_600_000, source: "تفويض" }), (e) => e.code === "floor_above_price");
  await assert.rejects(setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "req", floor: 1_000_000, source: "تفويض" }), (e) => e.code === "offer_required");
  await assert.rejects(setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "missing", floor: 1_000_000, source: "تفويض" }), (e) => e.status === 404);
});

test("the floor is stored apart from the record, and the audit records the change without the amount", async () => {
  const f = fixture();
  await setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 1_400_000, source: "تفويض مكتوب" });
  assert.equal((await f.ctx.store.get(["offices", "o1", "opportunities", "villa"])).negotiationFloor, undefined, "nothing on the record");
  const audit = f.audits();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "RECORD_MANDATE_SET");
  assert.ok(!audit[0].detailsJson.includes("1400000"));
});

test("the agent's routing: within the floor → «ضمن التفويض», below or none → the owner answers; clearing removes it", async () => {
  const f = fixture();
  assert.equal(mandateDecision({ floor: await mandateFloor(f.ctx, "o1", "villa") }, 1_450_000), "OWNER_APPROVAL_REQUIRED", "no floor: the owner answers");
  await setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 1_400_000, source: "تفويض مكتوب" });
  assert.equal(mandateDecision({ floor: await mandateFloor(f.ctx, "o1", "villa") }, 1_450_000), "WITHIN_MANDATE");
  assert.equal(mandateDecision({ floor: await mandateFloor(f.ctx, "o1", "villa") }, 1_300_000), "OWNER_APPROVAL_REQUIRED");
  assert.equal(await mandateFloor(f.ctx, "o2", "villa"), null, "another office's floor is never read");
  await setRecordMandate(f.ctx, { officeId: "o1", actor: MANAGER, recordId: "villa", floor: 0 });
  assert.equal(await mandateFloor(f.ctx, "o1", "villa"), null);
});
