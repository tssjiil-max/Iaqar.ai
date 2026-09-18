import fs from "node:fs";

const file = "scripts/staging-fresh-match-lineage-verify.mjs";
let source = fs.readFileSync(file, "utf8");

const matchingAnchor = "    const matching = await runMatching(auth.idToken);";
if (!source.includes(matchingAnchor)) throw new Error("matching anchor missing");
source = source.replace(matchingAnchor, `    const concurrentMatching = await Promise.all(Array.from({ length: 4 }, () => runMatching(auth.idToken)));
    const concurrentMatchIds = [...new Set(concurrentMatching.map((row) => String(row.matchId || "")).filter(Boolean))];
    if (concurrentMatchIds.length !== 1) throw new Error(\`concurrent matching returned multiple current candidates \${JSON.stringify(concurrentMatchIds)}\`);
    const matching = concurrentMatching[0];`);

const cleanupAnchor = "async function cleanup() {";
if (!source.includes(cleanupAnchor)) throw new Error("cleanup anchor missing");
const helpers = `async function workflowAction(idToken, action, recordId, extra = {}) {
  const response = await fetch(\`${STAGING_WORKER}/workflow/action\`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${idToken}\` },
    body: JSON.stringify({ officeId: OFFICE_ID, action, recordId, ...extra })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(\`workflow \${action} failed \${response.status} \${JSON.stringify(body)}\`);
  return { status: response.status, ...body };
}

function isActiveOperation(data = {}) {
  const status = String(data.status || "").toUpperCase();
  return !["DONE", "COMPLETED", "CLOSED", "CANCELLED", "EXPIRED", "SUPERSEDED", "RESOLVED"].includes(status);
}

async function verifyCurrentInvariant(matchId) {
  const matchSnap = await office.collection("matches").doc(matchId).get();
  if (!matchSnap.exists) throw new Error("current match missing");
  const match = matchSnap.data() || {};
  const pairRule = String(match.pairRuleKey || "");
  if (!pairRule) throw new Error("pairRuleKey missing from live match");
  const [matchesSnap, pointerSnap, reviewSnap] = await Promise.all([
    office.collection("matches").where("pairRuleKey", "==", pairRule).get(),
    office.collection("matchCurrentPointers").doc(pairRule).get(),
    office.collection("operations").where("matchId", "==", matchId).get()
  ]);
  const current = matchesSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    return data.isCurrent !== false && String(data.status || "").toLowerCase() !== "superseded";
  });
  if (current.length !== 1) throw new Error(\`expected exactly one current match for pairRuleKey, got \${current.length}\`);
  if (!pointerSnap.exists) throw new Error("matchCurrentPointers document missing");
  const pointer = pointerSnap.data() || {};
  if (String(pointer.currentMatchId || "") !== current[0].id || current[0].id !== matchId) {
    throw new Error(\`current pointer mismatch \${JSON.stringify({ matchId, current: current[0]?.id, pointer: pointer.currentMatchId })}\`);
  }
  const reviews = reviewSnap.docs.filter((doc) => String(doc.data()?.operationType || doc.data()?.type || "").toUpperCase() === "MATCH_REVIEW");
  if (reviews.length !== 1) throw new Error(\`expected exactly one MATCH_REVIEW, got \${reviews.length}\`);
  return {
    pairRuleKey: pairRule,
    currentMatchId: current[0].id,
    pointerMatchId: String(pointer.currentMatchId || ""),
    currentCount: current.length,
    matchReviewCount: reviews.length,
    matchReviewOperationId: reviews[0].id,
    pairMatchCount: matchesSnap.size
  };
}

async function completeDealLifecycle(idToken, matchId) {
  const created = await workflowAction(idToken, "create_deal", matchId, { commissionExpected: 2500, note: "QA full-chain deal creation" });
  const dealId = String(created.dealId || "");
  if (!dealId) throw new Error("create_deal returned no dealId");

  let dealSnap = await office.collection("deals").doc(dealId).get();
  if (!dealSnap.exists) throw new Error("Deal not persisted after create_deal");
  let deal = dealSnap.data() || {};
  const stages = [String(deal.workflowStage || "")];

  while (!["agreement", "closing", "closed"].includes(String(deal.workflowStage || ""))) {
    await workflowAction(idToken, "advance_deal", dealId, { note: "QA advance deal" });
    dealSnap = await office.collection("deals").doc(dealId).get();
    deal = dealSnap.data() || {};
    stages.push(String(deal.workflowStage || ""));
    if (stages.length > 6) throw new Error(\`deal did not reach agreement \${JSON.stringify(stages)}\`);
  }

  if (String(deal.workflowStage || "") === "agreement") {
    for (const contractStatus of ["draft", "pending_signature", "signed"]) {
      await workflowAction(idToken, "set_brokerage_contract_status", dealId, {
        contractStatus,
        contractReference: `QA-${RUN_ID}`
      });
    }
    const closing = await workflowAction(idToken, "advance_deal", dealId, { note: "QA move to closing" });
    if (String(closing.workflowStage || "") !== "closing") throw new Error(\`deal did not reach closing \${JSON.stringify(closing)}\`);
    stages.push("closing");
    const closed = await workflowAction(idToken, "advance_deal", dealId, { note: "QA close deal", commissionActual: 2500 });
    if (String(closed.workflowStage || "") !== "closed" || String(closed.status || "") !== "closed") {
      throw new Error(\`deal did not close \${JSON.stringify(closed)}\`);
    }
    stages.push("closed");
  } else if (String(deal.workflowStage || "") === "closing") {
    const closed = await workflowAction(idToken, "advance_deal", dealId, { note: "QA close deal", commissionActual: 2500 });
    if (String(closed.workflowStage || "") !== "closed") throw new Error("closing deal did not close");
    stages.push("closed");
  }

  const [finalDealSnap, finalMatchSnap] = await Promise.all([
    office.collection("deals").doc(dealId).get(),
    office.collection("matches").doc(matchId).get()
  ]);
  const finalDeal = finalDealSnap.data() || {};
  const finalMatch = finalMatchSnap.data() || {};
  if (String(finalDeal.status || "") !== "closed" || String(finalDeal.workflowStage || "") !== "closed") throw new Error("Deal source of truth is not closed");
  if (String(finalDeal.matchId || "") !== matchId) throw new Error("Deal lost matchId linkage");
  if (String(finalMatch.status || "") !== "completed" || String(finalMatch.workflowStage || "") !== "completed") throw new Error("Match was not completed when Deal closed");
  if (String(finalMatch.dealId || "") !== dealId) throw new Error("Match lost dealId linkage");
  return { dealId, stages, finalDealStatus: finalDeal.status, finalDealStage: finalDeal.workflowStage, finalMatchStatus: finalMatch.status, finalMatchStage: finalMatch.workflowStage };
}

async function auditFixtureOrphans(matchId, dealId, pairRuleKey) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const [matchSnap, dealSnap, opsByMatch, opsByDeal, notificationsByMatch, notificationsByDeal, pairMatches] = await Promise.all([
    office.collection("matches").doc(matchId).get(),
    office.collection("deals").doc(dealId).get(),
    office.collection("operations").where("matchId", "==", matchId).get(),
    office.collection("operations").where("dealId", "==", dealId).get().catch(() => ({ docs: [] })),
    office.collection("notifications").where("matchId", "==", matchId).get().catch(() => ({ docs: [] })),
    office.collection("notifications").where("dealId", "==", dealId).get().catch(() => ({ docs: [] })),
    office.collection("matches").where("pairRuleKey", "==", pairRuleKey).get()
  ]);
  if (!matchSnap.exists || !dealSnap.exists) throw new Error("orphan audit lost core Match/Deal documents");
  const operationMap = new Map();
  for (const doc of [...opsByMatch.docs, ...opsByDeal.docs]) operationMap.set(doc.id, doc);
  const notificationMap = new Map();
  for (const doc of [...notificationsByMatch.docs, ...notificationsByDeal.docs]) notificationMap.set(doc.id, doc);
  const orphanOperations = [];
  for (const [id, doc] of operationMap) {
    const data = doc.data() || {};
    if (data.matchId && String(data.matchId) !== matchId) orphanOperations.push({ id, reason: "wrong_match", ref: data.matchId });
    if (data.dealId && String(data.dealId) !== dealId) orphanOperations.push({ id, reason: "wrong_deal", ref: data.dealId });
  }
  const orphanNotifications = [];
  for (const [id, doc] of notificationMap) {
    const data = doc.data() || {};
    if (data.matchId && String(data.matchId) !== matchId) orphanNotifications.push({ id, reason: "wrong_match", ref: data.matchId });
    if (data.dealId && String(data.dealId) !== dealId) orphanNotifications.push({ id, reason: "wrong_deal", ref: data.dealId });
    if (data.operationId && !operationMap.has(String(data.operationId))) {
      const referenced = await office.collection("operations").doc(String(data.operationId)).get();
      if (!referenced.exists) orphanNotifications.push({ id, reason: "missing_operation", ref: data.operationId });
    }
  }
  const activeSupersededOps = [];
  for (const matchDoc of pairMatches.docs) {
    if (matchDoc.id === matchId) continue;
    const data = matchDoc.data() || {};
    if (data.isCurrent === false || String(data.status || "").toLowerCase() === "superseded") {
      const oldOps = await office.collection("operations").where("matchId", "==", matchDoc.id).get();
      for (const opDoc of oldOps.docs) if (isActiveOperation(opDoc.data() || {})) activeSupersededOps.push(opDoc.id);
    }
  }
  if (orphanOperations.length || orphanNotifications.length || activeSupersededOps.length) {
    throw new Error(\`orphan audit failed \${JSON.stringify({ orphanOperations, orphanNotifications, activeSupersededOps })}\`);
  }
  return {
    operationCount: operationMap.size,
    notificationCount: notificationMap.size,
    orphanOperations,
    orphanNotifications,
    activeSupersededOps
  };
}

`;
source = source.replace(cleanupAnchor, helpers + cleanupAnchor);

