import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_INTEREST_ACTION,
  CLIENT_INTEREST_STATUS,
  OWNER_AVAILABILITY,
  OWNER_VIEWING_ALLOWED,
  PRICE_CONFIRMATION,
  VIEWING_DAY,
  VIEWING_PERIOD,
  buildDecisionPackageView,
  normalizeClientBundle,
  normalizeOwnerBundle
} from "../public/js/coordination-bundle-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";
import { sanitizePartyPublicView } from "../public/js/party-session-domain.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function partyHtml(party, propertyType, options = {}) {
  const canonicalOffer = { propertyType, ...(options.canonicalOffer || {}) };
  return buildPartyShellHtml({
    party,
    title: party === "owner" ? "أكد بيانات العقار" : "معلومات العقار",
    property: { propertyType, priceLabel: canonicalOffer.price ? `${canonicalOffer.price} ر.س` : "" },
    decisionPackage: buildDecisionPackageView(party, {
      propertyType,
      canonicalOffer,
      clientBundle: options.clientBundle || null
    })
  });
}

test("client and owner negotiation forms contain no manual text or number inputs", () => {
  const client = partyHtml("client", "شقة", { canonicalOffer: { price: 700000 } });
  const owner = partyHtml("owner", "شقة", {
    canonicalOffer: { price: 700000, area: 75 },
    clientBundle: normalizeClientBundle({
      propertyType: "شقة",
      interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
      interestAction: CLIENT_INTEREST_ACTION.DETAILS,
      requestedDetailKeys: ["area"]
    })
  });
  for (const html of [client, owner]) {
    assert.doesNotMatch(html, /<textarea\b/i);
    assert.doesNotMatch(html, /<input[^>]+type=["']text["']/i);
    assert.doesNotMatch(html, /<input[^>]+type=["']number["']/i);
  }
});

test("client decision UI exposes the five phase-one button choices", () => {
  const html = partyHtml("client", "شقة");
  for (const label of ["مهتم", "أرغب في المعاينة", "أحتاج معلومات", "السعر غير مناسب", "غير مناسب"]) {
    assert.match(html, new RegExp(label));
  }
});

test("client receives only one smart missing-detail question at a time", () => {
  const pkg = buildDecisionPackageView("client", {
    propertyType: "شقة",
    canonicalOffer: { propertyType: "شقة", price: 700000 }
  });
  assert.equal(pkg.smartDetailQuestion?.key, "area");
  const html = partyHtml("client", "شقة", { canonicalOffer: { price: 700000 } });
  assert.match(html, /سؤال يساعد على حسم المطابقة/);
  assert.match(html, /هل هذا التفصيل مهم لك: المساحة؟/);
  assert.equal((html.match(/data-smart-detail-key=/g) || []).length, 1);
});

test("answered smart questions do not repeat", () => {
  const pkg = buildDecisionPackageView("client", {
    propertyType: "شقة",
    canonicalOffer: { propertyType: "شقة", price: 700000 },
    clientBundle: { ignoredDetailKeys: ["area"] }
  });
  assert.equal(pkg.smartDetailQuestion?.key, "bedrooms");
});

test("a smart detail marked important is preserved for owner follow-up", () => {
  const bundle = normalizeClientBundle({
    propertyType: "شقة",
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    interestAction: CLIENT_INTEREST_ACTION.INTEREST_ONLY,
    requestedDetailKeys: ["elevator"]
  });
  assert.deepEqual(bundle.requestedDetailKeys, ["elevator"]);
});

test("the four initial property types render their existing canonical detail choices", () => {
  const expectations = [
    ["شقة", ["المساحة", "عدد الغرف", "عدد الحمامات", "الدور", "مصعد", "موقف", "مفروشة"]],
    ["فيلا", ["مساحة الأرض", "مساحة البناء", "عدد الغرف", "عدد الحمامات", "عدد الأدوار", "موقف", "حوش"]],
    ["أرض", ["المساحة", "الاستخدام", "الواجهة", "عدد الشوارع", "عرض الشارع", "الأطوال", "زاوية / غير زاوية"]],
    ["عمارة", ["مساحة الأرض", "عدد الأدوار", "عدد الوحدات", "عدد المحلات", "مصعد", "موقف", "الدخل السنوي"]]
  ];
  for (const [propertyType, labels] of expectations) {
    const html = partyHtml("client", propertyType);
    for (const label of labels) assert.ok(html.includes(label), `${propertyType}: ${label}`);
  }
});

test("price choices use canonical price with exact 2% and 5% calculations", () => {
  const offer = { propertyType: "شقة", price: 700000 };
  const before = JSON.stringify(offer);
  const pkg = buildDecisionPackageView("client", { propertyType: "شقة", canonicalOffer: offer });
  assert.equal(pkg.canonicalPrice, 700000);
  assert.equal(pkg.priceOptions.find((row) => row.value === "discount_2")?.calculatedPrice, 686000);
  assert.equal(pkg.priceOptions.find((row) => row.value === "discount_5")?.calculatedPrice, 665000);
  assert.equal(JSON.stringify(offer), before);
  for (const preference of ["discount_2", "discount_5", "discuss_at_viewing", "ask_owner"]) {
    assert.notEqual(normalizeClientBundle({
      interestStatus: "not_suitable",
      rejectionReason: "price",
      rejectionDisposition: "negotiable",
      negotiationPreference: preference
    }), null);
  }
});

test("missing or invalid canonical price never creates calculated price choices", () => {
  for (const price of [undefined, 0, -1, "not-a-price"]) {
    const pkg = buildDecisionPackageView("client", { propertyType: "شقة", canonicalOffer: { price } });
    assert.equal(pkg.hasCanonicalPrice, false);
    assert.equal(pkg.priceOptions.some((row) => Number.isFinite(row.calculatedPrice)), false);
    assert.ok(pkg.priceOptions.some((row) => row.value === "ask_owner"));
  }
});

test("interested-only decision remains structured without starting details or viewing", () => {
  const bundle = normalizeClientBundle({
    interestStatus: CLIENT_INTEREST_STATUS.INTERESTED,
    interestAction: CLIENT_INTEREST_ACTION.INTEREST_ONLY
  });
  assert.notEqual(bundle, null);
  assert.equal(bundle.wantsViewing, false);
  assert.deepEqual(bundle.requestedDetailKeys, []);
});

test("owner basic availability and confirmed price still submit without viewing", () => {
  const basic = normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    priceConfirmation: PRICE_CONFIRMATION.CONFIRMED,
    viewingAllowed: ""
  });
  assert.notEqual(basic, null);
  assert.equal(basic.viewingAllowed, "");
  assert.equal(normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    priceConfirmation: PRICE_CONFIRMATION.CONFIRMED,
    viewingAllowed: OWNER_VIEWING_ALLOWED.YES
  }), null);
});

