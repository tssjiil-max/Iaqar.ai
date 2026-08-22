import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  READY_PRIMARY_ACTION_IDS,
  buildPublicListingAnnouncement,
  listingShareActivityText,
  officeShareSentActivityText,
  officeShareStatusLabel,
  partyContactActions,
  readyWorkspacePrimaryActions,
  sendAndShareHubOptions,
  validateOfficeShareSend
} from "../public/js/opportunity-ready-actions-domain.js";
import { buildReadyWorkspaceHtml } from "../public/js/opportunity-bank-workspace-ui.js";
import { minimumSharedFields } from "../worker/src/cooperation-phase6-domain.js";
import { sharedOpportunityProjection } from "../public/js/opportunity-bank-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

const ownerReady = {
  id: "opp_owner_ready",
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "أرض",
  city: "المدينة المنورة",
  district: "الوبرة",
  priceOrBudget: 1200000,
  area: 900,
  rooms: 0,
  advertiserRole: "OWNER",
  advertiserPhoneNormalized: "+966512345678",
  contactPhone: "+966512345678",
  details: "أرض سكنية بموقع مميز"
};

const clientReady = {
  id: "opp_client_ready",
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "شقة",
  city: "الرياض",
  district: "الياسمين",
  priceOrBudget: 800000,
  advertiserPhoneNormalized: "+966598765432"
};

test("ready workspace shows exactly four primary actions", () => {
  const actions = readyWorkspacePrimaryActions(ownerReady);
  assert.equal(actions.length, 4);
  assert.deepEqual(actions.map((row) => row.id), [...READY_PRIMARY_ACTION_IDS]);
});

test("owner vs client party action label on primary button", () => {
  const ownerActions = readyWorkspacePrimaryActions(ownerReady);
  const clientActions = readyWorkspacePrimaryActions(clientReady);
  assert.equal(ownerActions.find((row) => row.id === "contact_party")?.label, "إجراء مع المالك");
  assert.equal(clientActions.find((row) => row.id === "contact_party")?.label, "إجراء مع العميل");
});

test("send and share hub has three options without broker send", () => {
  const hub = sendAndShareHubOptions();
  assert.equal(hub.length, 3);
  const labels = hub.map((row) => row.label).join(" ");
  assert.ok(!labels.includes("وسيط"));
  const bank = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  assert.ok(!bank.includes("مشاركة مع وسيط"));
  assert.ok(!bank.includes("إرسال لوسيط"));
});

test("public listing uses office phone not advertiser phone", () => {
  const text = buildPublicListingAnnouncement(ownerReady, {
    officeName: "مكتب الاختبار",
    officeId: "office_a",
    phone: "0512345678"
  });
  assert.match(text, /للتواصل: 0512345678/);
  assert.ok(!text.includes("+966512345678"));
  assert.ok(!text.includes("0598765432"));
});

test("public listing includes property facts and opportunity ref", () => {
  const text = buildPublicListingAnnouncement(ownerReady, { officeName: "مكتب", phone: "0511111111" });
  assert.match(text, /أرض/);
  assert.match(text, /المدينة المنورة/);
  assert.match(text, /الوبرة/);
  assert.match(text, /1200000/);
  assert.match(text, /900/);
  assert.match(text, /opp_owner_ready/);
});

test("office share validation blocks missing ids and same office", () => {
  assert.equal(validateOfficeShareSend({ opportunityId: "", originatingOfficeId: "a", targetOfficeId: "b" }).ok, false);
  assert.equal(validateOfficeShareSend({ opportunityId: "opp", originatingOfficeId: "", targetOfficeId: "b" }).ok, false);
  assert.equal(validateOfficeShareSend({ opportunityId: "opp", originatingOfficeId: "same", targetOfficeId: "same" }).ok, false);
  assert.equal(validateOfficeShareSend({ opportunityId: "opp", originatingOfficeId: "a", targetOfficeId: "b" }).ok, true);
});

test("office share Arabic status labels", () => {
  assert.equal(officeShareStatusLabel("PENDING"), "بانتظار رد المكتب");
  assert.equal(officeShareStatusLabel("ACCEPTED"), "قَبِل المكتب");
  assert.equal(officeShareStatusLabel("REJECTED"), "اعتذر المكتب");
});

test("listing share activity lines are Arabic one-liners", () => {
  assert.equal(listingShareActivityText("whatsapp"), "تمت مشاركة إعلان الفرصة عبر واتساب");
  assert.equal(listingShareActivityText("copy"), "تم نسخ إعلان الفرصة");
  assert.match(officeShareSentActivityText("مكتب النور"), /بانتظار الرد/);
});

test("party actions for owner include owner-specific items", () => {
  const ownerParty = partyContactActions(ownerReady);
  assert.ok(ownerParty.some((row) => row.label === "طلب صور أو مستندات"));
  const clientParty = partyContactActions(clientReady);
  assert.ok(clientParty.some((row) => row.label === "تم العثور على العقار"));
});

test("ready workspace HTML uses phase 1 details page without old action chrome", () => {
  const html = buildReadyWorkspaceHtml("opp_owner_ready", ownerReady, {}, {
    officeProfile: { officeName: "مكتب", phone: "0512345678" }
  });
  assert.ok(html.includes("opp-details-page"));
  assert.ok(html.includes("بيانات الفرصة"));
  assert.ok(!html.includes("إجراءات الفرصة"));
  assert.ok(!html.includes("data-workspace-action="));
  assert.ok(!html.includes("data-party-action="));
  assert.ok(!html.includes("data-send-share-option="));
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("wireWorkspaceHandlers"));
  assert.ok(bank.includes("executePartyContactAction"));
  assert.ok(bank.includes("search_matches"));
  assert.ok(bank.includes("manage_opportunity"));
});

test("shared projection strips contact fields", () => {
  const projection = sharedOpportunityProjection("opp_x", {
  ...ownerReady,
    contactPhone: "+966512345678",
    phone: "0512345678",
    contactName: "سرّي"
  });
  assert.equal(projection.contactPhone, "");
  assert.equal(projection.phone, "");
  assert.equal(projection.contactName, "");
  const min = minimumSharedFields(ownerReady);
  assert.equal(min.contactPhone, "");
  assert.equal(min.phone, "");
});

test("worker lifecycle includes listing and party log actions", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("listing_shared_whatsapp"));
  assert.ok(worker.includes("listing_copied"));
  assert.ok(worker.includes("party_action"));
});
