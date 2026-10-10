import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";
import { openGeneralTask } from "./task-fallback.js";
import { h, ic, clear, append } from "../core/dom.js";
import { propertyTypeIcon } from "../core/icons.js";
import { go, back } from "../core/nav.js";
import { watchCooperation } from "../core/community.js";
import { watchInbox } from "../core/live.js";
import { inboxItemView } from "../domain/message-class-domain.js";
import { communitySummary, communityViews } from "../domain/community-domain.js";
import { session } from "../core/session.js";
import { state, subscribe, recordById } from "../core/state.js";
import { filterTasks, sortTasks, visibleToActor, taskCardModel, parseMeta, dealRoute, taskPathStep } from "../domain/task-domain.js";
import { recordView } from "../domain/records-domain.js";
import { formatDateTime, formatDay, toDate } from "../domain/format-domain.js";
import { officeToolByLabel } from "../domain/office-tools-domain.js";
import { loadChannels } from "../core/channels.js";
import { loadSupportStatus, sendSupportTicket } from "../core/support.js";
import { supportCardView, TICKET_KIND, TICKET_KIND_LABEL, validateOfficeTicket } from "../domain/support-domain.js";
import { openSheet, runAction, toast } from "../core/ui.js";
import { loadAgentStatus } from "../core/agent.js";
import { LANE, agentCounts, agentStatusView } from "../domain/agent-domain.js";

