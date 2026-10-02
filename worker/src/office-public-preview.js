/**
 * Public office short-link preview, OG HTML, and share-card media.
 * Presentation only — no matching / party / opportunity logic.
 */

import {
  officeBrandIconCandidates,
  PLATFORM_DEFAULT_LOGO_512,
  toAbsoluteHttpsIcon
} from "../../public/js/platform-brand-domain.js";
import {
  buildOfficeOgHtml,
  isCrawlerUserAgent,
  officeLicensePreviewLines,
  officeOgDescription,
  officePublicLandingUrl,
  officeShareCardPath,
  officeShareCardVersion,
  parsePublicOfficePath,
  parsePublicOfficeSharePath,
  suggestAssignablePublicSlug,
  validateAssignablePublicSlug
} from "../../public/js/office-public-link-domain.js";
import { normalizePublicSlug } from "../../public/js/office-domain.js";

export const OFFICE_SHARE_CARD_KEY_RE = /^office-share\/[a-z0-9_-]{1,80}\/[a-z0-9_-]{1,48}\.jpg$/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

export function officeShareCardStorageKey(officeId, version) {
  const id = text(officeId).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
  const ver = text(version).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 48);
  return id && ver ? `office-share/${id}/${ver}.jpg` : "";
}

function legacyOfficeShareCardStorageKey(officeId) {
  const id = text(officeId).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
  return id ? `office-share/${id}/card.png` : "";
}

export async function pickReachableHttpsIcon(candidates = [], fallback = "") {
  for (const candidate of candidates) {
    const url = text(candidate);
    if (!/^https:\/\//i.test(url)) continue;
    try {
      const head = await fetch(url, { method: "HEAD" });
      const type = String(head.headers.get("content-type") || "");
      if (head.ok && (!type || /image\//i.test(type))) return url;
    } catch (_) { /* try GET range */ }
    try {
      const get = await fetch(url, { method: "GET", headers: { Range: "bytes=0-32" } });
      const type = String(get.headers.get("content-type") || "");
      if (get.ok && /image\//i.test(type)) return url;
    } catch (_) { /* next candidate */ }
  }
  return text(fallback);
}

export function shareCardGetMatch(pathname = "") {
  const path = String(pathname || "");
  const current = path.match(/^\/share\/office\/([^/]+)\/([^/]+)\.jpg$/i);
  if (current) return { officeId: decodeURIComponent(current[1]), version: decodeURIComponent(current[2]), legacy: false };
  const legacy = path.match(/^\/share\/office\/([^/]+)\/card-v([^/]+)\.png$/i);
  if (legacy) return { officeId: decodeURIComponent(legacy[1]), version: decodeURIComponent(legacy[2]), legacy: true };
  return null;
}

function htmlResponse(html, { headers = {} } = {}) {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...headers
    }
  });
}

async function readPublicOffice(deps, officeId) {
  const id = text(officeId);
  if (!id) return null;
  const doc = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["publicOffices", id],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (!doc) return null;
  return { officeId: id, ...deps.firestoreFieldsToJs(doc.fields || {}) };
}

async function resolveOfficeIdBySlug(deps, slug) {
  const handle = normalizePublicSlug(slug);
  if (!handle) return "";
  const claim = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["officeSlugClaims", handle],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (claim) {
    const data = deps.firestoreFieldsToJs(claim.fields || {});
    if (text(data.officeId)) return text(data.officeId);
  }
  const rows = await deps.runFirestoreQuery({
    projectId: deps.projectId,
    accessToken: deps.accessToken,
    structuredQuery: {
      from: [{ collectionId: "publicOffices" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "publicSlug" },
          op: "EQUAL",
          value: { stringValue: handle }
        }
      },
      limit: 1
    }
  });
  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first?.name) return "";
  const parts = String(first.name).split("/");
  return parts[parts.length - 1] || "";
}

