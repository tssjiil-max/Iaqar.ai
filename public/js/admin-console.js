import {
  AdminApi,
  MAIN_VIEWS,
  OFFICE_TABS,
  formatDate,
  suggestOfficeId,
  isPlatformAdminClaims,
  mapAdminLoginError
} from "./admin-api.js";

const state = {
  view: "overview",
  officeTab: "pending",
  search: "",
  sort: "registered_desc",
  selectedOfficeId: "",
  activityOfficeId: ""
};

const els = {
  loginCard: document.getElementById("loginCard"),
  console: document.getElementById("console"),
  loginForm: document.getElementById("loginForm"),
  status: document.getElementById("status"),
  consoleStatus: document.getElementById("consoleStatus"),
  mainNav: document.getElementById("mainNav"),
  viewRoot: document.getElementById("viewRoot"),
  adminUserLine: document.getElementById("adminUserLine"),
  logoutBtn: document.getElementById("logoutBtn")
};

const api = new AdminApi(async () => {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("auth_required");
  return user.getIdToken();
});

function showStatus(node, message, ok = false) {
  if (!node || !message) {
    if (node) node.className = "status";
    return;
  }
  node.textContent = message;
  node.className = `status show ${ok ? "ok" : "err"}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function ensurePlatformAdmin(user) {
  const token = await user.getIdTokenResult(true);
  if (isPlatformAdminClaims(token.claims)) return true;
  const error = new Error("admin_required");
  error.code = "admin_required";
  throw error;
}

function renderMainNav() {
  els.mainNav.innerHTML = MAIN_VIEWS.map((item) =>
    `<button type="button" data-view="${item.id}" class="${state.view === item.id ? "active" : ""}">${item.label}</button>`
  ).join("");
  els.mainNav.querySelectorAll("button").forEach((button) => {
    button.onclick = () => {
      state.view = button.dataset.view;
      renderMainNav();
      renderView().catch((error) => showStatus(els.consoleStatus, error.message));
    };
  });
}

async function renderOverview() {
  const payload = await api.overview();
  const o = payload.overview || {};
  els.viewRoot.innerHTML = `
    <div class="card">
      <h2>نظرة عامة</h2>
      <div class="grid">
        ${stat("إجمالي المكاتب", o.totalOffices)}
        ${stat("طلبات بانتظار الاعتماد", o.pendingApprovals)}
        ${stat("المكاتب المعتمدة", o.approvedOffices)}
        ${stat("النشطة", o.activeAccounts)}
        ${stat("الموقوفة", o.suspendedOffices)}
        ${stat("اشتراكات منتهية", o.expiredSubscriptions)}
        ${stat("تراخيص منتهية", o.expiredLicenses)}
        ${stat("نشطة آخر 7 أيام", o.activeLast7Days)}
        ${stat("غير نشطة آخر 30 يوم", o.inactiveLast30Days)}
      </div>
    </div>`;
}

function stat(label, value) {
  return `<div class="stat"><strong>${Number(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function officeTabsHtml() {
  return `<div class="tabs">${OFFICE_TABS.map((tab) =>
    `<button type="button" data-tab="${tab.id}" class="${state.officeTab === tab.id ? "active" : ""}">${tab.label}</button>`
  ).join("")}</div>`;
}

function officeToolbarHtml() {
  return `<div class="toolbar">
    <input id="officeSearch" placeholder="بحث: اسم المكتب، المرخص له، الجوال، فال" value="${escapeHtml(state.search)}">
    <select id="officeSort">
      <option value="registered_desc" ${state.sort === "registered_desc" ? "selected" : ""}>الأحدث تسجيلًا</option>
      <option value="registered_asc" ${state.sort === "registered_asc" ? "selected" : ""}>الأقدم</option>
      <option value="activity_desc" ${state.sort === "activity_desc" ? "selected" : ""}>الأكثر نشاطًا</option>
      <option value="activity_asc" ${state.sort === "activity_asc" ? "selected" : ""}>الأقل نشاطًا</option>
      <option value="login_desc" ${state.sort === "login_desc" ? "selected" : ""}>آخر دخول</option>
      <option value="subscription_expiry_asc" ${state.sort === "subscription_expiry_asc" ? "selected" : ""}>أقرب اشتراك للانتهاء</option>
      <option value="license_expiry_asc" ${state.sort === "license_expiry_asc" ? "selected" : ""}>أقرب ترخيص للانتهاء</option>
    </select>
  </div>`;
}

function renderOfficeItem(item) {
  if (item.recordType === "application") {
    const officeId = suggestOfficeId(item.officeName, item.applicationId);
    return `<article class="list-item" data-application="${escapeHtml(item.applicationId)}">
      <h3>${escapeHtml(item.brokerName)} <span class="badge">طلب جديد</span></h3>
      <div class="meta">
        فال: ${escapeHtml(item.licenseNumber)}<br>
        الجوال: ${escapeHtml(item.phone)}<br>
        البريد: ${escapeHtml(item.email)}<br>
        المكتب: ${escapeHtml(item.officeName)}
      </div>
      <input data-office-input="${escapeHtml(item.applicationId)}" value="${escapeHtml(officeId)}" aria-label="رمز المكتب">
      <div class="row-actions">
        <button class="btn" data-approve="${escapeHtml(item.applicationId)}">اعتماد</button>
        <button class="btn danger" data-reject="${escapeHtml(item.applicationId)}">رفض</button>
      </div>
    </article>`;
  }
  return `<article class="list-item" data-office="${escapeHtml(item.officeId)}">
    <h3>${escapeHtml(item.officeName || item.officeId)}</h3>
    <div class="meta">
      ${escapeHtml(item.brokerName || "")}<br>
      فال: ${escapeHtml(item.licenseNumber || "")} · الجوال: ${escapeHtml(item.phone || "")}<br>
      الاعتماد: ${escapeHtml(item.approvalStatus)} · الحساب: ${escapeHtml(item.accountStatus)}<br>
      الاشتراك: ${escapeHtml(item.subscriptionStatus)} · الترخيص: ${escapeHtml(item.licenseStatus)}
    </div>
    <div class="row-actions">
      <button class="btn secondary" data-detail="${escapeHtml(item.officeId)}">عرض التفاصيل</button>
      <button class="btn secondary" data-activity="${escapeHtml(item.officeId)}">عرض النشاط</button>
    </div>
  </article>`;
}

async function renderOffices() {
  els.viewRoot.innerHTML = `<div class="card"><h2>إدارة المكاتب</h2>${officeTabsHtml()}${officeToolbarHtml()}<div id="officeList"><p>جارٍ التحميل...</p></div></div>`;
  const listNode = document.getElementById("officeList");
  els.viewRoot.querySelectorAll("[data-tab]").forEach((button) => {
    button.onclick = () => {
      state.officeTab = button.dataset.tab;
      renderOffices().catch((error) => showStatus(els.consoleStatus, error.message));
    };
  });
  const searchInput = document.getElementById("officeSearch");
  const sortSelect = document.getElementById("officeSort");
  searchInput.onchange = () => { state.search = searchInput.value; renderOffices(); };
  sortSelect.onchange = () => { state.sort = sortSelect.value; renderOffices(); };

  const payload = await api.offices({
    tab: state.officeTab,
    search: state.search,
    sort: state.sort,
    limit: 100
  });
  const items = Array.isArray(payload.items) ? payload.items : [];
  listNode.innerHTML = items.length
    ? items.map(renderOfficeItem).join("")
    : "<p>لا توجد سجلات في هذا القسم.</p>";

  listNode.querySelectorAll("[data-approve],[data-reject]").forEach((button) => {
    button.onclick = async () => {
      const id = button.dataset.approve || button.dataset.reject;
      const approve = Boolean(button.dataset.approve);
      button.disabled = true;
      try {
        if (approve) {
          const input = listNode.querySelector(`[data-office-input="${CSS.escape(id)}"]`);
          await api.approveApplication(id, input ? input.value : "");
        } else {
          await api.rejectApplication(id);
        }
        showStatus(els.consoleStatus, approve ? "تم اعتماد المكتب." : "تم رفض الطلب.", true);
        await renderOffices();
      } catch (error) {
        showStatus(els.consoleStatus, error.message);
        button.disabled = false;
      }
    };
  });
  listNode.querySelectorAll("[data-detail]").forEach((button) => {
    button.onclick = () => openOfficeDetail(button.dataset.detail);
  });
  listNode.querySelectorAll("[data-activity]").forEach((button) => {
    button.onclick = () => {
      state.activityOfficeId = button.dataset.activity;
      state.view = "activity";
      renderMainNav();
      renderView();
    };
  });
}

async function openOfficeDetail(officeId) {
  state.selectedOfficeId = officeId;
  const [detail, activity] = await Promise.all([
    api.officeDetail(officeId),
    api.officeActivity(officeId)
  ]);
  const office = detail.office || {};
  const act = activity.activity || {};
  const notes = Array.isArray(detail.notes) ? detail.notes : [];
  const audit = Array.isArray(detail.audit) ? detail.audit : [];
  els.viewRoot.innerHTML = `
    <div class="card">
      <button class="btn secondary" id="backToOffices" type="button">← رجوع إلى المكاتب</button>
      <h2>${escapeHtml(office.officeName || officeId)}</h2>
      <div class="meta">
        رمز المكتب: ${escapeHtml(officeId)}<br>
        المرخص له: ${escapeHtml(office.brokerName || "")}<br>
        الجوال: ${escapeHtml(office.phone || "")} · فال: ${escapeHtml(office.licenseNumber || "")}<br>
        المدينة: ${escapeHtml(office.city || "")}<br>
        تاريخ التسجيل: ${formatDate(office.registeredAt)}<br>
        تاريخ الاعتماد: ${formatDate(office.approvedAt)}<br>
        آخر دخول: ${formatDate(act.lastLoginAt || office.lastLoginAt)}<br>
        آخر نشاط: ${formatDate(act.lastActivityAt || office.lastActivityAt)}<br>
        الحساب: ${escapeHtml(office.accountStatus)} · النشاط: ${escapeHtml(act.activityLevel || "غير نشط")}
      </div>
      <div class="toolbar" style="margin-top:12px">
        <input id="suspendReason" placeholder="سبب الإيقاف (مطلوب للإيقاف)">
        <div class="row-actions">
          <button class="btn danger" id="suspendBtn" type="button">إيقاف المكتب</button>
          <button class="btn secondary" id="reactivateBtn" type="button">إعادة التفعيل</button>
        </div>
        <select id="subscriptionStatus">
          <option value="trial">تجريبي</option>
          <option value="active">نشط</option>
          <option value="expiring">ينتهي قريبًا</option>
          <option value="expired">منتهي</option>
          <option value="none">بدون</option>
        </select>
        <input id="subscriptionExpiresAt" type="date">
        <button class="btn secondary" id="saveSubscriptionBtn" type="button">حفظ الاشتراك</button>
        <input id="licenseExpiresAt" type="date">
        <button class="btn secondary" id="saveLicenseBtn" type="button">حفظ الترخيص</button>
        <textarea id="adminNote" placeholder="ملاحظة إدارية"></textarea>
        <button class="btn secondary" id="saveNoteBtn" type="button">إضافة ملاحظة</button>
      </div>
      <h2>النشاط</h2>
      <div class="meta">${renderActivityLines(act)}</div>
      <h2>الملاحظات الإدارية</h2>
      ${notes.length ? notes.map((note) => `<div class="list-item"><div class="meta">${escapeHtml(note.note)}<br>${formatDate(note.createdAt)}</div></div>`).join("") : "<p>لا توجد ملاحظات.</p>"}
      <h2>السجل الإداري</h2>
      ${audit.length ? audit.map((row) => `<div class="list-item"><div class="meta">${escapeHtml(row.action)} · ${formatDate(row.performedAt)}<br>${escapeHtml(row.reason || "")}</div></div>`).join("") : "<p>لا توجد أحداث.</p>"}
    </div>`;
  document.getElementById("backToOffices").onclick = () => {
    state.view = "offices";
    renderMainNav();
    renderView();
  };
  document.getElementById("suspendBtn").onclick = async () => {
    const reason = document.getElementById("suspendReason").value;
    await api.suspendOffice(officeId, reason);
    showStatus(els.consoleStatus, "تم إيقاف المكتب.", true);
    openOfficeDetail(officeId);
  };
  document.getElementById("reactivateBtn").onclick = async () => {
    await api.reactivateOffice(officeId);
    showStatus(els.consoleStatus, "تمت إعادة التفعيل.", true);
    openOfficeDetail(officeId);
  };
  document.getElementById("saveSubscriptionBtn").onclick = async () => {
    await api.updateSubscription(
      officeId,
      document.getElementById("subscriptionStatus").value,
      document.getElementById("subscriptionExpiresAt").value
    );
    showStatus(els.consoleStatus, "تم تحديث الاشتراك.", true);
    openOfficeDetail(officeId);
  };
  document.getElementById("saveLicenseBtn").onclick = async () => {
    await api.updateLicense(officeId, document.getElementById("licenseExpiresAt").value);
    showStatus(els.consoleStatus, "تم تحديث الترخيص.", true);
    openOfficeDetail(officeId);
  };
  document.getElementById("saveNoteBtn").onclick = async () => {
    await api.addNote(officeId, document.getElementById("adminNote").value);
    showStatus(els.consoleStatus, "تمت إضافة الملاحظة.", true);
    openOfficeDetail(officeId);
  };
}

function renderActivityLines(act) {
  if (!act.historicalDataAvailable) return "لا توجد بيانات تاريخية";
  return `
    آخر دخول: ${formatDate(act.lastLoginAt)}<br>
    آخر نشاط فعلي: ${formatDate(act.lastActivityAt)}<br>
    مرات الدخول 7 أيام: ${Number(act.loginCount7d || 0)} · 30 يوم: ${Number(act.loginCount30d || 0)}<br>
    فرص مضافة 7 أيام: ${Number(act.opportunities7d || 0)} · 30 يوم: ${Number(act.opportunities30d || 0)}<br>
    الفرص النشطة: ${Number(act.activeOpportunities || 0)}<br>
    المطابقات المراجعة: ${Number(act.matchReviewsPending || 0)}<br>
    العمليات المكتملة: ${Number(act.operationsCompletedTotal || 0)}<br>
    عروض الملاك عبر الرابط: ${Number(act.publicOwnerSubmissions30d || 0)}<br>
    طلبات العملاء عبر الرابط: ${Number(act.publicClientSubmissions30d || 0)}
  `;
}

async function renderActivityView() {
  els.viewRoot.innerHTML = `<div class="card"><h2>نشاط المكاتب</h2>
    <div class="toolbar">
      <input id="activityOfficeId" placeholder="رمز المكتب" value="${escapeHtml(state.activityOfficeId)}">
      <button class="btn" id="loadActivityBtn" type="button">عرض النشاط</button>
    </div>
    <div id="activityPanel"><p>أدخل رمز مكتب لعرض نشاطه.</p></div>
  </div>`;
  const load = async () => {
    const officeId = document.getElementById("activityOfficeId").value.trim();
    if (!officeId) return;
    state.activityOfficeId = officeId;
    const payload = await api.officeActivity(officeId);
    document.getElementById("activityPanel").innerHTML = `<div class="meta">${renderActivityLines(payload.activity || {})}</div>`;
  };
  document.getElementById("loadActivityBtn").onclick = () => load().catch((error) => showStatus(els.consoleStatus, error.message));
  if (state.activityOfficeId) await load();
}

async function renderBillingView() {
  const payload = await api.offices({ tab: "all", sort: "subscription_expiry_asc", limit: 100 });
  const items = (payload.items || []).filter((row) => row.recordType === "office");
  els.viewRoot.innerHTML = `<div class="card"><h2>الاشتراكات والتراخيص</h2>
    ${items.map((row) => `<div class="list-item"><h3>${escapeHtml(row.officeName || row.officeId)}</h3>
      <div class="meta">الاشتراك: ${escapeHtml(row.subscriptionStatus)} · ينتهي: ${formatDate(row.subscriptionExpiresAt)}<br>
      الترخيص: ${escapeHtml(row.licenseStatus)} · ينتهي: ${formatDate(row.licenseExpiresAt)}</div>
      <button class="btn secondary" data-detail="${escapeHtml(row.officeId)}">إدارة</button>
    </div>`).join("") || "<p>لا توجد مكاتب.</p>"}
  </div>`;
  els.viewRoot.querySelectorAll("[data-detail]").forEach((button) => {
    button.onclick = () => openOfficeDetail(button.dataset.detail);
  });
}

async function renderAuditView() {
  const payload = await api.auditLog({ limit: 100 });
  const items = Array.isArray(payload.items) ? payload.items : [];
  els.viewRoot.innerHTML = `<div class="card"><h2>السجل الإداري</h2>
    ${items.map((row) => `<div class="list-item"><div class="meta">
      <strong>${escapeHtml(row.action)}</strong><br>
      المكتب: ${escapeHtml(row.officeId || "—")}<br>
      المنفّذ: ${escapeHtml(row.performedBy || "—")}<br>
      الوقت: ${formatDate(row.performedAt)}<br>
      ${escapeHtml(row.reason || "")}
    </div></div>`).join("") || "<p>لا توجد أحداث إدارية.</p>"}
  </div>`;
}

async function renderView() {
  showStatus(els.consoleStatus, "");
  if (state.view === "overview") return renderOverview();
  if (state.view === "offices") return renderOffices();
  if (state.view === "activity") return renderActivityView();
  if (state.view === "billing") return renderBillingView();
  if (state.view === "audit") return renderAuditView();
}

async function enterConsole(user) {
  await ensurePlatformAdmin(user);
  els.loginCard.classList.add("hidden");
  els.console.classList.remove("hidden");
  els.adminUserLine.textContent = `مرحبًا ${user.email || "مدير المنصة"}`;
  renderMainNav();
  await renderView();
}

async function boot() {
  els.loginForm.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    showStatus(els.status, "");
    try {
      const credential = await firebase.auth().signInWithEmailAndPassword(
        String(form.get("email") || "").trim(),
        String(form.get("password") || "")
      );
      await enterConsole(credential.user);
    } catch (error) {
      showStatus(els.status, mapAdminLoginError(error));
    }
  };
  els.logoutBtn.onclick = async () => {
    await firebase.auth().signOut();
    location.reload();
  };
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) return;
    try {
      await enterConsole(user);
    } catch (error) {
      await firebase.auth().signOut();
      showStatus(els.status, mapAdminLoginError(error));
    }
  });
}

boot();
