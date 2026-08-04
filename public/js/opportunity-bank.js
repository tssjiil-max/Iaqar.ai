/*
 * IAQAR.AI — بنك الفرص (المرحلة 1: عرض قراءة حقيقي).
 * يعرض فرص المكتب المحفوظة فعلًا من مجموعتي owners وclients فقط:
 * نوع الفرصة، نوع العقار، المدينة/الحي، السعر/الميزانية، تاريخ الإضافة،
 * وحالة التعاون. لا سجلات داخلية ولا درجات ثقة ولا بيانات تجريبية.
 * التحرير والأرشفة والمشاركة بنطاقات تُبنى في المرحلة 3.
 */
(() => {
  "use strict";

  const utils = () => window.IAQAR && window.IAQAR.officeUtils;
  const office = () => window.IAQAR && window.IAQAR.office;
  const FETCH_LIMIT = 60;

  const el = {};
  let lastItems = [];

  function toast(message) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function authUser() {
    try {
      return window.firebase && firebase.auth ? firebase.auth().currentUser : null;
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addedLabel(value) {
    const date = toDate(value);
    if (!date) return "غير محدد";
    return date.toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
  }

  function setStatus(text, state = "") {
    if (!el.status) return;
    el.status.hidden = !text;
    el.status.textContent = text || "";
    el.status.className = `bank-status${state ? ` ${state}` : ""}`;
  }

  function openBank() {
    el.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    void loadItems();
  }

  function closeBank() {
    el.overlay.hidden = true;
    const settings = document.getElementById("officeSettings");
    document.body.style.overflow = settings && !settings.hidden ? "hidden" : "";
  }

  async function fetchCollection(name) {
    const runtime = office();
    const snapshot = await runtime.db.collection("offices").doc(runtime.officeId)
      .collection(name)
      .orderBy("createdAt", "desc")
      .limit(FETCH_LIMIT)
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }));
  }

  async function loadItems() {
    const api = utils();
    const runtime = office();
    el.list.innerHTML = "";
    if (!runtime || !runtime.db || !runtime.officeId || runtime.officeId === "platform") {
      setStatus("افتح رابط مكتبك وسجل دخول مدير المكتب لعرض بنك الفرص الخاص بمكتبك.", "error");
      return;
    }
    if (!authUser()) {
      setStatus("سجل دخول مدير المكتب لعرض بنك الفرص الخاص بمكتبك.", "error");
      return;
    }
    setStatus("جارٍ تحميل فرص المكتب المحفوظة...");
    try {
      const [owners, clients] = await Promise.all([
        fetchCollection("owners"),
        fetchCollection("clients")
      ]);
      const items = [
        ...owners.map(entry => api.bankItemFromRecord("owner", entry.id, entry.data)),
        ...clients.map(entry => api.bankItemFromRecord("client", entry.id, entry.data))
      ].sort((a, b) => {
        const timeA = (toDate(a.addedAt) || new Date(0)).getTime();
        const timeB = (toDate(b.addedAt) || new Date(0)).getTime();
        return timeB - timeA;
      });
      lastItems = items;
      if (!items.length) {
        setStatus("لا توجد فرص محفوظة بعد. تُحفظ العروض والطلبات الواردة هنا تلقائيًا وتبقى جاهزة للمطابقة المستقبلية.");
        return;
      }
      setStatus("");
      renderItems(items);
    } catch (error) {
      console.warn("[iaqar] opportunity bank", error);
      const denied = String(error && error.code || "").includes("permission-denied");
      setStatus(denied ? "حسابك لا يملك صلاحية عرض فرص هذا المكتب." : "تعذر تحميل بنك الفرص الآن. تحقق من الاتصال وأعد المحاولة.", "error");
    }
  }

  function renderItems(items) {
    const api = utils();
    el.list.innerHTML = items.map(item => {
      const location = [item.district, item.city].filter(Boolean).join(" — ") || "الموقع غير محدد";
      const contact = item.contactName ? ` — ${escapeHtml(item.contactName)}` : "";
      return `
      <article class="bank-item" data-bank-id="${escapeHtml(item.id)}">
        <div class="bank-item-head">
          <span class="bank-kind ${escapeHtml(item.kind)}">${escapeHtml(item.kindLabel)}</span>
          <span class="bank-item-meta">${escapeHtml(addedLabel(item.addedAt))}</span>
        </div>
        <h3 class="bank-item-title">${escapeHtml(item.propertyType)}${contact}</h3>
        <div class="bank-item-meta">${escapeHtml(location)}<br>${escapeHtml(item.priceLabel)}</div>
        <div class="bank-item-foot">
          <span>تاريخ الإضافة: ${escapeHtml(addedLabel(item.addedAt))}</span>
          <span class="bank-coop">${escapeHtml(api.cooperationStatusLabel(item.cooperationStatus))}</span>
        </div>
      </article>`;
    }).join("");
  }

  function init() {
    el.openBtn = document.getElementById("opportunityBankBtn");
    el.overlay = document.getElementById("opportunityBank");
    el.closeBtn = document.getElementById("opportunityBankClose");
    el.status = document.getElementById("opportunityBankStatus");
    el.list = document.getElementById("opportunityBankList");
    if (!el.openBtn || !el.overlay) return;

    el.openBtn.addEventListener("click", openBank);
    el.closeBtn.addEventListener("click", closeBank);
    el.overlay.addEventListener("click", event => {
      if (event.target === el.overlay) closeBank();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !el.overlay.hidden) closeBank();
    });
    window.addEventListener("iaqar:open-opportunity-bank", openBank);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