export const STEPS = [["تطابق","match","مراجعة التطابقات المناسبة"],["تواصل","phone","التواصل مع المالك أو العميل"],["تفاوض","handshake","مناقشة السعر والتفاصيل"],["معاينة","calendar","تحديد موعد المعاينة"],["مستندات","note","إرسال العقود والمستندات"],["إغلاق","check-circle","إنهاء الصفقة"]];
export function taskStep(task){return taskPathStep(task);}
function openTask(task,model){if(model.opens==="deal")go(dealRoute(task));else if(model.opens==="community")go("community");else if(model.opens==="review")go("review/"+task.matchId);else if(model.opens==="session"&&model.journeyId)go("session/"+model.journeyId);else if(model.journeyId)go("journey/"+model.journeyId);else if(task.opportunityId)go("record/"+task.opportunityId);else openGeneralTask(task);}
export function mine(){return sortTasks(filterTasks(state.tasks.filter(t=>visibleToActor(t,{uid:session.user?.uid,isManager:session.isManager,officeId:session.officeId})),"all"));}
export function taskRecord(task){const meta=parseMeta(task);return recordById(task.offerId||meta.ownerOfferId)||recordById(task.opportunityId)||recordById(task.requestId||meta.clientRequestId);}
export function photo(record={},extra=""){
 const raw=record.coverUrl||record.coverImageUrl||record.images?.[0]||record.photos?.[0]||record.imageUrls?.[0];const url=typeof raw==="string"?raw:raw?.url;
 const box=h("div",{class:"ref-photo "+extra});
 if(/^https?:\/\//.test(url||"")){const img=h("img",{src:url,alt:record.propertyType||"العقار",loading:"lazy"});img.addEventListener("error",()=>{img.remove();box.append(ic(propertyTypeIcon(record.propertyType)));},{once:true});box.append(img);}else box.append(ic(propertyTypeIcon(record.propertyType)));
 return box;
}
/**
 * «مسار الصفقة»: six buttons. Pressing a stage shows everything in it; pressing it again shows all.
 * `counts[i]` (when known) is the number of items in stage i and shows as a small badge.
 */
export function stepStrip({ active = null, counts = [], onSelect = null } = {}) {
  const steps = STEPS.map(([name, icon, hint], i) => {
    const n = Number(counts[i] || 0);
    const selected = active === i;
    return h("button", {
      type: "button", class: "ref-step" + (selected ? " active" : ""), "data-step": String(i), "aria-pressed": String(selected),
      "aria-label": n ? `${name} — ${n}` : name, title: hint,
      onClick: () => { if (onSelect) onSelect(selected ? null : i); }
    }, h("span", {}, ic(icon), n ? h("em", { class: "ref-step-count", "data-step-count": String(i), text: n > 99 ? "99+" : String(n) }) : null), h("small", { text: name }));
  });
  return h("section", { class: "ref-path os-card" },
    h("div", { class: "ref-path-heading" }, h("h2", { text: "مسار الصفقة" }), h("span", { text: "اضغط أي مرحلة لعرض ما فيها" })),
    h("div", { class: "ref-steps ref-steps-live", role: "group", "aria-label": "مراحل الصفقة" }, steps));
}
function homeRow(task){const r=taskRecord(task)||{},v=recordView(r),m=taskCardModel(task),s=taskStep(task);return h("button",{class:"ref-home-row",type:"button",onClick:()=>go("task/"+task.id)},photo(r),h("div",{class:"ref-row-copy"},h("b",{text:s===0?"مراجعة تطابق":m.button}),h("small",{text:v.location||m.title||task.titleText||"مهمة"})),h("span",{class:"ref-status step-"+s,text:STEPS[s][0]}),timeChip(task)||h("span"),ic("chev-left"));}
/** Card time from real data: an appointment shows its day/time (late when passed); otherwise how long ago the task last moved. */
export function timeInfo(task,now=new Date()){const due=toDate(task.dueAt||task.appointmentAt||task.viewingAt);if(due){const day=formatDay(due,now),near=["اليوم","غدًا","أمس"].includes(day),text=near?formatDateTime(due,now).replace(" · "," "):day.split(" ").slice(1,3).join(" ");return due<now?{text:"متأخرة · "+text,late:true}:{text,late:false};}
 const meta=parseMeta(task),at=toDate(meta.lastEventAt||task.lastEventAt||task.updatedAt||task.createdAt);if(!at)return{text:"",late:false};const min=Math.max(0,Math.round((now-at)/60000));
 if(min<1)return{text:"الآن",late:false};if(min<60)return{text:min===1?"منذ دقيقة":min===2?"منذ دقيقتين":min<=10?`منذ ${min} دقائق`:`منذ ${min} دقيقة`,late:false};const hr=Math.round(min/60);
 if(hr<24)return{text:hr===1?"منذ ساعة":hr===2?"منذ ساعتين":hr<=10?`منذ ${hr} ساعات`:`منذ ${hr} ساعة`,late:false};const d=Math.round(hr/24);
 return{text:d===1?"أمس":d===2?"منذ يومين":d<=10?`منذ ${d} أيام`:formatDay(at,now).split(" ").slice(1,3).join(" "),late:false};}
export function timeLabel(task){return timeInfo(task).text;}
export function timeChip(task){const t=timeInfo(task);return t.text?h("span",{class:"ref-time"+(t.late?" late":"")},ic("clock"),t.text):null;}

const PRIMARY_OFFICE_TOOLS = Object.freeze([
  ["ملفاتي", "archive"],
  ["النماذج", "contract"],
  ["الدليل", "clipboard"],
  ["الخدمات", "link"],
  ["الحاسبة", "coins"],
  ["السوق", "chart-up"]
]);

export function officeDisplayName(office = {}) {
  const raw = String(
    office.businessName ||
    office.tradeName ||
    office.officeName ||
    office.name ||
    ""
  ).trim();
  if (!raw) return "المكتب العقاري";
  if (/(^|\s)مكتب(\s|$)|عقار/.test(raw)) return raw;
  return `مكتب ${raw} العقاري`;
}

function brokerAvatar(office) {
  if (!isSafePhotoDataUrl(office.brokerPhotoUrl)) return null;
  const img = h("img", { class: "ref-office-avatar", src: office.brokerPhotoUrl, alt: "صورة الوسيط", "data-broker-avatar": "" });
  img.addEventListener("error", () => img.replaceWith(officeLogo(office)));
  return img;
}

function officeLogo(office) {
  if (/^https?:\/\//.test(String(office.logoUrl || ""))) {
    const img = h("img", { src: office.logoUrl, alt: officeDisplayName(office) || "شعار المكتب" });
    img.addEventListener("error", () => img.replaceWith(h("span", { class: "ref-office-logo-mark", "aria-hidden": "true" })), { once: true });
    return img;
  }
  return h("span", { class: "ref-office-logo-mark", "aria-hidden": "true" });
}

/** Every tool opens a working screen (routes live in office-tools-domain.js); none is a placeholder. */
function officeToolCard([label, iconName]) {
  const tool = officeToolByLabel(label);
  const card = h("button", { type: "button", class: "ref-office-tool", dataset: { officeTool: label, toolRoute: tool?.route || "" }, "aria-label": tool?.hint ? `${label} — ${tool.hint}` : label },
    h("span", { class: "ref-office-tool-icon" }, ic(iconName)),
    h("strong", { text: label }));
  if (tool) card.addEventListener("click", () => go(tool.route));
  return card;
}

/**
 * «مدير المكتب»: a compact card at the start of «أدوات المكتب». Every number comes from the same
 * lanes Daily Tasks shows (one function, so the two never disagree); the status is the Worker's.
 */
function agentCard() {
  const statusPill = h("span", { class: "ref-agent-status", "data-agent-status": "", text: "جارٍ التحقق" });
  const needs = h("button", { type: "button", class: "ref-agent-needs", "data-agent-needs": "", onClick: () => go(`tasks?lane=${LANE.NEEDS_YOU}`) });
  const facts = h("small", { class: "ref-agent-facts", "data-agent-facts": "" });
  const chat = h("button", { type: "button", class: "ref-agent-chat", "data-agent-chat": "", onClick: () => go("agent") }, ic("robot"), h("span", { text: "تحدث مع مدير المكتب" }));
  const card = h("div", { class: "ref-agent-card", "data-agent-card": "" },
    h("div", { class: "ref-agent-head" }, h("span", { class: "os-set-icon" }, ic("robot")), h("b", { text: "مدير المكتب" }), statusPill),
    needs, facts, chat);
  let status = { loaded: false };
  const mine = (list) => list.filter((task) => visibleToActor(task, { uid: session.user?.uid, isManager: session.isManager, officeId: session.officeId }));
  card.fill = () => {
    const view = agentStatusView(status);
    statusPill.textContent = view.label;
    statusPill.dataset.state = view.state;
    statusPill.className = `ref-agent-status${view.tone ? ` is-${view.tone}` : ""}`;
    if (!state.tasksReady) { needs.textContent = "جارٍ تحميل المعاملات…"; facts.textContent = ""; return; }
    const counts = agentCounts(mine(state.tasks), mine(state.doneToday || []));
    clear(needs);
    if (counts.needsYou) append(needs, h("strong", { text: String(counts.needsYou) }), h("span", { text: counts.needsYou === 1 ? "معاملة تحتاج تدخلك" : "معاملات تحتاج تدخلك" }), ic("chev-left"));
    else append(needs, h("span", { text: "جميع المعاملات تحت المتابعة، ولا توجد قرارات تنتظرك حاليًا." }));
    needs.dataset.count = String(counts.needsYou);
    facts.textContent = `${status.enabled ? "يتابعها مدير المكتب" : "بانتظار رد"}: ${counts.following} · أُنجز اليوم: ${counts.doneToday}`;
    facts.dataset.following = String(counts.following);
    facts.dataset.done = String(counts.doneToday);
  };
  loadAgentStatus(session.officeId).then((s) => { status = s; card.fill(); }).catch(() => { status = { loaded: true, enabled: false, lastErrorAt: new Date().toISOString() }; card.fill(); });
  return card;
}

/** «بلاغ أو استفسار»: one short form; the support manager receives it (and on Telegram when the assistant is linked). */
function openSupportTicket() {
  let kind = TICKET_KIND.QUESTION;
  const kinds = h("div", { class: "os-seg", role: "group", "aria-label": "نوع الرسالة" },
    ...[TICKET_KIND.QUESTION, TICKET_KIND.REPORT].map((value) => {
      const b = h("button", { type: "button", "aria-pressed": String(value === kind), "data-support-kind": value, text: TICKET_KIND_LABEL[value] });
      b.addEventListener("click", () => { kind = value; kinds.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
      return b;
    }));
  const area = h("textarea", { class: "os-textarea", rows: "4", maxlength: "1000", "data-support-text": "", placeholder: "اكتب سؤالك أو صف المشكلة: ماذا كنت تفعل وما الذي ظهر لك؟" });
  const admin = h("input", { type: "checkbox", "data-support-admin": "" });
  const error = h("small", { class: "os-field-error", role: "alert" });
  const send = h("button", { type: "button", class: "os-btn primary block", "data-support-send": "" }, ic("send"), "إرسال");
  const sheet = openSheet("بلاغ أو استفسار", h("div", { class: "os-support-form" },
    kinds,
    h("label", { class: "os-field" }, h("span", { text: "التفاصيل" }), area, error),
    h("label", { class: "os-support-admin" }, admin, h("span", { text: "أحتاج تدخل المسؤول" })),
    send));
  send.addEventListener("click", () => {
    const checked = validateOfficeTicket({ kind, text: area.value, needsAdmin: admin.checked });
    error.textContent = checked.ok ? "" : checked.error;
    if (!checked.ok) return;
    runAction(send, async () => {
      const result = await sendSupportTicket(session.officeId, checked);
      sheet.close();
      toast(`وصلت رسالتك (رقم ${result.ticketRef || "—"}) وسيتابعها المسؤول.`, "ok");
    });
  });
}

/**
 * «مركز التواصل والدعم»: the office inbox entry, the office's channels that are really linked,
 * the platform support account (only when configured) and «بلاغ أو استفسار». The assistant line
 * shows only while the assistant is connected — nothing here claims a connection that is not there.
 */
function supportCard() {
  const channels = h("div", { class: "ref-support-channels", "data-support-channels": "" });
  const assistant = h("p", { class: "ref-support-assistant", "data-support-assistant": "", hidden: true }, ic("robot"), h("span", { text: "دعم ذكي مع تحويل للمسؤول عند الحاجة" }));
  const report = h("button", { type: "button", class: "ref-support-chip is-action", "data-support-report": "", onClick: openSupportTicket }, ic("mail"), h("span", { text: "بلاغ أو استفسار" }));
  // One row of chips: the office's linked channels, then the platform support line and «بلاغ أو استفسار».
  const actions = channels;
  channels.append(report);
  const card = h("section", { class: "os-card ref-office-section ref-support-card", "data-support-card": "" },
    h("button", { type: "button", class: "os-home-community", "data-inbox-entry": "", onClick: () => go("inbox") },
      h("span", { class: "os-set-icon" }, ic("support")),
      h("span", {}, h("b", { text: "مركز التواصل والدعم" }), h("small", { text: "الرسائل الواردة من قنوات المكتب مصنّفة" }), h("span", { class: "os-coop-badge", "data-inbox-summary": "" })),
      ic("chev-left")),
    channels, assistant);
  card.fill = ({ channels: officeChannels = [], support = {} } = {}) => {
    const view = supportCardView({ channels: officeChannels, support });
    channels.querySelectorAll("[data-support-channel]").forEach((chip) => chip.remove());
    for (const channel of [...view.channels].reverse()) {
      channels.prepend(h("button", { type: "button", class: "ref-support-chip", "data-support-channel": channel.id, onClick: () => go("inbox") }, ic(channel.id), h("span", { text: channel.label })));
    }
    actions.querySelector("[data-support-telegram]")?.remove();
    if (view.telegramBusiness) {
      actions.insertBefore(h("a", { class: "ref-support-chip", href: view.telegramBusiness.url, target: "_blank", rel: "noopener", "data-support-telegram": "" }, ic("telegram"), h("span", { text: view.telegramBusiness.label })), report);
    }
    report.hidden = !view.canReport;
    assistant.hidden = !view.assistantActive;
  };
  return card;
}

export function renderOffice(container){
  clear(container);
  const office = session.office || {};
  const officeName = officeDisplayName(office);
  const broker = String(office.brokerName || office.licensedBrokerName || session.member?.displayName || session.member?.name || "—").trim();
  const license = String(office.falLicenseNumber || office.licenseNumber || office.valLicenseNumber || office.falNumber || office.licenseNo || "—").trim();
  const city = String(office.city || office.address?.city || office.location?.city || "—").trim();

  // Icon first (far right in RTL), then «label : value» kept together; numbers stay LTR in place.
  const profileRow = (icon, label, value, { ltr = false } = {}) => h("div", { class: "ref-office-profile-row" },
    h("span", { class: "ref-office-row-icon", "aria-hidden": "true" }, ic(icon)),
    h("div", { class: "ref-office-row-text" },
      label ? h("span", { text: `${label} :` }) : null,
      h("b", ltr ? { text: value, class: "ref-office-ltr" } : { text: value })));
  // The full name always shows: up to two lines, with a slightly smaller size for long names — never clipped.
  const nameSize = officeName.length > 30 ? "is-long" : officeName.length > 20 ? "is-mid" : "";

  append(container,
    h("section", { class: "os-card ref-office-profile" },
      h("div", { class: "ref-office-profile-main" },
        h("div", { class: "ref-office-profile-head" },
          h("h2", { class: nameSize, text: officeName })),
        profileRow("user", "الوسيط", broker),
        profileRow("license", "ترخيص فال", license, { ltr: true }),
        profileRow("pin", "", city)),
      h("div", { class: "ref-office-profile-logo" }, h("div", { class: "ref-office-logo-box" }, brokerAvatar(office) || officeLogo(office)))),

    // «إضافة سريعة»: paste an ad (one or several) → review → save into this office.
    h("button", { type: "button", class: "os-btn primary block ref-quick-add", "data-quick-add": "", onClick: () => go("quick-add") }, ic("sparkles"), "إضافة سريعة", h("small", { text: "الصق إعلانًا من واتساب أو تيليجرام" })),

    // Order (approved): office card → office tools → التعاون → مركز التواصل والدعم; the bottom bar stays fixed.
    h("section", { class: "os-card ref-office-section" },
      h("div", { class: "ref-office-heading" }, h("h2", { text: "أدوات المكتب" })),
      agentCard(),
      h("div", { class: "ref-office-tools", "aria-label": "أدوات المكتب" }, PRIMARY_OFFICE_TOOLS.map(officeToolCard))),

    h("section", { class: "os-card ref-office-section" },
      h("button", { type: "button", class: "os-home-community", "data-community-entry": "", onClick: () => go("community") },
        h("span", { class: "os-set-icon" }, ic("handshake")),
        h("span", {}, h("b", { text: "التعاون" }), h("small", { text: "تعاون مباشر بين وسيط العرض ووسيط الطلب" }), h("span", { class: "os-coop-badge", "data-coop-summary": "" })),
        ic("chev-left"))),

    supportCard()
  );

  // «التعاون»: a light summary only («2 نشط · 1 بانتظار الرد»); the actions live in Daily Tasks and on the cooperation page.
  const badge = container.querySelector("[data-coop-summary]");
  // «مركز التواصل»: how many messages wait for the broker (kept out of the records until he decides).
  const inboxBadge = container.querySelector("[data-inbox-summary]");
  const offInbox = watchInbox(session.officeId, (rows) => {
    const waiting = rows.map(inboxItemView).filter((view) => view.canConvert).length;
    if (inboxBadge) inboxBadge.textContent = waiting === 0 ? "" : waiting === 1 ? "رسالة واحدة تنتظرك" : waiting === 2 ? "رسالتان تنتظرانك" : `${waiting} رسائل تنتظرك`;
  }, () => {});
  const agentBox = container.querySelector("[data-agent-card]");
  agentBox?.fill?.();
  const offAgent = subscribe((kind) => { if (kind === "tasks" || kind === "done") agentBox?.fill?.(); });
  // Real states only: the office's linked channels and the platform support line; a failure just leaves them hidden.
  const card = container.querySelector("[data-support-card]");
  let alive = true;
  Promise.allSettled([loadChannels(session.officeId), loadSupportStatus(session.officeId)]).then(([channels, support]) => {
    if (!alive || !card?.fill) return;
    card.fill({ channels: channels.status === "fulfilled" ? channels.value?.channels || [] : [], support: support.status === "fulfilled" ? support.value || {} : {} });
  });
  const offCoop = watchCooperation(session.officeId, (rows) => { if (badge) badge.textContent = communitySummary(communityViews(rows, session.officeId)); }, () => {});
  return () => { alive = false; offAgent(); try { offInbox(); } catch (_) { /* ignore */ } try { offCoop(); } catch (_) { /* ignore */ } };
}

export function renderTaskDetail(container,{taskId}){const draw=()=>{clear(container);const task=state.tasks.find(t=>t.id===taskId);if(!task){append(container,h("p",{class:"os-sub",text:state.tasksReady?"المهمة غير متاحة":"جارٍ التحميل…"}));return;}const model=taskCardModel(task),record=taskRecord(task)||{},v=recordView(record),step=taskStep(task);
 const meta=parseMeta(task),request=recordById(task.requestId||meta.clientRequestId),rv=request&&request!==record?recordView(request):null,t=timeInfo(task);
 const status=t.late?"متأخرة":({WAITING_EXTERNAL_RESPONSE:"بانتظار رد",IN_PROGRESS:"قيد التنفيذ",OPEN:"مفتوحة"})[String(task.status||"").toUpperCase()]||"مفتوحة";
 const last=model.lastEvent?model.lastEvent+(model.lastEventAt?" · "+timeInfo({lastEventAt:model.lastEventAt}).text:""):"";
 const row=(label,value,extra="")=>value?h("div",{class:"ref-detail-row "+extra},h("small",{text:label}),h("b",{text:value})):null;
 const facts=h("section",{class:"os-card ref-detail-facts"},
  row("نوع المهمة",step===0?"مراجعة تطابق":model.button),
  row("حالة المهمة",status,t.late?"late":""),
  rv?row("وصف الطلب",[rv.propertyType,rv.location,rv.priceLabel].filter(Boolean).join(" · ")):null,
  h("div",{class:"ref-detail-row ref-detail-step current"},h("small",{text:"المرحلة الحالية"}),h("b",{},h("span",{class:"ref-status step-"+step,text:STEPS[step][0]}))),
  row("آخر حركة",last),
  row("المطلوب منك الآن",model.reason||STEPS[step][2],"now"));
 append(container,h("header",{class:"ref-detail-header"},h("span",{},ic("more")),h("h1",{text:"تفاصيل المهمة"}),h("button",{type:"button",class:"os-icon-btn","aria-label":"رجوع",onClick:()=>back("tasks")},ic("chev-left"))),h("div",{class:"ref-detail-title"},h("div",{},h("h2",{text:step===0?"مراجعة تطابق":model.button}),h("p",{text:v.location})),h("span",{class:"ref-status step-"+step,text:STEPS[step][0]})),h("section",{class:"os-card ref-property"},photo(record),h("div",{},h("h3",{text:v.propertyType||"العقار"}),h("p",{text:v.location}),h("b",{text:v.priceLabel.replace(/^(السعر|الميزانية)\s*/,"")})),h("div",{class:"ref-property-facts"},v.rooms?h("span",{},ic("bed"),v.rooms+" غرف"):null,v.areaLabel?h("span",{},ic("area"),v.areaLabel):null)),facts,h("button",{type:"button",class:"os-btn primary block ref-follow",text:step===0?"مراجعة المطابقة":model.opens==="session"?"فتح غرفة التفاوض":model.button,onClick:()=>openTask(task,model)}));};draw();return subscribe(k=>{if(k==="tasks"||k==="records")draw();});}
