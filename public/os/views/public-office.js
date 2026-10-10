/**
 * Public office page (/o/<slug>, ?office=<id>&view=public). No account needed.
 * The target office is the one resolved from the link (publicOffices), never a
 * value the visitor sends; the Worker re-checks the intake belongs to that office.
 */

import { h, ic, clear, field, setFieldError, clearFieldErrors, append } from "../core/dom.js";
import { db, workerBase } from "../core/runtime.js";
import { runAction } from "../core/ui.js";
import { PROPERTY_TYPES, PURPOSES, RECORD_KIND, validateRecordInput, transactionTypeFor } from "../domain/records-domain.js";
import { priceStatusField, validityField } from "./record-form.js";
import { buildWhatsAppUrl, cleanText, formatNumber, localPhone, toNumber } from "../domain/format-domain.js";
import { imagePicker } from "./record-images.js";
import { EXTERNAL_BROKER, externalBrokerClaim } from "../domain/external-broker-domain.js";
import { normalizeAnalysis, notesWithDistricts, splitDistrictInput } from "../domain/smart-fill-domain.js";
import { applyListing, fillModes } from "./smart-fill.js";

export function publicOfficeTarget() {
  const path = location.pathname;
  const slugMatch = path.match(/^\/(o|m)\/([^/?#]+)/i);
  if (slugMatch) return { slug: decodeURIComponent(slugMatch[2]).toLowerCase() };
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "public") {
    const id = String(params.get("office") || params.get("officeId") || "").trim();
    if (id && id !== "platform") return { officeId: id };
  }
  return null;
}

async function resolveOffice(target) {
  const col = db().collection("publicOffices");
  if (target.officeId) {
    const snap = await col.doc(target.officeId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }
  let snap = await col.where("publicSlug", "==", target.slug).limit(1).get();
  if (snap.empty) snap = await col.where("legacyPublicSlugs", "array-contains", target.slug).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

const PLATFORM_LOGO = "/icons/iaqar-logo.png";

/** The office logo, or — when there is none or its file is gone — the platform mark (never a broken image). */
function officeLogoImage(office) {
  const fallback = () => h("img", { src: PLATFORM_LOGO, alt: "", class: "os-site-logo" });
  if (!/^https:\/\//.test(String(office.logoUrl || ""))) return fallback();
  const img = h("img", { src: office.logoUrl, alt: `شعار ${office.officeName || "المكتب"}` });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}

function officeHeader(office) {
  return h("div", { class: "os-public-hero" },
    h("div", { class: "os-public-logo" }, officeLogoImage(office)),
    h("h1", { class: "os-public-title", text: office.officeName || "المكتب العقاري" }),
    h("div", { class: "os-public-rule" }),
    h("div", { class: "os-license", "data-office-facts": "" },
      office.city ? h("span", {}, ic("pin"), ` ${office.city}`) : null,
      office.brokerName ? h("span", {}, ic("user"), ` ${office.brokerName}`) : null),
    // The licence number as the office entered it — information, not a verification badge.
    office.licenseNumber ? h("span", { class: "os-public-license", "data-office-license": "" }, ic("license"), ` رخصة فال ${office.licenseNumber}`) : null);
}

function successView(root, office, kind) {
  clear(root);
  const wa = buildWhatsAppUrl(office.whatsapp || office.phone, `مرحبًا ${office.officeName || ""}، أرسلت ${kind === "owner" ? "بيانات عقاري" : "طلبي"} من رابط المكتب.`);
  append(root, h("main", { class: "os-app", style: { maxWidth: "560px" } },
    officeHeader(office),
    h("div", { class: "os-card", style: { textAlign: "center" } },
      h("div", { class: "os-task-icon", style: { margin: "0 auto 8px", background: "var(--ok-tint)", color: "var(--ok)" } }, ic("check-circle")),
      h("h2", { class: "os-h2", style: { justifyContent: "center" }, text: "تم استلام بياناتك" }),
      h("p", { class: "os-sub", text: `شكرًا لك. سيتواصل معك ${office.brokerName || "الوسيط"} عند وجود خيار مناسب.` }),
      wa ? h("a", { class: "os-btn whatsapp", href: wa, target: "_blank", rel: "noopener", style: { marginTop: "10px" } }, ic("whatsapp"), "تواصل مع المكتب") : null)));
}

async function analyzePublic(office, text) {
  let response = null;
  try {
    response = await fetch(`${workerBase()}/os/public/smart-fill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeId: office.id, text }) });
  } catch (_) { throw new Error("تعذر الاتصال بالخادم"); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.message || "تعذر التحليل الآن");
  return normalizeAnalysis(body);
}

function intakeForm(root, office, kind, { switchKind, carry = null } = {}) {
  const recordKind = kind === "owner" ? RECORD_KIND.OFFER : RECORD_KIND.REQUEST;
  let purpose = "";
  const purposeSeg = h("div", { class: "os-seg", role: "group", "aria-label": "الغرض" });
  const hidden = h("input", { type: "hidden", name: "purpose" });
  const drawPurpose = () => {
    clear(purposeSeg);
    for (const p of PURPOSES[recordKind]) purposeSeg.append(h("button", { type: "button", "aria-pressed": String(purpose === p.id), onClick: () => { purpose = p.id; hidden.value = p.id; drawPurpose(); } }, p.label));
  };
  drawPurpose();
  const role = h("select", { class: "os-input", name: "submitterRole", "data-testid": "submitter-role" },
    h("option", { value: kind === "owner" ? "OWNER" : "CLIENT", text: kind === "owner" ? "مالك العقار" : "عميل يبحث عن عقار" }),
    h("option", { value: EXTERNAL_BROKER, text: "وسيط عقاري متعاون" }));
  const brokerFields = h("div", { class: "os-form", hidden: true, "data-external-broker-fields": "" },
    field("المكتب العقاري الذي تتبعه", h("input", { class: "os-input", name: "externalBrokerOffice", maxlength: "100" }), { optional: true }),
    field("رقم رخصة فال", h("input", { class: "os-input", name: "externalBrokerLicense", inputmode: "numeric", maxlength: "40" }), { hint: "عند انطباق متطلبات الترخيص. البيانات تخضع للمراجعة." }),
    field("صفة التمثيل", h("select", { class: "os-input", name: "representationClaim" },
      h("option", { value: "", text: "اختر" }),
      ...(kind === "owner" ? [{ value: "OWNER", text: "أمثل المالك بموجب تفويض" }, { value: "NOT_AUTHORIZED", text: "لم يكتمل التفويض بعد" }] : [{ value: "BUYER", text: "أمثل مشتريًا" }, { value: "TENANT", text: "أمثل مستأجرًا" }]).map(o => h("option", o))),
      { hint: "اختيار الصفة لا يوثقها. يراجع المكتب الإثبات قبل قبول التعاون." }),
    field("مرجع التفويض أو إثبات التمثيل", h("input", { class: "os-input", name: "representationReference", maxlength: "240" }), { optional: true, hint: "يطلب المكتب المستند عند الحاجة عبر قناة التواصل المعتمدة." }));
  role.addEventListener("change", () => {
    brokerFields.hidden = role.value !== EXTERNAL_BROKER;
    brokerFields.querySelectorAll("input,select").forEach(el => { el.disabled = brokerFields.hidden; });
  });
  role.dispatchEvent(new Event("change"));
  const price = h("input", { class: "os-input", name: "price", inputmode: "numeric", placeholder: "مثال: 850,000" });
  price.addEventListener("blur", () => { if (price.value) price.value = formatNumber(price.value) || price.value; });
  // The rules and the Worker accept up to 5 photos from the public link, for offers only.
  const picker = kind === "owner" ? imagePicker({ max: 5, hint: "حتى 5 صور للعقار. تُصغَّر تلقائيًا قبل الإرسال." }) : null;
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("send"), "إرسال");
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true });
  const fields = h("div", { class: "os-form" },
      field("صفة مقدم المشاركة", role), brokerFields,
      h("div", { class: "os-field" }, h("span", { text: kind === "owner" ? "ماذا تريد لعقارك؟" : "ماذا تبحث عنه؟" }), purposeSeg, hidden, h("span", { class: "os-error", role: "alert" })),
      field("نوع العقار", h("div", {}, h("input", { class: "os-input", name: "propertyType", list: "pub-types", autocomplete: "off", placeholder: "شقة، فيلا، أرض…" }), h("datalist", { id: "pub-types" }, PROPERTY_TYPES.map((t) => h("option", { value: t }))))),
      h("div", { class: "os-row2" },
        field("المدينة", h("input", { class: "os-input", name: "city", value: office.city || "" })),
        field("الحي", h("input", { class: "os-input", name: "district", placeholder: "حي أو أكثر: الملقا، النرجس" }))),
      field(kind === "owner" ? "السعر المطلوب (ريال)" : "الميزانية (ريال)", price),
      kind === "owner" ? priceStatusField() : null,
      h("div", { class: "os-row2" },
        field("المساحة (م²)", h("input", { class: "os-input", name: "area", inputmode: "numeric" }), { optional: true }),
        field("عدد الغرف", h("input", { class: "os-input", name: "rooms", inputmode: "numeric" }), { optional: true })),
      field(kind === "owner" ? "وصف العقار ومميزاته" : "المواصفات المطلوبة", h("textarea", { class: "os-textarea", name: "notes", maxlength: "900" }), { optional: true }),
      picker ? picker.el : null,
      validityField({}, { isNew: true }),
      field("الاسم الكامل", h("input", { class: "os-input", name: "contactName", autocomplete: "name", placeholder: "الاسم الأول واسم العائلة" })),
      field("رقم الجوال", h("input", { class: "os-input", name: "contactPhone", inputmode: "tel", dir: "ltr", autocomplete: "tel", placeholder: "05XXXXXXXX" })),
      status, submit,
      h("p", { class: "os-sub os-public-privacy", text: "لا تحتاج إنشاء حساب. تصل بياناتك إلى هذا المكتب فقط، وتراجعها قبل الإرسال." }));
  let smartUsed = false;
  // «تعبئة ذكية | تعبئة يدوية» above the same form (smart by default; switching keeps everything).
  const fill = fillModes({
    formBox: fields,
    initialText: carry?.text || "",
    intro: carry?.notice || "",
    analyze: (text) => analyzePublic(office, text),
    several: "النص فيه أكثر من إعلان — رتبنا الأول. أرسل كل عرض أو طلب على حدة.",
    onListing: (listing) => {
      const wanted = listing.kind === "OFFER" ? "owner" : listing.kind === "REQUEST" ? "client" : "";
      if (wanted && wanted !== kind && switchKind) {
        // The text is a request on «لدي عقار» (or the reverse): open the right path with the same text.
        switchKind(wanted, { text: fill.text(), notice: wanted === "client" ? "النص طلب عقار — نقلناك إلى «أبحث عن عقار»." : "النص عرض عقار — نقلناك إلى «لدي عقار»." });
        return { abort: true };
      }
      smartUsed = true;
      applyListing(fields, listing, { officeCity: office.city || "" });
      return { roleLabel: role.options[role.selectedIndex]?.text || "", cityFromOffice: !listing.city && Boolean(office.city) };
    }
  });
  const form = h("form", { class: "os-card", novalidate: true }, fill.el, fields);
  let submissionRef = null;
  let intakeStored = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    clearFieldErrors(form);
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
    const districts = splitDistrictInput(value("district"));
    const input = { kind: recordKind, purpose, propertyType: value("propertyType"), city: value("city"), district: districts.district, price: value("price"), priceStatus: value("priceStatus"), area: value("area"), rooms: value("rooms"), contactName: value("contactName"), contactPhone: value("contactPhone"), notes: notesWithDistricts(value("notes"), districts.others) };
    const check = validateRecordInput(input, { requireName: true });
    const claim = externalBrokerClaim({ kind, submitterRole: role.value, externalBrokerOffice: value("externalBrokerOffice"), externalBrokerLicense: value("externalBrokerLicense"), representationClaim: value("representationClaim"), representationReference: value("representationReference") });
    Object.assign(check.errors, claim.errors);
    if (role.value === EXTERNAL_BROKER && kind === "client" && ((purpose === "PURCHASE" && value("representationClaim") !== "BUYER") || (purpose === "LEASE_REQUEST" && value("representationClaim") !== "TENANT"))) check.errors.representationClaim = "اختر صفة تمثيل تتوافق مع غرض الطلب";
    const name = cleanText(input.contactName, 80);
    if (!/\S+\s+\S+/.test(name)) check.errors.contactName = "اكتب الاسم الأول واسم العائلة";
    if (Object.keys(check.errors).length) {
      for (const [key, message] of Object.entries(check.errors)) setFieldError(form, key === "kind" ? "purpose" : key, message);
      form.querySelector(".os-field.invalid")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const v = check.value;
    const ok = await runAction(submit, async () => {
      const ref = submissionRef ||= db().collection("offices").doc(office.id).collection("publicIntake").doc();
      // Photos first (to this intake's folder); the intake then lists exactly what was stored.
      if (!intakeStored) {
      const mediaPaths = picker && picker.count() ? await picker.commitToIntake(office.id, ref.id) : [];
      await ref.set({
        officeId: office.id,
        kind,
        submitterRole: role.value,
        ...(role.value === EXTERNAL_BROKER ? {
          externalBrokerOffice: claim.value.externalBrokerOffice, externalBrokerLicense: claim.value.externalBrokerLicense,
          representationClaim: claim.value.representationClaim, representationReference: claim.value.representationReference
        } : {}),
        name,
        phone: localPhone(v.contactPhone),
        propertyType: v.propertyType,
        district: v.district,
        city: v.city,
        purpose: v.purpose,
        transactionType: transactionTypeFor(v.purpose),
        amount: toNumber(v.price),
        area: v.area || 0,
        rooms: v.rooms || 0,
        details: v.notes || "",
        mediaPaths,
        imageCount: mediaPaths.length,
        hasVideo: false,
        source: "office_public_link",
        fillMethod: smartUsed ? "SMART_FILL" : "MANUAL",
        status: "new",
        // «مدة العرض أو الطلب» (optional for older clients of this page): the server applies it to the record.
        validityDuration: value("validityDuration") || "",
        validityUrgent: value("validityUrgent") === "yes",
        validityCustomDate: value("validityCustomDate") || "",
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      intakeStored = true;
      }
      // Processing is retry-safe server side (already-processed intakes return duplicate).
      const response = await fetch(`${workerBase()}/pipeline/public-intake`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ officeId: office.id, intakeId: ref.id })
      }).catch(() => null);
      if (response && !response.ok && response.status === 429) throw new Error("تم استلام بياناتك، وسنعالجها بعد قليل.");
      return true;
    }, { onError: (error) => { status.textContent = error.message; status.hidden = false; } });
    if (ok) successView(root, office, kind);
  });
  return form;
}

export async function renderPublicOffice(root, target) {
  clear(root);
  const main = h("main", { class: "os-app", style: { maxWidth: "560px" } }, h("div", { class: "os-skeleton", style: { height: "220px" } }));
  append(root, main);
  let office = null;
  try {
    office = await resolveOffice(target);
  } catch (error) {
    console.warn("[office-os] public office", error);
  }
  clear(main);
  if (!office) {
    append(main, h("div", { class: "os-card" }, h("h1", { class: "os-h2", text: "رابط المكتب غير متاح" }), h("p", { class: "os-sub", text: "تحقق من الرابط أو تواصل مع المكتب مباشرة." })));
    return;
  }
  document.title = office.officeName || "المكتب العقاري";
  const choose = (kind, carry = null) => {
    clear(main);
    append(main, 
      h("div", { class: "os-page-head" },
        h("button", { type: "button", class: "os-back", onClick: () => renderPublicOffice(root, target) }, ic("chev-right"), "رجوع"),
        h("h1", { class: "os-page-title", text: kind === "owner" ? "لدي عقار" : "أبحث عن عقار" }), h("span")),
      h("p", { class: "os-sub", style: { textAlign: "center", marginBottom: "10px" }, text: office.officeName || "" }),
      intakeForm(root, office, kind, { switchKind: choose, carry }));
    window.scrollTo({ top: 0 });
    if (carry?.text) main.querySelector("[data-smart-analyze]")?.click();
  };
  const wa = buildWhatsAppUrl(office.whatsapp || office.phone, `مرحبًا ${office.officeName || ""}`);
  const path = (kind, iconName, title, sub) => h("button", { type: "button", class: "os-path-card", "data-path": kind, onClick: () => choose(kind) },
    h("span", { class: "ic" }, ic(iconName)),
    h("span", { class: "os-path-text" }, h("b", { text: title }), h("small", { text: sub })),
    h("span", { class: "os-path-go", "aria-hidden": "true" }, ic("chev-left")));
  main.classList.add("os-public-page");
  append(main,
    officeHeader(office),
    h("p", { class: "os-public-tagline", text: "عقارك وطلبك في المكان الصحيح. تواصل مباشرة مع المكتب العقاري." }),
    h("div", { class: "os-paths" },
      path("owner", "home", "لدي عقار", "للبيع أو الإيجار"),
      path("client", "search", "أبحث عن عقار", "للشراء أو الاستئجار")),
    h("p", { class: "os-public-trust", "data-public-trust": "" }, "بدون حساب · تصل بياناتك لهذا المكتب فقط · تراجعها قبل الإرسال"),
    h("p", { class: "os-public-coop", "data-coop-hint": "" }, ic("handshake"), " وسيط متعاون؟ اختر المسار ثم صفتك «وسيط عقاري متعاون»."),
    (office.phone || wa) ? h("div", { class: "os-public-contact" },
      wa ? h("a", { class: "os-btn primary", href: wa, target: "_blank", rel: "noopener", "data-contact": "whatsapp" }, ic("whatsapp"), "واتساب المكتب") : null,
      office.phone ? h("a", { class: "os-btn secondary", href: `tel:${localPhone(office.phone) || office.phone}`, "data-contact": "call" }, ic("phone"), "اتصال") : null) : null,
    h("footer", { class: "os-public-powered", "data-powered-by": "" },
      h("span", { text: "مدعوم بواسطة مكاتب عقارية ذكية" }),
      h("a", { href: "/#/register", "data-create-office": "", text: "أنشئ مكتبك العقاري" }),
      h("a", { href: "/", "data-office-login": "", text: "دخول المكتب" })));
}
