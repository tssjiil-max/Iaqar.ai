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
  const Policy = () => (window.IAQAR && window.IAQAR.OfficePolicy) || null;
  const Design = () => (window.IAQAR && window.IAQAR.OfficeDesign) || null;

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
    cooperationMode: "APPROVAL_REQUIRED",
    notificationPreferences: {
      match: true,
      ownerCustomer: true,
      cooperation: true,
      message: true,
      appointment: true,
      system: true
    }
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};
  let cropState = null;

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
    const policy = Policy();
    if (policy) return policy.safeText(value, fallback);
    return String(value == null ? fallback : value).trim();
  }

  function normalizeOfficeNameKey(value) {
    const policy = Policy();
    if (policy) return policy.normalizeOfficeNameKey(value);
    return safeText(value).normalize("NFKC").toLocaleLowerCase("en-US").replace(/[\s._-]+/g, "").replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  function validateOfficeName(value) {
    const policy = Policy();
    if (policy) return policy.validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (name.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "").length < 4 && !isPlatformAdmin()) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    return "";
  }

  function buildPublicSlug(name) {
    const policy = Policy();
    if (policy) return policy.buildPublicSlug(name, officeId());
    return `maktab-${officeId()}`.slice(0, 64);
  }

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
  }

  function normalizeCooperationMode(value) {
    const policy = Policy();
    if (policy) return policy.normalizeCooperationMode(value);
    return "APPROVAL_REQUIRED";
  }

  function normalizeNotificationPreferences(value) {
    const policy = Policy();
    if (policy) return policy.normalizeNotificationPreferences(value);
    return { ...defaults.notificationPreferences };
  }

  function clean(data) {
    const phone = safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20);
    const whatsapp = safeText(data.whatsapp || phone).replace(/[^0-9+]/g, "").slice(0, 20);
    return {
      officeName: safeText(data.officeName, defaults.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: safeText(data.brokerName, defaults.brokerName).slice(0, 80),
      phone,
      whatsapp: whatsapp || phone,
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      whatsappCoverUrl: safeText(data.whatsappCoverUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      cooperationMode: normalizeCooperationMode(data.cooperationMode),
      notificationPreferences: normalizeNotificationPreferences(data.notificationPreferences)
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
    const prefs = {};
    const map = el.notificationPrefs || {};
    Object.keys(defaults.notificationPreferences).forEach(key => {
      prefs[key] = map[key] ? map[key].checked : true;
    });
    return normalizeNotificationPreferences(prefs);
  }

  function writeNotificationPreferencesToForm(prefs) {
    const normalized = normalizeNotificationPreferences(prefs);
    Object.keys(normalized).forEach(key => {
      if (el.notificationPrefs && el.notificationPrefs[key]) {
        el.notificationPrefs[key].checked = normalized[key] !== false;
      }
    });
  }

  function setPreview(img, url, emptyNode) {
    if (!img) return;
    if (url) {
      img.src = url;
      img.hidden = false;
      if (emptyNode) emptyNode.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (emptyNode) emptyNode.hidden = false;
    }
  }

  function applyHomeVisuals() {
    const logoImg = document.getElementById("officeDisplayLogo");
    if (logoImg && current.logoUrl) logoImg.src = current.logoUrl;

    const coverImg = document.getElementById("officeDisplayCover");
    const coverEmpty = document.getElementById("officeCoverPlaceholder");
    setPreview(coverImg, current.coverUrl, coverEmpty);

    const qrHost = document.getElementById("officeQrPreview");
    if (qrHost) renderQrInto(qrHost, officeLink());
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    if (el.officeName) el.officeName.value = current.officeName;
    if (el.brokerName) el.brokerName.value = current.brokerName;
    if (el.phone) el.phone.value = current.phone;
    if (el.license) el.license.value = current.licenseNumber;
    if (el.city) el.city.value = current.city;
    if (el.link) el.link.value = officeLink();
    if (el.cooperationMode) el.cooperationMode.value = current.cooperationMode;
    writeSpecialtiesToForm(current.specialties);
    writeNotificationPreferencesToForm(current.notificationPreferences);

    setPreview(el.logoPreview, current.logoUrl, el.logoEmpty);
    setPreview(el.coverPreview, current.coverUrl, el.coverEmpty);
    setPreview(el.whatsappCoverPreview, current.whatsappCoverUrl, el.whatsappCoverEmpty);

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

    applyHomeVisuals();
    window.IAQAR = window.IAQAR || {};
    window.IAQAR.officeProfile = { ...current, officeId: officeId() };
    window.dispatchEvent(new CustomEvent("iaqar:office-profile", { detail: window.IAQAR.officeProfile }));
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
          logoUrl: data.logoUrl,
          coverUrl: data.coverUrl,
          whatsappCoverUrl: data.whatsappCoverUrl,
          publicSlug: data.publicSlug,
          cooperationMode: data.cooperationMode,
          notificationPreferences: data.notificationPreferences
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
        officeNameKey: data.officeNameKey,
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

  async function uploadOfficeMedia(file, kind) {
    const design = Design();
    const validationError = design ? design.validateImageFile(file) : "";
    if (validationError) throw new Error(validationError);
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    const idToken = await user.getIdToken();
    const path = kind === "logo"
      ? "/media/office-logo"
      : kind === "whatsapp-cover"
        ? "/media/office-whatsapp-cover"
        : "/media/office-cover";
    const response = await fetch(`${WORKER_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        Authorization: `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر رفع صورة المكتب");
    return result.mediaUrl || result.coverUrl || result.logoUrl || result.whatsappCoverUrl || "";
  }

  function openCropper(file, kind) {
    const design = Design();
    const error = design ? design.validateImageFile(file) : "";
    if (error) {
      toast(error);
      return;
    }
    const overlay = document.getElementById("officeImageCrop");
    const canvas = document.getElementById("officeImageCropCanvas");
    const title = document.getElementById("officeImageCropTitle");
    if (!overlay || !canvas) {
      // Fallback: use file directly when crop UI unavailable.
      cropState = { file, kind, ratio: design ? design.cropRatioForKind(kind) : 16 / 9 };
      applyCroppedBlob(file);
      return;
    }
    const ratio = design ? design.cropRatioForKind(kind) : (kind === "logo" ? 1 : 1.91);
    const labels = (design && design.OFFICE_IMAGE_DESIGN.labels) || {};
    if (title) {
      title.textContent = kind === "logo"
        ? (labels.logo || "قص الشعار")
        : kind === "whatsapp-cover"
          ? (labels.whatsappCover || "قص ترويسة واتساب")
          : (labels.displayCover || "قص صورة العرض");
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      cropState = { file, kind, ratio, image, objectUrl: url };
      drawCropPreview();
      overlay.hidden = false;
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast("تعذر قراءة الصورة");
    };
    image.src = url;
  }

  function drawCropPreview() {
    if (!cropState || !cropState.image) return;
    const canvas = document.getElementById("officeImageCropCanvas");
    if (!canvas) return;
    const design = Design();
    const rect = design
      ? design.computeCoverCropRect(cropState.image.naturalWidth, cropState.image.naturalHeight, cropState.ratio)
      : { sx: 0, sy: 0, sw: cropState.image.naturalWidth, sh: cropState.image.naturalHeight };
    const maxW = 320;
    const drawW = maxW;
    const drawH = Math.max(80, Math.round(drawW / cropState.ratio));
    canvas.width = drawW;
    canvas.height = drawH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f8f6";
    ctx.fillRect(0, 0, drawW, drawH);
    ctx.drawImage(cropState.image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, drawW, drawH);
    cropState.rect = rect;
  }

  async function applyCroppedBlob(directFile) {
    try {
      let blob = directFile;
      if (!blob && cropState && cropState.image && cropState.rect) {
        const out = document.createElement("canvas");
        const targetW = cropState.kind === "logo" ? 512 : 1200;
        const targetH = Math.round(targetW / cropState.ratio);
        out.width = targetW;
        out.height = targetH;
        const ctx = out.getContext("2d");
        ctx.drawImage(
          cropState.image,
          cropState.rect.sx, cropState.rect.sy, cropState.rect.sw, cropState.rect.sh,
          0, 0, targetW, targetH
        );
        blob = await new Promise(resolve => out.toBlob(resolve, "image/jpeg", 0.92));
      }
      if (!blob || !cropState) return;
      const file = blob instanceof File
        ? blob
        : new File([blob], `${cropState.kind}.jpg`, { type: blob.type || "image/jpeg" });
      const previewUrl = URL.createObjectURL(file);
      if (cropState.kind === "logo") {
        current.logoUrl = previewUrl;
        setPreview(el.logoPreview, previewUrl, el.logoEmpty);
        el._pendingLogoFile = file;
      } else if (cropState.kind === "whatsapp-cover") {
        current.whatsappCoverUrl = previewUrl;
        setPreview(el.whatsappCoverPreview, previewUrl, el.whatsappCoverEmpty);
        el._pendingWhatsappCoverFile = file;
      } else {
        current.coverUrl = previewUrl;
        setPreview(el.coverPreview, previewUrl, el.coverEmpty);
        el._pendingCoverFile = file;
      }
      closeCropper();
    } catch (error) {
      console.warn("[iaqar] crop", error);
      toast("تعذر قص الصورة");
    }
  }

  function closeCropper() {
    const overlay = document.getElementById("officeImageCrop");
    if (overlay) overlay.hidden = true;
    if (cropState && cropState.objectUrl) URL.revokeObjectURL(cropState.objectUrl);
    // keep pending kind/file refs on el; clear image only
    cropState = cropState ? { kind: cropState.kind } : null;
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
    let logoUrl = current.logoUrl || "";
    let coverUrl = current.coverUrl || "";
    let whatsappCoverUrl = current.whatsappCoverUrl || "";

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";
    setSettingsStatus("loading", "جارٍ حفظ إعدادات المكتب...");

    try {
      if (el._pendingLogoFile) {
        logoUrl = await uploadOfficeMedia(el._pendingLogoFile, "logo");
        el._pendingLogoFile = null;
      }
      if (el._pendingCoverFile) {
        coverUrl = await uploadOfficeMedia(el._pendingCoverFile, "cover");
        el._pendingCoverFile = null;
      }
      if (el._pendingWhatsappCoverFile) {
        whatsappCoverUrl = await uploadOfficeMedia(el._pendingWhatsappCoverFile, "whatsapp-cover");
        el._pendingWhatsappCoverFile = null;
      }

      const mobile = safeText(el.phone.value).replace(/[^0-9+]/g, "");
      const data = clean({
        officeName: el.officeName.value,
        brokerName: el.brokerName.value,
        phone: mobile,
        whatsapp: mobile,
        licenseNumber: el.license.value,
        city: el.city.value,
        specialties,
        logoUrl: logoUrl.startsWith("blob:") ? (current.logoUrl || "") : logoUrl,
        coverUrl: coverUrl.startsWith("blob:") ? (current.coverUrl || "") : coverUrl,
        whatsappCoverUrl: whatsappCoverUrl.startsWith("blob:") ? (current.whatsappCoverUrl || "") : whatsappCoverUrl,
        publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value),
        cooperationMode: el.cooperationMode ? el.cooperationMode.value : current.cooperationMode,
        notificationPreferences: readNotificationPreferencesFromForm()
      });

      // Avoid persisting blob: preview URLs
      if (data.logoUrl.startsWith("blob:")) data.logoUrl = "";
      if (data.coverUrl.startsWith("blob:")) data.coverUrl = "";
      if (data.whatsappCoverUrl.startsWith("blob:")) data.whatsappCoverUrl = "";

      if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
        toast("أكمل بيانات المكتب المطلوبة");
        setSettingsStatus("error", "أكمل بيانات المكتب المطلوبة");
        return;
      }

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
            setSettingsStatus("error", message);
            return;
          }
        }
      }

      if (!synced) {
        if (el.note) el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
        toast("غير مصرح لك بتعديل إعدادات المكتب");
        setSettingsStatus("error", "غير مصرح لك بتعديل إعدادات المكتب");
        return;
      }

      apply(data);
      saveLocal(data);
      if (el.note) el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
      toast("تم حفظ إعدادات المكتب");
      setSettingsStatus("success", "تم حفظ إعدادات المكتب");
    } catch (error) {
      console.warn("[iaqar] office settings save", error);
      toast(error.message || "تعذر حفظ الإعدادات");
      setSettingsStatus("error", error.message || "تعذر حفظ الإعدادات");
    } finally {
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
    }
  }

  function setSettingsStatus(kind, message) {
    const node = document.getElementById("officeSettingsStatus");
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
    node.dataset.state = kind || "";
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

  function previewOfficeLink() {
    const link = officeLink();
    window.open(link, "_blank", "noopener,noreferrer");
  }

  function renderQrInto(host, text) {
    if (!host) return;
    host.innerHTML = "";
    if (typeof window.qrcode !== "function") {
      host.textContent = "رمز QR غير متاح";
      return;
    }
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const size = 140;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "رمز QR لرابط المكتب");
      const ctx = canvas.getContext("2d");
      const modules = qr.getModuleCount();
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
      host.appendChild(canvas);
    } catch (error) {
      host.textContent = "تعذر إنشاء رمز QR";
    }
  }

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم الجوال", current.phone],
      ["المدينة", current.city],
      ["صورة العرض", current.coverUrl]
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

    const logoSrc = current.logoUrl || (document.getElementById("officeDisplayLogo") || {}).src;
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

    const coverSrc = current.whatsappCoverUrl || current.coverUrl;
    const cover = await loadImage(coverSrc);
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
    const status = safeText(value).toLowerCase();
    if (status === "active" || status === "accepted" || status === "تعاون نشط") return "تعاون نشط";
    if (status === "pending" || status === "بانتظار الموافقة") return "بانتظار الموافقة";
    if (status === "rejected" || status === "رُفض الطلب") return "رُفض الطلب";
    if (status === "ended" || status === "انتهى التعاون") return "انتهى التعاون";
    return "لم تُشارك";
  }

  async function openOpportunityBank() {
    const overlay = document.getElementById("opportunityBank");
    const list = document.getElementById("opportunityBankList");
    const empty = document.getElementById("opportunityBankEmpty");
    const status = document.getElementById("opportunityBankStatus");
    if (!overlay || !list) return;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    list.innerHTML = "";
    if (empty) empty.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = "جارٍ تحميل بنك الفرص...";
      status.dataset.state = "loading";
    }

    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user || officeId() === "platform") {
      if (status) {
        status.textContent = "سجل دخول المكتب لعرض بنك الفرص الخاص به.";
        status.dataset.state = "error";
      }
      if (empty) {
        empty.hidden = false;
        empty.textContent = "لا تتوفر فرص للعرض.";
      }
      return;
    }

    try {
      const snap = await runtime.db.collection("offices").doc(officeId())
        .collection("opportunities").orderBy("createdAt", "desc").limit(50).get();
      if (status) status.hidden = true;
      if (snap.empty) {
        if (empty) {
          empty.hidden = false;
          empty.textContent = "لا توجد فرص محفوظة في بنك هذا المكتب بعد.";
        }
        return;
      }
      snap.docs.forEach(doc => {
        const data = doc.data() || {};
        if (data.officeId && data.officeId !== officeId()) return;
        const item = document.createElement("article");
        item.className = "opportunity-bank-item";
        const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
        const dateText = created
          ? created.toLocaleDateString("ar-SA")
          : "—";
        item.innerHTML = `
          <h4>${escapeHtml(data.propertyType || data.kind || "فرصة عقارية")}</h4>
          <p>${escapeHtml([data.city, data.district].filter(Boolean).join(" — ") || "بدون موقع")}</p>
          <p>${escapeHtml(data.price ? String(data.price) : (data.budget || "بدون سعر"))}</p>
          <div class="opportunity-bank-meta">
            <span>تاريخ الإضافة: ${escapeHtml(dateText)}</span>
            <span>التعاون: ${escapeHtml(cooperationStatusLabel(data.cooperationStatus || data.cooperationState))}</span>
          </div>
        `;
        list.appendChild(item);
      });
      if (!list.children.length && empty) {
        empty.hidden = false;
        empty.textContent = "لا توجد فرص محفوظة في بنك هذا المكتب بعد.";
      }
    } catch (error) {
      console.warn("[iaqar] opportunity bank", error);
      if (status) {
        status.hidden = false;
        status.textContent = "تعذر تحميل بنك الفرص الآن.";
        status.dataset.state = "error";
      }
    }
  }

  function closeOpportunityBank() {
    const overlay = document.getElementById("opportunityBank");
    if (overlay) overlay.hidden = true;
    document.body.style.overflow = "";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clearImage(kind) {
    if (kind === "logo") {
      current.logoUrl = "";
      el._pendingLogoFile = null;
      if (el.logo) el.logo.value = "";
      setPreview(el.logoPreview, "", el.logoEmpty);
    } else if (kind === "whatsapp-cover") {
      current.whatsappCoverUrl = "";
      el._pendingWhatsappCoverFile = null;
      if (el.whatsappCover) el.whatsappCover.value = "";
      setPreview(el.whatsappCoverPreview, "", el.whatsappCoverEmpty);
    } else {
      current.coverUrl = "";
      el._pendingCoverFile = null;
      if (el.cover) el.cover.value = "";
      setPreview(el.coverPreview, "", el.coverEmpty);
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

  function bindImageInput(input, kind) {
    if (!input) return;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;
      openCropper(file, kind);
      input.value = "";
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
    el.logo = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.logoEmpty = document.getElementById("officeLogoEmpty");
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.coverEmpty = document.getElementById("officeCoverEmpty");
    el.whatsappCover = document.getElementById("officeWhatsappCoverInput");
    el.whatsappCoverPreview = document.getElementById("officeWhatsappCoverPreview");
    el.whatsappCoverEmpty = document.getElementById("officeWhatsappCoverEmpty");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.cooperationMode = document.getElementById("cooperationModeSelect");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notificationPrefs = {
      match: document.getElementById("notifyMatch"),
      ownerCustomer: document.getElementById("notifyOwnerCustomer"),
      cooperation: document.getElementById("notifyCooperation"),
      message: document.getElementById("notifyMessage"),
      appointment: document.getElementById("notifyAppointment"),
      system: document.getElementById("notifySystem")
    };

    apply(loadLocal() || defaults);

    if (el.officeName) el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    if (el.copy) el.copy.addEventListener("click", copyLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewOfficeLink);
    if (el.logout) el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);

    bindImageInput(el.logo, "logo");
    bindImageInput(el.cover, "cover");
    bindImageInput(el.whatsappCover, "whatsapp-cover");

    const removeLogo = document.getElementById("removeOfficeLogoBtn");
    const removeCover = document.getElementById("removeOfficeCoverBtn");
    const removeWhatsapp = document.getElementById("removeOfficeWhatsappCoverBtn");
    if (removeLogo) removeLogo.addEventListener("click", () => clearImage("logo"));
    if (removeCover) removeCover.addEventListener("click", () => clearImage("cover"));
    if (removeWhatsapp) removeWhatsapp.addEventListener("click", () => clearImage("whatsapp-cover"));

    const cropApply = document.getElementById("officeImageCropApply");
    const cropCancel = document.getElementById("officeImageCropCancel");
    if (cropApply) cropApply.addEventListener("click", () => applyCroppedBlob());
    if (cropCancel) cropCancel.addEventListener("click", closeCropper);

    const bankEntry = document.getElementById("opportunityBankEntry");
    if (bankEntry) {
      bankEntry.addEventListener("click", openOpportunityBank);
      bankEntry.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openOpportunityBank();
        }
      });
    }
    const bankClose = document.getElementById("opportunityBankClose");
    if (bankClose) bankClose.addEventListener("click", closeOpportunityBank);
    const bankOverlay = document.getElementById("opportunityBank");
    if (bankOverlay) {
      bankOverlay.addEventListener("click", event => {
        if (event.target === bankOverlay) closeOpportunityBank();
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
