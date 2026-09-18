#!/usr/bin/env node
import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import { formatOpportunityReference } from "../public/js/reference-code-domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { buildOpportunityActionIndex } from "../public/js/opportunity-action-projection-domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const TARGET_REFS = new Set(["A-4886", "A-0019"]);
const ACTIVE = new Set(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE", "READY"]);
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) throw new Error("STAGING_READ_ACCESS_UNAVAILABLE");
const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);

function iso(value) {
  if (!value) return "";
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value.seconds != null) return new Date(Number(value.seconds) * 1000).toISOString();
  const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}
function metadata(op = {}) {
  if (op.metadata && typeof op.metadata === "object") return op.metadata;
  try { return JSON.parse(op.metadataJson || "{}"); } catch { return {}; }
}
function pair(match = {}) {
  const m = metadata(match);
  return {
    requestId: String(match.requestOpportunityId || match.clientRequestId || match.requestId || m.requestOpportunityId || m.clientRequestId || m.requestId || ""),
    offerId: String(match.offerOpportunityId || match.ownerOfferId || match.offerId || m.offerOpportunityId || m.ownerOfferId || m.offerId || "")
  };
}
function ref(doc) { return formatOpportunityReference(doc.id).replace(/^#/, ""); }

async function main() {
  const oppSnap = await db.collectionGroup("opportunities").get();
  const targets = oppSnap.docs.filter((d) => TARGET_REFS.has(ref(d)));
  const targetIds = new Set(targets.map((d) => d.id));
  const byOffice = new Map();
  for (const d of targets) {
    const office = d.ref.parent.parent;
    if (!office) continue;
    const bucket = byOffice.get(office.path) || { office, ids: new Set() };
    bucket.ids.add(d.id); byOffice.set(office.path, bucket);
  }
  const report = { targets: targets.map((d) => { const x=d.data()||{}; return { id:d.id, reference:ref(d), officeId:d.ref.parent.parent?.id||"", kind:String(x.opportunityKind||x.kind||""), matchingReadiness:String(x.matchingReadiness||""), lifecycleStatus:String(x.lifecycleStatus||x.status||""), updatedAt:iso(x.updatedAt) }; }), offices: [] };

  for (const { office, ids } of byOffice.values()) {
    const [matchSnap, opSnap, notifSnap] = await Promise.all([
      office.collection("matches").get(),
      office.collection("operations").get(),
      office.collection("notifications").get().catch(() => ({ docs: [] }))
    ]);
    const matches = matchSnap.docs.map((d) => ({ id:d.id, ...(d.data()||{}) }));
    const ops = opSnap.docs.map((d) => ({ id:d.id, ...(d.data()||{}) }));
    const notifications = notifSnap.docs.map((d) => ({ id:d.id, ...(d.data()||{}) }));
    const linkedMatches = matches.filter((m) => { const p=pair(m); return ids.has(p.requestId) || ids.has(p.offerId); });
    const linkedMatchIds = new Set(linkedMatches.map((m) => m.id));
    const linkedOps = ops.filter((op) => linkedMatchIds.has(String(op.matchId||metadata(op).matchId||"")) || ids.has(String(op.opportunityId||"")));
    const activeOps = ops.filter((op) => ACTIVE.has(String(op.status||"").toUpperCase()));
    const projected = activeOps.map((op) => projectOperationToUiItem(op));
    const actionIndex = buildOpportunityActionIndex(projected, { officeId: office.id });
    report.offices.push({
      officeId: office.id,
      targetIds: [...ids],
      linkedMatches: linkedMatches.map((m) => { const p=pair(m); return { matchId:m.id, requestId:p.requestId, offerId:p.offerId, status:String(m.status||""), active:m.active!==false, score:Number(m.score||m.opportunityScore||0), integrityStatus:String(m.integrityStatus||""), operationId:String(m.operationId||""), createdAt:iso(m.createdAt), updatedAt:iso(m.updatedAt) }; }),
      linkedOperations: linkedOps.map((op) => { const md=metadata(op); return { operationId:op.id, type:String(op.type||op.operationType||""), status:String(op.status||""), officeId:String(op.officeId||""), matchId:String(op.matchId||md.matchId||""), opportunityId:String(op.opportunityId||""), requestId:String(op.clientRequestId||md.clientRequestId||md.requestId||""), offerId:String(op.ownerOfferId||md.ownerOfferId||md.offerId||""), assignedBrokerId:String(op.assignedBrokerId||""), createdAt:iso(op.createdAt), updatedAt:iso(op.updatedAt), inActiveFeed:ACTIVE.has(String(op.status||"").toUpperCase()) }; }),
      projections: [...ids].map((id) => { const a=actionIndex.get(id)||null; return { opportunityId:id, action:a ? { badge:a.badge, actionCode:a.actionCode, operationId:a.operationId, matchId:a.matchId, matchCount:a.matchCount } : null }; }),
      notifications: notifications.filter((n) => linkedMatchIds.has(String(n.matchId||metadata(n).matchId||"")) || linkedOps.some((op)=>String(n.operationId||n.taskId||"")===op.id)).map((n)=>({ id:n.id, type:String(n.type||""), operationId:String(n.operationId||n.taskId||""), matchId:String(n.matchId||metadata(n).matchId||""), status:String(n.status||""), createdAt:iso(n.createdAt) })),
      counts:{ matches:matches.length, operations:ops.length, activeOperations:activeOps.length, matchReviewOperations:ops.filter((op)=>String(op.type||op.operationType||"").toUpperCase()==="MATCH_REVIEW").length }
    });
  }
  console.log("CURRENT_MATCH_DIAGNOSTIC");
  console.log(JSON.stringify(report, null, 2));
  await app.delete();
}
main().catch(async (e)=>{ console.error("CURRENT_MATCH_DIAGNOSTIC_FAILED", e?.stack||e); try{await app.delete();}catch{} process.exit(1); });
