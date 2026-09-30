import { toDate } from "../../../public/os/domain/format-domain.js";
import { journeySegments } from "./journey-service.js";
import { recordViewingResultSafe } from "./simplified-flow-service.js";

/**
 * Server-side guard: deep links and cached clients cannot record a viewing result
 * before the confirmed appointment has actually started.
 */
export async function recordViewingResultAfterStart(ctx, args) {
  const journey = await ctx.store.get(journeySegments(args.officeId, args.journeyId));
  if (!journey) throw ctx.deps.appError("journey_not_found", 404, "الفرصة غير موجودة");
  const viewingAt = toDate(journey.viewing?.at);
  if (viewingAt && viewingAt.getTime() > ctx.now().getTime()) {
    throw ctx.deps.appError("viewing_not_started", 409, "لا يمكن تسجيل نتيجة المعاينة قبل موعدها");
  }
  return recordViewingResultSafe(ctx, args);
}
