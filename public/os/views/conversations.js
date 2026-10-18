/**
 * «المحادثات» — the office's WhatsApp conversations and who answers each one.
 *
 *   #/conversations        every conversation this member may see: the employee holding it, or the broker
 *   #/conversations/<id>   the thread; «استلام المحادثة» stops the automated replies in this one conversation only,
 *                          the broker answers here, «إعادة للموظف الذكي» lets the agent continue from the same place
 *
 * Everything goes through the Worker (the conversations are closed to the browser by the rules); a stale screen gets
 * a clear message and a fresh view, never a silent overwrite.
 */

import { h, ic, clear, append, emptyState, pageHeader, surface, controlGroup, loadingState, feedback } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { api } from "../core/runtime.js";
import { newRequestKey, runAction } from "../core/ui.js";
import { relativeAgo } from "../domain/format-domain.js";
import { CONTROL_EVENT_LABEL, CONTROL_MODE, CONTROL_MODE_LABEL, EMPLOYEE_LABEL, HANDOFF_REASON_LABEL, ROLE_LABEL } from "../domain/conversation-control-domain.js";

function pageHead(title, to) {
  return pageHeader(h("h1", { class: "os-page-title", text: title }), { backControl: h("button", { type: "button", class: "os-back", onClick: () => back(to) }, ic("chev-right"), "رجوع"), action: h("span") });
}

const DELIVERED = new Set(["SENT", "SIMULATED"]);
const DELIVERY_TEXT = {
  SIMULATED: "بيئة اختبار: حُفظ ردك في المحادثة ولم يُرسل فعليًا للعميل.",
  TEMPLATE_REQUIRED: "لم يُرسل: مرّ أكثر من 24 ساعة على آخر رسالة من العميل، وواتساب يتطلب قالبًا معتمدًا.",
  AUTOMATION_OFF: "لم يُرسل: الإرسال من لوحة المكتب غير مفعّل في هذه البيئة.",
  NOT_AUTHORISED: "لم يُرسل: رقم المكتب أو رقم العميل غير مصرح بالإرسال في هذه البيئة.",
  NOT_HELD: "لم يُرسل: المحادثة لم تعد عندك.",
  OPTED_OUT: "لم يُرسل: طلب العميل إيقاف الرسائل.",
  FAILED: "تعذر الإرسال عبر واتساب. حاول لاحقًا.",
  DELIVERY_UNKNOWN: "لم نتأكد من وصول الرد. لا تُعِد إرساله قبل التحقق من تطبيق المكتب."
};

const who = (c) => c.senderName || (c.phoneTail ? `عميل ···${c.phoneTail}` : "عميل");

function modeChip(c) {
  return h("span", { class: `os-conv-mode is-${c.mode.toLowerCase()}`, "data-conversation-mode": c.mode, text: CONTROL_MODE_LABEL[c.mode] || c.mode });
}

function holderText(c) {
  if (c.mode === CONTROL_MODE.AI) return EMPLOYEE_LABEL[c.employee] || "";
  if (c.heldByMe) return "أنت ترد على هذه المحادثة";
  if (c.heldByApp) return HANDOFF_REASON_LABEL.BROKER_REPLIED_IN_APP;
  if (c.mode === CONTROL_MODE.WAITING) return HANDOFF_REASON_LABEL[c.handoffReason] || "توقف الرد الآلي وتنتظر وسيطًا";
  return c.heldBy ? "يرد عليها وسيط آخر" : "";
}

// ------------------------------------------------------------------ the list

export function renderConversations(container) {
  const body = h("div", { "data-conversations": "" }, loadingState());
  append(container, pageHead("المحادثات", "inbox"), body);
  let alive = true;
  (async () => {
    let rows;
    try { rows = (await api("/os/whatsapp-agent/conversations", { officeId: session.officeId })).conversations || []; }
    catch (error) { if (alive) { clear(body); append(body, feedback({ class: "os-alert bad", text: error?.message || "تعذر تحميل المحادثات." })); } return; }
    if (!alive) return;
    clear(body);
    append(body,
      h("p", { class: "os-sub", text: "محادثات واتساب التي يديرها موظفو المكتب الأذكياء. افتح أي محادثة لترى سياقها، واستلمها لترد بنفسك، ثم أعدها للموظف الذكي ليكمل من نفس النقطة." }),
      rows.length ? h("div", { class: "os-center-list" }, ...rows.map((c) =>
        h("button", { type: "button", class: "os-card os-conv-row", "data-conversation": c.id, onClick: () => go(`conversations/${c.id}`) },
          h("span", { class: "os-conv-row-main" },
            h("b", { dir: "auto", text: who(c) }),
            h("small", { class: "os-sub", text: holderText(c) })),
          h("span", { class: "os-conv-row-side" },
            modeChip(c),
            h("small", { class: "os-sub", text: relativeAgo(c.updatedAt) || "" }),
            c.waiting ? h("small", { class: "os-conv-waiting", text: `${c.waiting} بانتظار الرد` }) : null))))
        : emptyState("whatsapp", "لا توجد محادثات بعد", "عند تشغيل موظف واتساب للمكتب تظهر محادثات العملاء هنا."));
  })();
  return () => { alive = false; };
}

// ------------------------------------------------------------------ one conversation