const submittedAnchor = "    const ownerSubmitted = Boolean(ownerView?.decisionPackage?.submitted || ownerView?.replied);";
if (!source.includes(submittedAnchor)) throw new Error("ownerSubmitted anchor missing");
source = source.replace(submittedAnchor, submittedAnchor + `

    markStage("verify-concurrent-current-invariant");
    const currentInvariant = await verifyCurrentInvariant(matching.matchId);
    if (currentInvariant.matchReviewOperationId !== initial.operationId) throw new Error("MATCH_REVIEW identity drift after concurrent matching");

    markStage("deal-create-contract-close");
    const dealLifecycle = await completeDealLifecycle(auth.idToken, matching.matchId);

    markStage("audit-orphans");
    const orphanAudit = await auditFixtureOrphans(matching.matchId, dealLifecycle.dealId, currentInvariant.pairRuleKey);`);

const verifiedAnchor = "      && finalState.coordinationExists && finalState.coordinationSessionId === matching.matchId && finalState.coordinationMatchId === matching.matchId";
if (!source.includes(verifiedAnchor)) throw new Error("verified anchor missing");
source = source.replace(verifiedAnchor, verifiedAnchor + `
      && currentInvariant.currentCount === 1 && currentInvariant.pointerMatchId === matching.matchId && currentInvariant.matchReviewCount === 1
      && dealLifecycle.finalDealStatus === "closed" && dealLifecycle.finalMatchStatus === "completed"
      && orphanAudit.orphanOperations.length === 0 && orphanAudit.orphanNotifications.length === 0 && orphanAudit.activeSupersededOps.length === 0`);

