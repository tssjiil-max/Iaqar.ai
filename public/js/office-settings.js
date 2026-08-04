(() => {
  "use strict";

  const core = window.IAQAROfficeSettingsCore;
  if (!core) {
    console.error("[iaqar] office settings core was not loaded");
    return;
  }
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
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    logoUrl: "",
    displayImageUrl: "",
    coverUrl: "",
    publicSlug: "",
    notificationPreferences: { ...core.DEFAULT_NOTIFICATION_PREFERENCES },
    cooperationMode: "APPROVAL_REQUIRED"
  };

  const el = {};
  let current = { ...defaults };
  const pendingMedia = { logo: null, display: null, cover: null };
  const removedMedia = new Set();
  const previewObjectUrls = new Set();
  let nameAvailabilityTimer = null;

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

  function normalizeOfficeNameKey(value) {
    return core.normalizeOfficeNameKey(value);
  }

  function validateOfficeName(value) {
    return core.validateOfficeName(value);
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
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      displayImageUrl: safeText(data.displayImageUrl).slice(0, 2000),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      notificationPreferences: core.notificationPreferences(data.notificationPreferences),
      cooperationMode: core.cooperationMode(data.cooperationMode)
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

  function identityField(kind) {
    return kind === "logo" ? "logoUrl" : kind === "display" ? "displayImageUrl" : "coverUrl";
  }

  function setIdentityPreview(kind, url) {
    const image = el.identityPreviews && el.identityPreviews[kind];
    const empty = el.identityEmpty && el.identityEmpty[kind];
    if (image) {
      image.src = url || "";
      image.hidden = !url;
    }
    if (empty) empty.hidden = Boolean(url);
    const homeImage = kind === "logo"
      ? document.getElementById("officeLogoImage")
      : kind === "cover"
        ? document.getElementById("officeCoverImage")
        : document.getElementById("officeDisplayImage");
    if (homeImage) {
      homeImage.src = url || "";
      homeImage.hidden = !url;
    }
    const homeEmpty = kind === "logo"
      ? document.getElementById("officeHomeLogoEmpty")
      : kind === "cover"
        ? document.getElementById("officeHomeCoverEmpty")
        : null;
    if (homeEmpty) homeEmpty.hidden = Boolean(url);
  }

  function writePreferencesToForm(preferences) {
    const normalized = core.notificationPreferences(preferences);
    Object.entries(el.notificationPreferences || {}).forEach(([key, input]) => {
      input.checked = normalized[key];
    });
  }

  function readPreferencesFromForm() {
    return core.notificationPreferences(Object.fromEntries(
      Object.entries(el.notificationPreferences || {}).map(([key, input]) => [key, input.checked])
    ));
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    el.officeName.value = current.officeName;
    el.brokerName.value = current.brokerName;
    el.phone.value = current.phone;
    el.license.value = current.licenseNumber;
    el.city.value = current.city;
    el.link.value = officeLink();
    writeSpecialtiesToForm(current.specialties);
    writePreferencesToForm(current.notificationPreferences);
    if (el.cooperationMode) el.cooperationMode.value = current.cooperationMode;
    ["logo", "display", "cover"].forEach(kind => setIdentityPreview(kind, current[identityField(kind)]));
    const homeCover = document.getElementById("officeCoverImage");
    const homeCoverEmpty = document.getElementById("officeHomeCoverEmpty");
    const homeCoverUrl = current.coverUrl || current.displayImageUrl;
    if (homeCover) {
      homeCover.src = homeCoverUrl;
      homeCover.hidden = !homeCoverUrl;
    }
    if (homeCoverEmpty) homeCoverEmpty.hidden = Boolean(homeCoverUrl);

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
          logoUrl: data.logoUrl,
          displayImageUrl: data.displayImageUrl || data.coverUrl,
          coverUrl: data.coverUrl,
          publicSlug: data.publicSlug,
          notificationPreferences: data.notificationPreferences,
          cooperationMode: data.cooperationMode
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

  async function authenticatedFetch(path, options = {}) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب أولًا");
    const response = await fetch(`${WORKER_BASE}${path}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${await user.getIdToken()}`,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر حفظ إعدادات المكتب");
      error.code = payload.error || "";
      throw error;
    }
    return payload;
  }

  function validIdentityFile(file) {
    return file && /^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 0 && file.size <= 10 * 1024 * 1024;
  }

  async function cropIdentityFile(file, kind) {
    if (!validIdentityFile(file)) {
      throw new Error("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 10 ميجابايت");
    }
    const preset = core.mediaPreset(kind);
    if (!preset) throw new Error("نوع صورة الهوية غير صالح");
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(sourceUrl);
      const sourceRatio = image.naturalWidth / image.naturalHeight;
      let sourceWidth = image.naturalWidth;
      let sourceHeight = image.naturalHeight;
      if (sourceRatio > preset.ratio) sourceWidth = sourceHeight * preset.ratio;
      else sourceHeight = sourceWidth / preset.ratio;
      const sourceX = (image.naturalWidth - sourceWidth) / 2;
      const sourceY = (image.naturalHeight - sourceHeight) / 2;
      const outputWidth = Math.max(1, Math.min(preset.maxWidth, Math.round(sourceWidth)));
      const outputHeight = Math.max(1, Math.round(outputWidth / preset.ratio));
      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      canvas.getContext("2d").drawImage(
        image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight
      );
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", preset.quality));
      if (!blob) throw new Error("تعذر قص الصورة");
      return new File([blob], `${kind}.jpg`, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  }

  async function selectIdentityMedia(kind, file) {
    const cropped = await cropIdentityFile(file, kind);
    pendingMedia[kind] = cropped;
    removedMedia.delete(kind);
    const previewUrl = URL.createObjectURL(cropped);
    previewObjectUrls.add(previewUrl);
    setIdentityPreview(kind, previewUrl);
    if (el.mediaStatus) el.mediaStatus.textContent = "تم تجهيز المعاينة والقص. احفظ لتطبيق التغييرات.";
  }

  async function uploadIdentityMedia(kind, file) {
    const payload = await authenticatedFetch("/media/office-identity", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-Office-Id": officeId(),
        "X-Media-Kind": kind
      },
      body: file
    });
    if (!payload.mediaUrl) throw new Error("لم يرجع الخادم رابط الصورة");
    return payload.mediaUrl;
  }

  async function removeIdentityMedia(kind) {
    await authenticatedFetch("/media/office-identity", {
      method: "DELETE",
      headers: { "X-Office-Id": officeId(), "X-Media-Kind": kind }
    });
  }

  async function saveProfile(data) {
    const payload = await authenticatedFetch("/office/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeId: officeId(), ...data })
    });
    return clean(payload.profile || data);
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

    const data = clean({
      officeName: el.officeName.value,
      brokerName: el.brokerName.value,
      phone: el.phone.value,
      licenseNumber: el.license.value,
      city: el.city.value,
      specialties: current.specialties,
      logoUrl: removedMedia.has("logo") ? "" : current.logoUrl,
      displayImageUrl: removedMedia.has("display") ? "" : current.displayImageUrl,
      coverUrl: removedMedia.has("cover") ? "" : current.coverUrl,
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value),
      notificationPreferences: readPreferencesFromForm(),
      cooperationMode: el.cooperationMode.value
    });

    if (!data.officeName || !data.brokerName || !data.phone || !data.licenseNumber || !data.city) {
      toast("أكمل بيانات المكتب المطلوبة");
      return;
    }

    el.save.disabled = true;
    el.save.textContent = Object.values(pendingMedia).some(Boolean) ? "جارٍ رفع الصور..." : "جارٍ الحفظ...";
    el.note.textContent = "جارٍ التحقق من الاسم وحفظ الإعدادات...";

    try {
      for (const kind of ["logo", "display", "cover"]) {
        if (pendingMedia[kind]) data[identityField(kind)] = await uploadIdentityMedia(kind, pendingMedia[kind]);
      }
      el.save.textContent = "جارٍ الحفظ...";
      const saved = await saveProfile(data);
      await Promise.all([...removedMedia].map(kind => removeIdentityMedia(kind).catch(error => {
        console.warn("[iaqar] identity media removal failed", kind, error);
      })));
      apply(saved);
      saveLocal(saved);
      ["logo", "display", "cover"].forEach(kind => { pendingMedia[kind] = null; });
      removedMedia.clear();
      if (el.mediaStatus) el.mediaStatus.textContent = "تم حفظ الهوية البصرية.";
      el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
      toast("تم حفظ إعدادات المكتب");
    } catch (error) {
      console.warn("[iaqar] office settings sync failed", error);
      if (error && error.code === "office_name_taken") {
        el.officeName.setCustomValidity(error.message);
        el.officeName.reportValidity();
      }
      el.note.textContent = error.message || "تعذر حفظ إعدادات المكتب.";
      toast(error.message || "تعذر حفظ إعدادات المكتب");
    } finally {
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
    }
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
    await ensurePublicSlug();
    const url = officeLink();
    const shareData = { title: current.officeName, text: `زيارة ${current.officeName}`, url };
    try {
      if (navigator.share) await navigator.share(shareData);
      else await copyLink();
    } catch (error) {
      if (error && error.name !== "AbortError") {
        await copyLink();
      }
    }
  }

  function showOfficeQr() {
    const canvas = el.qrCanvas;
    if (!canvas) return;
    canvas.width = 280;
    canvas.height = 280;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawQr(ctx, officeLink(), 20, 20, 240);
    el.qrPanel.hidden = false;
    el.qrPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function previewOfficeLink() {
    window.open(officeLink(), "_blank", "noopener,noreferrer");
  }

  async function checkOfficeNameAvailability() {
    const error = validateOfficeName(el.officeName.value);
    if (error) {
      el.nameStatus.textContent = error;
      el.nameStatus.dataset.state = "error";
      return false;
    }
    el.nameStatus.textContent = "جارٍ التحقق من توفر الاسم...";
    el.nameStatus.dataset.state = "loading";
    try {
      const params = new URLSearchParams({ officeId: officeId(), name: el.officeName.value.trim() });
      const result = await authenticatedFetch(`/office/name-availability?${params.toString()}`);
      el.nameStatus.textContent = result.available ? "اسم المكتب متاح" : "اسم المكتب مستخدم؛ اختر اسمًا آخر";
      el.nameStatus.dataset.state = result.available ? "success" : "error";
      return result.available;
    } catch (availabilityError) {
      el.nameStatus.textContent = availabilityError.message || "تعذر التحقق من الاسم";
      el.nameStatus.dataset.state = "error";
      return false;
    }
  }

  function scheduleNameAvailabilityCheck() {
    clearTimeout(nameAvailabilityTimer);
    el.officeName.setCustomValidity("");
    nameAvailabilityTimer = setTimeout(checkOfficeNameAvailability, 450);
  }

  function markIdentityRemoved(kind) {
    pendingMedia[kind] = null;
    removedMedia.add(kind);
    setIdentityPreview(kind, "");
    if (el.mediaStatus) el.mediaStatus.textContent = "ستُحذف الصورة عند حفظ التعديلات.";
  }

  async function openOpportunityBank() {
    if (!el.bankPanel) return;
    el.bankPanel.hidden = false;
    el.bankState.textContent = "جارٍ فتح بنك الفرص الخاص بالمكتب...";
    el.bankPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.refs || !runtime.refs.opportunities || !user) {
      el.bankState.textContent = "سجل دخول المكتب لفتح بنك الفرص الخاص.";
      return;
    }
    try {
      const snapshot = await runtime.refs.opportunities.limit(1).get();
      el.bankState.textContent = snapshot.empty
        ? "لا توجد فرص محفوظة في بنك المكتب حاليًا."
        : "بنك الفرص متصل وتوجد فرص محفوظة. إدارة السجلات الكاملة غير متاحة حاليًا.";
    } catch (error) {
      console.warn("[iaqar] opportunity bank entry", error);
      el.bankState.textContent = "تعذر فتح بنك الفرص. تحقق من الاتصال وصلاحية المكتب.";
    }
  }

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم التواصل", current.phone],
      ["المدينة", current.city],
      ["صورة المكتب", current.displayImageUrl || current.coverUrl]
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

    const logoNode = document.getElementById("officeLogoImage") || document.querySelector(".site-logo img");
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

    const cover = await loadImage(current.coverUrl || current.displayImageUrl);
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
      ["الخدمات", specialtyText(current.specialties) || "خدمات عقارية"]
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
    current = await saveProfile(current);
    saveLocal(current);
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
    el.logout.disabled = !user;
    if (!user) {
      el.note.textContent = "البيانات محفوظة على هذا الجهاز. سجل دخول مدير المكتب للمزامنة مع Firestore.";
      return;
    }
    await loadFirestore();
  }

  function init() {
    el.form = document.getElementById("officeProfileForm");
    if (!el.form) return;

    el.officeName = document.getElementById("officeNameInput");
    el.brokerName = document.getElementById("brokerNameInput");
    el.phone = document.getElementById("officePhoneInput");
    el.license = document.getElementById("licenseNumberInput");
    el.city = document.getElementById("officeCityInput");
    el.identityInputs = {
      logo: document.getElementById("officeLogoInput"),
      display: document.getElementById("officeDisplayInput"),
      cover: document.getElementById("officeCoverInput")
    };
    el.identityPreviews = {
      logo: document.getElementById("officeLogoPreview"),
      display: document.getElementById("officeDisplayPreview"),
      cover: document.getElementById("officeCoverPreview")
    };
    el.identityEmpty = {
      logo: document.getElementById("officeLogoEmpty"),
      display: document.getElementById("officeDisplayEmpty"),
      cover: document.getElementById("officeCoverEmpty")
    };
    el.mediaStatus = document.getElementById("officeIdentityStatus");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.showQr = document.getElementById("showOfficeQrBtn");
    el.qrPanel = document.getElementById("officeQrPanel");
    el.qrCanvas = document.getElementById("officeQrCanvas");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.nameStatus = document.getElementById("officeNameStatus");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notificationPreferences = Object.fromEntries(
      Array.from(document.querySelectorAll("[data-notification-preference]"))
        .map(input => [input.dataset.notificationPreference, input])
    );
    el.cooperationMode = document.getElementById("officeCooperationMode");
    el.bankButton = document.getElementById("openOpportunityBankBtn");
    el.bankPanel = document.getElementById("opportunityBankPanel");
    el.bankState = document.getElementById("opportunityBankState");

    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", scheduleNameAvailabilityCheck);
    el.officeName.addEventListener("blur", checkOfficeNameAvailability);
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    el.shareLink.addEventListener("click", shareOfficeLink);
    el.previewLink.addEventListener("click", previewOfficeLink);
    el.showQr.addEventListener("click", showOfficeQr);
    el.logout.addEventListener("click", onLogout);
    el.bankButton.addEventListener("click", openOpportunityBank);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    Object.entries(el.identityInputs).forEach(([kind, input]) => {
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        input.disabled = true;
        if (el.mediaStatus) el.mediaStatus.textContent = "جارٍ تجهيز الصورة وقصها...";
        try {
          await selectIdentityMedia(kind, file);
        } catch (error) {
          if (el.mediaStatus) el.mediaStatus.textContent = error.message;
          toast(error.message);
          input.value = "";
        } finally {
          input.disabled = false;
        }
      });
    });
    document.querySelectorAll("[data-remove-identity]").forEach(button => {
      button.addEventListener("click", () => markIdentityRemoved(button.dataset.removeIdentity));
    });
    window.addEventListener("beforeunload", () => {
      previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
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
