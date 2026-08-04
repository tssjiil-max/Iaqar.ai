(() => {
  "use strict";

  const identity = (window.IAQAR && window.IAQAR.identity) || window.IAQAR_OFFICE_IDENTITY;
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

  const IMAGE_FIELDS = Object.freeze({
    logo: "logoUrl",
    display: "coverUrl",
    share: "shareCoverUrl"
  });
  const IMAGE_ORDER = Object.freeze(["logo", "display", "share"]);
  const IMAGE_HINTS = Object.freeze({
    logo: "نسبة 1:1",
    display: "نسبة 4:3 — تظهر في بطاقة المكتب",
    share: "غلاف عريض لمعاينة الروابط والواتساب"
  });

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
    shareCoverUrl: "",
    publicSlug: ""
  };

  const el = {};
  const slots = new Map();
  let current = { ...defaults };
  let authClaims = {};
  let officeNotificationPrefs = null;
  let brokerNotificationPrefs = null;
  let cooperationMode = identity.DEFAULT_COOPERATION_MODE;
  let lastSettingsTrigger = null;

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

  function setNote(node, message, tone = "") {
    if (!node) return;
    node.textContent = message;
    node.classList.remove("is-error", "is-success");
    if (tone) node.classList.add(tone === "error" ? "is-error" : "is-success");
  }

  const safeText = value => identity.safeText(value);

  function clean(data) {
    return {
      officeName: safeText(data.officeName) || defaults.officeName,
      officeNameKey: identity.normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: safeText(data.brokerName) || defaults.brokerName,
      phone: safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      whatsapp: safeText(data.whatsapp || data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city) || defaults.city,
      specialties: identity.normalizeSpecialties(data.specialties),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      shareCoverUrl: safeText(data.shareCoverUrl).slice(0, 2000),
      publicSlug: identity.normalizeSlug(data.publicSlug)
    };
  }

  function officeLink() {
    if (current.publicSlug) {
      return new URL(`/o/${encodeURIComponent(current.publicSlug)}`, window.location.origin).toString();
    }
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("office", officeId());
    url.searchParams.set("view", "public");
    return url.toString();
  }

  function readSpecialtiesFromForm() {
    return Array.from(el.specialties || [])
      .filter(input => input.checked)
      .map(input => input.value);
  }

  function writeSpecialtiesToForm(list) {
    const selected = new Set(identity.normalizeSpecialties(list));
    Array.from(el.specialties || []).forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function applyOfficeCard() {
    const map = [
      ["officeDisplayName", current.officeName],
      ["officeDisplayBroker", current.brokerName],
      ["officeDisplayLicense", current.licenseNumber],
      ["officeDisplayCity", current.city],
      ["officeDisplaySpecialties", identity.specialtiesSummary(current.specialties)]
    ];
    map.forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });

    const specialtyRow = document.querySelector(".specialty-status-row");
    if (specialtyRow) specialtyRow.hidden = !current.specialties.length;

    if (el.cardCoverImage) {
      el.cardCoverImage.hidden = !current.coverUrl;
      if (current.coverUrl) el.cardCoverImage.src = current.coverUrl;
      else el.cardCoverImage.removeAttribute("src");
    }
    if (el.cardCoverEmpty) el.cardCoverEmpty.hidden = Boolean(current.coverUrl);

    if (el.cardLogoImage && current.logoUrl) el.cardLogoImage.src = current.logoUrl;
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    if (el.officeName) el.officeName.value = current.officeName;
    if (el.brokerName) el.brokerName.value = current.brokerName;
    if (el.phone) el.phone.value = current.phone;
    if (el.whatsapp) el.whatsapp.value = current.whatsapp || current.phone;
    if (el.license) el.license.value = current.licenseNumber;
    if (el.city) el.city.value = current.city;
    if (el.link) el.link.value = officeLink();
    writeSpecialtiesToForm(current.specialties);
    IMAGE_ORDER.forEach(kind => renderSlotStoredImage(kind));
    applyOfficeCard();
    if (el.qrBox && !el.qrBox.hidden) renderQrCode();
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

  /* ---------------------------------------------------------------- الهوية البصرية */

  function slotTemplate(kind) {
    const preset = identity.imagePreset(kind);
    const article = document.createElement("article");
    article.className = "identity-slot";
    article.dataset.imageKind = kind;
    article.innerHTML = `
      <header>
        <strong>${preset.label}</strong>
        <span class="identity-hint">${IMAGE_HINTS[kind] || ""}</span>
      </header>
      <div class="identity-preview">
        <img data-role="preview" alt="معاينة ${preset.label}" hidden>
        <canvas data-role="canvas" hidden></canvas>
        <span class="identity-empty" data-role="empty">لا توجد صورة بعد</span>
      </div>
      <div class="identity-focus" data-role="focus" hidden>
        <span>موضع القص</span>
        <input type="range" data-role="focus-x" min="0" max="100" value="50"
          aria-label="موضع القص الأفقي لـ${preset.label}">
        <input type="range" data-role="focus-y" min="0" max="100" value="50"
          aria-label="موضع القص الرأسي لـ${preset.label}">
      </div>
      <div class="identity-actions">
        <input type="file" data-role="file" accept="image/jpeg,image/png,image/webp" hidden
          aria-label="اختيار ${preset.label}">
        <button type="button" data-action="choose">اختيار صورة</button>
        <button type="button" data-action="save" disabled>حفظ الصورة</button>
        <button type="button" data-action="remove" disabled>إزالة</button>
      </div>
      <p class="identity-state" data-role="state" role="status"></p>`;
    return article;
  }

  function buildIdentitySlots() {
    if (!el.identitySlots) return;
    el.identitySlots.innerHTML = "";
    IMAGE_ORDER.forEach(kind => {
      const node = slotTemplate(kind);
      el.identitySlots.appendChild(node);
      const slot = {
        kind,
        node,
        preview: node.querySelector('[data-role="preview"]'),
        canvas: node.querySelector('[data-role="canvas"]'),
        empty: node.querySelector('[data-role="empty"]'),
        focus: node.querySelector('[data-role="focus"]'),
        focusX: node.querySelector('[data-role="focus-x"]'),
        focusY: node.querySelector('[data-role="focus-y"]'),
        file: node.querySelector('[data-role="file"]'),
        state: node.querySelector('[data-role="state"]'),
        chooseBtn: node.querySelector('[data-action="choose"]'),
        saveBtn: node.querySelector('[data-action="save"]'),
        removeBtn: node.querySelector('[data-action="remove"]'),
        pendingFile: null,
        pendingImage: null,
        objectUrl: ""
      };
      slots.set(kind, slot);

      slot.chooseBtn.addEventListener("click", () => slot.file.click());
      slot.file.addEventListener("change", () => onSlotFileSelected(kind));
      slot.saveBtn.addEventListener("click", () => onSlotSave(kind));
      slot.removeBtn.addEventListener("click", () => onSlotRemove(kind));
      [slot.focusX, slot.focusY].forEach(input =>
        input.addEventListener("input", () => drawSlotCrop(kind)));

      renderSlotStoredImage(kind);
    });
  }

  function setSlotState(kind, message, tone = "") {
    const slot = slots.get(kind);
    if (!slot) return;
    slot.state.textContent = message;
    slot.state.classList.remove("is-error", "is-success");
    if (tone) slot.state.classList.add(tone === "error" ? "is-error" : "is-success");
  }

  function renderSlotStoredImage(kind) {
    const slot = slots.get(kind);
    if (!slot) return;
    const url = current[IMAGE_FIELDS[kind]] || "";
    if (slot.pendingFile) return;
    slot.preview.hidden = !url;
    if (url) slot.preview.src = url;
    else slot.preview.removeAttribute("src");
    slot.canvas.hidden = true;
    slot.empty.hidden = Boolean(url);
    slot.removeBtn.disabled = !url;
  }

  function clearPending(kind) {
    const slot = slots.get(kind);
    if (!slot) return;
    if (slot.objectUrl) {
      URL.revokeObjectURL(slot.objectUrl);
      slot.objectUrl = "";
    }
    slot.pendingFile = null;
    slot.pendingImage = null;
    slot.focus.hidden = true;
    slot.saveBtn.disabled = true;
    slot.file.value = "";
    renderSlotStoredImage(kind);
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
      image.src = src;
    });
  }

  function canvasContext(canvas) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    try {
      return canvas.getContext("2d");
    } catch (_) {
      return null;
    }
  }

  function drawSlotCrop(kind) {
    const slot = slots.get(kind);
    if (!slot || !slot.pendingImage) return false;
    const preset = identity.imagePreset(kind);
    const size = identity.outputSize(kind);
    const context = canvasContext(slot.canvas);
    if (!context) return false;
    slot.canvas.width = size.width;
    slot.canvas.height = size.height;
    const rect = identity.computeCropRect({
      sourceWidth: slot.pendingImage.naturalWidth || slot.pendingImage.width,
      sourceHeight: slot.pendingImage.naturalHeight || slot.pendingImage.height,
      aspectRatio: preset.aspectRatio,
      focusX: Number(slot.focusX.value) / 100,
      focusY: Number(slot.focusY.value) / 100
    });
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(
      slot.pendingImage,
      rect.sx, rect.sy, rect.sWidth, rect.sHeight,
      0, 0, size.width, size.height
    );
    slot.canvas.hidden = false;
    slot.preview.hidden = true;
    slot.empty.hidden = true;
    return true;
  }

  async function onSlotFileSelected(kind) {
    const slot = slots.get(kind);
    if (!slot) return;
    const file = slot.file.files && slot.file.files[0];
    if (!file) {
      clearPending(kind);
      return;
    }
    const validationError = identity.validateImageFile(file, kind);
    if (validationError) {
      clearPending(kind);
      setSlotState(kind, validationError, "error");
      return;
    }

    setSlotState(kind, "جارٍ تجهيز المعاينة...");
    slot.pendingFile = file;
    try {
      slot.objectUrl = URL.createObjectURL(file);
      slot.pendingImage = await loadImageElement(slot.objectUrl);
      slot.focus.hidden = false;
      slot.saveBtn.disabled = false;
      const cropped = drawSlotCrop(kind);
      setSlotState(kind, cropped
        ? "عدّل موضع القص ثم احفظ الصورة."
        : "المعاينة غير مدعومة في هذا المتصفح؛ سترفع الصورة كما هي.");
    } catch (_) {
      slot.saveBtn.disabled = false;
      slot.focus.hidden = true;
      setSlotState(kind, "تعذّرت المعاينة؛ يمكنك الحفظ ورفع الصورة كما هي.", "error");
    }
  }

  function canvasToBlob(canvas) {
    return new Promise(resolve => {
      if (!canvas || typeof canvas.toBlob !== "function") return resolve(null);
      try {
        canvas.toBlob(blob => resolve(blob), "image/webp", 0.92);
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function uploadOfficeImage(kind, body, contentType) {
    const user = authUser();
    if (!user) throw new Error("AUTH_REQUIRED");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}/media/office-cover`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Media-Kind": kind
      },
      body
    });
    const result = await response.json().catch(() => ({}));
    const url = result.imageUrl || result.coverUrl;
    if (!response.ok || !url) throw new Error(result.message || "UPLOAD_FAILED");
    return url;
  }

  async function removeOfficeImage(kind) {
    const user = authUser();
    if (!user) throw new Error("AUTH_REQUIRED");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}/media/office-image/remove`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({ officeId: officeId(), kind })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "REMOVE_FAILED");
    return true;
  }

  /** يحفظ حقول الهوية مع الحد الأدنى من بيانات الملف الشخصي الذي تتطلبه قواعد Firestore. */
  async function persistOfficeFields(fields) {
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) throw new Error("AUTH_REQUIRED");
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    const payload = {
      ...fields,
      officeId: officeId(),
      officeName: current.officeName,
      officeNameKey: current.officeNameKey || identity.normalizeOfficeNameKey(current.officeName),
      specialties: current.specialties,
      updatedAt: now
    };
    await Promise.all([
      runtime.db.collection("offices").doc(officeId()).set(payload, { merge: true }),
      runtime.db.collection("publicOffices").doc(officeId()).set({
        ...fields,
        officeId: officeId(),
        updatedAt: now
      }, { merge: true })
    ]);
  }

  async function onSlotSave(kind) {
    const slot = slots.get(kind);
    if (!slot || !slot.pendingFile) return;
    slot.saveBtn.disabled = true;
    slot.chooseBtn.disabled = true;
    setSlotState(kind, "جارٍ رفع الصورة...");
    try {
      const blob = await canvasToBlob(slot.canvas);
      const url = blob
        ? await uploadOfficeImage(kind, blob, "image/webp")
        : await uploadOfficeImage(kind, slot.pendingFile, slot.pendingFile.type);
      const next = clean({ ...current, [IMAGE_FIELDS[kind]]: url });
      await persistOfficeFields({ [IMAGE_FIELDS[kind]]: url });
      current = next;
      saveLocal(current);
      clearPending(kind);
      applyOfficeCard();
      setSlotState(kind, blob ? "تم حفظ الصورة بعد القص." : "تم حفظ الصورة كما هي.", "success");
    } catch (error) {
      const code = String(error && error.message || "");
      setSlotState(
        kind,
        code === "AUTH_REQUIRED"
          ? "سجل دخول مدير المكتب قبل رفع الصور."
          : "تعذّر حفظ الصورة الآن. تحقق من الاتصال وحاول مرة أخرى.",
        "error"
      );
      slot.saveBtn.disabled = false;
    } finally {
      slot.chooseBtn.disabled = false;
    }
  }

  async function onSlotRemove(kind) {
    const slot = slots.get(kind);
    if (!slot || !current[IMAGE_FIELDS[kind]]) return;
    slot.removeBtn.disabled = true;
    setSlotState(kind, "جارٍ إزالة الصورة...");
    try {
      await removeOfficeImage(kind);
      await persistOfficeFields({ [IMAGE_FIELDS[kind]]: "" });
      current = clean({ ...current, [IMAGE_FIELDS[kind]]: "" });
      saveLocal(current);
      renderSlotStoredImage(kind);
      applyOfficeCard();
      setSlotState(kind, "تمت إزالة الصورة.", "success");
    } catch (error) {
      const code = String(error && error.message || "");
      setSlotState(
        kind,
        code === "AUTH_REQUIRED"
          ? "سجل دخول مدير المكتب قبل إزالة الصور."
          : "تعذّرت إزالة الصورة الآن.",
        "error"
      );
      slot.removeBtn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ بيانات المكتب */

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
          shareCoverUrl: data.shareCoverUrl,
          publicSlug: data.publicSlug
        });
        saveLocal(current);
      }
      setNote(el.note, "البيانات متزامنة مع Firestore لهذا المكتب.");
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      setNote(el.note, "تم عرض البيانات المحفوظة على الجهاز. يلزم حساب مدير مخوّل للمزامنة.", "error");
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
        logoUrl: data.logoUrl,
        coverUrl: data.coverUrl,
        shareCoverUrl: data.shareCoverUrl,
        publicSlug: data.publicSlug,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  }

  /** فحص التوفر قبل الحفظ؛ الحماية النهائية تبقى في المعاملة وقواعد Firestore. */
  async function officeNameAvailable(nameKey) {
    const runtime = officeRuntime();
    if (!runtime || !runtime.db || !authUser()) return true;
    try {
      const snap = await runtime.db.collection("officeNameClaims").doc(nameKey).get();
      return !snap.exists || snap.data().officeId === officeId();
    } catch (_) {
      return true;
    }
  }

  function rejectOfficeName(message) {
    el.officeName.setCustomValidity(message);
    el.officeName.reportValidity();
    setNote(el.note, message, "error");
    toast(message);
  }

  async function onSave(event) {
    event.preventDefault();

    const nameError = identity.validateOfficeName(el.officeName.value, {
      allowShortName: isPlatformAdmin()
    });
    if (nameError) {
      rejectOfficeName(nameError);
      return;
    }
    el.officeName.setCustomValidity("");

    const phoneError = identity.validateMobile(el.phone.value);
    if (phoneError) {
      setNote(el.note, phoneError, "error");
      toast(phoneError);
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
      logoUrl: current.logoUrl,
      coverUrl: current.coverUrl,
      shareCoverUrl: current.shareCoverUrl,
      publicSlug: current.publicSlug || identity.buildPublicSlug(el.officeName.value, officeId())
    });

    if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
      const message = "أكمل بيانات المكتب المطلوبة";
      setNote(el.note, message, "error");
      toast(message);
      return;
    }

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";
    setNote(el.note, "جارٍ حفظ بيانات المكتب...");

    const runtime = officeRuntime();
    const user = authUser();
    let synced = false;

    if (runtime && runtime.db && user) {
      try {
        if (!(await officeNameAvailable(data.officeNameKey))) throw new Error("OFFICE_NAME_TAKEN");
        await reserveOfficeName(runtime, user, data);
        synced = true;
      } catch (error) {
        console.warn("[iaqar] office settings sync failed", error);
        if (error && error.message === "OFFICE_NAME_TAKEN") {
          rejectOfficeName("اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر");
          el.save.disabled = false;
          el.save.textContent = "حفظ التعديلات";
          return;
        }
      }
    }

    if (!synced) {
      setNote(el.note, "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.", "error");
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

    apply(data);
    saveLocal(data);
    setNote(el.note, "تم حفظ البيانات ومزامنتها مع Firestore.", "success");
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

  /* -------------------------------------------------------------------- رابط المكتب */

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.link.value);
      setNote(el.linkNote, "تم نسخ رابط المكتب.", "success");
      toast("تم نسخ رابط المكتب");
    } catch (_) {
      try {
        el.link.select();
        document.execCommand("copy");
        setNote(el.linkNote, "تم نسخ رابط المكتب.", "success");
        toast("تم نسخ رابط المكتب");
      } catch (__) {
        setNote(el.linkNote, "تعذّر النسخ؛ انسخ الرابط يدويًا.", "error");
      }
    }
  }

  async function shareLink() {
    const link = el.link.value;
    const text = `${current.officeName}\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: current.officeName, text: current.officeName, url: link });
        setNote(el.linkNote, "تمت مشاركة الرابط.", "success");
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    setNote(el.linkNote, "تم فتح نافذة المشاركة.");
  }

  function previewLink() {
    window.open(el.link.value, "_blank", "noopener,noreferrer");
    setNote(el.linkNote, "فُتحت معاينة الصفحة العامة في تبويب جديد.");
  }

  function qrSvgMarkup(text, size = 160) {
    if (typeof window.qrcode !== "function") return "";
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const cell = size / modules;
    let rects = "";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        rects += `<rect x="${(col * cell).toFixed(2)}" y="${(row * cell).toFixed(2)}" `
          + `width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" aria-hidden="true">`
      + `<rect width="${size}" height="${size}" fill="#ffffff"/>`
      + `<g fill="#073f35">${rects}</g></svg>`;
  }

  function renderQrCode() {
    if (!el.qrCode) return false;
    const markup = qrSvgMarkup(el.link.value);
    if (!markup) {
      el.qrCode.textContent = "";
      setNote(el.linkNote, "تعذّر إنشاء رمز QR في هذا المتصفح.", "error");
      return false;
    }
    el.qrCode.innerHTML = markup;
    return true;
  }

  function toggleQr() {
    if (!el.qrBox) return;
    const show = el.qrBox.hidden;
    if (show && !renderQrCode()) return;
    el.qrBox.hidden = !show;
    el.qrToggle.setAttribute("aria-expanded", show ? "true" : "false");
  }

  /* ------------------------------------------------------------------ بطاقة المشاركة */

  function officeMissingFields() {
    const fields = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم التواصل", current.phone],
      ["رقم واتساب", current.whatsapp],
      ["المدينة", current.city],
      ["صورة المكتب", current.shareCoverUrl || current.coverUrl]
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

    const logoSource = current.logoUrl
      || (document.querySelector(".site-logo img,.brand-logo img,.office-logo img") || {}).src;
    if (logoSource) {
      try {
        const logo = await loadImageElement(logoSource);
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

    const cover = await loadImageElement(current.shareCoverUrl || current.coverUrl);
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
    const slug = identity.buildPublicSlug(current.officeName, officeId());
    current = clean({ ...current, publicSlug: slug });
    el.link.value = officeLink();
    try {
      await persistOfficeFields({ publicSlug: slug });
      saveLocal(current);
    } catch (_) {}
    return slug;
  }

  async function shareOfficeCard() {
    const missing = officeMissingFields();
    if (missing.length) {
      setNote(el.linkNote, `أكمل بيانات المكتب أولًا: ${missing.join("، ")}`, "error");
      toast("أكمل بيانات المكتب أولًا");
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
      setNote(el.linkNote, "تم تنزيل البطاقة وفتح رسالة المشاركة.", "success");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (String(error && error.message || "").startsWith("MISSING:")) {
        setNote(el.linkNote, `أكمل بيانات المكتب أولًا: ${error.message.slice(8)}`, "error");
      } else {
        console.warn("[iaqar] office card", error);
        setNote(el.linkNote, "تعذر إنشاء بطاقة المكتب الآن.", "error");
      }
    } finally {
      el.shareCard.disabled = false;
      el.shareCard.textContent = originalText;
    }
  }

  /* ------------------------------------------------------------- تفضيلات الإشعارات */

  function buildNotificationPrefs() {
    if (!el.prefsList) return;
    el.prefsList.innerHTML = "";
    identity.NOTIFICATION_CATEGORIES.forEach(category => {
      const row = document.createElement("label");
      row.className = "pref-row";
      row.innerHTML = `<input type="checkbox" name="notificationPreference" value="${category.key}" checked>`
        + `<span>${category.label}</span>`;
      el.prefsList.appendChild(row);
    });
  }

  function notificationInputs() {
    return Array.from(document.querySelectorAll('input[name="notificationPreference"]'));
  }

  function readNotificationPrefsFromForm() {
    return notificationInputs().reduce((accumulator, input) => {
      accumulator[input.value] = input.checked;
      return accumulator;
    }, {});
  }

  function writeNotificationPrefsToForm() {
    notificationInputs().forEach(input => {
      input.checked = identity.resolveNotificationPreference(input.value, {
        brokerPreferences: brokerNotificationPrefs,
        officePreferences: officeNotificationPrefs
      });
    });
  }

  function settingsCollection() {
    const runtime = officeRuntime();
    if (!runtime || !runtime.db) return null;
    return runtime.db.collection("offices").doc(officeId()).collection("officeSettings");
  }

  async function loadOfficeSettingsDocs() {
    const collection = settingsCollection();
    const user = authUser();
    if (!collection || !user) {
      writeNotificationPrefsToForm();
      writeCooperationModeToForm();
      setNote(el.prefsNote, "سجل الدخول لمزامنة تفضيلات الإشعارات مع المكتب.");
      return;
    }
    setNote(el.prefsNote, "جارٍ تحميل تفضيلات الإشعارات...");
    try {
      const [officeSnap, brokerSnap, cooperationSnap] = await Promise.all([
        collection.doc(identity.OFFICE_SETTINGS_DOCS.notifications).get(),
        collection.doc(identity.brokerSettingsDocId(user.uid)).get(),
        collection.doc(identity.OFFICE_SETTINGS_DOCS.cooperation).get()
      ]);
      officeNotificationPrefs = officeSnap.exists
        ? identity.sanitizeNotificationPreferences(officeSnap.data())
        : null;
      brokerNotificationPrefs = brokerSnap.exists
        ? identity.sanitizeNotificationPreferences(brokerSnap.data())
        : null;
      cooperationMode = cooperationSnap.exists
        ? identity.sanitizeCooperationMode((cooperationSnap.data() || {}).mode)
        : identity.DEFAULT_COOPERATION_MODE;
      writeNotificationPrefsToForm();
      writeCooperationModeToForm();
      setNote(el.prefsNote, officeSnap.exists
        ? "التفضيلات محفوظة لهذا المكتب."
        : "لم تُحفظ تفضيلات بعد؛ كل الإشعارات مفعّلة افتراضيًا.");
      setNote(el.cooperationNote, cooperationSnap.exists
        ? "وضع التعاون محفوظ لهذا المكتب."
        : "الوضع الافتراضي: التعاون بموافقة الوسيط لكل طلب.");
    } catch (error) {
      console.warn("[iaqar] office settings docs", error);
      writeNotificationPrefsToForm();
      writeCooperationModeToForm();
      setNote(el.prefsNote, "تعذّر تحميل التفضيلات؛ يُعرض الوضع الافتراضي.", "error");
    }
  }

  function isPermissionDenied(error) {
    const code = String((error && (error.code || error.message)) || "");
    return code.includes("permission-denied");
  }

  async function saveNotificationPrefs() {
    const collection = settingsCollection();
    const user = authUser();
    const preferences = identity.sanitizeNotificationPreferences(readNotificationPrefsFromForm());
    if (!collection || !user) {
      setNote(el.prefsNote, "سجل دخول المكتب لحفظ تفضيلات الإشعارات.", "error");
      return;
    }
    el.savePrefs.disabled = true;
    setNote(el.prefsNote, "جارٍ حفظ التفضيلات...");
    const now = window.firebase.firestore.FieldValue.serverTimestamp();
    try {
      await collection.doc(identity.OFFICE_SETTINGS_DOCS.notifications).set({
        ...preferences,
        officeId: officeId(),
        scope: "office",
        updatedAt: now,
        updatedBy: user.uid
      }, { merge: true });
      officeNotificationPrefs = preferences;
      brokerNotificationPrefs = null;
      setNote(el.prefsNote, "تم حفظ تفضيلات إشعارات المكتب.", "success");
    } catch (error) {
      if (!isPermissionDenied(error)) {
        console.warn("[iaqar] notification preferences", error);
        setNote(el.prefsNote, "تعذّر حفظ التفضيلات الآن.", "error");
        el.savePrefs.disabled = false;
        return;
      }
      try {
        await collection.doc(identity.brokerSettingsDocId(user.uid)).set({
          ...preferences,
          officeId: officeId(),
          scope: "broker",
          brokerId: user.uid,
          updatedAt: now,
          updatedBy: user.uid
        }, { merge: true });
        brokerNotificationPrefs = preferences;
        setNote(el.prefsNote, "تم حفظ التفضيلات لحسابك داخل هذا المكتب.", "success");
      } catch (brokerError) {
        console.warn("[iaqar] broker notification preferences", brokerError);
        setNote(el.prefsNote, "غير مصرح لك بحفظ تفضيلات الإشعارات.", "error");
      }
    } finally {
      el.savePrefs.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ التعاون الذكي */

  function buildCooperationModes() {
    if (!el.cooperationList) return;
    el.cooperationList.innerHTML = "";
    identity.COOPERATION_MODES.forEach(mode => {
      const row = document.createElement("label");
      row.className = "pref-row";
      row.innerHTML = `<input type="radio" name="cooperationMode" value="${mode.key}"`
        + `${mode.key === identity.DEFAULT_COOPERATION_MODE ? " checked" : ""}>`
        + `<span>${mode.label}</span>`;
      el.cooperationList.appendChild(row);
    });
  }

  function cooperationInputs() {
    return Array.from(document.querySelectorAll('input[name="cooperationMode"]'));
  }

  function readCooperationModeFromForm() {
    const selected = cooperationInputs().find(input => input.checked);
    return identity.sanitizeCooperationMode(selected ? selected.value : "");
  }

  function writeCooperationModeToForm() {
    const mode = identity.sanitizeCooperationMode(cooperationMode);
    cooperationInputs().forEach(input => {
      input.checked = input.value === mode;
    });
  }

  async function saveCooperationMode() {
    const collection = settingsCollection();
    const user = authUser();
    const mode = readCooperationModeFromForm();
    if (!collection || !user) {
      setNote(el.cooperationNote, "سجل دخول المكتب لحفظ وضع التعاون.", "error");
      return;
    }
    el.saveCooperation.disabled = true;
    setNote(el.cooperationNote, "جارٍ حفظ وضع التعاون...");
    try {
      await collection.doc(identity.OFFICE_SETTINGS_DOCS.cooperation).set({
        officeId: officeId(),
        mode,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });
      cooperationMode = mode;
      setNote(el.cooperationNote, `تم الحفظ: ${identity.cooperationModeLabel(mode)}.`, "success");
    } catch (error) {
      console.warn("[iaqar] cooperation mode", error);
      setNote(
        el.cooperationNote,
        isPermissionDenied(error)
          ? "يلزم حساب مدير المكتب لتغيير وضع التعاون."
          : "تعذّر حفظ وضع التعاون الآن.",
        "error"
      );
    } finally {
      el.saveCooperation.disabled = false;
    }
  }

  /* --------------------------------------------------------------------- بنك الفرص */

  function openOpportunityBank() {
    setNote(
      el.bankNote,
      "بنك الفرص خاص بهذا المكتب ويُفتح من هنا فقط. شاشة البنك تصل في المرحلة الثالثة المعتمدة، "
      + "ولا تُعرض أي فرص تجريبية قبل ذلك."
    );
    window.dispatchEvent(new CustomEvent("iaqar:open-opportunity-bank", {
      detail: { officeId: officeId() }
    }));
  }

  /* ----------------------------------------------------------- لوحة الإعدادات نفسها */

  function openSettings(trigger) {
    if (!el.overlay) return;
    lastSettingsTrigger = trigger || null;
    el.overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (el.closeBtn && typeof el.closeBtn.focus === "function") el.closeBtn.focus();
    window.dispatchEvent(new CustomEvent("iaqar:office-settings-opened", {
      detail: { officeId: officeId() }
    }));
  }

  function closeSettings() {
    if (!el.overlay) return;
    el.overlay.hidden = true;
    document.body.style.overflow = "";
    if (lastSettingsTrigger && typeof lastSettingsTrigger.focus === "function") {
      lastSettingsTrigger.focus();
    }
    window.dispatchEvent(new CustomEvent("iaqar:office-settings-closed"));
  }

  function bindSettingsSheet() {
    el.overlay = document.getElementById("officeSettings");
    el.closeBtn = document.getElementById("officeSettingsClose");
    el.logoTrigger = document.getElementById("officeSettingsBtn");
    el.coverTrigger = document.getElementById("officeCoverBtn");
    if (!el.overlay) return;

    [el.logoTrigger, el.coverTrigger].forEach(trigger => {
      if (!trigger) return;
      trigger.addEventListener("click", () => openSettings(trigger));
    });
    if (el.closeBtn) el.closeBtn.addEventListener("click", closeSettings);
    el.overlay.addEventListener("click", event => {
      if (event.target === el.overlay) closeSettings();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !el.overlay.hidden) closeSettings();
    });
  }

  async function updateAuthState(user) {
    authClaims = {};
    if (el.logout) el.logout.disabled = !user;
    if (!user) {
      setNote(el.note, "البيانات محفوظة على هذا الجهاز. سجل دخول مدير المكتب للمزامنة مع Firestore.");
      officeNotificationPrefs = null;
      brokerNotificationPrefs = null;
      cooperationMode = identity.DEFAULT_COOPERATION_MODE;
      writeNotificationPrefsToForm();
      writeCooperationModeToForm();
      return;
    }

    try {
      const token = await user.getIdTokenResult();
      authClaims = token.claims || {};
    } catch (_) {}

    await loadFirestore();
    await loadOfficeSettingsDocs();
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
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qrToggle = document.getElementById("toggleOfficeQrBtn");
    el.qrBox = document.getElementById("officeQrBox");
    el.qrCode = document.getElementById("officeQrCode");
    el.linkNote = document.getElementById("officeLinkNote");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.identitySlots = document.getElementById("identitySlots");
    el.prefsList = document.getElementById("notificationPrefsList");
    el.savePrefs = document.getElementById("saveNotificationPrefsBtn");
    el.prefsNote = document.getElementById("notificationPrefsNote");
    el.cooperationList = document.getElementById("cooperationModeList");
    el.saveCooperation = document.getElementById("saveCooperationModeBtn");
    el.cooperationNote = document.getElementById("cooperationModeNote");
    el.bankEntry = document.getElementById("opportunityBankEntry");
    el.bankNote = document.getElementById("opportunityBankNote");
    el.cardCoverImage = document.getElementById("officeCoverImage");
    el.cardCoverEmpty = document.getElementById("officeCoverEmpty");
    el.cardLogoImage = document.querySelector("#officeSettingsBtn img");

    bindSettingsSheet();
    buildIdentitySlots();
    buildNotificationPrefs();
    buildCooperationModes();

    apply(loadLocal() || defaults);
    writeNotificationPrefsToForm();
    writeCooperationModeToForm();

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    if (el.copy) el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewLink);
    if (el.qrToggle) el.qrToggle.addEventListener("click", toggleQr);
    if (el.logout) el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.savePrefs) el.savePrefs.addEventListener("click", saveNotificationPrefs);
    if (el.saveCooperation) el.saveCooperation.addEventListener("click", saveCooperationMode);
    if (el.bankEntry) el.bankEntry.addEventListener("click", openOpportunityBank);

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
