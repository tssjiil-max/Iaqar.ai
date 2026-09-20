import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./workflow-office.js", import.meta.url), "utf8");

test("match workflow exposes WhatsApp actions for client and owner before scheduling", () => {
  assert.match(source, /function matchCommunicationActions\(\)/);
  assert.match(source, /data-ui-action="whatsapp-client"/);
  assert.match(source, /data-ui-action="whatsapp-owner"/);
  assert.match(source, /<div class="iaqar-workflow-steps">\s*\$\{matchCommunicationActions\(\)\}/);
  assert.doesNotMatch(source, /hasAppointment\s*\?\s*`<div class="iaqar-whatsapp-grid"/);
});

test("match workflow renders communication actions before contact lookups finish", () => {
  const openWorkflowUi = source.match(/async function openWorkflowUi\(detail\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  const firstRender = openWorkflowUi.indexOf("renderWorkflowUi()");
  const contactWait = openWorkflowUi.indexOf("await Promise.all");
  assert.ok(firstRender >= 0, "workflow should render before loading contacts");
  assert.ok(contactWait >= 0, "workflow should still load both contacts");
  assert.ok(firstRender < contactWait, "communication actions must render before remote contact reads");
});
