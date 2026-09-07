/**
 * Platform admin control-plane boundary.
 * Platform administration is intentionally distinct from office/broker administration.
 */

export const PLATFORM_ADMIN_CLAIM = "platformAdmin";

export function isPlatformAdminClaims(claims = {}) {
  return claims != null && claims[PLATFORM_ADMIN_CLAIM] === true;
}

export function assertPlatformAdminClaims(claims = {}) {
  if (!isPlatformAdminClaims(claims)) {
    return { ok: false, error: "admin_required" };
  }
  return {
    ok: true,
    uid: String(claims.sub || claims.user_id || ""),
    email: String(claims.email || ""),
    platformAdmin: true
  };
}

export function adminControlPlaneBoundaryGuarantees() {
  return Object.freeze({
    requiredClaim: PLATFORM_ADMIN_CLAIM,
    acceptsLegacyAdminClaim: false,
    browserClaimIsAuthoritative: false,
    serverSessionRequired: true,
    officeRoleCanGrantPlatformAdmin: false,
    namespacedAdminRoutes: true,
    ownsOfficeBusinessWorkflow: false
  });
}