export async function handlePublicOfficePreview(request, env, deps) {
  const url = new URL(request.url);
  const parsed = parsePublicOfficePath(url.pathname);
  if (!parsed.slug) {
    throw deps.appError("slug_required", 400, "رابط المكتب غير صالح");
  }
  const officeId = await resolveOfficeIdBySlug(deps, parsed.slug);
  if (!officeId) {
    throw deps.appError("office_link_not_found", 404, "رابط المكتب غير متاح");
  }
  const office = await readPublicOffice(deps, officeId);
  if (!office) {
    throw deps.appError("office_link_not_found", 404, "رابط المكتب غير متاح");
  }
  const appOrigin = deps.resolveAppOrigin(env);
  const workerOrigin = url.origin;
  const version = text(office.shareCardNonce) || officeShareCardVersion(office);
  const canonicalSlug = normalizePublicSlug(office.publicSlug) || parsed.slug;
  const canonicalUrl = `${appOrigin}/m/${encodeURIComponent(canonicalSlug)}`;
  const landingUrl = officePublicLandingUrl(appOrigin, officeId);
  const imageUrl = `${workerOrigin}${officeShareCardPath(officeId, version)}`;
  const crawler = isCrawlerUserAgent(request.headers.get("user-agent") || "");
  if (!crawler) {
    const headers = deps.corsHeaders();
    headers["location"] = landingUrl || canonicalUrl;
    headers["x-iaqar-office-preview"] = parsed.legacy ? "legacy" : "short";
    return new Response(null, { status: 302, headers });
  }
  const html = buildOfficeOgHtml({
    office,
    slug: canonicalSlug,
    origin: appOrigin,
    workerOrigin,
    canonicalUrl,
    imageUrl,
    browserRedirectUrl: landingUrl || canonicalUrl,
    includeBrowserRedirect: true
  });
  const headers = deps.corsHeaders();
  headers["x-iaqar-office-preview"] = parsed.legacy ? "legacy" : "short";
  headers["x-iaqar-crawler"] = "1";
  return htmlResponse(html, { headers });
}

export async function handlePublicOfficeSharePage(request, env, deps) {
  const url = new URL(request.url);
  const parsed = parsePublicOfficeSharePath(url.pathname);
  if (!parsed.slug || !parsed.version) {
    throw deps.appError("share_link_invalid", 400, "رابط المشاركة غير صالح");
  }
  const officeId = await resolveOfficeIdBySlug(deps, parsed.slug);
  if (!officeId) throw deps.appError("office_link_not_found", 404, "رابط المكتب غير متاح");
  const office = await readPublicOffice(deps, officeId);
  if (!office) throw deps.appError("office_link_not_found", 404, "رابط المكتب غير متاح");

  const appOrigin = deps.resolveAppOrigin(env);
  const workerOrigin = url.origin;
  const canonicalSlug = normalizePublicSlug(office.publicSlug) || parsed.slug;
  const canonicalUrl = `${appOrigin}/m/${encodeURIComponent(canonicalSlug)}`;
  const shareUrl = `${workerOrigin}/s/${encodeURIComponent(canonicalSlug)}/${encodeURIComponent(parsed.version)}`;
  const landingUrl = officePublicLandingUrl(appOrigin, officeId);
  const imageUrl = `${workerOrigin}${officeShareCardPath(officeId, parsed.version)}`;

  const html = buildOfficeOgHtml({
    office,
    slug: canonicalSlug,
    origin: appOrigin,
    workerOrigin,
    canonicalUrl,
    ogUrl: shareUrl,
    imageUrl,
    imageType: "image/jpeg",
    browserRedirectUrl: landingUrl || canonicalUrl,
    includeBrowserRedirect: true
  });
  const headers = deps.corsHeaders();
  headers["x-iaqar-office-preview"] = "immutable-share";
  headers["x-iaqar-share-version"] = parsed.version;
  return htmlResponse(html, { headers });
}

