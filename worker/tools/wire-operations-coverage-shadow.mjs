import fs from "node:fs";

const indexPath = new URL("../src/index.js", import.meta.url);
const canonicalPath = new URL("../src/canonical-intake-service.js", import.meta.url);

function replaceOnce(text, needle, replacement, label) {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return text.replace(needle, replacement);
}

function replaceRegexOnce(text, regex, replacement, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one regex match, found ${matches.length}`);
  return text.replace(regex, replacement);
}

let index = fs.readFileSync(indexPath, "utf8");

index = replaceOnce(
  index,
  `} from "./operations-service.js";\nimport {\n  phase6BoundaryGuarantees,`,
  `} from "./operations-service.js";\nimport {\n  opportunityCoverageIntent,\n  dealCoverageIntent\n} from "./operations-coverage-sync.js";\nimport {\n  phase6BoundaryGuarantees,`,
  "coverage import"
);

const observers = `async function observeOpportunityCoverageShadow({\n  projectId, officeId, opportunityId, accessToken, source = "unknown"\n}) {\n  try {\n    const doc = await getFirestoreDocument({\n      projectId,\n      segments: ["offices", officeId, "opportunities", opportunityId],\n      accessToken,\n      allowMissing: true\n    });\n    if (!doc) {\n      console.warn("[iaqar-ops-shadow] opportunity missing", { officeId, opportunityId, source });\n      return { observed: false, reason: "opportunity_missing" };\n    }\n    const opportunity = { id: opportunityId, ...firestoreFieldsToJs(doc.fields || {}) };\n    const decision = opportunityCoverageIntent(opportunity);\n    console.log(JSON.stringify({\n      event: "operations_coverage_shadow",\n      entityType: "opportunity",\n      source,\n      officeId,\n      entityId: opportunityId,\n      intent: decision.intent,\n      reason: decision.reason,\n      dueAt: decision.dueAt || "",\n      missingFields: decision.missingFields || [],\n      lifecycleStatus: String(opportunity.lifecycleStatus || opportunity.internalStatus || ""),\n      workflowStage: String(opportunity.workflowStage || ""),\n      matchingReadiness: String(opportunity.matchingReadiness || "")\n    }));\n    return { observed: true, ...decision };\n  } catch (error) {\n    console.warn("[iaqar-ops-shadow] opportunity observation failed", {\n      officeId, opportunityId, source, message: error?.message || String(error)\n    });\n    return { observed: false, reason: "observer_error" };\n  }\n}\n\nasync function observeDealCoverageShadow({\n  projectId, officeId, dealId, accessToken, source = "unknown"\n}) {\n  try {\n    const doc = await getFirestoreDocument({\n      projectId,\n      segments: ["offices", officeId, "deals", dealId],\n      accessToken,\n      allowMissing: true\n    });\n    if (!doc) {\n      console.warn("[iaqar-ops-shadow] deal missing", { officeId, dealId, source });\n      return { observed: false, reason: "deal_missing" };\n    }\n    const deal = { dealId, ...firestoreFieldsToJs(doc.fields || {}) };\n    const decision = dealCoverageIntent(deal);\n    console.log(JSON.stringify({\n      event: "operations_coverage_shadow",\n      entityType: "deal",\n      source,\n      officeId,\n      entityId: dealId,\n      intent: decision.intent,\n      reason: decision.reason,\n      dueAt: decision.dueAt || "",\n      stage: String(deal.workflowStage || deal.stage || ""),\n      status: String(deal.status || "")\n    }));\n    return { observed: true, ...decision };\n  } catch (error) {\n    console.warn("[iaqar-ops-shadow] deal observation failed", {\n      officeId, dealId, source, message: error?.message || String(error)\n    });\n    return { observed: false, reason: "observer_error" };\n  }\n}\n\n`;

index = replaceOnce(
  index,
  `function operationsDeps(env = null) {`,
  `${observers}function operationsDeps(env = null) {`,
  "shadow observers"
);

index = replaceOnce(
  index,
  `  await setFirestoreDocument({\n    projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken,\n    fields: {\n      ...commonFields,\n      sourceCollection: firestoreString(targetCollection),\n      sourceRecordId: firestoreString(recordId),\n      opportunityKind: firestoreString(parsed.kind === "owner_offer" ? "OFFER" : "REQUEST"),\n      workflowStage: firestoreString("new"),\n      priority: firestoreInteger(parsed.completeness >= 80 ? 1 : 2)\n    }\n  });\n\n  const matches = await runCanonicalMatchingAfterOpportunityPersist({`,
  `  await setFirestoreDocument({\n    projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken,\n    fields: {\n      ...commonFields,\n      sourceCollection: firestoreString(targetCollection),\n      sourceRecordId: firestoreString(recordId),\n      opportunityKind: firestoreString(parsed.kind === "owner_offer" ? "OFFER" : "REQUEST"),\n      workflowStage: firestoreString("new"),\n      priority: firestoreInteger(parsed.completeness >= 80 ? 1 : 2)\n    }\n  });\n\n  await observeOpportunityCoverageShadow({\n    projectId, officeId, opportunityId, accessToken, source: "whatsapp_intake_persisted"\n  });\n\n  const matches = await runCanonicalMatchingAfterOpportunityPersist({`,
  "whatsapp opportunity observer"
);

index = replaceOnce(
  index,
  `  await setFirestoreDocument({\n    projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken,\n    fields\n  });\n\n  const finalRecord = { ...merged, ...readinessFields, version };`,
  `  await setFirestoreDocument({\n    projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken,\n    fields\n  });\n\n  await observeOpportunityCoverageShadow({\n    projectId, officeId, opportunityId, accessToken, source: "opportunity_patch_persisted"\n  });\n\n  const finalRecord = { ...merged, ...readinessFields, version };`,
  "opportunity patch observer"
);

index = replaceOnce(
  index,
  `  await setFirestoreDocument({ projectId, segments: ["offices", officeId, collection, recordId], accessToken, fields });\n  const activityAction = isReschedule ? "followup_rescheduled" : "followup_scheduled";`,
  `  await setFirestoreDocument({ projectId, segments: ["offices", officeId, collection, recordId], accessToken, fields });\n  if (collection === "opportunities") {\n    await observeOpportunityCoverageShadow({\n      projectId, officeId, opportunityId, accessToken,\n      source: isReschedule ? "followup_rescheduled" : "followup_scheduled"\n    });\n  }\n  const activityAction = isReschedule ? "followup_rescheduled" : "followup_scheduled";`,
  "follow-up observer"
);

index = replaceOnce(
  index,
  `  await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:dealId,eventType:"deal_created",stage,note:"تم إنشاء الصفقة من المطابقة",identity,accessToken,createdAt:now});\n  return dealId;`,
  `  await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:dealId,eventType:"deal_created",stage,note:"تم إنشاء الصفقة من المطابقة",identity,accessToken,createdAt:now});\n  await observeDealCoverageShadow({\n    projectId, officeId, dealId, accessToken, source: "deal_created"\n  });\n  return dealId;`,
  "deal creation observer"
);

index = replaceRegexOnce(
  index,
  /(await addWorkflowTimeline\(\{projectId,officeId,recordType:"deal",recordId,eventType:"stage_changed",[\s\S]*?\}\);\n)(\s*return jsonResponse\(\{ok:true,status:"open",workflowStage:requested)/,
  `$1    await observeDealCoverageShadow({ projectId, officeId, dealId: recordId, accessToken, source: "deal_stage_changed" });\n$2`,
  "deal stage observer"
);

index = replaceRegexOnce(
  index,
  /(await addWorkflowTimeline\(\{projectId,officeId,recordType:"deal",recordId,eventType:"follow_up_added",[\s\S]*?\}\);\n)(\s*return jsonResponse\(\{ok:true,status:"noted")/,
  `$1    await observeDealCoverageShadow({ projectId, officeId, dealId: recordId, accessToken, source: "deal_followup_updated" });\n$2`,
  "deal follow-up observer"
);

index = replaceOnce(
  index,
  `    LIFECYCLE_STATUS,\n    extractImageTextFromMediaPath:`,
  `    LIFECYCLE_STATUS,\n    observeOpportunityCoverageShadow: ({ officeId: observedOfficeId, opportunityId: observedOpportunityId, source = "canonical_intake_complete" }) =>\n      observeOpportunityCoverageShadow({\n        projectId,\n        officeId: observedOfficeId,\n        opportunityId: observedOpportunityId,\n        accessToken,\n        source\n      }),\n    extractImageTextFromMediaPath:`,
  "canonical ctx observer"
);

fs.writeFileSync(indexPath, index);

let canonical = fs.readFileSync(canonicalPath, "utf8");
canonical = replaceOnce(
  canonical,
  `  await ctx.setFirestoreDocument({\n    projectId: ctx.projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken: ctx.accessToken,\n    fields: opportunityPatch\n  });\n\n  const jobDoc = await ctx.getFirestoreDocument({`,
  `  await ctx.setFirestoreDocument({\n    projectId: ctx.projectId,\n    segments: ["offices", officeId, "opportunities", opportunityId],\n    accessToken: ctx.accessToken,\n    fields: opportunityPatch\n  });\n\n  if (typeof ctx.observeOpportunityCoverageShadow === "function") {\n    await ctx.observeOpportunityCoverageShadow({\n      officeId,\n      opportunityId,\n      source: "canonical_intake_complete"\n    });\n  }\n\n  const jobDoc = await ctx.getFirestoreDocument({`,
  "canonical completion observer"
);
fs.writeFileSync(canonicalPath, canonical);

console.log("operations coverage shadow wiring applied");
