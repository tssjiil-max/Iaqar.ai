function resolveWorkerBase() {
  try {
    if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") return window.IAQAR.resolveWorkerBase();
    const host = String(window.location.hostname || "").toLowerCase();
    if (host.includes("iaqar-ai-staging") || host.includes("--staging") || host.startsWith("staging.")) {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

const params = new URLSearchParams(window.location.search);
const officeId = String(params.get("office") || "").trim();
const sessionId = String(params.get("session") || "").trim();
const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
const completionToken = String(hash.get("token") || "").trim();
if (window.location.hash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

const els = {
  officeLine: document.getElementById("officeLine"),
  status: document.getElementById("status"),
  form: document.getElementById("form"),
  fields: document.getElementById("fields"),
  submitBtn: document.getElementById("submitBtn"),
  done: document.getElementById("done")
};

const LABELS = Object.freeze({
  opportunityKind: "نوع التسجيل",
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "السعر أو الميزانية",
  advertiserRole: "صفة المعلن",
  contactPhone: "رقم الجوال"
});

const SELECTS = Object.freeze({
  opportunityKind: [["", "اختر"], ["OFFER", "لدي عقار"], ["REQUEST", "أبحث عن عقار"]],
  purpose: [["", "اختر"], ["SALE", "بيع"], ["PURCHASE", "شراء"], ["RENT", "تأجير"], ["LEASE_REQUEST", "استئجار"]],
  advertiserRole: [["", "اختر"], ["OWNER", "مالك"], ["DELEGATE", "وكيل/مفوّض"], ["BROKER", "وسيط"], ["CLIENT", "عميل"]]
});

function showStatus(message, kind = "error") {
  els.status.textContent = message;
  els.status.className = `status ${kind}`;
}

function fieldControl(key) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.htmlFor = `field-${key}`;
  label.textContent = LABELS[key] || key;
  wrap.appendChild(label);

  let control;
  if (SELECTS[key]) {
    control = document.createElement("select");
    for (const [value, text] of SELECTS[key]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      control.appendChild(option);
    }
  } else {
    control = document.createElement("input");
    control.type = key === "priceOrBudget" ? "number" : (key === "contactPhone" ? "tel" : "text");
    if (key === "priceOrBudget") control.min = "1";
    if (key === "contactPhone") {
      control.inputMode = "tel";
      control.autocomplete = "tel";
      control.placeholder = "05xxxxxxxx";
    }
  }
  control.id = `field-${key}`;
  control.name = key;
  control.required = true;
  wrap.appendChild(control);
  return wrap;
}

async function api(path, options = {}) {
  const response = await fetch(`${resolveWorkerBase()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Completion ${completionToken}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || "تعذر تنفيذ الطلب");
    error.code = payload.error || "request_failed";
    throw error;
  }
  return payload;
}

function endpoint() {
  return `/completion/${encodeURIComponent(officeId)}/${encodeURIComponent(sessionId)}`;
}

async function load() {
  if (!officeId || !sessionId || !completionToken) {
    showStatus("رابط الاستكمال غير صالح أو ناقص.");
    return;
  }
  try {
    const payload = await api(endpoint());
    const view = payload.view || {};
    const session = view.session || {};
    const office = view.office || {};
    els.officeLine.textContent = office.name || "المكتب العقاري";
    const fields = Array.isArray(session.allowedFields) ? session.allowedFields : [];
    if (!fields.length || String(session.status || "").toUpperCase() === "COMPLETED") {
      els.done.classList.remove("hidden");
      return;
    }
    els.fields.replaceChildren(...fields.map(fieldControl));
    els.form.classList.remove("hidden");
  } catch (error) {
    const expired = ["session_expired", "session_not_active"].includes(error.code);
    showStatus(expired ? "انتهت صلاحية رابط الاستكمال. تواصل مع المكتب للحصول على رابط جديد." : "تعذر فتح رابط الاستكمال.");
  }
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.submitBtn.disabled = true;
  els.status.className = "status hidden";
  const patch = Object.fromEntries(new FormData(els.form).entries());
  try {
    const payload = await api(endpoint(), { method: "POST", body: JSON.stringify({ patch }) });
    if (payload.isComplete) {
      els.form.classList.add("hidden");
      els.done.classList.remove("hidden");
      return;
    }
    showStatus("تم حفظ البيانات. بقيت بيانات أخرى مطلوبة.", "ok");
    await load();
  } catch (error) {
    showStatus(error.code === "session_not_active" ? "هذا الرابط لم يعد صالحًا للاستخدام." : "تعذر حفظ البيانات. حاول مرة أخرى.");
  } finally {
    els.submitBtn.disabled = false;
  }
});

load();