export async function handleOfficeShareCardGet(request, env, deps) {
  const url = new URL(request.url);
  const parsed = shareCardGetMatch(url.pathname);
  if (!parsed) throw deps.appError("media_not_found", 404, "بطاقة المشاركة غير موجودة");
  const bucket = deps.requireMediaBucket(env);
  const keys = parsed.legacy
    ? [legacyOfficeShareCardStorageKey(parsed.officeId)].filter(Boolean)
    : [officeShareCardStorageKey(parsed.officeId, parsed.version)].filter(Boolean);
  for (const key of keys) {
    const object = await bucket.get(key);
    if (!object) continue;
    const headers = new Headers(deps.corsHeaders());
    object.writeHttpMetadata(headers);
    headers.set("cache-control", parsed.legacy ? "public, max-age=3600" : "public, max-age=31536000, immutable");
    headers.set("x-content-type-options", "nosniff");
    if (!/^image\/(png|jpeg)$/.test(headers.get("content-type") || "")) headers.set("content-type", "image/png");
    headers.set("x-iaqar-share-card", "stored");
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }
  const fallback = `${deps.resolveAppOrigin(env)}/icons/iaqar-office-share-fallback-1200x630.png`;
  const fetchImpl = deps.fetch || fetch;
  const response = await fetchImpl(fallback, { method: request.method === "HEAD" ? "HEAD" : "GET" });
  if (!response.ok) throw deps.appError("media_not_found", 404, "بطاقة المشاركة غير موجودة");
  const headers = new Headers(deps.corsHeaders());
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-type", "image/png");
  headers.set("x-iaqar-share-card", "fallback");
  return new Response(request.method === "HEAD" ? null : response.body, { headers });
}

export async function handleOfficeShareCardUpload(request, env, deps) {
  const officeId = deps.firestoreOfficeId(request.headers.get("x-office-id"));
  if (!officeId) throw deps.appError("office_id_required", 400, "officeId مطلوب");
  await deps.authorizeOfficeRequest(request, env, officeId, "manage");
  const contentType = text(request.headers.get("content-type")).toLowerCase();
  if (contentType !== "image/png" && contentType !== "image/jpeg") throw deps.appError("unsupported_media", 415, "بطاقة المشاركة يجب أن تكون PNG أو JPEG");
  const size = Number(request.headers.get("content-length") || 0);
  if (size > 2 * 1024 * 1024) throw deps.appError("image_too_large", 413, "حجم بطاقة المشاركة كبير");
  const bytes = await request.arrayBuffer();
  const slug = normalizePublicSlug(request.headers.get("x-public-slug"));
  const version = text(request.headers.get("x-share-card-version")).replace(/[^a-z0-9_-]/gi, "").slice(0, 48);
  if (!version) throw deps.appError("share_version_required", 400, "نسخة بطاقة المشاركة مطلوبة");
  const key = officeShareCardStorageKey(officeId, version);
  if (!key || !OFFICE_SHARE_CARD_KEY_RE.test(key)) throw deps.appError("share_version_invalid", 400, "نسخة بطاقة المشاركة غير صالحة");

  const bucket = deps.requireMediaBucket(env);
  const existing = await bucket.get(key);
  if (!existing) {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { officeId, publicSlug: slug, previewVersion: version, uploadedAt: new Date().toISOString() }
    });
  }

  const origin = new URL(request.url).origin;
  return deps.jsonResponse({
    ok: true,
    immutable: true,
    existed: Boolean(existing),
    officeId,
    publicSlug: slug,
    previewVersion: version,
    imageUrl: `${origin}${officeShareCardPath(officeId, version)}`,
    requestId: deps.requestId
  }, existing ? 200 : 201);
}

