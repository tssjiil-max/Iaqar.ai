import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  OPPORTUNITY_FINAL_CLOSE_REASONS,
  OPPORTUNITY_FINAL_OUTCOMES,
  normalizeArabicDigits,
  normalizeSaudiPhoneForWhatsApp
} from "../worker/src/opportunity-lifecycle.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("valid 05XXXXXXXX becomes 9665XXXXXXXX", () => {
  assert.equal(normalizeSaudiPhoneForWhatsApp("0551234567"), "966551234567");
});

test("Arabic digits normalize safely", () => {
  assert.equal(normalizeSaudiPhoneForWhatsApp("٠٥٥١٢٣٤٥٦٧"), "966551234567");
  assert.equal(normalizeArabicDigits("٠٥٥"), "055");
});

test("invalid phone does not open WhatsApp digits", () => {
  assert.equal(normalizeSaudiPhoneForWhatsApp("12345"), "");
  const client = readRepo("public", "js", "opportunity-lifecycle.js");
  assert.ok(client.includes("valid: false"));
  assert.ok(client.includes("رقم الجوال غير مكتمل"));
});

test("workflow opens WhatsApp from direct click without overlay gate", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openWhatsAppHandoff"));
  assert.ok(workflow.includes("openContactWhatsAppDirect"));
  assert.equal(/advertiserMessageOverlay/.test(workflow.match(/function openContactWhatsAppDirect[\s\S]*?^  }/m)?.[0] || ""), false);
  const handoff = readRepo("public", "js", "whatsapp-handoff-domain.js");
  assert.ok(handoff.includes("whatsapp://send?"));
});

test("whatsapp_opened action does not mark contact confirmed in worker", () => {
  const worker = readRepo("worker", "src", "index.js");
  const block = worker.match(/action === "whatsapp_opened"[\s\S]*?return jsonResponse/m)?.[0] || "";
  assert.ok(block.includes("statusAfter: statusBefore"));
  assert.equal(/lifecycleStatus.*CONTACTED/.test(block), false);
});

test("call uses tel:05XXXXXXXX local format", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("tel:${phoneInfo.tel || phoneInfo.local}"));
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("tel:${local}"));
});

test("contact outcome labels include required persisted outcomes", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("contact_outcome"));
  assert.ok(workflow.includes("NO_RESPONSE"));
  assert.ok(workflow.includes("INTERESTED"));
  assert.ok(workflow.includes("REFUSED"));
  assert.ok(workflow.includes("FOLLOW_UP"));
  assert.ok(workflow.includes("AGREED"));
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const workspaceUi = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  const domain = readRepo("public", "js", "opportunity-contact-outcome-domain.js");
  const combined = `${bank}\n${workspaceUi}\n${domain}`;
  assert.equal(/data-contact-outcome="CONTACTED"/.test(combined), false);
  assert.ok(combined.includes("data-contact-outcome="));
  assert.ok(combined.includes("bank-contact-outcome-btn"));
  assert.ok(combined.includes("مهتم"));
});

test("follow-up save uses set_followup lifecycle action", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("حفظ موعد المتابعة"));
  assert.ok(workflow.includes("set_followup"));
  assert.ok(workflow.includes("data-days=\"2\">بعد غد"));
});

test("opportunity closure requires final reason server-side", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("close_opportunity"));
  assert.ok(worker.includes("closure_reason_invalid"));
  assert.ok(worker.includes("final_outcome_required"));
  assert.equal(OPPORTUNITY_FINAL_CLOSE_REASONS.includes("deal_done"), true);
  assert.equal(OPPORTUNITY_FINAL_OUTCOMES.includes("sold"), true);
});

test("closure archives and worker sets ARCHIVED without delete", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("close_opportunity"));
  assert.ok(worker.includes("LIFECYCLE_STATUS.ARCHIVED"));
  assert.ok(worker.includes("closedAt"));
  assert.ok(worker.includes("archivedAt"));
  const block = worker.match(/action === "close_opportunity"[\s\S]*?opportunity_closed/m)?.[0] || "";
  assert.equal(/deleteFirestore|deleteDocument/.test(block), false);
});

test("duplicate closure is idempotent in worker", () => {
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("idempotent: true"));
  assert.ok(worker.includes("resolved.data.closedAt"));
});

test("office mismatch guard in openOpportunityManagement", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openOpportunityManagement"));
  assert.ok(workflow.includes("لا يمكن فتح هذه الفرصة من هذا المكتب"));
  const worker = readRepo("worker", "src", "index.js");
  assert.ok(worker.includes("office_mismatch"));
});

test("every visible opportunity management action has handler", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  const actions = [
    "whatsapp-contact",
    "call-contact",
    "contact-outcome",
    "pick-followup-day",
    "save-followup-custom",
    "edit-followup",
    "cancel-followup",
    "complete-followup",
    "followup-outcome",
    "followup-whatsapp",
    "open-lifecycle-close",
    "confirm-final-close",
    "open-matching-bank"
  ];
  for (const action of actions) {
    assert.ok(workflow.includes(`action === "${action}"`), `missing handler for ${action}`);
  }
});

test("match cards use deal completion label after viewing", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes('actionLabel = appointmentAt ? "إتمام الصفقة"'));
  assert.ok(workflow.includes("2. نتيجة الصفقة"));
  assert.equal(workflow.includes('main: "deals"'), false);
});

test("openOpportunityManagement opens workflow modal by opportunityId", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("window.IAQAR.openOpportunityManagement = openOpportunityManagement"));
  assert.ok(/openOpportunityManagement\(oppId\)/.test(workflow));
});

test("no duplicated generic save lifecycle status in modal", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.equal(workflow.includes("save-lifecycle-status"), true);
  assert.ok(workflow.includes("استخدم نتيجة التواصل"));
  assert.equal(/حفظ الحالة/.test(workflow.match(/function renderOpportunityLifecycleUi[\s\S]*?^  }/m)?.[0] || ""), false);
  assert.equal(/confirm-contact/.test(workflow.match(/function renderOpportunityLifecycleUi[\s\S]*?^  }/m)?.[0] || ""), false);
});

test("modal responsive CSS keeps min touch targets without neon WhatsApp", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("min-height:52px"));
  assert.equal(workflow.includes("#25d366"), false);
  assert.ok(workflow.includes(".iaqar-workflow-btn.whatsapp{background:#087064"));
  assert.ok(workflow.includes("@media(max-width:420px)"));
});

test("contact outcome buttons show checkmark when selected in management modal", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("selectWorkflowContactOutcome"));
  assert.ok(workflow.includes("iaqar-contact-outcome-btn"));
  assert.ok(workflow.includes('aria-pressed="${selected ? "true" : "false"}"'));
  assert.ok(workflow.includes(".iaqar-outcome-actions .iaqar-workflow-btn.secondary.is-selected::after"));
  const html = readRepo("public", "index.html");
  assert.ok(html.includes(".iaqar-workflow-panel .iaqar-contact-outcome-btn.is-selected::after"));
});

test("matching cooperation section preserved without engine edits", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("open-matching-bank"));
  assert.ok(workflow.includes("openOpportunityDetail"));
  const matching = readRepo("worker", "src", "matching-engine.js");
  assert.equal(/scoreMatch/.test(matching), true);
});

test("bank WhatsApp uses unified native handoff", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("openWhatsApp({ phone: digits, text: message })"));
  assert.ok(bank.includes("action: \"whatsapp_opened\""));
});
