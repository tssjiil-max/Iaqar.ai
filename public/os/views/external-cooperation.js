import { h, field } from "../core/dom.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { runAction } from "../core/ui.js";
import { isExternalBroker } from "../domain/external-broker-domain.js";
import { formatDateTime } from "../domain/format-domain.js";

export function externalCooperationPanel(record) {
  if (!isExternalBroker(record)) return null;
  const select = (name, rows, value) => {
    const el = h("select", { class: "os-input", name }, rows.map(([id, label]) => h("option", { value: id, text: label })));
    el.value = value || rows[0][0]; return el;
  };
  const status = select("representationStatus", [["PENDING", "بانتظار التحقق"], ["VERIFIED", "تم التحقق بعد مراجعة الإثبات"], ["REJECTED", "لم يُقبل الإثبات"]], record.representationStatus);
  const cooperation = select("cooperationStatus", [["REQUESTED", "طلب تعاون"], ["ACCEPTED", "تعاون مقبول"], ["CLOSED", "تعاون مغلق"]], record.cooperationStatus);
  const commission = select("commissionStatus", [["NONE", "لا يوجد اتفاق عمولة"], ["AGREED", "يوجد اتفاق عمولة موثق"]], record.commissionStatus);
  const form = h("form", { class: "os-form" },
    h("p", { class: "os-sub", text: `المكتب: ${record.externalBrokerOffice || "غير مذكور"} · رخصة فال المقدمة: ${record.externalBrokerLicense || "غير مذكورة"}` }),
    h("p", { class: "os-sub", text: `صفة التمثيل المقدمة: ${({OWNER:"ممثل للمالك",BUYER:"ممثل لمشترٍ",TENANT:"ممثل لمستأجر",NOT_AUTHORIZED:"التفويض غير مكتمل"})[record.representationClaim] || "غير محددة"}` }),
    h("p", { class: "os-sub", text: `مرجع مقدم المشاركة: ${record.representationReference || "غير مذكور"} · الاستلام: ${formatDateTime(record.createdAt) || ""}` }),
    field("صفة التمثيل بعد مراجعة المكتب", select("representationClaim", record.opportunityKind === "OFFER" ? [["OWNER", "ممثل المالك"], ["NOT_AUTHORIZED", "التفويض غير مكتمل"]] : [["BUYER", "ممثل المشتري"], ["TENANT", "ممثل المستأجر"]], record.representationClaim)),
    field("حالة التحقق من التمثيل", status),
    field("مرجع الإثبات الذي راجعه المكتب", h("input", { class: "os-input", name: "evidenceReference", maxlength: "240", value: record.representationEvidenceReference || "" }), { hint: "تحقق من الهوية والرخصة عند انطباقها والتفويض الفعلي. هذه مراجعة المكتب وليست تحققًا آليًا لدى الجهة المنظمة." }),
    field("حالة التعاون", cooperation),
    field("اتفاق العمولة", commission),
    field("نوع العمولة المتفق عليها", select("commissionType", [["", "اختر عند وجود اتفاق"], ["PERCENT", "نسبة (%)"], ["AMOUNT", "قيمة (ريال)"]], record.commissionType)),
    field("قيمة العمولة المتفق عليها", h("input", { class: "os-input", name: "commissionValue", inputmode: "decimal", value: record.commissionStatus === "AGREED" ? record.commissionValue : "" })),
    field("مرجع اتفاق العمولة", h("input", { class: "os-input", name: "commissionAgreementReference", maxlength: "240", value: record.commissionAgreementReference || "" })),
    h("p", { class: "os-sub", text: "إرسال المشاركة لا ينشئ اتفاقًا ماليًا. التواصل والتفاوض مع الوسيط المتعاون يمران عبر المكتب." }));
  const submit = h("button", { class: "os-btn secondary", type: "submit", text: "حفظ مراجعة التعاون" });
  form.append(submit);
  form.addEventListener("submit", event => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    runAction(submit, () => api("/os/records/cooperation", { officeId: session.officeId, recordId: record.id, ...input }), { success: "حُفظت مراجعة التعاون" });
  });
  return h("details", { class: "os-card", "data-external-cooperation": "" }, h("summary", { class: "os-h2", text: "وسيط متعاون — تفاصيل التعاون والمراجعة" }), form);
}