test("viewing UI reuses the existing structured day and period options", () => {
  const pkg = buildDecisionPackageView("client", { propertyType: "شقة" });
  assert.deepEqual(pkg.dayOptions.map((row) => row.value), [VIEWING_DAY.TODAY, VIEWING_DAY.TOMORROW, VIEWING_DAY.WEEKEND]);
  assert.deepEqual(pkg.periodOptions.map((row) => row.value), [VIEWING_PERIOD.MORNING, VIEWING_PERIOD.AFTERNOON, VIEWING_PERIOD.EVENING]);
  const html = partyHtml("client", "شقة");
  assert.match(html, /صباحًا/);
  assert.match(html, /عصرًا/);
  assert.match(html, /مساءً/);
});

test("party views keep both parties' contact details private", () => {
  for (const party of ["client", "owner"]) {
    const view = sanitizePartyPublicView({
      party,
      snapshot: { propertyType: "شقة", phone: "0500000000", ownerPhone: "0511111111", clientPhone: "0522222222" },
      canonicalOffer: { propertyType: "شقة", contactPhone: "0533333333" },
      coordination: { matchId: "mat_same_session" }
    });
    const serialized = JSON.stringify(view);
    assert.doesNotMatch(serialized, /05(?:00000000|11111111|22222222|33333333)/);
  }
});

test("existing session and legacy parser architecture remains intact", () => {
  const entry = readFileSync(join(root, "public", "js", "party-entry.js"), "utf8");
  assert.match(entry, /\/party\/sessions\/\$\{encodeURIComponent\(token\)\}\/bundle/);
  assert.match(entry, /data-package-number/);
  assert.match(entry, /data-package-spec/);
  assert.match(entry, /data-package-detail/);
  assert.doesNotMatch(entry, /negotiationSession|negotiationSessions/);
});