export function renderConversation(container, { conversationId }) {
  const body = h("div", { "data-conversation-detail": conversationId }, loadingState());
  append(container, pageHead("المحادثة", "conversations"), body);
  let alive = true;
  let current = null;

  const notice = feedback({ class: "os-alert info", role: "status", hidden: true });
  const say = (text, tone = "info") => { notice.className = `os-alert ${tone} os-feedback`; notice.querySelector(".os-feedback-copy").textContent = text; notice.hidden = !text; };

  const bubble = (e) => e.kind === "control"
    ? h("li", { class: "os-conv-event", "data-control-event": e.type }, h("small", { text: `${CONTROL_EVENT_LABEL[e.type] || e.type}${e.at ? ` · ${relativeAgo(e.at)}` : ""}` }))
    : h("li", { class: `os-conv-msg is-${e.role}`, "data-message-role": e.role },
      h("small", { class: "os-conv-who", text: `${ROLE_LABEL[e.role] || ""}${e.via === "app" ? " (من تطبيق واتساب)" : ""}${e.state === "SIMULATED" ? " · محاكاة — لم يُرسل" : ""}` }),
      h("p", { dir: "auto", text: e.text || "—" }),
      e.at ? h("small", { class: "os-sub", text: relativeAgo(e.at) }) : null);

  const act = async (button, path, payload, success) => {
    await runAction(button, async () => {
      try {
        const r = await api(path, { officeId: session.officeId, conversationId, ...payload });
        current = r.conversation; draw();
        // A reply says what really happened to it, never «sent» when it was not.
        const state = r.delivery?.state;
        if (state && !DELIVERED.has(state)) say(DELIVERY_TEXT[state] || "لم يُرسل الرد.", "bad");
        else if (state === "SIMULATED") say(DELIVERY_TEXT.SIMULATED, "info");
        else if (success) say(success, "ok");
      } catch (error) {
        // Someone else moved first: show the fresh state instead of the stale one.
        if (error?.status === 409 || /changed|held/.test(error?.code || "")) { say(error.message, "bad"); await load(); return; }
        throw error;
      }
    });
  };

  function draw() {
    clear(body);
    const c = current;
    const take = c.canTake
      ? h("button", { type: "button", class: "os-btn primary", "data-conversation-take": "" }, ic("user"), c.heldByApp ? "استلمها هنا" : "استلام المحادثة") : null;
    if (take) take.addEventListener("click", () => act(take, "/os/whatsapp-agent/conversation/control", { action: "take", expectedVersion: c.controlVersion, requestKey: newRequestKey() }, "استلمت المحادثة. لن يرد الموظف الذكي فيها حتى تعيدها."));
    const release = c.canRelease
      ? h("button", { type: "button", class: "os-btn secondary", "data-conversation-release": "" }, ic("sparkles"), "إعادة للموظف الذكي") : null;
    if (release) release.addEventListener("click", () => act(release, "/os/whatsapp-agent/conversation/control", { action: "release", expectedVersion: c.controlVersion, requestKey: newRequestKey() }, "عادت المحادثة للموظف الذكي، ويكمل من نفس النقطة."));

    let reply = null;
    if (c.heldByMe) {
      const text = h("textarea", { class: "os-input", name: "reply", rows: 3, maxlength: 1000, placeholder: "اكتب ردك للعميل…", "aria-label": "ردك للعميل", "data-conversation-text": "" });
      const send = h("button", { type: "submit", class: "os-btn primary block", "data-conversation-send": "", disabled: !c.canReply }, ic("send"), "إرسال");
      // One key per message written: a double tap or a retry sends it once.
      let key = newRequestKey();
      text.addEventListener("input", () => { key = newRequestKey(); });
      reply = h("form", { class: "os-form os-conv-reply", "data-conversation-reply": "", novalidate: true },
        text, send,
        c.windowOpen ? null : feedback({ class: "os-alert info", "data-window-closed": "", text: "مرّ أكثر من 24 ساعة على آخر رسالة من العميل؛ واتساب لا يسمح برد حر الآن إلا بقالب معتمد. تواصل معه من تطبيق المكتب." }));
      reply.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!text.value.trim()) return say("اكتب ردك أولًا.", "bad");
        act(send, "/os/whatsapp-agent/conversation/reply", { text: text.value, requestKey: key }, "أُرسل ردك.");
      });
    }

    append(body,
      surface("section", { class: "os-conv-head" },
        h("header", { class: "os-inbox-head" }, h("b", { dir: "auto", text: who(c) }), modeChip(c)),
        c.phone ? h("small", { class: "os-sub", dir: "ltr", text: `+${c.phone}` }) : null,
        h("small", { class: "os-sub", "data-conversation-holder": "", text: holderText(c) }),
        take || release ? controlGroup("div", { class: "os-btn-row" }, take, release) : null),
      notice,
      c.timeline.length ? h("ol", { class: "os-conv-thread", "data-conversation-thread": "" }, ...c.timeline.map(bubble))
        : emptyState("whatsapp", "لا توجد رسائل محفوظة بعد", ""),
      reply,
      c.mode === CONTROL_MODE.OPTED_OUT ? feedback({ class: "os-alert info", text: "طلب العميل إيقاف الرسائل. لا يرسل المكتب شيئًا في هذه المحادثة." }) : null);
  }

  async function load() {
    try {
      const r = await api("/os/whatsapp-agent/conversation", { officeId: session.officeId, conversationId });
      if (!alive) return;
      current = r.conversation; draw();
    } catch (error) {
      if (!alive) return;
      clear(body); append(body, feedback({ class: "os-alert bad", text: error?.message || "تعذر تحميل المحادثة." }));
    }
  }
  load();
  return () => { alive = false; };
}
