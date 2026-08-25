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

test("worker Firestore GET falls back to a masked PATCH when GetDocument quota is exhausted", () => {
  const worker = readFileSync(path.join(root, "worker", "src", "index.js"), "utf8");
  assert.match(worker, /async function echoFirestoreDocument/);
  assert.match(worker, /response.status === 429/);
  assert.match(worker, /iaqarReadEcho/);
  assert.match(worker, /currentDocument.exists/);
});

test("index.html skips Access Gate scripts when cv2Party is present", () => {
  const index = readFileSync(path.join(root, "public", "index.html"), "utf8");
  const headDetect = index.indexOf('URLSearchParams(location.search).get("cv2Party")');
  const skipLog = index.indexOf('ACCESS_GATE_SKIPPED');
  const writeGate = index.indexOf('document.write(\'<script src="js/access-gate.js">');
  const partyReturn = index.indexOf('if (document.documentElement.dataset.partyMode === "1")');
  assert.ok(headDetect > 0 && headDetect < skipLog, "cv2Party must be read before ACCESS_GATE_SKIPPED");
  assert.ok(partyReturn > 0 && partyReturn < writeGate, "party mode must return before writing access-gate.js");
  assert.match(index, /PARTY_PARAM_FOUND/);
  assert.match(index, /PARTY_BOOTSTRAP_STARTED/);
});

test("existing App Shell, voice slot, and matching engine stay in place", () => {
  const index = readFileSync(path.join(root, "public", "index.html"), "utf8");
  assert.match(index, /مكاتب عقارية ذكية/);
  assert.match(index, /id="shellVoice"/);
  assert.match(index, /id="addOpportunityVoicePanel"/);
  assert.match(index, /id="contentV2"/);
  assert.match(index, /data-legacy-content/);
  assert.match(index, /js\/v2\/mount\.js/);
  assert.match(index, /js\/party-entry\.js/);
  assert.ok(index.indexOf('params.get("cv2Party")') < index.indexOf("ACCESS_GATE_SKIPPED"));
  assert.match(index, /js\/access-gate\.js/);
  assert.match(index, /js\/party-entry\.js/);
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

test("daily tasks stay on content v2 while offers and requests keep the bank list", () => {
  const css = readFileSync(path.join(root, "src", "v2", "content", "styles.css"), "utf8");
  assert.match(css, /html\.is-content-v2 \[data-legacy-content\]/);
  assert.match(css, /data-content-view="opportunities"/);
  const mount = readFileSync(path.join(root, "src", "v2", "content", "mount.js"), "utf8");
  assert.match(mount, /view\.name === "opportunities"/);
  assert.match(mount, /view\.name === "tasks"/);
  assert.match(mount, /mountDailyTasksContentV2/);
  assert.match(mount, /buildContentV2Html\(view\)/);
  assert.match(mount, /setLegacyListVisible\(true\)/);
  assert.match(mount, /setLegacyListVisible\(false\)/);
});

test("legacy bank does not strip opportunity hash while content reset is on", () => {
  const bank = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  assert.match(bank, /import \{ isContentResetEnabled \} from "\.\/content-v2-flag\.js"/);
  assert.match(bank, /if \(isContentResetEnabled\(\)\) return;/);
});

test("daily task open mounts content v2 details instead of the legacy ops panel", () => {
  const bank = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  const fn = bank.match(/renderDailyTaskOpportunity[\s\S]*?openOpportunity\(id, \{ panelId, dailyTask: true \}\);/)?.[0] || "";
  assert.match(fn, /isContentResetEnabled\(\)/);
  assert.match(fn, /buildOpportunityDeepLinkHash\(id\)/);
  assert.match(fn, /contentV2\?\.render/);
});

test("offers and requests still reuse the approved data card", () => {
  const inbox = readFileSync(path.join(root, "public", "js", "bank-inbox-card-ui.js"), "utf8");
  assert.match(inbox, /buildOpportunityDataCardV2/);
  assert.match(inbox, /buildCompleteMissingButtonV2/);
  assert.match(inbox, /data-cv2-inbox-item/);
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
