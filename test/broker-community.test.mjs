import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAgreementAccept,
  applyAgreementCreate,
  applyAgreementRevise,
  applyCommunityOutcome,
  buildCommunityPairKey,
  buildCommunityRequestId,
  canListingEnterBrokerCommunity,
  communityBadgeLabel,
  communityNotificationCopy,
  communityWhatsAppMessage,
  containsBlockedPeerPii,
  isBrokerCommunityEnabled,
  rankBrokerCommunityMatches,
  sanitizePeerListing,
  shouldShowCommunityBadge,
  validateCommissionSplit
} from "../public/js/broker-community-domain.js";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const CITY = "المدينة المنورة";

function readyOffer(overrides = {}) {
  return {
    id: "offer-a",
    officeId: "office-a",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: CITY,
    district: "عروة",
    salePrice: 400000,
    priceOrBudget: 400000,
    area: 600,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966500000001",
    contactPhone: "0500000001",
    contactName: "مالك سري",
    notes: "لا تظهر للمكتب الآخر",
    ...overrides
  };
}

function readyRequest(overrides = {}) {
  return {
    id: "req-b",
    officeId: "office-b",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "أرض",
    city: CITY,
    district: "عروة",
    budget: 420000,
    priceOrBudget: 420000,
    area: 580,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966500000002",
    contactPhone: "0500000002",
    contactName: "عميل سري",
    ...overrides
  };
}

function office(id, overrides = {}) {
  return {
    officeId: id,
    officeName: id === "office-a" ? "مكتب ألف" : "مكتب باء",
    brokerName: id === "office-a" ? "وسيط ألف" : "وسيط باء",
    phone: id === "office-a" ? "0551111111" : "0552222222",
    whatsapp: id === "office-a" ? "0551111111" : "0552222222",
    city: CITY,
    cooperationMode: "APPROVAL_REQUIRED",
    ...overrides
  };
}

function rankBothSides({ offer, request, officeA, officeB }) {
  const forOffer = rankBrokerCommunityMatches({
    sourceOpportunity: offer,
    ownOfficeId: "office-a",
    ownOffice: officeA,
    publicOffices: [officeA, officeB],
    candidateOpportunities: [offer, request],
    requireReadiness: true
  });
  const forRequest = rankBrokerCommunityMatches({
    sourceOpportunity: request,
    ownOfficeId: "office-b",
    ownOffice: officeB,
    publicOffices: [officeA, officeB],
    candidateOpportunities: [offer, request],
    requireReadiness: true
  });
  return { forOffer, forRequest };
}

test("اختبار 1: عرض وطلب مكتملان في عروة يظهران فرصة تعاون للطرفين", () => {
  const { forOffer, forRequest } = rankBothSides({
    offer: readyOffer(),
    request: readyRequest(),
    officeA: office("office-a"),
    officeB: office("office-b")
  });
  assert.equal(forOffer.length, 1);
  assert.equal(forRequest.length, 1);
  assert.equal(forOffer[0].listingTier, 1);
  assert.equal(shouldShowCommunityBadge(forOffer), true);
  assert.equal(shouldShowCommunityBadge(forRequest), true);
  assert.match(communityBadgeLabel("OFFER"), /طلب متوافق/);
  assert.match(communityBadgeLabel("REQUEST"), /عرض متوافق/);
});

test("اختبار 2: طلب في الوبرة يُكتشف كحي مجاور لعروة", () => {
  const { forOffer } = rankBothSides({
    offer: readyOffer(),
    request: readyRequest({ district: "الوبرة" }),
    officeA: office("office-a"),
    officeB: office("office-b")
  });
  assert.ok(forOffer.length >= 1, "adjacent compatible listing must match");
  assert.equal(forOffer[0].listingTier, 2);
  assert.match(forOffer[0].neighborhoodLabel, /مجاور/);
});

