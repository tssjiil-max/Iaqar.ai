(() => {
  "use strict";

  function resolveWorkerBase() {
    if (window.IAQAR && window.IAQAR.resolveWorkerBase) {
      return String(window.IAQAR.resolveWorkerBase()).replace(/\/$/, "");
    }
    if (window.IAQAR && window.IAQAR.workerBase) {
      return String(window.IAQAR.workerBase).replace(/\/$/, "");
    }
    if (window.IAQAR && window.IAQAR.STAGING_WORKER) {
      return String(window.IAQAR.STAGING_WORKER).replace(/\/$/, "");
    }
    return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
  }

  const root = document.getElementById("adminRoot");
  const state = {
    page: "overview",
    officesTab: "pending",
    activityFilter: "",
    offices: [],
    cities: [],
    selectedOfficeId: null,
    shellMounted: false,
    filters: {
      q: "",
      city: "",
      sort: "newest",
      approvalStatus: "",
      accountStatus: "",
      licenseStatus: "",
      subscriptionStatus: "",
      activityLevel: ""
    }
  };

  const APPROVAL_LABELS = {
    pending: "بانتظار الاعتماد",
    approved: "معتمد",
    rejected: "مرفوض"
  };

  const ACCOUNT_LABELS = {
    active: "نشط",
    suspended: "موقوف"
  };

  const LICENSE_LABELS = {
    valid: "ساري",
    expiring: "ينتهي قريبًا",
    expired: "منتهي",
    unknown: "غير معروف"
  };

  const SUBSCRIPTION_LABELS = {
    trial: "تجريبي",
    active: "نشط",
    expiring: "ينتهي قريبًا",
    expired: "منتهي",
    none: "بدون اشتراك"
  };

  const AUDIT_ACTION_LABELS = {
    license_updated: "تحديث الترخيص",
    subscription_updated: "تحديث الاشتراك",
    office_suspended: "إيقاف المكتب",
    office_reactivated: "إعادة تفعيل المكتب",
    admin_note_added: "إضافة ملاحظة إدارية",
    office_approved: "اعتماد المكتب",
    office_rejected: "رفض المكتب"
  };

  const ACTIVITY_THRESHOLD_NOTE =
    "مستوى النشاط (من الخادم): نشط جدًا — ≥2 عملية منتجة خلال 7 أيام؛ نشط — ≥1 خلال 30 يوم؛ نشاط منخفض — دخول خلال 14 يوم بدون عمليات منتجة؛ غير نشط — بدون نشاط لأكثر من 30 يوم.";

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;" }[c]));
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
  }

  function labelFor(map, key) {
    return map[key] || key || "—";
  }

  function auditActionLabel(action) {
    return AUDIT_ACTION_LABELS[action] || action || "—";
  }

  function badgeClass(level) {
    if (level === "very_active" || level === "active") return "badge";
    if (level === "low") return "badge warn";
    return "badge danger";
  }

  function statusBadgeClass(kind, value) {
    if (kind === "approval") {
      if (value === "approved") return "badge";
      if (value === "pending") return "badge warn";
      return "badge danger";
    }
    if (kind === "account") {
      return value === "active" ? "badge" : "badge danger";
    }
    if (kind === "license" || kind === "subscription") {
      if (value === "valid" || value === "active" || value === "trial") return "badge";
      if (value === "expiring") return "badge warn";
      if (value === "expired") return "badge danger";
      return "badge muted";
    }
    return "badge muted";
  }

  function loadingHtml(message = "جاري التحميل…") {
    return `<div class="loading-block">${escapeHtml(message)}</div>`;
  }

  function emptyState(message = "لا توجد نتائج.") {
    return `<div class="empty-state">${escapeHtml(message)}</div>`;
  }

  async function api(path, options = {}) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("AUTH_REQUIRED");
    const token = await user.getIdToken();
    const response = await fetch(`${resolveWorkerBase()}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || "REQUEST_FAILED");
    return payload;
  }

  function navItems() {
    return [
      { id: "overview", label: "نظرة عامة" },
      { id: "offices", label: "إدارة المكاتب" },
      { id: "activity", label: "نشاط المكاتب" },
      { id: "subscriptions", label: "الاشتراكات والتراخيص" },
      { id: "audit", label: "السجل الإداري" }
    ];
  }

  function navHtml() {
    return navItems().map(item =>
      `<button type="button" data-page="${item.id}" class="${state.page === item.id ? "active" : ""}">${item.label}</button>`
    ).join("");
  }

  function destroyShell() {
    state.shellMounted = false;
  }

  function ensureShell() {
    if (state.shellMounted) return;
    root.innerHTML = `<div class="admin-shell">
      <header class="admin-header">
        <div class="admin-brand">
          <h1>IAQAR.AI</h1>
          <p>وحدة إدارة المنصة — للمسؤولين فقط</p>
        </div>
        <button type="button" class="btn secondary btn-compact" id="adminHeaderLogout">خروج</button>
      </header>
      <nav class="admin-nav" id="adminNav">${navHtml()}</nav>
      <main class="admin-main" id="adminMain"></main>
    </div>`;
    state.shellMounted = true;
    bindNav();
    const logout = root.querySelector("#adminHeaderLogout");
    if (logout) logout.onclick = async () => { await firebase.auth().signOut(); render(); };
  }

  function updateNavActive() {
    const nav = root.querySelector("#adminNav");
    if (!nav) return;
    nav.querySelectorAll("[data-page]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.page === state.page);
    });
  }

  function setMainContent(html) {
    const main = root.querySelector("#adminMain");
    if (main) main.innerHTML = html;
  }

  function bindNav() {
    root.querySelectorAll("[data-page]").forEach(btn => {
      btn.onclick = () => {
        state.page = btn.dataset.page;
        state.selectedOfficeId = null;
        render();
      };
    });
  }

  function loginView(message = "") {
    destroyShell();
    root.innerHTML = `<div class="admin-shell">
      <section class="admin-card login-card">
        <div class="admin-brand" style="margin-bottom:12px">
          <h1>IAQAR.AI</h1>
          <p>وحدة إدارة المنصة — للمسؤولين فقط</p>
        </div>
        <h2>دخول إدارة المنصة</h2>
        <p>هذا الدخول مخصص لمدير المنصة فقط.</p>
        <form id="adminLoginForm" class="filters">
          <input name="email" type="email" placeholder="البريد الإلكتروني" required autocomplete="username">
          <input name="password" type="password" placeholder="كلمة المرور" required autocomplete="current-password">
          <button class="btn primary" type="submit">دخول الإدارة</button>
        </form>
        <div class="status ${message ? "err" : "hidden"}">${escapeHtml(message)}</div>
        <p style="margin-top:12px;font-size:12px;color:var(--muted)"><a href="/">العودة للمنصة العامة</a></p>
      </section>
    </div>`;
    root.querySelector("#adminLoginForm").onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      try {
        await firebase.auth().signInWithEmailAndPassword(String(fd.get("email")).trim(), String(fd.get("password")));
        const token = await firebase.auth().currentUser.getIdTokenResult(true);
        if (token.claims.platformAdmin !== true && token.claims.admin !== true) {
          await firebase.auth().signOut();
          loginView("هذا الحساب ليس من إدارة المنصة.");
          return;
        }
        render();
      } catch (_) {
        loginView("بيانات إدارة المنصة غير صحيحة.");
      }
    };
  }

  function counter(label, value, primary = false) {
    return `<div class="counter${primary ? " primary" : ""}"><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  async function overviewPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    const data = await api("/admin/overview");
    const c = data.counters || {};
    setMainContent(`<section class="admin-card">
      <h2>نظرة عامة</h2>
      <div class="kpi-section">
        <h3>حالة المنصة</h3>
        <div class="admin-grid">
          ${counter("إجمالي المكاتب", c.totalOffices, true)}
          ${counter("طلبات الاعتماد", c.pendingApproval, true)}
          ${counter("المكاتب المعتمدة", c.approved, true)}
          ${counter("المكاتب النشطة", c.activeAccounts, true)}
        </div>
      </div>
      <div class="kpi-section">
        <h3>حالات إدارية</h3>
        <div class="admin-grid">
          ${counter("الموقوفة", c.suspended)}
          ${counter("اشتراكات منتهية", c.expiredSubscriptions)}
          ${counter("تراخيص منتهية", c.expiredLicenses)}
        </div>
      </div>
      <div class="kpi-section">
        <h3>نشاط المنصة</h3>
        <div class="admin-grid admin-grid-3">
          ${counter("نشطة آخر 7 أيام", c.activeLast7Days)}
          ${counter("غير نشطة 30 يوم", c.inactiveLast30Days)}
        </div>
      </div>
    </section>`);
  }

  function officeTabs() {
    const tabs = [
      { id: "pending", label: "طلبات جديدة" },
      { id: "approved", label: "المعتمدة" },
      { id: "suspended", label: "الموقوفة" },
      { id: "expired", label: "المنتهية" },
      { id: "rejected", label: "المرفوضة" },
      { id: "all", label: "كل المكاتب" }
    ];
    return `<div class="tabs">${tabs.map(t =>
      `<button type="button" data-tab="${t.id}" class="${state.officesTab === t.id ? "active" : ""}">${t.label}</button>`
    ).join("")}</div>`;
  }

  function officeBadges(o) {
    return `<div class="badge-row">
      <span class="${statusBadgeClass("approval", o.approvalStatus)}">${escapeHtml(labelFor(APPROVAL_LABELS, o.approvalStatus))}</span>
      <span class="${statusBadgeClass("account", o.accountStatus)}">${escapeHtml(labelFor(ACCOUNT_LABELS, o.accountStatus))}</span>
      <span class="${statusBadgeClass("subscription", o.subscriptionStatus)}">${escapeHtml(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus))}</span>
      <span class="${statusBadgeClass("license", o.licenseStatus)}">${escapeHtml(labelFor(LICENSE_LABELS, o.licenseStatus))}</span>
      <span class="${badgeClass(o.activityLevel)}">${escapeHtml(o.activityLevelLabel || labelFor({}, o.activityLevel))}</span>
    </div>`;
  }

  function officeCard(o) {
    return `<article class="office-card" data-office-id="${escapeHtml(o.officeId)}">
      <div class="office-card-head">
        <h3>${escapeHtml(o.officeName || o.officeId)}</h3>
      </div>
      <div class="office-meta">
        ${escapeHtml(o.city || "—")} · فال ${escapeHtml(o.falLicenseNumber || "—")}<br>
        آخر نشاط: ${formatDate(o.lastActivityAt)} · آخر دخول: ${formatDate(o.lastLoginAt)}
      </div>
      ${officeBadges(o)}
      <div class="actions">${officeActions(o)}</div>
    </article>`;
  }

  function officeActions(o) {
    const detail = `<button class="btn secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>`;
    if (state.page === "activity") {
      return detail;
    }
    if (o.approvalStatus === "pending") {
      return `${detail}
        <button class="btn primary" data-approve="${escapeHtml(o.officeId)}">اعتماد</button>
        <button class="btn danger" data-reject="${escapeHtml(o.officeId)}">رفض</button>`;
    }
    if (o.accountStatus === "suspended") {
      return `${detail}<button class="btn primary" data-reactivate="${escapeHtml(o.officeId)}">إعادة التفعيل</button>`;
    }
    if (o.approvalStatus === "approved") {
      return `${detail}
        <button class="btn secondary" data-activity="${escapeHtml(o.officeId)}">عرض النشاط</button>
        <button class="btn danger" data-suspend="${escapeHtml(o.officeId)}">إيقاف المكتب</button>
        <button class="btn secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
        <button class="btn secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
        <button class="btn secondary" data-note="${escapeHtml(o.officeId)}">إضافة ملاحظة</button>`;
    }
    return detail;
  }

  function officeFilterParams(extra = {}) {
    const params = {
      tab: state.officesTab === "all" ? "" : state.officesTab,
      q: state.filters.q,
      city: state.filters.city,
      sort: state.filters.sort,
      ...extra
    };
    if (state.officesTab === "all") {
      if (state.filters.approvalStatus) params.approvalStatus = state.filters.approvalStatus;
      if (state.filters.accountStatus) params.accountStatus = state.filters.accountStatus;
      if (state.filters.licenseStatus) params.licenseStatus = state.filters.licenseStatus;
      if (state.filters.subscriptionStatus) params.subscriptionStatus = state.filters.subscriptionStatus;
      if (state.filters.activityLevel) params.activityLevel = state.filters.activityLevel;
    }
    return new URLSearchParams(Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== "" && value != null)
    ));
  }

  async function loadOffices(extra = {}) {
    const data = await api(`/admin/offices?${officeFilterParams(extra).toString()}`);
    state.offices = data.offices || [];
    state.cities = data.cities || [];
    return data;
  }

  function filterSelect(id, label, value, options) {
    return `<select id="${id}" aria-label="${escapeHtml(label)}">
      <option value="">${escapeHtml(label)}</option>
      ${options.map(o => `<option value="${escapeHtml(o.value)}" ${value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
    </select>`;
  }

  function officeDimensionFilters() {
    return `${filterSelect("officeApprovalStatus", "حالة الاعتماد", state.filters.approvalStatus, [
      { value: "pending", label: "بانتظار الاعتماد" },
      { value: "approved", label: "معتمد" },
      { value: "rejected", label: "مرفوض" }
    ])}
    ${filterSelect("officeAccountStatus", "حالة الحساب", state.filters.accountStatus, [
      { value: "active", label: "نشط" },
      { value: "suspended", label: "موقوف" }
    ])}
    ${filterSelect("officeLicenseStatus", "حالة الترخيص", state.filters.licenseStatus, [
      { value: "valid", label: "ساري" },
      { value: "expiring", label: "ينتهي قريبًا" },
      { value: "expired", label: "منتهي" },
      { value: "unknown", label: "غير معروف" }
    ])}
    ${filterSelect("officeSubscriptionStatus", "حالة الاشتراك", state.filters.subscriptionStatus, [
      { value: "trial", label: "تجريبي" },
      { value: "active", label: "نشط" },
      { value: "expiring", label: "ينتهي قريبًا" },
      { value: "expired", label: "منتهي" },
      { value: "none", label: "بدون اشتراك" }
    ])}
    ${filterSelect("officeActivityLevel", "مستوى النشاط", state.filters.activityLevel, [
      { value: "very_active", label: "نشط جدًا" },
      { value: "active", label: "نشط" },
      { value: "low", label: "نشاط منخفض" },
      { value: "inactive", label: "غير نشط" }
    ])}`;
  }

  function activityFilters() {
    const levels = [
      { id: "", label: "كل المستويات" },
      { id: "very_active", label: "نشط جدًا" },
      { id: "active", label: "نشط" },
      { id: "low", label: "نشاط منخفض" },
      { id: "inactive", label: "غير نشط" }
    ];
    return `<div class="tabs">${levels.map(l =>
      `<button type="button" data-activity-filter="${l.id}" class="${state.activityFilter === l.id ? "active" : ""}">${l.label}</button>`
    ).join("")}</div>`;
  }

  function officesListHtml(list) {
    return list.length ? list.map(officeCard).join("") : emptyState();
  }

  function officesPageShellHtml() {
    const isActivity = state.page === "activity";
    return `<section class="admin-card">
      <h2>${isActivity ? "نشاط المكاتب" : "إدارة المكاتب"}</h2>
      ${isActivity ? `<p class="office-meta" style="margin-bottom:8px">${escapeHtml(ACTIVITY_THRESHOLD_NOTE)}</p>` : ""}
      ${isActivity ? activityFilters() : officeTabs()}
      <div class="filters">
        <input id="officeSearch" placeholder="بحث: اسم، مرخص له، جوال، فال" value="${escapeHtml(state.filters.q)}">
        <select id="officeCity"><option value="">كل المدن</option>
          ${state.cities.map(c => `<option value="${escapeHtml(c)}" ${state.filters.city === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        ${state.officesTab === "all" && !isActivity ? officeDimensionFilters() : ""}
        <select id="officeSort">
          <option value="newest">الأحدث تسجيلًا</option>
          <option value="oldest">الأقدم</option>
          <option value="last_login">آخر دخول</option>
          <option value="last_activity">آخر نشاط</option>
          <option value="most_active">الأكثر نشاطًا</option>
          <option value="least_active">الأقل نشاطًا</option>
          <option value="subscription_expiry">أقرب اشتراك للانتهاء</option>
          <option value="license_expiry">أقرب ترخيص للانتهاء</option>
        </select>
        <button type="button" class="btn secondary" id="officeApplyFilters" style="width:100%">تطبيق البحث والفلاتر</button>
      </div>
      <div id="officeList">${loadingHtml()}</div>
      <div id="officeStatus" class="status hidden"></div>
    </section>`;
  }

  async function officesPage(options = { refreshOnly: false }) {
    ensureShell();
    updateNavActive();
    const listNode = root.querySelector("#officeList");
    if (!options.refreshOnly || !listNode) {
      setMainContent(officesPageShellHtml());
      root.querySelector("#officeSort").value = state.filters.sort;
      bindOfficeFilters();
    } else {
      listNode.innerHTML = loadingHtml();
    }
    try {
      await loadOffices(state.page === "activity" ? { activityLevel: state.activityFilter } : {});
      const listEl = root.querySelector("#officeList");
      if (listEl) listEl.innerHTML = officesListHtml(state.offices);
      bindOfficeActions();
    } catch (error) {
      const listEl = root.querySelector("#officeList");
      if (listEl) listEl.innerHTML = `<div class="status err">${escapeHtml(error.message || "تعذر تحميل المكاتب.")}</div>`;
    }
  }

  function bindOfficeFilters() {
    root.querySelectorAll("[data-tab]").forEach(btn => {
      btn.onclick = () => { state.officesTab = btn.dataset.tab; officesPage({ refreshOnly: false }); };
    });
    root.querySelectorAll("[data-activity-filter]").forEach(btn => {
      btn.onclick = () => { state.activityFilter = btn.dataset.activityFilter; officesPage({ refreshOnly: true }); };
    });
    const search = root.querySelector("#officeSearch");
    const city = root.querySelector("#officeCity");
    const sort = root.querySelector("#officeSort");
    const apply = () => {
      state.filters.q = search.value.trim();
      state.filters.city = city.value;
      state.filters.sort = sort.value;
      if (state.officesTab === "all") {
        state.filters.approvalStatus = root.querySelector("#officeApprovalStatus")?.value || "";
        state.filters.accountStatus = root.querySelector("#officeAccountStatus")?.value || "";
        state.filters.licenseStatus = root.querySelector("#officeLicenseStatus")?.value || "";
        state.filters.subscriptionStatus = root.querySelector("#officeSubscriptionStatus")?.value || "";
        state.filters.activityLevel = root.querySelector("#officeActivityLevel")?.value || "";
      }
      officesPage({ refreshOnly: true });
    };
    search.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        apply();
      }
    });
    city.onchange = apply;
    sort.onchange = apply;
    root.querySelector("#officeApplyFilters")?.addEventListener("click", apply);
    [
      "#officeApprovalStatus",
      "#officeAccountStatus",
      "#officeLicenseStatus",
      "#officeSubscriptionStatus",
      "#officeActivityLevel"
    ].forEach(selector => root.querySelector(selector)?.addEventListener("change", apply));
  }

  function showStatus(msg, ok = false) {
    const node = root.querySelector("#officeStatus");
    if (!node) return;
    node.textContent = msg;
    node.className = `status ${ok ? "ok" : "err"}`;
  }

  function bindOfficeActions() {
    root.querySelectorAll("[data-detail]").forEach(btn => btn.onclick = () => showOfficeDetail(btn.dataset.detail));
    root.querySelectorAll("[data-activity]").forEach(btn => btn.onclick = () => showOfficeDetail(btn.dataset.activity, true));
    root.querySelectorAll("[data-approve]").forEach(btn => btn.onclick = async () => {
      try {
        const apps = await api("/admin/broker-applications");
        const app = (apps.applications || []).find(a => a.officeId === btn.dataset.approve);
        if (!app) {
          await api("/admin/office/action", { method: "POST", body: JSON.stringify({ action: "approve", officeId: btn.dataset.approve }) });
        } else {
          await api("/admin/broker-applications/action", {
            method: "POST",
            body: JSON.stringify({ applicationId: app.id, action: "approve", officeId: btn.dataset.approve })
          });
        }
        showStatus("تم اعتماد المكتب.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر الاعتماد."); }
    });
    root.querySelectorAll("[data-reject]").forEach(btn => btn.onclick = async () => {
      const reason = prompt("سبب الرفض:");
      if (!reason) return;
      try {
        const apps = await api("/admin/broker-applications");
        const app = (apps.applications || []).find(a => a.officeId === btn.dataset.reject);
        if (app) {
          await api("/admin/broker-applications/action", {
            method: "POST",
            body: JSON.stringify({ applicationId: app.id, action: "reject", officeId: btn.dataset.reject, reason })
          });
        } else {
          await api("/admin/office/action", {
            method: "POST",
            body: JSON.stringify({ action: "reject", officeId: btn.dataset.reject, reason })
          });
        }
        showStatus("تم رفض الطلب.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر الرفض."); }
    });
    root.querySelectorAll("[data-suspend]").forEach(btn => btn.onclick = async () => {
      const reason = prompt("سبب الإيقاف:");
      if (!reason) return;
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({ action: "suspend", officeId: btn.dataset.suspend, reason })
        });
        showStatus("تم إيقاف المكتب.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر الإيقاف."); }
    });
    root.querySelectorAll("[data-reactivate]").forEach(btn => btn.onclick = async () => {
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({ action: "reactivate", officeId: btn.dataset.reactivate })
        });
        showStatus("تمت إعادة التفعيل.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر إعادة التفعيل."); }
    });
    root.querySelectorAll("[data-subscription]").forEach(btn => btn.onclick = async () => {
      const status = prompt("حالة الاشتراك: trial, active, expiring, expired, none");
      const expires = prompt("تاريخ انتهاء الاشتراك (YYYY-MM-DD) أو اتركه فارغًا");
      if (!status) return;
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({
            action: "update_subscription",
            officeId: btn.dataset.subscription,
            subscriptionStatus: status,
            subscriptionExpiresAt: expires || undefined
          })
        });
        showStatus("تم تحديث الاشتراك.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر التحديث."); }
    });
    root.querySelectorAll("[data-license]").forEach(btn => btn.onclick = async () => {
      const number = prompt("رقم فال");
      const expires = prompt("تاريخ انتهاء الترخيص (YYYY-MM-DD)");
      if (!number && !expires) return;
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({
            action: "update_license",
            officeId: btn.dataset.license,
            falLicenseNumber: number || undefined,
            falLicenseExpiresAt: expires || undefined
          })
        });
        showStatus("تم تحديث الترخيص.", true);
        officesPage({ refreshOnly: true });
      } catch (e) { showStatus(e.message || "تعذر التحديث."); }
    });
    root.querySelectorAll("[data-note]").forEach(btn => btn.onclick = async () => {
      const note = prompt("ملاحظة إدارية:");
      if (!note) return;
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({ action: "add_note", officeId: btn.dataset.note, note })
        });
        showStatus("تمت إضافة الملاحظة.", true);
      } catch (e) { showStatus(e.message || "تعذر الإضافة."); }
    });
  }

  function auditEntryHtml(a) {
    const label = auditActionLabel(a.action);
    return `<div class="detail-row">
      ${formatDate(a.performedAt)} — <span class="audit-action">${escapeHtml(label)}</span>
      <span class="audit-tech">(${escapeHtml(a.action)})</span>
      ${a.reason ? `<br>${escapeHtml(a.reason)}` : ""}
    </div>`;
  }

  async function showOfficeDetail(officeId, focusActivity = false) {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml("جاري تحميل تفاصيل المكتب…"));
    const data = await api(`/admin/office?officeId=${encodeURIComponent(officeId)}`);
    const o = data.office;
    const s = o.activitySummary || {};
    setMainContent(`<section class="admin-card">
      <button class="btn secondary" id="backToList">← رجوع</button>
      <h2>${escapeHtml(o.officeName || officeId)}</h2>
      <div class="badge-row">
        <span class="${statusBadgeClass("approval", o.approvalStatus)}">${escapeHtml(labelFor(APPROVAL_LABELS, o.approvalStatus))}</span>
        <span class="${statusBadgeClass("account", o.accountStatus)}">${escapeHtml(labelFor(ACCOUNT_LABELS, o.accountStatus))}</span>
        <span class="${badgeClass(o.activityLevel)}">${escapeHtml(o.activityLevelLabel)}</span>
      </div>
      <div class="detail-section"><h4>بيانات المكتب</h4>
        <div class="detail-row">المرخص له: ${escapeHtml(o.licenseeName)}<br>جوال: ${escapeHtml(o.phone)}<br>بريد: ${escapeHtml(o.email)}<br>مدينة: ${escapeHtml(o.city)}<br>officeId: ${escapeHtml(o.officeId)}</div></div>
      <div class="detail-section"><h4>الاعتماد</h4>
        <div class="detail-row">حالة: ${escapeHtml(labelFor(APPROVAL_LABELS, o.approvalStatus))}<br>تسجيل: ${formatDate(o.registrationSubmittedAt)}<br>اعتماد: ${formatDate(o.approvedAt)}<br>بواسطة: ${escapeHtml(o.approvedBy || "—")}</div></div>
      <div class="detail-section"><h4>الترخيص</h4>
        <div class="detail-row">فال: ${escapeHtml(o.falLicenseNumber)}<br>إصدار: ${formatDate(o.falLicenseIssuedAt)}<br>انتهاء: ${formatDate(o.falLicenseExpiresAt)}<br>حالة: ${escapeHtml(labelFor(LICENSE_LABELS, o.licenseStatus))}</div></div>
      <div class="detail-section"><h4>الاشتراك</h4>
        <div class="detail-row">حالة: ${escapeHtml(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus))}<br>بداية: ${formatDate(o.subscriptionStartedAt)}<br>انتهاء: ${formatDate(o.subscriptionExpiresAt)}<br>متبقي: ${o.subscriptionDaysRemaining ?? "—"} يوم</div></div>
      <div class="detail-section"><h4>الحساب</h4>
        <div class="detail-row">حالة: ${escapeHtml(labelFor(ACCOUNT_LABELS, o.accountStatus))}<br>آخر دخول: ${formatDate(o.lastLoginAt)}<br>آخر نشاط: ${formatDate(o.lastActivityAt)}<br>مستوى النشاط: ${escapeHtml(o.activityLevelLabel)}</div></div>
      <div class="detail-section ${focusActivity ? "" : ""}"><h4>نشاط المكتب</h4>
        <p class="office-meta" style="margin-bottom:6px">${escapeHtml(ACTIVITY_THRESHOLD_NOTE)}</p>
        <div class="detail-row">دخول 7d/30d: ${s.loginCount7d}/${s.loginCount30d}<br>فرص 7d/30d: ${s.opportunitiesCreated7d}/${s.opportunitiesCreated30d}<br>فرص نشطة: ${s.activeOpportunitiesCount}<br>مطابقات مراجعة 30d: ${s.matchesReviewed30d}<br>عمليات مكتملة 30d: ${s.completedOperations30d}<br>عروض ملاك 30d: ${s.publicOwnerSubmissions30d}<br>طلبات عملاء 30d: ${s.publicClientSubmissions30d}</div></div>
      <div class="detail-section"><h4>ملاحظات إدارية</h4>
        ${(data.notes || []).map(n => `<div class="detail-row">${formatDate(n.createdAt)} — ${escapeHtml(n.note)}</div>`).join("") || '<div class="detail-row">لا توجد ملاحظات.</div>'}
      </div>
      <div class="detail-section"><h4>سجل إداري للمكتب</h4>
        ${(data.audit || []).map(auditEntryHtml).join("") || '<div class="detail-row">لا يوجد سجل.</div>'}
      </div>
    </section>`);
    root.querySelector("#backToList").onclick = () => render();
  }

  async function subscriptionsPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    await loadOffices({ tab: "approved" });
    const list = state.offices;
    setMainContent(`<section class="admin-card">
      <h2>الاشتراكات والتراخيص</h2>
      <div id="officeList">${list.length ? list.map(o => `<article class="office-card">
        <div class="office-card-head"><h3>${escapeHtml(o.officeName)}</h3></div>
        <div class="office-meta">اشتراك: ${escapeHtml(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus))} · ينتهي ${formatDate(o.subscriptionExpiresAt)}
        <br>ترخيص: ${escapeHtml(labelFor(LICENSE_LABELS, o.licenseStatus))} · ينتهي ${formatDate(o.falLicenseExpiresAt)}</div>
        <div class="badge-row">
          ${o.subscriptionStatus === "expired" || o.licenseStatus === "expired" ? '<span class="badge danger">منتهي</span>' : ""}
          ${o.subscriptionStatus === "expiring" || o.licenseStatus === "expiring" ? '<span class="badge warn">ينتهي خلال 30 يوم</span>' : ""}
        </div>
        <div class="actions">
          <button class="btn secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
          <button class="btn secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
          <button class="btn secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>
        </div>
      </article>`).join("") : emptyState("لا توجد مكاتب معتمدة.")}</div>
    </section>`);
    bindOfficeActions();
  }

  function globalAuditEntryHtml(e) {
    const label = auditActionLabel(e.action);
    return `<article class="office-card">
      <div class="audit-action">${escapeHtml(label)}</div>
      <div class="audit-tech">${escapeHtml(e.action)}</div>
      <div class="office-meta" style="margin-top:6px">
        مكتب: ${escapeHtml(e.officeId || "—")}<br>
        بواسطة: ${escapeHtml(e.performedBy)} · ${formatDate(e.performedAt)}<br>
        ${escapeHtml(e.reason || "")}
      </div>
    </article>`;
  }

  async function auditPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    const data = await api("/admin/audit-log?limit=150");
    const entries = data.entries || [];
    setMainContent(`<section class="admin-card">
      <h2>السجل الإداري</h2>
      ${entries.length ? entries.map(globalAuditEntryHtml).join("") : emptyState("لا يوجد سجل.")}
    </section>`);
  }

  function deniedView() {
    destroyShell();
    root.innerHTML = `<div class="admin-shell">
      <section class="admin-card login-card">
        <h2>الوصول مرفوض</h2>
        <p>هذا الحساب ليس من إدارة المنصة. لا يتم تحميل بيانات الإدارة.</p>
        <button class="btn secondary" id="adminLogout">تسجيل الخروج</button>
        <p style="margin-top:12px"><a href="/">العودة للمنصة العامة</a></p>
      </section>
    </div>`;
    root.querySelector("#adminLogout").onclick = async () => { await firebase.auth().signOut(); render(); };
  }

  async function render() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      destroyShell();
      root.innerHTML = '<div class="admin-shell"><section class="admin-card"><p>تعذر بدء المنصة. حدّث الصفحة.</p></section></div>';
      return;
    }
    const user = firebase.auth().currentUser;
    if (!user) {
      loginView();
      return;
    }
    try {
      const token = await user.getIdTokenResult(true);
      if (token.claims.platformAdmin !== true && token.claims.admin !== true) {
        deniedView();
        return;
      }
    } catch (_) {
      deniedView();
      return;
    }
    try {
      if (state.page === "overview") await overviewPage();
      else if (state.page === "offices") await officesPage({ refreshOnly: false });
      else if (state.page === "activity") await officesPage({ refreshOnly: false });
      else if (state.page === "subscriptions") await subscriptionsPage();
      else if (state.page === "audit") await auditPage();
      else await overviewPage();
    } catch (error) {
      ensureShell();
      updateNavActive();
      setMainContent(`<section class="admin-card"><div class="status err">${escapeHtml(error.message || "تعذر تحميل لوحة الإدارة.")}</div></section>`);
    }
  }

  firebase.auth().onAuthStateChanged(() => render());
  render();
})();
