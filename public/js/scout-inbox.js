/**
 * «صفحة الاستقبال» (/scout-inbox.html): the office's key + pasted results → POST /os/scout/ingest, batch by batch.
 * The key may come in the address fragment (#k=…, never sent to any server) or be typed; it is kept on this device
 * only when «تذكّر المفتاح» is ticked. The page shows the Worker's own report — nothing is claimed that it did not say.
 */
import { TOKEN_SHAPE, chunkBatches, parseInboxPaste } from "../os/domain/scout-ingest-domain.js";

const STORE_KEY = "iaqar.scoutInbox.token";
const $ = (id) => document.getElementById(id);
const tokenEl = $("inbox-token");
const rememberEl = $("inbox-remember");
const pasteEl = $("inbox-paste");
const sendEl = $("inbox-send");
const statusEl = $("inbox-status");
const reportEl = $("inbox-report");

const store = {
  get() { try { return localStorage.getItem(STORE_KEY) || ""; } catch (_) { return ""; } },
  set(value) { try { localStorage.setItem(STORE_KEY, value); } catch (_) { /* private window */ } },
  clear() { try { localStorage.removeItem(STORE_KEY); } catch (_) { /* private window */ } }
};

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

const fromFragment = new URLSearchParams(location.hash.replace(/^#/, "")).get("k") || "";
if (fromFragment) history.replaceState(null, "", location.pathname + location.search);
tokenEl.value = fromFragment || store.get();
rememberEl.checked = Boolean(store.get());

async function send() {
  statusEl.hidden = true;
  reportEl.replaceChildren();
  const token = tokenEl.value.trim();
  if (!TOKEN_SHAPE.test(token)) { say("المفتاح غير صالح — انسخه كما ظهر في إعدادات الباحث عن الفرص", "bad"); tokenEl.focus(); return; }
  const parsed = parseInboxPaste(pasteEl.value);
  if (!parsed.ok) { say(parsed.error, "bad"); pasteEl.focus(); return; }
  if (rememberEl.checked) store.set(token); else store.clear();
  const batches = chunkBatches(parsed);
  sendEl.disabled = true;
  const totals = { received: 0, saved: 0, updated: 0, duplicates: 0, rejected: 0, strong: 0 };
  const list = document.createElement("ul");
  reportEl.append(list);
  try {
    for (const [index, batch] of batches.entries()) {
      say(`جارٍ الإرسال… الدفعة ${index + 1} من ${batches.length}`);
      let answer = null;
      for (let attempt = 0; attempt < 2 && !answer; attempt += 1) {
        try {
          const response = await fetch(`${workerBase()}/os/scout/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...batch, agent: "scout-inbox" })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || body.ok === false) {
            if (response.status >= 500 && attempt === 0) continue; // the same batchId is safe to send again
            throw new Error(body.message || `تعذر الإرسال (${response.status})`);
          }
          answer = body;
        } catch (error) {
          if (attempt === 1 || !(error instanceof TypeError)) throw error;
        }
      }
      for (const key of Object.keys(totals)) totals[key] += key === "rejected" ? (answer.rejected || []).length : Number(answer[key] || 0);
      for (const item of answer.rejected || []) list.append(line(`الإعلان ${index * 20 + item.index + 1}: ${item.message}`, "bad"));
      if (answer.replay) list.append(line(`الدفعة ${index + 1} وصلت سابقًا — لم يُكرَّر شيء.`));
    }
    say(`تم: وصل ${totals.received} — حُفظ ${totals.saved} جديد، وحُدّث ${totals.updated}، ومكرر ${totals.duplicates}، ومرفوض ${totals.rejected}. ${totals.strong ? `منها ${totals.strong} فرصة قوية. ` : ""}راجعها في «الباحث عن الفرص».`, totals.saved + totals.updated ? "ok" : "warn");
  } catch (error) {
    say(error?.message || "تعذر الإرسال — حاول مجددًا (لن يتكرر ما وصل)", "bad");
  } finally {
    sendEl.disabled = false;
  }
}

sendEl.addEventListener("click", send);
