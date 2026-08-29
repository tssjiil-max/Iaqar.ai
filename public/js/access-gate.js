(() => {
  "use strict";

  try {
    if (document.documentElement.dataset.partyMode === "1") {
      if (typeof window.__IAQAR_PARTY_DIAG__ === "function") {
        window.__IAQAR_PARTY_DIAG__("ACCESS_GATE_SKIPPED", { source: "access-gate-return" });
      }
      document.documentElement.dataset.partyMode = "1";
      document.documentElement.classList.add("is-party-mode");
      return;
    }
    const partyToken = String(new URLSearchParams(location.search).get("cv2Party") || window.__IAQAR_PARTY_TOKEN__ || "").trim();
    if (partyToken) {
      document.documentElement.dataset.partyMode = "1";
      document.documentElement.classList.add("is-party-mode");
      if (typeof window.__IAQAR_PARTY_DIAG__ === "function") {
        window.__IAQAR_PARTY_DIAG__("ACCESS_GATE_SKIPPED", { source: "access-gate-return" });
      }
      return;
    }
  } catch (_) { /* keep broker access-gate */ }

  const officeIdDomain = () => window.IAQAR?.officeIdDomain || {};
  function firestoreOfficeId(value) {
    const fn = officeIdDomain().firestoreOfficeId;
    if (typeof fn === "function") return fn(value);
    return String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }
  function officeIdsEquivalent(left, right) {
    const fn = officeIdDomain().officeIdsEquivalent;
    if (typeof fn === "function") return fn(left, right);
    return firestoreOfficeId(left) === firestoreOfficeId(right);
  }

  const query = new URLSearchParams(location.search);
  let officeId = firestoreOfficeId(query.get("officeId") || query.get("office") || "");
  let isPublicOfficeLink = query.get("view") === "public" && officeId && officeId !== "platform";
  let isPlatformAddRoute = /^\/add\/?$/i.test(location.pathname);
  let isPlatformHome = !officeId || officeId === "platform" || isPlatformAddRoute;
  const publicSlug = (() => {
    const match = location.pathname.match(/^\/(m|o)\/([^/]+)\/?$/i);
    if (!match) return "";
    try { return decodeURIComponent(match[2]).trim().toLowerCase(); } catch (_) { return match[2].trim().toLowerCase(); }
  })();
  const publicSlugLegacy = /^\/o\//i.test(location.pathname);
  function refreshRouteFlags() {
    isPlatformAddRoute = /^\/add\/?$/i.test(location.pathname);
    isPublicOfficeLink = Boolean(officeId && officeId !== "platform" && (query.get("view") === "public" || publicSlug));
    isPlatformHome = !officeId || officeId === "platform" || isPlatformAddRoute;
  }
  const gate = document.createElement("main");
  function resolveWorkerBase() {
    if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
      return window.IAQAR.resolveWorkerBase();
    }
    try {
      const host = String(window.location && window.location.hostname || "").toLowerCase();
      if (host.includes("iaqar-ai-staging") || host.includes("--staging") || host.startsWith("staging.")) {
        return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
      }
    } catch (_) { /* ignore */ }
    return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  }
  const PROPERTY_TYPES = Object.freeze([
    "شقة", "فيلا", "دور", "دوبلكس", "عمارة", "أرض سكنية", "أرض تجارية",
    "محل تجاري", "مكتب", "مستودع", "استراحة", "مزرعة", "قصر", "بيت شعبي",
    "مجمع سكني", "مجمع تجاري"
  ]);
  const MADINAH_DISTRICTS = Object.freeze([
    "أبيار علي", "أبو بريقاء", "أبو سدر", "أحد", "الإسكان", "الأزهري", "الأصيفرين",
    "البدراني", "البركة", "البيداء", "الجامعة", "الجابرة", "الجصة", "الجماوات", "الجرف",
    "الجمعة", "الحرم الشريف", "الحساء", "الحديقة", "الخاتم", "الخالدية", "الدفاع", "الدعيثة",
    "الدويمة", "الراية", "الربوة", "الرانوناء", "الرمانة", "الروابي", "السحمان", "السد",
    "السلام", "السكب", "السيح", "الشريبات", "الشهباء", "الصادقية", "الصويدرة", "العالية",
    "العريض", "العزيزية", "العصبة", "العهن", "العنبرية", "العيون", "الغراء", "الفيصلية",
    "الفريش", "الفتح", "القصواء", "القبلتين", "المبعوث", "المطار", "المصانع", "المستراح",
    "المتنزه", "المزيين", "المغيسلة", "المفرحات", "المهدية", "المناخة", "الملك فهد",
    "النخيل", "النصر", "النقاء", "النقمى", "النواعم", "الهدراء", "الهجرة", "الوبرة",
    "باقدو", "بضاعة", "بني بياضة", "بني حارثة", "بني ظفر", "بني النجار", "تلعة الهبوب",
    "جبل أحد", "جبل عير", "جماء أم خالد", "جشم", "حرة الوبرة", "حمراء الأسد", "حزرة الجنوب",
    "ذو الحليفة", "رهط", "سد الغابة", "سكة الحديد", "سيد الشهداء", "شوران", "طيبة", "عروة",
    "عين الخيف", "قربان", "نبلاء", "وادي العقيق", "وادي مذينب", "وادي مهزور", "ورقان", "وعيرة"
  ]);

  document.head.insertAdjacentHTML("beforeend", `<style>
    body.access-locked{overflow-y:auto!important;height:auto!important;min-height:100%!important;background:#f4f8f6;
      overscroll-behavior-y:contain}body.access-locked>.app{display:none!important}
    .access-gate{min-height:100svh;padding:18px 18px calc(40px + env(safe-area-inset-bottom));box-sizing:border-box;display:flex;justify-content:center;
      background:#f4f8f6;color:#173d35;font-family:Tajawal,Arial,sans-serif;direction:rtl}
    .access-shell{width:min(100%,460px)}.access-brand,.access-card{background:#fff;border:1px solid #dce8e4;
      border-radius:24px;padding:20px;margin-bottom:12px}.access-brand{text-align:center;padding:14px 16px 12px;margin-bottom:8px}
    .access-brand img{width:52px;height:52px;object-fit:contain;display:block;margin:0 auto}
    .access-brand h1{margin:4px 0 2px;color:#087064;font-size:17px;line-height:1.25;font-weight:800}
    .access-brand p{color:#687c76;font-size:12px;line-height:1.55;margin:0}
    .access-card p{color:#687c76;font-size:14px;line-height:1.7;margin:0 0 14px}
    .access-card h2{color:#087064;font-size:21px;margin:0 0 6px}.access-options{display:grid;gap:10px}
    .access-btn{min-height:56px;border:0;border-radius:16px;padding:11px 15px;background:#128c7e;color:#fff;
      font:800 17px Tajawal;cursor:pointer}.access-btn.secondary{background:#fff;color:#087064;border:1.5px solid #128c7e}
    .access-btn.light{background:#eaf7f3;color:#087064}.access-btn:disabled{opacity:.55}
    .access-back{border:0;background:none;color:#087064;font:700 14px Tajawal;margin:0 0 8px;cursor:pointer}
    .access-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.access-form label{display:grid;gap:5px;
      font-size:13px;font-weight:700;color:#36574f}.access-form .full{grid-column:1/-1}
    .access-form input,.access-form select,.access-form textarea{box-sizing:border-box;width:100%;border:1px solid #d4e3de;border-radius:14px;
      padding:12px;font:500 15px Tajawal;background:#fff}.access-form textarea{min-height:86px;resize:vertical}
    .access-form .conditional-field[hidden]{display:none}
    .file-help{font-size:12px!important;color:#71817d!important;margin:0!important}.access-status{display:none;margin-top:11px;
      padding:11px;border-radius:13px;font-size:14px;line-height:1.6}.access-status.show{display:block}
    .access-status.ok{background:#e8f7f2;color:#07634f}.access-status.err{background:#fff0f0;color:#9e3434}
    .access-field-error{color:#9e3434;font-size:12px;line-height:1.4;margin-top:2px}
    .access-remember{display:flex!important;align-items:center;gap:8px;font-weight:700}
    .access-remember input{width:auto;margin:0}
    .access-note{text-align:center;color:#71817d;font-size:12px;line-height:1.7;margin-top:12px}
    .access-field-label{font-size:13px;font-weight:700;color:#36574f}
    .access-required-mark{color:#c0392b;font-weight:800;font-size:12px;line-height:1}
    .access-voice-slot{margin-bottom:4px}
    .access-voice-slot .voice-intake-panel{margin:0;padding:0;border:0;background:transparent}
    .access-voice-slot .voice-intake-start{width:100%;min-height:48px;margin:0;padding:11px 15px;border-radius:16px;
      border:1.5px solid #128c7e;background:#fff;color:#087064;font:700 15px Tajawal;cursor:pointer}
    .access-voice-slot .voice-intake-status{margin:6px 0 0;min-height:12px;font-size:12px}
    .voice-intake-panel{margin-top:12px;padding:12px;border:1px dashed #d4e3de;border-radius:16px;background:#f5faf8}
    @media (max-width:430px){.access-brand{padding:13px 14px 11px;margin-bottom:7px}
      .access-brand img{width:50px;height:50px}.access-brand h1{font-size:16px;margin-top:3px}
      .access-brand p{font-size:11.5px;line-height:1.5}}
    @media (max-width:390px){.access-brand img{width:48px;height:48px}.access-brand h1{font-size:15px}}
    @media (max-width:360px){.access-brand{padding:12px 12px 10px}.access-brand img{width:46px;height:46px}}
    @media (max-width:320px){.access-brand h1{font-size:14.5px}.access-brand p{font-size:11px}}
    .voice-intake-recording,.voice-intake-actions{display:none!important}
    .voice-intake-recording.is-active{display:flex!important;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#a1332c}
    .voice-intake-actions.is-active{display:flex!important;flex-wrap:wrap;gap:8px;margin-top:8px}
    .voice-intake-recording[hidden],.voice-intake-actions[hidden],.voice-intake-start[hidden]{display:none!important}
    .voice-intake-start{width:100%}
    .voice-intake-stop,.voice-intake-cancel,.voice-intake-retry,.voice-intake-manual{border:1px solid #d4e3de;background:#fff;color:#087064;border-radius:12px;padding:8px 12px;font-size:12px;font-weight:800;cursor:pointer}
    .voice-intake-status{margin:8px 0 0;min-height:14px;font-size:12px;color:#71817d}
    .voice-intake-status.is-error{color:#9e3434}
    .arabic-suggest-wrap{position:relative;display:grid;gap:0}
    .arabic-suggest-input{width:100%}
    .arabic-suggest-list{list-style:none;margin:4px 0 0;padding:0;border:1px solid #d4e3de;border-radius:12px;background:#fff;max-height:180px;overflow:auto;z-index:5}
    .arabic-suggest-list[hidden]{display:none!important}
    .arabic-suggest-list button{width:100%;border:0;background:none;padding:10px 12px;text-align:right;font:500 15px Tajawal;cursor:pointer;color:#173d35}
    .arabic-suggest-list button:hover{background:#eaf7f3}
    @media(max-width:420px){.access-form{grid-template-columns:1fr}.access-form .full{grid-column:auto}}
    .access-chip-section{display:grid;gap:8px}
    .access-chip-label{font-size:13px;font-weight:700;color:#36574f}
    .access-chip-row{display:flex;flex-wrap:wrap;gap:8px}
    .access-chip-row--purpose{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .access-chip-row--property{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
    .access-chip-row--property .access-chip,.access-chip-row--purpose .access-chip{width:100%;justify-content:center;text-align:center}
    .access-chip{min-height:40px;padding:8px 14px;border-radius:12px;border:1.5px solid #128c7e;background:#fff;color:#087064;
      font:700 14px Tajawal;cursor:pointer;display:flex;align-items:center}
    .access-chip.is-selected{background:#128c7e;color:#fff}
    .access-chip-row--property .access-chip{min-height:36px;padding:6px 10px;font-size:13px}
    #propertyTypeOtherWrap[hidden]{display:none!important}
  </style>`);

  gate.className = "access-gate";
  gate.id = "accessGate";
  if (typeof window.__IAQAR_PARTY_DIAG__ === "function") {
    window.__IAQAR_PARTY_DIAG__("ACCESS_GATE_RENDERED");
  }
  document.body.classList.add("access-locked");
  document.body.appendChild(gate);

  const logoSrc = "/icons/iaqar-default-icon-192.png";
  const db = () => firebase.firestore();
  const optionList = values => values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  const normalizeSaudiPhone = value => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("00966")) digits = digits.slice(2);
    if (digits.startsWith("966")) digits = `0${digits.slice(3)}`;
    if (digits.startsWith("5") && digits.length === 9) digits = `0${digits}`;
    return /^05\d{8}$/.test(digits) ? digits : "";
  };
  const normalizeLoginPhone = value => {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("00966")) digits = digits.slice(2);
    if (digits.startsWith("966")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return /^5\d{8}$/.test(digits) ? `+966${digits}` : "";
  };
  let authGuardState = "loading";
  let authInitComplete = false;
  let accessVerificationInFlight = false;
  let accessGrantedForOffice = false;
  let explicitSignOutRequested = false;
  let loginSubmitInFlight = false;
  let authReady = false;
  let authStateReady = false;
  let authStateUnsubscribe = null;

  const LOGIN_PERF_ENABLED = (() => {
    try {
      const host = String(location.hostname || "").toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host.includes("staging")) return true;
      return localStorage.getItem("iaqar.login.perf") === "1";
    } catch (_) {
      return false;
    }
  })();

  function loginPerfMark(name) {
    if (!LOGIN_PERF_ENABLED) return;
    try { performance.mark(`iaqar-login:${name}`); } catch (_) { /* ignore */ }
  }

  function loginPerfMeasure(label, startMark, endMark) {
    if (!LOGIN_PERF_ENABLED) return null;
    try {
      const measureName = `iaqar-login:${label}`;
      performance.measure(measureName, `iaqar-login:${startMark}`, `iaqar-login:${endMark}`);
      const entry = performance.getEntriesByName(measureName).pop();
      if (entry) {
        console.info(`[iaqar-login-perf] ${label}: ${entry.duration.toFixed(1)}ms`);
        return entry.duration;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function loginPerfReport() {
    if (!LOGIN_PERF_ENABLED) return;
    try {
      const marks = performance.getEntriesByType("mark")
        .filter((entry) => String(entry.name || "").startsWith("iaqar-login:"));
      const measures = performance.getEntriesByType("measure")
        .filter((entry) => String(entry.name || "").startsWith("iaqar-login:"));
      console.table(measures.map((entry) => ({
        مرحلة: entry.name.replace(/^iaqar-login:/, ""),
        مللي_ثانية: Number(entry.duration.toFixed(1))
      })));
      if (!measures.length && marks.length) {
        console.info("[iaqar-login-perf] marks", marks.map((entry) => entry.name));
      }
    } catch (_) { /* ignore */ }
  }

  function authDiag(event, detail = {}) {
    try {
      console.info(`[iaqar-auth] ${event}`, detail);
    } catch (_) { /* ignore */ }
  }

  async function authSignOut(source, reason = "") {
    authDiag("SIGN_OUT_CALL", { source, reason });
    authDiag("SIGNOUT_CALL_SOURCE", { source, reason });
    explicitSignOutRequested = source === "user_logout" || source === "admin_logout";
    try { await firebase.auth().signOut(); } catch (_) {}
    authGuardState = "unauthenticated";
    accessGrantedForOffice = false;
  }

  function loginRedirect(target, source) {
    authDiag("REDIRECT_REASON", { source, target });
    authDiag("LOGIN_REDIRECT_SOURCE", { source, target });
    try {
      const next = new URL(target, location.origin);
      const partyToken = String(window.__IAQAR_PARTY_TOKEN__ || new URLSearchParams(location.search).get("cv2Party") || "").trim();
      if (partyToken && !next.searchParams.get("cv2Party")) next.searchParams.set("cv2Party", partyToken);
      if (next.origin === location.origin && next.pathname === location.pathname) {
        history.replaceState({}, "", `${next.pathname}${next.search}${next.hash}`);
        return;
      }
      target = next.href;
    } catch (_) { /* fall through */ }
    location.replace(target);
  }

  function waitForOfficeDb(timeoutMs = 20000) {
    if (window.IAQAR?.office?.db) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.removeEventListener("iaqar:firebase-ready", onReady);
        clearTimeout(timer);
        resolve(ok);
      };
      const onReady = () => {
        if (window.IAQAR?.office?.db) finish(true);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      window.addEventListener("iaqar:firebase-ready", onReady);
      if (window.IAQAR?.office?.db) finish(true);
    });
  }

  function showAuthLoading(message = "جارٍ التحقق من الحساب…") {
    showAccessGate();
    frame(`<section class="access-card"><h2>${message}</h2>
      <p>يرجى الانتظار قليلًا قبل فتح لوحة المكتب.</p></section>`, "auth-loading");
  }

  async function unlockOfficeWorkspace(target) {
    const normalized = firestoreOfficeId(target);
    if (!normalized || normalized === "platform") return false;
    authDiag("OFFICE_LOADING", { officeId: normalized });
    const dbReady = await waitForOfficeDb();
    if (!dbReady) {
      authDiag("REDIRECT_REASON", { reason: "office_runtime_not_ready", officeId: normalized });
      return false;
    }
    localStorage.setItem("iaqar.officeId", normalized);
    officeId = normalized;
    refreshRouteFlags();
    let rebound = false;
    if (window.IAQAR && typeof window.IAQAR.rebindOfficeContext === "function") {
      rebound = window.IAQAR.rebindOfficeContext(normalized);
    } else if (dbReady && officeIdsEquivalent(window.IAQAR?.office?.officeId, normalized)) {
      rebound = true;
      authDiag("OFFICE_FOUND", { officeId: normalized, source: "existing_office_context" });
    }
    if (!rebound) {
      authDiag("REDIRECT_REASON", { reason: "office_rebind_failed", officeId: normalized });
      return false;
    }
    authDiag("OFFICE_FOUND", { officeId: normalized });
    const params = new URLSearchParams(location.search);
    params.set("office", normalized);
    const nextUrl = `${location.pathname}?${params.toString()}${location.hash || ""}`;
    history.replaceState({}, "", nextUrl);
    document.body.classList.remove("access-locked");
    if (gate.isConnected) gate.remove();
    authGuardState = "authenticated";
    accessGrantedForOffice = true;
    loginPerfMark("workspace_visible");
    window.dispatchEvent(new CustomEvent("iaqar:access-granted", {
      detail: { officeId: normalized, source: "unlock_office_workspace" }
    }));
    return true;
  }

  function loginFailureMessage(stage, detail = {}) {
    const isStaging = window.IAQAR && window.IAQAR.deploymentEnvironment === "staging";
    if (stage === "office_access") return "هذا الحساب غير مخوّل للمكتب المطلوب.";
    if (detail.reason === "rate_limited" || detail.reason === "too_many_requests") {
      return "محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة.";
    }
    if (detail.reason === "directory_missing") {
      return isStaging ? "فشل الدخول: رقم الجوال غير مسجل في loginDirectory." : "بيانات الدخول غير صحيحة أو الحساب غير مخوّل لهذا المكتب.";
    }
    if (detail.reason === "directory_inactive") {
      return isStaging ? "فشل الدخول: سجل loginDirectory غير مفعّل أو ناقص." : "بيانات الدخول غير صحيحة أو الحساب غير مخوّل لهذا المكتب.";
    }
    if (stage === "password_sign_in") {
      if (detail.code === "auth/wrong-password" || detail.code === "auth/invalid-credential" || detail.code === "auth/user-not-found") {
        return isStaging ? "فشل التحقق من كلمة المرور في Firebase Auth." : "بيانات الدخول غير صحيحة أو الحساب غير مخوّل لهذا المكتب.";
      }
      if (detail.code === "auth/too-many-requests") return "محاولات كثيرة — انتظر قليلًا ثم أعد المحاولة.";
      if (detail.code === "auth/user-disabled") return "الحساب معطّل.";
    }
    if (isStaging && detail.reason) return `فشل تسجيل الدخول (${detail.reason}).`;
    return "بيانات الدخول غير صحيحة أو الحساب غير مخوّل لهذا المكتب.";
  }

  function showAccessError(title, message, retryHandler) {
    showAccessGate();
    frame(`<section class="access-card"><h2>${title}</h2>
      <p>${message}</p>
      ${retryHandler ? '<button class="access-btn" id="accessRetry" type="button">إعادة المحاولة</button>' : ""}
      <button class="access-btn light" id="accessSignOut" type="button" style="margin-top:10px">تسجيل الخروج</button>
    </section>`);
    if (retryHandler) gate.querySelector("#accessRetry").onclick = retryHandler;
    const signOutBtn = gate.querySelector("#accessSignOut");
    if (signOutBtn) {
      signOutBtn.onclick = async () => {
        await authSignOut("user_logout", "access_error_sign_out");
        loginForm();
      };
    }
  }
  const validFullName = value => String(value || "").trim().split(/\s+/).filter(Boolean).length >= 2;

  async function uploadPublicMedia({ file, targetOffice, intakeId, kind, index = 0 }) {
    const response = await fetch(`${resolveWorkerBase()}/media/public-intake`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-Office-Id": targetOffice,
        "X-Intake-Id": intakeId,
        "X-Media-Kind": kind,
        "X-Media-Index": String(index)
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.mediaPath) throw new Error(result.error || "MEDIA_UPLOAD_FAILED");
    return result.mediaPath;
  }


  async function triggerPublicIntakeMatching(targetOffice, intakeId) {
    const response = await fetch(`${resolveWorkerBase()}/pipeline/public-intake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: targetOffice, intakeId })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "MATCHING_FAILED");
    return result;
  }

  function frame(content, screenId = "") {
    gate.dataset.activeScreen = screenId;
    gate.innerHTML = `<div class="access-shell"><section class="access-brand">
      <img src="${logoSrc}" alt="مكاتب عقارية ذكية"><h1>مكاتب عقارية ذكية</h1>
      <p>منصة تشغيل الوسطاء العقاريين</p></section>${content}</div>`;
  }
  function bindAccessBack(handler) {
    const back = gate.querySelector(".access-back");
    if (!back) return;
    back.onclick = (event) => {
      event.preventDefault();
      handler();
    };
  }
  function showStatus(message, ok = false) {
    const node = gate.querySelector("#accessStatus");
    if (!node) return;
    node.textContent = message;
    node.className = `access-status show ${ok ? "ok" : "err"}`;
  }
  function home() {
    if (isPlatformAddRoute) {
      platformAddChoice();
      return;
    }
    frame(`<section class="access-card"><h2>اختر الخدمة</h2>
      <p>رفع الطلب مباشر للعميل والمالك، وتسجيل الوسيط يخضع لمراجعة رخصة فال واعتماد الإدارة.</p>
      <div class="access-options">
        <button class="access-btn" data-go="owner">لدي عقار</button>
        <button class="access-btn secondary" data-go="client">أبحث عن عقار</button>
        <button class="access-btn secondary" data-go="login">دخول مكتب مسجل</button>
      </div>
      <div class="access-note">الصفحة العامة لا تعرض بيانات أي مكتب أو إعداداته.</div>
      <div class="access-options" style="margin-top:12px">
        <button class="access-btn light" data-go="broker">تسجيل وسيط عقاري</button>
      </div>
      <div class="access-note">للاستفسار عن تسجيل الوسيط:
        <a href="https://wa.me/966552019909" target="_blank" rel="noopener noreferrer">واتساب 0552019909</a></div></section>`);
    gate.querySelectorAll("[data-go]").forEach(button => button.onclick = () => {
      if (button.dataset.go === "broker") brokerForm();
      else if (button.dataset.go === "login") loginForm();
      else intakeForm(button.dataset.go, "platform");
    });
    gate.dataset.activeScreen = "home";
  }
  function platformAddChoice() {
    frame(`<section class="access-card" data-testid="platform-add">
      <h2>إضافة فرصة للمنصة</h2>
      <p>أرسل عرضك أو طلبك، والمنصة ترشّح المكتب الأنسب.</p>
      <div class="access-options">
        <button class="access-btn" data-go="owner" data-testid="add-offer">لدي عقار</button>
        <button class="access-btn secondary" data-go="client" data-testid="add-request">أبحث عن عقار</button>
      </div>
      <div class="access-note">لا يحتاج هذا النموذج إلى إنشاء حساب.</div>
    </section>`);
    gate.querySelectorAll("[data-go]").forEach(button => {
      button.onclick = () => intakeForm(button.dataset.go, "platform");
    });
    gate.dataset.activeScreen = "platform-add";
  }
  function resolvePublicOfficeImage(data = {}, targetOfficeId = "") {
    const oid = String(targetOfficeId || "").trim().toLowerCase();
    const canonicalLogo = oid && oid !== "platform"
      ? `${resolveWorkerBase()}/media/public/office-covers/${encodeURIComponent(oid)}/logo`
      : "";
    // Always prefer the live R2 logo object so public and Office Card stay aligned.
    if (canonicalLogo) return canonicalLogo;
    const logo = String(data.logoUrl || "").trim();
    if (logo) return logo;
    const display = String(data.displayImageUrl || "").trim();
    if (display) return display;
    return String(data.coverUrl || "").trim();
  }

  function withImageCacheBust(url, updatedAt) {
    const source = String(url || "").trim();
    if (!source) return "";
    let stamp = "";
    if (updatedAt && typeof updatedAt.toMillis === "function") stamp = String(updatedAt.toMillis());
    else if (updatedAt && typeof updatedAt.seconds === "number") stamp = String(updatedAt.seconds * 1000);
    else if (updatedAt) stamp = String(updatedAt).trim();
    if (!stamp) stamp = String(Date.now());
    return `${source}${source.includes("?") ? "&" : "?"}v=${encodeURIComponent(stamp)}`;
  }

  function phoneDisplayHtml(phone) {
    const raw = String(phone || "").trim();
    if (!raw) return "";
    return `<span class="phone-ltr" dir="ltr">${escapeHtml(raw)}</span>`;
  }

  async function publicOffice() {
    frame(`<section class="access-card"><h2>خدمات المكتب</h2>
      <p>ارفع طلبك مباشرة دون تسجيل، ولا يمكن للزائر الوصول إلى مساحة المكتب أو إعداداته.</p>
      <div id="publicOfficeProfile"></div>
      <div class="access-options"><button class="access-btn" data-go="owner">لدي عقار</button>
      <button class="access-btn secondary" data-go="client">أبحث عن عقار</button>
      <button class="access-btn light" id="publicHome">المنصة العامة</button></div></section>`, "public-office");
    gate.dataset.activeScreen = "public-office";
    gate.querySelectorAll("[data-go]").forEach(button => button.onclick = () => intakeForm(button.dataset.go, officeId));
    gate.querySelector("#publicHome").onclick = () => location.assign("/");
    try {
      const snap = await db().collection("publicOffices").doc(officeId).get();
      if (snap.exists) {
        const data = snap.data() || {};
        const primary = withImageCacheBust(
          resolvePublicOfficeImage(data, officeId),
          data.updatedAt || Date.now()
        );
        const fallbackCover = withImageCacheBust(String(data.coverUrl || "").trim(), data.updatedAt || "");
        const fallbackDisplay = withImageCacheBust(String(data.displayImageUrl || "").trim(), data.updatedAt || "");
        const fallback = fallbackCover || fallbackDisplay || "";
        const canonicalSlug = String(data.publicSlug || "").trim().toLowerCase();
        if (canonicalSlug && !/^\/m\//i.test(location.pathname)) {
          try { history.replaceState({}, "", `/m/${encodeURIComponent(canonicalSlug)}`); } catch (_) {}
        }
        const phoneHtml = data.phone ? ` — تواصل ${phoneDisplayHtml(data.phone)}` : "";
        const whatsappHtml = data.whatsapp ? ` — واتساب ${phoneDisplayHtml(data.whatsapp)}` : "";
        const ratingCount = Number(data.ratingCount || 0);
        const ratingAverage = Number(data.ratingAverage || 0);
        const ratingHtml = ratingCount > 0
          ? `<p data-testid="office-rating">${ratingAverage.toFixed(1)} ★ · ${ratingCount} تقييمًا</p>`
          : "";
        const imgTag = primary
          ? `<img src="${escapeHtml(primary)}" alt="صورة المكتب" data-fallback="${escapeHtml(fallback)}"
              style="width:100%;height:180px;object-fit:cover;border-radius:16px;margin-bottom:10px"
              onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.remove();}">`
          : "";
        gate.querySelector("#publicOfficeProfile").innerHTML = `
          ${imgTag}
          <h2>${escapeHtml(data.officeName || "مكتب عقاري")}</h2>
          <p>${escapeHtml(data.brokerName || "وسيط عقاري")} — رخصة فال ${escapeHtml(data.licenseNumber || "—")}
          <br>${escapeHtml(data.city || "")}${phoneHtml}${whatsappHtml}</p>
          ${ratingHtml}`;
      }
    } catch (_) {}
  }
  async function resolveIntakeDefaultCity(targetOffice) {
    const target = firestoreOfficeId(targetOffice);
    if (target && target !== "platform") {
      try {
        const publicSnap = await db().collection("publicOffices").doc(target).get();
        if (publicSnap.exists) {
          const city = String(publicSnap.data()?.city || "").trim();
          if (city) return city;
        }
        const officeSnap = await db().collection("offices").doc(target).get();
        if (officeSnap.exists) {
          const city = String(officeSnap.data()?.city || "").trim();
          if (city) return city;
        }
      } catch (_) { /* ignore */ }
    }
    const remembered = window.IAQARPublicClientIntake?.readRememberedCity?.() || "";
    return remembered || "";
  }

  function clientIntakeApi() {
    return window.IAQARPublicClientIntake || null;
  }

  function quickChoiceApi() {
    return window.IAQARPublicIntakeQuickChoice || null;
  }

  function accessRequiredLabel(text) {
    return `<span class="access-field-label">${escapeHtml(text)} <span class="access-required-mark" aria-hidden="true">*</span></span>`;
  }

  function accessOptionalLabel(text) {
    return `<span>${escapeHtml(text)}</span>`;
  }

  function updateIntakePriceLabel(scope, owner) {
    const label = scope?.querySelector("#intakePriceLabel");
    const api = quickChoiceApi();
    if (!label || !api) return;
    const purposeChip = String(scope.querySelector("#intakePurposeValue")?.value || "").trim();
    const text = api.intakePriceFieldLabel(owner, purposeChip) || "السعر";
    label.innerHTML = `${escapeHtml(text)} <span class="access-required-mark" aria-hidden="true">*</span>`;
  }

  function intakePurposeChipHtml(isOwner) {
    const api = quickChoiceApi();
    const options = isOwner ? (api?.OWNER_PURPOSE_OPTIONS || []) : (api?.CLIENT_PURPOSE_OPTIONS || []);
    return options.map((opt) =>
      `<button type="button" class="access-chip" data-chip-group="purpose" data-chip-id="${escapeHtml(opt.id)}"
        data-testid="intake-chip-purpose-${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</button>`
    ).join("");
  }

  function intakePropertyChipHtml() {
    const api = quickChoiceApi();
    const options = api?.PROPERTY_TYPE_OPTIONS || [];
    return options.map((opt) =>
      `<button type="button" class="access-chip" data-chip-group="property" data-chip-id="${escapeHtml(opt.id)}"
        data-testid="intake-chip-property-${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</button>`
    ).join("");
  }

  function wireIntakeQuickChoices(scope, {
    owner,
    onPurposeChange,
    onPropertyChange
  } = {}) {
    const api = quickChoiceApi();
    const form = scope?.querySelector("#intakeForm");
    if (!api || !form) return null;
    const purposeHidden = scope.querySelector("#intakePurposeValue");
    const propertyInput = scope.querySelector("#propertyTypeInput");
    const propertyOtherWrap = scope.querySelector("#propertyTypeOtherWrap");
    const propertyOtherInput = scope.querySelector("#propertyTypeOtherInput");
    const requestKindInput = scope.querySelector("#requestKindInput");
    const transactionTypeInput = scope.querySelector("#transactionTypeInput");

    const setPurpose = (chipId) => {
      if (owner) {
        const row = api.ownerPurposeFromChip(chipId);
        if (!row) return;
        if (transactionTypeInput) transactionTypeInput.value = row.transactionType;
        if (purposeHidden) purposeHidden.value = row.id;
      } else {
        const row = api.clientPurposeFromChip(chipId);
        if (!row) return;
        if (requestKindInput) requestKindInput.value = row.requestKind;
        if (purposeHidden) purposeHidden.value = row.id;
      }
      updateIntakePriceLabel(scope, owner);
      onPurposeChange?.();
    };

    const setProperty = (chipId) => {
      if (propertyInput) propertyInput.dataset.chipId = chipId;
      scope.querySelectorAll("[data-chip-group=\"property\"]").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.chipId === chipId);
      });
      const isOther = chipId === "other";
      if (propertyOtherWrap) propertyOtherWrap.hidden = !isOther;
      if (propertyOtherInput) {
        propertyOtherInput.required = isOther;
        if (!isOther) propertyOtherInput.value = "";
      }
      if (propertyInput) {
        propertyInput.value = isOther
          ? String(propertyOtherInput?.value || "").trim()
          : api.propertyTypeFromChip(chipId, "");
      }
      onPropertyChange?.();
    };

    scope.querySelectorAll(".access-chip").forEach((button) => {
      button.onclick = () => {
        const group = button.dataset.chipGroup;
        scope.querySelectorAll(`[data-chip-group="${group}"]`).forEach((node) => {
          node.classList.toggle("is-selected", node === button);
        });
        if (group === "purpose") setPurpose(button.dataset.chipId);
        else if (group === "property") setProperty(button.dataset.chipId);
      };
    });

    if (propertyOtherInput) {
      propertyOtherInput.addEventListener("input", () => {
        if (propertyInput?.dataset.chipId === "other") {
          propertyInput.value = String(propertyOtherInput.value || "").trim();
          onPropertyChange?.();
        }
      });
    }

    return {
      syncFromValues(values = {}) {
        const purposeChip = owner
          ? api.inferOwnerPurposeChip(values.transactionType, values.purpose)
          : api.inferClientPurposeChip(values.requestKind, values.transactionType);
        if (purposeChip) {
          scope.querySelectorAll("[data-chip-group=\"purpose\"]").forEach((btn) => {
            if (btn.dataset.chipId === purposeChip) btn.click();
          });
        }
        const propertyChip = api.inferPropertyTypeChip(values.propertyType);
        if (propertyChip) {
          if (propertyChip === "other" && propertyOtherInput) {
            propertyOtherInput.value = values.propertyType || "";
          }
          scope.querySelectorAll("[data-chip-group=\"property\"]").forEach((btn) => {
            if (btn.dataset.chipId === propertyChip) btn.click();
          });
        }
      }
    };
  }

  function renderDynamicClientFields(container, requestKind, propertyType) {
    const api = clientIntakeApi();
    if (!container || !api) return;
    const defs = api.dynamicFieldDefs(requestKind, propertyType);
    container.innerHTML = defs.map((field) => {
      const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
      return `<label class="conditional-field"><span>${escapeHtml(field.label)}</span>
        <input name="${escapeHtml(field.name)}" type="${field.type || "text"}"
          ${field.inputMode ? `inputmode="${field.inputMode}"` : ""}
          ${field.maxLength ? `maxlength="${field.maxLength}"` : ""}${placeholder} autocomplete="off"></label>`;
    }).join("");
  }

  function wireArabicSuggestInput(input, options = []) {
    if (!input || input.dataset.arabicSuggestWired === "1") return;
    input.dataset.arabicSuggestWired = "1";
    input.classList.add("arabic-suggest-input");
    const wrap = input.closest("label") || input.parentElement;
    if (wrap) wrap.classList.add("arabic-suggest-wrap");
    const list = document.createElement("ul");
    list.className = "arabic-suggest-list";
    list.hidden = true;
    input.insertAdjacentElement("afterend", list);
    const source = (options || []).map((v) => String(v || "").trim()).filter(Boolean);
    const render = (query = "") => {
      const q = String(query || "").trim().toLowerCase();
      const filtered = source.filter((entry) => !q || entry.toLowerCase().includes(q)).slice(0, 12);
      list.innerHTML = filtered.map((entry) =>
        `<li><button type="button" data-pick="${escapeHtml(entry)}">${escapeHtml(entry)}</button></li>`
      ).join("");
      list.hidden = filtered.length === 0;
    };
    input.addEventListener("focus", () => render(input.value));
    input.addEventListener("input", () => render(input.value));
    list.addEventListener("mousedown", (event) => {
      const btn = event.target.closest("[data-pick]");
      if (!btn) return;
      event.preventDefault();
      input.value = btn.getAttribute("data-pick") || "";
      list.hidden = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    document.addEventListener("click", (event) => {
      if (!wrap?.contains(event.target)) list.hidden = true;
    });
  }

  function applyPublicVoicePrefill(form, structured, {
    owner,
    refreshClientDynamic
  }) {
    const api = window.IAQARGeminiVoiceIntake;
    if (!api || !form) return;
    const manual = {
      name: form.elements.name?.value || "",
      phone: form.elements.phone?.value || ""
    };
    const values = api.mapGeminiToPublicFormValues(structured, {
      context: owner ? "owner" : "client",
      manualValues: manual
    });
    const set = (name, value) => {
      const el = form.elements[name];
      if (!el || value == null || String(value).trim() === "") return;
      el.value = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("name", values.name);
    set("phone", values.phone);
    set("city", values.city);
    set("district", values.district);
    set("priceOrBudget", values.priceOrBudget ?? values.budget ?? values.annualRent);
    set("budget", values.budget);
    set("annualRent", values.annualRent);
    set("area", values.area);
    set("rooms", values.rooms);
    set("bathrooms", values.bathrooms);
    set("streetWidth", values.streetWidth);
    set("facing", values.facing);
    set("details", values.details);
    const quickSync = gate.__intakeQuickChoiceSync;
    if (quickSync) {
      quickSync.syncFromValues({
        requestKind: values.requestKind,
        transactionType: values.transactionType,
        purpose: values.purpose,
        propertyType: values.propertyType
      });
    }
    if (!owner) refreshClientDynamic();
    updateIntakePriceLabel(gate, owner);
    showStatus("تم تعبئة النموذج من التسجيل — راجع الحقول قبل الإرسال.");
  }

  async function mountPublicVoicePanel({
    kind,
    targetOffice,
    form,
    refreshClientDynamic
  }) {
    const panel = gate.querySelector("#publicVoiceIntakePanel");
    if (!panel || panel.dataset.voiceBound === "1" || panel.dataset.voiceMounting === "1") return;
    panel.dataset.voiceMounting = "1";
    try {
      const { mountVoiceIntakePanel, VOICE_UI_BUILD } = await import("./gemini-voice-intake-ui.js");
      mountVoiceIntakePanel(panel, {
        context: kind === "owner" ? "owner" : "client",
        officeId: targetOffice,
        workerBase: resolveWorkerBase(),
        publicRoute: true,
        startLabel: "🎙️ إضافة بالصوت",
        onStructured(structured) {
          applyPublicVoicePrefill(form, structured, {
            owner: kind === "owner",
            refreshClientDynamic
          });
        }
      });
      panel.dataset.voiceBuild = VOICE_UI_BUILD || "";
    } catch (error) {
      console.warn("[iaqar] public voice panel", error);
    } finally {
      delete panel.dataset.voiceMounting;
    }
  }

  async function intakeForm(kind, targetOffice) {
    const owner = kind === "owner";
    const defaultCity = await resolveIntakeDefaultCity(targetOffice);
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>${owner ? "إضافة عرض مالك" : "إضافة طلب عميل"}</h2>
      <p>لا يحتاج هذا النموذج إلى إنشاء حساب.</p>
      <form class="access-form" id="intakeForm">
        <div class="access-chip-section full">
          ${accessRequiredLabel("الغرض")}
          <div class="access-chip-row access-chip-row--purpose">${intakePurposeChipHtml(owner)}</div>
          <input type="hidden" id="intakePurposeValue" value="">
          ${owner
    ? `<input type="hidden" name="transactionType" id="transactionTypeInput" value="">`
    : `<input type="hidden" name="requestKind" id="requestKindInput" value="">`}
        </div>
        <div class="access-chip-section full">
          ${accessRequiredLabel("نوع العقار")}
          <div class="access-chip-row access-chip-row--property">${intakePropertyChipHtml()}</div>
          <label id="propertyTypeOtherWrap" class="full" hidden>
            ${accessRequiredLabel("اكتب نوع العقار")}
            <input id="propertyTypeOtherInput" maxlength="40" autocomplete="off" placeholder="اكتب نوع العقار">
          </label>
          <input type="hidden" name="propertyType" id="propertyTypeInput" value="">
        </div>
        <label>${accessRequiredLabel("المدينة")}<input name="city" id="intakeCityInput" maxlength="80" required
          value="${escapeHtml(defaultCity)}"></label>
        <label class="full">${accessRequiredLabel("الحي")}
          <input name="district" id="districtInput" maxlength="80" required autocomplete="off"
            placeholder="اكتب اسم الحي"></label>
        <label class="full">
          <span id="intakePriceLabel" class="access-field-label">السعر <span class="access-required-mark" aria-hidden="true">*</span></span>
          <input name="priceOrBudget" data-testid="${owner ? "owner-price" : "client-price"}" inputmode="numeric" maxlength="12" required autocomplete="off"
            placeholder="مثال: 500000"></label>
        ${owner
    ? ""
    : `<div id="clientDynamicFields" class="access-form full" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"></div>`}
        <div id="publicVoiceIntakePanel" class="full access-voice-slot"></div>
        <label class="full">${accessOptionalLabel("تفاصيل إضافية (اختياري)")}<textarea name="details" maxlength="1000"></textarea></label>
        ${owner ? `<label class="full">${accessOptionalLabel("صور العقار (اختياري، حتى 5 صور)")}
          <input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple>
          <p class="file-help">يمكن إرسال العرض دون صور، ويطلبها الوسيط لاحقًا عبر واتساب. بحد أقصى 8 ميجابايت للصورة.</p></label>
          <label class="full">${accessOptionalLabel("فيديو العقار (اختياري)")}
          <input name="video" type="file" accept="video/mp4,video/webm,video/quicktime">
          <p class="file-help">فيديو واحد بحد أقصى 90 ميجابايت.</p></label>` : ""}
        <label>${accessRequiredLabel("الاسم الثنائي على الأقل")}<input name="name" maxlength="80" required></label>
        <label>${accessRequiredLabel("رقم الجوال")}<input name="phone" inputmode="tel" maxlength="20" required></label>
        <label class="full"><button class="access-btn" type="submit">${owner ? "إرسال العرض" : "إرسال الطلب"}</button></label>
      </form><div id="accessStatus" class="access-status"></div></section>`, kind === "owner" ? "owner-intake" : "client-intake");
    bindAccessBack(() => (isPublicOfficeLink ? publicOffice() : (isPlatformAddRoute ? platformAddChoice() : home())));
    const propertyInput = gate.querySelector("#propertyTypeInput");
    const districtInput = gate.querySelector("#districtInput");
    const requestKindInput = gate.querySelector("#requestKindInput");
    const dynamicFields = gate.querySelector("#clientDynamicFields");
    const clientApi = clientIntakeApi();
    const refreshClientDynamic = () => {
      if (owner || !dynamicFields) return;
      const requestKind = clientApi?.normalizeRequestKind
        ? clientApi.normalizeRequestKind(requestKindInput?.value || "")
        : String(requestKindInput?.value || "").trim();
      const propertyType = String(propertyInput?.value || "").trim();
      renderDynamicClientFields(dynamicFields, requestKind, propertyType);
    };
    gate.__intakeQuickChoiceSync = wireIntakeQuickChoices(gate, {
      owner,
      onPurposeChange: refreshClientDynamic,
      onPropertyChange: refreshClientDynamic
    });
    updateIntakePriceLabel(gate, owner);
    gate.querySelectorAll("input,select,textarea").forEach(field => field.addEventListener("focus", () => {
      setTimeout(() => field.scrollIntoView({ behavior: "smooth", block: "center" }), 180);
    }));
    void mountPublicVoicePanel({
      kind,
      targetOffice,
      form: gate.querySelector("#intakeForm"),
      refreshClientDynamic
    });
    gate.querySelector("#intakeForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const name = String(fields.get("name") || "").trim().replace(/\s+/g, " ");
      if (!validFullName(name)) return showStatus("أدخل الاسم الثنائي على الأقل.");
      const phone = normalizeSaudiPhone(fields.get("phone"));
      if (!phone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      const city = String(fields.get("city") || "").trim();
      if (!city) return showStatus("أدخل المدينة.");
      const quickApi = quickChoiceApi();
      const purposeChip = String(gate.querySelector("#intakePurposeValue")?.value || "").trim();
      if (!purposeChip) {
        return showStatus(owner ? "اختر بيع أو تأجير." : "اختر شراء أو استئجار.");
      }
      const propertyChip = String(propertyInput?.dataset.chipId || "").trim();
      if (!propertyChip) return showStatus("اختر نوع العقار.");
      const propertyOther = String(gate.querySelector("#propertyTypeOtherInput")?.value || "").trim();
      const propertyType = quickApi
        ? quickApi.propertyTypeFromChip(propertyChip, propertyOther)
        : String(propertyInput?.value || "").trim();
      if (!propertyType) return showStatus("اكتب نوع العقار.");
      const requestKind = owner ? "" : (clientIntakeApi()?.normalizeRequestKind
        ? clientIntakeApi().normalizeRequestKind(fields.get("requestKind"))
        : String(fields.get("requestKind") || "").trim());
      if (!owner && !requestKind) return showStatus("اختر شراء أو استئجار.");
      const priceOrBudget = Number(String(fields.get("priceOrBudget") || "").replace(/\D/g, ""));
      if (owner && !(priceOrBudget > 0)) return showStatus("أدخل السعر أو الإيجار السنوي.");
      const images = owner ? Array.from(form.elements.images.files || []) : [];
      const video = owner ? form.elements.video.files[0] : null;
      if (owner && images.length > 5) return showStatus("يمكن إضافة 5 صور كحد أقصى.");
      if (images.some(file => file.size > 8 * 1024 * 1024)) return showStatus("إحدى الصور أكبر من 8 ميجابايت.");
      if (video && video.size > 90 * 1024 * 1024) return showStatus("الفيديو أكبر من 90 ميجابايت.");
      const submit = form.querySelector("button[type=submit]");
      submit.disabled = true;
      submit.textContent = owner ? "جارٍ رفع العرض..." : "جارٍ إرسال الطلب...";
      try {
        const ref = db().collection("offices").doc(targetOffice).collection("publicIntake").doc();
        if (propertyInput) propertyInput.value = propertyType;
        const district = String(fields.get("district") || "").trim();
        if (!district) return showStatus("أدخل الحي.");
        const mediaPaths = [];
        if (owner) {
          for (let index = 0; index < images.length; index += 1) {
            mediaPaths.push(await uploadPublicMedia({
              file: images[index], targetOffice, intakeId: ref.id, kind: "image", index: index + 1
            }));
          }
          if (video) {
            mediaPaths.push(await uploadPublicMedia({
              file: video, targetOffice, intakeId: ref.id, kind: "video"
            }));
          }
        }
        let intakePayload;
        const lifecycleFields = {
          lifecycleStatus: "NEW",
          normalizedSource: targetOffice === "platform" ? "public_site" : "office_link",
          contactType: owner ? "owner" : "buyer",
          contactName: name,
          contactPhone: phone
        };
        if (owner) {
          const ownerPurpose = quickApi?.ownerPurposeFromChip(purposeChip);
          const pricing = quickApi?.buildOwnerPricingFields(ownerPurpose, priceOrBudget) || {
            transactionType: "sale",
            purpose: "SALE",
            salePrice: priceOrBudget,
            annualRent: 0,
            amount: priceOrBudget,
            priceOrBudget
          };
          intakePayload = {
            officeId: targetOffice, kind,
            name,
            phone,
            city,
            propertyType,
            district,
            details: String(fields.get("details") || "").trim(),
            transactionType: pricing.transactionType,
            salePrice: pricing.salePrice,
            annualRent: pricing.annualRent,
            amount: pricing.amount,
            priceOrBudget: pricing.priceOrBudget,
            purpose: pricing.purpose,
            mediaPaths,
            imageCount: images.length,
            hasVideo: Boolean(video),
            mediaMissing: images.length === 0,
            completeness: images.length ? 90 : 65,
            source: targetOffice === "platform" ? "platform_public" : "office_public_link",
            status: "new",
            ...lifecycleFields,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
        } else {
          const api = clientIntakeApi();
          if (!api) throw new Error("INTAKE_MODULE_MISSING");
          const formValues = {
            name,
            phone,
            city,
            district,
            propertyType,
            requestKind,
            details: fields.get("details"),
            budget: fields.get("budget"),
            annualRent: fields.get("annualRent"),
            area: fields.get("area"),
            rooms: fields.get("rooms"),
            bathrooms: fields.get("bathrooms"),
            streetWidth: fields.get("streetWidth"),
            facing: fields.get("facing"),
            condition: fields.get("condition"),
            furnished: fields.get("furnished"),
            paymentInstallments: fields.get("paymentInstallments")
          };
          const built = api.buildClientIntakeDocument(formValues, {
            targetOffice,
            source: targetOffice === "platform" ? "platform_public" : "office_public_link"
          });
          intakePayload = {
            ...built,
            officeId: targetOffice,
            mediaPaths: [],
            imageCount: 0,
            hasVideo: false,
            mediaMissing: false,
            ...lifecycleFields,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          if (targetOffice === "platform") api.rememberLastCity(city);
        }
        await ref.set(intakePayload);
        let matchingResult = null;
        try { matchingResult = await triggerPublicIntakeMatching(targetOffice, ref.id); }
        catch (matchingError) { console.warn("[iaqar] matching queued", matchingError); }
        form.reset();
        if (targetOffice === "platform" && city) clientIntakeApi()?.rememberLastCity?.(city);
        if (matchingResult && Number(matchingResult.matches || 0) > 0) {
          showStatus(`تم الإرسال واكتشاف ${matchingResult.matches} مطابقة مناسبة.`, true);
        } else {
          showStatus(owner ? "تم رفع عرض العقار وتشغيل المطابقة." : "تم إرسال الطلب وتشغيل المطابقة.", true);
        }
      } catch (error) {
        console.warn("[iaqar] intake submit", error);
        showStatus("تعذر الإرسال الآن. تحقق من الاتصال وحاول مرة أخرى.");
      } finally {
        submit.disabled = false;
        submit.textContent = owner ? "إرسال العرض" : "إرسال الطلب";
      }
    };
  }
  function brokerForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>تسجيل وسيط عقاري</h2><p>لن يُنشأ المكتب إلا بعد التحقق من رخصة فال واعتماد إدارة المنصة.</p>
      <form class="access-form" id="brokerForm">
        <label><span>اسم الوسيط *</span><input name="brokerName" maxlength="80" required><span class="access-field-error" data-field-error="brokerName"></span></label>
        <label><span>رقم الجوال *</span><input name="phone" inputmode="tel" maxlength="20" required><span class="access-field-error" data-field-error="phone"></span></label>
        <label><span>البريد الإلكتروني للاسترجاع *</span><input name="email" type="email" maxlength="120" required><span class="access-field-error" data-field-error="email"></span></label>
        <label><span>رقم رخصة فال *</span><input name="falLicense" inputmode="numeric" maxlength="20" required><span class="access-field-error" data-field-error="falLicense"></span></label>
        <label class="full"><span>اسم المكتب المقترح *</span><input name="officeName" minlength="4" maxlength="80" required><span class="access-field-error" data-field-error="officeName"></span></label>
        <label class="full"><span>كلمة مرور الحساب *</span><input name="password" type="password" minlength="8" autocomplete="new-password" required><span class="access-field-error" data-field-error="password"></span></label>
        <label class="full"><button class="access-btn" type="submit">إرسال طلب الاعتماد</button></label>
      </form><div id="accessStatus" class="access-status"></div></section>`, "broker-apply");
    bindAccessBack(home);
    gate.querySelector("#brokerForm").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const submit = form.querySelector("button[type=submit]");
      const clearBrokerFieldErrors = () => {
        form.querySelectorAll("[data-field-error]").forEach(node => node.textContent = "");
      };
      const showBrokerFieldError = (name, message) => {
        const node = form.querySelector(`[data-field-error="${name}"]`);
        if (node) node.textContent = message || "";
      };
      const mapBrokerApplyError = (payload = {}, fallback = "") => {
        const code = String(payload.error || "").toLowerCase();
        const message = String(payload.message || payload.publicMessage || fallback || "").trim();
        clearBrokerFieldErrors();
        if (code === "email_already_used" || message.includes("البريد")) {
          showBrokerFieldError("email", message || "البريد مستخدم مسبقًا");
          return message || "البريد مستخدم مسبقًا";
        }
        if (code === "phone_already_used" || message.includes("الجوال")) {
          showBrokerFieldError("phone", message || "رقم الجوال مستخدم مسبقًا");
          return message || "رقم الجوال مستخدم مسبقًا";
        }
        if (code === "fal_already_used" || code === "fal_invalid" || message.includes("فال")) {
          showBrokerFieldError("falLicense", message || "رقم رخصة فال غير صالح أو مستخدم");
          return message || "رقم رخصة فال غير صالح أو مستخدم";
        }
        if (code === "invalid_broker_application") {
          showBrokerFieldError("officeName", message || "بيانات الطلب غير مكتملة");
          return message || "بيانات الطلب غير مكتملة";
        }
        if (code === "auth_required" || code === "admin_required") {
          return message || "يلزم تسجيل الدخول لإرسال الطلب";
        }
        if (code === "pilot_registration_closed" || code === "pilot_access_denied") {
          return message || "التسجيل متاح حاليًا لعدد محدود من المكاتب ضمن المرحلة التجريبية.";
        }
        return message || fallback || "تعذر إرسال الطلب الآن";
      };
      const brokerPhone = normalizeSaudiPhone(fields.get("phone"));
      clearBrokerFieldErrors();
      if (!brokerPhone) {
        showBrokerFieldError("phone", "أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
        return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      }
      submit.disabled = true;
      let createdUser = null;
      try {
        const credential = await firebase.auth().createUserWithEmailAndPassword(
          String(fields.get("email") || "").trim(),
          String(fields.get("password") || "")
        );
        createdUser = credential.user;
        const idToken = await credential.user.getIdToken();
        const response = await fetch(`${resolveWorkerBase()}/broker/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
          body: JSON.stringify({
          brokerName: String(fields.get("brokerName") || "").trim(),
          phone: brokerPhone,
          email: String(fields.get("email") || "").trim().toLowerCase(),
          falLicense: String(fields.get("falLicense") || "").replace(/\D/g, "").slice(0, 20),
          officeName: String(fields.get("officeName") || "").trim()
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const mapped = mapBrokerApplyError(payload, "تعذر حفظ طلب المكتب");
          if (createdUser) {
            try { await createdUser.delete(); } catch (_) {}
            await authSignOut("broker_apply_cleanup", mapped);
          }
          return showStatus(mapped);
        }
        await authSignOut("broker_apply_success", "pending_approval");
        form.reset();
        clearBrokerFieldErrors();
        showStatus("تم استلام الطلب وحالته «بانتظار الاعتماد». ستتواصل الإدارة معك بعد التحقق من رخصة فال.", true);
      } catch (error) {
        console.warn("[iaqar] broker application", error);
        if (createdUser) {
          try { await createdUser.delete(); } catch (_) {}
          await authSignOut("broker_apply_error", code);
        }
        const code = String(error?.code || "");
        clearBrokerFieldErrors();
        if (code === "auth/email-already-in-use") {
          showBrokerFieldError("email", "البريد مستخدم مسبقًا");
          showStatus("البريد مستخدم مسبقًا");
        } else if (code === "auth/weak-password") {
          showBrokerFieldError("password", "كلمة المرور ضعيفة — استخدم 8 أحرف أو أكثر");
          showStatus("كلمة المرور غير صالحة");
        } else if (code === "auth/invalid-email") {
          showBrokerFieldError("email", "البريد غير صالح");
          showStatus("البريد غير صالح");
        } else if (code === "auth/network-request-failed") {
          showStatus("مشكلة اتصال مؤقتة — حاول بعد قليل");
        } else {
          showStatus("تعذر إنشاء حساب الدخول — تحقق من البيانات وحاول مرة أخرى");
        }
      } finally { submit.disabled = false; }
    };
  }
  function loginForm(message = "") {
    if (authGuardState === "authenticated" && accessGrantedForOffice) {
      authDiag("REDIRECT_REASON", { reason: "skip_login_form_already_granted" });
      return;
    }
    frame(`<section class="access-card"><button class="access-back">← رجوع</button>
      <h2>دخول المكتب</h2><p>مساحة العمل والإعدادات للحسابات المعتمدة والمصرح لها فقط.</p>
      <form class="access-form" id="loginForm">
        <label class="full"><span>رقم الجوال</span><input name="phone" inputmode="tel" autocomplete="username" required></label>
        <label class="full"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>
        <label class="full access-remember"><input type="checkbox" name="remember" id="rememberLogin" checked>
          <span>البقاء مسجلًا</span></label>
        <label class="full"><button class="access-btn light" type="button" id="togglePassword">إظهار كلمة المرور</button></label>
        <label class="full"><button class="access-btn" type="submit">تسجيل الدخول</button></label>
        <label class="full"><button class="access-btn light" type="button" id="forgotPassword">نسيت كلمة المرور</button></label>
      </form><div id="accessStatus" class="access-status ${message ? "show err" : ""}">${message}</div></section>`, "login");
    bindAccessBack(home);
    gate.querySelector("#togglePassword").onclick = event => {
      const input = gate.querySelector('input[name="password"]');
      input.type = input.type === "password" ? "text" : "password";
      event.currentTarget.textContent = input.type === "password" ? "إظهار كلمة المرور" : "إخفاء كلمة المرور";
    };
    gate.querySelector("#forgotPassword").onclick = forgotPasswordForm;
    gate.querySelector("#loginForm").onsubmit = async event => {
      event.preventDefault();
      if (loginSubmitInFlight) return;
      const submitBtn = event.currentTarget.querySelector('button[type="submit"]');
      const submitLabel = submitBtn ? submitBtn.textContent : "";
      loginSubmitInFlight = true;
      accessVerificationInFlight = true;
      authGuardState = "loading";
      loginPerfMark("click");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "جارٍ تسجيل الدخول…";
      }
      const fields = new FormData(event.currentTarget);
      const phone = normalizeSaudiPhone(fields.get("phone"));
      if (!phone) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitLabel || "تسجيل الدخول";
        }
        loginSubmitInFlight = false;
        accessVerificationInFlight = false;
        authGuardState = "unauthenticated";
        return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      }
      const remember = Boolean(gate.querySelector("#rememberLogin")?.checked);
      try {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        authDiag("AUTH_PERSISTENCE", { remember, mode: "LOCAL", phase: "login_submit" });
        try {
          localStorage.setItem("iaqar.auth.remember", remember ? "1" : "0");
        } catch (_) { /* ignore */ }
      } catch (error) {
        console.warn("[iaqar] auth persistence", error);
      }
      try {
        loginPerfMark("resolve_start");
        const resolveResponse = await fetch(`${resolveWorkerBase()}/auth/phone-login-resolve`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: normalizeLoginPhone(phone) })
        });
        loginPerfMark("resolve_done");
        loginPerfMeasure("phone_resolve", "resolve_start", "resolve_done");
        const resolvePayload = await resolveResponse.json().catch(() => ({}));
        if (!resolveResponse.ok || !resolvePayload.loginEmail || !resolvePayload.officeId) {
          authDiag("AUTH_GUARD_DECISION", {
            decision: "login_failed",
            stage: "phone_resolve",
            reason: resolvePayload.reason || "resolve_failed"
          });
          showStatus(loginFailureMessage("phone_resolve", { reason: resolvePayload.reason || "" }));
          return;
        }
        authDiag("OFFICE_ID_RESULT", { officeId: resolvePayload.officeId });
        const password = String(fields.get("password") || "");
        let signedInUser;
        try {
          loginPerfMark("sign_in_start");
          const credential = await firebase.auth().signInWithEmailAndPassword(resolvePayload.loginEmail, password);
          loginPerfMark("sign_in_done");
          loginPerfMeasure("firebase_auth", "sign_in_start", "sign_in_done");
          signedInUser = credential.user;
        } catch (error) {
          console.warn("[iaqar] email/password sign-in", error);
          await authSignOut("login_password_rejected", error && error.code);
          showStatus(loginFailureMessage("password_sign_in", { code: error && error.code }));
          return;
        }
        authDiag("SIGN_IN_SUCCESS", {
          uid: signedInUser?.uid || null,
          email: signedInUser?.email || resolvePayload.loginEmail
        });
        authDiag("AUTH_LOGIN_SUCCESS", {
          uid: signedInUser?.uid || null,
          email: signedInUser?.email || resolvePayload.loginEmail
        });
        authDiag("AUTH_UID", { uid: signedInUser?.uid || null });
        authDiag("AUTH_EMAIL", { email: signedInUser?.email || resolvePayload.loginEmail });
        loginPerfMark("user_load_start");
        try {
          await signedInUser?.getIdToken(false);
        } catch (error) {
          console.warn("[iaqar] id token read", error);
          await authSignOut("login_id_token_failed", error && error.code);
          showStatus(loginFailureMessage("id_token", { code: error && error.code }));
          return;
        }
        loginPerfMark("user_load_done");
        loginPerfMeasure("user_token", "user_load_start", "user_load_done");
        const accessGranted = await verifyAccess(resolvePayload.officeId, true, {
          skipTokenRefresh: true,
          fromLogin: true
        });
        if (!accessGranted) {
          authDiag("AUTH_GUARD_DECISION", {
            decision: "office_access_not_granted",
            officeId: resolvePayload.officeId
          });
        }
      } catch (error) {
        console.warn("[iaqar] login", error);
        await authSignOut("login_unknown_error", error && error.message);
        showStatus(loginFailureMessage("unknown"));
      } finally {
        loginSubmitInFlight = false;
        if (!accessGrantedForOffice && submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitLabel || "تسجيل الدخول";
        }
        if (!accessGrantedForOffice) {
          accessVerificationInFlight = false;
          if (authGuardState === "loading") authGuardState = "unauthenticated";
        }
        loginPerfReport();
      }
    };
  }
  function forgotPasswordForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button><h2>نسيت كلمة المرور</h2>
      <p>أدخل رقم الجوال، وسنرسل رابط إعادة تعيين كلمة المرور إلى البريد المسجل للحساب.</p>
      <form class="access-form" id="forgotForm"><label class="full"><span>رقم الجوال</span>
      <input name="phone" inputmode="tel" required></label><label class="full"><button class="access-btn" type="submit">إرسال رابط الاسترجاع</button></label></form>
      <div id="accessStatus" class="access-status"></div></section>`, "forgot-password");
    bindAccessBack(() => loginForm());
    gate.querySelector("#forgotForm").onsubmit = async event => {
      event.preventDefault();
      const phone = normalizeSaudiPhone(new FormData(event.currentTarget).get("phone"));
      if (!phone) return showStatus("أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05.");
      const button = event.currentTarget.querySelector("button"); button.disabled = true;
      try {
        const response = await fetch(`${resolveWorkerBase()}/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, apiKey: firebase.app().options.apiKey }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("RESET_FAILED");
        showStatus(payload.maskedEmail ? `تم إرسال الرابط إلى ${payload.maskedEmail}.` : "إذا كان الرقم مسجلًا فسيصل رابط الاسترجاع إلى البريد المرتبط به.", true);
      } catch (_) { showStatus("تعذر إرسال رابط الاسترجاع الآن. حاول بعد قليل."); }
      finally { button.disabled = false; }
    };
  }
  function platformLoginForm() {
    frame(`<section class="access-card"><button class="access-back">← رجوع</button><h2>دخول إدارة المنصة</h2>
      <p>هذا الدخول مخصص لمدير المنصة فقط.</p><form class="access-form" id="platformForm">
      <label class="full"><span>البريد الإلكتروني</span><input name="email" type="email" autocomplete="username" required></label>
      <label class="full"><span>كلمة المرور</span><input name="password" type="password" autocomplete="current-password" required></label>
      <label class="full"><button class="access-btn" type="submit">دخول الإدارة</button></label></form><div id="accessStatus" class="access-status"></div></section>`, "platform-login");
    bindAccessBack(() => loginForm());
    gate.querySelector("#platformForm").onsubmit = async event => {
      event.preventDefault(); const fields = new FormData(event.currentTarget);
      try { await firebase.auth().signInWithEmailAndPassword(String(fields.get("email") || "").trim(), String(fields.get("password") || "")); await verifyAccess("platform", true); }
      catch (_) { await authSignOut("platform_login_failed", "invalid_credentials"); showStatus("بيانات إدارة المنصة غير صحيحة."); }
    };
  }
  function showAccessGate() {
    if (!document.body.classList.contains("access-locked")) {
      document.body.classList.add("access-locked");
    }
    if (!gate.isConnected) document.body.appendChild(gate);
  }

  async function verifyAccess(target, navigate, options = {}) {
    if (!target) {
      loginForm("أدخل رمز المكتب المعتمد.");
      return false;
    }
    if (target === "platform") {
      try {
        const token = await firebase.auth().currentUser.getIdTokenResult(true);
        if (token.claims.platformAdmin === true || token.claims.admin === true) {
          authGuardState = "authenticated";
          adminApplications();
          return true;
        }
      } catch (_) {}
      loginForm("هذا الحساب ليس من إدارة المنصة.");
      return false;
    }
    const user = firebase.auth().currentUser;
    if (!user) {
      authDiag("AUTH_GUARD_DECISION", { decision: "unauthenticated", target });
      authGuardState = "unauthenticated";
      return false;
    }
    accessVerificationInFlight = true;
    authGuardState = "loading";
    authDiag("PROFILE_LOOKUP_START", { target, uid: user.uid, navigate });
    loginPerfMark("office_load_start");
    try {
      if (!options.skipTokenRefresh && user.getIdToken) {
        await user.getIdToken(false);
      }
      const officeRef = db().collection("offices").doc(target);
      const memberRef = officeRef.collection("members").doc(user.uid);
      const [officeSnap, memberSnap] = await Promise.all([
        officeRef.get({ source: "server" }),
        memberRef.get({ source: "server" })
      ]);
      const memberData = memberSnap.exists ? (memberSnap.data() || {}) : {};
      const officeData = officeSnap.exists ? (officeSnap.data() || {}) : {};
      const isOwner = officeData.ownerUid === user.uid;
      authDiag("PROFILE_LOOKUP_RESULT", {
        officeExists: officeSnap.exists,
        memberExists: memberSnap.exists,
        isOwner,
        memberPath: `offices/${target}/members/${user.uid}`
      });
      authDiag("OFFICE_ID_RESULT", { officeId: target, fromUrl: officeId });
      authDiag("ROLE_RESULT", { role: memberData.role || (isOwner ? "owner" : null) });
      authDiag("ACCOUNT_STATUS_RESULT", {
        active: memberData.active,
        approved: memberData.approved,
        memberActive: memberData.active !== false,
        isOwner
      });
      if (!officeSnap.exists) {
        authDiag("AUTH_GUARD_DECISION", { decision: "office_missing", target });
        showAccessError(
          "المكتب غير موجود",
          `تعذر العثور على المكتب «${target}». تحقق من الرابط أو تواصل مع الإدارة.`,
          () => verifyAccess(target, navigate)
        );
        return false;
      }
      if (!memberSnap.exists && !isOwner) {
        authDiag("AUTH_GUARD_DECISION", { decision: "member_missing", target, uid: user.uid });
        showAccessError(
          "عضوية المكتب غير موجودة",
          `لا يوجد سجل عضوية في offices/${target}/members/${user.uid}. لن يُعاد توجيهك تلقائيًا.`,
          null
        );
        return false;
      }
      if (memberSnap.exists && memberData.active === false) {
        authDiag("AUTH_GUARD_DECISION", { decision: "member_inactive", target, uid: user.uid });
        showAccessError(
          "الحساب معطّل",
          "هذا الحساب معطّل لهذا المكتب. تواصل مع إدارة المكتب دون تسجيل خروج تلقائي.",
          null
        );
        return false;
      }
      try {
        const idToken = await user.getIdToken(false);
        const pilotResponse = await fetch(`${resolveWorkerBase()}/platform/pilot-status?officeId=${encodeURIComponent(target)}`, {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const pilotPayload = await pilotResponse.json().catch(() => ({}));
        const pilotDenied = pilotPayload?.officeAccess?.allowed === false
          || pilotPayload?.officeAccess?.code === "PILOT_ACCESS_DENIED";
        if (pilotDenied) {
          authDiag("AUTH_GUARD_DECISION", { decision: "pilot_access_denied", target });
          await authSignOut("pilot_access_denied", pilotPayload?.officeAccess?.code || "PILOT_ACCESS_DENIED");
          showAccessError(
            "المرحلة التجريبية",
            pilotPayload?.officeAccess?.message || "هذا المكتب غير مشمول في المرحلة التجريبية الحالية.",
            null
          );
          return false;
        }
      } catch (pilotError) {
        console.warn("[iaqar] pilot access check", pilotError);
      }
      localStorage.setItem("iaqar.officeId", target);
      authGuardState = "authenticated";
      accessGrantedForOffice = true;
      authDiag("AUTH_GUARD_DECISION", { decision: "authenticated", target });
      loginPerfMark("office_load_done");
      loginPerfMeasure("office_membership", "office_load_start", "office_load_done");
      if (navigate || target !== officeId) {
        loginPerfMark("navigate_start");
        if (await unlockOfficeWorkspace(target)) {
          loginPerfMark("navigate_done");
          loginPerfMeasure("workspace_unlock", "navigate_start", "navigate_done");
          return true;
        }
        authDiag("REDIRECT_REASON", { reason: "unlock_failed_retry", target });
        showAccessError(
          "تعذر فتح المكتب",
          "تعذر تجهيز مساحة المكتب الآن. حسابك ما زال مسجّلًا — أعد المحاولة.",
          () => verifyAccess(target, navigate)
        );
        return false;
      }
      document.body.classList.remove("access-locked");
      gate.remove();
      loginPerfMark("workspace_visible");
      window.dispatchEvent(new CustomEvent("iaqar:access-granted", {
        detail: { officeId: target, source: "verify_access_inline" }
      }));
      return true;
    } catch (error) {
      console.warn("[iaqar] access denied", error);
      const code = String(error && error.code || "");
      if (code.includes("unavailable") || code.includes("network") || code.includes("deadline-exceeded")) {
        authDiag("AUTH_GUARD_DECISION", { decision: "network_error", target, code });
        showAccessError(
          "تعذر الاتصال",
          "تحقق من الشبكة ثم أعد المحاولة. لن يُسجَّل خروجك تلقائيًا.",
          () => verifyAccess(target, navigate)
        );
        return false;
      }
      if ((code.includes("permission-denied") || code.includes("unauthenticated"))
        && firebase.auth().currentUser) {
        try {
          await firebase.auth().currentUser.getIdToken(true);
          const officeRef = db().collection("offices").doc(target);
          const memberRef = officeRef.collection("members").doc(firebase.auth().currentUser.uid);
          const [officeSnap, memberSnap] = await Promise.all([
            officeRef.get({ source: "server" }),
            memberRef.get({ source: "server" })
          ]);
          if (officeSnap.exists && memberSnap.exists) {
            localStorage.setItem("iaqar.officeId", target);
            authGuardState = "authenticated";
            accessGrantedForOffice = true;
            authDiag("AUTH_GUARD_DECISION", { decision: "authenticated_after_retry", target });
            loginPerfMark("office_load_done");
            if (navigate || target !== officeId) {
              loginPerfMark("navigate_start");
              if (await unlockOfficeWorkspace(target)) {
                loginPerfMark("navigate_done");
                return true;
              }
              authDiag("REDIRECT_REASON", { reason: "unlock_retry_failed", target });
              showAccessError(
                "تعذر فتح المكتب",
                "تعذر تجهيز مساحة المكتب الآن. حسابك ما زال مسجّلًا — أعد المحاولة.",
                () => verifyAccess(target, navigate)
              );
              return false;
            }
            document.body.classList.remove("access-locked");
            gate.remove();
            window.dispatchEvent(new CustomEvent("iaqar:access-granted", {
              detail: { officeId: target, source: "verify_access_retry_inline" }
            }));
            return true;
          }
        } catch (retryError) {
          console.warn("[iaqar] access retry", retryError);
        }
      }
      if (code.includes("permission-denied") || code.includes("unauthenticated")) {
        authDiag("AUTH_GUARD_DECISION", { decision: "permission_denied", target, code });
        showAccessError(
          "غير مخوّل",
          "هذا الحساب غير مخوّل للمكتب المطلوب. يمكنك تسجيل الخروج أو التواصل مع إدارة المكتب.",
          null
        );
        return false;
      }
      authDiag("AUTH_GUARD_DECISION", { decision: "verify_failed", target, code });
      showAccessError(
        "تعذر التحقق",
        "تعذر التحقق من صلاحية الدخول. حاول مرة أخرى.",
        () => verifyAccess(target, navigate)
      );
      return false;
    } finally {
      accessVerificationInFlight = false;
    }
  }

  async function adminApplications() {
    frame(`<section class="access-card"><h2>طلبات تسجيل الوسطاء</h2>
      <p>راجع رقم رخصة فال، ثم اعتمد الطلب أو ارفضه. لا يُنشأ المكتب قبل اعتمادك.</p>
      <div id="adminApplications"><p>جارٍ تحميل الطلبات...</p></div>
      <button class="access-btn light" id="enableAdminNotifications" style="width:100%;margin-top:12px">تفعيل إشعارات طلبات الوسطاء</button>
      <button class="access-btn secondary" id="adminLogout" style="width:100%;margin-top:12px">تسجيل الخروج</button>
      <div id="accessStatus" class="access-status"></div></section>`);
    gate.querySelector("#adminLogout").onclick = async () => { await authSignOut("admin_logout", "user_requested"); home(); };
    const notificationButton = gate.querySelector("#enableAdminNotifications");
    notificationButton.onclick = () => enableAdminNotifications(true);
    if (localStorage.getItem("iaqar.fcm.enabled.platform") === "1") {
      notificationButton.textContent = "إشعارات الإدارة مفعّلة";
      if ("Notification" in window && Notification.permission === "granted") setTimeout(() => enableAdminNotifications(false), 200);
    }
    try {
      const token = await firebase.auth().currentUser.getIdToken();
      const response = await fetch(`${resolveWorkerBase()}/admin/broker-applications`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!response.ok) throw new Error("LOAD_FAILED");
      const payload = await response.json();
      const list = Array.isArray(payload.applications) ? payload.applications : [];
      const container = gate.querySelector("#adminApplications");
      if (!list.length) {
        container.innerHTML = `<p>لا توجد طلبات معلّقة حاليًا.</p>`;
        return;
      }
      container.innerHTML = list.map(item => `<article data-application-id="${escapeHtml(item.id)}" style="border:1px solid #dce8e4;border-radius:16px;padding:13px;margin:9px 0">
        <strong>${escapeHtml(item.brokerName)}</strong>
        <p style="margin:5px 0">فال: ${escapeHtml(item.falLicense)}<br>الجوال: ${escapeHtml(item.phone)}
        <br>البريد: ${escapeHtml(item.email)}<br>المكتب: ${escapeHtml(item.officeName)}</p>
        <input data-office-id="${escapeHtml(item.id)}" value="${suggestOfficeId(item.officeName, item.id)}"
          aria-label="رمز المكتب" style="width:100%;box-sizing:border-box;border:1px solid #d4e3de;border-radius:12px;padding:10px;margin-bottom:8px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button class="access-btn" data-approve="${escapeHtml(item.id)}">اعتماد</button>
          <button class="access-btn secondary" data-reject="${escapeHtml(item.id)}">رفض</button>
        </div></article>`).join("");
      const requestedApplication = query.get("openBrokerApplication");
      if (requestedApplication) {
        const requestedCard = container.querySelector(`[data-application-id="${CSS.escape(requestedApplication)}"]`);
        if (requestedCard) {
          requestedCard.style.outline = "3px solid rgba(18,140,126,.25)";
          requestedCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      container.querySelectorAll("[data-approve],[data-reject]").forEach(button => button.onclick = async () => {
        const id = button.dataset.approve || button.dataset.reject;
        const action = button.dataset.approve ? "approve" : "reject";
        const officeInput = container.querySelector(`[data-office-id="${CSS.escape(id)}"]`);
        button.disabled = true;
        try {
          const freshToken = await firebase.auth().currentUser.getIdToken();
          const actionResponse = await fetch(`${resolveWorkerBase()}/admin/broker-applications/action`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${freshToken}` },
            body: JSON.stringify({ applicationId: id, action, officeId: officeInput ? officeInput.value : "" })
          });
          if (!actionResponse.ok) throw new Error("ACTION_FAILED");
          await adminApplications();
        } catch (_) {
          showStatus("تعذر تنفيذ القرار. تحقق من رمز المكتب وحاول مرة أخرى.");
          button.disabled = false;
        }
      });
    } catch (_) {
      showStatus("تعذر تحميل طلبات الوسطاء.");
    }
  }
  async function enableAdminNotifications(sendTest = true) {
    const button = gate.querySelector("#enableAdminNotifications");
    if (!button) return;
    button.disabled = true;
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || typeof firebase.messaging !== "function") throw new Error("NOT_SUPPORTED");
      let permission = Notification.permission;
      if (sendTest && permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("PERMISSION_DENIED");
      const configResponse = await fetch(`${resolveWorkerBase()}/fcm/config`, { cache: "no-store" });
      const config = await configResponse.json();
      if (!config.enabled || !config.vapidKey) throw new Error("FCM_DISABLED");
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
      let fcmRegistration = null;
      const fidBridge = window.IAQAR_FCM_READY ? await window.IAQAR_FCM_READY.catch(() => null) : null;
      if (fidBridge && typeof fidBridge.register === "function") {
        const fid = await fidBridge.register({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
        if (fid) fcmRegistration = { id: fid, type: "fid" };
      }
      if (!fcmRegistration && typeof firebase.messaging === "function") {
        const token = await firebase.messaging().getToken({ vapidKey: config.vapidKey, serviceWorkerRegistration: registration });
        if (token) fcmRegistration = { id: token, type: "token" };
      }
      if (!fcmRegistration) throw new Error("FCM_REGISTRATION_FAILED");
      const idToken = await firebase.auth().currentUser.getIdToken(true);
      const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` };
      const installationId = (() => {
        const key = "iaqar.notificationInstallationId";
        let value = localStorage.getItem(key);
        if (!value) {
          value = window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          localStorage.setItem(key, value);
        }
        return value;
      })();
      const response = await fetch(`${resolveWorkerBase()}/fcm/register`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          officeId: "platform",
          fcmRegistrationId: fcmRegistration.id,
          registrationType: fcmRegistration.type,
          fcmToken: fcmRegistration.type === "token" ? fcmRegistration.id : "",
          userAgent: navigator.userAgent,
          deviceName: "إدارة المنصة — " + (navigator.platform || "جهاز"),
          installationId,
          language: navigator.language || "ar-SA",
          notificationPermission: permission,
          appVersion: "stage3-fcm-fid-v1"
        })
      });
      if (!response.ok) throw new Error("REGISTER_FAILED");
      localStorage.setItem("iaqar.fcm.enabled.platform", "1");
      button.textContent = "إشعارات الإدارة مفعّلة";
      if (sendTest) {
        const testResponse = await fetch(`${resolveWorkerBase()}/fcm/test`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            officeId: "platform",
            fcmRegistrationId: fcmRegistration.id,
            registrationType: fcmRegistration.type,
            fcmToken: fcmRegistration.type === "token" ? fcmRegistration.id : "",
            installationId
          })
        });
        if (!testResponse.ok) throw new Error("TEST_FAILED");
        showStatus("تم التفعيل وإرسال إشعار تجريبي لإدارة المنصة.", true);
      }
    } catch (_) {
      if (sendTest) {
        button.disabled = false;
        showStatus("تعذر تفعيل الإشعارات. تحقق من إعداد FCM وسماح المتصفح.");
      }
    } finally {
      button.disabled = false;
    }
  }
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
  }
  function suggestOfficeId(name, id) {
    const latin = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return latin || `office-${String(id || "").slice(-8).toLowerCase()}`;
  }

  async function bootstrapAccess() {
    if (!window.firebase || !firebase.apps || !firebase.apps.length) {
      frame(`<section class="access-card"><h2>تعذر بدء المنصة</h2><p>تحقق من اتصال الإنترنت ثم حدّث الصفحة.</p></section>`);
      return;
    }
    if (publicSlug && !officeId) {
      try {
        const col = db().collection("publicOffices");
        let snapshot = await col.where("publicSlug", "==", publicSlug).limit(1).get();
        if (snapshot.empty) {
          snapshot = await col.where("legacyPublicSlugs", "array-contains", publicSlug).limit(1).get();
        }
        if (snapshot.empty) {
          const worker = resolveWorkerBase();
          location.replace(`${worker}/${publicSlugLegacy ? "o" : "m"}/${encodeURIComponent(publicSlug)}`);
          return;
        }
        const data = snapshot.docs[0].data() || {};
        officeId = firestoreOfficeId(data.officeId || snapshot.docs[0].id || "");
        refreshRouteFlags();
        const canonicalSlug = String(data.publicSlug || publicSlug).trim().toLowerCase();
        if (canonicalSlug && (publicSlugLegacy || publicSlug !== canonicalSlug)) {
          try { history.replaceState({}, "", `/m/${encodeURIComponent(canonicalSlug)}`); } catch (_) {}
        }
      } catch (error) {
        console.warn("[iaqar] public slug resolution", error);
        frame(`<section class="access-card"><h2>تعذر فتح رابط المكتب</h2><p>تحقق من الاتصال ثم حاول مرة أخرى.</p></section>`);
        return;
      }
    }
    refreshRouteFlags();

    try {
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const rememberFlag = localStorage.getItem("iaqar.auth.remember");
      authDiag("AUTH_PERSISTENCE", {
        remember: rememberFlag !== "0",
        mode: "LOCAL",
        phase: "bootstrap"
      });
    } catch (error) {
      console.warn("[iaqar] auth persistence", error);
    }

    showAuthLoading();

    let initialAuthHandled = false;

    const routeAfterInitialAuth = async (user) => {
      if (isPublicOfficeLink) {
        publicOffice();
        return;
      }
      if (isPlatformHome) {
        home();
        return;
      }
      if (user) {
        authDiag("USER_FOUND", { uid: user.uid, email: user.email || null });
        authDiag("AUTH_UID", { uid: user.uid });
        authDiag("AUTH_EMAIL", { email: user.email || null });
        try {
          await user.getIdToken(false);
        } catch (error) {
          console.warn("[iaqar] auth token", error);
        }
        authGuardState = "loading";
        await verifyAccess(officeId, false);
        return;
      }
      authGuardState = "unauthenticated";
      authDiag("AUTH_GUARD_DECISION", { decision: "show_login", reason: "no_user_after_auth_ready" });
      loginForm();
    };

    const handleAuthStateChanged = (user) => {
      if (!authReady) {
        authReady = true;
        authStateReady = true;
        authInitComplete = true;
        authDiag("AUTH_READY", { hasUser: Boolean(user) });
      }
      authDiag("AUTH_STATE_CHANGED", {
        uid: user?.uid || null,
        email: user?.email || null,
        phase: initialAuthHandled ? "subsequent" : "first"
      });
      if (!initialAuthHandled) {
        initialAuthHandled = true;
        void routeAfterInitialAuth(user);
        return;
      }
      if (authGuardState === "loading" || accessVerificationInFlight || loginSubmitInFlight) {
        authDiag("AUTH_GUARD_DECISION", { decision: "ignore_auth_change", reason: "loading" });
        return;
      }
      if (!user) {
        if (accessGrantedForOffice && !explicitSignOutRequested) {
          authDiag("AUTH_GUARD_DECISION", {
            decision: "ignore_null_user",
            reason: "granted_without_explicit_sign_out"
          });
          return;
        }
        if (!accessGrantedForOffice && !explicitSignOutRequested) {
          authDiag("AUTH_GUARD_DECISION", { decision: "ignore_null_user", reason: "not_granted_yet" });
          return;
        }
        accessGrantedForOffice = false;
        authGuardState = "unauthenticated";
        explicitSignOutRequested = false;
        if (!isPlatformHome && !isPublicOfficeLink && officeId && officeId !== "platform") {
          authDiag("AUTH_GUARD_DECISION", { decision: "show_login", reason: "signed_out" });
          showAccessGate();
          loginForm();
        }
        return;
      }
      if (!accessGrantedForOffice && !isPlatformHome && !isPublicOfficeLink && officeId && officeId !== "platform") {
        authGuardState = "loading";
        void verifyAccess(officeId, false);
      }
    };

    if (authStateUnsubscribe) authStateUnsubscribe();
    authStateUnsubscribe = firebase.auth().onAuthStateChanged(handleAuthStateChanged);
    window.addEventListener("pagehide", () => {
      if (authStateUnsubscribe) {
        authStateUnsubscribe();
        authStateUnsubscribe = null;
      }
    }, { once: true });
  }

  bootstrapAccess();
})();
