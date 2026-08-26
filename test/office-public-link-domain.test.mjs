import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PUBLIC_OFFICE_PATH_PREFIX,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  buildOfficeOgHtml,
  hasRealLicenseVerification,
  isCrawlerUserAgent,
  isReservedPublicSlug,
  officeLicensePreviewLines,
  officeOgDescription,
  officeShareCardPath,
  officeShareCardVersion,
  officeShareMessage,
  parsePublicOfficePath,
  validateAssignablePublicSlug
} from "../public/js/office-public-link-domain.js";
import { officeLinkFor, legacyOfficeLinkFor } from "../public/js/office-domain.js";

test("assignable public slugs are short unique handles and reject reserved routes", () => {
  assert.deepEqual(validateAssignablePublicSlug("Wadi"), { ok: true, slug: "wadi" });
  assert.equal(validateAssignablePublicSlug("wa").ok, false);
  assert.equal(validateAssignablePublicSlug("a".repeat(21)).ok, false);
  assert.equal(validateAssignablePublicSlug("admin").ok, false);
  assert.equal(isReservedPublicSlug("party"), true);
  assert.equal(isReservedPublicSlug("wadi"), false);
});

test("legacy /o/{slug} stays resolvable after a short slug is assigned", () => {
  const gate = readFileSync(new URL("../public/js/access-gate.js", import.meta.url), "utf8");
  assert.match(gate, /legacyPublicSlugs/);
  assert.match(gate, /array-contains/);
  assert.match(gate, /resolveWorkerBase/);
  assert.match(gate, /history\.replaceState[\s\S]*\/m\//);
});

test("canonical office links use /m/{slug} and keep /o/{slug} as legacy", () => {
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
  assert.equal(PUBLIC_OFFICE_PATH_PREFIX, "/m");
});

test("WhatsApp share copy is two lines plus the short URL", () => {
  const message = officeShareMessage({
    officeName: "مكتب الوادي المبارك العقاري",
    origin: "https://iaqar.ai",
    publicSlug: "wadi"
  });
  assert.equal(message, "مكتب الوادي المبارك العقاري\nرابط المكتب:\nhttps://iaqar.ai/m/wadi");
});

test("OG HTML is server-rendered and never includes private tokens", () => {
  const html = buildOfficeOgHtml({
    office: { officeId: "staging-logo-live-20260807", officeName: "مكتب الوادي المبارك العقاري", city: "المدينة المنورة" },
    slug: "wadi",
    origin: "https://host.example",
    workerOrigin: "https://worker.example",
    canonicalUrl: "https://host.example/m/wadi",
    imageUrl: "https://worker.example/share/office/staging-logo-live-20260807/card-vabc.png",
    browserRedirectUrl: "https://host.example/m/wadi"
  });
  assert.match(html, /property="og:title" content="مكتب الوادي المبارك العقاري"/);
  assert.match(html, /property="og:description" content="مكتب عقاري في المدينة المنورة"/);
  assert.match(html, /property="og:image" content="https:\/\/worker.example\/share\/office\/staging-logo-live-20260807\/card-vabc.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.equal(html.includes("cv2Party"), false);
  assert.equal(html.includes("token="), false);
  assert.equal(html.includes("http-equiv=\"refresh\""), false);
  assert.equal(officeOgDescription({ city: "المدينة المنورة" }), "مكتب عقاري في المدينة المنورة");
});

test("license preview never claims verification without a real flag", () => {
  assert.deepEqual(officeLicensePreviewLines({ licenseNumber: "1234567890" }), ["رخصة فال: 1234567890"]);
  assert.equal(hasRealLicenseVerification({ licenseNumber: "1234567890" }), false);
  assert.deepEqual(
    officeLicensePreviewLines({ licenseNumber: "1234567890", licenseVerified: true }),
    ["مكتب عقاري مرخص", "رخصة فال: 1234567890"]
  );
});

test("share-card version changes when office identity changes", () => {
  const a = officeShareCardVersion({ officeName: "أ", logoUrl: "https://a", city: "x" });
  const b = officeShareCardVersion({ officeName: "أ", logoUrl: "https://b", city: "x" });
  assert.notEqual(a, b);
  assert.match(officeShareCardPath("office-1", a), new RegExp(`/share/office/office-1/card-v${a}\\.png`));
  assert.equal(SHARE_CARD_WIDTH, 1200);
  assert.equal(SHARE_CARD_HEIGHT, 630);
  assert.equal(isCrawlerUserAgent("WhatsApp/2.0"), true);
  assert.equal(isCrawlerUserAgent("Mozilla/5.0 Chrome"), false);
});
