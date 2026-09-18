import fs from "node:fs";

const indexPath = "worker/src/index.js";
const packagePath = "worker/package.json";
let source = fs.readFileSync(indexPath, "utf8");

const blockStart = source.indexOf('  if(action==="start_match"||action==="advance_match"){');
const blockEnd = source.indexOf('\n\n  if(action==="add_match_followup"){', blockStart);
if (blockStart < 0 || blockEnd <= blockStart) {
  throw new Error("advance_match workflow block not found");
}
const oldBlock = source.slice(blockStart, blockEnd);
if (!oldBlock.includes('coordination:{outcome:m.coordinationOutcome||""}')) {
  throw new Error("expected stale coordination projection was not found; refusing an unsafe patch");
}

const replacement = [
'  if(action==="start_match"||action==="advance_match"){',
'    const matchDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken});',
'    const m=firestoreFieldsToJs(matchDoc.fields||{});',
'    const current=normalizeMatchStatus(m.status);',
'    if(current==="completed"||current==="closed") return jsonResponse({ok:true,status:current,statusLabel:MATCH_STATUS_LABELS[current],requestId});',
'    let next=current;',
'    if(action==="start_match"&&["active","new"].includes(current)) next="active";',
'    else if(current==="active") next="waiting_response";',
'    else if(current==="waiting_response") next="viewing";',
'    else if(current==="viewing") next="negotiation";',
'    else if(current==="negotiation") next="negotiation";',
'    const readiness=calculateClosingReadiness({matchScore:m.score,status:next});',
'    const followUpCount=Number(m.followUpCount||0)+1;',
'    const fields={',
'      status:firestoreString(next),statusLabel:firestoreString(MATCH_STATUS_LABELS[next]),workflowStage:firestoreString(next),',
'      nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS[next]),closingReadinessScore:firestoreInteger(readiness.score),closingReadinessKey:firestoreString(readiness.key),closingReadinessLabel:firestoreString(readiness.label),',
'      lastFollowUpAt:firestoreTimestamp(now),nextFollowUpAt:firestoreTimestamp(nextFollowUpAt),followUpCount:firestoreInteger(followUpCount),',
'      lastNote:firestoreOptionalString(note),updatedAt:firestoreTimestamp(now),assignedToUid:firestoreOptionalString(identity.uid),attentionRequired:firestoreBoolean(false)',
'    };',
'    if(next==="viewing") fields.viewingAt=firestoreTimestamp(nextFollowUpAt);',
'    let dealId=m.dealId||"";',
'    const enteringNegotiation=next==="negotiation"&&!dealId;',
'    if(enteringNegotiation){',
'      const coordination=await loadCoordinationSession(partySessionHelpers(),{projectId,officeId,matchId:recordId,accessToken});',
'      const creationGate=evaluateDealCreation({',
'        match:{...m,status:next,closingReadinessScore:readiness.score},',
'        coordination',
'      });',
'      if(!creationGate.allowed){',
'        throw appError("deal_not_serious_yet",409,"لا تُنقل المطابقة إلى التفاوض قبل ظهور جدية فعلية في جلسة التنسيق أو تأكيد المعاينة");',
'      }',
'      dealId=await createDealFromMatch({projectId,officeId,matchId:recordId,matchData:{...m,status:next,closingReadinessScore:readiness.score},identity,accessToken,now,commissionExpected:Number(body.commissionExpected||0),startStage:"negotiation"});',
'      const postDealFields={...fields};',
'      delete postDealFields.status;',
'      delete postDealFields.statusLabel;',
'      delete postDealFields.workflowStage;',
'      delete postDealFields.nextAction;',
'      await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken,fields:postDealFields});',
'      await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId,eventType:"status_changed",stage:next,note:note||`انتقلت المطابقة إلى ${MATCH_STATUS_LABELS[next]}`,identity,accessToken,createdAt:now});',
'      return jsonResponse({ok:true,status:next,statusLabel:MATCH_STATUS_LABELS[next],nextAction:MATCH_NEXT_ACTION_LABELS[next],readiness,dealId,requestId});',
'    }',
'    await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken,fields});',
'    await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId,eventType:current===next?"follow_up":"status_changed",stage:next,note:note||`انتقلت المطابقة إلى ${MATCH_STATUS_LABELS[next]}`,identity,accessToken,createdAt:now});',
'    return jsonResponse({ok:true,status:next,statusLabel:MATCH_STATUS_LABELS[next],nextAction:MATCH_NEXT_ACTION_LABELS[next],readiness,dealId,requestId});',
'  }'
].join("\n");

source = source.slice(0, blockStart) + replacement + source.slice(blockEnd);
fs.writeFileSync(indexPath, source);

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const regression = "node test/workflow-negotiation-gate.test.mjs";
if (!String(pkg.scripts?.test || "").includes(regression)) {
  pkg.scripts.test = `${regression} && ${pkg.scripts.test}`;
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log("applied coordinationSessions-first negotiation gate fix");
