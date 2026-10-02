import { FLOW_STAGE } from "../../../public/os/domain/flow-domain.js";
import { buildWhatsAppUrl, formatDateTime, localPhone } from "../../../public/os/domain/format-domain.js";
import { loadJourney } from "./journey-service.js";
import { sessionLinks } from "./session-service.js";

function stageMessage(journey, role, url) {
  const offer = journey.offerSummary || {};
  const property = [offer.propertyType || "العقار", offer.district ? `في ${String(offer.district).startsWith("حي") ? offer.district : `حي ${offer.district}`}` : ""].filter(Boolean).join(" ");
  const stage = String(journey.flowStage || "");
  const viewingAt = journey.viewing?.at;

  if ([FLOW_STAGE.VIEWING_SCHEDULING, FLOW_STAGE.VIEWING].includes(stage) && viewingAt) {
    return [
      "مرحبًا،",
      `هذا رابط جلستك بخصوص ${property}.`,
      `موعد المعاينة المقترح: ${formatDateTime(viewingAt)}.`,
      "يمكنك من الرابط تأكيد الموعد أو اختيار موعد آخر.",
      url
    ].join("\n");
  }

  if (stage === FLOW_STAGE.PRICE_DECISION) {
    return [
      "مرحبًا،",
      `هذا رابط جلستك بخصوص ${property}.`,
      role === "client" ? "السعر ثابت؛ يمكنك الموافقة أو اختيار غير مناسب من الرابط." : "السعر ثابت؛ يمكنك متابعة قرار العميل من الرابط.",
      url
    ].join("\n");
  }

  return [
    "مرحبًا،",
    `هذا رابط جلستك بخصوص ${property}.`,
    "يمكنك متابعة التفاوض والرد على السعر مباشرة من الرابط.",
    url
  ].join("\n");
}

export async function sessionLinksSimplified(ctx, args) {
  const result = await sessionLinks(ctx, args);
  if (!result?.ok || !result.links) return result;
  const journey = await loadJourney(ctx, args.officeId, args.journeyId);
  const out = {};
  for (const role of ["owner", "client"]) {
    const link = result.links[role];
    if (!link) continue;
    const recordId = role === "owner" ? journey.offerId : journey.requestId;
    const record = await ctx.store.get(["offices", args.officeId, "opportunities", recordId]);
    const phone = localPhone(record?.contactPhone || record?.advertiserPhoneNormalized || record?.phone);
    const text = stageMessage(journey, role, link.url);
    out[role] = {
      ...link,
      text,
      whatsappUrl: buildWhatsAppUrl(phone, text),
      hasPhone: Boolean(phone)
    };
  }
  return { ...result, links: out };
}
