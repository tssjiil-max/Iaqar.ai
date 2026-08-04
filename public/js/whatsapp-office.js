(() => {
  "use strict";

  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const GRAPH_VERSION_FALLBACK = "v25.0";
  let config = null;
  let signupData = null;
  let sdkPromise = null;

  const elements = {};

  function officeId() {
    return window.IAQAR && window.IAQAR.office && window.IAQAR.office.officeId
      ? window.IAQAR.office.officeId
      : "platform";
  }

  function notify(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function setStatus(text, connected = false) {
    elements.status.textContent = text;
    elements.status.classList.toggle("connected", connected);
  }

  function openSettings() {
    elements.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    refreshStatus();
  }

  function closeSettings() {
    elements.overlay.hidden = true;
    if (document.getElementById("opportunityBank")?.hidden !== false) {
      document.body.style.overflow = "";
    }
  }

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.openOfficeSettings = openSettings;
  window.IAQAR.closeOfficeSettings = closeSettings;

  async function fetchJson(path, options = {}) {
    let idToken = "";
    try {
      const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
      if (user) idToken = await user.getIdToken();
    } catch (_) {}
    const response = await fetch(`${WORKER_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(idToken ? { "Authorization": `Bearer ${idToken}` } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || "تعذر الاتصال بخدمة الربط");
    }
    return payload;
  }

  async function refreshStatus() {
    setStatus("جارٍ التحقق");
    elements.connectBtn.disabled = true;

    try {
      config = await fetchJson(`/meta/config?officeId=${encodeURIComponent(officeId())}`);
      const status = await fetchJson(`/meta/status?officeId=${encodeURIComponent(officeId())}`);

      if (status.connected) {
        setStatus("مربوط", true);
        elements.connectBtn.textContent = "واتساب أعمال مربوط";
        elements.connectBtn.disabled = true;
        elements.note.textContent = status.displayPhoneNumber
          ? `الرقم المرتبط: ${status.displayPhoneNumber}. الاستقبال فقط، والإرسال التلقائي متوقف.`
          : "الحساب مربوط للاستقبال فقط، والإرسال التلقائي متوقف.";
      } else if (config.enabled) {
        setStatus("غير مربوط");
        elements.connectBtn.textContent = "ربط واتساب أعمال";
        elements.connectBtn.disabled = false;
        elements.note.textContent = "اضغط للربط الرسمي مع Meta. يستقبل الموقع الرسائل الخاصة الواردة فقط.";
      } else {
        setStatus("يحتاج إعداد Meta");
        elements.connectBtn.textContent = "ربط واتساب أعمال";
        elements.connectBtn.disabled = true;
        elements.note.textContent = "الزر جاهز، ويتفعّل بعد إدخال App ID وConfiguration ID من منصة Meta.";
      }

      updateUsage(status.usage || {});
    } catch (error) {
      const message = String(error && error.message || "تعذر التحقق");
      if (message.includes("سجل دخول")) {
        setStatus("يتطلب تسجيل الدخول");
        elements.note.textContent = "سجل دخول مدير المكتب لعرض حالة الربط أو ربط واتساب أعمال.";
      } else {
        setStatus("بانتظار إعداد Meta");
        elements.note.textContent = "ربط واتساب الرسمي غير مفعّل حاليًا. إعدادات المكتب وبقية المنصة تعمل بصورة مستقلة.";
      }
      elements.connectBtn.disabled = true;
      updateUsage({});
    }
  }

  function updateUsage(usage) {
    const percent = Math.max(0, Math.min(100, Number(usage.percent || 0)));
    elements.usagePercent.textContent = `${Math.round(percent)}%`;
    elements.usageFill.style.width = `${percent}%`;
    const inbound = Number(usage.inboundMessages || 0);
    const estimatedWrites = Number(usage.estimatedWrites || 0);
    elements.usageCaption.textContent = percent >= 80
      ? `تنبيه: وصل الاستخدام التقديري إلى ${Math.round(percent)}%. الرسائل الواردة اليوم: ${inbound}.`
      : `الرسائل الواردة اليوم: ${inbound} — عمليات Firestore التقديرية: ${estimatedWrites}. التنبيه عند 80%.`;
  }

  function loadFacebookSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      if (window.FB) return resolve(window.FB);

      window.fbAsyncInit = () => {
        window.FB.init({
          appId: config.appId,
          autoLogAppEvents: true,
          xfbml: false,
          version: config.graphVersion || GRAPH_VERSION_FALLBACK
        });
        resolve(window.FB);
      };

      const script = document.createElement("script");
      script.id = "facebook-jssdk";
      script.src = "https://connect.facebook.net/ar_AR/sdk.js";
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error("تعذر تحميل خدمة Meta"));
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  function listenForSignupEvents() {
    window.addEventListener("message", event => {
      if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) { return; }
      }
      if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP") return;

      if (payload.event === "FINISH") {
        signupData = {
          wabaId: payload.data && (payload.data.waba_id || payload.data.wabaId),
          phoneNumberId: payload.data && (payload.data.phone_number_id || payload.data.phoneNumberId)
        };
      }
    });
  }

  async function getAuthHeaders() {
    const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
    if (!user) throw new Error("سجل دخول مدير المكتب أولاً");
    return { Authorization: `Bearer ${await user.getIdToken(true)}` };
  }

  async function completeSignup(code) {
    setStatus("جارٍ إكمال الربط");
    elements.connectBtn.disabled = true;

    try {
      const result = await fetchJson("/meta/signup/complete", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          officeId: officeId(),
          code,
          wabaId: signupData && signupData.wabaId,
          phoneNumberId: signupData && signupData.phoneNumberId
        })
      });

      setStatus("مربوط", true);
      elements.connectBtn.textContent = "واتساب أعمال مربوط";
      elements.note.textContent = result.displayPhoneNumber
        ? `تم ربط ${result.displayPhoneNumber}. الاستقبال فقط، ولا يوجد إرسال تلقائي.`
        : "تم الربط للاستقبال فقط، ولا يوجد إرسال تلقائي.";
      notify("تم ربط واتساب أعمال بالمكتب");
    } catch (error) {
      setStatus("فشل الربط");
      elements.connectBtn.disabled = false;
      elements.note.textContent = error.message;
      notify(error.message);
    }
  }

  async function startEmbeddedSignup() {
    if (!config || !config.enabled) return;

    try {
      const FB = await loadFacebookSdk();
      signupData = null;
      FB.login(response => {
        const code = response && response.authResponse && response.authResponse.code;
        if (!code) {
          notify("لم يكتمل ربط واتساب أعمال");
          return;
        }
        completeSignup(code);
      }, {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3"
        }
      });
    } catch (error) {
      notify(error.message);
    }
  }

  function init() {
    elements.openBtn = document.getElementById("officeSettingsBtn");
    elements.coverBtn = document.getElementById("officeCoverBtn");
    elements.overlay = document.getElementById("officeSettings");
    elements.closeBtn = document.getElementById("officeSettingsClose");
    elements.status = document.getElementById("whatsappConnectionStatus");
    elements.connectBtn = document.getElementById("whatsappConnectBtn");
    elements.note = document.getElementById("whatsappIntegrationNote");
    elements.usageFill = document.getElementById("usageFill");
    elements.usagePercent = document.getElementById("usagePercent");
    elements.usageCaption = document.getElementById("usageCaption");

    if (!elements.openBtn || !elements.overlay) return;

    elements.openBtn.addEventListener("click", openSettings);
    if (elements.coverBtn) elements.coverBtn.addEventListener("click", openSettings);
    elements.closeBtn.addEventListener("click", closeSettings);
    elements.overlay.addEventListener("click", event => {
      if (event.target === elements.overlay) closeSettings();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !elements.overlay.hidden) closeSettings();
    });
    elements.connectBtn.addEventListener("click", startEmbeddedSignup);

    listenForSignupEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
