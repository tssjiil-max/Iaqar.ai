/**
 * Post-viewing party decisions.
 * Pure domain only: no matching, persistence, session minting or task creation.
 */

export const POST_VIEWING_STAGE = "VIEWING_COMPLETED";

export const POST_VIEWING_ACTIONS = Object.freeze({
  client: Object.freeze([
    Object.freeze({ id: "serious_continue", label: "أرغب بالمتابعة" }),
    Object.freeze({ id: "needs_negotiation", label: "استكمال التفاوض" }),
    Object.freeze({ id: "not_interested", label: "غير مهتم" })
  ]),
  owner: Object.freeze([
    Object.freeze({ id: "approve_continue", label: "موافق على المتابعة" }),
    Object.freeze({ id: "needs_negotiation", label: "استكمال التفاوض" }),
    Object.freeze({ id: "not_interested", label: "غير موافق" })
  ])
});

const IDS = Object.freeze({
  client: new Set(POST_VIEWING_ACTIONS.client.map((item) => item.id)),
  owner: new Set(POST_VIEWING_ACTIONS.owner.map((item) => item.id))
});

function role(value) {
  return String(value || "").toLowerCase() === "owner" ? "owner" : "client";
}

export function isPostViewingStage(livingStage = "") {
  return String(livingStage || "").toUpperCase() === POST_VIEWING_STAGE;
}

export function postViewingActionsForRole(party, { livingStage = "", existingDecision = "" } = {}) {
  const normalizedRole = role(party);
  if (!isPostViewingStage(livingStage) || String(existingDecision || "").trim()) return [];
  return POST_VIEWING_ACTIONS[normalizedRole].map((item) => ({ ...item }));
}

export function isAllowedPostViewingAction(party, actionId, { livingStage = "" } = {}) {
  if (!isPostViewingStage(livingStage)) return false;
  return IDS[role(party)].has(String(actionId || "").trim());
}

export function postViewingDecisionLabel(party, actionId) {
  return POST_VIEWING_ACTIONS[role(party)].find((item) => item.id === actionId)?.label || "";
}

export function resolvePostViewingPair({ clientDecision = "", ownerDecision = "" } = {}) {
  const client = String(clientDecision || "").trim();
  const owner = String(ownerDecision || "").trim();
  const bothContinue = client === "serious_continue" && owner === "approve_continue";
  const rejected = client === "not_interested" || owner === "not_interested";
  const negotiationNeeded = client === "needs_negotiation" || owner === "needs_negotiation";
  const awaitingOtherParty = Boolean(client || owner) && !(client && owner);

  return Object.freeze({
    bothContinue,
    rejected,
    negotiationNeeded,
    awaitingOtherParty,
    brokerAction: bothContinue
      ? "الطرفان يرغبان في المتابعة — جاهز للانتقال إلى إجراءات الاتفاق."
      : negotiationNeeded
        ? "أحد الطرفين اختار استكمال التفاوض — تدخل الوسيط عند الحاجة."
        : rejected
          ? "أحد الطرفين لا يرغب بالمتابعة — أغلق هذه المطابقة فقط دون إنشاء مهمة جديدة."
          : awaitingOtherParty
            ? "بانتظار رد الطرف الآخر"
            : "بانتظار رد الطرفين"
  });
}
