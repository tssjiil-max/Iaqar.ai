/**
 * AI assist — a short, clearly-labelled suggestion for the broker, built only from
 * this office's own journey data. Any failure (no key, quota, timeout, bad output)
 * falls back to the deterministic suggestion; nothing here blocks an action.
 */

import { STAGE_LABEL, VIEWING_STATE_LABEL, suggestNextStep } from "../../../public/os/domain/journey-domain.js";
import { cleanText, formatPrice } from "../../../public/os/domain/format-domain.js";
import { loadJourney } from "./journey-service.js";
import { assertCanActOn } from "./permissions.js";

const SYSTEM = [
  "أنت مساعد لوسيط عقاري سعودي. اقترح الخطوة التالية العملية فقط.",
  "استخدم الحقائق المعطاة فقط ولا تفترض أرقامًا أو مواعيد أو أسماء غير موجودة.",
  "لا تقرر نيابة عن الوسيط ولا تعد بإتمام صفقة.",
  "أعد JSON فقط بالشكل: {\"suggestion\": \"جملة أو جملتان بالعربية\", \"summary\": \"ملخص الحالة في جملة\"}."
].join(" ");

function factsOf(journey) {
  const replies = journey.lastReplies || {};
  const lines = [
    `المرحلة: ${STAGE_LABEL[journey.stage] || journey.stage}`,
    `العرض: ${cleanText(journey.offerSummary?.propertyType, 40)} في ${cleanText(journey.offerSummary?.district, 60)} بسعر ${formatPrice(journey.offerSummary?.price) || "غير محدد"}`,
    `الطلب: ميزانية ${formatPrice(journey.requestSummary?.price) || "غير محددة"}`,
    `آخر مقترح: ${journey.lastProposal ? `${journey.lastProposal.label}${journey.lastProposal.fields?.price ? ` بسعر ${formatPrice(journey.lastProposal.fields.price)}` : ""}` : "لا يوجد"}`,
    `رد العميل: ${replies.client?.label || "لا يوجد"}`,
    `رد المالك: ${replies.owner?.label || "لا يوجد"}`,
    `المعاينة: ${VIEWING_STATE_LABEL[journey.viewing?.state || "NONE"]}${journey.viewing?.resultLabel ? ` — النتيجة: ${journey.viewing.resultLabel}` : ""}`,
    `المطلوب الآن في النظام: ${journey.currentAction?.label || "لا شيء"}`
  ];
  return lines.join("\n");
}

export async function suggestForJourney(ctx, { actor, officeId, journeyId }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  const rules = suggestNextStep(journey, { now: ctx.now() });
  if (typeof ctx.deps.callGemini !== "function") return { ok: true, source: "rules", suggestion: rules, summary: "" };
  const result = await Promise.race([
    ctx.deps.callGemini({
      systemInstruction: SYSTEM,
      userParts: [{ text: factsOf(journey) }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220, responseMimeType: "application/json" }
    }),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "TIMEOUT" }), 8000))
  ]).catch(() => ({ ok: false }));
  const suggestion = cleanText(result?.parsed?.suggestion, 280);
  if (!result?.ok || suggestion.length < 8) return { ok: true, source: "rules", suggestion: rules, summary: "" };
  return { ok: true, source: "ai", suggestion, summary: cleanText(result.parsed.summary, 200), fallback: rules };
}
