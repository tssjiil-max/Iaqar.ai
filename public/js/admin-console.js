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
    filters: { q: "", city: "", sort: "newest" }
  };

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;" }[c]));
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
  }

  function badgeClass(level) {
    if (level === "very_active" || level === "active") return "badge";
    if (level === "low") return "badge warn";
    return "badge danger";
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

  function shell(content, title = "لوحة إدارة IAQAR.AI") {
    root.innerHTML = `<div class="admin-shell">
      <header class="admin-header">
        <h1>${escapeHtml(title)}</h1>
        <p>وحدة إدارة المنصة — للمسؤولين فقط</p>
      </header>
      ${content}
    </div>`;
  }

  function navHtml() {
    const items = [
      { id: "overview", label: "نظرة عامة" },
      { id: "offices", label: "إدارة المكاتب" },
      { id: "activity", label: "نشاط المكاتب" },
      { id: "subscriptions", label: "الاشتراكات والتراخيص" },
      { id: "audit", label: "السجل الإداري" }
    ];
    return `<nav class="admin-nav">${items.map(item =>
      `<button type="button" data-page="${item.id}" class="${state.page === item.id ? "active" : ""}">${item.label}</button>`
    ).join("")}</nav>`;
  }

  function bindNav() {
    root.querySelectorAll("[data-page]").forEach(btn => {
      btn.onclick = () => {
        state.page = btn.dataset.page;
        state.selectedOfficeId = null;
        render();
      };
    });
    const logout = root.querySelector("#adminLogout");
    if (logout) logout.onclick = async () => { await firebase.auth().signOut(); render(); };
  }

  function loginView(message = "") {
    shell(`<section class="admin-card login-card">
      <h2>دخول إدارة المنصة</h2>
      <p>هذا الدخول مخصص لمدير المنصة فقط.</p>
      <form id="adminLoginForm" class="filters">
        <input name="email" type="email" placeholder="البريد الإلكتروني" required autocomplete="username">
        <input name="password" type="password" placeholder="كلمة المرور" required autocomplete="current-password">
        <button class="btn primary" type="submit">دخول الإدارة</button>
      </form>
      <div class="status ${message ? "err" : "hidden"}">${escapeHtml(message)}</div>
      <p style="margin-top:12px;font-size:12px;color:var(--muted)"><a href="/">العودة للمنصة العامة</a></p>
    </section>`);
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

  async function overviewPage() {
    const data = await api("/admin/overview");
    shell(`${navHtml()}
      <section class="admin-card">
        <h2>نظرة عامة</h2>
        <div class="admin-grid">
          ${counter("إجمالي المكاتب", data.counters.totalOffices)}
          ${counter("طلبات بانتظار الاعتماد", data.counters.pendingApproval)}
          ${counter("المكاتب المعتمدة", data.counters.approved)}
          ${counter("المكاتب النشطة", data.counters.activeAccounts)}
          ${counter("الموقوفة", data.counters.suspended)}
          ${counter("اشتراكات منتهية", data.counters.expiredSubscriptions)}
          ${counter("تراخيص منتهية", data.counters.expiredLicenses)}
          ${counter("نشطة آخر 7 أيام", data.counters.activeLast7Days)}
          ${counter("غير نشطة 30 يوم", data.counters.inactiveLast30Days)}
        </div>
      </section>
      <button class="btn secondary" id="adminLogout" style="width:100%">تسجيل الخروج</button>`, "نظرة عامة");
    bindNav();
  }

  function counter(label, value) {
    return `<div class="counter"><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`;
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

  function officeCard(o) {
    return `<article class="office-card" data-office-id="${escapeHtml(o.officeId)}">
      <h3>${escapeHtml(o.officeName || o.officeId)}</h3>
      <div class="office-meta">
        ${escapeHtml(o.city || "—")} · فال ${escapeHtml(o.falLicenseNumber || "—")}<br>
        اعتماد: ${escapeHtml(o.approvalStatus)} · حساب: ${escapeHtml(o.accountStatus)}<br>
        اشتراك: ${escapeHtml(o.subscriptionStatus)} · آخر نشاط: ${formatDate(o.lastActivityAt)}
      </div>
      <span class="${badgeClass(o.activityLevel)}">${escapeHtml(o.activityLevelLabel)}</span>
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

  async function loadOffices(extra = {}) {
    const params = new URLSearchParams({
      tab: state.officesTab === "all" ? "" : state.officesTab,
      q: state.filters.q,
      city: state.filters.city,
      sort: state.filters.sort,
      ...extra
    });
    const data = await api(`/admin/offices?${params.toString()}`);
    state.offices = data.offices || [];
    state.cities = data.cities || [];
    return data;
  }

  async function officesPage() {
    await loadOffices(state.page === "activity" ? { activityLevel: state.activityFilter } : {});
    const list = state.offices;
    shell(`${navHtml()}
      <section class="admin-card">
        <h2>${state.page === "activity" ? "نشاط المكاتب" : "إدارة المكاتب"}</h2>
        ${state.page === "offices" ? officeTabs() : activityFilters()}
        <div class="filters">
          <input id="officeSearch" placeholder="بحث: اسم، مرخص له، جوال، فال" value="${escapeHtml(state.filters.q)}">
          <select id="officeCity"><option value="">كل المدن</option>
            ${state.cities.map(c => `<option value="${escapeHtml(c)}" ${state.filters.city === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
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
        </div>
        <div id="officeList">${list.length ? list.map(officeCard).join("") : "<p>لا توجد نتائج.</p>"}</div>
        <div id="officeStatus" class="status hidden"></div>
      </section>
      <button class="btn secondary" id="adminLogout" style="width:100%">تسجيل الخروج</button>`);
    root.querySelector("#officeSort").value = state.filters.sort;
    bindNav();
    bindOfficeFilters();
    bindOfficeActions();
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

  function bindOfficeFilters() {
    root.querySelectorAll("[data-tab]").forEach(btn => {
      btn.onclick = () => { state.officesTab = btn.dataset.tab; officesPage(); };
    });
    root.querySelectorAll("[data-activity-filter]").forEach(btn => {
      btn.onclick = () => { state.activityFilter = btn.dataset.activityFilter; officesPage(); };
    });
    const search = root.querySelector("#officeSearch");
    const city = root.querySelector("#officeCity");
    const sort = root.querySelector("#officeSort");
    const apply = () => {
      state.filters.q = search.value.trim();
      state.filters.city = city.value;
      state.filters.sort = sort.value;
      officesPage();
    };
    search.onchange = apply;
    city.onchange = apply;
    sort.onchange = apply;
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
        officesPage();
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
        officesPage();
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
        officesPage();
      } catch (e) { showStatus(e.message || "تعذر الإيقاف."); }
    });
    root.querySelectorAll("[data-reactivate]").forEach(btn => btn.onclick = async () => {
      try {
        await api("/admin/office/action", {
          method: "POST",
          body: JSON.stringify({ action: "reactivate", officeId: btn.dataset.reactivate })
        });
        showStatus("تمت إعادة التفعيل.", true);
        officesPage();
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
        officesPage();
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
        officesPage();
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

  async function showOfficeDetail(officeId, focusActivity = false) {
    const data = await api(`/admin/office?officeId=${encodeURIComponent(officeId)}`);
    const o = data.office;
    const s = o.activitySummary || {};
    shell(`${navHtml()}
      <section class="admin-card">
        <button class="btn secondary" id="backToList">← رجوع</button>
        <h2>${escapeHtml(o.officeName || officeId)}</h2>
        <div class="detail-section"><h4>بيانات المكتب</h4>
          <div class="detail-row">المرخص له: ${escapeHtml(o.licenseeName)}<br>جوال: ${escapeHtml(o.phone)}<br>بريد: ${escapeHtml(o.email)}<br>مدينة: ${escapeHtml(o.city)}<br>officeId: ${escapeHtml(o.officeId)}</div></div>
        <div class="detail-section"><h4>الاعتماد</h4>
          <div class="detail-row">حالة: ${escapeHtml(o.approvalStatus)}<br>تسجيل: ${formatDate(o.registrationSubmittedAt)}<br>اعتماد: ${formatDate(o.approvedAt)}<br>بواسطة: ${escapeHtml(o.approvedBy || "—")}</div></div>
        <div class="detail-section"><h4>الترخيص</h4>
          <div class="detail-row">فال: ${escapeHtml(o.falLicenseNumber)}<br>إصدار: ${formatDate(o.falLicenseIssuedAt)}<br>انتهاء: ${formatDate(o.falLicenseExpiresAt)}<br>حالة: ${escapeHtml(o.licenseStatus)}</div></div>
        <div class="detail-section"><h4>الاشتراك</h4>
          <div class="detail-row">حالة: ${escapeHtml(o.subscriptionStatus)}<br>بداية: ${formatDate(o.subscriptionStartedAt)}<br>انتهاء: ${formatDate(o.subscriptionExpiresAt)}<br>متبقي: ${o.subscriptionDaysRemaining ?? "—"} يوم</div></div>
        <div class="detail-section"><h4>الحساب</h4>
          <div class="detail-row">حالة: ${escapeHtml(o.accountStatus)}<br>آخر دخول: ${formatDate(o.lastLoginAt)}<br>آخر نشاط: ${formatDate(o.lastActivityAt)}<br>مستوى النشاط: ${escapeHtml(o.activityLevelLabel)}</div></div>
        <div class="detail-section ${focusActivity ? "" : ""}"><h4>نشاط المكتب</h4>
          <div class="detail-row">دخول 7d/30d: ${s.loginCount7d}/${s.loginCount30d}<br>فرص 7d/30d: ${s.opportunitiesCreated7d}/${s.opportunitiesCreated30d}<br>فرص نشطة: ${s.activeOpportunitiesCount}<br>مطابقات مراجعة 30d: ${s.matchesReviewed30d}<br>عمليات مكتملة 30d: ${s.completedOperations30d}<br>عروض ملاك 30d: ${s.publicOwnerSubmissions30d}<br>طلبات عملاء 30d: ${s.publicClientSubmissions30d}</div></div>
        <div class="detail-section"><h4>ملاحظات إدارية</h4>
          ${(data.notes || []).map(n => `<div class="detail-row">${formatDate(n.createdAt)} — ${escapeHtml(n.note)}</div>`).join("") || '<div class="detail-row">لا توجد ملاحظات.</div>'}
        </div>
        <div class="detail-section"><h4>سجل إداري للمكتب</h4>
          ${(data.audit || []).map(a => `<div class="detail-row">${formatDate(a.performedAt)} — ${escapeHtml(a.action)} ${escapeHtml(a.reason || "")}</div>`).join("") || '<div class="detail-row">لا يوجد سجل.</div>'}
        </div>
      </section>`, "تفاصيل المكتب");
    bindNav();
    root.querySelector("#backToList").onclick = () => render();
  }

  async function subscriptionsPage() {
    await loadOffices({ tab: "approved" });
    const list = state.offices;
    shell(`${navHtml()}
      <section class="admin-card">
        <h2>الاشتراكات والتراخيص</h2>
        <div id="officeList">${list.map(o => `<article class="office-card">
          <h3>${escapeHtml(o.officeName)}</h3>
          <div class="office-meta">اشتراك: ${escapeHtml(o.subscriptionStatus)} · ينتهي ${formatDate(o.subscriptionExpiresAt)}
          <br>ترخيص: ${escapeHtml(o.licenseStatus)} · ينتهي ${formatDate(o.falLicenseExpiresAt)}</div>
          ${o.subscriptionStatus === "expired" || o.licenseStatus === "expired" ? '<span class="badge danger">منتهي</span>' : ""}
          ${o.subscriptionStatus === "expiring" || o.licenseStatus === "expiring" ? '<span class="badge warn">ينتهي خلال 30 يوم</span>' : ""}
          <div class="actions">
            <button class="btn secondary" data-subscription="${escapeHtml(o.officeId)}">تعديل الاشتراك</button>
            <button class="btn secondary" data-license="${escapeHtml(o.officeId)}">تحديث الترخيص</button>
            <button class="btn secondary" data-detail="${escapeHtml(o.officeId)}">عرض التفاصيل</button>
          </div>
        </article>`).join("")}</div>
      </section>
      <button class="btn secondary" id="adminLogout" style="width:100%">تسجيل الخروج</button>`, "الاشتراكات والتراخيص");
    bindNav();
    bindOfficeActions();
  }

  async function auditPage() {
    const data = await api("/admin/audit-log?limit=150");
    shell(`${navHtml()}
      <section class="admin-card">
        <h2>السجل الإداري</h2>
        ${(data.entries || []).map(e => `<article class="office-card">
          <div class="office-meta"><strong>${escapeHtml(e.action)}</strong><br>
          مكتب: ${escapeHtml(e.officeId || "—")}<br>
          بواسطة: ${escapeHtml(e.performedBy)} · ${formatDate(e.performedAt)}<br>
          ${escapeHtml(e.reason || "")}</div>
        </article>`).join("") || "<p>لا يوجد سجل.</p>"}
      </section>
      <button class="btn secondary" id="adminLogout" style="width:100%">تسجيل الخروج</button>`, "السجل الإداري");
    bindNav();
  }

  async function deniedView() {
    shell(`<section class="admin-card login-card">
      <h2>الوصول مرفوض</h2>
      <p>هذا الحساب ليس من إدارة المنصة. لا يتم تحميل بيانات الإدارة.</p>
      <button class="btn secondary" id="adminLogout">تسجيل الخروج</button>
      <p style="margin-top:12px"><a href="/">العودة للمنصة العامة</a></p>
    </section>`);
    root.querySelector("#adminLogout").onclick = async () => { await firebase.auth().signOut(); render(); };
  }

  async function render() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      shell('<section class="admin-card"><p>تعذر بدء المنصة. حدّث الصفحة.</p></section>');
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
      else if (state.page === "offices") await officesPage();
      else if (state.page === "activity") await officesPage();
      else if (state.page === "subscriptions") await subscriptionsPage();
      else if (state.page === "audit") await auditPage();
      else await overviewPage();
    } catch (error) {
      shell(`${navHtml()}<section class="admin-card"><div class="status err">${escapeHtml(error.message || "تعذر تحميل لوحة الإدارة.")}</div></section>`);
      bindNav();
    }
  }

  firebase.auth().onAuthStateChanged(() => render());
  render();
})();
