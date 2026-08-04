(() => {
  "use strict";

  const COOPERATION_LABELS = Object.freeze({
    NOT_SHARED: "لم تُشارك",
    PENDING_APPROVAL: "بانتظار الموافقة",
    ACTIVE: "تعاون نشط",
    REJECTED: "رُفض الطلب",
    ENDED: "انتهى التعاون"
  });
  const elements = {};
  let lastTrigger = null;

  function officeRuntime() {
    return window.IAQAR && window.IAQAR.office ? window.IAQAR.office : null;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(value) {
    const date = value && typeof value.toDate === "function" ? value.toDate() : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(date);
  }

  function setStatus(state, message) {
    elements.status.dataset.state = state;
    elements.status.textContent = message;
  }

  function opportunityTitle(data) {
    const kind = data.opportunityKind === "OFFER" || data.kind === "owner_offer" ? "عرض" : "طلب";
    return [kind, data.propertyType].filter(Boolean).join(" — ") || "فرصة عقارية";
  }

  function render(snapshot) {
    if (snapshot.empty) {
      elements.list.innerHTML = "";
      setStatus("success", "لا توجد فرص محفوظة في بنك هذا المكتب.");
      return;
    }
    elements.list.innerHTML = snapshot.docs.map(documentSnapshot => {
      const data = documentSnapshot.data() || {};
      const location = [data.city, data.district].filter(Boolean).join("، ");
      const price = data.price || data.priceMax || data.budgetMax;
      const cooperation = COOPERATION_LABELS[data.cooperationState] || COOPERATION_LABELS.NOT_SHARED;
      return `<article class="bank-record">
        <h3>${escapeHtml(opportunityTitle(data))}</h3>
        <p>${escapeHtml(location || "الموقع غير مكتمل")}${price ? ` — ${escapeHtml(Number(price).toLocaleString("ar-SA"))} ر.س` : ""}</p>
        <p>تاريخ الإضافة: ${escapeHtml(formatDate(data.createdAt))} — حالة التعاون: ${escapeHtml(cooperation)}</p>
      </article>`;
    }).join("");
    setStatus("success", `تم تحميل ${snapshot.size} من فرص المكتب.`);
  }

  async function loadBank() {
    const runtime = officeRuntime();
    const user = window.firebase && firebase.auth ? firebase.auth().currentUser : null;
    elements.list.innerHTML = "";
    setStatus("loading", "جارٍ تحميل فرص المكتب…");
    if (!runtime || !runtime.refs || !runtime.refs.opportunities || !user) {
      setStatus("error", "سجل دخول حساب المكتب لفتح بنك الفرص.");
      return;
    }
    try {
      const snapshot = await runtime.refs.opportunities.orderBy("createdAt", "desc").limit(100).get();
      render(snapshot);
    } catch (error) {
      console.warn("[iaqar] opportunity bank load failed", error);
      setStatus("error", "تعذر تحميل بنك الفرص. تحقق من الاتصال وصلاحية المكتب.");
    }
  }

  function openBank(event) {
    lastTrigger = event.currentTarget;
    const settings = document.getElementById("officeSettings");
    if (settings) settings.hidden = true;
    elements.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    elements.close.focus();
    loadBank();
  }

  function closeBank() {
    elements.overlay.hidden = true;
    document.body.style.overflow = "";
    if (lastTrigger) lastTrigger.focus();
    lastTrigger = null;
  }

  function init() {
    elements.entry = document.getElementById("opportunityBankEntry");
    elements.overlay = document.getElementById("opportunityBank");
    elements.close = document.getElementById("opportunityBankClose");
    elements.status = document.getElementById("opportunityBankStatus");
    elements.list = document.getElementById("opportunityBankList");
    if (!elements.entry || !elements.overlay) return;
    elements.entry.addEventListener("click", openBank);
    elements.close.addEventListener("click", closeBank);
    elements.overlay.addEventListener("click", event => {
      if (event.target === elements.overlay) closeBank();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !elements.overlay.hidden) closeBank();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