export async function handleSavePublicSlug(request, env, deps) {
  const body = await request.json().catch(() => ({}));
  const officeId = deps.firestoreOfficeId(body.officeId);
  if (!officeId) throw deps.appError("office_id_required", 400, "officeId مطلوب");
  await deps.authorizeOfficeRequest(request, env, officeId, "manage");
  const checked = validateAssignablePublicSlug(body.publicSlug);
  if (!checked.ok) throw deps.appError(checked.error, 400, checked.message);
  const slug = checked.slug;
  const existingClaim = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["officeSlugClaims", slug],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (existingClaim) {
    const claimed = deps.firestoreFieldsToJs(existingClaim.fields || {});
    if (text(claimed.officeId) && text(claimed.officeId) !== officeId) {
      throw deps.appError("slug_taken", 409, `معرّف الرابط مستخدم لمكتب آخر. جرّب: ${suggestAssignablePublicSlug(slug) || `${slug}2`}`);
    }
  }
  const occupied = await deps.runFirestoreQuery({
    projectId: deps.projectId,
    accessToken: deps.accessToken,
    structuredQuery: {
      from: [{ collectionId: "publicOffices" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "publicSlug" },
          op: "EQUAL",
          value: { stringValue: slug }
        }
      },
      limit: 2
    }
  });
  const takenByOther = (Array.isArray(occupied) ? occupied : []).some((doc) => {
    const id = String(doc?.name || "").split("/").pop();
    const data = deps.firestoreFieldsToJs(doc.fields || {});
    const owner = text(data.officeId) || id;
    return owner && owner !== officeId;
  });
  if (takenByOther) throw deps.appError("slug_taken", 409, `معرّف الرابط مستخدم لمكتب آخر. جرّب: ${suggestAssignablePublicSlug(slug) || `${slug}2`}`);
  const officeDoc = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  const current = officeDoc ? deps.firestoreFieldsToJs(officeDoc.fields || {}) : {};
  const previous = normalizePublicSlug(current.publicSlug);
  const now = new Date();
  const h = deps.firestoreHelpers;
  const legacy = new Set(
    (Array.isArray(current.legacyPublicSlugs) ? current.legacyPublicSlugs : [])
      .map((value) => normalizePublicSlug(value))
      .filter(Boolean)
  );
  if (previous && previous !== slug) {
    legacy.add(previous);
    await deps.setFirestoreDocument({
      projectId: deps.projectId,
      segments: ["officeSlugClaims", previous],
      accessToken: deps.accessToken,
      fields: {
        officeId: h.firestoreString(officeId),
        publicSlug: h.firestoreString(previous),
        supersededBy: h.firestoreString(slug),
        updatedAt: h.firestoreTimestamp(now)
      }
    }).catch(() => {});
  }
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["officeSlugClaims", slug],
    accessToken: deps.accessToken,
    fields: {
      officeId: h.firestoreString(officeId),
      publicSlug: h.firestoreString(slug),
      updatedAt: h.firestoreTimestamp(now)
    }
  });
  const profileFields = {
    officeId: h.firestoreString(officeId),
    publicSlug: h.firestoreString(slug),
    updatedAt: h.firestoreTimestamp(now)
  };
  const publicFields = {
    ...profileFields,
    legacyPublicSlugs: {
      arrayValue: {
        values: [...legacy].map((value) => ({ stringValue: value }))
      }
    }
  };
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId],
    accessToken: deps.accessToken,
    fields: profileFields
  });
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["publicOffices", officeId],
    accessToken: deps.accessToken,
    fields: publicFields
  });
  return deps.jsonResponse({
    ok: true,
    officeId,
    publicSlug: slug,
    path: `/m/${slug}`,
    requestId: deps.requestId
  });
}

export {
  officeBrandIconCandidates,
  officeLicensePreviewLines,
  officeOgDescription,
  officePublicLandingUrl,
  officeShareCardPath,
  officeShareCardVersion,
  PLATFORM_DEFAULT_LOGO_512,
  toAbsoluteHttpsIcon
};
