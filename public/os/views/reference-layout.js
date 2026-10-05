import { isSafePhotoDataUrl } from "../domain/avatar-domain.js";
import { openGeneralTask } from "./task-fallback.js";
import { h, ic, clear, append } from "../core/dom.js";
import { propertyTypeIcon } from "../core/icons.js";
import { go, back } from "../core/nav.js";
import { watchCooperation } from "../core/community.js";
import { communitySummary, communityViews } from "../domain/community-domain.js";
import { session } from "../core/session.js";
import { state, subscribe, recordById } from "../core/state.js";
import { filterTasks, sortTasks, visibleToActor, taskCardModel, parseMeta, dealRoute, taskPathStep } from "../domain/task-domain.js";
import { recordView } from "../domain/records-domain.js";
import { formatDateTime, formatDay, toDate } from "../domain/format-domain.js";
import { officeToolByLabel } from "../domain/office-tools-domain.js";

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
    h("div", { class: "ref-steps", role: "group", "aria-label": "مراحل الصفقة" }, steps));
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
    return h("img", { src: office.logoUrl, alt: officeDisplayName(office) || "شعار المكتب" });
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
        profileRow("note", "ترخيص فال", license, { ltr: true }),
        profileRow("pin", "", city)),
      h("div", { class: "ref-office-profile-logo" }, h("div", { class: "ref-office-logo-box" }, brokerAvatar(office) || officeLogo(office)))),

    h("section", { class: "os-card ref-office-section" },
      h("button", { type: "button", class: "os-home-community", "data-community-entry": "", onClick: () => go("community") },
        h("span", { class: "os-set-icon" }, ic("handshake")),
        h("span", {}, h("b", { text: "التعاون" }), h("small", { text: "تعاون مباشر بين وسيط العرض ووسيط الطلب" }), h("span", { class: "os-coop-badge", "data-coop-summary": "" })),
        ic("chev-left"))),

    h("section", { class: "os-card ref-office-section" },
      h("div", { class: "ref-office-heading" }, h("h2", { text: "أدوات المكتب" })),
      h("div", { class: "ref-office-tools", "aria-label": "أدوات المكتب" }, PRIMARY_OFFICE_TOOLS.map(officeToolCard)))
  );

  // «التعاون»: a light summary only («2 نشط · 1 بانتظار الرد»); the actions live in Daily Tasks and on the cooperation page.
  const badge = container.querySelector("[data-coop-summary]");
  return watchCooperation(session.officeId, (rows) => { if (badge) badge.textContent = communitySummary(communityViews(rows, session.officeId)); }, () => {});
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
 append(container,h("header",{class:"ref-detail-header"},h("span",{},ic("more")),h("h1",{text:"تفاصيل المهمة"}),h("button",{type:"button",class:"os-icon-btn","aria-label":"رجوع",onClick:()=>back("tasks")},ic("chev-left"))),h("div",{class:"ref-detail-title"},h("div",{},h("h2",{text:step===0?"مراجعة تطابق":model.button}),h("p",{text:v.location})),h("span",{class:"ref-status step-"+step,text:STEPS[step][0]})),h("section",{class:"os-card ref-property"},photo(record),h("div",{},h("h3",{text:v.propertyType||"العقار"}),h("p",{text:v.location}),h("b",{text:v.priceLabel.replace(/^(السعر|الميزانية)\s*/,"")})),h("div",{class:"ref-property-facts"},v.rooms?h("span",{},ic("bed"),v.rooms+" غرف"):null,v.areaLabel?h("span",{},ic("area"),v.areaLabel):null)),facts,h("button",{type:"button",class:"os-btn primary block ref-follow",text:step===0?"مراجعة المطابقة":model.opens==="session"?"فتح جلسة التفاوض":model.button,onClick:()=>openTask(task,model)}));};draw();return subscribe(k=>{if(k==="tasks"||k==="records")draw();});}
