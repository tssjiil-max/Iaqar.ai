import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "path";
import { shouldAutoRematchAfterPatch } from "../worker/src/opportunity-patch-service.js";
import { buildBestNextAction } from "../public/js/opportunity-workspace-domain.js";
import { buildReadyWorkspaceHtml } from "../public/js/opportunity-bank-workspace-ui.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

const readyOwner = {
  id: "opp_cycle_owner",
  purpose: "SALE",
  propertyType: "أرض",
  city: "الرياض",
  district: "الوبرة",
  price: 1000000,
  area: 900,
  advertiserRole: "OWNER",
  advertiserPhoneNormalized: "+966512345678",
  matchingReadiness: "READY_FOR_MATCHING"
};

test("patch rematch runs only when the record is ready and matching fields change", () => {
  assert.equal(
    shouldAutoRematchAfterPatch(
      { matchingReadiness: "NEEDS_COMPLETION" },
      { advertiserPhoneNormalized: "+966512345678" },
      { matchingReadiness: "READY_FOR_MATCHING" }
    ),
    true
  );
  assert.equal(
    shouldAutoRematchAfterPatch(
      readyOwner,
      { advertiserPhoneNormalized: "+966512345678" },
      { matchingReadiness: "READY_FOR_MATCHING" }
    ),
    false
  );
  assert.equal(
    shouldAutoRematchAfterPatch(
      readyOwner,
      { district: "العوالي" },
      { matchingReadiness: "READY_FOR_MATCHING" }
    ),
    true
  );
  assert.equal(
    shouldAutoRematchAfterPatch(
      readyOwner,
      { lastContactAt: "2026-08-22T10:00:00.000Z" },
      { matchingReadiness: "READY_FOR_MATCHING" }
    ),
    false
  );
  assert.equal(
    shouldAutoRematchAfterPatch(
      readyOwner,
      { district: "العوالي" },
      { matchingReadiness: "NEEDS_COMPLETION" }
    ),
    false
  );
});

test("ready opportunity without matches asks to contact, not to search", () => {
  const action = buildBestNextAction({ record: readyOwner, matches: [], suggestions: [] });
  assert.equal(action.action, "contact_party");
  assert.equal(action.label, "تواصل");
});

test("missing contact phone is a completion next action", () => {
  const record = {
    purpose: "SALE",
    propertyType: "أرض",
    city: "الرياض",
    district: "الوبرة",
    price: 1000000,
    advertiserRole: "OWNER"
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.ok(readiness.matchingReadinessMissing.includes("contactPhone"));
  const action = buildBestNextAction({ record, matches: [] });
  assert.equal(action.action, "complete_fields");
  assert.match(action.label, /استكمال البيانات|أكمل/);
});

test("ready workspace HTML has no workspace chrome beyond details panel", () => {
  const html = buildReadyWorkspaceHtml("opp_cycle_owner", readyOwner, {}, {
    officeProfile: { officeName: "مكتب", phone: "0512345678" }
  });
  assert.ok(!html.includes("البحث عن مطابقة"));
  assert.ok(!html.includes("تشغيل المطابقة"));
  assert.ok(!html.includes("مطابقة الآن"));
  assert.ok(!html.includes("ابدأ المطابقة"));
  assert.ok(!html.includes("يتم البحث تلقائيًا عن المطابقات"));
  assert.ok(!html.includes("data-next-action="));
  assert.ok(html.includes("opp-details-panel"));
});

test("incomplete save stays on the opportunity page and worker rematches after patch", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(!bank.includes("iaqar:daily-task-completed"));
  assert.ok(bank.includes("✓ تم تحديث بيانات الفرصة"));
  assert.ok(worker.includes("shouldAutoRematchAfterPatch"));
  assert.ok(worker.includes("findAndSaveMatchesForOpportunity"));
});
