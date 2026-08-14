// Voice add-opportunity bar — scoped styling and approved state labels.
import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";

const html = readRepositoryFile("public", "index.html");
const addOpp = readRepositoryFile("public", "js", "add-opportunity.js");
const voiceUi = readRepositoryFile("public", "js", "gemini-voice-intake-ui.js");
const sw = readRepositoryFile("public", "firebase-messaging-sw.js");

function voiceBarCss() {
  const start = html.indexOf("/* إضافة فرصة — شريط الصوت الأخضر");
  return html.slice(start, start + 2800);
}

test("add opportunity passes approved voice bar labels", () => {
  assert.ok(addOpp.includes("إضافة فرصة بالصوت"));
  assert.ok(addOpp.includes("جاري الاستماع…"));
  assert.ok(addOpp.includes("جارٍ استخراج البيانات…"));
  assert.ok(addOpp.includes("تم استخراج البيانات — راجعها قبل الحفظ"));
  assert.ok(addOpp.includes("تعذر فهم التسجيل — حاول مرة أخرى"));
});

test("voice bar CSS is scoped to addOpportunityVoicePanel with green dark bar", () => {
  const css = voiceBarCss();
  assert.ok(css.includes("#addOpportunityVoicePanel"));
  assert.ok(css.includes("background:var(--green-dark)"));
  assert.ok(css.includes("min-height:54px"));
  assert.ok(css.includes("border-radius:16px"));
  assert.ok(css.includes("font-family:\"Tajawal\""));
  assert.ok(css.includes("font-weight:700"));
  assert.ok(css.includes("font-size:17px"));
  assert.equal(css.includes("border:1px dashed"), false);
});

test("voice panel removes oversized dashed container padding in add opportunity", () => {
  const css = voiceBarCss();
  assert.ok(css.includes("padding:0"));
  assert.ok(css.includes("border:0"));
  assert.ok(css.includes("background:transparent"));
});

test("voice UI uses single mount implementation without duplicate controller", () => {
  assert.equal(voiceUi.includes("export function mountVoiceIntakePanel"), true);
  assert.equal(addOpp.includes("mountVoiceIntakePanel"), true);
  assert.equal(addOpp.includes("createVoiceIntakeController"), false);
});

test("service worker cache bumped for voice bar deploy", () => {
  assert.ok(sw.includes("iaqar-shell-workspace-v3"));
});