test("اختبار 3: تعطيل مجتمع الوسطاء يخفي المكتب من النتائج", () => {
  const { forOffer, forRequest } = rankBothSides({
    offer: readyOffer(),
    request: readyRequest(),
    officeA: office("office-a"),
    officeB: office("office-b", { cooperationMode: "DISABLED" })
  });
  assert.equal(forOffer.length, 0);
  assert.equal(forRequest.length, 0);
  assert.equal(isBrokerCommunityEnabled("DISABLED"), false);
  assert.equal(isBrokerCommunityEnabled("APPROVAL_REQUIRED"), true);
});

test("اختبار 4: العرض الناقص لا يدخل مجتمع الوسطاء", () => {
  const incomplete = readyOffer({
    propertyType: "",
    advertiserPhoneNormalized: "",
    contactPhone: ""
  });
  assert.equal(canListingEnterBrokerCommunity(incomplete, office("office-a")), false);
  const matches = rankBrokerCommunityMatches({
    sourceOpportunity: incomplete,
    ownOfficeId: "office-a",
    ownOffice: office("office-a"),
    publicOffices: [office("office-a"), office("office-b")],
    candidateOpportunities: [incomplete, readyRequest()],
    requireReadiness: true
  });
  assert.equal(matches.length, 0);
  assert.equal(shouldShowCommunityBadge(matches), false);
});

test("اختبار 5: الإسقاط الآمن يخفي اسم ورقم العميل والمالك", () => {
  const safe = sanitizePeerListing(readyOffer(), office("office-a"));
  assert.equal(safe.propertyType, "أرض");
  assert.equal(safe.district, "عروة");
  assert.equal(safe.officeName, "مكتب ألف");
  assert.equal("contactName" in safe && safe.contactName, false);
  assert.equal(safe.contactPhone, undefined);
  assert.equal(safe.phone, undefined);
  assert.equal(containsBlockedPeerPii(safe), false);
  assert.equal(containsBlockedPeerPii({ contactPhone: "0500000001" }), true);
  const { forOffer } = rankBothSides({
    offer: readyOffer(),
    request: readyRequest(),
    officeA: office("office-a"),
    officeB: office("office-b")
  });
  assert.equal(forOffer[0].contactName, undefined);
  assert.equal(forOffer[0].contactPhone, undefined);
  assert.doesNotMatch(JSON.stringify(forOffer[0]), /عميل سري|مالك سري|0500000002/);
});

test("اختبار 6: طلب التعاون يُنشأ بمفتاح عرض+طلب دون تكرار", async () => {
  const first = await buildCommunityRequestId({ offerId: "offer-a", requestId: "req-b" });
  const swapped = await buildCommunityRequestId({ offerId: "req-b", requestId: "offer-a" });
  const other = await buildCommunityRequestId({ offerId: "offer-a", requestId: "req-c" });
  assert.equal(first, swapped);
  assert.notEqual(first, other);
  assert.equal(
    buildCommunityPairKey({ offerId: "offer-a", requestId: "req-b" }),
    buildCommunityPairKey({ offerId: "req-b", requestId: "offer-a" })
  );
  assert.match(first, /^coop_cmty_/);
});

