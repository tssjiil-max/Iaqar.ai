/**
 * «مدير المكتب الذكي»
 *   #/agent            the broker's conversation with the office manager (answers from the office's own data)
 *   #/settings/agent   the manager's controls: on/off, the office's instructions, today's numbers, recent actions
 * Everything goes through the Worker; nothing here sends a message to a client or an owner.
 */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { runAction, toast } from "../core/ui.js";
import { agentAct, agentChat, agentHistory, loadAgentStatus, saveAgentSettings } from "../core/agent.js";
import { listAuditLog } from "../core/live.js";
import { agentStatusView } from "../domain/agent-domain.js";
import { relativeAgo } from "../domain/format-domain.js";

const SUGGESTIONS = ["وش يحتاج تدخلي اليوم؟", "عطني أقوى المطابقات الجديدة", "وش المعاينات القادمة؟", "أي صفقة متوقفة؟", "وش أُنجز اليوم؟"];

function head(title, backTo) {
  return h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => (backTo ? go(backTo) : back("office")) }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: title }), h("span"));
}

function itemRow(item) {
  const row = h("button", { type: "button", class: "os-card os-center-row", "data-agent-item": item.id || "", onClick: () => item.route && go(item.route) },
    h("span", { class: "os-set-text" }, h("b", { text: item.title || "", dir: "auto" }), item.sub ? h("small", { text: item.sub, dir: "auto" }) : null),
    item.tag ? h("span", { class: "os-center-tag", text: item.tag }) : h("span"), ic("chev-left"));
  return row;
}

function bubble(turn, onAct) {
  const mine = turn.role === "broker";
  const box = h("div", { class: `os-agent-msg ${mine ? "is-mine" : "is-agent"}`, "data-agent-turn": turn.role },
    h("p", { dir: "auto", text: turn.text || "" }));
  if (!mine && Array.isArray(turn.items) && turn.items.length) box.append(h("div", { class: "os-center-list" }, ...turn.items.map(itemRow)));
  if (!mine && turn.action?.tool && onAct) {
    // A change runs only when the broker presses this button himself (approval gate).
    const act = h("button", { type: "button", class: "os-btn secondary", "data-agent-act": turn.action.tool }, ic("check-circle"), turn.action.label || "تنفيذ");
    act.addEventListener("click", () => onAct(turn.action, act));
    box.append(act);
  }
  if (!mine && turn.source === "rules") box.append(h("small", { class: "os-sub", text: "رد من بيانات المكتب مباشرة (بدون الذكاء الاصطناعي)" }));
  return box;
}