const reportAnchor = "      finalState, sessionCount: sessions.length, partyCount: parties.size, stableTokenCount: tokens.size, verified";
if (!source.includes(reportAnchor)) throw new Error("report anchor missing");
source = source.replace(reportAnchor, "      finalState, concurrentMatchingCount: concurrentMatching.length, currentInvariant, dealLifecycle, orphanAudit, sessionCount: sessions.length, partyCount: parties.size, stableTokenCount: tokens.size, verified");

const cleanupMatchAnchor = "    await office.collection(\"matches\").doc(activeMatchId).delete().catch(() => {});";
if (!source.includes(cleanupMatchAnchor)) throw new Error("cleanup match anchor missing");
source = source.replace(cleanupMatchAnchor, `    const matchBeforeCleanup = await office.collection("matches").doc(activeMatchId).get().catch(() => null);
    const matchDataBeforeCleanup = matchBeforeCleanup?.data?.() || {};
    const dealIdBeforeCleanup = String(matchDataBeforeCleanup.dealId || "");
    const pairRuleBeforeCleanup = String(matchDataBeforeCleanup.pairRuleKey || "");
    const matchTimeline = await office.collection("matches").doc(activeMatchId).collection("timeline").get().catch(() => ({ docs: [] }));
    await Promise.all(matchTimeline.docs.map((doc) => doc.ref.delete().catch(() => {})));
    if (dealIdBeforeCleanup) {
      const dealTimeline = await office.collection("deals").doc(dealIdBeforeCleanup).collection("timeline").get().catch(() => ({ docs: [] }));
      await Promise.all(dealTimeline.docs.map((doc) => doc.ref.delete().catch(() => {})));
      await office.collection("deals").doc(dealIdBeforeCleanup).delete().catch(() => {});
    }
    if (pairRuleBeforeCleanup) await office.collection("matchCurrentPointers").doc(pairRuleBeforeCleanup).delete().catch(() => {});
    await office.collection("matches").doc(activeMatchId).delete().catch(() => {});`);

fs.writeFileSync(file, source);
console.log("patched live full-chain E2E");
