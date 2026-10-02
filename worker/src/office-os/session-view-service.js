import { normalizePriceStatus, priceStatusLabel } from "../../../public/os/domain/flow-domain.js";
import { isReplyTokenShape } from "./proposal-service.js";
import { sessionHashOf, viewSession } from "./session-service.js";
import { journeySegments } from "./journey-service.js";

async function journeyForToken(ctx, token) {
  if (!isReplyTokenShape(token)) return null;
  const hash = await sessionHashOf(ctx.deps, token);
  const link = await ctx.store.get(["sessionLinks", hash]);
  if (!link?.officeId || !link?.journeyId) return null;
  const journey = await ctx.store.get(journeySegments(link.officeId, link.journeyId));
  return journey ? { link, journey } : null;
}

export async function viewSessionSimplified(ctx, { token, ip = "unknown" }) {
  const result = await viewSession(ctx, { token, ip });
  if (!result?.ok || !result.session) return result;
  const target = await journeyForToken(ctx, token).catch(() => null);
  if (!target?.journey) return result;
  const journey = target.journey;
  const status = normalizePriceStatus(journey.offerSummary || {});
  return {
    ...result,
    session: {
      ...result.session,
      flowStage: journey.flowStage || "",
      agreedItems: Array.isArray(journey.agreedItems) ? journey.agreedItems : [],
      priceStatus: status,
      priceStatusLabel: priceStatusLabel(journey.offerSummary || {}),
      activeTopics: Array.isArray(journey.activeTopics) ? journey.activeTopics : []
    }
  };
}
