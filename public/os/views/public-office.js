/**
 * Public office page (/o/<slug>, ?office=<id>&view=public). No account needed.
 * The target office is the one resolved from the link (publicOffices), never a
 * value the visitor sends; the Worker re-checks the intake belongs to that office.
 */

import { h, ic, clear, field, setFieldError, clearFieldErrors, append } from "../core/dom.js";
import { db, workerBase } from "../core/runtime.js";
import { runAction } from "../core/ui.js";
import { PROPERTY_TYPES, PURPOSES, RECORD_KIND, validateRecordInput, transactionTypeFor } from "../domain/records-domain.js";
import { priceStatusField } from "./record-form.js";
import { buildWhatsAppUrl, cleanText, formatNumber, localPhone, toNumber } from "../domain/format-domain.js";

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

function officeHeader(office) {
  const logo = /^https:\/\//.test(String(office.logoUrl || "")) ? h("img", { src: office.logoUrl, alt: `شعار ${office.officeName || "المكتب"}` }) : h("img", { src: "/icons/iaqar-logo.png", alt: "iAqar.ai", class: "os-site-logo" });
  return h("div", { class: "os-public-hero" },
    h("div", { class: "os-public-logo" }, logo),
    h("h1", { class: "os-public-title", text: office.officeName || "المكتب العقاري" }),
    h("div", { class: "os-public-rule" }),
    h("div", { class: "os-license" },
      office.brokerName ? h("span", {}, ic("user"), ` الوسيط: ${office.brokerName}`) : null,
      office.licenseNumber ? h("span", {}, ic("shield"), ` رخصة فال: ${office.licenseNumber}`) : null,
      office.city ? h("span", {}, ic("pin"), ` ${office.city}`) : null));
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

function intakeForm(root, office, kind) {
  const recordKind = kind === "owner" ? RECORD_KIND.OFFER : RECORD_KIND.REQUEST;
  let purpose = "";
  const purposeSeg = h("div", { class: "os-seg", role: "group", "aria-label": "الغرض" });
  const hidden = h("input", { type: "hidden", name: "purpose" });
  const drawPurpose = () => {
    clear(purposeSeg);
    for (const p of PURPOSES[recordKind]) purposeSeg.append(h("button", { type: "button", "aria-pressed": String(purpose === p.id), onClick: () => { purpose = p.id; hidden.value = p.id; drawPurpose(); } }, p.label));
  };
  drawPurpose();
  const price = h("input", { class: "os-input", name: "price", inputmode: "numeric", placeholder: "مثال: 850,000" });
  price.addEventListener("blur", () => { if (price.value) price.value = formatNumber(price.value) || price.value; });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("send"), "إرسال");
  const status = h("div", { class: "os-alert bad", role: "alert", hidden: true });
  const form = h("form", { class: "os-card", novalidate: true },
    h("div", { class: "os-form" },
      h("div", { class: "os-field" }, h("span", { text: kind === "owner" ? "ماذا تريد لعقارك؟" : "ماذا تبحث عنه؟" }), purposeSeg, hidden, h("span", { class: "os-error", role: "alert" })),
      field("نوع العقار", h("div", {}, h("input", { class: "os-input", name: "propertyType", list: "pub-types", autocomplete: "off", placeholder: "شقة، فيلا، أرض…" }), h("datalist", { id: "pub-types" }, PROPERTY_TYPES.map((t) => h("option", { value: t }))))),
      h("div", { class: "os-row2" },
        field("المدينة", h("input", { class: "os-input", name: "city", value: office.city || "" })),
        field("الحي", h("input", { class: "os-input", name: "district" }))),
      field(kind === "owner" ? "السعر المطلوب (ريال)" : "الميزانية (ريال)", price),
      kind === "owner" ? priceStatusField() : null,
      h("div", { class: "os-row2" },
        field("المساحة (م²)", h("input", { class: "os-input", name: "area", inputmode: "numeric" }), { optional: true }),
        field("عدد الغرف", h("input", { class: "os-input", name: "rooms", inputmode: "numeric" }), { optional: true })),
      field(kind === "owner" ? "وصف العقار ومميزاته" : "المواصفات المطلوبة", h("textarea", { class: "os-textarea", name: "notes", maxlength: "900" }), { optional: true }),
      field("الاسم الكامل", h("input", { class: "os-input", name: "contactName", autocomplete: "name", placeholder: "الاسم الأول واسم العائلة" })),
      field("رقم الجوال", h("input", { class: "os-input", name: "contactPhone", inputmode: "tel", dir: "ltr", autocomplete: "tel", placeholder: "05XXXXXXXX" })),
      status, submit,
      h("p", { class: "os-sub", style: { fontSize: ".84rem", textAlign: "center" }, text: "لا تحتاج إنشاء حساب. تصل بياناتك إلى هذا المكتب فقط." })));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    clearFieldErrors(form);
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
    const input = { kind: recordKind, purpose, propertyType: value("propertyType"), city: value("city"), district: value("district"), price: value("price"), priceStatus: value("priceStatus"), area: value("area"), rooms: value("rooms"), contactName: value("contactName"), contactPhone: value("contactPhone"), notes: value("notes") };
    const check = validateRecordInput(input, { requireName: true });
    const name = cleanText(input.contactName, 80);
    if (!/\S+\s+\S+/.test(name)) check.errors.contactName = "اكتب الاسم الأول واسم العائلة";
    if (Object.keys(check.errors).length) {
      for (const [key, message] of Object.entries(check.errors)) setFieldError(form, key === "kind" ? "purpose" : key, message);
      form.querySelector(".os-field.invalid")?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    const v = check.value;
    const ok = await runAction(submit, async () => {
      const ref = db().collection("offices").doc(office.id).collection("publicIntake").doc();
      await ref.set({
        officeId: office.id,
        kind,
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
        mediaPaths: [],
        imageCount: 0,
        hasVideo: false,
        source: "office_public_link",
        status: "new",
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
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
  const choose = (kind) => {
    clear(main);
    append(main, 
      h("div", { class: "os-page-head" },
        h("button", { type: "button", class: "os-back", onClick: () => renderPublicOffice(root, target) }, ic("chev-right"), "رجوع"),
        h("h1", { class: "os-page-title", text: kind === "owner" ? "لدي عقار" : "أبحث عن عقار" }), h("span")),
      h("p", { class: "os-sub", style: { textAlign: "center", marginBottom: "10px" }, text: office.officeName || "" }),
      intakeForm(root, office, kind));
    window.scrollTo({ top: 0 });
  };
  const wa = buildWhatsAppUrl(office.whatsapp || office.phone, `مرحبًا ${office.officeName || ""}`);
  append(main, 
    officeHeader(office),
    h("p", { class: "os-sub", style: { textAlign: "center" }, text: "سجّل عقارك أو طلبك مباشرة، وسيتواصل معك الوسيط المرخّص." }),
    h("div", { class: "os-paths" },
      h("button", { type: "button", class: "os-path-card", onClick: () => choose("owner") }, h("span", { class: "ic" }, ic("home")), "لدي عقار", h("small", { text: "للبيع أو الإيجار" })),
      h("button", { type: "button", class: "os-path-card", onClick: () => choose("client") }, h("span", { class: "ic" }, ic("search")), "أبحث عن عقار", h("small", { text: "للشراء أو الاستئجار" }))),
    h("div", { class: "os-btn-row" },
      office.phone ? h("a", { class: "os-btn secondary", href: `tel:${localPhone(office.phone) || office.phone}` }, ic("phone"), "اتصال") : null,
      wa ? h("a", { class: "os-btn whatsapp", href: wa, target: "_blank", rel: "noopener" }, ic("whatsapp"), "واتساب المكتب") : null),
    h("div", { class: "os-skyline", "aria-hidden": "true" }),
    h("p", { style: { textAlign: "center", marginTop: "16px" } }, h("a", { href: "/", class: "os-btn ghost" }, ic("key"), "دخول المكتب")),
    h("footer", { class: "os-public-powered", "data-powered-by": "" },
      h("span", { text: "مدعوم بواسطة مكاتب عقارية ذكية" }),
      h("a", { href: "/legacy.html#broker", "data-create-office": "", text: "أنشئ مكتبك العقاري" })));
}
