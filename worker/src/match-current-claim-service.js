function isClaimConflict(error) {
  const code = String(error?.code || error?.firestoreCode || "").toUpperCase();
  const message = String(error?.message || "").toUpperCase();
  return code === "ABORTED"
    || code === "FAILED_PRECONDITION"
    || message.includes("ABORTED")
    || message.includes("FAILED_PRECONDITION");
}

export async function claimCurrentMatchForPairRule({
  pairRuleKey,
  targetMatchId,
  loadSnapshot,
  commitClaim,
  maxAttempts = 5
}) {
  if (!pairRuleKey) throw new Error("pairRuleKey is required");
  if (!targetMatchId) throw new Error("targetMatchId is required");
  if (typeof loadSnapshot !== "function") throw new Error("loadSnapshot is required");
  if (typeof commitClaim !== "function") throw new Error("commitClaim is required");
  const attemptsLimit = Math.max(1, Math.min(10, Number(maxAttempts) || 5));

  for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
    const snapshot = await loadSnapshot({ pairRuleKey, targetMatchId, attempt });
    const currentMatches = Array.isArray(snapshot?.currentMatches) ? snapshot.currentMatches : [];
    const pointer = snapshot?.pointer || null;
    const supersededMatchIds = [...new Set([
      ...currentMatches
        .filter(match => String(match?.pairRuleKey || "") === String(pairRuleKey))
        .filter(match => match?.isCurrent !== false && String(match?.status || "") !== "superseded")
        .map(match => String(match?.matchId || ""))
        .filter(matchId => matchId && matchId !== targetMatchId),
      pointer?.currentMatchId && pointer.currentMatchId !== targetMatchId ? String(pointer.currentMatchId) : ""
    ].filter(Boolean))];

    try {
      await commitClaim({
        pairRuleKey,
        targetMatchId,
        supersededMatchIds,
        pointer,
        attempt
      });
      return { pairRuleKey, targetMatchId, supersededMatchIds, attempts: attempt };
    } catch (error) {
      if (!isClaimConflict(error) || attempt >= attemptsLimit) throw error;
    }
  }

  throw new Error("current match claim attempts exhausted");
}
