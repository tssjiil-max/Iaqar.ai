import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isContentResetEnabled } from "../public/js/content-v2-flag.js";
import { buildContentV2Html, currentContentView } from "../public/js/content-v2-domain.js";

const root = path.resolve(import.meta.dirname, "..");

test("content reset is on by default and can restore legacy content", () => {
  assert.equal(isContentResetEnabled({ search: "" }, { getItem: () => null }), true);
  assert.equal(isContentResetEnabled({ search: "?legacyContent=1" }, { getItem: () => null }), false);
  assert.equal(isContentResetEnabled({ search: "?contentV2=0" }, { getItem: () => null }), false);
  assert.equal(isContentResetEnabled({ search: "" }, { getItem: (key) => (key === "iaqar.legacyContent" ? "1" : null) }), false);
});

test("content views follow existing tabs and opportunity hash", () => {
  assert.deepEqual(currentContentView({ hash: "" }, { main: "operations" }), { name: "tasks" });
  assert.deepEqual(currentContentView({ hash: "" }, { main: "opportunities" }), { name: "opportunities" });
  assert.deepEqual(
    currentContentView({ hash: "#/opportunities/opp_1258" }, { main: "operations" }),
    { name: "opportunity", id: "opp_1258" }
  );
});

test("content V2 surface is empty and has no V2 header or nav chrome", () => {
  const html = buildContentV2Html({ name: "opportunity", id: "opp_1258" });
  assert.match(html, /content-v2-surface/);
  assert.match(html, /data-opportunity-id="opp_1258"/);
  assert.equal(html.includes("تفاصيل الفرصة"), false);
  assert.equal(html.includes("IAQAR V2"), false);
  assert.equal(html.includes("v2-header"), false);
  assert.equal(html.includes("v2-nav"), false);
  assert.equal(html.includes("ابدأ المطابقة"), false);
});

test("src/v2 is content-only and has no V2 header or navigation", () => {
  const srcV2 = path.join(root, "src", "v2");
  const names = readdirSync(srcV2, { recursive: true }).map(String);
  assert.equal(names.some((name) => /header|nav|shell\.ts|index\.html/.test(name)), false);
  assert.equal(existsSync(path.join(srcV2, "content", "mount.js")), true);
});

test("existing App Shell, voice slot, and matching engine stay in place", () => {
  const index = readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(index, /مكاتب عقارية ذكية/);
  assert.match(index, /id="shellVoice"/);
  assert.match(index, /id="addOpportunityVoicePanel"/);
  assert.match(index, /id="contentV2"/);
  assert.match(index, /data-legacy-content/);
  assert.match(index, /js\/v2\/mount\.js/);
  assert.equal((index.match(/id="addOpportunityVoicePanel"/g) || []).length, 1);

  const matching = readFileSync(path.join(root, "public", "js", "matching-domain.js"), "utf8");
  assert.match(matching, /export async function requestOpportunityRematch/);
  assert.match(matching, /MATCHING_RUN_PATH/);

  const voice = readFileSync(path.join(root, "public", "js", "gemini-voice-intake-ui.js"), "utf8");
  assert.match(voice, /export function mountVoiceIntakePanel/);
});

test("office unlock keeps the current hash so content can read the opportunity id", () => {
  const access = readFileSync(path.join(root, "public", "js", "access-gate.js"), "utf8");
  assert.match(access, /location\.hash \|\| ""/);
  assert.equal(access.includes('`${location.pathname}?office=${encodeURIComponent(normalized)}`'), false);
});

test("legacy bank does not strip opportunity hash while content reset is on", () => {
  const bank = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  assert.match(bank, /import \{ isContentResetEnabled \} from "\.\/content-v2-flag\.js"/);
  assert.match(bank, /if \(isContentResetEnabled\(\)\) return;/);
});

test("content-v2 shell applies isolation class without removing header markup", () => {
  const index = readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(index, /class="card header"/);
  assert.match(index, /class="card license"/);
  assert.match(index, /id="workspace"/);
  assert.match(index, /id="opportunityBank"/);
  assert.match(index, /id="mainTabs"/);
  const addForm = index.slice(index.indexOf('id="addOpportunityForm"'), index.indexOf('id="addOpportunityMissing"'));
  assert.equal(addForm.includes('id="addOpportunityVoicePanel"'), false);
  assert.equal(addForm.includes('id="addOpportunityFile"'), true);
});
