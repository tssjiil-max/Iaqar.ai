/**
 * Office OS permissions — enforced in the Worker (Firestore rules separately deny all
 * client writes to journeys/proposals/replyLinks). Hiding a button is never security.
 */

const MANAGER_ROLES = new Set(["owner", "admin", "manager", "platformAdmin"]);

export async function resolveActor(deps, request, env, officeId) {
  const identity = await deps.authorizeOfficeRequest(request, env, officeId, "member");
  const role = String(identity.role || "");
  return {
    uid: String(identity.uid || ""),
    role,
    isManager: MANAGER_ROLES.has(role)
  };
}

export function forbidden(deps, message = "ليس لديك صلاحية على هذه الفرصة") {
  return deps.appError("office_os_forbidden", 403, message);
}

/** Managers act on everything; brokers on their own and unassigned journeys/tasks. */
export function canActOn(actor, entity = {}) {
  if (actor.isManager) return true;
  const assigned = String(entity.assignedBrokerId || "");
  return !assigned || assigned === actor.uid;
}

export function assertCanActOn(deps, actor, entity) {
  if (!canActOn(actor, entity)) throw forbidden(deps);
}

/**
 * Explicit deal completion: managers always; the assigned broker only when the
 * office enabled `officeSettings/deals.brokerMayClose`.
 */
export function canCloseDeal(actor, journey = {}, dealSettings = {}) {
  if (actor.isManager) return true;
  return dealSettings.brokerMayClose === true && canActOn(actor, journey) && String(journey.assignedBrokerId || "") === actor.uid;
}
