(() => {
  "use strict";

  const lib = () => window.IAQAR_OFFICE_PROFILE || {};
  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

  const defaults = {
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    whatsapp: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    logoUrl: "",
    coverUrl: "",
    whatsappCoverUrl: "",
    publicSlug: "",
    notificationPreferences: null,
    cooperationMode: "APPROVAL_REQUIRED"
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};
  let pendingCrop = null;
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

  function setStatus(message) {
    if (el.status) el.status.textContent = message || "";
  }

  function safeText(value, fallback = "") {
    return lib().safeText ? lib().safeText(value, fallback) : String(value == null ? fallback : value).trim();
  }

  function normalizeOfficeNameKey(value) {
    return lib().normalizeOfficeNameKey
      ? lib().normalizeOfficeNameKey(value)
      : safeText(value).normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s._-]+/g, "").replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  function validateOfficeName(value) {
    if (lib().validateOfficeName) return lib().validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (name.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "").length < 4 && !isPlatformAdmin()) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    return "";
  }

  function design() {
    return lib().OFFICE_COVER_DESIGN || {
      whatsappCoverAspectRatio: 1.91,
      displayImageAspectRatio: 16 / 9,
      logoAspectRatio: 1,
      maxImageBytes: 10 * 1024 * 1024,
      allowedImageTypes: ["image/jpeg", "image/png", "image/webp"]
    };
  }

  function normalizeNotificationPreferences(value) {
    return lib().normalizeNotificationPreferences
      ? lib().normalizeNotificationPreferences(value)
      : {
        match: value && value.match === false ? false : true,
        ownerCustomer: value && value.ownerCustomer === false ? false : true,
        cooperation: value && value.cooperation === false ? false : true,
        message: value && value.message === false ? false : true,
        appointmentFollowUp: value && value.appointmentFollowUp === false ? false : true,
        systemImportant: value && value.systemImportant === false ? false : true
      };
  }

  function normalizeCooperationMode(value) {
    return lib().normalizeCooperationMode
      ? lib().normalizeCooperationMode(value)
      : (["DISABLED", "SMART_AUTOMATIC"].includes(String(value || "").toUpperCase())
        ? String(value).toUpperCase()
        : "APPROVAL_REQUIRED");
  }

  function buildPublicSlug(name) {
    return lib().buildPublicSlug
      ? lib().buildPublicSlug(name, officeId())
      : `maktab-${officeId()}`.slice(0, 64);
  }

  function cropRectForAspect(width, height, ratio) {
    return lib().cropRectForAspect
      ? lib().cropRectForAspect(width, height, ratio)
      : { x: 0, y: 0, width, height };
  }

  function isValidImageFile(file) {
    if (!file) return false;
    if (lib().isValidImageFileMeta) {
      return lib().isValidImageFileMeta({ type: file.type, size: file.size }, design());
    }
    return /^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024;
  }

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
  }

  function clean(data) {
    const phone = safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20);
    return {
      officeName: safeText(data.officeName, defaults.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: safeText(data.brokerName, defaults.brokerName).slice(0, 80),
      phone,
      whatsapp: phone,
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      whatsappCoverUrl: safeText(data.whatsappCoverUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      notificationPreferences: normalizeNotificationPreferences(data.notificationPreferences),
      cooperationMode: normalizeCooperationMode(data.cooperationMode)
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

  function readNotificationPrefsFromForm() {
    const prefs = normalizeNotificationPreferences({});
    Array.from(document.querySelectorAll("#officeNotificationPrefs input[data-pref]")).forEach(input => {
      prefs[input.dataset.pref] = input.checked;
    });
    return prefs;
  }

  function writeNotificationPrefsToForm(prefs) {
    const normalized = normalizeNotificationPreferences(prefs);
    Array.from(document.querySelectorAll("#officeNotificationPrefs input[data-pref]")).forEach(input => {
      input.checked = normalized[input.dataset.pref] !== false;
    });
  }

  function readCooperationModeFromForm() {
    const selected = document.querySelector('input[name="cooperationMode"]:checked');
    return normalizeCooperationMode(selected && selected.value);
  }

  function writeCooperationModeToForm(mode) {
    const value = normalizeCooperationMode(mode);
    Array.from(document.querySelectorAll('input[name="cooperationMode"]')).forEach(input => {
      input.checked = input.value === value;
    });
  }

  function setPreview(img, url) {
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
  }

  function applyDisplayMedia() {
    const logoBtn = document.getElementById("officeSettingsBtn");
    const logoImg = logoBtn ? logoBtn.querySelector("img") : null;
    if (logoImg) {
      if (!defaultLogoSrc) defaultLogoSrc = logoImg.getAttribute("src") || logoImg.src || "";
      logoImg.src = current.logoUrl || defaultLogoSrc;
      if (logoBtn) logoBtn.classList.toggle("has-custom-logo", Boolean(current.logoUrl));
    }

    const coverImg = document.getElementById("officeDisplayCover");
    const coverEmpty = document.getElementById("officeDisplayCoverEmpty");
    if (coverImg) {
      if (current.coverUrl) {
        coverImg.src = current.coverUrl;
        coverImg.hidden = false;
        if (coverEmpty) coverEmpty.hidden = true;
      } else {
        coverImg.removeAttribute("src");
        coverImg.hidden = true;
        if (coverEmpty) coverEmpty.hidden = false;
      }
    }
  }

  function renderOfficeQr() {
    if (!el.qrCanvas || typeof window.qrcode !== "function") return;
    try {
      const link = officeLink();
      const qr = window.qrcode(0, "M");
      qr.addData(link);
      qr.make();
      const modules = qr.getModuleCount();
      const size = el.qrCanvas.width;
      const ctx = el.qrCanvas.getContext("2d");
      const cell = size / modules;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#073f35";
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (!qr.isDark(row, col)) continue;
          ctx.fillRect(Math.floor(col * cell), Math.floor(row * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    } catch (error) {
      console.warn("[iaqar] office qr", error);
    }
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
    writeNotificationPrefsToForm(current.notificationPreferences);
    writeCooperationModeToForm(current.cooperationMode);
    setPreview(el.logoPreview, current.logoUrl);
    setPreview(el.coverPreview, current.coverUrl);
    setPreview(el.whatsappCoverPreview, current.whatsappCoverUrl);
    applyDisplayMedia();
    renderOfficeQr();

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
          whatsapp: data.phone || data.whatsapp,
          licenseNumber: data.licenseNumber || data.falLicense,
          city: data.city,
          specialties: data.specialties,
          logoUrl: data.logoUrl,
          coverUrl: data.coverUrl,
          whatsappCoverUrl: data.whatsappCoverUrl,
          publicSlug: data.publicSlug,
          notificationPreferences: data.notificationPreferences,
          cooperationMode: data.cooperationMode
        });
        saveLocal(current);
      }
      if (el.note) el.note.textContent = "البيانات متزامنة مع Firestore لهذا المكتب.";
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      if (el.note) el.note.textContent = "تم عرض البيانات المحفوظة على الجهاز. يلزم حساب مدير مخوّل للمزامنة.";
      setStatus("تعذر مزامنة إعدادات المكتب.");
      return false;
    }
  }

  async function checkNameAvailability(runtime, nameKey) {
    if (!nameKey) return "اكتب اسم المكتب";
    const claimSnap = await runtime.db.collection("officeNameClaims").doc(nameKey).get();
    if (claimSnap.exists && claimSnap.data().officeId !== officeId()) {
      return "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
    }
    return "";
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
        logoUrl: data.logoUrl,
        coverUrl: data.coverUrl,
        whatsappCoverUrl: data.whatsappCoverUrl,
        publicSlug: data.publicSlug,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  async function uploadMedia(file, routePath, urlField) {
    const user = authUser();
    if (!user) throw new Error("AUTH_REQUIRED");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${routePath}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result[urlField] || result.mediaUrl)) {
      throw new Error(result.message || "تعذر رفع الصورة");
    }
    return result[urlField] || result.mediaUrl;
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

  async function cropFileToBlob(file, aspectRatio) {
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      const rect = cropRectForAspect(image.naturalWidth, image.naturalHeight, aspectRatio);
      const canvas = document.createElement("canvas");
      const maxWidth = aspectRatio >= 1 ? 1600 : 1200;
      const outWidth = Math.min(rect.width, maxWidth);
      const outHeight = Math.round(outWidth / aspectRatio);
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, outWidth, outHeight);
      const type = file.type === "image/png" ? "image/png" : "image/jpeg";
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.92));
      if (!blob) throw new Error("CROP_FAILED");
      return new File([blob], file.name.replace(/\.\w+$/, type === "image/png" ? ".png" : ".jpg"), { type });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function openCropDialog({ file, aspectRatio, title, help, onConfirm }) {
    pendingCrop = { file, aspectRatio, onConfirm };
    el.cropTitle.textContent = title;
    el.cropHelp.textContent = help;
    const objectUrl = URL.createObjectURL(file);
    loadImage(objectUrl).then(image => {
      const rect = cropRectForAspect(image.naturalWidth, image.naturalHeight, aspectRatio);
      const canvas = el.cropCanvas;
      const width = canvas.width;
      const height = Math.round(width / aspectRatio);
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f2f7f5";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
      el.cropOverlay.hidden = false;
    }).catch(() => {
      toast("تعذر معاينة الصورة للقص");
      pendingCrop = null;
    }).finally(() => URL.revokeObjectURL(objectUrl));
  }

  async function confirmCrop() {
    if (!pendingCrop) return;
    const { file, aspectRatio, onConfirm } = pendingCrop;
    try {
      setStatus("جارٍ قص الصورة…");
      const cropped = await cropFileToBlob(file, aspectRatio);
      await onConfirm(cropped);
      el.cropOverlay.hidden = true;
      pendingCrop = null;
      setStatus("");
    } catch (error) {
      console.warn("[iaqar] crop confirm", error);
      toast(error.message || "تعذر اعتماد القص");
      setStatus("فشل قص الصورة.");
    }
  }

  function cancelCrop() {
    pendingCrop = null;
    if (el.cropOverlay) el.cropOverlay.hidden = true;
  }

  function bindMediaInput(input, { aspectRatio, title, help, preview, urlField, routePath, assign }) {
    if (!input) return;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!isValidImageFile(file)) {
        toast("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 10 ميجابايت");
        input.value = "";
        return;
      }
      openCropDialog({
        file,
        aspectRatio,
        title,
        help,
        onConfirm: async cropped => {
          setPreview(preview, URL.createObjectURL(cropped));
          setStatus("جارٍ رفع الصورة…");
          try {
            const url = await uploadMedia(cropped, routePath, urlField);
            assign(url);
            setPreview(preview, url);
            applyDisplayMedia();
            setStatus("تم رفع الصورة. احفظ التعديلات لتثبيت الهوية.");
            toast("تم تجهيز الصورة");
          } catch (error) {
            if (String(error.message) === "AUTH_REQUIRED") toast("سجل دخول مدير المكتب قبل رفع الصورة");
            else toast(error.message || "تعذر رفع الصورة");
            setStatus("فشل رفع الصورة.");
          } finally {
            input.value = "";
          }
        }
      });
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
      logoUrl: current.logoUrl,
      coverUrl: current.coverUrl,
      whatsappCoverUrl: current.whatsappCoverUrl,
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value),
      notificationPreferences: readNotificationPrefsFromForm(),
      cooperationMode: readCooperationModeFromForm()
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city || !data.phone) {
      toast("أكمل بيانات المكتب المطلوبة");
      return;
    }

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";
    setStatus("جارٍ التحقق من اسم المكتب وحفظ الإعدادات…");

    const runtime = officeRuntime();
    const user = authUser();
    let synced = false;

    if (runtime && runtime.db && user) {
      try {
        const availabilityError = await checkNameAvailability(runtime, data.officeNameKey);
        if (availabilityError) {
          el.officeName.setCustomValidity(availabilityError);
          el.officeName.reportValidity();
          toast(availabilityError);
          el.save.disabled = false;
          el.save.textContent = "حفظ التعديلات";
          setStatus(availabilityError);
          return;
        }
        await reserveOfficeName(runtime, user, data);
        synced = true;
      } catch (error) {
        console.warn("[iaqar] office settings sync failed", error);
        if (error && error.message === "OFFICE_NAME_TAKEN") {
          const message = "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
          el.officeName.setCustomValidity(message);
          el.officeName.reportValidity();
          toast(message);
          setStatus(message);
          el.save.disabled = false;
          el.save.textContent = "حفظ التعديلات";
          return;
        }
      }
    }

    if (!synced) {
      if (el.note) el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      setStatus("فشل الحفظ.");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

    apply(data);
    saveLocal(data);
    if (el.note) el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
    setStatus("تم الحفظ بنجاح.");
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
    await ensurePublicSlug();
    const link = officeLink();
    el.link.value = link;
    renderOfficeQr();
    const text = `${current.officeName}\n${link}`;
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

  function previewLink() {
    ensurePublicSlug().then(() => {
      window.open(officeLink(), "_blank", "noopener,noreferrer");
    }).catch(() => {
      window.open(officeLink(), "_blank", "noopener,noreferrer");
    });
  }

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم الجوال", current.phone],
      ["المدينة", current.city],
      ["صورة عرض المكتب", current.coverUrl]
    ];
    return fields.filter(([, valid]) => !valid).map(([label]) => label);
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

    const logoSrc = current.logoUrl || defaultLogoSrc;
    if (logoSrc) {
      try {
        const logo = await loadImage(logoSrc);
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

    const cover = await loadImage(current.whatsappCoverUrl || current.coverUrl);
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
      ["الجوال", current.phone]
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
    renderOfficeQr();
    const runtime = officeRuntime();
    const user = authUser();
    if (runtime && runtime.db && user) {
      await reserveOfficeName(runtime, user, current);
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
        `الجوال: ${current.phone}`,
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

  function cooperationStatusLabel(value) {
    const labels = (lib().VISIBLE_COOPERATION_STATUS_AR) || {
      NOT_SHARED: "لم تُشارك",
      PENDING: "بانتظار الموافقة",
      ACTIVE: "تعاون نشط",
      REJECTED: "رُفض الطلب",
      ENDED: "انتهى التعاون"
    };
    const key = String(value || "NOT_SHARED").toUpperCase();
    return labels[key] || labels.NOT_SHARED;
  }

  function formatBankDate(value) {
    try {
      if (!value) return "—";
      const date = value.toDate ? value.toDate() : new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString("ar-SA");
    } catch (_) {
      return "—";
    }
  }

  async function openOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    el.bankStatus.hidden = false;
    el.bankStatus.textContent = "جارٍ التحميل…";
    el.bankList.hidden = true;
    el.bankList.innerHTML = "";
    el.bankEmpty.hidden = true;

    const runtime = officeRuntime();
    const user = authUser();
    const id = officeId();
    if (!runtime || !runtime.db || !user || id === "platform") {
      el.bankStatus.textContent = "سجّل بحساب المكتب لعرض بنك الفرص الخاص به.";
      return;
    }

    try {
      let snap;
      try {
        snap = await runtime.db.collection("offices").doc(id).collection("opportunities")
          .orderBy("createdAt", "desc")
          .limit(40)
          .get();
      } catch (_) {
        snap = await runtime.db.collection("offices").doc(id).collection("opportunities")
          .limit(40)
          .get();
      }
      const items = [];
      snap.forEach(doc => {
        const data = doc.data() || {};
        if (data.officeId && data.officeId !== id) return;
        items.push({ id: doc.id, ...data });
      });
      items.sort((a, b) => {
        const aTime = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const bTime = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return bTime - aTime;
      });

      if (!items.length) {
        el.bankStatus.hidden = true;
        el.bankEmpty.hidden = false;
        return;
      }

      el.bankStatus.hidden = true;
      el.bankList.hidden = false;
      el.bankList.innerHTML = items.map(item => {
        const title = [
          item.opportunityKind || item.kind || "فرصة",
          item.propertyType || "",
          item.city || "",
          item.district || ""
        ].filter(Boolean).join(" • ");
        const price = item.price || item.budget || item.budgetMax || "";
        return `<article class="bank-item" data-id="${item.id}">
          <strong>${safeText(title, "فرصة")}</strong>
          <span>تاريخ الإضافة: ${formatBankDate(item.createdAt)}</span>
          <span>حالة التعاون: ${cooperationStatusLabel(item.cooperationStatus || item.cooperationState)}</span>
          ${price ? `<span>السعر/الميزانية: ${safeText(String(price))}</span>` : ""}
        </article>`;
      }).join("");
    } catch (error) {
      console.warn("[iaqar] opportunity bank", error);
      el.bankStatus.textContent = "تعذر تحميل بنك الفرص. تحقق من الصلاحيات أو الفهارس.";
      setStatus("تعذر فتح بنك الفرص.");
    }
  }

  function closeOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = true;
    if (document.getElementById("officeSettings")?.hidden !== false) {
      document.body.style.overflow = "";
    }
    const settings = document.getElementById("officeSettings");
    if (settings && !settings.hidden) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
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

  function initRatioHelp() {
    const help = document.getElementById("whatsappCoverRatioHelp");
    if (!help) return;
    const ratio = design().whatsappCoverAspectRatio;
    help.textContent = `قص عريض بنسبة قابلة للتهيئة (${ratio}:1 تقريبًا) دون تثبيت أبعاد منصة خارجية داخل مسار الرفع.`;
  }

  function init() {
    el.form = document.getElementById("officeProfileForm");
    if (!el.form) return;

    el.officeName = document.getElementById("officeNameInput");
    el.brokerName = document.getElementById("brokerNameInput");
    el.phone = document.getElementById("officePhoneInput");
    el.license = document.getElementById("licenseNumberInput");
    el.city = document.getElementById("officeCityInput");
    el.logo = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.whatsappCover = document.getElementById("officeWhatsappCoverInput");
    el.whatsappCoverPreview = document.getElementById("officeWhatsappCoverPreview");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qrCanvas = document.getElementById("officeLinkQrCanvas");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.status = document.getElementById("officeSettingsStatus");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.bankOverlay = document.getElementById("opportunityBankOverlay");
    el.bankClose = document.getElementById("opportunityBankClose");
    el.bankStatus = document.getElementById("opportunityBankStatus");
    el.bankList = document.getElementById("opportunityBankList");
    el.bankEmpty = document.getElementById("opportunityBankEmpty");
    el.openBank = document.getElementById("openOpportunityBankBtn");
    el.cropOverlay = document.getElementById("officeCropOverlay");
    el.cropCanvas = document.getElementById("officeCropCanvas");
    el.cropTitle = document.getElementById("officeCropTitle");
    el.cropHelp = document.getElementById("officeCropHelp");
    el.cropConfirm = document.getElementById("officeCropConfirmBtn");
    el.cropCancel = document.getElementById("officeCropCancelBtn");

    initRatioHelp();
    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewLink);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.openBank) el.openBank.addEventListener("click", openOpportunityBank);
    if (el.bankClose) el.bankClose.addEventListener("click", closeOpportunityBank);
    if (el.bankOverlay) {
      el.bankOverlay.addEventListener("click", event => {
        if (event.target === el.bankOverlay) closeOpportunityBank();
      });
    }
    if (el.cropConfirm) el.cropConfirm.addEventListener("click", confirmCrop);
    if (el.cropCancel) el.cropCancel.addEventListener("click", cancelCrop);

    bindMediaInput(el.logo, {
      aspectRatio: design().logoAspectRatio,
      title: "قص شعار المكتب",
      help: "قص مربع للشعار قبل الرفع.",
      preview: el.logoPreview,
      urlField: "logoUrl",
      routePath: "/media/office-logo",
      assign: url => { current.logoUrl = url; }
    });
    bindMediaInput(el.cover, {
      aspectRatio: design().displayImageAspectRatio,
      title: "قص صورة عرض المكتب",
      help: "قص بنسبة العرض المعتمدة لصورة بطاقة المكتب.",
      preview: el.coverPreview,
      urlField: "coverUrl",
      routePath: "/media/office-cover",
      assign: url => { current.coverUrl = url; }
    });
    bindMediaInput(el.whatsappCover, {
      aspectRatio: design().whatsappCoverAspectRatio,
      title: "قص غلاف واتساب",
      help: "قص عريض قابل للتهيئة لغلاف واتساب المتوافق.",
      preview: el.whatsappCoverPreview,
      urlField: "whatsappCoverUrl",
      routePath: "/media/office-whatsapp-cover",
      assign: url => { current.whatsappCoverUrl = url; }
    });

    const removeLogo = document.getElementById("removeOfficeLogoBtn");
    if (removeLogo) removeLogo.addEventListener("click", () => {
      current.logoUrl = "";
      setPreview(el.logoPreview, "");
      applyDisplayMedia();
      setStatus("تمت إزالة الشعار محليًا. احفظ التعديلات للتأكيد.");
    });
    const removeCover = document.getElementById("removeOfficeCoverBtn");
    if (removeCover) removeCover.addEventListener("click", () => {
      current.coverUrl = "";
      setPreview(el.coverPreview, "");
      applyDisplayMedia();
      setStatus("تمت إزالة صورة العرض محليًا. احفظ التعديلات للتأكيد.");
    });
    const removeWa = document.getElementById("removeOfficeWhatsappCoverBtn");
    if (removeWa) removeWa.addEventListener("click", () => {
      current.whatsappCoverUrl = "";
      setPreview(el.whatsappCoverPreview, "");
      setStatus("تمت إزالة غلاف واتساب محليًا. احفظ التعديلات للتأكيد.");
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
