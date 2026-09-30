import { FLOW_STAGE, PRICE_STATUS, normalizePriceStatus } from "../../../public/os/domain/flow-domain.js";
import { applyJourneyChange, journeySegments } from "./journey-service.js";
import { decideMatchReviewSimplified } from "./simplified-flow-service.js";

/**
 * Public intake is converted by the legacy pipeline. Older pipeline fields do not yet
 * copy priceStatus onto the opportunity, but they do preserve sourceIntakeId. Recover
 * the explicit owner choice here without touching the large ingestion pipeline.
 */
export async function decideMatchReviewWithPublicPrice(ctx, args) {
  const result = await decideMatchReviewSimplified(ctx, args);
  if (args.decision !== "approve" || !result?.journeyId || result.priceStatus !== PRICE_STATUS.LEGACY) return result;

  const journey = await ctx.store.get(journeySegments(args.officeId, result.journeyId));
  if (!journey?.offerId) return result;
  const offer = await ctx.store.get(["offices", args.officeId, "opportunities", journey.offerId]);
  if (!offer?.sourceIntakeId) return result;
  const intake = await ctx.store.get(["offices", args.officeId, "publicIntake", String(offer.sourceIntakeId)]);
  const recovered = normalizePriceStatus(intake || {});
  if (recovered === PRICE_STATUS.LEGACY) return result;

  const flowStage = recovered === PRICE_STATUS.FIXED ? FLOW_STAGE.PRICE_DECISION : FLOW_STAGE.PRICE_NEGOTIATION;
  await applyJourneyChange(ctx, {
    officeId: args.officeId,
    journeyId: result.journeyId,
    actor: args.actor,
    finish: (task) => recovered === PRICE_STATUS.FIXED && task.type === "SEND_PROPOSAL",
    add: recovered === PRICE_STATUS.FIXED
      ? [{ type: "PRICE_DECISION", ref: `public-intake:${offer.sourceIntakeId}`, reason: "السعر ثابت — بانتظار قرار العميل", actionLabel: "مراجعة السعر" }]
      : [],
    mutate: (j) => ({
      flowStage,
      activeTopics: recovered === PRICE_STATUS.FIXED ? [] : ["price"],
      offerSummary: { ...(j.offerSummary || {}), priceStatus: recovered, priceNegotiable: recovered === PRICE_STATUS.NEGOTIABLE }
    }),
    event: {
      type: "FLOW_STAGE",
      key: ["public-price-status", String(offer.sourceIntakeId), recovered],
      text: recovered === PRICE_STATUS.FIXED ? "استعيدت حالة السعر: ثابت" : "استعيدت حالة السعر: قابل للتفاوض",
      payload: { priceStatus: recovered, flowStage, audience: "broker" }
    }
  });

  return { ...result, priceStatus: recovered, flowStage };
}
