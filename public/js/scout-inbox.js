/**
 * «صفحة الاستقبال» (/scout-inbox.html)
 *
 * Automatic (the normal path): Claude in Chrome ends its search by opening
 *     /scout-inbox.html#c=<run code>&ingest=<batch JSON>
 * The page checks the run code against this browser's pairing, sends the batch to POST /os/scout/ingest with the
 * key paired to this browser (never shown, never in the address), and writes the Worker's own answer in
 * [data-inbox-result] for Claude to read. No paste, no button, no CSV.
 *
 * Manual (fallback only): a key and pasted results, then «إرسال».
 */
import { RUN_CODE_SHAPE, TOKEN_SHAPE, chunkBatches, parseAutoFragment, parseInboxPaste, readPairing } from "../os/domain/scout-ingest-domain.js";

const $ = (id) => document.getElementById(id);
const tokenEl = $("inbox-token");
const pasteEl = $("inbox-paste");
const sendEl = $("inbox-send");
const statusEl = $("inbox-status");
const reportEl = $("inbox-report");
const resultEl = $("inbox-result");
const manualEl = $("inbox-manual");
const pairedEl = $("inbox-paired");

const storage = (() => { try { return window.localStorage; } catch (_) { return null; } })();

function workerBase() {
  const base = window.IAQAR?.resolveWorkerBase?.() || window.IAQAR?.workerBase || "";
  return String(base).replace(/\/+$/, "");
}

function say(message, tone = "info") {
  statusEl.className = `os-alert ${tone}`;
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function line(text, cls = "") {
  const li = document.createElement("li");
  li.textContent = text;
  if (cls) li.className = cls;
  return li;
}

/** The machine-readable answer Claude reads back (counts and reasons only — no key, no phone). */
function publish(result) {
  resultEl.textContent = JSON.stringify(result, null, 1);
  resultEl.dataset.state = result.state;
  resultEl.hidden = false;
  document.title = result.state === "DONE" ? "تم الاستقبال" : result.state === "REFUSED" ? "رُفض الاستقبال" : "استقبال نتائج الباحث";
}

async function sendBatches(token, parsed, agent) {
  const batches = chunkBatches(parsed);
  const totals = { received: 0, saved: 0, updated: 0, duplicates: 0, rejected: 0, strong: 0, replayed: 0 };
  const rejected = [];
  for (const [index, batch] of batches.entries()) {
    say(`جارٍ الإرسال… الدفعة ${index + 1} من ${batches.length}`);
    let answer = null;
    for (let attempt = 0; attempt < 3 && !answer; attempt += 1) {
      let response = null;
      try {
        response = await fetch(`${workerBase()}/os/scout/ingest`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...batch, agent })
        });
      } catch (_) {
        if (attempt === 2) throw new Error("تعذر الاتصال بالخادم — أعد فتح الرابط نفسه لاحقًا (لن يتكرر ما وصل)");
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok !== false) { answer = body; break; }
      // The same batchId is safe to send again after a server error; any other refusal is final.
      if (response.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      const error = new Error(body.message || `تعذر الإرسال (${response.status})`);
      error.code = body.error || `http_${response.status}`;
      throw error;
    }
    for (const key of ["received", "saved", "updated", "duplicates", "strong"]) totals[key] += Number(answer[key] || 0);
    totals.rejected += (answer.rejected || []).length;
    if (answer.replay) totals.replayed += 1;
    for (const item of answer.rejected || []) rejected.push({ item: index * 20 + item.index + 1, reason: item.reason, message: item.message });
  }
  return { totals, rejected, batches: batches.length };
}

function summary(totals) {
  return `تم: وصل ${totals.received} — حُفظ ${totals.saved} جديد، وحُدّث ${totals.updated}، ومكرر ${totals.duplicates}، ومرفوض ${totals.rejected}. ${totals.strong ? `منها ${totals.strong} فرصة قوية. ` : ""}${totals.replayed ? "هذه الدفعة وصلت سابقًا ولم يتكرر شيء. " : ""}تظهر في «الباحث عن الفرص» للمراجعة.`;
}

// ------------------------------------------------------------------ automatic

async function automatic(fragment) {
  manualEl.hidden = true;
  // Read once, then take it out of the address (a reload never sends twice; a resend is idempotent anyway).
  history.replaceState(null, "", location.pathname + location.search);
  const pairing = readPairing(storage);
  if (!pairing) {
    say("هذا المتصفح غير مربوط بمكتب. يربطه مدير المكتب مرة واحدة من «إعدادات الباحث عن الفرص ← ربط هذا المتصفح بـ Claude».", "bad");
    publish({ state: "REFUSED", reason: "not_paired" });
    return;
  }
  if (!RUN_CODE_SHAPE.test(fragment.code) || fragment.code !== pairing.code) {
    // Another site (or a stale shortcut) opened this page with results: nothing is sent.
    say("رمز التشغيل لا يطابق ربط هذا المتصفح — لم يُرسل شيء. استخدم نص الاختصار الذي ظهر عند الربط.", "bad");
    publish({ state: "REFUSED", reason: "run_code_mismatch" });
    return;
  }
  const parsed = parseInboxPaste(fragment.raw);
  if (!parsed.ok) { say(parsed.error, "bad"); publish({ state: "REFUSED", reason: "bad_results", message: parsed.error }); return; }
  try {
    const { totals, rejected, batches } = await sendBatches(pairing.token, parsed, "claude-in-chrome");
    say(summary(totals), totals.saved + totals.updated ? "ok" : "warn");
    const list = document.createElement("ul");
    for (const r of rejected) list.append(line(`الإعلان ${r.item}: ${r.message}`, "bad"));
    reportEl.replaceChildren(list);
    publish({ state: "DONE", batches, ...totals, rejectedItems: rejected });
  } catch (error) {
    say(error?.message || "تعذر الإرسال", "bad");
    publish({ state: "REFUSED", reason: error?.code || "failed", message: error?.message || "" });
  }
}

// ------------------------------------------------------------------ manual (fallback)

async function manual() {
  statusEl.hidden = true;
  reportEl.replaceChildren();
  const pairing = readPairing(storage);
  const token = tokenEl.value.trim() || pairing?.token || "";
  if (!TOKEN_SHAPE.test(token)) { say("المفتاح غير صالح — أو اربط هذا المتصفح من إعدادات الباحث عن الفرص", "bad"); tokenEl.focus(); return; }
  const parsed = parseInboxPaste(pasteEl.value);
  if (!parsed.ok) { say(parsed.error, "bad"); pasteEl.focus(); return; }
  sendEl.disabled = true;
  try {
    const { totals, rejected } = await sendBatches(token, parsed, "scout-inbox");
    say(summary(totals), totals.saved + totals.updated ? "ok" : "warn");
    const list = document.createElement("ul");
    for (const r of rejected) list.append(line(`الإعلان ${r.item}: ${r.message}`, "bad"));
    reportEl.replaceChildren(list);
  } catch (error) {
    say(error?.message || "تعذر الإرسال — حاول مجددًا (لن يتكرر ما وصل)", "bad");
  } finally {
    sendEl.disabled = false;
  }
}

const fragment = parseAutoFragment(location.hash);
const paired = readPairing(storage);
pairedEl.textContent = paired ? `هذا المتصفح مربوط بالمكتب (${paired.officeId || "—"}) — يرسل Claude النتائج تلقائيًا.` : "هذا المتصفح غير مربوط بعد.";
if (fragment.auto) automatic(fragment);
else sendEl.addEventListener("click", manual);
