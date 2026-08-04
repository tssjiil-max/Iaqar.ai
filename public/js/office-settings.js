(() => {
  "use strict";

  const core = (window.IAQAR && window.IAQAR.officeProfile) || {};
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
    cooperationMode: core.DEFAULT_COOPERATION_MODE || "APPROVAL_REQUIRED",
    notificationPreferences: { ...(core.DEFAULT_NOTIFICATION_PREFERENCES || {}) }
  };

  const el = {};
  let current = clean(defaults);
  let authClaims = {};
  let cropState = null;
  let pendingObjectUrls = [];

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

  function setFormState(state, message) {
    if (el.state) {
      el.state.dataset.state = state || "";
      el.state.textContent = message || "";
      el.state.hidden = !message;
    }
    if (el.note && message && state !== "idle") el.note.textContent = message;
  }

  function clean(data) {
    if (typeof core.cleanOfficeProfile === "function") {
      return core.cleanOfficeProfile(data, defaults);
    }
    return { ...defaults, ...(data || {}) };
  }

  function validateOfficeName(value) {
    if (typeof core.validateOfficeName === "function") {
      return core.validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
    }
    return "";
  }

  function specialtyText(list) {
    if (typeof core.specialtyText === "function") return core.specialtyText(list);
    return "";
  }

  function officeLink() {
    if (current.publicSlug) return new URL(`/o/${encodeURIComponent(current.publicSlug)}`, window.location.origin).toString();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("office", officeId());
    url.searchParams.set("view", "public");
    return url.toString();
  }

  function revokePendingUrls() {
    pendingObjectUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
    pendingObjectUrls = [];
  }

  function trackObjectUrl(url) {
    if (url && url.startsWith("blob:")) pendingObjectUrls.push(url);
    return url;
  }

  function readSpecialtiesFromForm() {
    return Array.from(el.specialties || [])
      .filter(input => input.checked)
      .map(input => input.value);
  }

  function writeSpecialtiesToForm(list) {
    const selected = new Set(typeof core.normalizedSpecialties === "function" ? core.normalizedSpecialties(list) : list || []);
    Array.from(el.specialties || []).forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function readNotificationPreferences() {
    const prefs = { ...(core.DEFAULT_NOTIFICATION_PREFERENCES || {}) };
    Array.from(el.notificationInputs || []).forEach(input => {
      prefs[input.value] = input.checked;
    });
    return typeof core.normalizeNotificationPreferences === "function"
      ? core.normalizeNotificationPreferences(prefs)
      : prefs;
  }

  function writeNotificationPreferences(prefs) {
    const normalized = typeof core.normalizeNotificationPreferences === "function"
      ? core.normalizeNotificationPreferences(prefs)
      : prefs || {};
    Array.from(el.notificationInputs || []).forEach(input => {
      input.checked = normalized[input.value] !== false;
    });
  }

  function readCooperationMode() {
    const selected = Array.from(el.cooperationInputs || []).find(input => input.checked);
    return typeof core.normalizeCooperationMode === "function"
      ? core.normalizeCooperationMode(selected && selected.value)
      : (selected && selected.value) || defaults.cooperationMode;
  }

  function writeCooperationMode(mode) {
    const normalized = typeof core.normalizeCooperationMode === "function"
      ? core.normalizeCooperationMode(mode)
      : mode || defaults.cooperationMode;
    Array.from(el.cooperationInputs || []).forEach(input => {
      input.checked = input.value === normalized;
    });
  }

  function setMediaPreview(img, url, emptyNode) {
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

  function updateOfficeCardVisuals() {
    const logoImg = document.querySelector("#officeSettingsBtn img, #officeLogoBtn img");
    if (logoImg && current.logoUrl) logoImg.src = current.logoUrl;

    const coverBtn = document.getElementById("officeCoverBtn");
    const coverImg = document.getElementById("officeCardCoverImg");
    const coverEmpty = document.getElementById("officeCardCoverEmpty");
    if (coverImg) {
      if (current.coverUrl) {
        coverImg.src = current.coverUrl;
        coverImg.hidden = false;
        if (coverEmpty) coverEmpty.hidden = true;
        if (coverBtn) coverBtn.classList.add("has-cover");
      } else {
        coverImg.removeAttribute("src");
        coverImg.hidden = true;
        if (coverEmpty) coverEmpty.hidden = false;
        if (coverBtn) coverBtn.classList.remove("has-cover");
      }
    }
  }

  function renderQr() {
    if (!el.qrCanvas || typeof window.qrcode !== "function") return;
    const link = officeLink();
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(link);
      qr.make();
      const modules = qr.getModuleCount();
      const size = 168;
      const cell = size / modules;
      const ctx = el.qrCanvas.getContext("2d");
      el.qrCanvas.width = size;
      el.qrCanvas.height = size;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#073f35";
      for (let row = 0; row < modules; row += 1) {
        for (let col = 0; col < modules; col += 1) {
          if (!qr.isDark(row, col)) continue;
          ctx.fillRect(Math.floor(col * cell), Math.floor(row * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
      if (el.qrNote) el.qrNote.textContent = "امسح الرمز لفتح رابط المكتب";
    } catch (error) {
      console.warn("[iaqar] qr render", error);
      if (el.qrNote) el.qrNote.textContent = "تعذر إنشاء رمز QR الآن";
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
    writeNotificationPreferences(current.notificationPreferences);
    writeCooperationMode(current.cooperationMode);
    setMediaPreview(el.logoPreview, current.logoUrl, el.logoEmpty);
    setMediaPreview(el.coverPreview, current.coverUrl, el.coverEmpty);
    setMediaPreview(el.whatsappCoverPreview, current.whatsappCoverUrl, el.whatsappCoverEmpty);

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
    updateOfficeCardVisuals();
    renderQr();
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

    setFormState("loading", "جارٍ مزامنة بيانات المكتب…");
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
      setFormState("success", "البيانات متزامنة مع Firestore لهذا المكتب.");
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      setFormState("error", "تم عرض البيانات المحفوظة على الجهاز. يلزم حساب مدير مخوّل للمزامنة.");
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

      const oldKey = officeSnap.exists ? core.safeText(officeSnap.data().officeNameKey) : "";
      if (oldKey && oldKey !== data.officeNameKey) {
        const oldClaimRef = runtime.db.collection("officeNameClaims").doc(oldKey);
        const oldClaimSnap = await transaction.get(oldClaimRef);
        if (oldClaimSnap.exists && oldClaimSnap.data().officeId === officeId()) {
          transaction.delete(oldClaimRef);
        }
      }

      const stamp = window.firebase.firestore.FieldValue.serverTimestamp();
      transaction.set(claimRef, {
        officeId: officeId(),
        ownerUid: user.uid,
        officeName: data.officeName,
        updatedAt: stamp
      }, { merge: true });

      transaction.set(officeRef, {
        ...data,
        officeId: officeId(),
        ownerUid: officeSnap.exists && officeSnap.data().ownerUid
          ? officeSnap.data().ownerUid
          : user.uid,
        updatedAt: stamp
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
        updatedAt: stamp
      }, { merge: true });
    });
  }

  async function uploadMedia(file, endpoint, urlField) {
    const validation = typeof core.validateImageFile === "function" ? core.validateImageFile(file) : "";
    if (validation) throw new Error(validation);
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        Authorization: `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body: file
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result[urlField]) {
      throw new Error(result.message || "تعذر رفع الصورة");
    }
    return result[urlField];
  }

  async function maybeUploadPendingMedia(data) {
    const next = { ...data };
    if (el.logo && el.logo.files && el.logo.files[0]) {
      next.logoUrl = await uploadMedia(el.logo.files[0], "/media/office-logo", "logoUrl");
    }
    if (el.cover && el.cover.files && el.cover.files[0]) {
      next.coverUrl = await uploadMedia(el.cover.files[0], "/media/office-cover", "coverUrl");
    }
    if (el.whatsappCover && el.whatsappCover.files && el.whatsappCover.files[0]) {
      next.whatsappCoverUrl = await uploadMedia(el.whatsappCover.files[0], "/media/office-whatsapp-cover", "whatsappCoverUrl");
    }
    return next;
  }

  async function onSave(event) {
    event.preventDefault();
    const nameError = validateOfficeName(el.officeName.value);
    if (nameError) {
      el.officeName.setCustomValidity(nameError);
      el.officeName.reportValidity();
      toast(nameError);
      setFormState("error", nameError);
      return;
    }
    el.officeName.setCustomValidity("");

    let data = clean({
      officeName: el.officeName.value,
      brokerName: el.brokerName.value,
      phone: el.phone.value,
      whatsapp: el.phone.value,
      licenseNumber: el.license.value,
      city: el.city.value,
      specialties: readSpecialtiesFromForm(),
      logoUrl: current.logoUrl,
      coverUrl: current.coverUrl,
      whatsappCoverUrl: current.whatsappCoverUrl,
      publicSlug: current.publicSlug || (typeof core.buildPublicSlug === "function" ? core.buildPublicSlug(el.officeName.value, officeId()) : ""),
      cooperationMode: readCooperationMode(),
      notificationPreferences: readNotificationPreferences()
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
      toast("أكمل بيانات المكتب المطلوبة");
      setFormState("error", "أكمل بيانات المكتب المطلوبة");
      return;
    }

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";
    setFormState("loading", "جارٍ حفظ إعدادات المكتب…");

    try {
      data = clean(await maybeUploadPendingMedia(data));
    } catch (error) {
      toast(error.message || "تعذر رفع الصورة");
      setFormState("error", error.message || "تعذر رفع الصورة");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
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
          setFormState("error", message);
          el.save.disabled = false;
          el.save.textContent = "حفظ التعديلات";
          return;
        }
      }
    }

    if (!synced) {
      setFormState("error", "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.");
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

    apply(data);
    saveLocal(data);
    if (el.logo) el.logo.value = "";
    if (el.cover) el.cover.value = "";
    if (el.whatsappCover) el.whatsappCover.value = "";
    setFormState("success", "تم حفظ البيانات ومزامنتها مع Firestore.");
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
    const text = `${current.officeName}\nرابط المكتب:\n${link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.officeName, text, url: link });
        return;
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function previewLink() {
    window.open(officeLink(), "_blank", "noopener,noreferrer");
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

    const logoSrc = current.logoUrl || (document.querySelector("#officeSettingsBtn img, #officeLogoBtn img") || {}).src;
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
    const slug = typeof core.buildPublicSlug === "function"
      ? core.buildPublicSlug(current.officeName, officeId())
      : `maktab-${officeId()}`;
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
    renderQr();
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

  function openCropper(file, presetId, targetInput, previewImg, emptyNode) {
    const preset = typeof core.getCoverCropPreset === "function"
      ? core.getCoverCropPreset(presetId)
      : { id: presetId, aspectRatio: 16 / 9, width: 1280, height: 720 };
    const validation = typeof core.validateImageFile === "function" ? core.validateImageFile(file) : "";
    if (validation) {
      toast(validation);
      return;
    }
    const url = trackObjectUrl(URL.createObjectURL(file));
    cropState = { file, preset, targetInput, previewImg, emptyNode, url };
    if (el.cropTitle) el.cropTitle.textContent = preset.label || "قص الصورة";
    if (el.cropMeta) el.cropMeta.textContent = `نسبة العرض: ${preset.aspectRatio}`;
    if (el.cropImage) {
      el.cropImage.src = url;
      el.cropImage.style.aspectRatio = String(preset.aspectRatio);
    }
    if (el.cropOverlay) el.cropOverlay.hidden = false;
  }

  function closeCropper() {
    if (el.cropOverlay) el.cropOverlay.hidden = true;
    cropState = null;
  }

  async function confirmCrop() {
    if (!cropState || !el.cropImage || !el.cropImage.complete) {
      toast("الصورة غير جاهزة للقص");
      return;
    }
    try {
      const blob = await core.cropImageToPreset(el.cropImage, cropState.preset, () => document.createElement("canvas"));
      const croppedFile = new File([blob], cropState.file.name.replace(/\.\w+$/, "") + "-cropped.jpg", { type: "image/jpeg" });
      const transfer = new DataTransfer();
      transfer.items.add(croppedFile);
      cropState.targetInput.files = transfer.files;
      const previewUrl = trackObjectUrl(URL.createObjectURL(croppedFile));
      setMediaPreview(cropState.previewImg, previewUrl, cropState.emptyNode);
      toast("تم قص الصورة — احفظ التعديلات للرفع");
      closeCropper();
    } catch (error) {
      console.warn("[iaqar] crop", error);
      toast("تعذر قص الصورة");
    }
  }

  function onMediaInputChange(input, presetId, preview, emptyNode) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (presetId === "logo") {
      const validation = typeof core.validateImageFile === "function" ? core.validateImageFile(file) : "";
      if (validation) {
        toast(validation);
        input.value = "";
        return;
      }
      const url = trackObjectUrl(URL.createObjectURL(file));
      setMediaPreview(preview, url, emptyNode);
      return;
    }
    openCropper(file, presetId, input, preview, emptyNode);
  }

  async function removeMedia(field, input, preview, emptyNode) {
    current = clean({ ...current, [field]: "" });
    if (input) input.value = "";
    setMediaPreview(preview, "", emptyNode);
    updateOfficeCardVisuals();
    toast("أزل الصورة ثم احفظ لتثبيت التغيير");
  }

  function cooperationStatusLabel(value) {
    const status = String(value || "").toLowerCase();
    if (status.includes("active") || status === "تعاون نشط") return "تعاون نشط";
    if (status.includes("pending") || status.includes("wait")) return "بانتظار الموافقة";
    if (status.includes("reject")) return "رُفض الطلب";
    if (status.includes("end") || status.includes("revok")) return "انتهى التعاون";
    return "لم تُشارك";
  }

  function formatBankDate(value) {
    if (!value) return "—";
    try {
      const date = value.toDate ? value.toDate() : new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium" }).format(date);
    } catch (_) {
      return "—";
    }
  }

  function renderOpportunityBank(items) {
    if (!el.bankList) return;
    if (!items.length) {
      el.bankList.innerHTML = `<div class="empty" id="opportunityBankEmpty">لا توجد فرص محفوظة لهذا المكتب بعد.</div>`;
      return;
    }
    el.bankList.innerHTML = items.map(item => {
      const title = [item.opportunityKind || item.kind || item.type || "فرصة", item.propertyType || ""].filter(Boolean).join(" · ");
      const place = [item.city, item.district].filter(Boolean).join(" — ");
      const price = item.price || item.budget || item.budgetMax || "";
      return `<article class="bank-item">
        <h4>${escapeHtml(title || "فرصة")}</h4>
        <p>${escapeHtml(place || "بدون موقع")}${price ? ` · ${escapeHtml(String(price))}` : ""}</p>
        <div class="bank-meta">
          <span>تاريخ الإضافة: ${escapeHtml(formatBankDate(item.createdAt || item.updatedAt))}</span>
          <span>التعاون: ${escapeHtml(cooperationStatusLabel(item.cooperationStatus || item.cooperationState))}</span>
        </div>
      </article>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function openOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (el.bankStatus) el.bankStatus.textContent = "جارٍ التحميل…";
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.refs || !runtime.refs.opportunities || !user) {
      renderOpportunityBank([]);
      if (el.bankStatus) el.bankStatus.textContent = "عرض محلي — سجّل دخول المكتب لمزامنة بنك الفرص.";
      return;
    }
    try {
      const snap = await runtime.refs.opportunities.orderBy("createdAt", "desc").limit(50).get();
      const items = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
      renderOpportunityBank(items);
      if (el.bankStatus) {
        el.bankStatus.textContent = items.length
          ? `فرص هذا المكتب فقط (${items.length})`
          : "بنك الفرص فارغ لهذا المكتب.";
      }
    } catch (error) {
      console.warn("[iaqar] opportunity bank", error);
      renderOpportunityBank([]);
      if (el.bankStatus) el.bankStatus.textContent = "تعذر تحميل بنك الفرص. تأكد من صلاحية المكتب.";
    }
  }

  function closeOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = true;
    if (document.getElementById("officeSettings")?.hidden !== false) {
      document.body.style.overflow = "";
    }
  }

  async function updateAuthState(user) {
    authClaims = {};
    if (el.logout) el.logout.disabled = !user;
    if (!user) {
      setFormState("idle", "البيانات محفوظة على هذا الجهاز. سجل دخول مدير المكتب للمزامنة مع Firestore.");
      return;
    }
    try {
      const token = await user.getIdTokenResult();
      authClaims = token.claims || {};
    } catch (_) {}
    await loadFirestore();
  }

  function bindMediaControls() {
    if (el.logo) el.logo.addEventListener("change", () => onMediaInputChange(el.logo, "logo", el.logoPreview, el.logoEmpty));
    if (el.cover) el.cover.addEventListener("change", () => onMediaInputChange(el.cover, "display", el.coverPreview, el.coverEmpty));
    if (el.whatsappCover) {
      el.whatsappCover.addEventListener("change", () => onMediaInputChange(el.whatsappCover, "whatsappWide", el.whatsappCoverPreview, el.whatsappCoverEmpty));
    }
    if (el.removeLogo) el.removeLogo.addEventListener("click", () => removeMedia("logoUrl", el.logo, el.logoPreview, el.logoEmpty));
    if (el.removeCover) el.removeCover.addEventListener("click", () => removeMedia("coverUrl", el.cover, el.coverPreview, el.coverEmpty));
    if (el.removeWhatsappCover) {
      el.removeWhatsappCover.addEventListener("click", () => removeMedia("whatsappCoverUrl", el.whatsappCover, el.whatsappCoverPreview, el.whatsappCoverEmpty));
    }
    if (el.cropCancel) el.cropCancel.addEventListener("click", closeCropper);
    if (el.cropConfirm) el.cropConfirm.addEventListener("click", confirmCrop);
    if (el.cropOverlay) {
      el.cropOverlay.addEventListener("click", event => {
        if (event.target === el.cropOverlay) closeCropper();
      });
    }
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
    el.removeLogo = document.getElementById("removeOfficeLogoBtn");
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.coverEmpty = document.getElementById("officeCoverEmpty");
    el.removeCover = document.getElementById("removeOfficeCoverBtn");
    el.whatsappCover = document.getElementById("officeWhatsappCoverInput");
    el.whatsappCoverPreview = document.getElementById("officeWhatsappCoverPreview");
    el.whatsappCoverEmpty = document.getElementById("officeWhatsappCoverEmpty");
    el.removeWhatsappCover = document.getElementById("removeOfficeWhatsappCoverBtn");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qrCanvas = document.getElementById("officeQrCanvas");
    el.qrNote = document.getElementById("officeQrNote");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.state = document.getElementById("officeSettingsState");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notificationInputs = document.querySelectorAll('input[name="officeNotificationPref"]');
    el.cooperationInputs = document.querySelectorAll('input[name="officeCooperationMode"]');
    el.bankEntry = document.getElementById("opportunityBankEntry");
    el.bankOverlay = document.getElementById("opportunityBank");
    el.bankClose = document.getElementById("opportunityBankClose");
    el.bankList = document.getElementById("opportunityBankList");
    el.bankStatus = document.getElementById("opportunityBankStatus");
    el.cropOverlay = document.getElementById("officeCropOverlay");
    el.cropTitle = document.getElementById("officeCropTitle");
    el.cropMeta = document.getElementById("officeCropMeta");
    el.cropImage = document.getElementById("officeCropImage");
    el.cropCancel = document.getElementById("officeCropCancel");
    el.cropConfirm = document.getElementById("officeCropConfirm");

    apply(loadLocal() || defaults);
    bindMediaControls();

    if (el.officeName) el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    if (el.copy) el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewLink);
    if (el.logout) el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.bankEntry) el.bankEntry.addEventListener("click", openOpportunityBank);
    if (el.bankClose) el.bankClose.addEventListener("click", closeOpportunityBank);
    if (el.bankOverlay) {
      el.bankOverlay.addEventListener("click", event => {
        if (event.target === el.bankOverlay) closeOpportunityBank();
      });
    }

    try {
      if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(updateAuthState);
      else updateAuthState(null);
    } catch (_) {
      updateAuthState(null);
    }

    window.addEventListener("beforeunload", revokePendingUrls);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
