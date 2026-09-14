import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const OFFICE_ID = "staging-sultan";
const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsed.serviceAccount) {
  console.error("STAGING_READ_ACCESS_UNAVAILABLE");
  process.exit(1);
}
const app = admin.initializeApp({ credential: admin.cert(parsed.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const officeRef = db.collection("offices").doc(OFFICE_ID);
const [oppSnap, matchSnap, opSnap] = await Promise.all([
  officeRef.collection("opportunities").get(),
  officeRef.collection("matches").get(),
  officeRef.collection("operations").get()
]);
const iso = (v) => {
  if (!v) return "";
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v.seconds != null) return new Date(Number(v.seconds) * 1000).toISOString();
  const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
const oppIds = new Set(oppSnap.docs.map(d => d.id));
const operations = opSnap.docs.map(d => ({ id:d.id, ...(d.data() || {}) }));
const pair = (x={}) => ({
  requestId: String(x.clientRequestId || x.requestOpportunityId || x.requestId || x.metadata?.clientRequestId || x.metadata?.requestOpportunityId || x.metadata?.requestId || ""),
  offerId: String(x.ownerOfferId || x.offerOpportunityId || x.offerId || x.metadata?.ownerOfferId || x.metadata?.offerOpportunityId || x.metadata?.offerId || "")
});
const matches = matchSnap.docs.map(d => ({ id:d.id, ...(d.data() || {}) })).sort((a,b)=>String(iso(b.updatedAt||b.createdAt)).localeCompare(String(iso(a.updatedAt||a.createdAt))));
const recentMatches = matches.slice(0,20).map(m => {
  const p = pair(m);
  const linked = operations.filter(o => String(o.matchId || o.metadata?.matchId || "") === m.id);
  return {
    matchId:m.id,
    status:String(m.status||""),
    integrityStatus:String(m.integrityStatus||""),
    operationIdOnMatch:String(m.operationId||""),
    requestOpportunityId:p.requestId,
    offerOpportunityId:p.offerId,
    requestExists:oppIds.has(p.requestId),
    offerExists:oppIds.has(p.offerId),
    createdAt:iso(m.createdAt),
    updatedAt:iso(m.updatedAt),
    linkedOperations: linked.map(o => {
      const q=pair(o);
      return {
        operationId:o.id,
        type:String(o.type||o.operationType||""),
        status:String(o.status||""),
        livingStage:String(o.livingStage||o.metadata?.livingStage||""),
        assignedBrokerId:String(o.assignedBrokerId||o.brokerId||o.ownerId||""),
        opportunityId:String(o.opportunityId||o.originOpportunityId||o.metadata?.originOpportunityId||""),
        requestOpportunityId:q.requestId,
        offerOpportunityId:q.offerId,
        createdAt:iso(o.createdAt),
        updatedAt:iso(o.updatedAt)
      };
    })
  };
});
const recentMatchReviewOps = operations.filter(o => String(o.type||o.operationType||"").toUpperCase()==="MATCH_REVIEW").sort((a,b)=>String(iso(b.updatedAt||b.createdAt)).localeCompare(String(iso(a.updatedAt||a.createdAt)))).slice(0,30).map(o=>{
  const p=pair(o);
  return {
    operationId:o.id,
    matchId:String(o.matchId||o.metadata?.matchId||""),
    type:String(o.type||o.operationType||""),
    status:String(o.status||""),
    livingStage:String(o.livingStage||o.metadata?.livingStage||""),
    assignedBrokerId:String(o.assignedBrokerId||o.brokerId||o.ownerId||""),
    opportunityId:String(o.opportunityId||o.originOpportunityId||o.metadata?.originOpportunityId||""),
    requestOpportunityId:p.requestId,
    offerOpportunityId:p.offerId,
    opportunityExists:oppIds.has(String(o.opportunityId||o.originOpportunityId||o.metadata?.originOpportunityId||"")),
    requestExists:oppIds.has(p.requestId),
    offerExists:oppIds.has(p.offerId),
    createdAt:iso(o.createdAt),
    updatedAt:iso(o.updatedAt)
  };
});
console.log(JSON.stringify({ projectId:PROJECT_ID, officeId:OFFICE_ID, counts:{ opportunities:oppSnap.size, matches:matchSnap.size, operations:opSnap.size, matchReviewOperations:recentMatchReviewOps.length }, recentMatches, recentMatchReviewOps }, null, 2));
await app.delete();
