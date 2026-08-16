(() => {
  "use strict";

  function resolveFirebaseProjectId() {
    if (window.IAQAR && window.IAQAR.firebaseProjectId) return window.IAQAR.firebaseProjectId;
    try {
      const id = window.firebase && window.firebase.app && window.firebase.app().options
        ? window.firebase.app().options.projectId
        : "";
      if (id) return id;
    } catch (_) { /* app not ready */ }
    return "aqar-b5d76";
  }
  const PROJECT_ID = resolveFirebaseProjectId();
  const STORAGE_KEY = "iaqar.officeId";
  const DEFAULT_OFFICE_ID = "platform";
  const ROOT_COLLECTION = "offices";

  function normalizeOfficeId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  function resolveOfficeId() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = normalizeOfficeId(
      params.get("officeId") || params.get("office") || params.get("o")
    );

    if (fromUrl) {
      try {
        localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch (_) {
        // قد يكون التخزين المحلي محظوراً؛ الرابط يظل المصدر الأساسي.
      }
      return { officeId: fromUrl, source: "url" };
    }

    try {
      const saved = normalizeOfficeId(localStorage.getItem(STORAGE_KEY));
      if (saved) return { officeId: saved, source: "storage" };
    } catch (_) {
      // نستخدم مكتب المنصة كقيمة آمنة عند تعذر التخزين المحلي.
    }

    return { officeId: DEFAULT_OFFICE_ID, source: "default" };
  }

  function createOfficePaths(officeId) {
    const base = `${ROOT_COLLECTION}/${officeId}`;
    return Object.freeze({
      base,
      office: base,
      owners: `${base}/owners`,
      clients: `${base}/clients`,
      opportunities: `${base}/opportunities`,
      deals: `${base}/deals`,
      matches: `${base}/matches`,
      operations: `${base}/operations`,
      notifications: `${base}/notifications`,
      alerts: `${base}/alerts`,
      devices: `${base}/devices`,
      inbox: `${base}/inbox`,
      publicIntake: `${base}/publicIntake`
    });
  }

  function setRuntimeStatus(status, detail = "") {
    document.documentElement.dataset.firebaseStatus = status;
    document.documentElement.dataset.officeId = runtime.officeId;
    runtime.status = status;
    runtime.detail = detail;

    window.dispatchEvent(new CustomEvent("iaqar:firebase-status", {
      detail: { status, detail, officeId: runtime.officeId }
    }));
  }

  function buildOfficeRefs(officeId) {
    const officeRef = runtime.db.collection(ROOT_COLLECTION).doc(officeId);
    return Object.freeze({
      office: officeRef,
      owners: officeRef.collection("owners"),
      clients: officeRef.collection("clients"),
      opportunities: officeRef.collection("opportunities"),
      deals: officeRef.collection("deals"),
      matches: officeRef.collection("matches"),
      operations: officeRef.collection("operations"),
      notifications: officeRef.collection("notifications"),
      alerts: officeRef.collection("alerts"),
      devices: officeRef.collection("devices"),
      inbox: officeRef.collection("inbox"),
      publicIntake: officeRef.collection("publicIntake")
    });
  }

  function rebindOfficeContext(nextOfficeId) {
    if (!runtime.db) return false;
    const normalized = normalizeOfficeId(nextOfficeId);
    if (!normalized || normalized === DEFAULT_OFFICE_ID) return false;
    runtime.officeId = normalized;
    runtime.officeIdSource = "login";
    runtime.paths = createOfficePaths(normalized);
    runtime.refs = buildOfficeRefs(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch (_) {
      // الرابط وذاكرة التطبيق تظل المصدر عند تعذر التخزين المحلي.
    }
    document.documentElement.dataset.officeId = normalized;
    window.dispatchEvent(new CustomEvent("iaqar:office-rebound", {
      detail: {
        projectId: runtime.projectId,
        officeId: normalized,
        paths: runtime.paths
      }
    }));
    console.info("[iaqar] office context rebound", { officeId: normalized });
    return true;
  }

  const resolved = resolveOfficeId();
  const runtime = {
    projectId: PROJECT_ID,
    officeId: resolved.officeId,
    officeIdSource: resolved.source,
    paths: createOfficePaths(resolved.officeId),
    status: "starting",
    detail: "",
    app: null,
    db: null,
    refs: null
  };

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.office = runtime;
  window.IAQAR.rebindOfficeContext = rebindOfficeContext;

  if (!window.firebase || typeof window.firebase.app !== "function") {
    setRuntimeStatus("sdk-missing", "لم يتم تحميل Firebase SDK");
    console.error("[iaqar] Firebase SDK لم يتم تحميله.");
    return;
  }

  if (!window.firebase.apps || window.firebase.apps.length === 0) {
    setRuntimeStatus(
      "config-missing",
      "تعذر تحميل إعداد Firebase التلقائي للمشروع"
    );
    console.error(
      "[iaqar] إعداد Firebase غير موجود. تحقق من اتصال الإنترنت أو ملف init.js."
    );
    return;
  }

  try {
    runtime.app = window.firebase.app();
    runtime.db = window.firebase.firestore(runtime.app);
    runtime.db.settings({ ignoreUndefinedProperties: true });

    runtime.refs = buildOfficeRefs(runtime.officeId);

    setRuntimeStatus("initialized", "تم إنشاء اتصال Firestore");

    runtime.db.enableNetwork()
      .then(() => runtime.db.collection("_system").doc("health").get({ source: "server" }))
      .then(() => {
        setRuntimeStatus("connected", "تم الوصول إلى Firestore");
      })
      .catch(error => {
        const code = String(error && error.code || "");

        if (code.includes("permission-denied") || code.includes("unauthenticated")) {
          setRuntimeStatus(
            "connected-protected",
            "Firestore متصل، وتحتاج القراءة إلى تسجيل دخول وصلاحيات"
          );
          return;
        }

        if (code.includes("unavailable") || code.includes("network-request-failed")) {
          setRuntimeStatus("offline", "تعذر الوصول إلى Firestore حالياً");
          return;
        }

        setRuntimeStatus("connection-error", code || "خطأ اتصال غير معروف");
        console.error("[iaqar] فشل اختبار Firestore:", error);
      });

    window.dispatchEvent(new CustomEvent("iaqar:firebase-ready", {
      detail: {
        projectId: runtime.projectId,
        officeId: runtime.officeId,
        paths: runtime.paths
      }
    }));

    console.info("[iaqar] Firebase initialized", {
      projectId: runtime.projectId,
      officeId: runtime.officeId,
      officeIdSource: runtime.officeIdSource,
      paths: runtime.paths
    });
  } catch (error) {
    setRuntimeStatus("initialization-error", String(error && error.message || error));
    console.error("[iaqar] تعذر تهيئة Firebase:", error);
  }
})();
