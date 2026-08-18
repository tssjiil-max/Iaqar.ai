/**
 * Canonical listing intake — fetch URL, resolve redirects, run site adapter, return unified payload.
 */

import {
  LISTING_EXTRACTION_STATUS,
  LISTING_FETCH_LIMITS,
  extractListingTextFromHtml,
  isBlockedListingPageText,
  listingFetchHeaders,
  matchListingAdapter,
  normalizeListingFetchUrl,
  parseListingHtmlWithAdapter,
  resolveListingSourceSiteId,
  resolveListingSourceSiteLabel
} from "./listing-site-adapters.mjs";

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fetchListingPage(url, redirectCount = 0, fetchImpl = fetch, isPrivateOrLocalHost = () => false) {
  if (redirectCount > LISTING_FETCH_LIMITS.MAX_REDIRECTS) {
    return { ok: false, error: "too_many_redirects" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LISTING_FETCH_LIMITS.TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: listingFetchHeaders()
    });
    clearTimeout(timer);
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location") || "";
      const nextUrl = normalizeListingFetchUrl(new URL(location, url).toString(), isPrivateOrLocalHost);
      if (!nextUrl) return { ok: false, error: "redirect_blocked", diagnostics: { status, redirect: location } };
      return await fetchListingPage(nextUrl, redirectCount + 1, fetchImpl, isPrivateOrLocalHost);
    }
    if (!response.ok) {
      return { ok: false, error: status === 403 ? "source_blocked" : "fetch_failed", diagnostics: { status } };
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LISTING_FETCH_LIMITS.MAX_BYTES) {
      return { ok: false, error: "response_too_large", diagnostics: { status, contentType, byteLength: buffer.byteLength } };
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    const text = extractListingTextFromHtml(html);
    if (isBlockedListingPageText(text)) {
      return {
        ok: false,
        error: "source_blocked",
        diagnostics: { status, contentType, byteLength: buffer.byteLength, textLength: text.length, blocked: true },
        html
      };
    }
    if (!text) {
      return {
        ok: false,
        error: "empty_listing_text",
        diagnostics: { status, contentType, byteLength: buffer.byteLength, textLength: 0 },
        html
      };
    }
    return {
      ok: true,
      html,
      text,
      resolvedUrl: url,
      diagnostics: { status, contentType, byteLength: buffer.byteLength, textLength: text.length, redirectCount }
    };
  } catch (error) {
    clearTimeout(timer);
    const message = String(error?.cause?.message || error?.message || error);
    const errorCode = error?.name === "AbortError"
      ? "fetch_timeout"
      : /ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(message)
        ? "dns_failed"
        : "fetch_failed";
    return { ok: false, error: errorCode, diagnostics: { message } };
  }
}

export async function resolveCanonicalListingUrl({
  originalUrl,
  isPrivateOrLocalHost = () => false,
  fetchImpl = fetch
} = {}) {
  const normalizedOriginal = normalizeListingFetchUrl(originalUrl, isPrivateOrLocalHost);
  if (!normalizedOriginal) {
    return { ok: false, error: "invalid_url" };
  }
  const fetched = await fetchListingPage(normalizedOriginal, 0, fetchImpl, isPrivateOrLocalHost);
  if (!fetched.ok) {
    return {
      ok: false,
      error: fetched.error || "url_resolve_failed",
      originalUrl: normalizedOriginal,
      resolvedUrl: fetched.resolvedUrl || normalizedOriginal,
      diagnostics: fetched.diagnostics || null
    };
  }
  const resolvedUrl = fetched.resolvedUrl || normalizedOriginal;
  const adapter = matchListingAdapter(resolvedUrl);
  const parsed = parseListingHtmlWithAdapter(fetched.html || "", resolvedUrl, adapter);
  const contentHash = await sha256Hex(`${adapter.id}|${parsed.externalListingId || ""}|${resolvedUrl}|${fetched.text}`);
  const extractionStatus = parsed.extractionStatus || LISTING_EXTRACTION_STATUS.FALLBACK_REQUIRED;
  return {
    ok: true,
    originalUrl: normalizedOriginal,
    resolvedUrl,
    url: resolvedUrl,
    text: parsed.rawText || fetched.text,
    textLength: (parsed.rawText || fetched.text).length,
    sourceSite: resolveListingSourceSiteLabel(resolvedUrl),
    sourceSiteId: resolveListingSourceSiteId(resolvedUrl),
    adapterId: adapter.id,
    externalListingId: parsed.externalListingId || adapter.extractId(resolvedUrl) || "",
    structured: parsed.structured || null,
    brokerFields: parsed.brokerFields || null,
    fieldSources: parsed.fieldSources || {},
    extractionStatus,
    classificationStatus: parsed.classificationStatus || extractionStatus,
    listingTitle: parsed.listingTitle || "",
    contentHash,
    diagnostics: fetched.diagnostics
  };
}

export const __test = {
  fetchListingPage,
  resolveCanonicalListingUrl
};
