import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "iaqar-ai-staging";
const SLUG = "thamer";
admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const claimSnap = await db.collection("officeSlugClaims").doc(SLUG).get();
const OFFICE_ID = String(claimSnap.data()?.officeId || "").trim();
console.log("resolvedOfficeId:", OFFICE_ID || "NONE");
if (!OFFICE_ID) process.exit(0);
const office = db.collection("offices").doc(OFFICE_ID);
const snap = await office.collection("matches").orderBy("createdAt","desc").limit(20).get();
const matches = snap.docs.map(d=>({id:d.id,...(d.data()||{})})).filter(x=>x.isTestFixture!==true && x.qaLiveE2e!==true);
for (const m of matches.slice(0,10)) {
  const ops = await office.collection("operations").where("matchId","==",m.id).limit(10).get();
  const review = ops.docs.map(d=>({id:d.id,...(d.data()||{})})).find(x=>String(x.type||"").toUpperCase()==="MATCH_REVIEW");
  const coord = await office.collection("coordinationSessions").doc(m.id).get();
  let cj={}; try { cj=JSON.parse(String(coord.data()?.coordinationJson||"{}")); } catch {}
  console.log(JSON.stringify({
    matchId:m.id,
    createdAt:m.createdAt?.toDate?.()?.toISOString?.()||m.createdAt||"",
    status:m.status||"",
    livingStage:m.livingStage||"",
    nextActor:m.nextActor||"",
    hasNewResponse:m.hasNewResponse||"",
    coordinationOutcome:m.coordinationOutcome||cj.outcome||"",
    coordinationBrokerLine:m.coordinationBrokerLine||cj.brokerLine||"",
    brokerNotes:(cj.brokerNotes||[]).map(n=>({audience:n.audience,message:n.message,createdAt:n.createdAt})),
    clientBundle:Boolean(cj.clientBundle),
    ownerBundle:Boolean(cj.ownerBundle),
    operationId:review?.id||"",
    operationStatus:review?.status||"",
    operationLivingStage:review?.livingStage||"",
    operationNextActor:review?.nextActor||""
  }));
}