export function renderAgent(container) {
  const list = h("div", { class: "os-agent-thread", "aria-live": "polite", "data-agent-thread": "" });
  const status = h("p", { class: "os-sub", "data-agent-state": "" });
  const input = h("textarea", { class: "os-textarea os-agent-input", rows: "2", maxlength: "1000", placeholder: "اكتب سؤالك أو أمرك لمدير المكتب…", "data-agent-input": "", dir: "auto" });
  const send = h("button", { type: "button", class: "os-btn primary", "data-agent-send": "" }, ic("send"), "إرسال");
  const chips = h("div", { class: "os-chips", role: "group", "aria-label": "اقتراحات" },
    ...SUGGESTIONS.map((text) => h("button", { type: "button", class: "os-chip", "data-agent-suggest": "", onClick: () => { input.value = text; submit(); } }, text)));
  append(container, head("مدير المكتب الذكي"), status, list, chips, h("div", { class: "os-agent-compose" }, input, send));
  let turns = [];
  const draw = () => {
    clear(list);
    if (!turns.length) append(list, h("div", { class: "os-agent-msg is-agent" }, h("p", { text: "أهلًا، معك مدير المكتب الذكي (مساعد ذكاء اصطناعي). اسألني عن معاملات مكتبك، أو اختر من الاقتراحات." })));
    for (const turn of turns) append(list, bubble(turn, onAct));
    list.lastElementChild?.scrollIntoView({ block: "end" });
  };
  const onAct = (action, button) => runAction(button, async () => {
    await agentAct(session.officeId, action.tool, action.journeyId);
    button.disabled = true;
  }, { success: action.tool === "take_over_deal" ? "استلمت الصفقة — توقف البوت عن مراسلة الطرفين فيها" : "عادت الصفقة إلى البوت" });
  function submit() {
    const message = input.value.trim();
    if (!message) return;
    const requestKey = `ak_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    turns.push({ role: "broker", text: message });
    input.value = "";
    draw();
    runAction(send, async () => {
      const answer = await agentChat(session.officeId, message, requestKey);
      turns.push({ role: "agent", text: answer.reply, items: answer.items || [], action: answer.action || null, source: answer.source });
      draw();
    });
  }
  send.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } });
  loadAgentStatus(session.officeId).then((s) => { status.textContent = `الحالة: ${agentStatusView(s).label}`; }).catch(() => { status.textContent = ""; });
  agentHistory(session.officeId).then((r) => { turns = Array.isArray(r.turns) ? r.turns : []; draw(); }).catch(() => draw());
  draw();
  return null;
}

export function renderAgentSettings(container) {
  append(container, head("مدير المكتب الذكي", "settings"));
  if (!session.isManager) { append(container, h("div", { class: "os-alert warn", text: "هذه الإعدادات لمدير المكتب فقط." })); return null; }
  const body = h("div", { "data-agent-settings": "" }, h("div", { class: "os-skeleton" }));
  append(container, body);
  const draw = (s) => {
    clear(body);
    const view = agentStatusView(s);
    const toggle = h("button", { type: "button", class: `os-btn ${s.enabled ? "secondary" : "primary"} block`, "data-agent-toggle": s.enabled ? "off" : "on" }, ic(s.enabled ? "pause" : "play"), s.enabled ? "إيقاف مدير المكتب الذكي" : "تشغيل مدير المكتب الذكي");
    toggle.addEventListener("click", () => runAction(toggle, async () => { draw({ ...(await saveAgentSettings(session.officeId, { enabled: !s.enabled })), loaded: true }); }, { success: s.enabled ? "تم الإيقاف" : "تم التشغيل" }));
    const area = h("textarea", { class: "os-textarea", rows: "4", maxlength: "600", "data-agent-instructions": "", placeholder: "مثال: رحّب باسم المكتب، وركّز على الأحياء الشمالية، وكن مختصرًا." });
    area.value = s.instructions || "";
    const save = h("button", { type: "button", class: "os-btn secondary", "data-agent-save": "" }, ic("check"), "حفظ التعليمات");
    save.addEventListener("click", () => runAction(save, async () => { draw({ ...(await saveAgentSettings(session.officeId, { instructions: area.value })), loaded: true }); }, { success: "تم حفظ التعليمات" }));
    const actions = h("div", { class: "os-center-list", "data-agent-actions": "" }, h("p", { class: "os-sub", text: "جارٍ تحميل آخر الإجراءات…" }));
    append(body,
      h("section", { class: "os-card" },
        h("div", { class: "os-card-head" }, h("h2", { class: "os-h2", text: "الحالة" }), h("span", { class: `ref-agent-status${view.tone ? ` is-${view.tone}` : ""}`, "data-agent-settings-state": view.state, text: view.label })),
        h("p", { class: "os-sub", text: "يجيب الوسطاء من بيانات المكتب فقط، ولا ينفذ قرارات المال والعقود والسعر النهائي وإغلاق الصفقة. أي تغيير ينفذه بعد ضغط الوسيط بنفسه." }),
        toggle,
        h("p", { class: "os-sub", "data-agent-today": "", text: `اليوم: ${s.today?.chats || 0} محادثة · ${s.today?.aiCalls || 0} طلب للذكاء الاصطناعي · ${s.today?.fallbacks || 0} رد بالقواعد · ${s.today?.errors || 0} خطأ` }),
        s.aiConfigured ? null : h("div", { class: "os-alert warn", text: "الذكاء الاصطناعي غير مهيأ على هذه البيئة، فيرد مدير المكتب من بيانات المكتب بالقواعد." })),
      h("section", { class: "os-card" },
        h("h2", { class: "os-h2", text: "تعليمات المكتب" }),
        h("p", { class: "os-sub", text: "نبرة التواصل وما يركز عليه، ضمن قواعد الخصوصية والصلاحيات التي لا تتغير." }),
        area, save),
      h("section", { class: "os-card" },
        h("h2", { class: "os-h2", text: "القنوات" }),
        h("p", { class: "os-sub", "data-agent-telegram": "", text: s.telegramBotOn ? "بوت تيليجرام مفعّل في مكتبك: يسأل الطرفين عن المطابقات ويفتح الصفقة عند موافقتهما." : "بوت تيليجرام متوقف في مكتبك." }),
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go("settings/channels") }, ic("link"), "قنوات المكتب")),
      h("section", { class: "os-card" }, h("h2", { class: "os-h2", text: "آخر الإجراءات" }), actions));
    listAuditLog(session.officeId, 60).then((rows) => {
      clear(actions);
      const mine = rows.filter((row) => /^(AGENT_|BOT_)/.test(String(row.action || ""))).slice(0, 15);
      if (!mine.length) { append(actions, h("p", { class: "os-sub", text: "لا توجد إجراءات مسجلة بعد." })); return; }
      const labels = { AGENT_ENABLED: "تشغيل مدير المكتب", AGENT_DISABLED: "إيقاف مدير المكتب", AGENT_ACTION_APPROVED: "إجراء نفذه الوسيط من المحادثة", BOT_ENABLED: "تشغيل بوت تيليجرام", BOT_DISABLED: "إيقاف بوت تيليجرام" };
      for (const row of mine) append(actions, h("div", { class: "os-card os-center-row" }, h("span", { class: "os-set-text" }, h("b", { text: labels[row.action] || row.action }), h("small", { text: relativeAgo(row.createdAt) || "" }))));
    }).catch(() => { clear(actions); append(actions, h("p", { class: "os-sub", text: "تعذر تحميل الإجراءات." })); });
  };
  loadAgentStatus(session.officeId, { fresh: true }).then(draw).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل حالة مدير المكتب." })); });
  return null;
}
