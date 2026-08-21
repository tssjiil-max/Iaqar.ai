import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("match management orders viewing send then confirm", () => {
  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  const sendIdx = workflow.indexOf("إرسال الموعد للعميل");
  const confirmIdx = workflow.indexOf("✓ العميل أكد");
  const ownerSendIdx = workflow.indexOf("إرسال الموعد للمالك");
  const ownerConfirmIdx = workflow.indexOf("✓ المالك أكد");
  assert.ok(sendIdx > 0);
  assert.ok(ownerSendIdx > sendIdx);
  assert.ok(confirmIdx > ownerSendIdx);
  assert.ok(ownerConfirmIdx > confirmIdx);
  assert.match(workflow, /data-ui-action="send-viewing-client"/);
  assert.match(workflow, /data-ui-action="send-viewing-owner"/);
  assert.match(workflow, /data-ui-action="confirm-viewing"/);
});

test("changing appointment merges reset brokerUx locally", () => {
  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.match(workflow, /clientViewingConfirmed: false/);
  assert.match(workflow, /ownerViewingConfirmed: false/);
  assert.match(workflow, /viewingConfirmedAt: null/);
});

test("owner request and viewing send open WhatsApp without site navigation", () => {
  const workflow = readRepositoryFile("public", "js", "workflow-office.js");
  assert.match(workflow, /openPartyWhatsApp/);
  assert.match(workflow, /ownerRequestWhatsAppTextUi/);
  assert.match(workflow, /viewingAppointmentWhatsAppTextUi/);
  assert.doesNotMatch(workflow, /window\.location\.href = fallback/);
  const handoff = readRepositoryFile("public", "js", "whatsapp-handoff-domain.js");
  assert.match(handoff, /Never assign whatsapp:\/\//);
  assert.doesNotMatch(handoff, /window\.location\.href = buildWhatsAppAppUrl/);
});
