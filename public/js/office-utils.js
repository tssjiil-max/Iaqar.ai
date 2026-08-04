/*
 * IAQAR.AI — منطق المكتب النقي المشترك.
 * يعمل في المتصفح (window.IAQAR.officeUtils) وفي Node (module.exports) حتى
 * تختبره tests/office-utils.test.mjs دون تكرار المنطق. لا يحتوي أي حالة DOM.
 */
(function attachOfficeUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.IAQAR = root.IAQAR || {};
  root.IAQAR.officeUtils = api;
})(typeof self !== "undefined" ? self : globalThis, function buildOfficeUtils() {
  "use strict";

  const ARABIC_LETTER = "؀-ۿ";
  const SIGNIFICANT_RE = new RegExp("[A-Za-z0-9" + ARABIC_LETTER + "]", "g");
  const ALLOWED_NAME_RE = new RegExp("^[A-Za-z0-9" + ARABIC_LETTER + "\\s._-]+$");

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function significantCharacterCount(value) {
    const matches = safeText(value).match(SIGNIFICANT_RE);
    return matches ? matches.length : 0;
  }

  function allowedOfficeName(value) {
    return ALLOWED_NAME_RE.test(safeText(value));
  }

  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\s._-]+/g, "")
      .replace(new RegExp("[^A-Za-z0-9" + ARABIC_LETTER + "]", "g"), "");
  }

  const OFFICE_NAME_ERRORS = Object.freeze({
    REQUIRED: "اكتب اسم المكتب",
    INVALID_CHARS: "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط",
    TOO_SHORT: "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة",
    TOO_LONG: "اسم المكتب طويل جدًا",
    TAKEN: "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر",
    AVAILABLE: "اسم المكتب متاح",
    CHECKING: "جارٍ فحص توفر الاسم...",
    CHECK_FAILED: "تعذر فحص توفر الاسم الآن؛ سيُتحقق عند الحفظ"
  });

  const OFFICE_NAME_MIN_CHARS = 4;
  const OFFICE_NAME_MAX_CHARS = 80;

  function validateOfficeName(value, { isPlatformAdmin = false } = {}) {
    const name = safeText(value);
    if (!name) return OFFICE_NAME_ERRORS.REQUIRED;
    if (!allowedOfficeName(name)) return OFFICE_NAME_ERRORS.INVALID_CHARS;
    if (!isPlatformAdmin && significantCharacterCount(name) < OFFICE_NAME_MIN_CHARS) {
      return OFFICE_NAME_ERRORS.TOO_SHORT;
    }
    if (significantCharacterCount(name) > OFFICE_NAME_MAX_CHARS) return OFFICE_NAME_ERRORS.TOO_LONG;
    return "";
  }

  function publicSlugBase(value) {
    const asciiName = safeText(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);
    return asciiName || "maktab";
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 6);
  }

  function buildPublicSlug(name, officeId) {
    return `${publicSlugBase(name)}-${shortHash(officeId)}`.slice(0, 64);
  }

  function sanitizePublicSlug(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  }

  const NOTIFICATION_PREF_DEFS = Object.freeze([
    { key: "matches", label: "إشعارات المطابقات", hint: "مطابقة جديدة صالحة" },
    { key: "contacts", label: "إشعارات الملاك والعملاء", hint: "طلب أو عرض أو رد جديد" },
    { key: "cooperation", label: "إشعارات التعاون", hint: "طلبات وقبول ورفض التعاون" },
    { key: "messages", label: "إشعارات الرسائل", hint: "رسالة تحتاج ردًا" },
    { key: "appointments", label: "إشعارات المواعيد والمتابعات", hint: "معاينة أو متابعة مستحقة" },
    { key: "system", label: "إشعارات النظام المهمة", hint: "تنبيهات أمان وحساب" }
  ]);
  const NOTIFICATION_PREF_KEYS = Object.freeze(NOTIFICATION_PREF_DEFS.map(def => def.key));

  function defaultNotificationPrefs() {
    const prefs = {};
    NOTIFICATION_PREF_KEYS.forEach(key => { prefs[key] = true; });
    return prefs;
  }

  function sanitizeNotificationPrefs(value) {
    const prefs = defaultNotificationPrefs();
    if (!value || typeof value !== "object") return prefs;
    NOTIFICATION_PREF_KEYS.forEach(key => {
      if (typeof value[key] === "boolean") prefs[key] = value[key];
    });
    return prefs;
  }

  const COOPERATION_MODES = Object.freeze({
    disabled: {
      key: "disabled",
      label: "التعاون متوقف",
      hint: "لا يستقبل المكتب أي طلب تعاون من الوسطاء."
    },
    approval_required: {
      key: "approval_required",
      label: "بموافقة المكتب على كل طلب",
      hint: "يصلك كل طلب تعاون وتوافق عليه أو ترفضه يدويًا."
    },
    smart_automatic: {
      key: "smart_automatic",
      label: "تعاون ذكي تلقائي وفق القواعد المعتمدة",
      hint: "تُقبل الطلبات المتوافقة تلقائيًا دون كشف بيانات التواصل تلقائيًا."
    }
  });
  const COOPERATION_MODE_KEYS = Object.freeze(Object.keys(COOPERATION_MODES));
  const DEFAULT_COOPERATION_MODE = "approval_required";

  function sanitizeCooperationMode(value) {
    return COOPERATION_MODE_KEYS.includes(value) ? value : DEFAULT_COOPERATION_MODE;
  }

  const COOPERATION_STATUS = Object.freeze({
    not_shared: "not_shared",
    pending: "pending",
    active: "active",
    rejected: "rejected",
    ended: "ended"
  });
  const COOPERATION_STATUS_LABELS = Object.freeze({
    not_shared: "لم تُشارك",
    pending: "بانتظار الموافقة",
    active: "تعاون نشط",
    rejected: "رُفض الطلب",
    ended: "انتهى التعاون"
  });

  function cooperationStatusLabel(value) {
    return COOPERATION_STATUS_LABELS[value] || COOPERATION_STATUS_LABELS.not_shared;
  }

  /* إعدادات تصميم قابلة للضبط: تُقرأ عند القص فقط، فتغييرها لا يعيد كتابة
   * سير الرفع. لا تُثبَّت أبعاد منصة خارجية دون متطلبات موثقة. */
  const OFFICE_DESIGN = Object.freeze({
    coverCrop: Object.freeze({
      defaultPreset: "whatsappWide",
      presets: Object.freeze({
        whatsappWide: Object.freeze({
          key: "whatsappWide",
          label: "عريض مناسب لواتساب",
          ratio: 1.91,
          outputWidth: 1200
        }),
        wide169: Object.freeze({
          key: "wide169",
          label: "عريض 16:9",
          ratio: 16 / 9,
          outputWidth: 1600
        }),
        original: Object.freeze({
          key: "original",
          label: "الصورة الأصلية",
          ratio: null,
          outputWidth: 1600
        })
      })
    }),
    logoCrop: Object.freeze({
      ratio: 1,
      label: "مربع للشعار",
      outputWidth: 512
    })
  });

  function resolveCoverCropPreset(key) {
    const presets = OFFICE_DESIGN.coverCrop.presets;
    return presets[key] || presets[OFFICE_DESIGN.coverCrop.defaultPreset];
  }

  const OFFICE_IMAGE_RULES = Object.freeze({
    types: Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }),
    maxBytes: 10 * 1024 * 1024,
    typeError: "اختر صورة JPG أو PNG أو WebP",
    sizeError: "حجم الصورة يتجاوز 10 ميجابايت"
  });

  function validateOfficeImage(fileLike) {
    if (!fileLike || typeof fileLike !== "object") return OFFICE_IMAGE_RULES.typeError;
    const type = String(fileLike.type || "").toLowerCase();
    if (!OFFICE_IMAGE_RULES.types[type]) return OFFICE_IMAGE_RULES.typeError;
    if (Number(fileLike.size || 0) > OFFICE_IMAGE_RULES.maxBytes) return OFFICE_IMAGE_RULES.sizeError;
    return "";
  }

  /* حساب نافذة القص المركزية لنسبة معينة ضمن أبعاد الصورة المصدر. */
  function centeredCropRect(sourceWidth, sourceHeight, ratio) {
    const width = Math.max(1, Number(sourceWidth) || 1);
    const height = Math.max(1, Number(sourceHeight) || 1);
    if (!ratio || ratio <= 0) return { x: 0, y: 0, width, height };
    let cropWidth = width;
    let cropHeight = width / ratio;
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = height * ratio;
    }
    return {
      x: Math.round((width - cropWidth) / 2),
      y: Math.round((height - cropHeight) / 2),
      width: Math.round(cropWidth),
      height: Math.round(cropHeight)
    };
  }

  function officeLinkForSlug(origin, slug) {
    const base = safeText(origin) || "https://iaqar.ai";
    return new URL(`/o/${encodeURIComponent(safeText(slug))}`, base).toString();
  }

  const BANK_KIND_LABELS = Object.freeze({ owner: "عرض مالك", client: "طلب عميل" });

  function priceLabel(kind, data) {
    const source = data || {};
    const single = Number(source.price || source.amount || 0);
    const min = Number(source.priceMin || 0);
    const max = Number(source.priceMax || 0);
    if (min && max) return `${min.toLocaleString("ar-SA")} – ${max.toLocaleString("ar-SA")} ريال`;
    if (single) return `${single.toLocaleString("ar-SA")} ريال`;
    return kind === "owner" ? "السعر غير محدد" : "الميزانية غير محددة";
  }

  function bankItemFromRecord(kind, id, data) {
    const source = data || {};
    return {
      id: safeText(id),
      kind: kind === "owner" ? "owner" : "client",
      kindLabel: BANK_KIND_LABELS[kind === "owner" ? "owner" : "client"],
      propertyType: safeText(source.propertyType, "عقار"),
      city: safeText(source.city),
      district: safeText(source.district),
      priceLabel: priceLabel(kind, source),
      contactName: safeText(source.contactName || source.name),
      addedAt: source.createdAt || source.updatedAt || null,
      cooperationStatus: COOPERATION_STATUS_LABELS[source.cooperationStatus]
        ? source.cooperationStatus
        : COOPERATION_STATUS.not_shared
    };
  }

  return Object.freeze({
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    publicSlugBase,
    shortHash,
    buildPublicSlug,
    sanitizePublicSlug,
    OFFICE_NAME_ERRORS,
    OFFICE_NAME_MIN_CHARS,
    OFFICE_NAME_MAX_CHARS,
    NOTIFICATION_PREF_DEFS,
    NOTIFICATION_PREF_KEYS,
    defaultNotificationPrefs,
    sanitizeNotificationPrefs,
    COOPERATION_MODES,
    COOPERATION_MODE_KEYS,
    DEFAULT_COOPERATION_MODE,
    sanitizeCooperationMode,
    COOPERATION_STATUS,
    COOPERATION_STATUS_LABELS,
    cooperationStatusLabel,
    OFFICE_DESIGN,
    resolveCoverCropPreset,
    OFFICE_IMAGE_RULES,
    validateOfficeImage,
    centeredCropRect,
    officeLinkForSlug,
    bankItemFromRecord
  });
});