test("اختبار 7: اتفاق 50/50 يصبح فعالًا بعد موافقة الطرف الثاني", () => {
  const created = applyAgreementCreate({
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    createdByOfficeId: "office-a",
    officeAPercent: 50,
    officeBPercent: 50
  });
  assert.equal(created.ok, true);
  assert.equal(created.agreement.status, "PENDING_COUNTERPARTY");
  const accepted = applyAgreementAccept({
    agreement: created.agreement,
    actorOfficeId: "office-b"
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.agreement.status, "ACTIVE");
  assert.equal(accepted.agreement.officeAPercent, 50);
  assert.equal(accepted.agreement.officeBPercent, 50);
});

test("اختبار 8: تغيير الاتفاق إلى 60/40 يعيد اعتماد الطرف الآخر", () => {
  const created = applyAgreementCreate({
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    createdByOfficeId: "office-a",
    officeAPercent: 50,
    officeBPercent: 50
  });
  const active = applyAgreementAccept({
    agreement: created.agreement,
    actorOfficeId: "office-b"
  }).agreement;
  const invalid = validateCommissionSplit(60, 30);
  assert.equal(invalid.ok, false);
  const revised = applyAgreementRevise({
    agreement: active,
    actorOfficeId: "office-a",
    officeAPercent: 60,
    officeBPercent: 40
  });
  assert.equal(revised.ok, true);
  assert.equal(revised.agreement.status, "PENDING_COUNTERPARTY");
  assert.equal(revised.agreement.officeAPercent, 60);
  const creatorCannotFinish = applyAgreementAccept({
    agreement: revised.agreement,
    actorOfficeId: "office-a"
  });
  assert.equal(creatorCannotFinish.ok, false);
  const reaccepted = applyAgreementAccept({
    agreement: revised.agreement,
    actorOfficeId: "office-b"
  });
  assert.equal(reaccepted.ok, true);
  assert.equal(reaccepted.agreement.status, "ACTIVE");
});

test("اختبار 9: إتمام الصفقة يغلق فرصة التعاون", () => {
  const closed = applyCommunityOutcome({
    request: {
      status: "ACCEPTED",
      originatingOfficeId: "office-a",
      targetOfficeId: "office-b"
    },
    outcome: "DEAL_COMPLETED",
    actorOfficeId: "office-a"
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.request.status, "ENDED");
  assert.equal(closed.request.outcome, "DEAL_COMPLETED");
  assert.equal(closed.request.open, false);
});

test("اختبار 10: الإسقاط والقواعد تمنع وصول مكتب إلى بيانات عميل مكتب آخر", () => {
  const leaked = sanitizePeerListing({
    ...readyRequest(),
    email: "client@example.com",
    nationalId: "1234",
    whatsapp: "0500000002"
  }, office("office-b"));
  assert.equal(leaked.email, undefined);
  assert.equal(leaked.nationalId, undefined);
  assert.doesNotMatch(JSON.stringify(leaked), /client@example.com|0500000002/);
  const rules = readRepositoryFile("firestore.rules");
  assert.match(rules, /match \/opportunities\/\{opportunityId\}/);
  assert.match(rules, /allow read: if isOfficeMember\(officeId\)/);
  assert.match(rules, /match \/cooperationAgreements\/\{agreementId\}/);
  assert.match(rules, /allow create, update, delete: if false/);
  assert.match(rules, /match \/clients\/\{clientId\}/);
});

test("رسالة واتساب الوسيط لا تتضمن بيانات العميل", () => {
  const message = communityWhatsAppMessage({ sourceKind: "OFFER" });
  assert.match(message, /مجتمع الوسطاء/);
  assert.doesNotMatch(message, /مالك|عميل|05\d{8}/);
});

test("البطاقة لا تعرض شارة تعاون من دون تطابق", () => {
  const html = buildOpportunityListingCardInnerHtml(readyOffer());
  assert.equal(html.includes("فرصة تعاون"), false);
  assert.ok(html.includes("js-broker-community-slot"));
  assert.ok(html.includes("hidden"));
});

test("الإشعارات العربية لسلسلة التعاون", () => {
  assert.equal(communityNotificationCopy("community_request").body, "طلب تعاون جديد من وسيط عقاري.");
  assert.equal(communityNotificationCopy("community_agreement").body, "تم قبول اتفاقية التعاون.");
  assert.equal(communityNotificationCopy("community_deal").body, "تم تسجيل إتمام الصفقة بنجاح.");
  assert.match(communityNotificationCopy("community_match", { district: "عروة", sourceKind: "OFFER" }).body, /عروة/);
});

test("واجهة الإعدادات واللوحة عربية ومرتبطة بالمسار", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("id=\"brokerCommunityEnabledToggle\""));
  assert.ok(shell.includes("id=\"brokerCommunityOverlay\""));
  assert.ok(shell.includes("js/broker-community-ui.js"));
  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.ok(worker.includes("/cooperation/community-matches"));
  assert.ok(worker.includes("/cooperation/agreement"));
  assert.ok(worker.includes("/cooperation/outcome"));
  const ui = readRepositoryFile("public", "js", "broker-community-ui.js");
  assert.doesNotMatch(ui, />Request cooperation<|>Accept</);
});
