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

  const lib = window.IAQAROfficeLib || {};

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
    cooperationMode: (lib.DEFAULT_COOPERATION_MODE || "approval_required"),
    notificationPrefs: (lib.defaultNotificationPrefs ? lib.defaultNotificationPrefs() : {})
  };

  const el = {};
  let current = { ...defaults };
  let authClaims = {};
  // Pending cropped image blobs waiting to be uploaded on save, and removal flags.
  const pending = { logoBlob: null, coverBlob: null, coverImage: null, removeLogo: false, removeCover: false };

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

  function normalizeOfficeNameKey(value) {
    return lib.normalizeOfficeNameKey ? lib.normalizeOfficeNameKey(value) : safeText(value);
  }

  function validateOfficeName(value) {
    return lib.validateOfficeName
      ? lib.validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() })
      : (safeText(value) ? "" : "اكتب اسم المكتب");
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
      cooperationMode: lib.normalizeCooperationMode ? lib.normalizeCooperationMode(data.cooperationMode) : defaults.cooperationMode,
      notificationPrefs: lib.normalizeNotificationPrefs ? lib.normalizeNotificationPrefs(data.notificationPrefs) : (data.notificationPrefs || {}),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64)
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

  // ---- Office card + previews ------------------------------------------------

  function updateOfficeCardMedia() {
    // Cover on the office card doubles as a settings entry (Directive §6).
    if (el.cardCoverImage && el.cardCoverBtn) {
      if (current.coverUrl) {
        el.cardCoverImage.src = current.coverUrl;
        el.cardCoverBtn.hidden = false;
      } else {
        el.cardCoverImage.removeAttribute("src");
        el.cardCoverBtn.hidden = true;
      }
    }
    const logoImg = document.querySelector("#officeSettingsBtn img");
    if (logoImg && current.logoUrl) logoImg.src = current.logoUrl;
  }

  function setPreview(imgEl, src) {
    if (!imgEl) return;
    if (src) {
      imgEl.src = src;
      imgEl.hidden = false;
    } else {
      imgEl.removeAttribute("src");
      imgEl.hidden = true;
    }
  }

  function refreshMediaControls() {
    setPreview(el.logoPreview, pending.logoBlob ? URL.createObjectURL(pending.logoBlob) : (pending.removeLogo ? "" : current.logoUrl));
    if (el.logoRemove) el.logoRemove.hidden = !(current.logoUrl || pending.logoBlob) || pending.removeLogo;

    const coverSrc = pending.coverBlob ? URL.createObjectURL(pending.coverBlob) : (pending.removeCover ? "" : current.coverUrl);
    setPreview(el.coverPreview, coverSrc);
    if (el.coverRemove) el.coverRemove.hidden = !(current.coverUrl || pending.coverBlob) || pending.removeCover;
    if (el.coverCropWrap) el.coverCropWrap.hidden = !pending.coverImage;
  }

  function setMediaStatus(message, kind) {
    if (!el.mediaStatus) return;
    el.mediaStatus.textContent = message || "";
    el.mediaStatus.hidden = !message;
    el.mediaStatus.classList.remove("is-error", "is-loading", "is-success");
    if (kind) el.mediaStatus.classList.add(`is-${kind}`);
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
    writeNotificationPrefs(current.notificationPrefs);
    writeCooperationMode(current.cooperationMode);
    refreshMediaControls();
    updateOfficeCardMedia();

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
          cooperationMode: data.cooperationMode,
          notificationPrefs: data.notificationPrefs,
          publicSlug: data.publicSlug
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

  // ---- Notification preferences ---------------------------------------------

  function renderNotificationPrefs() {
    if (!el.notifList) return;
    const categories = lib.NOTIFICATION_CATEGORIES || [];
    el.notifList.innerHTML = categories.map(category => `
      <label class="office-toggle">
        <span>${category.label}</span>
        <input type="checkbox" data-notif-key="${category.key}">
      </label>`).join("");
    el.notifInputs = Array.from(el.notifList.querySelectorAll("input[data-notif-key]"));
    el.notifInputs.forEach(input => input.addEventListener("change", onNotificationToggle));
  }

  function writeNotificationPrefs(prefs) {
    const normalized = lib.normalizeNotificationPrefs ? lib.normalizeNotificationPrefs(prefs) : (prefs || {});
    (el.notifInputs || []).forEach(input => {
      input.checked = normalized[input.dataset.notifKey] !== false;
    });
  }

  function readNotificationPrefs() {
    const prefs = {};
    (el.notifInputs || []).forEach(input => { prefs[input.dataset.notifKey] = input.checked; });
    return lib.normalizeNotificationPrefs ? lib.normalizeNotificationPrefs(prefs) : prefs;
  }

  async function onNotificationToggle() {
    const prefs = readNotificationPrefs();
    current = clean({ ...current, notificationPrefs: prefs });
    saveLocal(current);
    const ok = await patchOffice({ notificationPrefs: prefs });
    toast(ok ? "تم تحديث تفضيلات الإشعارات" : "حُفظت على الجهاز؛ يلزم حساب مدير للمزامنة");
  }

  // ---- Cooperation mode ------------------------------------------------------

  function writeCooperationMode(mode) {
    const value = lib.normalizeCooperationMode ? lib.normalizeCooperationMode(mode) : mode;
    (el.coopInputs || []).forEach(input => { input.checked = input.value === value; });
  }

  async function onCooperationChange(event) {
    const mode = lib.normalizeCooperationMode ? lib.normalizeCooperationMode(event.target.value) : event.target.value;
    current = clean({ ...current, cooperationMode: mode });
    saveLocal(current);
    const ok = await patchOffice({ cooperationMode: mode });
    toast(ok ? "تم تحديث وضع التعاون" : "حُفظ على الجهاز؛ يلزم حساب مدير للمزامنة");
  }

  // Lightweight merge write for per-setting toggles. Returns true when synced.
  async function patchOffice(partial) {
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) return false;
    try {
      await runtime.db.collection("offices").doc(officeId()).set({
        ...partial,
        officeId: officeId(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (error) {
      console.warn("[iaqar] office patch failed", error);
      return false;
    }
  }

  // ---- Image crop + upload ---------------------------------------------------

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("IMAGE_DECODE_FAILED")); };
      image.src = url;
    });
  }

  // Crop an already-loaded image to the given ratio + position and return a blob.
  function cropToBlob(image, ratio, position, maxWidth) {
    const rect = lib.cropRectForRatio(
      image.naturalWidth, image.naturalHeight, ratio.width, ratio.height, position
    );
    const outWidth = Math.min(maxWidth, rect.sw);
    const outHeight = Math.round(outWidth * (ratio.height / ratio.width));
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outWidth, outHeight);
    return new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.9));
  }

  async function onLogoSelected() {
    const file = el.logoInput.files && el.logoInput.files[0];
    if (!file) return;
    const check = lib.validateImageFile(file);
    if (!check.ok) { setMediaStatus(check.message, "error"); el.logoInput.value = ""; return; }
    setMediaStatus("جارٍ تجهيز الشعار...", "loading");
    try {
      const image = await fileToImage(file);
      pending.logoBlob = await cropToBlob(image, lib.LOGO_CROP_RATIO, 0.5, 512);
      pending.removeLogo = false;
      refreshMediaControls();
      setMediaStatus("الشعار جاهز — اضغط حفظ لرفعه.", "success");
    } catch (_) {
      setMediaStatus("تعذر قراءة الصورة", "error");
    }
  }

  async function renderCoverPreview() {
    if (!pending.coverImage) return;
    const position = (Number(el.coverPosition && el.coverPosition.value) || 50) / 100;
    pending.coverBlob = await cropToBlob(pending.coverImage, lib.COVER_CROP_RATIO, position, 1600);
    pending.removeCover = false;
    refreshMediaControls();
  }

  async function onCoverSelected() {
    const file = el.coverInput.files && el.coverInput.files[0];
    if (!file) return;
    const check = lib.validateImageFile(file);
    if (!check.ok) { setMediaStatus(check.message, "error"); el.coverInput.value = ""; return; }
    setMediaStatus("جارٍ تجهيز الواجهة...", "loading");
    try {
      pending.coverImage = await fileToImage(file);
      if (el.coverPosition) el.coverPosition.value = "50";
      await renderCoverPreview();
      setMediaStatus("الواجهة جاهزة — اضبط موضع القص ثم اضغط حفظ.", "success");
    } catch (_) {
      setMediaStatus("تعذر قراءة الصورة", "error");
    }
  }

  function onLogoRemove() {
    pending.logoBlob = null;
    pending.removeLogo = true;
    if (el.logoInput) el.logoInput.value = "";
    refreshMediaControls();
    setMediaStatus("سيُزال الشعار عند الحفظ.", "loading");
  }

  function onCoverRemove() {
    pending.coverBlob = null;
    pending.coverImage = null;
    pending.removeCover = true;
    if (el.coverInput) el.coverInput.value = "";
    refreshMediaControls();
    setMediaStatus("ستُزال الواجهة عند الحفظ.", "loading");
  }

  async function uploadOfficeImage(kind, blob) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}/media/office-image`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "image/webp",
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Media-Kind": kind
      },
      body: blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !(result.imageUrl || result.coverUrl)) {
      throw new Error(result.message || "تعذر رفع الصورة");
    }
    return result.imageUrl || result.coverUrl;
  }

  // ---- Save ------------------------------------------------------------------

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
        officeName: data.officeName,
        officeNameKey: data.officeNameKey,
        brokerName: data.brokerName,
        phone: data.phone,
        whatsapp: data.whatsapp,
        licenseNumber: data.licenseNumber,
        city: data.city,
        specialties: data.specialties,
        coverUrl: data.coverUrl,
        logoUrl: data.logoUrl,
        cooperationMode: data.cooperationMode,
        notificationPrefs: data.notificationPrefs,
        publicSlug: data.publicSlug,
        officeId: officeId(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // Public mirror keeps only shareable identity fields (no private prefs).
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

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";

    let coverUrl = pending.removeCover ? "" : (current.coverUrl || "");
    let logoUrl = pending.removeLogo ? "" : (current.logoUrl || "");

    try {
      if (pending.logoBlob) { setMediaStatus("جارٍ رفع الشعار...", "loading"); logoUrl = await uploadOfficeImage("logo", pending.logoBlob); }
      if (pending.coverBlob) { setMediaStatus("جارٍ رفع الواجهة...", "loading"); coverUrl = await uploadOfficeImage("cover", pending.coverBlob); }
      setMediaStatus("", null);
    } catch (error) {
      setMediaStatus(String(error && error.message || "تعذر رفع الصورة"), "error");
      toast(String(error && error.message || "تعذر رفع الصورة"));
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
      specialties: readSpecialtiesFromForm(),
      coverUrl,
      logoUrl,
      cooperationMode: current.cooperationMode,
      notificationPrefs: readNotificationPrefs(),
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value)
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
      toast("أكمل بيانات المكتب المطلوبة");
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

    pending.logoBlob = null;
    pending.coverBlob = null;
    pending.coverImage = null;
    pending.removeLogo = false;
    pending.removeCover = false;
    if (el.logoInput) el.logoInput.value = "";
    if (el.coverInput) el.coverInput.value = "";

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

  // ---- Office link: copy / share / preview / QR ------------------------------

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
    const text = `${current.officeName}\nزيارة صفحة المكتب:\n${link}`;
    if (navigator.share) {
      try { await navigator.share({ title: current.officeName, text, url: link }); return; }
      catch (error) { if (error && error.name === "AbortError") return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function previewLink() {
    window.open(el.link.value, "_blank", "noopener,noreferrer");
  }

  function drawQrToCanvas(canvas, text) {
    if (!canvas || typeof window.qrcode !== "function") return false;
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const size = canvas.width;
    const cell = size / modules;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const px = Math.floor(col * cell);
        const py = Math.floor(row * cell);
        const nextX = Math.ceil((col + 1) * cell);
        const nextY = Math.ceil((row + 1) * cell);
        ctx.fillRect(px, py, nextX - px, nextY - py);
      }
    }
    return true;
  }

  function toggleQr() {
    if (!el.qrBox) return;
    const show = el.qrBox.hidden;
    if (show) {
      if (!drawQrToCanvas(el.qrCanvas, el.link.value)) { toast("تعذّر إنشاء رمز QR"); return; }
    }
    el.qrBox.hidden = !show;
    if (el.qrToggle) el.qrToggle.setAttribute("aria-expanded", show ? "true" : "false");
  }

  // ---- Opportunity Bank entry (read-only, office-scoped) ---------------------

  function coopStatusText(value) {
    const map = {
      not_shared: "لم تُشارك",
      pending: "بانتظار الموافقة",
      active: "تعاون نشط",
      rejected: "رُفض الطلب",
      ended: "انتهى التعاون"
    };
    return map[value] || "لم تُشارك";
  }

  function formatDate(value) {
    try {
      const date = value && value.toDate ? value.toDate() : (value ? new Date(value) : null);
      if (!date || isNaN(date.getTime())) return "—";
      return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(date);
    } catch (_) { return "—"; }
  }

  function renderBankEmpty() {
    el.bankBody.innerHTML = `<div class="bank-empty">لا توجد فرص في البنك بعد.<br>ستُحفظ الفرص هنا تلقائيًا عند إضافتها.</div>`;
  }

  async function openOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    el.bankBody.innerHTML = `<div class="bank-loading">جارٍ تحميل بنك الفرص...</div>`;

    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) {
      el.bankBody.innerHTML = `<div class="bank-empty">سجّل دخول مدير المكتب لعرض بنك الفرص الخاص بهذا المكتب.</div>`;
      return;
    }
    try {
      const snap = await runtime.db.collection("offices").doc(officeId())
        .collection("opportunities").limit(50).get();
      if (snap.empty) { renderBankEmpty(); return; }
      const rows = [];
      snap.forEach(doc => {
        const item = doc.data() || {};
        const title = safeText(item.propertyType || item.title || "فرصة عقارية");
        const place = [safeText(item.city), safeText(item.district)].filter(Boolean).join(" · ");
        rows.push(`
          <article class="bank-item">
            <h4>${title}${place ? ` — ${place}` : ""}</h4>
            <div class="bank-meta">
              <span>تاريخ الإضافة: ${formatDate(item.createdAt || item.dateAdded)}</span>
              <span>حالة التعاون: ${coopStatusText(item.cooperationStatus || item.cooperationState)}</span>
            </div>
          </article>`);
      });
      el.bankBody.innerHTML = rows.join("");
    } catch (error) {
      console.warn("[iaqar] bank load failed", error);
      el.bankBody.innerHTML = `<div class="bank-empty">تعذّر تحميل بنك الفرص الآن.</div>`;
    }
  }

  function closeOpportunityBank() {
    if (!el.bankOverlay) return;
    el.bankOverlay.hidden = true;
    document.body.style.overflow = "";
  }

  // ---- Share office card (existing behaviour) --------------------------------

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
    if (radius) { roundedRect(ctx, x, y, width, height, radius); ctx.clip(); }
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
    el.logoInput = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.logoRemove = document.getElementById("officeLogoRemove");
    el.coverInput = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.coverRemove = document.getElementById("officeCoverRemove");
    el.coverPosition = document.getElementById("officeCoverPosition");
    el.coverCropWrap = document.getElementById("officeCoverCropWrap");
    el.mediaStatus = document.getElementById("officeMediaStatus");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qrToggle = document.getElementById("toggleOfficeQrBtn");
    el.qrBox = document.getElementById("officeQrBox");
    el.qrCanvas = document.getElementById("officeQrCanvas");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notifList = document.getElementById("notificationPrefsList");
    el.coopInputs = Array.from(document.querySelectorAll('input[name="cooperationMode"]'));
    el.cardCoverBtn = document.getElementById("officeCoverBtn");
    el.cardCoverImage = document.getElementById("officeCoverImage");
    el.bankBtn = document.getElementById("openOpportunityBankBtn");
    el.bankOverlay = document.getElementById("opportunityBank");
    el.bankClose = document.getElementById("opportunityBankClose");
    el.bankBody = document.getElementById("opportunityBankBody");

    renderNotificationPrefs();
    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewLink);
    if (el.qrToggle) el.qrToggle.addEventListener("click", toggleQr);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.logoInput) el.logoInput.addEventListener("change", onLogoSelected);
    if (el.coverInput) el.coverInput.addEventListener("change", onCoverSelected);
    if (el.coverPosition) el.coverPosition.addEventListener("input", renderCoverPreview);
    if (el.logoRemove) el.logoRemove.addEventListener("click", onLogoRemove);
    if (el.coverRemove) el.coverRemove.addEventListener("click", onCoverRemove);
    el.coopInputs.forEach(input => input.addEventListener("change", onCooperationChange));
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
