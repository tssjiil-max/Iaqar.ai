/**
 * Normalize common Saudi spoken-number phrases in transcripts before text parsing.
 */

const ONES = {
  واحد: 1, واحدة: 1, واحده: 1,
  اثنين: 2, اثنان: 2, ثنتين: 2,
  ثلاثة: 3, ثلاث: 3, ثلاثه: 3, ثلاثمئة: 300, "ثلاث مئة": 300, "ثلاثمئة": 300,
  اربعة: 4, أربعة: 4, اربع: 4, أربع: 4,
  خمسة: 5, خمس: 5, "خمس غرف": 5,
  ستة: 6, ست: 6,
  سبعة: 7, سبع: 7,
  ثمانية: 8, ثمان: 8, ثمانيه: 8,
  تسعة: 9, تسع: 9,
  عشرة: 10, عشر: 10
};

function normalizeArabicDigits(text = "") {
  return String(text || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

export function normalizeSpokenArabicNumbers(text = "") {
  let out = normalizeArabicDigits(String(text || ""));
  out = out.replace(/مليون\s+و\s*مئت(?:ين|ان)/giu, "1200000");
  out = out.replace(/مليون\s+و\s*مائت(?:ين|ان)/giu, "1200000");
  out = out.replace(/مليون(?:\s+ريال)?/giu, "1000000");
  out = out.replace(/مساحة\s+ثلاثمئة\s+متر/giu, "مساحة 300 متر");
  out = out.replace(/مساحة\s+ثلاث\s+مئة\s+متر/giu, "مساحة 300 متر");
  out = out.replace(/خمس\s+غرف/giu, "5 غرف");
  out = out.replace(/ست\s+غرف/giu, "6 غرف");
  out = out.replace(/سبع\s+غرف/giu, "7 غرف");
  for (const [phrase, value] of Object.entries(ONES)) {
    if (phrase.includes(" ")) continue;
    const re = new RegExp(`(?<![\\d])${phrase}(?=\\s+غرف)`, "giu");
    out = out.replace(re, String(value));
  }
  return out.replace(/\s+/g, " ").trim();
}

export const __test = { normalizeSpokenArabicNumbers };
