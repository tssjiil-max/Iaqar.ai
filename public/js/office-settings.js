(() => {
  "use strict";

  // نسبة الغلاف الواسع المتوافقة مع واتساب — قيمة قابلة للضبط بدون إعادة كتابة سير الرفع
  const COVER_ASPECT_RATIO = 1.91;

  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

  const NOTIFICATION_PREFS_DEFAULTS = Object.freeze({
    matches: true,
    ownerCustomer: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  });

  const COOPERATION_MODE_DEFAULT = "approval_required";

  const defaults = {
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    coverUrl: "",
    logoUrl: "",
    publicSlug: "",
    cooperationMode: COOPERATION_MODE_DEFAULT,
    notificationPrefs: { ...NOTIFICATION_PREFS_DEFAULTS }
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};

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
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
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

  function clean(data) {
    return {
      officeName: safeText(data.officeName, defaults.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: safeText(data.brokerName, defaults.brokerName).slice(0, 80),
      phone: safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      cooperationMode: ["approval_required", "disabled", "smart_automatic"].includes(data.cooperationMode)
        ? data.cooperationMode
        : COOPERATION_MODE_DEFAULT,
      notificationPrefs: Object.assign({}, NOTIFICATION_PREFS_DEFAULTS, data.notificationPrefs || {})
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

  function updateCardCover(coverUrl) {
    const btn = document.getElementById("officeCoverCardBtn");
    const img = document.getElementById("officeCoverCardImg");
    if (!btn || !img) return;
    if (coverUrl) {
      img.src = coverUrl;
      btn.hidden = false;
    } else {
      btn.hidden = true;
    }
  }

  function updateCardLogo(logoUrl) {
    const img = document.getElementById("officeLogoImg");
    if (!img) return;
    if (logoUrl) img.src = logoUrl;
  }

  function renderQrCode(link) {
    const canvas = el.qrCanvas;
    if (!canvas || typeof window.qrcode !== "function") return;
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(link);
      qr.make();
      const modules = qr.getModuleCount();
      const size = 96;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const cell = size / modules;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#073f35";
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (!qr.isDark(row, col)) continue;
          const px = Math.floor(col * cell);
          const py = Math.floor(row * cell);
          const nx = Math.ceil((col + 1) * cell);
          const ny = Math.ceil((row + 1) * cell);
          ctx.fillRect(px, py, nx - px, ny - py);
        }
      }
    } catch (error) {
      console.warn("[iaqar] QR render", error);
    }
  }

  function writeNotificationPrefsToForm(prefs) {
    const safePrefs = Object.assign({}, NOTIFICATION_PREFS_DEFAULTS, prefs || {});
    const ids = {
      matches: "notifMatches",
      ownerCustomer: "notifOwnerCustomer",
      cooperation: "notifCooperation",
      messages: "notifMessages",
      appointments: "notifAppointments",
      system: "notifSystem"
    };
    Object.entries(ids).forEach(([key, elementId]) => {
      const input = document.getElementById(elementId);
      if (input) input.checked = Boolean(safePrefs[key]);
    });
  }

  function readNotificationPrefsFromForm() {
    return {
      matches: Boolean(document.getElementById("notifMatches")?.checked),
      ownerCustomer: Boolean(document.getElementById("notifOwnerCustomer")?.checked),
      cooperation: Boolean(document.getElementById("notifCooperation")?.checked),
      messages: Boolean(document.getElementById("notifMessages")?.checked),
      appointments: Boolean(document.getElementById("notifAppointments")?.checked),
      system: Boolean(document.getElementById("notifSystem")?.checked)
    };
  }

  function writeCooperationModeToForm(mode) {
    const safeMode = ["approval_required", "disabled", "smart_automatic"].includes(mode)
      ? mode
      : COOPERATION_MODE_DEFAULT;
    const radio = document.querySelector(`input[name="cooperationMode"][value="${safeMode}"]`);
    if (radio) radio.checked = true;
  }

  function readCooperationModeFromForm() {
    const radio = document.querySelector('input[name="cooperationMode"]:checked');
    return radio ? radio.value : COOPERATION_MODE_DEFAULT;
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    if (el.officeName) el.officeName.value = current.officeName;
    if (el.brokerName) el.brokerName.value = current.brokerName;
    if (el.phone) el.phone.value = current.phone;
    if (el.license) el.license.value = current.licenseNumber;
    if (el.city) el.city.value = current.city;
    if (el.link) el.link.value = officeLink();
    writeSpecialtiesToForm(current.specialties);
    writeNotificationPrefsToForm(current.notificationPrefs);
    writeCooperationModeToForm(current.cooperationMode);

    // تحديث معاينة الغلاف في الهوية البصرية
    if (el.coverPreviewLarge) {
      el.coverPreviewLarge.src = current.coverUrl || "";
      el.coverPreviewLarge.hidden = !current.coverUrl;
    }
    if (el.coverPlaceholder) {
      el.coverPlaceholder.hidden = Boolean(current.coverUrl);
    }

    // تحديث معاينة الشعار في الهوية البصرية
    if (el.logoPreviewLarge) {
      el.logoPreviewLarge.src = current.logoUrl || "";
      el.logoPreviewLarge.hidden = !current.logoUrl;
    }
    if (el.logoPlaceholder) {
      el.logoPlaceholder.hidden = Boolean(current.logoUrl);
    }

    // تحديث البطاقة الرئيسية
    updateCardCover(current.coverUrl);
    updateCardLogo(current.logoUrl);

    // تحديث QR
    renderQrCode(officeLink());

    // تحديث عناصر العرض في البطاقة
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
          licenseNumber: data.licenseNumber || data.falLicense,
          city: data.city,
          specialties: data.specialties,
          coverUrl: data.coverUrl,
          logoUrl: data.logoUrl,
          publicSlug: data.publicSlug,
          cooperationMode: data.cooperationMode,
          notificationPrefs: data.notificationPrefs
        });
        saveLocal(current);
      }
      if (el.note) el.note.textContent = "البيانات متزامنة مع Firestore لهذا المكتب.";
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      if (el.note) el.note.textContent = "تم عرض البيانات المحفوظة على الجهاز. يلزم حساب مدير مخوّل للمزامنة.";
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

      const officeUpdate = {
        officeName: data.officeName,
        officeNameKey: data.officeNameKey,
        brokerName: data.brokerName,
        phone: data.phone,
        licenseNumber: data.licenseNumber,
        city: data.city,
        specialties: data.specialties,
        officeId: officeId(),
        ownerUid: officeSnap.exists && officeSnap.data().ownerUid
          ? officeSnap.data().ownerUid
          : user.uid,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      };

      transaction.set(officeRef, officeUpdate, { merge: true });
      transaction.set(publicRef, {
        officeId: officeId(),
        officeName: data.officeName,
        brokerName: data.brokerName,
        phone: data.phone,
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

    const data = clean({
      officeName: el.officeName.value,
      brokerName: el.brokerName.value,
      phone: el.phone.value,
      licenseNumber: el.license.value,
      city: el.city.value,
      specialties,
      coverUrl: current.coverUrl,
      logoUrl: current.logoUrl,
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value),
      cooperationMode: current.cooperationMode,
      notificationPrefs: current.notificationPrefs
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
      if (el.note) el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

    apply(data);
    saveLocal(data);
    if (el.note) el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
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
    const link = el.link.value;
    if (!link) return toast("لا يوجد رابط بعد؛ احفظ بيانات المكتب أولًا");
    if (navigator.share) {
      try {
        await navigator.share({
          title: current.officeName || "مكتب عقاري",
          text: `زر مكتب ${current.officeName || "العقاري"} على IAQAR.AI`,
          url: link
        });
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
      }
    }
    await copyLink();
  }

  async function uploadMedia(file, endpoint, extraHeaders = {}) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      throw new Error("اختر صورة JPG أو PNG أو WebP");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("حجم الصورة يتجاوز 10 ميجابايت");
    }
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        ...extraHeaders
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر رفع الصورة");
    return result;
  }

  async function saveLogo() {
    const button = document.getElementById("saveLogoBtn");
    const noteEl = document.getElementById("visualIdentityNote");
    const file = el.logoInput && el.logoInput.files && el.logoInput.files[0];
    if (!file) return toast("اختر صورة الشعار أولًا");

    if (button) { button.disabled = true; button.textContent = "جارٍ الرفع..."; }
    if (noteEl) noteEl.textContent = "";

    try {
      const result = await uploadMedia(file, "/media/office-logo");
      const logoUrl = result.logoUrl || result.coverUrl;
      if (!logoUrl) throw new Error("لم يُعد رابط الشعار من الخادم");

      current = clean({ ...current, logoUrl });
      saveLocal(current);
      updateCardLogo(logoUrl);

      const runtime = officeRuntime();
      const user = authUser();
      if (runtime && runtime.db && user) {
        await runtime.db.collection("offices").doc(officeId()).set(
          { logoUrl, officeId: officeId(), updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await runtime.db.collection("publicOffices").doc(officeId()).set(
          { officeId: officeId(), logoUrl, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      if (el.logoPreviewLarge) { el.logoPreviewLarge.src = logoUrl; el.logoPreviewLarge.hidden = false; }
      if (el.logoPlaceholder) el.logoPlaceholder.hidden = true;
      if (noteEl) noteEl.textContent = "تم حفظ الشعار.";
      toast("تم تحديث شعار المكتب");
    } catch (error) {
      toast(error.message || "تعذر رفع الشعار");
      if (noteEl) noteEl.textContent = error.message || "تعذر رفع الشعار";
    } finally {
      if (button) { button.disabled = false; button.textContent = "حفظ الشعار"; }
    }
  }

  async function saveCover() {
    const button = document.getElementById("saveCoverBtn");
    const noteEl = document.getElementById("visualIdentityNote");
    const file = el.coverInput && el.coverInput.files && el.coverInput.files[0];
    if (!file) return toast("اختر صورة الغلاف أولًا");

    if (button) { button.disabled = true; button.textContent = "جارٍ الرفع..."; }
    if (noteEl) noteEl.textContent = "";

    try {
      const result = await uploadMedia(file, "/media/office-cover");
      const coverUrl = result.coverUrl;
      if (!coverUrl) throw new Error("لم يُعد رابط الغلاف من الخادم");

      current = clean({ ...current, coverUrl });
      saveLocal(current);
      updateCardCover(coverUrl);

      const runtime = officeRuntime();
      const user = authUser();
      if (runtime && runtime.db && user) {
        await runtime.db.collection("offices").doc(officeId()).set(
          { coverUrl, officeId: officeId(), updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await runtime.db.collection("publicOffices").doc(officeId()).set(
          { officeId: officeId(), coverUrl, updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      if (el.coverPreviewLarge) { el.coverPreviewLarge.src = coverUrl; el.coverPreviewLarge.hidden = false; }
      if (el.coverPlaceholder) el.coverPlaceholder.hidden = true;
      if (noteEl) noteEl.textContent = "تم حفظ الغلاف.";
      toast("تم تحديث صورة غلاف المكتب");
    } catch (error) {
      toast(error.message || "تعذر رفع الغلاف");
      if (noteEl) noteEl.textContent = error.message || "تعذر رفع الغلاف";
    } finally {
      if (button) { button.disabled = false; button.textContent = "حفظ الغلاف"; }
    }
  }

  async function saveNotificationPrefs() {
    const button = document.getElementById("saveNotifPrefsBtn");
    const prefs = readNotificationPrefsFromForm();
    if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ..."; }
    try {
      current = clean({ ...current, notificationPrefs: prefs });
      saveLocal(current);
      const runtime = officeRuntime();
      const user = authUser();
      if (runtime && runtime.db && user) {
        await runtime.db.collection("offices").doc(officeId()).set(
          { notificationPrefs: prefs, officeId: officeId(), updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      toast("تم حفظ تفضيلات الإشعارات");
    } catch (error) {
      toast(error.message || "تعذر حفظ التفضيلات");
    } finally {
      if (button) { button.disabled = false; button.textContent = "حفظ التفضيلات"; }
    }
  }

  async function saveCooperationMode() {
    const button = document.getElementById("saveCooperationBtn");
    const noteEl = document.getElementById("cooperationNote");
    const mode = readCooperationModeFromForm();
    if (button) { button.disabled = true; button.textContent = "جارٍ الحفظ..."; }
    if (noteEl) noteEl.textContent = "";
    try {
      current = clean({ ...current, cooperationMode: mode });
      saveLocal(current);
      const runtime = officeRuntime();
      const user = authUser();
      if (runtime && runtime.db && user) {
        await runtime.db.collection("offices").doc(officeId()).set(
          { cooperationMode: mode, officeId: officeId(), updatedAt: window.firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      const modeLabels = {
        approval_required: "يتطلب موافقة الوسيط",
        disabled: "معطل",
        smart_automatic: "تعاون ذكي تلقائي"
      };
      if (noteEl) noteEl.textContent = `الوضع الحالي: ${modeLabels[mode] || mode}`;
      toast("تم حفظ إعدادات التعاون");
    } catch (error) {
      toast(error.message || "تعذر حفظ إعدادات التعاون");
      if (noteEl) noteEl.textContent = error.message || "تعذر الحفظ";
    } finally {
      if (button) { button.disabled = false; button.textContent = "حفظ إعدادات التعاون"; }
    }
  }

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم التواصل", current.phone],
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

    const logoNode = document.querySelector("#officeLogoImg,.site-logo img,.brand-logo img");
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
    // استخدام نسبة COVER_ASPECT_RATIO للغلاف
    const coverHeight = Math.round(960 / COVER_ASPECT_RATIO);
    drawImageCover(ctx, cover, 60, 225, 960, Math.min(coverHeight, 420), 32);

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
      ["التواصل", current.phone]
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
    if (el.link) el.link.value = officeLink();
    renderQrCode(officeLink());
    const runtime = officeRuntime();
    const user = authUser();
    if (runtime && runtime.db && user) {
      const now = window.firebase.firestore.FieldValue.serverTimestamp();
      await Promise.all([
        runtime.db.collection("offices").doc(officeId()).set({ publicSlug: slug, officeId: officeId(), updatedAt: now }, { merge: true }),
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
    const button = el.shareCard;
    const originalText = button ? button.textContent : "";
    if (button) { button.disabled = true; button.textContent = "جارٍ تجهيز البطاقة..."; }
    try {
      await ensurePublicSlug();
      const link = officeLink();
      const text = [
        current.officeName,
        `الوسيط: ${current.brokerName}`,
        `رخصة فال: ${current.licenseNumber}`,
        `المدينة: ${current.city}`,
        `التواصل: ${current.phone}`,
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
      if (button) { button.disabled = false; button.textContent = originalText; }
    }
  }

  async function updateAuthState(user) {
    authClaims = {};
    if (el.logout) el.logout.disabled = !user;
    if (!user) {
      if (el.note) el.note.textContent = "البيانات محفوظة على هذا الجهاز. سجل دخول مدير المكتب للمزامنة مع Firestore.";
      return;
    }

    try {
      const token = await user.getIdTokenResult();
      authClaims = token.claims || {};
    } catch (_) {}

    await loadFirestore();
  }

  function setupLogoUploadArea() {
    const area = document.getElementById("logoUploadArea");
    if (!area || !el.logoInput) return;

    area.addEventListener("click", () => el.logoInput.click());
    area.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") el.logoInput.click();
    });
    el.logoInput.addEventListener("change", () => {
      const file = el.logoInput.files && el.logoInput.files[0];
      if (!file || !el.logoPreviewLarge) return;
      el.logoPreviewLarge.src = URL.createObjectURL(file);
      el.logoPreviewLarge.hidden = false;
      if (el.logoPlaceholder) el.logoPlaceholder.hidden = true;
    });
  }

  function setupCoverUploadArea() {
    const area = document.getElementById("coverUploadArea");
    if (!area || !el.coverInput) return;

    area.addEventListener("click", () => el.coverInput.click());
    area.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") el.coverInput.click();
    });
    el.coverInput.addEventListener("change", () => {
      const file = el.coverInput.files && el.coverInput.files[0];
      if (!file || !el.coverPreviewLarge) return;
      el.coverPreviewLarge.src = URL.createObjectURL(file);
      el.coverPreviewLarge.hidden = false;
      if (el.coverPlaceholder) el.coverPlaceholder.hidden = true;
    });
  }

  function init() {
    el.form = document.getElementById("officeProfileForm");
    if (!el.form) return;

    el.officeName = document.getElementById("officeNameInput");
    el.brokerName = document.getElementById("brokerNameInput");
    el.phone = document.getElementById("officePhoneInput");
    el.license = document.getElementById("licenseNumberInput");
    el.city = document.getElementById("officeCityInput");

    // عناصر الهوية البصرية
    el.logoInput = document.getElementById("officeLogoInput");
    el.logoPreviewLarge = document.getElementById("officeLogoPreviewLarge");
    el.logoPlaceholder = document.getElementById("officeLogoPlaceholder");
    el.coverInput = document.getElementById("officeCoverInput");
    el.coverPreviewLarge = document.getElementById("officeCoverPreviewLarge");
    el.coverPlaceholder = document.getElementById("officeCoverPlaceholder");

    // عناصر الرابط
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.qrCanvas = document.getElementById("officeQrCanvas");

    // عناصر الإجراءات
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');

    apply(loadLocal() || defaults);

    setupLogoUploadArea();
    setupCoverUploadArea();

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    if (el.copy) el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);

    const saveLogoBtn = document.getElementById("saveLogoBtn");
    if (saveLogoBtn) saveLogoBtn.addEventListener("click", saveLogo);

    const saveCoverBtn = document.getElementById("saveCoverBtn");
    if (saveCoverBtn) saveCoverBtn.addEventListener("click", saveCover);

    const saveNotifBtn = document.getElementById("saveNotifPrefsBtn");
    if (saveNotifBtn) saveNotifBtn.addEventListener("click", saveNotificationPrefs);

    const saveCoopBtn = document.getElementById("saveCooperationBtn");
    if (saveCoopBtn) saveCoopBtn.addEventListener("click", saveCooperationMode);

    const openBankBtn = document.getElementById("openBankBtn");
    if (openBankBtn) openBankBtn.addEventListener("click", () => {
      toast("بنك الفرص — قيد التطوير في المرحلة القادمة");
    });

    if (el.logout) el.logout.addEventListener("click", onLogout);

    // ربط الغلاف والشعار بالبطاقة الرئيسية
    const coverCardBtn = document.getElementById("officeCoverCardBtn");
    const settingsOverlay = document.getElementById("officeSettings");
    if (coverCardBtn && settingsOverlay) {
      coverCardBtn.addEventListener("click", () => {
        settingsOverlay.hidden = false;
        document.body.style.overflow = "hidden";
      });
    }

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
