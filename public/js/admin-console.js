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
  const modalHost = document.getElementById("adminModalHost");
  const state = {
    page: "overview",
    officesTab: "all",
    activityFilter: "",
    offices: [],
    cities: [],
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
    office_rejected: "رفض المكتب",
    application_approved: "اعتماد المكتب",
    application_rejected: "رفض المكتب"
  };

  const PAGE_SUBTITLES = {
    overview: "ملخص حالة المنصة والتنبيهات الإدارية",
    offices: "بحث وإدارة المكاتب والاعتمادات",
    activity: "متابعة نشاط المكاتب على المنصة",
    subscriptions: "متابعة الاشتراكات والتراخيص",
    audit: "سجل الإجراءات الإدارية"
  };

  const ACTIVITY_THRESHOLD_NOTE =
    "مستوى النشاط: نشط جدًا — ≥2 عملية منتجة خلال 7 أيام؛ نشط — ≥1 خلال 30 يوم؛ نشاط منخفض — دخول خلال 14 يوم بدون عمليات؛ غير نشط — بدون نشاط لأكثر من 30 يوم.";

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
    return AUDIT_ACTION_LABELS[action] || "إجراء إداري";
  }

  function compositeStatus(o) {
    if (o.approvalStatus === "pending") return { label: "بانتظار الاعتماد", tone: "warn" };
    if (o.approvalStatus === "rejected") return { label: "مرفوض", tone: "danger" };
    if (o.accountStatus === "suspended") return { label: "موقوف", tone: "danger" };
    if (o.subscriptionStatus === "expired" || o.licenseStatus === "expired") return { label: "منتهي", tone: "danger" };
    if (o.approvalStatus === "approved" && o.accountStatus === "active") return { label: "نشط", tone: "ok" };
    return { label: labelFor(APPROVAL_LABELS, o.approvalStatus), tone: "muted" };
  }

  function statusChip(label, tone = "muted") {
    return `<span class="status-chip ${tone}" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
  }

  function loadingHtml(message = "جاري التحميل…") {
    return `<div class="loading-block" role="status" aria-live="polite">${escapeHtml(message)}</div>`;
  }

  function emptyState(title = "لا توجد نتائج", hint = "جرّب تغيير البحث أو الفلاتر.") {
    return `<div class="admin-empty-state" role="status"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(hint)}</span></div>`;
  }

  async function api(path, options = {}) {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("يلزم تسجيل الدخول");
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
    if (!response.ok) throw new Error(payload.message || payload.error || "تعذر تنفيذ الطلب");
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

  function navButtons() {
    const items = navItems();
    return items.map((item, index) => {
      const isLastOdd = items.length % 2 === 1 && index === items.length - 1;
      const extraClass = isLastOdd ? " nav-span-center" : "";
      const active = state.page === item.id ? " active" : "";
      return `<button type="button" data-page="${item.id}" class="admin-button${extraClass}${active}" aria-current="${state.page === item.id ? "page" : "false"}">${item.label}</button>`;
    }).join("");
  }

  function pageHero(title, subtitle = "") {
    return `<div class="page-hero admin-card">
      <h2>${escapeHtml(title)}</h2>
      ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
    </div>`;
  }

  function destroyShell() {
    state.shellMounted = false;
    closeModal();
  }

  function ensureShell() {
    if (state.shellMounted) return;
    root.innerHTML = `<div class="admin-shell">
      <header class="admin-header">
        <div class="admin-header-text">
          <h1>لوحة إدارة IAQAR.AI</h1>
          <p>وحدة إدارة المنصة – للمسؤولين فقط</p>
        </div>
        <button type="button" class="admin-button admin-button-secondary" id="adminHeaderLogout" aria-label="تسجيل الخروج">خروج</button>
      </header>
      <nav class="admin-nav" id="adminNav" aria-label="تنقل الإدارة">${navButtons()}</nav>
      <main class="admin-main" id="adminMain" role="main"></main>
    </div>`;
    state.shellMounted = true;
    bindNav();
    root.querySelector("#adminHeaderLogout").onclick = async () => {
      await firebase.auth().signOut();
      render();
    };
  }

  function updateNavActive() {
    root.querySelectorAll("[data-page]").forEach(btn => {
      const active = btn.dataset.page === state.page;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
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
        render();
      };
    });
  }

  let modalKeyHandler = null;

  function closeModal() {
    if (modalKeyHandler) {
      document.removeEventListener("keydown", modalKeyHandler);
      modalKeyHandler = null;
    }
    if (modalHost) modalHost.innerHTML = "";
  }

  function showModal({ title, message, confirmLabel = "تأكيد", cancelLabel = "إلغاء", danger = false, requireInput, inputLabel, inputPlaceholder, onConfirm }) {
    closeModal();
    const inputId = "adminModalInput";
    modalHost.innerHTML = `<div class="modal-overlay" role="presentation">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="adminModalTitle">
        <h3 id="adminModalTitle">${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        ${requireInput ? `<label for="${inputId}" class="detail-row" style="display:block;margin-bottom:6px">${escapeHtml(inputLabel || "التفاصيل")}</label>
          <textarea id="${inputId}" class="form-stack" rows="3" placeholder="${escapeHtml(inputPlaceholder || "")}" aria-required="true"></textarea>` : ""}
        <div class="modal-actions">
          <button type="button" class="admin-button ${danger ? "admin-button-danger" : "admin-button-primary"}" id="adminModalConfirm">${escapeHtml(confirmLabel)}</button>
          <button type="button" class="admin-button admin-button-secondary" id="adminModalCancel">${escapeHtml(cancelLabel)}</button>
        </div>
      </div>
    </div>`;
    const overlay = modalHost.querySelector(".modal-overlay");
    const input = modalHost.querySelector(`#${inputId}`);
    const confirmBtn = modalHost.querySelector("#adminModalConfirm");
    const cancelBtn = modalHost.querySelector("#adminModalCancel");
    cancelBtn.onclick = closeModal;
    overlay.onclick = e => { if (e.target === overlay) closeModal(); };
    modalKeyHandler = e => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", modalKeyHandler);
    confirmBtn.onclick = async () => {
      const value = requireInput ? String(input?.value || "").trim() : "";
      if (requireInput && !value) {
        if (input) input.focus();
        return;
      }
      confirmBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        await onConfirm(value);
        closeModal();
      } catch (err) {
        confirmBtn.disabled = false;
        cancelBtn.disabled = false;
        alert(err.message || "تعذر تنفيذ الإجراء");
      }
    };
    (input || confirmBtn).focus();
  }

  function loginView(message = "") {
    destroyShell();
    root.innerHTML = `<div class="admin-shell login-wrap">
      <section class="admin-card">
        <h2>دخول إدارة المنصة</h2>
        <p class="login-lead">هذا الدخول مخصص لمدير المنصة فقط.</p>
        <form id="adminLoginForm" class="admin-form-grid">
          <input class="admin-field" name="email" type="email" placeholder="البريد الإلكتروني" required autocomplete="username" aria-label="البريد الإلكتروني">
          <input class="admin-field" name="password" type="password" placeholder="كلمة المرور" required autocomplete="current-password" aria-label="كلمة المرور">
          <button class="admin-button admin-button-primary block" type="submit">دخول الإدارة</button>
        </form>
        <div class="status ${message ? "err" : "hidden"}" role="alert">${escapeHtml(message)}</div>
        <p class="login-back"><a href="/">العودة للمنصة العامة</a></p>
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

  function kpiCard(label, value) {
    return `<div class="kpi-card"><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function buildAlerts(counters, offices) {
    const alerts = [];
    if (counters.pendingApproval > 0) {
      alerts.push({ label: "طلبات اعتماد جديدة", count: counters.pendingApproval, page: "offices", tab: "pending" });
    }
    const expiringLicenses = offices.filter(o => o.licenseStatus === "expiring").length;
    const expiringSubs = offices.filter(o => o.subscriptionStatus === "expiring").length;
    if (expiringLicenses > 0) {
      alerts.push({ label: "تراخيص قاربت على الانتهاء", count: expiringLicenses, page: "subscriptions" });
    }
    if (counters.expiredLicenses > 0) {
      alerts.push({ label: "تراخيص منتهية", count: counters.expiredLicenses, page: "subscriptions" });
    }
    if (counters.expiredSubscriptions > 0) {
      alerts.push({ label: "اشتراكات منتهية", count: counters.expiredSubscriptions, page: "subscriptions" });
    }
    if (expiringSubs > 0) {
      alerts.push({ label: "اشتراكات قاربت على الانتهاء", count: expiringSubs, page: "subscriptions" });
    }
    if (counters.suspended > 0) {
      alerts.push({ label: "مكاتب موقوفة", count: counters.suspended, page: "offices", tab: "suspended" });
    }
    if (counters.inactiveLast30Days > 0) {
      alerts.push({ label: "مكاتب غير نشطة (30 يوم)", count: counters.inactiveLast30Days, page: "activity", filter: "inactive" });
    }
    return alerts;
  }

  async function overviewPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    const [overview, officesData] = await Promise.all([
      api("/admin/overview"),
      api("/admin/offices")
    ]);
    const c = overview.counters || {};
    const offices = officesData.offices || [];
    const licenseAttention = offices.filter(o => o.licenseStatus === "expiring" || o.licenseStatus === "expired").length;
    const alerts = buildAlerts(c, offices);
    setMainContent(`${pageHero("نظرة عامة", PAGE_SUBTITLES.overview)}
      <div class="kpi-row" role="group" aria-label="مؤشرات المنصة">
        ${kpiCard("إجمالي المكاتب", c.totalOffices)}
        ${kpiCard("النشطة", c.activeAccounts)}
        ${kpiCard("المعتمدة", c.approved)}
        ${kpiCard("بانتظار الاعتماد", c.pendingApproval)}
        ${kpiCard("الموقوفة", c.suspended)}
        ${kpiCard("تحتاج متابعة", licenseAttention)}
      </div>
      <section class="admin-card">
        <h3 class="section-title">مركز تنبيهات الإدارة</h3>
        ${alerts.length ? `<div class="alert-list">${alerts.map(a =>
          `<div class="alert-item">
            <span>${escapeHtml(a.label)}</span>
            <div class="actions-inline">
              <strong>${a.count}</strong>
              <button type="button" class="admin-button admin-button-secondary" data-alert-nav="${escapeHtml(a.page)}" data-alert-tab="${escapeHtml(a.tab || "")}" data-alert-filter="${escapeHtml(a.filter || "")}">عرض</button>
            </div>
          </div>`
        ).join("")}</div>` : `<div class="alert-ok">المنصة تعمل بشكل طبيعي — لا توجد إجراءات مطلوبة</div>`}
      </section>`);
    root.querySelectorAll("[data-alert-nav]").forEach(btn => {
      btn.onclick = () => {
        state.page = btn.dataset.alertNav;
        if (btn.dataset.alertTab) state.officesTab = btn.dataset.alertTab;
        if (btn.dataset.alertFilter) state.activityFilter = btn.dataset.alertFilter;
        render();
      };
    });
  }

  function officeFilterParams(extra = {}) {
    const params = {
      tab: state.officesTab === "all" ? "" : state.officesTab,
      q: state.filters.q,
      city: state.filters.city,
      sort: state.filters.sort,
      ...extra
    };
    if (state.officesTab === "all" || state.page === "offices") {
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

  function officeTabs() {
    const tabs = [
      { id: "all", label: "كل المكاتب" },
      { id: "pending", label: "بانتظار الاعتماد" },
      { id: "approved", label: "المعتمدة" },
      { id: "suspended", label: "الموقوفة" },
      { id: "expired", label: "المنتهية" },
      { id: "rejected", label: "المرفوضة" }
    ];
    return `<div class="admin-filter-group tabs" role="tablist">${tabs.map(t =>
      `<button type="button" role="tab" data-tab="${t.id}" class="${state.officesTab === t.id ? "active" : ""}" aria-selected="${state.officesTab === t.id}">${t.label}</button>`
    ).join("")}</div>`;
  }

  function filterField(id, label, value, options, className = "admin-select") {
    return `<select id="${id}" class="${className}" aria-label="${escapeHtml(label)}">
      <option value="">${escapeHtml(label)}</option>
      ${options.map(o => `<option value="${escapeHtml(o.value)}" ${value === o.value ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
    </select>`;
  }

  function controlBarHtml(includeTabs = true) {
    return `${includeTabs ? officeTabs() : ""}
      <div class="admin-form-grid control-bar filters-2col filters-desktop">
        <input id="officeSearch" class="admin-field field-span-full" type="search" placeholder="بحث عن اسم المكتب أو المرخص له" value="${escapeHtml(state.filters.q)}" aria-label="بحث المكاتب">
        ${filterField("officeCity", "كل المدن", state.filters.city, state.cities.map(c => ({ value: c, label: c })))}
        ${filterField("officeApprovalStatus", "حالة الاعتماد", state.filters.approvalStatus, [
          { value: "pending", label: "بانتظار الاعتماد" },
          { value: "approved", label: "معتمد" },
          { value: "rejected", label: "مرفوض" }
        ])}
        ${filterField("officeLicenseStatus", "حالة الترخيص", state.filters.licenseStatus, [
          { value: "valid", label: "ساري" },
          { value: "expiring", label: "ينتهي قريبًا" },
          { value: "expired", label: "منتهي" }
        ])}
        <select id="officeSort" class="admin-select" aria-label="ترتيب النتائج">
          <option value="newest">الأحدث تسجيلًا</option>
          <option value="oldest">الأقدم</option>
          <option value="last_login">آخر دخول</option>
          <option value="last_activity">آخر نشاط</option>
          <option value="most_active">الأكثر نشاطًا</option>
          <option value="least_active">الأقل نشاطًا</option>
          <option value="subscription_expiry">أقرب اشتراك للانتهاء</option>
          <option value="license_expiry">أقرب ترخيص للانتهاء</option>
        </select>
        <button type="button" class="admin-button admin-button-secondary field-span-action block" id="officeApplyFilters">تطبيق البحث والفلاتر</button>
      </div>`;
  }

  function officeTableRow(o) {
    const status = compositeStatus(o);
    return `<tr>
      <td><strong>${escapeHtml(o.officeName || "—")}</strong></td>
      <td>${escapeHtml(o.licenseeName || "—")}</td>
      <td>${escapeHtml(o.city || "—")}</td>
      <td>${statusChip(status.label, status.tone)}</td>
      <td>${statusChip(labelFor(LICENSE_LABELS, o.licenseStatus), o.licenseStatus === "expired" ? "danger" : o.licenseStatus === "expiring" ? "warn" : "ok")}</td>
      <td>${statusChip(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus), o.subscriptionStatus === "expired" ? "danger" : o.subscriptionStatus === "expiring" ? "warn" : "ok")}</td>
      <td>${formatDate(o.lastActivityAt)}</td>
      <td><div class="actions-inline">${officeActionButtons(o, false)}</div></td>
    </tr>`;
  }

  function officeMobileCard(o) {
    const status = compositeStatus(o);
    return `<article class="office-card">
      <h4>${escapeHtml(o.officeName || "—")}</h4>
      <div class="broker-name">${escapeHtml(o.licenseeName || "—")}</div>
      <div class="info-line"><strong>الحالة:</strong> ${statusChip(status.label, status.tone)}</div>
      <div class="info-line"><strong>المدينة:</strong> ${escapeHtml(o.city || "—")}</div>
      <div class="info-line"><strong>الترخيص:</strong> ${statusChip(labelFor(LICENSE_LABELS, o.licenseStatus), o.licenseStatus === "expired" ? "danger" : o.licenseStatus === "expiring" ? "warn" : "ok")}</div>
      <div class="info-line"><strong>الاشتراك:</strong> ${statusChip(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus), o.subscriptionStatus === "expired" ? "danger" : o.subscriptionStatus === "expiring" ? "warn" : "ok")}</div>
      <div class="card-actions">${officeActionButtons(o, true)}</div>
    </article>`;
  }

  function officeActionButtons(o, mobileCard = false) {
    const detail = mobileCard
      ? `<button type="button" class="admin-button admin-button-primary block" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>`
      : `<button type="button" class="admin-button admin-button-secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>`;
    if (state.page === "activity") return detail;
    if (o.approvalStatus === "pending") {
      return `${detail}<button type="button" class="admin-button admin-button-secondary" data-approve="${escapeHtml(o.officeId)}">اعتماد</button><button type="button" class="admin-button admin-button-danger" data-reject="${escapeHtml(o.officeId)}">رفض</button>`;
    }
    if (o.accountStatus === "suspended") {
      return `${detail}<button type="button" class="admin-button admin-button-primary" data-reactivate="${escapeHtml(o.officeId)}">إعادة التفعيل</button>`;
    }
    if (o.approvalStatus === "approved") {
      return `${detail}<button type="button" class="admin-button admin-button-danger" data-suspend="${escapeHtml(o.officeId)}">إيقاف المكتب</button>`;
    }
    return detail;
  }

  function officesTableHtml(list) {
    if (!list.length) return emptyState();
    return `<div class="table-wrap data-table-desktop">
      <table class="data-table" aria-label="قائمة المكاتب">
        <thead><tr>
          <th>المكتب</th><th>الوسيط</th><th>المدينة</th><th>حالة الحساب</th>
          <th>حالة الترخيص</th><th>الاشتراك</th><th>آخر نشاط</th><th>إجراء</th>
        </tr></thead>
        <tbody>${list.map(officeTableRow).join("")}</tbody>
      </table>
    </div>
    <div class="mobile-card-list" aria-label="قائمة المكاتب">${list.map(officeMobileCard).join("")}</div>`;
  }

  function activityTableRow(o) {
    return `<tr>
      <td><strong>${escapeHtml(o.officeName || "—")}</strong></td>
      <td>${statusChip(o.activityLevelLabel || "—", o.activityLevel === "inactive" || o.activityLevel === "low" ? "warn" : "ok")}</td>
      <td>${formatDate(o.lastActivityAt)}</td>
      <td>${formatDate(o.lastLoginAt)}</td>
      <td><button type="button" class="admin-button admin-button-secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button></td>
    </tr>`;
  }

  function activityMobileCard(o) {
    return `<article class="office-card">
      <h4>${escapeHtml(o.officeName || "—")}</h4>
      <div class="info-line"><strong>مستوى النشاط:</strong> ${statusChip(o.activityLevelLabel || "—", o.activityLevel === "inactive" ? "danger" : o.activityLevel === "low" ? "warn" : "ok")}</div>
      <div class="info-line"><strong>آخر نشاط:</strong> ${formatDate(o.lastActivityAt)}</div>
      <div class="info-line"><strong>آخر دخول:</strong> ${formatDate(o.lastLoginAt)}</div>
      <div class="card-actions"><button type="button" class="admin-button admin-button-primary block" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button></div>
    </article>`;
  }

  function activityTableHtml(list) {
    if (!list.length) return emptyState();
    return `<div class="table-wrap data-table-desktop">
      <table class="data-table" aria-label="نشاط المكاتب">
        <thead><tr><th>المكتب</th><th>مستوى النشاط</th><th>آخر نشاط</th><th>آخر دخول</th><th>إجراء</th></tr></thead>
        <tbody>${list.map(activityTableRow).join("")}</tbody>
      </table>
    </div>
    <div class="mobile-card-list">${list.map(activityMobileCard).join("")}</div>`;
  }

  function activityFilters() {
    const levels = [
      { id: "", label: "كل المستويات" },
      { id: "very_active", label: "نشط جدًا" },
      { id: "active", label: "نشط" },
      { id: "low", label: "نشاط منخفض" },
      { id: "inactive", label: "غير نشط" }
    ];
    return `<div class="admin-filter-group" role="group" aria-label="فلترة النشاط">${levels.map((l, i) => {
      const spanClass = levels.length % 2 === 1 && i === levels.length - 1 ? " filter-span-center" : "";
      return `<button type="button" data-activity-filter="${l.id}" class="${spanClass}${state.activityFilter === l.id ? " active" : ""}">${l.label}</button>`;
    }).join("")}</div>`;
  }

  async function officesPage(options = { refreshOnly: false }) {
    ensureShell();
    updateNavActive();
    const listNode = root.querySelector("#officeData");
    if (!options.refreshOnly || !listNode) {
      setMainContent(`${pageHero("إدارة المكاتب", PAGE_SUBTITLES.offices)}
        <section class="admin-card">
          ${controlBarHtml(true)}
          <div id="officeData" class="results-area">${loadingHtml()}</div>
          <div id="officeStatus" class="status hidden" role="status"></div>
        </section>`);
      root.querySelector("#officeSort").value = state.filters.sort;
      bindOfficeFilters();
    } else {
      listNode.innerHTML = loadingHtml();
    }
    try {
      await loadOffices();
      const el = root.querySelector("#officeData");
      if (el) el.innerHTML = officesTableHtml(state.offices);
      bindOfficeActions();
    } catch (error) {
      const el = root.querySelector("#officeData");
      if (el) el.innerHTML = `<div class="status err" role="alert">${escapeHtml(error.message)}</div>`;
    }
  }

  async function activityPage(options = { refreshOnly: false }) {
    ensureShell();
    updateNavActive();
    const listNode = root.querySelector("#activityData");
    if (!options.refreshOnly || !listNode) {
      setMainContent(`${pageHero("نشاط المكاتب", PAGE_SUBTITLES.activity)}
        <section class="admin-section">
          <p class="detail-row" style="margin-bottom:var(--iaqar-space-3)">${escapeHtml(ACTIVITY_THRESHOLD_NOTE)}</p>
          ${activityFilters()}
          <div class="admin-form-grid control-bar filters-2col">
            <input id="officeSearch" class="admin-field field-span-full" type="search" placeholder="بحث عن مكتب" value="${escapeHtml(state.filters.q)}" aria-label="بحث">
            <select id="officeSort" class="admin-select" aria-label="ترتيب">
              <option value="last_activity">آخر نشاط</option>
              <option value="most_active">الأكثر نشاطًا</option>
              <option value="least_active">الأقل نشاطًا</option>
            </select>
            <button type="button" class="admin-button admin-button-secondary field-span-action block" id="officeApplyFilters">تطبيق البحث</button>
          </div>
          <div id="activityData" class="results-area">${loadingHtml()}</div>
        </section>`);
      root.querySelector("#officeSort").value = state.filters.sort === "newest" ? "last_activity" : state.filters.sort;
      bindActivityFilters();
    } else {
      listNode.innerHTML = loadingHtml();
    }
    try {
      await loadOffices({ activityLevel: state.activityFilter });
      const el = root.querySelector("#activityData");
      if (el) el.innerHTML = activityTableHtml(state.offices);
      bindOfficeActions();
    } catch (error) {
      const el = root.querySelector("#activityData");
      if (el) el.innerHTML = `<div class="status err" role="alert">${escapeHtml(error.message)}</div>`;
    }
  }

  function bindOfficeFilters() {
    root.querySelectorAll("[data-tab]").forEach(btn => {
      btn.onclick = () => { state.officesTab = btn.dataset.tab; officesPage({ refreshOnly: false }); };
    });
    const apply = readFiltersAndRefresh(() => officesPage({ refreshOnly: true }));
    root.querySelector("#officeApplyFilters")?.addEventListener("click", apply);
    root.querySelector("#officeSearch")?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); apply(); }
    });
    ["#officeCity", "#officeApprovalStatus", "#officeLicenseStatus", "#officeSort"].forEach(sel => {
      root.querySelector(sel)?.addEventListener("change", apply);
    });
  }

  function bindActivityFilters() {
    root.querySelectorAll("[data-activity-filter]").forEach(btn => {
      btn.onclick = () => { state.activityFilter = btn.dataset.activityFilter; activityPage({ refreshOnly: true }); };
    });
    const apply = readFiltersAndRefresh(() => activityPage({ refreshOnly: true }));
    root.querySelector("#officeApplyFilters")?.addEventListener("click", apply);
    root.querySelector("#officeSearch")?.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); apply(); }
    });
    root.querySelector("#officeSort")?.addEventListener("change", apply);
  }

  function readFiltersAndRefresh(refreshFn) {
    return () => {
      state.filters.q = root.querySelector("#officeSearch")?.value.trim() || "";
      state.filters.city = root.querySelector("#officeCity")?.value || "";
      state.filters.sort = root.querySelector("#officeSort")?.value || "newest";
      state.filters.approvalStatus = root.querySelector("#officeApprovalStatus")?.value || "";
      state.filters.licenseStatus = root.querySelector("#officeLicenseStatus")?.value || "";
      refreshFn();
    };
  }

  function showStatus(msg, ok = false) {
    const node = root.querySelector("#officeStatus");
    if (!node) return;
    node.textContent = msg;
    node.className = `status ${ok ? "ok" : "err"}`;
    node.classList.remove("hidden");
  }

  function bindOfficeActions() {
    root.querySelectorAll("[data-detail]").forEach(btn => {
      btn.onclick = () => showOfficeDetail(btn.dataset.detail);
    });
    root.querySelectorAll("[data-approve]").forEach(btn => {
      btn.onclick = () => {
        const officeId = btn.dataset.approve;
        showModal({
          title: "اعتماد المكتب",
          message: "هل تريد اعتماد هذا المكتب؟",
          confirmLabel: "اعتماد",
          onConfirm: async () => {
            const apps = await api("/admin/broker-applications");
            const app = (apps.applications || []).find(a => a.officeId === officeId);
            if (!app) {
              await api("/admin/office/action", { method: "POST", body: JSON.stringify({ action: "approve", officeId }) });
            } else {
              await api("/admin/broker-applications/action", {
                method: "POST",
                body: JSON.stringify({ applicationId: app.id, action: "approve", officeId })
              });
            }
            showStatus("تم اعتماد المكتب.", true);
            refreshCurrentList();
          }
        });
      };
    });
    root.querySelectorAll("[data-reject]").forEach(btn => {
      btn.onclick = () => {
        const officeId = btn.dataset.reject;
        showModal({
          title: "رفض الطلب",
          message: "أدخل سبب الرفض. لن يتم تنفيذ الرفض بدون سبب.",
          confirmLabel: "رفض الطلب",
          danger: true,
          requireInput: true,
          inputLabel: "سبب الرفض",
          inputPlaceholder: "سبب الرفض الإداري",
          onConfirm: async reason => {
            const apps = await api("/admin/broker-applications");
            const app = (apps.applications || []).find(a => a.officeId === officeId);
            if (app) {
              await api("/admin/broker-applications/action", {
                method: "POST",
                body: JSON.stringify({ applicationId: app.id, action: "reject", officeId, reason })
              });
            } else {
              await api("/admin/office/action", {
                method: "POST",
                body: JSON.stringify({ action: "reject", officeId, reason })
              });
            }
            showStatus("تم رفض الطلب.", true);
            refreshCurrentList();
          }
        });
      };
    });
    root.querySelectorAll("[data-suspend]").forEach(btn => {
      btn.onclick = () => {
        const officeId = btn.dataset.suspend;
        showModal({
          title: "إيقاف المكتب",
          message: "إيقاف المكتب يمنع دخول المستخدمين. أدخل سبب الإيقاف للمتابعة.",
          confirmLabel: "إيقاف المكتب",
          danger: true,
          requireInput: true,
          inputLabel: "سبب الإيقاف",
          inputPlaceholder: "سبب الإيقاف الإداري",
          onConfirm: async reason => {
            await api("/admin/office/action", {
              method: "POST",
              body: JSON.stringify({ action: "suspend", officeId, reason })
            });
            showStatus("تم إيقاف المكتب.", true);
            refreshCurrentList();
          }
        });
      };
    });
    root.querySelectorAll("[data-reactivate]").forEach(btn => {
      btn.onclick = () => {
        const officeId = btn.dataset.reactivate;
        showModal({
          title: "إعادة تفعيل المكتب",
          message: "هل تريد إعادة تفعيل هذا المكتب؟",
          confirmLabel: "إعادة التفعيل",
          onConfirm: async () => {
            await api("/admin/office/action", {
              method: "POST",
              body: JSON.stringify({ action: "reactivate", officeId })
            });
            showStatus("تمت إعادة التفعيل.", true);
            refreshCurrentList();
          }
        });
      };
    });
    root.querySelectorAll("[data-subscription]").forEach(btn => {
      btn.onclick = () => openSubscriptionModal(btn.dataset.subscription);
    });
    root.querySelectorAll("[data-license]").forEach(btn => {
      btn.onclick = () => openLicenseModal(btn.dataset.license);
    });
    root.querySelectorAll("[data-note]").forEach(btn => {
      btn.onclick = () => {
        const officeId = btn.dataset.note;
        showModal({
          title: "إضافة ملاحظة إدارية",
          message: "أدخل الملاحظة الإدارية لهذا المكتب.",
          confirmLabel: "حفظ الملاحظة",
          requireInput: true,
          inputLabel: "الملاحظة",
          onConfirm: async note => {
            await api("/admin/office/action", {
              method: "POST",
              body: JSON.stringify({ action: "add_note", officeId, note })
            });
            showStatus("تمت إضافة الملاحظة.", true);
          }
        });
      };
    });
  }

  function refreshCurrentList() {
    if (state.page === "activity") activityPage({ refreshOnly: true });
    else if (state.page === "offices") officesPage({ refreshOnly: true });
    else if (state.page === "subscriptions") subscriptionsPage();
  }

  function openSubscriptionModal(officeId) {
    showModal({
      title: "تعديل الاشتراك",
      message: "أدخل حالة الاشتراك (trial, active, expiring, expired, none) ثم تاريخ الانتهاء إن وجد.",
      confirmLabel: "تحديث الاشتراك",
      requireInput: true,
      inputLabel: "حالة الاشتراك",
      inputPlaceholder: "active",
      onConfirm: async status => {
        const expires = prompt("تاريخ انتهاء الاشتراك (YYYY-MM-DD) أو اتركه فارغًا");
        if (!status) throw new Error("حالة الاشتراك مطلوبة");
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({
            action: "update_subscription",
            officeId,
            subscriptionStatus: status,
            subscriptionExpiresAt: expires || undefined
          })
        });
        showStatus("تم تحديث الاشتراك.", true);
        refreshCurrentList();
      }
    });
  }

  function openLicenseModal(officeId) {
    showModal({
      title: "تحديث الترخيص",
      message: "أدخل رقم فال. سيُطلب تاريخ الانتهاء في الخطوة التالية.",
      confirmLabel: "متابعة",
      requireInput: true,
      inputLabel: "رقم فال",
      onConfirm: async number => {
        const expires = prompt("تاريخ انتهاء الترخيص (YYYY-MM-DD)");
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({
            action: "update_license",
            officeId,
            falLicenseNumber: number || undefined,
            falLicenseExpiresAt: expires || undefined
          })
        });
        showStatus("تم تحديث الترخيص.", true);
        refreshCurrentList();
      }
    });
  }

  function auditEntryHtml(a) {
    return `<tr>
      <td><span class="audit-label">${escapeHtml(auditActionLabel(a.action))}</span></td>
      <td>${escapeHtml(a.officeId || "—")}</td>
      <td>${escapeHtml(a.performedBy || "—")}</td>
      <td>${formatDate(a.performedAt)}</td>
      <td>${escapeHtml(a.reason || "—")}</td>
    </tr>`;
  }

  function auditMobileCard(e) {
    return `<article class="audit-card">
      <div class="audit-label">${escapeHtml(auditActionLabel(e.action))}</div>
      <div class="audit-line"><strong>مكتب:</strong> ${escapeHtml(e.officeId || "—")}</div>
      <div class="audit-line"><strong>بواسطة:</strong> ${escapeHtml(e.performedBy || "—")}</div>
      <div class="audit-line"><strong>التاريخ:</strong> ${formatDate(e.performedAt)}</div>
      ${e.reason ? `<div class="audit-line">${escapeHtml(e.reason)}</div>` : ""}
    </article>`;
  }

  async function showOfficeDetail(officeId) {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml("جاري تحميل تفاصيل المكتب…"));
    const data = await api(`/admin/office?officeId=${encodeURIComponent(officeId)}`);
    const o = data.office;
    const s = o.activitySummary || {};
    const status = compositeStatus(o);
    setMainContent(`${pageHero(o.officeName || officeId, "تفاصيل المكتب")}
      <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        ${statusChip(status.label, status.tone)} ${statusChip(o.activityLevelLabel, o.activityLevel === "inactive" ? "warn" : "ok")}
        <button type="button" class="admin-button admin-button-secondary" id="backToList">رجوع</button>
      </div>
    <div class="detail-grid">
      <section class="detail-panel"><h3>بيانات المكتب</h3>
        <div class="detail-row"><dt>المدينة: </dt><dd>${escapeHtml(o.city || "—")}</dd><br>
        <dt>فال: </dt><dd>${escapeHtml(o.falLicenseNumber || "—")}</dd></div>
        <p class="tech-id">معرّف: ${escapeHtml(o.officeId)}</p>
      </section>
      <section class="detail-panel"><h3>بيانات الوسيط</h3>
        <div class="detail-row"><dt>المرخص له: </dt><dd>${escapeHtml(o.licenseeName || "—")}</dd><br>
        <dt>جوال: </dt><dd>${escapeHtml(o.phone || "—")}</dd><br>
        <dt>بريد: </dt><dd>${escapeHtml(o.email || "—")}</dd></div>
      </section>
      <section class="detail-panel"><h3>حالة الحساب</h3>
        <div class="detail-row">${statusChip(status.label, status.tone)}<br>
        اعتماد: ${formatDate(o.approvedAt)} · آخر دخول: ${formatDate(o.lastLoginAt)}</div>
      </section>
      <section class="detail-panel"><h3>الترخيص</h3>
        <div class="detail-row">حالة: ${statusChip(labelFor(LICENSE_LABELS, o.licenseStatus), o.licenseStatus === "expired" ? "danger" : "ok")}<br>
        إصدار: ${formatDate(o.falLicenseIssuedAt)} · انتهاء: ${formatDate(o.falLicenseExpiresAt)}</div>
      </section>
      <section class="detail-panel"><h3>الاشتراك</h3>
        <div class="detail-row">حالة: ${statusChip(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus), o.subscriptionStatus === "expired" ? "danger" : "ok")}<br>
        بداية: ${formatDate(o.subscriptionStartedAt)} · انتهاء: ${formatDate(o.subscriptionExpiresAt)} · متبقي: ${o.subscriptionDaysRemaining ?? "—"} يوم</div>
      </section>
      <section class="detail-panel span-2"><h3>النشاط</h3>
        <p class="detail-row" style="margin-bottom:6px">${escapeHtml(ACTIVITY_THRESHOLD_NOTE)}</p>
        <div class="detail-row">دخول 7/30 يوم: ${s.loginCount7d}/${s.loginCount30d} · فرص: ${s.opportunitiesCreated7d}/${s.opportunitiesCreated30d} · مطابقات 30 يوم: ${s.matchesReviewed30d}</div>
      </section>
      <section class="detail-panel span-3"><h3>الملاحظات الإدارية</h3>
        ${(data.notes || []).map(n => `<div class="detail-row">${formatDate(n.createdAt)} — ${escapeHtml(n.note)}</div>`).join("") || '<div class="detail-row">لا توجد ملاحظات.</div>'}
      </section>
      <section class="detail-panel span-3"><h3>سجل إداري للمكتب</h3>
        ${(data.audit || []).length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>الإجراء</th><th>الوقت</th><th>تفاصيل</th></tr></thead><tbody>
          ${(data.audit || []).map(a => `<tr><td>${escapeHtml(auditActionLabel(a.action))}</td><td>${formatDate(a.performedAt)}</td><td>${escapeHtml(a.reason || "—")}</td></tr>`).join("")}
        </tbody></table></div>` : '<div class="detail-row">لا يوجد سجل.</div>'}
      </section>
      <section class="detail-panel danger-zone span-3"><h3>الإجراءات الإدارية</h3>
        <div class="actions-inline" id="detailActions"></div>
      </section>
    </div>`);
    const actions = root.querySelector("#detailActions");
    if (actions) {
      actions.innerHTML = officeActionButtons(o, false) +
        (o.approvalStatus === "approved" ? `
          <button type="button" class="admin-button admin-button-secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
          <button type="button" class="admin-button admin-button-secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
          <button type="button" class="admin-button admin-button-secondary" data-note="${escapeHtml(o.officeId)}">إضافة ملاحظة</button>` : "");
      bindOfficeActions();
    }
    root.querySelector("#backToList").onclick = () => render();
  }

  function subscriptionTableRow(o) {
    const needsAttention = o.subscriptionStatus === "expired" || o.subscriptionStatus === "expiring" ||
      o.licenseStatus === "expired" || o.licenseStatus === "expiring";
    return `<tr class="${needsAttention ? "row-attention" : ""}">
      <td><strong>${escapeHtml(o.officeName || "—")}</strong></td>
      <td>${statusChip(labelFor(LICENSE_LABELS, o.licenseStatus), o.licenseStatus === "expired" ? "danger" : o.licenseStatus === "expiring" ? "warn" : "ok")}</td>
      <td>${formatDate(o.falLicenseExpiresAt)}</td>
      <td>${statusChip(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus), o.subscriptionStatus === "expired" ? "danger" : o.subscriptionStatus === "expiring" ? "warn" : "ok")}</td>
      <td>${formatDate(o.subscriptionExpiresAt)}</td>
      <td><div class="actions-inline">
        <button type="button" class="admin-button admin-button-secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>
        <button type="button" class="admin-button admin-button-secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
        <button type="button" class="admin-button admin-button-secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
      </div></td>
    </tr>`;
  }

  async function subscriptionsPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    await loadOffices({ tab: "approved" });
    const list = state.offices;
    const attention = list.filter(o =>
      ["expired", "expiring"].includes(o.subscriptionStatus) || ["expired", "expiring"].includes(o.licenseStatus)
    );
    setMainContent(`${pageHero("الاشتراكات والتراخيص", PAGE_SUBTITLES.subscriptions)}
      <section class="admin-card">
        ${attention.length ? `<p class="detail-row" style="margin-bottom:16px;color:var(--warn)">${attention.length} مكتب يحتاج متابعة اشتراك/ترخيص</p>` : ""}
        <div class="table-wrap data-table-desktop">
          <table class="data-table" aria-label="الاشتراكات والتراخيص">
            <thead><tr><th>المكتب</th><th>الترخيص</th><th>انتهاء الترخيص</th><th>الاشتراك</th><th>انتهاء الاشتراك</th><th>إجراء</th></tr></thead>
            <tbody>${list.length ? list.map(subscriptionTableRow).join("") : `<tr><td colspan="6">${emptyState("لا توجد مكاتب معتمدة", "لا توجد مكاتب معتمدة حاليًا.")}</td></tr>`}</tbody>
          </table>
        </div>
        <div class="mobile-card-list">${list.map(o => `<article class="office-card">
          <h4>${escapeHtml(o.officeName)}</h4>
          <div class="info-line"><strong>الترخيص:</strong> ${statusChip(labelFor(LICENSE_LABELS, o.licenseStatus), o.licenseStatus === "expired" ? "danger" : "warn")} · ${formatDate(o.falLicenseExpiresAt)}</div>
          <div class="info-line"><strong>الاشتراك:</strong> ${statusChip(labelFor(SUBSCRIPTION_LABELS, o.subscriptionStatus), o.subscriptionStatus === "expired" ? "danger" : "warn")} · ${formatDate(o.subscriptionExpiresAt)}</div>
          <div class="card-actions actions-inline">
            <button type="button" class="admin-button admin-button-primary block" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>
            <button type="button" class="admin-button admin-button-secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
            <button type="button" class="admin-button admin-button-secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
          </div>
        </article>`).join("") || emptyState("لا توجد مكاتب معتمدة", "لا توجد مكاتب معتمدة حاليًا.")}</div>
      </section>`);
    bindOfficeActions();
  }

  async function auditPage() {
    ensureShell();
    updateNavActive();
    setMainContent(loadingHtml());
    const data = await api("/admin/audit-log?limit=150");
    const entries = data.entries || [];
    setMainContent(`${pageHero("السجل الإداري", PAGE_SUBTITLES.audit)}
      <section class="admin-card">
        <div class="table-wrap data-table-desktop">
          <table class="data-table" aria-label="السجل الإداري">
            <thead><tr><th>الإجراء</th><th>المكتب</th><th>المسؤول</th><th>الوقت</th><th>تفاصيل</th></tr></thead>
            <tbody>${entries.length ? entries.map(auditEntryHtml).join("") : `<tr><td colspan="5">${emptyState("لا يوجد سجل", "لم تُسجَّل إجراءات إدارية بعد.")}</td></tr>`}</tbody>
          </table>
        </div>
        <div class="mobile-card-list">${entries.map(auditMobileCard).join("") || emptyState("لا يوجد سجل", "لم تُسجَّل إجراءات إدارية بعد.")}</div>
      </section>`);
  }

  function deniedView() {
    destroyShell();
    root.innerHTML = `<div class="admin-shell login-wrap">
      <section class="admin-card">
        <h2>الوصول مرفوض</h2>
        <p class="login-lead">هذا الحساب ليس من إدارة المنصة. لا يتم تحميل بيانات الإدارة.</p>
        <button type="button" class="admin-button admin-button-secondary block" id="adminLogout">تسجيل الخروج</button>
        <p class="login-back"><a href="/">العودة للمنصة العامة</a></p>
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
      else if (state.page === "activity") await activityPage({ refreshOnly: false });
      else if (state.page === "subscriptions") await subscriptionsPage();
      else if (state.page === "audit") await auditPage();
      else await overviewPage();
    } catch (error) {
      ensureShell();
      updateNavActive();
      setMainContent(`<section class="admin-card"><div class="status err" role="alert">${escapeHtml(error.message || "تعذر تحميل لوحة الإدارة.")}</div></section>`);
    }
  }

  firebase.auth().onAuthStateChanged(() => render());
  render();
})();
