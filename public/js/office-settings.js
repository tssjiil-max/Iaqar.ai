(() => {
  "use strict";

  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

  // إعداد تصميمي قابل للتعديل: نسبة قص الغلاف العريض المتوافق مع المشاركة.
  // تغيير النسبة هنا لا يتطلب إعادة كتابة مسار الرفع.
  const COVER_CROP_PRESET = Object.freeze({
    ratio: 1.91,
    outputWidth: 1200,
    mimeType: "image/jpeg",
    quality: 0.9
  });
  const LOGO_MAX_BYTES = 5 * 1024 * 1024;
  const COVER_MAX_BYTES = 10 * 1024 * 1024;
  const IMAGE_TYPE_PATTERN = /^image\/(jpeg|png|webp)$/;

  const COOPERATION_MODES = Object.freeze(["disabled", "approval_required", "smart_automatic"]);
  const DEFAULT_COOPERATION_MODE = "approval_required";
  const NOTIFICATION_PREF_KEYS = Object.freeze([
    "matches", "ownerCustomer", "cooperation", "messages", "appointments", "system"
  ]);

  const OPPORTUNITY_KIND_LABELS = Object.freeze({
    owner_offer: "عرض مالك",
    client_request: "طلب عميل"
  });
  const COOPERATION_STATUS_LABELS = Object.freeze({
    not_shared: "لم تُشارك",
    pending_approval: "بانتظار الموافقة",
    active: "تعاون نشط",
    rejected: "رُفض الطلب",
    ended: "انتهى التعاون"
  });

  const defaults = {
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    whatsapp: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    coverUrl: "",
    logoUrl: "",
    publicSlug: "",
    cooperationMode: DEFAULT_COOPERATION_MODE,
    notificationPreferences: null
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};
  // تغييرات الصور لا تُرفع إلا عند الحفظ: blob جاهز أو طلب إزالة.
  const pendingMedia = {
    logo: { blob: null, remove: false },
    cover: { blob: null, remove: false, sourceImage: null, offset: 50 }
  };
  let defaultLogoSrc = "";

  function officeRuntime() {
    return window.IAQAR && window.IAQAR.office ? window.IAQAR.office : null;
  }

  function officeId() {
    return (officeRuntime() && officeRuntime().officeId) || "platform";
  }

  function storageKey() {
    return `iaqar.officeProfile.${officeId()}`;
  }

  function authUser() {
    try {
      return window.firebase && firebase.auth ? firebase.auth().currentUser : null;
    } catch (_) {
      return null;
    }
  }

  function isPlatformAdmin() {
    return authClaims.platformAdmin === true || authClaims.admin === true;
  }

  function toast(message) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
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

  function buildPublicSlug(name) {
    return `${publicSlugBase(name)}-${shortHash(officeId())}`.slice(0, 64);
  }

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    const cleanList = [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
    return cleanList;
  }

  function significantCharacterCount(value) {
    const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function allowedOfficeName(value) {
    const name = safeText(value);
    return /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name);
  }

  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\s._-]+/g, "")
      .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  function validateOfficeName(value) {
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!allowedOfficeName(name)) return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    if (!isPlatformAdmin() && significantCharacterCount(name) < 4) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    if (significantCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
    return "";
  }

  function normalizedCooperationMode(value) {
    return COOPERATION_MODES.includes(value) ? value : DEFAULT_COOPERATION_MODE;
  }

  function normalizedNotificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const preferences = {};
    NOTIFICATION_PREF_KEYS.forEach(key => {
      preferences[key] = source[key] !== false;
    });
    return preferences;
  }

  function clean(data) {
    return {
      officeName: safeText(data.officeName, defaults.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: safeText(data.brokerName, defaults.brokerName).slice(0, 80),
      phone: safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      whatsapp: safeText(data.whatsapp || data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      cooperationMode: normalizedCooperationMode(data.cooperationMode),
      notificationPreferences: normalizedNotificationPreferences(data.notificationPreferences)
    };
  }

  function officeLink() {
    if (current.publicSlug) return new URL(`/o/${encodeURIComponent(current.publicSlug)}`, window.location.origin).toString();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("office", officeId());
    url.searchParams.set("view", "public");
    return url.toString();
  }

  function specialtyText(list) {
    return normalizedSpecialties(list).map(key => SPECIALTY_LABELS[key]).join(" • ");
  }

  function readSpecialtiesFromForm() {
    return Array.from(el.specialties || [])
      .filter(input => input.checked)
      .map(input => input.value);
  }

  function writeSpecialtiesToForm(list) {
    const selected = new Set(normalizedSpecialties(list));
    Array.from(el.specialties || []).forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function readNotificationPreferencesFromForm() {
    const preferences = {};
    Array.from(el.notificationPrefs || []).forEach(input => {
      preferences[input.value] = input.checked;
    });
    return normalizedNotificationPreferences(preferences);
  }

  function writeNotificationPreferencesToForm(preferences) {
    const normalized = normalizedNotificationPreferences(preferences);
    Array.from(el.notificationPrefs || []).forEach(input => {
      input.checked = normalized[input.value] !== false;
    });
  }

  function readCooperationModeFromForm() {
    const checked = Array.from(el.cooperationModes || []).find(input => input.checked);
    return normalizedCooperationMode(checked ? checked.value : DEFAULT_COOPERATION_MODE);
  }

  function writeCooperationModeToForm(mode) {
    const normalized = normalizedCooperationMode(mode);
    Array.from(el.cooperationModes || []).forEach(input => {
      input.checked = input.value === normalized;
    });
  }

  function refreshIdentityPreviews() {
    if (el.logoPreview) {
      const showLogo = !pendingMedia.logo.remove && (pendingMedia.logo.blob || current.logoUrl);
      if (pendingMedia.logo.blob) el.logoPreview.src = URL.createObjectURL(pendingMedia.logo.blob);
      else el.logoPreview.src = current.logoUrl || "";
      el.logoPreview.hidden = !showLogo;
    }
    if (el.logoRemove) el.logoRemove.hidden = !(current.logoUrl && !pendingMedia.logo.remove) && !pendingMedia.logo.blob;
    if (el.coverPreview) {
      const showCover = !pendingMedia.cover.remove && (pendingMedia.cover.blob || current.coverUrl);
      if (pendingMedia.cover.blob) el.coverPreview.src = URL.createObjectURL(pendingMedia.cover.blob);
      else el.coverPreview.src = current.coverUrl || "";
      el.coverPreview.hidden = !showCover;
    }
    if (el.coverRemove) el.coverRemove.hidden = !(current.coverUrl && !pendingMedia.cover.remove) && !pendingMedia.cover.blob;
    if (el.coverCropRow) el.coverCropRow.hidden = !pendingMedia.cover.sourceImage;
  }

  function refreshOfficeCard() {
    const logoImg = document.getElementById("officeLogoImg");
    if (logoImg) {
      if (!defaultLogoSrc) defaultLogoSrc = logoImg.src;
      logoImg.src = current.logoUrl || defaultLogoSrc;
    }
    const coverBtn = document.getElementById("officeCoverBtn");
    const coverImg = document.getElementById("officeCardCoverImg");
    if (coverBtn && coverImg) {
      if (current.coverUrl) {
        coverImg.src = current.coverUrl;
        coverBtn.hidden = false;
      } else {
        coverImg.removeAttribute("src");
        coverBtn.hidden = true;
      }
    }
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    el.officeName.value = current.officeName;
    el.brokerName.value = current.brokerName;
    el.phone.value = current.phone;
    el.whatsapp.value = current.whatsapp || current.phone;
    el.license.value = current.licenseNumber;
    el.city.value = current.city;
    el.link.value = officeLink();
    writeSpecialtiesToForm(current.specialties);
    writeNotificationPreferencesToForm(current.notificationPreferences);
    writeCooperationModeToForm(current.cooperationMode);
    refreshIdentityPreviews();
    refreshOfficeCard();

    const map = [
      ["officeDisplayName", current.officeName],
      ["officeDisplayBroker", current.brokerName],
      ["officeDisplayLicense", current.licenseNumber],
      ["officeDisplayCity", current.city],
      ["officeDisplaySpecialties", specialtyText(current.specialties)]
    ];
    map.forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
    const specialtyRow = document.querySelector(".specialty-status-row");
    if (specialtyRow) specialtyRow.hidden = !current.specialties.length;
  }

  function loadLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (value) return value;
    } catch (_) {}
    return null;
  }

  function saveLocal(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
    } catch (_) {}
  }

  async function loadFirestore() {
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) return false;

    try {
      const snap = await runtime.db.collection("offices").doc(officeId()).get();
      if (snap.exists) {
        const data = snap.data() || {};
        apply({
          officeName: data.officeName || data.name,
          brokerName: data.brokerName || data.licenseeName,
          phone: data.phone,
          whatsapp: data.whatsapp || data.phone,
          licenseNumber: data.licenseNumber || data.falLicense,
          city: data.city,
          specialties: data.specialties,
          coverUrl: data.coverUrl,
          logoUrl: data.logoUrl,
          publicSlug: data.publicSlug,
          cooperationMode: data.cooperationMode,
          notificationPreferences: data.notificationPreferences
        });
        saveLocal(current);
      }
      el.note.textContent = "البيانات متزامنة مع Firestore لهذا المكتب.";
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      el.note.textContent = "تم عرض البيانات المحفوظة على الجهاز. يلزم حساب مدير مخوّل للمزامنة.";
      return false;
    }
  }

  async function reserveOfficeName(runtime, user, data) {
    const officeRef = runtime.db.collection("offices").doc(officeId());
    const claimRef = runtime.db.collection("officeNameClaims").doc(data.officeNameKey);
    const publicRef = runtime.db.collection("publicOffices").doc(officeId());

    await runtime.db.runTransaction(async transaction => {
      const [officeSnap, claimSnap] = await Promise.all([
        transaction.get(officeRef),
        transaction.get(claimRef)
      ]);

      if (claimSnap.exists && claimSnap.data().officeId !== officeId()) {
        throw new Error("OFFICE_NAME_TAKEN");
      }

      const oldKey = officeSnap.exists ? safeText(officeSnap.data().officeNameKey) : "";
      if (oldKey && oldKey !== data.officeNameKey) {
        const oldClaimRef = runtime.db.collection("officeNameClaims").doc(oldKey);
        const oldClaimSnap = await transaction.get(oldClaimRef);
        if (oldClaimSnap.exists && oldClaimSnap.data().officeId === officeId()) {
          transaction.delete(oldClaimRef);
        }
      }

      transaction.set(claimRef, {
        officeId: officeId(),
        ownerUid: user.uid,
        officeName: data.officeName,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      transaction.set(officeRef, {
        ...data,
        officeId: officeId(),
        ownerUid: officeSnap.exists && officeSnap.data().ownerUid
          ? officeSnap.data().ownerUid
          : user.uid,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(publicRef, {
        officeId: officeId(),
        officeName: data.officeName,
        brokerName: data.brokerName,
        phone: data.phone,
        whatsapp: data.whatsapp,
        licenseNumber: data.licenseNumber,
        city: data.city,
        specialties: data.specialties,
        coverUrl: data.coverUrl,
        logoUrl: data.logoUrl,
        publicSlug: data.publicSlug,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  function setMediaStatus(node, message, isError = false) {
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    node.classList.toggle("error", Boolean(isError));
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("تعذر قراءة الصورة"));
      };
      image.src = objectUrl;
    });
  }

  function cropImageToPreset(image, offsetPercent) {
    const ratio = COVER_CROP_PRESET.ratio;
    const naturalRatio = image.naturalWidth / image.naturalHeight;
    let cropWidth;
    let cropHeight;
    let sx = 0;
    let sy = 0;
    const offset = Math.max(0, Math.min(100, Number(offsetPercent) || 0)) / 100;
    if (naturalRatio > ratio) {
      cropHeight = image.naturalHeight;
      cropWidth = cropHeight * ratio;
      sx = (image.naturalWidth - cropWidth) * offset;
    } else {
      cropWidth = image.naturalWidth;
      cropHeight = cropWidth / ratio;
      sy = (image.naturalHeight - cropHeight) * offset;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(COVER_CROP_PRESET.outputWidth, Math.max(1, Math.round(cropWidth)));
    canvas.height = Math.max(1, Math.round(canvas.width / ratio));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("تعذر قص الصورة")),
      COVER_CROP_PRESET.mimeType,
      COVER_CROP_PRESET.quality
    ));
  }

  function validImageFile(file, maxBytes, maxLabel) {
    if (!IMAGE_TYPE_PATTERN.test(file.type)) return "اختر صورة JPG أو PNG أو WebP";
    if (file.size > maxBytes) return `حجم الصورة يتجاوز ${maxLabel}`;
    return "";
  }

  async function handleLogoSelection() {
    const file = el.logo && el.logo.files ? el.logo.files[0] : null;
    if (!file) return;
    const error = validImageFile(file, LOGO_MAX_BYTES, "5 ميجابايت");
    if (error) {
      el.logo.value = "";
      setMediaStatus(el.logoStatus, error, true);
      toast(error);
      return;
    }
    pendingMedia.logo = { blob: file, remove: false };
    setMediaStatus(el.logoStatus, "الشعار جاهز — اضغط حفظ التعديلات لاعتماده");
    refreshIdentityPreviews();
  }

  async function renderCoverCrop() {
    if (!pendingMedia.cover.sourceImage) return;
    try {
      pendingMedia.cover.blob = await cropImageToPreset(pendingMedia.cover.sourceImage, pendingMedia.cover.offset);
      pendingMedia.cover.remove = false;
      setMediaStatus(el.coverStatus, "تم قص الصورة بنسبة الغلاف العريض — اضغط حفظ التعديلات لاعتمادها");
      refreshIdentityPreviews();
    } catch (error) {
      setMediaStatus(el.coverStatus, error.message || "تعذر قص الصورة", true);
    }
  }

  async function handleCoverSelection() {
    const file = el.cover && el.cover.files ? el.cover.files[0] : null;
    if (!file) return;
    const error = validImageFile(file, COVER_MAX_BYTES, "10 ميجابايت");
    if (error) {
      el.cover.value = "";
      setMediaStatus(el.coverStatus, error, true);
      toast(error);
      return;
    }
    setMediaStatus(el.coverStatus, "جارٍ تجهيز المعاينة...");
    try {
      const image = await loadImageFromFile(file);
      pendingMedia.cover.sourceImage = image;
      pendingMedia.cover.offset = 50;
      if (el.coverCropOffset) el.coverCropOffset.value = "50";
      await renderCoverCrop();
    } catch (loadError) {
      el.cover.value = "";
      pendingMedia.cover = { blob: null, remove: false, sourceImage: null, offset: 50 };
      setMediaStatus(el.coverStatus, loadError.message || "تعذر قراءة الصورة", true);
      refreshIdentityPreviews();
    }
  }

  function requestLogoRemoval() {
    pendingMedia.logo = { blob: null, remove: Boolean(current.logoUrl) };
    if (el.logo) el.logo.value = "";
    setMediaStatus(el.logoStatus, pendingMedia.logo.remove ? "سيُزال الشعار عند حفظ التعديلات" : "");
    refreshIdentityPreviews();
  }

  function requestCoverRemoval() {
    pendingMedia.cover = { blob: null, remove: Boolean(current.coverUrl), sourceImage: null, offset: 50 };
    if (el.cover) el.cover.value = "";
    setMediaStatus(el.coverStatus, pendingMedia.cover.remove ? "ستُزال الصورة عند حفظ التعديلات" : "");
    refreshIdentityPreviews();
  }

  async function officeMediaRequest(path, blob) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل تعديل صور المكتب");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": blob ? (blob.type || "image/jpeg") : "application/json",
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body: blob || null
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر تحديث صور المكتب");
    return result;
  }

  async function commitPendingMedia() {
    let coverUrl = current.coverUrl || "";
    let logoUrl = current.logoUrl || "";
    if (pendingMedia.logo.blob) {
      setMediaStatus(el.logoStatus, "جارٍ رفع الشعار...");
      const result = await officeMediaRequest("/media/office-logo", pendingMedia.logo.blob);
      if (!result.logoUrl) throw new Error("تعذر رفع شعار المكتب");
      logoUrl = result.logoUrl;
      setMediaStatus(el.logoStatus, "تم رفع الشعار");
    } else if (pendingMedia.logo.remove) {
      setMediaStatus(el.logoStatus, "جارٍ إزالة الشعار...");
      await officeMediaRequest("/media/office-logo/delete", null);
      logoUrl = "";
      setMediaStatus(el.logoStatus, "تمت إزالة الشعار");
    }
    if (pendingMedia.cover.blob) {
      setMediaStatus(el.coverStatus, "جارٍ رفع صورة المكتب...");
      const result = await officeMediaRequest("/media/office-cover", pendingMedia.cover.blob);
      if (!result.coverUrl) throw new Error("تعذر رفع صورة المكتب");
      coverUrl = result.coverUrl;
      setMediaStatus(el.coverStatus, "تم رفع صورة المكتب");
    } else if (pendingMedia.cover.remove) {
      setMediaStatus(el.coverStatus, "جارٍ إزالة صورة المكتب...");
      await officeMediaRequest("/media/office-cover/delete", null);
      coverUrl = "";
      setMediaStatus(el.coverStatus, "تمت إزالة صورة المكتب");
    }
    return { coverUrl, logoUrl };
  }

  function clearPendingMedia() {
    pendingMedia.logo = { blob: null, remove: false };
    pendingMedia.cover = { blob: null, remove: false, sourceImage: null, offset: 50 };
    if (el.logo) el.logo.value = "";
    if (el.cover) el.cover.value = "";
  }

  async function onSave(event) {
    event.preventDefault();

    const nameError = validateOfficeName(el.officeName.value);
    if (nameError) {
      el.officeName.setCustomValidity(nameError);
      el.officeName.reportValidity();
      toast(nameError);
      return;
    }
    el.officeName.setCustomValidity("");

    const specialties = readSpecialtiesFromForm();

    let mediaUrls;
    try {
      mediaUrls = await commitPendingMedia();
    } catch (mediaError) {
      const message = mediaError.message || "تعذر تحديث صور المكتب";
      setMediaStatus(pendingMedia.logo.blob || pendingMedia.logo.remove ? el.logoStatus : el.coverStatus, message, true);
      toast(message);
      return;
    }

    const data = clean({
      officeName: el.officeName.value,
      brokerName: el.brokerName.value,
      phone: el.phone.value,
      whatsapp: el.whatsapp.value,
      licenseNumber: el.license.value,
      city: el.city.value,
      specialties,
      coverUrl: mediaUrls.coverUrl,
      logoUrl: mediaUrls.logoUrl,
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value),
      cooperationMode: readCooperationModeFromForm(),
      notificationPreferences: readNotificationPreferencesFromForm()
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
      toast("أكمل بيانات المكتب المطلوبة");
      return;
    }

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";

    const runtime = officeRuntime();
    const user = authUser();
    let synced = false;

    if (runtime && runtime.db && user) {
      try {
        await reserveOfficeName(runtime, user, data);
        synced = true;
      } catch (error) {
        console.warn("[iaqar] office settings sync failed", error);
        if (error && error.message === "OFFICE_NAME_TAKEN") {
          const message = "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
          el.officeName.setCustomValidity(message);
          el.officeName.reportValidity();
          toast(message);
          el.save.disabled = false;
          el.save.textContent = "حفظ التعديلات";
          return;
        }
      }
    }

    if (!synced) {
      el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

    clearPendingMedia();
    apply(data);
    saveLocal(data);
    el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
    toast("تم حفظ إعدادات المكتب");
    el.save.disabled = false;
    el.save.textContent = "حفظ التعديلات";
  }

  async function onLogout() {
    const user = authUser();
    if (!user) {
      toast("لا يوجد حساب مسجل حاليًا");
      return;
    }
    try {
      await firebase.auth().signOut();
      toast("تم تسجيل الخروج");
    } catch (_) {
      toast("تعذر تسجيل الخروج الآن");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.link.value);
      toast("تم نسخ رابط المكتب");
    } catch (_) {
      el.link.select();
      document.execCommand("copy");
      toast("تم نسخ رابط المكتب");
    }
  }

  async function shareLink() {
    const link = officeLink();
    const text = `${current.officeName} — ${current.city}\nرابط المكتب:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.officeName, text, url: link });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    await copyLink();
  }

  function toggleQrPanel() {
    if (!el.qrPanel || !el.qrCanvas) return;
    if (!el.qrPanel.hidden) {
      el.qrPanel.hidden = true;
      return;
    }
    try {
      if (typeof window.qrcode !== "function") throw new Error("QR_UNAVAILABLE");
      const qr = window.qrcode(0, "M");
      qr.addData(officeLink());
      qr.make();
      const modules = qr.getModuleCount();
      const size = el.qrCanvas.width;
      const ctx = el.qrCanvas.getContext("2d");
      const cell = size / (modules + 8);
      const offset = cell * 4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#073f35";
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (!qr.isDark(row, col)) continue;
          const px = offset + Math.floor(col * cell);
          const py = offset + Math.floor(row * cell);
          const nextX = offset + Math.ceil((col + 1) * cell);
          const nextY = offset + Math.ceil((row + 1) * cell);
          ctx.fillRect(px, py, nextX - px, nextY - py);
        }
      }
      el.qrPanel.hidden = false;
    } catch (error) {
      console.warn("[iaqar] office QR", error);
      toast("تعذر إنشاء رمز QR الآن");
    }
  }

  function previewOfficePage() {
    const popup = window.open(officeLink(), "_blank", "noopener,noreferrer");
    if (!popup) toast("اسمح بالنوافذ المنبثقة لمعاينة صفحة المكتب");
  }

  function bankDateLabel(value) {
    try {
      const date = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
      if (Number.isNaN(date.getTime())) return "غير محدد";
      return date.toLocaleDateString("ar-SA", { year: "numeric", month: "short", day: "numeric" });
    } catch (_) {
      return "غير محدد";
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function bankAmountLabel(item) {
    const isOffer = item.recordType === "owner_offer";
    const min = Number(item.priceMin || 0);
    const max = Number(item.priceMax || item.price || 0);
    if (!min && !max) return "";
    const format = amount => Number(amount).toLocaleString("ar-SA");
    const label = isOffer ? "السعر" : "الميزانية";
    if (min && max && min !== max) return `${label}: ${format(min)} — ${format(max)} ريال`;
    return `${label}: ${format(max || min)} ريال`;
  }

  function renderBankItems(items) {
    if (!el.bankList) return;
    if (!items.length) {
      el.bankList.innerHTML = `<p class="bank-state">لا توجد فرص محفوظة بعد.<br>تُحفظ الفرص الجديدة هنا تلقائيًا وتبقى جاهزة للمطابقة.</p>`;
      return;
    }
    el.bankList.innerHTML = items.map(item => {
      const kind = OPPORTUNITY_KIND_LABELS[item.recordType] || "فرصة";
      const cooperation = COOPERATION_STATUS_LABELS[item.cooperationStatus] || COOPERATION_STATUS_LABELS.not_shared;
      const headline = [item.propertyType, item.district].filter(Boolean).join(" — ") || "بيانات غير مكتملة";
      const line = [
        item.city || "",
        bankAmountLabel(item),
        item.area ? `المساحة: ${Number(item.area).toLocaleString("ar-SA")} م²` : "",
        item.rooms ? `الغرف: ${item.rooms}` : ""
      ].filter(Boolean).join(" • ");
      const contactName = item.contactName ? `صاحب العلاقة: ${item.contactName}` : "";
      return `<article class="bank-item">
        <div class="bank-item-head">
          <strong>${escapeHtml(headline)}</strong>
          <span class="bank-kind">${escapeHtml(kind)}</span>
        </div>
        ${line ? `<div class="bank-item-line">${escapeHtml(line)}</div>` : ""}
        ${contactName ? `<div class="bank-item-line">${escapeHtml(contactName)}</div>` : ""}
        <div class="bank-item-meta">
          <span>أُضيفت: ${escapeHtml(bankDateLabel(item.createdAt))}</span>
          <span>التعاون: ${escapeHtml(cooperation)}</span>
        </div>
      </article>`;
    }).join("");
  }

  async function loadOpportunityBank() {
    if (!el.bankList) return;
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.refs || !user) {
      el.bankList.innerHTML = `<p class="bank-state error">سجل دخول مدير المكتب لعرض بنك الفرص.</p>`;
      return;
    }
    el.bankList.innerHTML = `<p class="bank-state">جارٍ تحميل فرص المكتب...</p>`;
    try {
      const snapshot = await runtime.refs.opportunities.orderBy("createdAt", "desc").limit(50).get();
      renderBankItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (error) {
      console.warn("[iaqar] opportunity bank", error);
      const denied = String(error && error.code || "").includes("permission-denied");
      el.bankList.innerHTML = `<p class="bank-state error">${denied
        ? "حسابك غير مخوّل لعرض بنك فرص هذا المكتب."
        : "تعذر تحميل بنك الفرص الآن. تحقق من الاتصال وحاول مرة أخرى."}</p>`;
    }
  }

  function openOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = false;
    loadOpportunityBank();
  }

  function closeOpportunityBank() {
    if (el.bankOverlay) el.bankOverlay.hidden = true;
  }

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم التواصل", current.phone],
      ["رقم واتساب", current.whatsapp],
      ["المدينة", current.city],
      ["صورة المكتب أو الترويسة", current.coverUrl]
    ];
    return fields.filter(([, valid]) => !valid).map(([label]) => label);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawImageCover(ctx, image, x, y, width, height, radius = 0) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = (image.naturalHeight - sourceHeight) / 2;
    ctx.save();
    if (radius) {
      roundedRect(ctx, x, y, width, height, radius);
      ctx.clip();
    }
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
    ctx.restore();
  }

  function drawImageContain(ctx, image, x, y, width, height) {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  function drawQr(ctx, text, x, y, size) {
    if (typeof window.qrcode !== "function") throw new Error("QR_UNAVAILABLE");
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const cell = size / modules;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 14, y - 14, size + 28, size + 28);
    ctx.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const px = x + Math.floor(col * cell);
        const py = y + Math.floor(row * cell);
        const nextX = x + Math.ceil((col + 1) * cell);
        const nextY = y + Math.ceil((row + 1) * cell);
        ctx.fillRect(px, py, nextX - px, nextY - py);
      }
    }
  }

  async function createOfficeCardBlob() {
    const missing = officeMissingFields();
    if (missing.length) throw new Error(`MISSING:${missing.join("، ")}`);

    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    const link = officeLink();

    ctx.fillStyle = "#f4f8f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#087064";
    ctx.fillRect(0, 0, canvas.width, 190);

    const logoNode = document.querySelector(".site-logo img,.brand-logo img,.office-logo img");
    if (logoNode && logoNode.src) {
      try {
        const logo = await loadImage(logoNode.src);
        ctx.fillStyle = "#ffffff";
        roundedRect(ctx, 820, 28, 175, 132, 24);
        ctx.fill();
        drawImageContain(ctx, logo, 838, 42, 139, 104);
      } catch (_) {}
    }

    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 43px Tajawal, Arial, sans-serif";
    ctx.fillText("مكاتب عقارية ذكية", 770, 82);
    ctx.font = "500 25px Tajawal, Arial, sans-serif";
    ctx.fillStyle = "#d7ece7";
    ctx.fillText("بطاقة المكتب العقاري", 770, 126);

    const cover = await loadImage(current.coverUrl);
    drawImageCover(ctx, cover, 60, 225, 960, 420, 32);

    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, 60, 680, 960, 610, 34);
    ctx.fill();

    ctx.textAlign = "right";
    ctx.fillStyle = "#073f35";
    ctx.font = "700 51px Tajawal, Arial, sans-serif";
    ctx.fillText(current.officeName, 950, 765);
    ctx.font = "600 31px Tajawal, Arial, sans-serif";
    ctx.fillStyle = "#36584f";
    ctx.fillText(`الوسيط: ${current.brokerName}`, 950, 825);

    const rows = [
      ["رخصة فال", current.licenseNumber],
      ["المدينة", current.city],
      ["التواصل", current.phone],
      ["واتساب", current.whatsapp]
    ];
    let rowY = 900;
    for (const [label, value] of rows) {
      ctx.fillStyle = "#6a7d77";
      ctx.font = "500 25px Tajawal, Arial, sans-serif";
      ctx.fillText(label, 950, rowY);
      ctx.fillStyle = "#073f35";
      ctx.font = "700 29px Tajawal, Arial, sans-serif";
      ctx.fillText(value, 700, rowY);
      rowY += 58;
    }

    drawQr(ctx, link, 105, 890, 265);
    ctx.textAlign = "center";
    ctx.fillStyle = "#073f35";
    ctx.font = "700 22px Tajawal, Arial, sans-serif";
    ctx.fillText("امسح الرمز لزيارة المكتب", 238, 1190);

    ctx.textAlign = "right";
    ctx.fillStyle = "#e87512";
    ctx.font = "700 25px Tajawal, Arial, sans-serif";
    ctx.fillText(link.replace(/^https?:\/\//, ""), 950, 1210);
    ctx.fillStyle = "#71817c";
    ctx.font = "500 20px Tajawal, Arial, sans-serif";
    ctx.fillText("طلبات العملاء وعروض الملاك تصل مباشرة إلى المكتب", 950, 1250);

    return new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
  }

  async function ensurePublicSlug() {
    if (current.publicSlug) return current.publicSlug;
    const slug = buildPublicSlug(current.officeName);
    current = clean({ ...current, publicSlug: slug });
    el.link.value = officeLink();
    const runtime = officeRuntime();
    const user = authUser();
    if (runtime && runtime.db && user) {
      const now = window.firebase.firestore.FieldValue.serverTimestamp();
      await Promise.all([
        runtime.db.collection("offices").doc(officeId()).set({ publicSlug: slug, updatedAt: now }, { merge: true }),
        runtime.db.collection("publicOffices").doc(officeId()).set({ officeId: officeId(), publicSlug: slug, updatedAt: now }, { merge: true })
      ]);
      saveLocal(current);
    }
    return slug;
  }

  async function shareOfficeCard() {
    const missing = officeMissingFields();
    if (missing.length) {
      toast(`أكمل بيانات المكتب أولًا: ${missing.join("، ")}`);
      return;
    }
    const originalText = el.shareCard.textContent;
    el.shareCard.disabled = true;
    el.shareCard.textContent = "جارٍ تجهيز البطاقة...";
    try {
      await ensurePublicSlug();
      const link = officeLink();
      const text = [
        current.officeName,
        `الوسيط: ${current.brokerName}`,
        `رخصة فال: ${current.licenseNumber}`,
        `المدينة: ${current.city}`,
        `التواصل: ${current.phone}`,
        `واتساب: ${current.whatsapp}`,
        "زيارة المكتب والتسجيل:",
        link
      ].join("\n");
      const blob = await createOfficeCardBlob();
      if (!blob) throw new Error("CARD_FAILED");
      const file = new File([blob], `بطاقة-${current.officeName}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: current.officeName, text });
        return;
      }
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      toast("تم تنزيل البطاقة وفتح رسالة المشاركة");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (String(error && error.message || "").startsWith("MISSING:")) {
        toast(`أكمل بيانات المكتب أولًا: ${error.message.slice(8)}`);
      } else {
        console.warn("[iaqar] office card", error);
        toast("تعذر إنشاء بطاقة المكتب الآن");
      }
    } finally {
      el.shareCard.disabled = false;
      el.shareCard.textContent = originalText;
    }
  }

  async function updateAuthState(user) {
    authClaims = {};
    el.logout.disabled = !user;
    if (!user) {
      el.note.textContent = "البيانات محفوظة على هذا الجهاز. سجل دخول مدير المكتب للمزامنة مع Firestore.";
      return;
    }

    try {
      const token = await user.getIdTokenResult();
      authClaims = token.claims || {};
    } catch (_) {}

    await loadFirestore();
  }

  function init() {
    el.form = document.getElementById("officeProfileForm");
    if (!el.form) return;

    el.officeName = document.getElementById("officeNameInput");
    el.brokerName = document.getElementById("brokerNameInput");
    el.phone = document.getElementById("officePhoneInput");
    el.whatsapp = document.getElementById("officeWhatsappInput");
    el.license = document.getElementById("licenseNumberInput");
    el.city = document.getElementById("officeCityInput");
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.coverRemove = document.getElementById("officeCoverRemoveBtn");
    el.coverStatus = document.getElementById("officeCoverStatus");
    el.coverCropRow = document.getElementById("officeCoverCropRow");
    el.coverCropOffset = document.getElementById("officeCoverCropOffset");
    el.logo = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.logoRemove = document.getElementById("officeLogoRemoveBtn");
    el.logoStatus = document.getElementById("officeLogoStatus");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.showQr = document.getElementById("showOfficeQrBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qrPanel = document.getElementById("officeQrPanel");
    el.qrCanvas = document.getElementById("officeQrCanvas");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notificationPrefs = document.querySelectorAll('input[name="notificationPref"]');
    el.cooperationModes = document.querySelectorAll('input[name="cooperationMode"]');
    el.bankBtn = document.getElementById("opportunityBankBtn");
    el.bankOverlay = document.getElementById("opportunityBank");
    el.bankClose = document.getElementById("opportunityBankClose");
    el.bankList = document.getElementById("opportunityBankList");

    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.showQr) el.showQr.addEventListener("click", toggleQrPanel);
    if (el.previewLink) el.previewLink.addEventListener("click", previewOfficePage);
    if (el.cover) el.cover.addEventListener("change", handleCoverSelection);
    if (el.coverRemove) el.coverRemove.addEventListener("click", requestCoverRemoval);
    if (el.coverCropOffset) el.coverCropOffset.addEventListener("input", () => {
      pendingMedia.cover.offset = Number(el.coverCropOffset.value) || 50;
      renderCoverCrop();
    });
    if (el.logo) el.logo.addEventListener("change", handleLogoSelection);
    if (el.logoRemove) el.logoRemove.addEventListener("click", requestLogoRemoval);
    if (el.bankBtn) el.bankBtn.addEventListener("click", openOpportunityBank);
    if (el.bankClose) el.bankClose.addEventListener("click", closeOpportunityBank);
    if (el.bankOverlay) el.bankOverlay.addEventListener("click", event => {
      if (event.target === el.bankOverlay) closeOpportunityBank();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && el.bankOverlay && !el.bankOverlay.hidden) closeOpportunityBank();
    });

    try {
      if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(updateAuthState);
      else updateAuthState(null);
    } catch (_) {
      updateAuthState(null);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
