import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_OFFICE_PATH_PREFIX,
  PUBLIC_OFFICE_SHARE_PATH_PREFIX,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  buildOfficeOgHtml,
  hasRealLicenseVerification,
  isCrawlerUserAgent,
  isReservedPublicSlug,
  officeLicensePreviewLines,
  officeOgDescription,
  officeShareCardImageMode,
  officeShareCardPath,
  officeShareCardVersion,
  officeShareMessage,
  parsePublicOfficePath,
  parsePublicOfficeSharePath,
  suggestAssignablePublicSlug,
  validateAssignablePublicSlug
} from "../public/js/office-public-link-domain.js";
import { officeLinkFor, legacyOfficeLinkFor } from "../public/js/office-domain.js";

test("assignable public slugs are short unique handles and reject reserved routes", () => {
  assert.deepEqual(validateAssignablePublicSlug("Wadi"), { ok: true, slug: "wadi" });
  assert.equal(validateAssignablePublicSlug("wa").ok, false);
  assert.equal(validateAssignablePublicSlug("a".repeat(21)).ok, false);
  assert.equal(validateAssignablePublicSlug("admin").ok, false);
  assert.equal(isReservedPublicSlug("party"), true);
  assert.equal(isReservedPublicSlug("r"), true);
  assert.equal(isReservedPublicSlug("settings"), true);
  assert.equal(isReservedPublicSlug("support"), true);
  assert.equal(isReservedPublicSlug("wadi"), false);
  assert.equal(suggestAssignablePublicSlug("wadi"), "wadi2");
});

