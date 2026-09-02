function normalizeArabic(value) {
  return String(value || "").toLowerCase()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[,،]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExplicitRequestCue(text) {
  const padded = ` ${text} `;
  return /(?:^|\s)طلب(?:\s|$)/.test(padded)
    || /(?:^|\s)(مطلوب|ابغى|احتاج|يبحث|نبحث|نرغب|ارغب|استئجار|للاستئجار|مستاجر)(?:\s|$)/.test(padded);
}

function hasExplicitOfferCue(text) {
  const padded = ` ${text} `;
  return /(?:^|\s)(عرض|معروض|متوفر|متاح|عندي|لدينا|يوجد|تاجير|للتاجير)(?:\s|$)/.test(padded);
}

function countDistinctKeywordMatches(text, words) {
  const seen = new Set();
  let score = 0;
  for (const word of words) {
    const normalized = normalizeArabic(word);
    if (!normalized || seen.has(normalized)) continue;
    if (text.includes(normalized)) {
      seen.add(normalized);
      score += 1;
    }
  }
  return score;
}

export function resolveParsedOpportunityKind(input) {
  const text = normalizeArabic(input);
  const explicitRequest = hasExplicitRequestCue(text);
  const explicitOffer = hasExplicitOfferCue(text);
  if (explicitRequest && !explicitOffer) return { kind: "client_request", offerScore: 0, requestScore: 1 };
  if (explicitOffer && !explicitRequest) return { kind: "owner_offer", offerScore: 1, requestScore: 0 };

  const offerWords = [
    "للبيع", "للإيجار", "للايجار", "معروض", "عرض", "متوفر", "متاح", "مالك", "مباشر",
    "عندي", "لدينا", "يوجد", "للتمليك", "للتنازل", "تأجير", "للتأجير"
  ];
  const requestWords = [
    "مطلوب", "ابغى", "احتاج", "يبحث", "نبحث", "طلب", "نرغب", "ارغب", "عميل",
    "مشتري", "مستأجر", "استئجار", "للاستئجار"
  ];
  const offerScore = countDistinctKeywordMatches(text, offerWords);
  const requestScore = countDistinctKeywordMatches(text, requestWords);
  return {
    kind: offerScore === 0 && requestScore === 0
      ? "unknown"
      : (offerScore > requestScore ? "owner_offer" : "client_request"),
    offerScore,
    requestScore
  };
}
