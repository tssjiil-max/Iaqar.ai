import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  PLATFORM_APP_NAME,
  PLATFORM_APP_SHORT_NAME,
  PLATFORM_BADGE_ICON,
  PLATFORM_DEFAULT_LOGO,
  PLATFORM_DEFAULT_LOGO_512,
  PLATFORM_MASKABLE_512,
  PLATFORM_APPLE_TOUCH,
  formatEventNotificationBody,
  formatListingPrice,
  formatMatchNotificationBody,
  formatOfficePushPresentation,
  isBrandIconPath,
  isPlatformDefaultLogo,
  officeBrandIconCandidates,
  resolveNotificationBadge,
  resolveNotificationIcon,
  resolveOfficeBrandIcon,
  sanitizeBrokerVisiblePushText,
  toAbsoluteHttpsIcon
} from "../public/js/platform-brand-domain.js";
import { fetchStrategyFor, isLongCacheAssetPath } from "../public/js/release-version-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const root = path.resolve(import.meta.dirname, "..");

function pngSize(file) {
  const buf = readFileSync(file);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test("approved platform icon files exist as squares and are not stretched", () => {
  const files = {
    [PLATFORM_DEFAULT_LOGO]: 192,
    [PLATFORM_DEFAULT_LOGO_512]: 512,
    [PLATFORM_MASKABLE_512]: 512,
    [PLATFORM_APPLE_TOUCH]: 180,
    [PLATFORM_BADGE_ICON]: 96
  };
  for (const [rel, size] of Object.entries(files)) {
    const file = path.join(root, "public", rel.replace(/^\//, ""));
    assert.equal(existsSync(file), true, rel);
    const dims = pngSize(file);
    assert.equal(dims.width, size, rel);
    assert.equal(dims.height, size, rel);
  }
  const source = path.join(root, "public/icons/iaqar-brand-source.png");
  assert.equal(existsSync(source), true);
  assert.deepEqual(pngSize(source), { width: 512, height: 512 });
});

test("office brand icon prefers logo, then profile photo, then platform fallback — never cover", () => {
  assert.equal(resolveOfficeBrandIcon({
    logoUrl: "https://cdn.example/logo.png",
    displayImageUrl: "https://cdn.example/photo.jpg",
    coverUrl: "https://cdn.example/cover.jpg"
  }), "https://cdn.example/logo.png");
  assert.equal(resolveOfficeBrandIcon({
    displayImageUrl: "https://cdn.example/photo.jpg",
    coverUrl: "https://cdn.example/cover.jpg"
  }), "https://cdn.example/photo.jpg");
  assert.equal(resolveOfficeBrandIcon({
    coverUrl: "https://cdn.example/cover.jpg"
  }), PLATFORM_DEFAULT_LOGO);
  assert.equal(resolveOfficeBrandIcon({}), PLATFORM_DEFAULT_LOGO);
});

test("office brand candidates try public media then stored URLs then platform", () => {
  const urls = officeBrandIconCandidates({
    logoUrl: "https://cdn.example/logo.png",
    displayImageUrl: "https://cdn.example/photo.jpg",
    coverUrl: "https://cdn.example/cover.jpg"
  }, {
    workerBase: "https://iaqar-intake-staging.iaqar-ai.workers.dev",
    officeId: "staging-logo-live-20260807"
  });
  assert.equal(urls[0], "https://iaqar-intake-staging.iaqar-ai.workers.dev/media/public/office-covers/staging-logo-live-20260807/logo");
  assert.ok(urls.includes("https://cdn.example/logo.png"));
  assert.ok(urls.includes("https://cdn.example/photo.jpg"));
  assert.equal(urls.includes("https://cdn.example/cover.jpg"), false);
  assert.equal(urls.at(-1), PLATFORM_DEFAULT_LOGO);
});

test("notification icons stay HTTPS and never use the colored logo as the badge", () => {
  const origin = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
  const officeIcon = resolveNotificationIcon({
    office: { logoUrl: "https://cdn.example/office-logo.png", officeId: "office-1" },
    appOrigin: origin
  });
  assert.equal(officeIcon, "https://cdn.example/office-logo.png");
  const badge = resolveNotificationBadge({ iconUrl: officeIcon, appOrigin: origin });
  assert.equal(badge, "");
  const requestedBadge = resolveNotificationBadge({ iconUrl: officeIcon, appOrigin: origin, includeBadge: true });
  assert.equal(requestedBadge, `${origin}${PLATFORM_BADGE_ICON}`);
  assert.notEqual(requestedBadge, officeIcon);

  const platformIcon = resolveNotificationIcon({ isPlatform: true, appOrigin: origin });
  assert.equal(platformIcon, `${origin}${PLATFORM_DEFAULT_LOGO}`);
  const platformBadge = resolveNotificationBadge({ iconUrl: platformIcon, appOrigin: origin });
  assert.equal(platformBadge, "");

  assert.equal(
    toAbsoluteHttpsIcon("http://insecure.example/logo.png", origin),
    `${origin}${PLATFORM_DEFAULT_LOGO}`
  );
  assert.equal(isPlatformDefaultLogo(PLATFORM_DEFAULT_LOGO), true);
});

test("office push title uses the office Arabic name; platform push uses the platform name", () => {
  const origin = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
  const officePush = formatOfficePushPresentation({
    office: { officeName: "مكتب الوادي المبارك العقاري", logoUrl: "https://cdn.example/logo.png" },
    officeId: "office-1",
    type: "match",
    title: "لديك مطابقة جديدة تحتاج مراجعتك.",
    body: "لديك مطابقة جديدة تحتاج مراجعتك.",
    listing: { propertyType: "شقة", purpose: "rent", district: "العزيزية", price: 50000 },
    appOrigin: origin
  });
  assert.equal(officePush.title, "مكتب الوادي المبارك العقاري");
  assert.equal(officePush.body, "مطابقة جديدة\nشقة للإيجار · العزيزية · 50,000 ر.س");
  assert.equal(officePush.icon, "https://cdn.example/logo.png");
  assert.equal(officePush.badge, "");

  const fallback = formatOfficePushPresentation({
    office: {},
    officeId: "office-2",
    type: "match",
    appOrigin: origin
  });
  assert.equal(fallback.title, PLATFORM_APP_NAME);
  assert.equal(fallback.body, "مطابقة جديدة");
  assert.equal(fallback.icon, `${origin}${PLATFORM_DEFAULT_LOGO}`);

  const platform = formatOfficePushPresentation({
    officeId: "platform",
    type: "broker_application",
    title: "طلب تسجيل وسيط جديد",
    body: "وسيط — رخصة فال 123",
    appOrigin: origin
  });
  assert.equal(platform.title, PLATFORM_APP_NAME);
  assert.equal(platform.body, "وسيط — رخصة فال 123");
  assert.equal(platform.icon, `${origin}${PLATFORM_DEFAULT_LOGO}`);
  assert.equal(formatListingPrice(50000), "50,000 ر.س");
  assert.equal(formatMatchNotificationBody({}), "مطابقة جديدة");
  assert.equal(
    sanitizeBrokerVisiblePushText("مطابقة https://iaqar-ai-staging--x.web.app iaqar-intake-staging.iaqar-ai.workers.dev"),
    "مطابقة"
  );
  assert.equal(
    formatEventNotificationBody({
      type: "CLIENT_INTERESTED",
      listing: { propertyType: "أرض", purpose: "sale", district: "السكب", referenceCode: "A-1842" }
    }),
    "العميل مهتم بالعقار\nأرض للبيع · السكب · #A-1842"
  );
  assert.equal(
    formatEventNotificationBody({
      type: "MISSING_DATA",
      listing: { propertyType: "أرض", district: "السكب" },
      missingLabel: "رقم التواصل ناقص"
    }),
    "بيانات تحتاج استكمال\nأرض · السكب — رقم التواصل ناقص"
  );
  const duplicate = formatOfficePushPresentation({
    office: { officeName: "مكتب الوادي المبارك العقاري" },
    type: "missing_data",
    title: "توجد بيانات ناقصة في إحدى فرصك.",
    body: "توجد بيانات ناقصة في إحدى فرصك.",
    listing: { propertyType: "أرض", district: "السكب" },
    missingLabel: "رقم التواصل ناقص",
    appOrigin: origin
  });
  assert.equal(duplicate.title, "مكتب الوادي المبارك العقاري");
  assert.equal(duplicate.body, "بيانات تحتاج استكمال\nأرض · السكب — رقم التواصل ناقص");
  assert.equal(
    formatEventNotificationBody({
      type: "OWNER_AVAILABLE",
      listing: { propertyType: "أرض", purpose: "sale", district: "السكب", referenceCode: "A-1842" }
    }),
    "المالك أكد توفر العقار\nأرض للبيع · السكب · #A-1842"
  );
  assert.equal(
    formatEventNotificationBody({
      type: "APPOINTMENT_CONFIRMED",
      listing: { referenceCode: "A-1842" },
      appointmentLabel: "الأربعاء · 6:00 م"
    }),
    "تم تأكيد المعاينة\nالأربعاء · 6:00 م · #A-1842"
  );
  assert.notEqual(duplicate.title, duplicate.body);
});

test("PWA identity is Arabic and points at the approved icon files", () => {
  const manifest = JSON.parse(readRepositoryFile("public", "manifest.webmanifest"));
  assert.equal(manifest.name, PLATFORM_APP_NAME);
  assert.equal(manifest.short_name, PLATFORM_APP_SHORT_NAME);
  assert.equal(String(manifest.name).includes("IAQAR"), false);
  const srcs = (manifest.icons || []).map((icon) => icon.src);
  assert.ok(srcs.includes(PLATFORM_DEFAULT_LOGO));
  assert.ok(srcs.includes(PLATFORM_DEFAULT_LOGO_512));
  assert.ok(srcs.includes(PLATFORM_MASKABLE_512));
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes(`src="${PLATFORM_DEFAULT_LOGO}"`));
  assert.ok(shell.includes(`href="${PLATFORM_APPLE_TOUCH}"`));
  assert.ok(shell.includes("<h1>مكاتب عقارية ذكية</h1>"));
  assert.ok(shell.includes("<p>منصة الفرص العقارية</p>"));
  assert.equal(shell.includes("النسخة التجريبية المعتمدة"), false);
  const gate = readRepositoryFile("public", "js", "access-gate.js");
  assert.ok(gate.includes(PLATFORM_DEFAULT_LOGO));
  assert.equal(gate.includes(".office-logo img"), false);
});

test("brand icons are network-first so the old gold pin cannot stick in the SW cache", () => {
  assert.equal(isBrandIconPath(PLATFORM_DEFAULT_LOGO), true);
  assert.equal(isLongCacheAssetPath(PLATFORM_DEFAULT_LOGO), false);
  assert.equal(fetchStrategyFor(PLATFORM_DEFAULT_LOGO), "network-first");
  assert.equal(fetchStrategyFor("/icons/icon-192.png"), "network-first");
  assert.equal(fetchStrategyFor("/fonts/tajawal/tajawal-400.woff2"), "cache-first");
  const sw = readRepositoryFile("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes(PLATFORM_DEFAULT_LOGO));
  assert.ok(sw.includes(PLATFORM_BADGE_ICON));
  assert.ok(sw.includes("isBrandIconPath"));
});

test("classic scripts and the Worker import the same platform logo constants", () => {
  const worker = readFileSync(path.join(root, "worker/src/index.js"), "utf8");
  assert.ok(worker.includes("platform-brand-domain.js"));
  assert.ok(worker.includes("formatOfficePushPresentation"));
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  assert.ok(settings.includes("platform-brand-domain.js"));
  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.ok(workflow.includes(PLATFORM_DEFAULT_LOGO));
  assert.ok(workflow.includes(PLATFORM_BADGE_ICON));
  execFileSync(process.execPath, ["--check", path.join(root, "public/js/platform-brand-domain.js")]);
});
