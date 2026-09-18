from pathlib import Path

path = Path("worker/src/index.js")
text = path.read_text(encoding="utf-8")

if "duplicate match review reconcile failed" in text:
    print("MATCH_REVIEW duplicate reconciliation already applied")
    raise SystemExit(0)

start_marker = """      return {
        matchId, duplicate: true, score: scored.score, opportunityScore: scored.opportunityScore,"""
end_marker = """        integrityStatus: MATCH_INTEGRITY.VALID
      };"""
start = text.find(start_marker)
if start < 0:
    raise SystemExit("duplicate return block not found")
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit("duplicate return end not found")
end += len(end_marker)

replacement = """      const persisted = {
        ...existing,
        matchId, duplicate: true, score: scored.score, opportunityScore: scored.opportunityScore,
        priority: scored.priority, closingReadiness: scored.readiness, status: "active",
        statusLabel: MATCH_STATUS_LABELS.active, nextAction: MATCH_NEXT_ACTION_LABELS.active,
        rank, isBestOpportunity: rank === 1, reasons: scored.reasons, warnings: scored.warnings,
        metrics: scored.metrics, breakdown: scored.breakdown,
        city: source.city || candidate.city || DEFAULT_CITY,
        district: source.district || candidate.district || "",
        propertyType: source.propertyType || candidate.propertyType || "",
        matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion, pairKey,
        opportunityId: opportunityId || existing.opportunityId || "",
        counterpartOpportunityId: counterpartOpportunityId || existing.counterpartOpportunityId || "",
        isCurrent: true,
        assignedBrokerId: assignedBrokerId || existing.assignedBrokerId || "",
        requestId: clientRequestId, offerId: ownerOfferId, clientRequestId, ownerOfferId,
        integrityStatus: MATCH_INTEGRITY.VALID,
        matchGroupId: existing.matchGroupId || opportunityId || sourceRecordId || clientRequestId || pairKey,
        sourceCollection: existing.sourceCollection || sourceCollection,
        candidateSalePrice: Number(existing.candidateSalePrice || candidate.salePrice || candidate.price || 0),
        candidateArea: Number(existing.candidateArea || candidate.area || 0),
        candidatePropertyType: existing.candidatePropertyType || candidate.propertyType || "",
        candidateDistrict: existing.candidateDistrict || candidate.district || "",
        candidateCity: existing.candidateCity || candidate.city || "",
        candidatePurpose: existing.candidatePurpose || candidate.purpose || candidate.transactionType || ""
      };

      // Heal legacy/current matches that exist without their deterministic MATCH_REVIEW operation.
      try {
        const bundle = await createMatchReviewBundle({
          projectId,
          officeId,
          match: persisted,
          threshold: MATCH_THRESHOLD,
          assignedBrokerId: persisted.assignedBrokerId,
          notifyPush: notifyOperation === true,
          accessToken,
          deps: operationsDeps(env)
        });
        persisted.operationId = bundle.operation?.id || "";
        persisted.operationCreated = Boolean(bundle.created);
      } catch (error) {
        console.warn("[iaqar-ops] duplicate match review reconcile failed", error && error.message);
        persisted.operationCreated = false;
      }

      return persisted;"""

path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
print("Applied MATCH_REVIEW duplicate reconciliation patch")
