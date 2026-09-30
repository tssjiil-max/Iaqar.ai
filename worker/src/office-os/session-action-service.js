import { submitSessionAction } from "./session-service.js";
import {
  acceptNegotiatedPrice, fixedPriceDecision, rejectSession,
  submitViewingAcceptanceSafe
} from "./simplified-flow-service.js";
import { submitViewingCounterToOtherParty } from "./viewing-counter-service.js";
import { viewSessionSimplified } from "./session-view-service.js";

export async function viewPublicSession(ctx, { token, ip = "unknown" }) {
  return viewSessionSimplified(ctx, { token, ip });
}

/**
 * Compatibility dispatcher for both the new UI and cached older pages. Critical
 * transitions always pass through the simplified-flow guard even when an old client
 * posts to /os/session/act.
 */
export async function submitPublicSessionAction(ctx, args = {}) {
  const action = String(args.action || "");
  if (action === "reject") return rejectSession(ctx, args);
  if (action === "viewing_ok") return submitViewingAcceptanceSafe(ctx, args);
  if (action === "viewing_other") return submitViewingCounterToOtherParty(ctx, args);
  if (action === "accept") {
    const view = await viewSessionSimplified(ctx, { token: args.token, ip: args.ip });
    if (view?.session?.phase === "FIXED_PRICE") {
      return fixedPriceDecision(ctx, { ...args, accepted: true });
    }
    return acceptNegotiatedPrice(ctx, args);
  }
  return submitSessionAction(ctx, args);
}
