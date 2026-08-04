(() => {
  "use strict";

  const utils = (window.IAQAR && window.IAQAR.officeUtils) || null;
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
    coverUrl: "",
    logoUrl: "",
    publicSlug: "",
    cooperationMode: "approval_required",
    notificationPrefs: null
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};
  let defaultLogoUrl = "";
  let pendingCover = null;
  let pendingLogo = null;
  let removeCoverRequested = false;
  let removeLogoRequested = false;
  let nameCheckTimer = 0;
  let nameCheckSeq = 0;

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
    return utils ? utils.safeText(value, fallback) : String(value == null ? fallback : value).trim();
  }

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    const cleanList = [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
    return cleanList;
  }

  function validateOfficeName(value) {
    if (utils) return utils.validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
    return safeText(value) ? "" : "اكتب اسم المكتب";
  }

  function clean(data) {
    return {
      officeName: safeText(data.officeName, defaults.officeName).slice(0, 80),
      officeNameKey: utils
        ? utils.normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100)
        : safeText(data.officeNameKey).slice(0, 100),
      brokerName: safeText(data.brokerName, defaults.brokerName).slice(0, 80),
      phone: safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      whatsapp: safeText(data.whatsapp || data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      publicSlug: utils ? utils.sanitizePublicSlug(data.publicSlug) : safeText(data.publicSlug).slice(0, 64),
      cooperationMode: utils ? utils.sanitizeCooperationMode(data.cooperationMode) : "approval_required",
      notificationPrefs: utils ? utils.sanitizeNotificationPrefs(data.notificationPrefs) : (data.notificationPrefs || null)
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

  function renderNotificationPrefs() {
    if (!el.prefsList || !utils) return;
    el.prefsList.innerHTML = utils.NOTIFICATION_PREF_DEFS.map(def => `
      <label class="pref-item">
        <input type="checkbox" data-pref-key="${def.key}">
        <span class="pref-text"><strong>${def.label}</strong><small>${def.hint}</small></span>
      </label>`).join("");
  }

  function writePrefsToForm(prefs) {
    const cleanPrefs = utils ? utils.sanitizeNotificationPrefs(prefs) : (prefs || {});
    Array.from((el.prefsList || { querySelectorAll: () => [] }).querySelectorAll("[data-pref-key]"))
      .forEach(input => {
        input.checked = cleanPrefs[input.dataset.prefKey] !== false;
      });
  }

  function readPrefsFromForm() {
    const prefs = {};
    Array.from((el.prefsList || { querySelectorAll: () => [] }).querySelectorAll("[data-pref-key]"))
      .forEach(input => {
        prefs[input.dataset.prefKey] = input.checked;
      });
    return utils ? utils.sanitizeNotificationPrefs(prefs) : prefs;
  }

  function renderCropPresets() {
    if (!el.cropPreset || !utils) return;
    const presets = utils.OFFICE_DESIGN.coverCrop.presets;
    const defaultKey = utils.OFFICE_DESIGN.coverCrop.defaultPreset;
    el.cropPreset.innerHTML = Object.values(presets)
      .map(preset => `<option value="${preset.key}"${preset.key === defaultKey ? " selected" : ""}>${preset.label}</option>`)
      .join("");
  }

  function writeCooperationModeToForm(mode) {
    const safeMode = utils ? utils.sanitizeCooperationMode(mode) : (mode || "approval_required");
    Array.from(document.querySelectorAll('input[name="cooperationMode"]')).forEach(input => {
      input.checked = input.value === safeMode;
    });
  }

  function readCooperationModeFromForm() {
    const selected = document.querySelector('input[name="cooperationMode"]:checked');
    return utils ? utils.sanitizeCooperationMode(selected && selected.value) : "approval_required";
  }

  function setIdentityStatus(text, state = "") {
    if (!el.identityStatus) return;
    el.identityStatus.textContent = text || "";
    el.identityStatus.className = `identity-status${state ? ` ${state}` : ""}`;
  }

  function refreshIdentityPreviews() {
    if (el.logoPreview) {
      el.logoPreview.src = pendingLogo ? pendingLogo.dataUrl : (removeLogoRequested ? defaultLogoUrl : (current.logoUrl || defaultLogoUrl));
    }
    if (el.removeLogo) el.removeLogo.hidden = !(pendingLogo || (current.logoUrl && !removeLogoRequested));
    if (el.coverPreview) {
      const coverSource = pendingCover ? pendingCover.dataUrl : (removeCoverRequested ? "" : current.coverUrl);
      el.coverPreview.src = coverSource || "";
      el.coverPreview.hidden = !coverSource;
      if (el.coverEmpty) el.coverEmpty.hidden = Boolean(coverSource);
    }
    if (el.removeCover) el.removeCover.hidden = !(pendingCover || (current.coverUrl && !removeCoverRequested));
  }

  function applyOfficeCardIdentity() {
    const coverButton = document.getElementById("officeCoverSettingsBtn");
    const coverImage = document.getElementById("officeCoverImage");
    if (coverImage) coverImage.src = current.coverUrl || "";
    if (coverButton) coverButton.hidden = !current.coverUrl;
    const logoImage = document.getElementById("officeLogoImage");
    if (logoImage) logoImage.src = current.logoUrl || defaultLogoUrl;
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
    writePrefsToForm(current.notificationPrefs);
    writeCooperationModeToForm(current.cooperationMode);
    refreshIdentityPreviews();
    applyOfficeCardIdentity();

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
          notificationPrefs: data.notificationPrefs
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

  async function uploadOfficeImage(path, blob, contentType, resultField) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body: blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result[resultField]) {
      throw new Error(result.message || "تعذر رفع صورة المكتب");
    }
    return result[resultField];
  }

  function setNameStatus(text, state = "") {
    if (!el.nameStatus) return;
    el.nameStatus.textContent = text || "";
    el.nameStatus.className = `office-name-status${state ? ` ${state}` : ""}`;
  }

  function scheduleNameAvailabilityCheck() {
    clearTimeout(nameCheckTimer);
    if (!utils) return;
    const value = el.officeName.value;
    const error = validateOfficeName(value);
    if (error) { setNameStatus("", ""); return; }
    const key = utils.normalizeOfficeNameKey(value);
    if (!key || key === current.officeNameKey) { setNameStatus("", ""); return; }
    nameCheckTimer = setTimeout(() => checkNameAvailability(key), 600);
  }

  async function checkNameAvailability(key) {
    const user = authUser();
    if (!user || !utils) return;
    const seq = ++nameCheckSeq;
    setNameStatus(utils.OFFICE_NAME_ERRORS.CHECKING, "");
    try {
      const idToken = await user.getIdToken();
      const params = new URLSearchParams({ key, officeId: officeId() });
      const response = await fetch(`${WORKER_BASE}/office/name-availability?${params.toString()}`, {
        headers: { Authorization: `Bearer ${idToken}` },
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (seq !== nameCheckSeq) return;
      if (!response.ok) {
        setNameStatus(utils.OFFICE_NAME_ERRORS.CHECK_FAILED, "");
        return;
      }
      if (result.available) setNameStatus(utils.OFFICE_NAME_ERRORS.AVAILABLE, "ok");
      else setNameStatus(utils.OFFICE_NAME_ERRORS.TAKEN, "error");
    } catch (_) {
      if (seq === nameCheckSeq) setNameStatus(utils.OFFICE_NAME_ERRORS.CHECK_FAILED, "");
    }
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
    const notificationPrefs = readPrefsFromForm();
    const cooperationMode = readCooperationModeFromForm();

    el.save.disabled = true;

    let coverUrl = current.coverUrl || "";
    let logoUrl = current.logoUrl || "";
    try {
      if (pendingLogo || pendingCover) {
        el.save.textContent = "جارٍ رفع الصور...";
        setIdentityStatus("جارٍ رفع الصور الجديدة...", "");
        if (pendingLogo) {
          logoUrl = await uploadOfficeImage("/media/office-logo", pendingLogo.blob, pendingLogo.type, "logoUrl");
        }
        if (pendingCover) {
          coverUrl = await uploadOfficeImage("/media/office-cover", pendingCover.blob, pendingCover.type, "coverUrl");
        }
      }
      if (removeLogoRequested && !pendingLogo) logoUrl = "";
      if (removeCoverRequested && !pendingCover) coverUrl = "";
    } catch (error) {
      console.warn("[iaqar] office image upload", error);
      setIdentityStatus(error.message || "تعذر رفع الصورة", "error");
      toast(error.message || "تعذر رفع صورة المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
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
      coverUrl,
      logoUrl,
      publicSlug: current.publicSlug || (utils ? utils.buildPublicSlug(el.officeName.value, officeId()) : ""),
      cooperationMode,
      notificationPrefs
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
      toast("أكمل بيانات المكتب المطلوبة");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

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
          const message = utils ? utils.OFFICE_NAME_ERRORS.TAKEN : "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
          el.officeName.setCustomValidity(message);
          el.officeName.reportValidity();
          setNameStatus(message, "error");
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

    pendingCover = null;
    pendingLogo = null;
    removeCoverRequested = false;
    removeLogoRequested = false;
    setIdentityStatus("", "");
    setNameStatus("", "");
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

  async function shareOfficeLink() {
    try {
      await ensurePublicSlug();
    } catch (error) {
      console.warn("[iaqar] ensure slug before share", error);
    }
    const url = officeLink();
    el.link.value = url;
    const text = `${current.officeName} — زيارة المكتب والتسجيل: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: current.officeName, text, url });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("المشاركة غير مدعومة هنا؛ تم نسخ الرابط");
    } catch (_) {
      el.link.select();
      toast("انسخ الرابط الظاهر لمشاركته");
    }
  }

  function previewOfficeLink() {
    window.open(officeLink(), "_blank", "noopener,noreferrer");
  }

  function toggleOfficeQr() {
    if (!el.qrWrap) return;
    const willShow = el.qrWrap.hidden;
    if (willShow) {
      try {
        renderOfficeQr();
      } catch (error) {
        console.warn("[iaqar] office qr", error);
        toast("تعذر إنشاء رمز QR الآن");
        return;
      }
    }
    el.qrWrap.hidden = !willShow;
    if (el.qrToggle) el.qrToggle.setAttribute("aria-expanded", willShow ? "true" : "false");
  }

  function renderOfficeQr() {
    if (typeof window.qrcode !== "function") throw new Error("QR_UNAVAILABLE");
    const canvas = el.qrCanvas;
    const ctx = canvas.getContext("2d");
    const qr = window.qrcode(0, "M");
    qr.addData(el.link.value || officeLink());
    qr.make();
    const modules = qr.getModuleCount();
    const quiet = 4;
    const cell = canvas.width / (modules + quiet * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const x = Math.floor((col + quiet) * cell);
        const y = Math.floor((row + quiet) * cell);
        const w = Math.ceil((col + quiet + 1) * cell) - x;
        const h = Math.ceil((row + quiet + 1) * cell) - y;
        ctx.fillRect(x, y, w, h);
      }
    }
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
    const slug = utils ? utils.buildPublicSlug(current.officeName, officeId()) : `maktab-${Date.now().toString(36)}`;
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

  /* ---- سير قص الصور (الهوية البصرية) ---- */

  const cropper = {
    img: null,
    kind: "",
    ratio: 1,
    outputWidth: 1200,
    baseScale: 1,
    scale: 1,
    dx: 0,
    dy: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    objectUrl: ""
  };

  function stagePendingImage(kind, blob, type) {
    const entry = { blob, type, dataUrl: URL.createObjectURL(blob) };
    if (kind === "logo") {
      if (pendingLogo) URL.revokeObjectURL(pendingLogo.dataUrl);
      pendingLogo = entry;
      removeLogoRequested = false;
    } else {
      if (pendingCover) URL.revokeObjectURL(pendingCover.dataUrl);
      pendingCover = entry;
      removeCoverRequested = false;
    }
    refreshIdentityPreviews();
    setIdentityStatus(kind === "logo" ? "شعار جديد بانتظار الحفظ" : "صورة غلاف جديدة بانتظار الحفظ", "ok");
  }

  function onIdentityFileSelected(kind, input) {
    const file = input && input.files ? input.files[0] : null;
    if (input) input.value = "";
    if (!file || !utils) return;
    const error = utils.validateOfficeImage(file);
    if (error) {
      setIdentityStatus(error, "error");
      toast(error);
      return;
    }
    const preset = kind === "logo"
      ? { ratio: utils.OFFICE_DESIGN.logoCrop.ratio, outputWidth: utils.OFFICE_DESIGN.logoCrop.outputWidth }
      : utils.resolveCoverCropPreset(el.cropPreset ? el.cropPreset.value : "");
    if (!preset.ratio) {
      stagePendingImage(kind, file, file.type);
      return;
    }
    openCropper(file, kind, preset);
  }

  function openCropper(file, kind, preset) {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      cropper.img = img;
      cropper.kind = kind;
      cropper.ratio = preset.ratio || 1;
      cropper.outputWidth = preset.outputWidth || 1200;
      cropper.objectUrl = objectUrl;
      resetCropView();
      if (el.cropTitle) {
        el.cropTitle.textContent = kind === "logo" ? "قص شعار المكتب" : "قص صورة الغلاف";
      }
      el.cropOverlay.hidden = false;
      if (el.cropConfirm) el.cropConfirm.focus();
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setIdentityStatus("تعذر قراءة ملف الصورة", "error");
      toast("تعذر قراءة ملف الصورة");
    };
    img.src = objectUrl;
  }

  function resetCropView() {
    const canvas = el.cropCanvas;
    if (!canvas || !cropper.img) return;
    canvas.width = 640;
    canvas.height = Math.max(1, Math.round(640 / cropper.ratio));
    const scaleX = canvas.width / cropper.img.naturalWidth;
    const scaleY = canvas.height / cropper.img.naturalHeight;
    cropper.baseScale = Math.max(scaleX, scaleY);
    cropper.scale = cropper.baseScale;
    if (el.cropZoom) el.cropZoom.value = "100";
    cropper.dx = (canvas.width - cropper.img.naturalWidth * cropper.scale) / 2;
    cropper.dy = (canvas.height - cropper.img.naturalHeight * cropper.scale) / 2;
    clampCropOffsets();
    drawCrop();
  }

  function clampCropOffsets() {
    const canvas = el.cropCanvas;
    if (!canvas || !cropper.img) return;
    const width = cropper.img.naturalWidth * cropper.scale;
    const height = cropper.img.naturalHeight * cropper.scale;
    cropper.dx = Math.min(0, Math.max(canvas.width - width, cropper.dx));
    cropper.dy = Math.min(0, Math.max(canvas.height - height, cropper.dy));
  }

  function drawCrop() {
    const canvas = el.cropCanvas;
    if (!canvas || !cropper.img) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0d221d";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      cropper.img,
      cropper.dx,
      cropper.dy,
      cropper.img.naturalWidth * cropper.scale,
      cropper.img.naturalHeight * cropper.scale
    );
  }

  function onCropPointerDown(event) {
    if (!cropper.img) return;
    cropper.dragging = true;
    cropper.lastX = event.clientX;
    cropper.lastY = event.clientY;
    el.cropCanvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onCropPointerMove(event) {
    if (!cropper.dragging || !cropper.img) return;
    const rect = el.cropCanvas.getBoundingClientRect();
    const factor = el.cropCanvas.width / Math.max(1, rect.width);
    cropper.dx += (event.clientX - cropper.lastX) * factor;
    cropper.dy += (event.clientY - cropper.lastY) * factor;
    cropper.lastX = event.clientX;
    cropper.lastY = event.clientY;
    clampCropOffsets();
    drawCrop();
  }

  function onCropPointerUp(event) {
    cropper.dragging = false;
    try { el.cropCanvas.releasePointerCapture(event.pointerId); } catch (_) {}
  }

  function onCropZoomInput() {
    if (!cropper.img) return;
    const zoom = Math.max(1, Number(el.cropZoom.value || 100) / 100);
    const canvas = el.cropCanvas;
    const centerX = (canvas.width / 2 - cropper.dx) / cropper.scale;
    const centerY = (canvas.height / 2 - cropper.dy) / cropper.scale;
    cropper.scale = cropper.baseScale * zoom;
    cropper.dx = canvas.width / 2 - centerX * cropper.scale;
    cropper.dy = canvas.height / 2 - centerY * cropper.scale;
    clampCropOffsets();
    drawCrop();
  }

  function confirmCrop() {
    if (!cropper.img) return;
    const canvas = el.cropCanvas;
    const outWidth = cropper.outputWidth;
    const outHeight = Math.max(1, Math.round(outWidth / cropper.ratio));
    const sourceX = -cropper.dx / cropper.scale;
    const sourceY = -cropper.dy / cropper.scale;
    const sourceW = canvas.width / cropper.scale;
    const sourceH = canvas.height / cropper.scale;
    const output = document.createElement("canvas");
    output.width = outWidth;
    output.height = outHeight;
    const ctx = output.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outWidth, outHeight);
    ctx.drawImage(cropper.img, sourceX, sourceY, sourceW, sourceH, 0, 0, outWidth, outHeight);
    const kind = cropper.kind;
    const type = kind === "logo" ? "image/png" : "image/jpeg";
    output.toBlob(blob => {
      closeCropper();
      if (!blob) {
        setIdentityStatus("تعذر تجهيز الصورة المقصوصة", "error");
        return;
      }
      stagePendingImage(kind, blob, type);
    }, type, 0.92);
  }

  function closeCropper() {
    if (el.cropOverlay) el.cropOverlay.hidden = true;
    if (cropper.objectUrl) URL.revokeObjectURL(cropper.objectUrl);
    cropper.img = null;
    cropper.objectUrl = "";
    cropper.dragging = false;
  }

  function requestRemoveImage(kind) {
    if (kind === "logo") {
      if (pendingLogo) URL.revokeObjectURL(pendingLogo.dataUrl);
      pendingLogo = null;
      removeLogoRequested = true;
      setIdentityStatus("سيُزال شعار المكتب المخصص عند الحفظ", "");
    } else {
      if (pendingCover) URL.revokeObjectURL(pendingCover.dataUrl);
      pendingCover = null;
      removeCoverRequested = true;
      setIdentityStatus("ستُزال صورة الغلاف عند الحفظ", "");
    }
    refreshIdentityPreviews();
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
    el.coverEmpty = document.getElementById("officeCoverEmpty");
    el.logo = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.changeCover = document.getElementById("changeOfficeCoverBtn");
    el.removeCover = document.getElementById("removeOfficeCoverBtn");
    el.changeLogo = document.getElementById("changeOfficeLogoBtn");
    el.removeLogo = document.getElementById("removeOfficeLogoBtn");
    el.cropPreset = document.getElementById("coverCropPresetSelect");
    el.identityStatus = document.getElementById("identityStatus");
    el.nameStatus = document.getElementById("officeNameStatus");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.qrToggle = document.getElementById("toggleOfficeQrBtn");
    el.qrWrap = document.getElementById("officeQrWrap");
    el.qrCanvas = document.getElementById("officeQrCanvas");
    el.preview = document.getElementById("previewOfficeLinkBtn");
    el.prefsList = document.getElementById("notificationPrefsList");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.cropOverlay = document.getElementById("imageCropOverlay");
    el.cropCanvas = document.getElementById("cropCanvas");
    el.cropTitle = document.getElementById("cropTitle");
    el.cropZoom = document.getElementById("cropZoomRange");
    el.cropConfirm = document.getElementById("cropConfirmBtn");
    el.cropCancel = document.getElementById("cropCancelBtn");
    el.cropSkip = document.getElementById("cropSkipBtn");

    const cardLogo = document.getElementById("officeLogoImage");
    defaultLogoUrl = (cardLogo && cardLogo.src) || (el.logoPreview && el.logoPreview.src) || "";

    renderNotificationPrefs();
    renderCropPresets();
    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => {
      el.officeName.setCustomValidity("");
      scheduleNameAvailabilityCheck();
    });
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareOfficeLink);
    if (el.qrToggle) el.qrToggle.addEventListener("click", toggleOfficeQr);
    if (el.preview) el.preview.addEventListener("click", previewOfficeLink);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);

    if (el.changeCover) el.changeCover.addEventListener("click", () => el.cover && el.cover.click());
    if (el.changeLogo) el.changeLogo.addEventListener("click", () => el.logo && el.logo.click());
    if (el.cover) el.cover.addEventListener("change", () => onIdentityFileSelected("cover", el.cover));
    if (el.logo) el.logo.addEventListener("change", () => onIdentityFileSelected("logo", el.logo));
    if (el.removeCover) el.removeCover.addEventListener("click", () => requestRemoveImage("cover"));
    if (el.removeLogo) el.removeLogo.addEventListener("click", () => requestRemoveImage("logo"));

    if (el.cropCanvas) {
      el.cropCanvas.addEventListener("pointerdown", onCropPointerDown);
      el.cropCanvas.addEventListener("pointermove", onCropPointerMove);
      el.cropCanvas.addEventListener("pointerup", onCropPointerUp);
      el.cropCanvas.addEventListener("pointercancel", onCropPointerUp);
    }
    if (el.cropZoom) el.cropZoom.addEventListener("input", onCropZoomInput);
    if (el.cropConfirm) el.cropConfirm.addEventListener("click", confirmCrop);
    if (el.cropCancel) el.cropCancel.addEventListener("click", closeCropper);
    if (el.cropSkip) el.cropSkip.addEventListener("click", closeCropper);
    if (el.cropOverlay) {
      el.cropOverlay.addEventListener("click", event => {
        if (event.target === el.cropOverlay) closeCropper();
      });
    }
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && el.cropOverlay && !el.cropOverlay.hidden) closeCropper();
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