test("legacy /o/{slug} stays resolvable after a short slug is assigned", () => {
  const gate = readFileSync(new URL("../public/js/access-gate.js", import.meta.url), "utf8");
  assert.match(gate, /legacyPublicSlugs/);
  assert.match(gate, /array-contains/);
  assert.match(gate, /resolveWorkerBase/);
  assert.match(gate, /history\.replaceState[\s\S]*\/m\//);
});

test("canonical office links use /m and immutable share pages use /s/{slug}/{version}", () => {
  assert.equal(
    officeLinkFor({ origin: "https://iaqar-ai-staging.example", publicSlug: "wadi" }),
    "https://iaqar-ai-staging.example/m/wadi"
  );
  assert.equal(
    legacyOfficeLinkFor({ origin: "https://iaqar-ai-staging.example", publicSlug: "wadi" }),
    "https://iaqar-ai-staging.example/o/wadi"
  );
  assert.deepEqual(parsePublicOfficePath("/m/wadi"), { kind: "m", slug: "wadi", legacy: false });
  assert.deepEqual(parsePublicOfficePath("/o/staging-logo-live-1pbwwl"), {
    kind: "o",
    slug: "staging-logo-live-1pbwwl",
    legacy: true
  });
  assert.deepEqual(parsePublicOfficeSharePath("/s/wadi/abc-123"), { slug: "wadi", version: "abc-123" });
  assert.equal(PUBLIC_OFFICE_PATH_PREFIX, "/m");
  assert.equal(PUBLIC_OFFICE_SHARE_PATH_PREFIX, "/s");
});

test("WhatsApp share copy remains a permanent office-link copy helper", () => {
  const message = officeShareMessage({
    officeName: "مكتب الوادي المبارك العقاري",
    origin: "https://iaqar.ai",
    publicSlug: "wadi"
  });
  assert.equal(message, "مكتب الوادي المبارك العقاري\n\nأرسل عرضك أو طلبك العقاري بسهولة عبر رابط المكتب:\nhttps://iaqar.ai/m/wadi");
  assert.equal((message.match(/https:\/\/iaqar\.ai\/m\/wadi/g) || []).length, 1);
});

test("OG HTML separates canonical office URL from immutable share og:url", () => {
  const html = buildOfficeOgHtml({
    office: { officeId: "staging-logo-live-20260807", officeName: "مكتب الوادي المبارك العقاري", city: "المدينة المنورة" },
    slug: "wadi",
    origin: "https://host.example",
    workerOrigin: "https://worker.example",
    canonicalUrl: "https://host.example/m/wadi",
    ogUrl: "https://worker.example/s/wadi/abc123",
    imageUrl: "https://worker.example/share/office/staging-logo-live-20260807/abc123.jpg",
    imageType: "image/jpeg",
    browserRedirectUrl: "https://host.example/?office=staging-logo-live-20260807&view=public"
  });
  assert.match(html, /property="og:title" content="مكتب الوادي المبارك العقاري"/);
  assert.match(html, /property="og:description" content="مكتب عقاري في المدينة المنورة"/);
  assert.match(html, /rel="canonical" href="https:\/\/host\.example\/m\/wadi"/);
  assert.match(html, /property="og:url" content="https:\/\/worker\.example\/s\/wadi\/abc123"/);
  assert.match(html, /property="og:image" content="https:\/\/worker\.example\/share\/office\/staging-logo-live-20260807\/abc123\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /location\.replace\("https:\/\/host\.example\/\?office=staging-logo-live-20260807&view=public"\)/);
  assert.equal(html.includes("cv2Party"), false);
  assert.equal(html.includes("token="), false);
  assert.equal(html.includes("http-equiv=\"refresh\""), false);
  assert.equal(officeOgDescription({ city: "المدينة المنورة" }), "مكتب عقاري في المدينة المنورة");
  assert.equal(
    officeOgDescription({ city: "المدينة المنورة", licenseVerified: true }),
    "مكتب عقاري مرخص في المدينة المنورة"
  );
  assert.equal(officeOgDescription({ city: "جدة", licenseNumber: "1200012345" }), "مكتب عقاري مرخص في جدة");
  assert.equal(officeOgDescription({ city: "جدة", licenseNumber: "1200012345", description: "وصف المكتب" }), "وصف المكتب");
});

test("license preview never claims verification without a real flag", () => {
  assert.deepEqual(officeLicensePreviewLines({ licenseNumber: "1234567890" }), ["رخصة فال: 1234567890"]);
  assert.equal(hasRealLicenseVerification({ licenseNumber: "1234567890" }), false);
  assert.deepEqual(
    officeLicensePreviewLines({ licenseNumber: "1234567890", licenseVerified: true }),
    ["✓ مكتب عقاري مرخص", "رخصة فال: 1234567890"]
  );
  assert.equal(officeShareCardImageMode({ logoUrl: "https://logo" }), "logo");
  assert.equal(officeShareCardImageMode({ displayImageUrl: "https://photo" }), "photo");
  assert.equal(officeShareCardImageMode({}), "fallback");
});

test("share-card version changes with identity and media path is immutable JPEG", () => {
  const a = officeShareCardVersion({ officeName: "أ", logoUrl: "https://a", city: "x" });
  const b = officeShareCardVersion({ officeName: "أ", logoUrl: "https://b", city: "x" });
  assert.notEqual(a, b);
  assert.equal(
    officeShareCardPath("office_1", a),
    `/share/office/office_1/${a}.jpg`
  );
  const firebase = readFileSync(new URL("../firebase.json", import.meta.url), "utf8");
  assert.match(firebase, /"source": "\/m\/:slug"/);
  assert.match(firebase, /"source": "\/s\/:slug\/:version"/);
  assert.match(firebase, /iaqar-macrodroid-intake\.iaqar-ai\.workers\.dev\/s\/:slug\/:version/);
  assert.match(firebase, /"source": "\/o\/\*\*"/);
  assert.equal(SHARE_CARD_WIDTH, 1200);
  assert.equal(SHARE_CARD_HEIGHT, 630);
  assert.equal(isCrawlerUserAgent("WhatsApp/2.0"), true);
  assert.equal(isCrawlerUserAgent("OpenGraph.io/1.0"), true);
  assert.equal(isCrawlerUserAgent("Mozilla/5.0 Chrome"), false);
});
