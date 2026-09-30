/**
 * Match review — nothing reaches the client or owner before the broker decides.
 * Approve & start negotiation · Request information · Postpone · Reject.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { watchDoc } from "../core/live.js";
import { confirmDialog, openSheet, runAction, toast } from "../core/ui.js";
import { compareRecords, compatibilityLevel, matchReasons, matchWarnings } from "../domain/match-review-domain.js";
import { recordTitle } from "../domain/records-domain.js";
import { RECIPIENT } from "../domain/proposal-domain.js";
import { proposalPreparedPanel } from "./composer.js";

const STATE_ICON = { match: "check", differ: "alert", unknown: "question" };

function compareTable(offer, request) {
  const rows = compareRecords(offer, request);
  return h("table", { class: "os-compare" },
    h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: "العرض" }), h("th", { text: "الطلب" }))),
    h("tbody", {}, rows.map((row) => h("tr", {},
      h("td", {}, h("span", { class: `os-state ${row.state}` }, ic(STATE_ICON[row.state])), row.label),
      h("td", { text: row.offer }),
      h("td", {}, row.request, row.note ? h("small", { style: { display: "block", color: row.state === "match" ? "var(--ok)" : "var(--warn)" }, text: row.note }) : null)
    ))));
}

function openInfoRequest(match) {
  let role = RECIPIENT.CLIENT;
  const body = h("div", { class: "os-form" });
  const seg = h("div", { class: "os-seg", role: "group", "aria-label": "المستلم" });
  const drawSeg = () => {
    clear(seg);
    for (const [id, label] of [[RECIPIENT.CLIENT, "العميل"], [RECIPIENT.OWNER, "المالك"]]) {
      seg.append(h("button", { type: "button", "aria-pressed": String(role === id), onClick: () => { role = id; drawSeg(); } }, label));
    }
  };
  drawSeg();
  const question = h("textarea", { class: "os-textarea", name: "question", maxlength: "300", placeholder: "مثال: هل العقار متاح للمعاينة هذا الأسبوع؟" });
  const prepareBtn = h("button", { type: "button", class: "os-btn primary block" }, ic("note"), "تجهيز الرسالة");
  const result = h("div");
  prepareBtn.addEventListener("click", () => runAction(prepareBtn, async () => {
    const res = await api("/os/proposals/create", {
      officeId: session.officeId, matchId: match.id, kind: "INFO_REQUEST", recipients: [role],
      fields: { question: question.value }, requestKey: `${match.id}-${role}-${question.value.length}-${Date.now().toString(36)}`
    });
    clear(result);
    append(result, proposalPreparedPanel(res.proposals[0], { onOpened: () => { sheet.close(); toast("ستعود المهمة تلقائيًا عند وصول الرد", "ok"); } }));
    prepareBtn.hidden = true;
  }));
  append(body, 
    h("p", { class: "os-sub", text: "يسأل الطرف عن سجله فقط — لا تُكشف المطابقة قبل اعتمادك." }),
    h("div", { class: "os-field" }, h("span", { text: "إرسال إلى" }), seg),
    h("label", { class: "os-field" }, h("span", { text: "المعلومة المطلوبة" }), question),
    prepareBtn, result
  );
  const sheet = openSheet("طلب معلومات", body);
}

function openPostpone(match) {
  const body = h("div", { class: "os-form" }, h("p", { class: "os-sub", text: "تختفي المهمة حتى الموعد ثم تعود تلقائيًا." }));
  const row = h("div", { class: "os-options" });
  for (const [days, label] of [[1, "غدًا"], [3, "بعد 3 أيام"], [7, "بعد أسبوع"]]) {
    const b = h("button", { type: "button", class: "os-option" }, ic("clock"), label);
    b.addEventListener("click", () => runAction(b, async () => {
      await api("/os/review/decide", { officeId: session.officeId, matchId: match.id, decision: "postpone", postponeDays: days });
      sheet.close();
      toast(`تم تأجيل المراجعة ${label}`, "ok");
      go("tasks");
    }));
    append(row, b);
  }
  append(body, row);
  const sheet = openSheet("تأجيل المراجعة", body);
}

async function reject(match, button) {
  const ok = await confirmDialog({ title: "رفض هذه المطابقة؟", text: "تُغلق مهمة المراجعة، ويبقى السجلان في المستودع لمطابقات أخرى.", confirmLabel: "رفض", danger: true });
  if (!ok) return;
  const res = await runAction(button, () => api("/os/review/decide", { officeId: session.officeId, matchId: match.id, decision: "reject", reason: "رفض الوسيط بعد المراجعة" }));
  if (res?.ok) { toast("تم رفض المطابقة", "ok"); go("tasks"); }
}

export function renderReview(container, { matchId }) {
  let match;
  const draw = () => {
    clear(container);
    append(container, h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => back("tasks") }, ic("chev-right"), "المهام اليومية"),
      h("h1", { class: "os-page-title", text: "مراجعة المطابقة" }), h("span")));
    if (match === undefined) { append(container, h("div", { class: "os-skeleton" })); return; }
    if (!match) { append(container, h("div", { class: "os-alert bad", text: "المطابقة غير موجودة أو لم تعد متاحة." })); return; }
    const offer = recordById(match.offerId || match.ownerOfferId);
    const request = recordById(match.requestId || match.clientRequestId);
    if (!offer || !request) {
      append(container, state.recordsReady ? h("div", { class: "os-alert warn", text: "أحد سجلي المطابقة غير متاح في المستودع." }) : h("div", { class: "os-skeleton" }));
      return;
    }
    const level = compatibilityLevel(match.score);
    const reasons = matchReasons(match);
    const warnings = matchWarnings(match);
    const decided = match.brokerDecision && match.brokerDecision !== "POSTPONED";
    const superseded = match.isCurrent === false || match.status === "superseded";
    const infoReplies = ["client", "owner"].map((role) => match[`infoReply_${role}`] ? h("div", { class: "os-alert info" }, h("b", { text: role === "client" ? "رد العميل: " : "رد المالك: " }), match[`infoReply_${role}`].label) : null);

    const approveBtn = h("button", { type: "button", class: "os-btn primary block" }, ic("handshake"), "اعتماد وبدء التفاوض");
    approveBtn.addEventListener("click", () => runAction(approveBtn, async () => {
      const res = await api("/os/review/decide", { officeId: session.officeId, matchId: match.id, decision: "approve" });
      toast("تم اعتماد المطابقة — جهّز أول مقترح", "ok");
      go(`journey/${res.journeyId}`);
    }));
    const moreRow = h("div", { class: "os-btn-row", style: { marginTop: "8px" } },
      h("button", { type: "button", class: "os-btn secondary", onClick: () => openInfoRequest(match) }, ic("question"), "طلب معلومات"),
      h("button", { type: "button", class: "os-btn secondary", onClick: () => openPostpone(match) }, ic("clock"), "تأجيل"),
      h("button", { type: "button", class: "os-btn danger", onClick: (e) => reject(match, e.currentTarget) }, ic("x-circle"), "رفض"));

    append(container, 
      h("div", { class: "os-card os-review-card" },
        h("div", { class: "os-review-heading" },
          h("div", {},
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
          h("span", { class: "os-badge", text: level.label }),
          h("span", { class: "os-sub", style: { fontSize: ".82rem" }, text: "درجة محسوبة من محرك المطابقة" })),
        h("h2", { class: "os-task-title", text: `${String(request.purpose).toUpperCase() === "LEASE_REQUEST" ? "طلب استئجار" : "طلب شراء"} ↔ ${recordTitle(offer).replace(/ للبيع| للإيجار/, "")}` }),
        h("p", { class: "os-sub", text: `العرض: ${offer.contactName || "المالك"} · الطلب: ${request.contactName || "العميل"}` })),
          h("div", { class: "os-score", style: { background: `conic-gradient(var(--blue) ${Math.min(100, Math.max(0, level.score))}%, var(--tint) 0)` }, "aria-label": `نسبة التوافق ${level.score}%` }, h("b", { text: `${level.score}%` }))),
        h("div", { style: { marginTop: "10px" } }, compareTable(offer, request))
      ),
      h("div", { class: "os-grid-2" },
        reasons.length ? h("div", { class: "os-card" }, h("h3", { class: "os-h2" }, ic("check-circle"), "أسباب التوافق"), h("ul", { class: "os-list", style: { marginTop: "8px" } }, reasons.map((r) => h("li", { class: "good" }, ic("check"), r)))) : null,
        warnings.length ? h("div", { class: "os-card" }, h("h3", { class: "os-h2" }, ic("alert"), "نقاط الاختلاف"), h("ul", { class: "os-list", style: { marginTop: "8px" } }, warnings.map((w) => h("li", { class: "warn" }, ic("alert"), w)))) : null
      ),
      infoReplies,
      decided || superseded
        ? h("div", { class: "os-card" },
          h("div", { class: `os-alert ${match.brokerDecision === "APPROVED" ? "ok" : "info"}`, text: superseded && !decided ? "حُدّثت بيانات أحد السجلين فأصبحت هذه النسخة قديمة." : match.brokerDecision === "APPROVED" ? "تم اعتماد هذه المطابقة." : "تم رفض هذه المطابقة." }),
          match.journeyId ? h("button", { type: "button", class: "os-btn primary block", style: { marginTop: "10px" }, onClick: () => go(`journey/${match.journeyId}`) }, "فتح مساحة الفرصة") : null)
        : h("div", { class: "os-card" }, approveBtn, moreRow,
          h("p", { class: "os-sub", style: { marginTop: "8px", fontSize: ".86rem" }, text: "لن يُرسل أي شيء للعميل أو المالك قبل قرارك." }))
    );
  };
  const off1 = watchDoc(session.officeId, "matches", matchId, (doc) => { match = doc; draw(); }, () => { match = null; draw(); });
  const off2 = subscribe((k) => { if (k === "records") draw(); });
  draw();
  return () => { off1(); off2(); };
}
