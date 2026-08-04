(() => {
  "use strict";

  const core = window.IAQAROfficeProfileCore;
  if (!core) {
    console.error("[iaqar] office profile core is unavailable");
    return;
  }

  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const DESIGN = core.mediaDesignConfig(
    window.IAQAR_DESIGN_CONFIG && window.IAQAR_DESIGN_CONFIG.officeMedia
  );
  const MEDIA_FIELDS = Object.freeze({
    logo: Object.freeze({
      urlField: "logoUrl",
      inputId: "officeLogoInput",
      previewId: "officeLogoPreview",
      emptyId: "officeLogoEmpty",
      aspectRatio: DESIGN.logo.aspectRatio,
      outputWidth: DESIGN.logo.outputWidth
    }),
    displayImage: Object.freeze({
      urlField: "displayImageUrl",
      inputId: "officeDisplayImageInput",
      previewId: "officeDisplayImagePreview",
      emptyId: "officeDisplayImageEmpty",
      aspectRatio: DESIGN.displayImage.aspectRatio,
      outputWidth: DESIGN.displayImage.outputWidth
    }),
    whatsappCover: Object.freeze({
      urlField: "whatsappCoverUrl",
      inputId: "officeWhatsappCoverInput",
      previewId: "officeWhatsappCoverPreview",
      emptyId: "officeWhatsappCoverEmpty",
      aspectRatio: DESIGN.whatsappCover.aspectRatio,
      outputWidth: DESIGN.whatsappCover.outputWidth
    })
  });

  const defaults = Object.freeze({
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    logoUrl: "",
    displayImageUrl: "",
    whatsappCoverUrl: "",
    publicSlug: "",
    notificationPreferences: core.DEFAULT_NOTIFICATION_PREFERENCES,
    cooperationMode: "APPROVAL_REQUIRED"
  });

  const elements = {};
  const mediaState = Object.fromEntries(Object.keys(MEDIA_FIELDS).map(asset => [
    asset,
    { file: null, objectUrl: "", removed: false, focusX: 50, focusY: 50, zoom: 1 }
  ]));
  let current = { ...defaults };
  let authClaims = {};
  let defaultOfficeLogoUrl = "";
  let availabilityTimer = null;
  let availabilityRequest = 0;

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
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
  }

  function setStatus(message, tone = "neutral") {
    if (!elements.note) return;
    elements.note.textContent = message;
    elements.note.dataset.tone = tone;
  }

  function normalizedSpecialties(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter(item => Object.hasOwn(SPECIALTY_LABELS, item)))].slice(0, 4)
      : [];
  }

  function cleanPhone(value) {
    return core.normalizeDigits(value).replace(/[^0-9+]/g, "").slice(0, 20);
  }

  function cleanUrl(value) {
    const url = String(value || "").trim().slice(0, 2000);
    return /^https:\/\//i.test(url) ? url : "";
  }

  function clean(data) {
    const displayImageUrl = cleanUrl(data.displayImageUrl || data.coverUrl);
    return {
      officeName: core.safeText(data.officeName || defaults.officeName).slice(0, 80),
      officeNameKey: core.normalizeOfficeNameKey(data.officeName || defaults.officeName).slice(0, 100),
      brokerName: core.safeText(data.brokerName || defaults.brokerName).slice(0, 80),
      phone: cleanPhone(data.phone),
      licenseNumber: core.normalizeDigits(data.licenseNumber).replace(/\D/g, "").slice(0, 20),
      city: core.safeText(data.city || defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      logoUrl: cleanUrl(data.logoUrl),
      displayImageUrl,
      whatsappCoverUrl: cleanUrl(data.whatsappCoverUrl),
      publicSlug: String(data.publicSlug || "").toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64),
      notificationPreferences: core.normalizeNotificationPreferences(data.notificationPreferences),
      cooperationMode: core.normalizeCooperationMode(data.cooperationMode)
    };
  }

  function publicSlugBase(value) {
    const asciiName = core.safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);
    return asciiName || "maktab";
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 6);
  }

  function buildPublicSlug(name) {
    return `${publicSlugBase(name)}-${shortHash(officeId())}`.slice(0, 64);
  }

  function officeLink(profile = current) {
    if (profile.publicSlug) {
      return new URL(`/o/${encodeURIComponent(profile.publicSlug)}`, window.location.origin).toString();
    }
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("office", officeId());
    url.searchParams.set("view", "public");
    return url.toString();
  }

  function specialtyText(list) {
    return normalizedSpecialties(list).map(key => SPECIALTY_LABELS[key]).join(" • ");
  }

  function setHomeImage(image, placeholder, url, fallback = "") {
    if (!image) return;
    const source = url || fallback;
    image.src = source;
    image.hidden = !source;
    if (placeholder) placeholder.hidden = Boolean(source);
  }

  function mediaElements(asset) {
    const field = MEDIA_FIELDS[asset];
    return {
      container: document.querySelector(`[data-media-asset="${asset}"]`),
      input: document.getElementById(field.inputId),
      preview: document.getElementById(field.previewId),
      empty: document.getElementById(field.emptyId)
    };
  }

  function mediaUrl(asset) {
    const state = mediaState[asset];
    if (state.objectUrl) return state.objectUrl;
    if (state.removed) return "";
    return current[MEDIA_FIELDS[asset].urlField] || "";
  }

  function updateMediaPreview(asset) {
    const nodes = mediaElements(asset);
    const state = mediaState[asset];
    const url = mediaUrl(asset);
    if (nodes.preview) {
      nodes.preview.src = url;
      nodes.preview.hidden = !url;
      nodes.preview.style.objectPosition = `${state.focusX}% ${state.focusY}%`;
      nodes.preview.style.transform = state.file ? `scale(${state.zoom})` : "none";
    }
    if (nodes.empty) nodes.empty.hidden = Boolean(url);
    if (nodes.container) {
      nodes.container.dataset.state = state.file ? "selected" : url ? "saved" : "empty";
      nodes.container.querySelectorAll("[data-crop-control]").forEach(control => {
        control.disabled = !state.file;
      });
      const remove = nodes.container.querySelector('[data-media-action="remove"]');
      if (remove) remove.disabled = !url;
    }
  }

  function resetPendingMedia() {
    for (const asset of Object.keys(MEDIA_FIELDS)) {
      const state = mediaState[asset];
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      Object.assign(state, { file: null, objectUrl: "", removed: false, focusX: 50, focusY: 50, zoom: 1 });
      const nodes = mediaElements(asset);
      if (nodes.input) nodes.input.value = "";
      if (nodes.container) {
        const x = nodes.container.querySelector('[data-crop-control="focusX"]');
        const y = nodes.container.querySelector('[data-crop-control="focusY"]');
        const zoom = nodes.container.querySelector('[data-crop-control="zoom"]');
        if (x) x.value = "50";
        if (y) y.value = "50";
        if (zoom) zoom.value = "1";
      }
      updateMediaPreview(asset);
    }
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    elements.officeName.value = current.officeName;
    elements.brokerName.value = current.brokerName;
    elements.phone.value = current.phone;
    elements.license.value = current.licenseNumber;
    elements.city.value = current.city;
    elements.link.value = officeLink();

    const displayValues = [
      ["officeDisplayName", current.officeName],
      ["officeDisplayBroker", current.brokerName],
      ["officeDisplayLicense", current.licenseNumber || "—"],
      ["officeDisplayCity", current.city],
      ["officeDisplaySpecialties", specialtyText(current.specialties)]
    ];
    displayValues.forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
    const specialtyRow = document.querySelector(".specialty-status-row");
    if (specialtyRow) specialtyRow.hidden = !current.specialties.length;

    setHomeImage(
      document.getElementById("officeDisplayLogo"),
      document.getElementById("officeDisplayLogoPlaceholder"),
      current.logoUrl,
      defaultOfficeLogoUrl
    );
    setHomeImage(
      document.getElementById("officeDisplayCover"),
      document.getElementById("officeDisplayCoverPlaceholder"),
      current.displayImageUrl
    );

    document.querySelectorAll("[data-notification-preference]").forEach(input => {
      input.checked = current.notificationPreferences[input.dataset.notificationPreference] !== false;
    });
    const cooperation = document.querySelector(
      `input[name="cooperationMode"][value="${current.cooperationMode}"]`
    );
    if (cooperation) cooperation.checked = true;
    resetPendingMedia();
  }

  function loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(storageKey()) || "null");
    } catch (_) {
      return null;
    }
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
    setStatus("جارٍ تحميل إعدادات المكتب…", "loading");

    try {
      const officeRef = runtime.db.collection("offices").doc(officeId());
      const [officeSnapshot, notificationSnapshot, cooperationSnapshot] = await Promise.all([
        officeRef.get(),
        officeRef.collection("officeSettings").doc("notifications").get(),
        officeRef.collection("officeSettings").doc("cooperation").get()
      ]);
      if (officeSnapshot.exists) {
        const data = officeSnapshot.data() || {};
        const notifications = notificationSnapshot.exists ? notificationSnapshot.data() : {};
        const cooperation = cooperationSnapshot.exists ? cooperationSnapshot.data() : {};
        apply({
          officeName: data.officeName || data.name,
          brokerName: data.brokerName || data.licenseeName,
          phone: data.phone,
          licenseNumber: data.licenseNumber || data.falLicense,
          city: data.city,
          specialties: data.specialties,
          logoUrl: data.logoUrl,
          displayImageUrl: data.displayImageUrl || data.coverUrl,
          whatsappCoverUrl: data.whatsappCoverUrl,
          publicSlug: data.publicSlug,
          notificationPreferences: notifications,
          cooperationMode: cooperation.mode
        });
        saveLocal(current);
      }
      setStatus("تم تحميل إعدادات هذا المكتب.", "success");
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      setStatus("تعذر تحميل أحدث الإعدادات. تُعرض النسخة المحفوظة على هذا الجهاز.", "error");
      return false;
    }
  }

  function readNotificationPreferences() {
    const result = {};
    document.querySelectorAll("[data-notification-preference]").forEach(input => {
      result[input.dataset.notificationPreference] = input.checked;
    });
    return core.normalizeNotificationPreferences(result);
  }

  function readCooperationMode() {
    const selected = document.querySelector('input[name="cooperationMode"]:checked');
    return core.normalizeCooperationMode(selected && selected.value);
  }

  async function checkNameAvailability(showAvailable = true) {
    const requestNumber = ++availabilityRequest;
    const result = core.validateOfficeName(elements.officeName.value);
    elements.officeName.setCustomValidity(result.message);
    if (!result.valid) {
      elements.availability.textContent = result.message;
      elements.availability.dataset.state = "error";
      return false;
    }
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) {
      elements.availability.textContent = "سيتم التحقق من توفر الاسم عند الحفظ.";
      elements.availability.dataset.state = "neutral";
      return true;
    }
    elements.availability.textContent = "جارٍ التحقق من توفر الاسم…";
    elements.availability.dataset.state = "loading";
    try {
      const snapshot = await runtime.db.collection("officeNameClaims").doc(result.key).get();
      if (requestNumber !== availabilityRequest) return false;
      const unavailable = snapshot.exists && snapshot.data().officeId !== officeId();
      if (unavailable) {
        const message = "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
        elements.officeName.setCustomValidity(message);
        elements.availability.textContent = message;
        elements.availability.dataset.state = "error";
        return false;
      }
      elements.officeName.setCustomValidity("");
      elements.availability.textContent = showAvailable ? "اسم المكتب متاح." : "";
      elements.availability.dataset.state = "success";
      return true;
    } catch (error) {
      if (requestNumber !== availabilityRequest) return false;
      console.warn("[iaqar] office name availability", error);
      elements.availability.textContent = "تعذر التحقق الآن؛ سيُعاد التحقق الآمن عند الحفظ.";
      elements.availability.dataset.state = "error";
      return true;
    }
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  async function croppedMediaBlob(asset) {
    const state = mediaState[asset];
    const field = MEDIA_FIELDS[asset];
    if (!state.file || !state.objectUrl) return null;
    const image = await loadImage(state.objectUrl);
    const crop = core.calculateCropRect(
      image.naturalWidth,
      image.naturalHeight,
      field.aspectRatio,
      state.zoom,
      state.focusX,
      state.focusY
    );
    const canvas = document.createElement("canvas");
    canvas.width = field.outputWidth;
    canvas.height = Math.max(1, Math.round(field.outputWidth / field.aspectRatio));
    const context = canvas.getContext("2d");
    context.drawImage(
      image,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("IMAGE_CROP_FAILED")), "image/webp", 0.9);
    });
  }

  async function uploadMedia(asset, blob, idToken) {
    const response = await fetch(`${WORKER_BASE}/media/office-identity`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "image/webp",
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Media-Asset": asset
      },
      body: blob
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.mediaUrl) {
      throw new Error(payload.message || "تعذر رفع صورة الهوية البصرية");
    }
    return payload.mediaUrl;
  }

  async function deleteMedia(asset, idToken) {
    const response = await fetch(`${WORKER_BASE}/media/office-identity`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Media-Asset": asset
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "تعذر إزالة الصورة");
  }

  async function reserveOfficeProfile(runtime, user, data) {
    const officeRef = runtime.db.collection("offices").doc(officeId());
    const claimRef = runtime.db.collection("officeNameClaims").doc(data.officeNameKey);
    const publicRef = runtime.db.collection("publicOffices").doc(officeId());
    const notificationsRef = officeRef.collection("officeSettings").doc("notifications");
    const cooperationRef = officeRef.collection("officeSettings").doc("cooperation");
    const auditRef = officeRef.collection("auditLogs").doc();

    await runtime.db.runTransaction(async transaction => {
      const officeSnapshot = await transaction.get(officeRef);
      const claimSnapshot = await transaction.get(claimRef);
      if (claimSnapshot.exists && claimSnapshot.data().officeId !== officeId()) {
        throw new Error("OFFICE_NAME_TAKEN");
      }

      const oldKey = officeSnapshot.exists
        ? String(officeSnapshot.data().officeNameKey || "")
        : "";
      let oldClaimSnapshot = null;
      let oldClaimRef = null;
      if (oldKey && oldKey !== data.officeNameKey) {
        oldClaimRef = runtime.db.collection("officeNameClaims").doc(oldKey);
        oldClaimSnapshot = await transaction.get(oldClaimRef);
      }

      const serverTimestamp = window.firebase.firestore.FieldValue.serverTimestamp();
      transaction.set(claimRef, {
        officeId: officeId(),
        ownerUid: user.uid,
        officeName: data.officeName,
        officeNameKey: data.officeNameKey,
        updatedAt: serverTimestamp
      });
      transaction.set(officeRef, {
        officeId: officeId(),
        officeName: data.officeName,
        officeNameKey: data.officeNameKey,
        brokerName: data.brokerName,
        phone: data.phone,
        whatsapp: data.phone,
        licenseNumber: data.licenseNumber,
        city: data.city,
        logoUrl: data.logoUrl,
        displayImageUrl: data.displayImageUrl,
        coverUrl: data.displayImageUrl,
        whatsappCoverUrl: data.whatsappCoverUrl,
        publicSlug: data.publicSlug,
        updatedAt: serverTimestamp
      }, { merge: true });
      transaction.set(publicRef, {
        officeId: officeId(),
        officeName: data.officeName,
        brokerName: data.brokerName,
        phone: data.phone,
        whatsapp: data.phone,
        licenseNumber: data.licenseNumber,
        city: data.city,
        specialties: data.specialties,
        logoUrl: data.logoUrl,
        displayImageUrl: data.displayImageUrl,
        coverUrl: data.displayImageUrl,
        whatsappCoverUrl: data.whatsappCoverUrl,
        publicSlug: data.publicSlug,
        updatedAt: serverTimestamp
      }, { merge: true });
      transaction.set(notificationsRef, {
        officeId: officeId(),
        ...data.notificationPreferences,
        updatedAt: serverTimestamp,
        updatedByUid: user.uid
      }, { merge: true });
      transaction.set(cooperationRef, {
        officeId: officeId(),
        mode: data.cooperationMode,
        exposeContactsAutomatically: false,
        updatedAt: serverTimestamp,
        updatedByUid: user.uid
      }, { merge: true });
      transaction.set(auditRef, {
        officeId: officeId(),
        action: "OFFICE_SETTINGS_UPDATED",
        actorUid: user.uid,
        createdAt: serverTimestamp
      });
      if (oldClaimRef && oldClaimSnapshot && oldClaimSnapshot.exists &&
          oldClaimSnapshot.data().officeId === officeId()) {
        transaction.delete(oldClaimRef);
      }
    });
  }

  async function onSave(event) {
    event.preventDefault();
    const nameResult = core.validateOfficeName(elements.officeName.value);
    if (!nameResult.valid) {
      elements.officeName.setCustomValidity(nameResult.message);
      elements.officeName.reportValidity();
      elements.availability.textContent = nameResult.message;
      elements.availability.dataset.state = "error";
      toast(nameResult.message);
      return;
    }
    const available = await checkNameAvailability(false);
    if (!available) {
      elements.officeName.reportValidity();
      return;
    }

    const user = authUser();
    const runtime = officeRuntime();
    if (!user || !runtime || !runtime.db) {
      setStatus("لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.", "error");
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      return;
    }

    const brokerName = core.safeText(elements.brokerName.value);
    const phone = cleanPhone(elements.phone.value);
    const licenseNumber = core.normalizeDigits(elements.license.value).replace(/\D/g, "");
    const city = core.safeText(elements.city.value);
    if (!brokerName || !phone || !licenseNumber || !city) {
      toast("أكمل بيانات المكتب المطلوبة");
      return;
    }

    elements.form.setAttribute("aria-busy", "true");
    elements.save.disabled = true;
    elements.save.textContent = "جارٍ الحفظ…";
    setStatus("جارٍ تجهيز الصور وحفظ الإعدادات…", "loading");

    try {
      const idToken = await user.getIdToken();
      const mediaUrls = {
        logoUrl: current.logoUrl,
        displayImageUrl: current.displayImageUrl,
        whatsappCoverUrl: current.whatsappCoverUrl
      };
      for (const asset of Object.keys(MEDIA_FIELDS)) {
        const state = mediaState[asset];
        const field = MEDIA_FIELDS[asset];
        if (state.file) {
          const blob = await croppedMediaBlob(asset);
          mediaUrls[field.urlField] = await uploadMedia(asset, blob, idToken);
        } else if (state.removed) {
          mediaUrls[field.urlField] = "";
        }
      }

      const data = clean({
        ...current,
        officeName: nameResult.name,
        brokerName,
        phone,
        licenseNumber,
        city,
        ...mediaUrls,
        publicSlug: current.publicSlug || buildPublicSlug(nameResult.name),
        notificationPreferences: readNotificationPreferences(),
        cooperationMode: readCooperationMode()
      });
      await reserveOfficeProfile(runtime, user, data);

      const removalWarnings = [];
      for (const asset of Object.keys(MEDIA_FIELDS)) {
        if (mediaState[asset].removed && !mediaState[asset].file) {
          try {
            await deleteMedia(asset, idToken);
          } catch (error) {
            console.warn("[iaqar] office media removal", error);
            removalWarnings.push(asset);
          }
        }
      }

      apply(data);
      saveLocal(data);
      if (removalWarnings.length) {
        setStatus("حُفظت الإعدادات، وتعذر تنظيف ملف قديم من التخزين. لن يظهر في المكتب.", "error");
      } else {
        setStatus("تم حفظ إعدادات المكتب ومزامنتها.", "success");
      }
      toast("تم حفظ إعدادات المكتب");
    } catch (error) {
      console.warn("[iaqar] office settings save failed", error);
      if (error && error.message === "OFFICE_NAME_TAKEN") {
        const message = "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
        elements.officeName.setCustomValidity(message);
        elements.officeName.reportValidity();
        elements.availability.textContent = message;
        elements.availability.dataset.state = "error";
        toast(message);
      } else {
        setStatus("تعذر حفظ الإعدادات. لم تُعرض التغييرات غير المحفوظة للعامة.", "error");
        toast(error.message || "تعذر حفظ إعدادات المكتب");
      }
    } finally {
      elements.form.removeAttribute("aria-busy");
      elements.save.disabled = false;
      elements.save.textContent = "حفظ التعديلات";
    }
  }

  async function onLogout() {
    if (!authUser()) return toast("لا يوجد حساب مسجل حاليًا");
    try {
      await firebase.auth().signOut();
      toast("تم تسجيل الخروج");
    } catch (_) {
      toast("تعذر تسجيل الخروج الآن");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(elements.link.value);
    } catch (_) {
      elements.link.select();
      document.execCommand("copy");
    }
    toast("تم نسخ رابط المكتب");
  }

  async function shareLink() {
    const link = elements.link.value;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.officeName, text: `رابط ${current.officeName}`, url: link });
      } else {
        await copyLink();
      }
    } catch (error) {
      if (!error || error.name !== "AbortError") toast("تعذرت المشاركة؛ يمكنك نسخ الرابط");
    }
  }

  function drawQr(context, text, x, y, size) {
    if (typeof window.qrcode !== "function") throw new Error("QR_UNAVAILABLE");
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const modules = qr.getModuleCount();
    const cell = size / modules;
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, size, size);
    context.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (!qr.isDark(row, column)) continue;
        const left = x + Math.floor(column * cell);
        const top = y + Math.floor(row * cell);
        context.fillRect(
          left,
          top,
          x + Math.ceil((column + 1) * cell) - left,
          y + Math.ceil((row + 1) * cell) - top
        );
      }
    }
  }

  function showQr() {
    elements.qrPanel.hidden = false;
    const canvas = elements.qrCanvas;
    canvas.width = 280;
    canvas.height = 280;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    try {
      drawQr(context, elements.link.value, 10, 10, 260);
    } catch (_) {
      elements.qrPanel.hidden = true;
      toast("تعذر إنشاء رمز QR الآن");
    }
  }

  function previewPublicLink() {
    window.open(elements.link.value, "_blank", "noopener,noreferrer");
  }

  function officeMissingFields() {
    const values = [
      ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
      ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
      ["رخصة فال", current.licenseNumber],
      ["رقم الجوال", current.phone],
      ["المدينة", current.city],
      ["صورة المكتب", current.whatsappCoverUrl || current.displayImageUrl]
    ];
    return values.filter(([, valid]) => !valid).map(([label]) => label);
  }

  function roundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  }

  function drawImageCover(context, image, x, y, width, height, radius = 0) {
    const crop = core.calculateCropRect(image.naturalWidth, image.naturalHeight, width / height);
    context.save();
    if (radius) {
      roundedRect(context, x, y, width, height, radius);
      context.clip();
    }
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, width, height);
    context.restore();
  }

  function drawImageContain(context, image, x, y, width, height) {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    context.drawImage(image, x + (width - imageWidth) / 2, y + (height - imageHeight) / 2, imageWidth, imageHeight);
  }

  async function createOfficeCardBlob() {
    const missing = officeMissingFields();
    if (missing.length) throw new Error(`MISSING:${missing.join("، ")}`);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext("2d");
    const link = officeLink();

    context.fillStyle = "#f4f8f6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#087064";
    context.fillRect(0, 0, canvas.width, 190);

    const logoSource = current.logoUrl || defaultOfficeLogoUrl;
    if (logoSource) {
      try {
        const logo = await loadImage(logoSource);
        context.fillStyle = "#ffffff";
        roundedRect(context, 820, 28, 175, 132, 24);
        context.fill();
        drawImageContain(context, logo, 838, 42, 139, 104);
      } catch (_) {}
    }

    context.direction = "rtl";
    context.textAlign = "right";
    context.fillStyle = "#ffffff";
    context.font = "700 43px Tajawal, Arial, sans-serif";
    context.fillText(current.officeName, 770, 82);
    context.font = "500 25px Tajawal, Arial, sans-serif";
    context.fillStyle = "#d7ece7";
    context.fillText("بطاقة المكتب العقاري", 770, 126);

    const cover = await loadImage(current.whatsappCoverUrl || current.displayImageUrl);
    drawImageCover(context, cover, 60, 225, 960, 420, 32);
    context.fillStyle = "#ffffff";
    roundedRect(context, 60, 680, 960, 610, 34);
    context.fill();
    context.fillStyle = "#073f35";
    context.font = "700 51px Tajawal, Arial, sans-serif";
    context.fillText(current.officeName, 950, 765);
    context.font = "600 31px Tajawal, Arial, sans-serif";
    context.fillStyle = "#36584f";
    context.fillText(`الوسيط: ${current.brokerName}`, 950, 825);

    const rows = [
      ["رخصة فال", current.licenseNumber],
      ["المدينة", current.city],
      ["التواصل", current.phone]
    ];
    let rowY = 900;
    for (const [label, value] of rows) {
      context.fillStyle = "#6a7d77";
      context.font = "500 25px Tajawal, Arial, sans-serif";
      context.fillText(label, 950, rowY);
      context.fillStyle = "#073f35";
      context.font = "700 29px Tajawal, Arial, sans-serif";
      context.fillText(value, 700, rowY);
      rowY += 68;
    }
    drawQr(context, link, 105, 890, 265);
    context.textAlign = "center";
    context.fillStyle = "#073f35";
    context.font = "700 22px Tajawal, Arial, sans-serif";
    context.fillText("امسح الرمز لزيارة المكتب", 238, 1190);
    context.textAlign = "right";
    context.fillStyle = "#e87512";
    context.font = "700 25px Tajawal, Arial, sans-serif";
    context.fillText(link.replace(/^https?:\/\//, ""), 950, 1210);
    context.fillStyle = "#71817c";
    context.font = "500 20px Tajawal, Arial, sans-serif";
    context.fillText("طلبات العملاء وعروض الملاك تصل مباشرة إلى المكتب", 950, 1250);
    return new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
  }

  async function shareOfficeCard() {
    const missing = officeMissingFields();
    if (missing.length) return toast(`أكمل بيانات المكتب أولًا: ${missing.join("، ")}`);
    const original = elements.shareCard.textContent;
    elements.shareCard.disabled = true;
    elements.shareCard.textContent = "جارٍ تجهيز البطاقة…";
    try {
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
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = file.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
        toast("تم تنزيل البطاقة وفتح رسالة المشاركة");
      }
    } catch (error) {
      if (!error || error.name !== "AbortError") {
        console.warn("[iaqar] office card", error);
        toast("تعذر إنشاء بطاقة المكتب الآن");
      }
    } finally {
      elements.shareCard.disabled = false;
      elements.shareCard.textContent = original;
    }
  }

  function ensureBankShell() {
    let overlay = document.getElementById("opportunityBankShell");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "opportunityBankShell";
    overlay.className = "settings-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="settings-sheet bank-entry-sheet" role="dialog" aria-modal="true" aria-labelledby="opportunityBankTitle">
        <div class="settings-head">
          <div>
            <h2 id="opportunityBankTitle">بنك الفرص</h2>
            <p>مساحة خاصة بالمكتب الحالي ولا يمكن لزائر الرابط العام فتحها.</p>
          </div>
          <button class="settings-close" type="button" data-bank-close aria-label="إغلاق">×</button>
        </div>
        <div class="bank-entry-state">
          <strong>تم تجهيز مدخل بنك الفرص</strong>
          <p>عرض السجلات وإدارتها والمشاركة المحدودة ضمن المرحلة 3، لذلك لا تُعرض بيانات ناقصة أو تجريبية هنا.</p>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.hidden = true;
      document.body.style.overflow = "";
      elements.bank.focus();
    };
    overlay.querySelector("[data-bank-close]").addEventListener("click", close);
    overlay.addEventListener("click", event => {
      if (event.target === overlay) close();
    });
    return overlay;
  }

  function openBankEntry() {
    const overlay = ensureBankShell();
    document.getElementById("officeSettings").hidden = true;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    overlay.querySelector("[data-bank-close]").focus();
  }

  function onMediaSelected(asset, file) {
    const validation = core.validateImageFile(file);
    if (!validation.valid) {
      const nodes = mediaElements(asset);
      if (nodes.input) nodes.input.value = "";
      toast(validation.message);
      return;
    }
    const state = mediaState[asset];
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.file = file;
    state.objectUrl = URL.createObjectURL(file);
    state.removed = false;
    state.focusX = 50;
    state.focusY = 50;
    state.zoom = 1;
    updateMediaPreview(asset);
  }

  function bindMediaEditors() {
    for (const asset of Object.keys(MEDIA_FIELDS)) {
      const nodes = mediaElements(asset);
      if (!nodes.container || !nodes.input) continue;
      nodes.input.addEventListener("change", () => {
        const file = nodes.input.files && nodes.input.files[0];
        if (file) onMediaSelected(asset, file);
      });
      nodes.container.addEventListener("input", event => {
        const control = event.target.dataset.cropControl;
        if (!control || !Object.hasOwn(mediaState[asset], control)) return;
        mediaState[asset][control] = Number(event.target.value);
        updateMediaPreview(asset);
      });
      nodes.container.querySelector('[data-media-action="remove"]').addEventListener("click", () => {
        const state = mediaState[asset];
        if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
        Object.assign(state, { file: null, objectUrl: "", removed: true, focusX: 50, focusY: 50, zoom: 1 });
        nodes.input.value = "";
        updateMediaPreview(asset);
      });
    }
  }

  async function updateAuthState(user) {
    authClaims = {};
    elements.logout.disabled = !user;
    if (!user) {
      setStatus("سجل دخول مدير المكتب لتحميل الإعدادات وحفظها.", "error");
      return;
    }
    try {
      const token = await user.getIdTokenResult();
      authClaims = token.claims || {};
    } catch (_) {}
    await loadFirestore();
  }

  function init() {
    elements.form = document.getElementById("officeProfileForm");
    if (!elements.form) return;
    elements.officeName = document.getElementById("officeNameInput");
    elements.availability = document.getElementById("officeNameAvailability");
    elements.brokerName = document.getElementById("brokerNameInput");
    elements.phone = document.getElementById("officePhoneInput");
    elements.license = document.getElementById("licenseNumberInput");
    elements.city = document.getElementById("officeCityInput");
    elements.link = document.getElementById("officeLinkInput");
    elements.copy = document.getElementById("copyOfficeLinkBtn");
    elements.shareLink = document.getElementById("shareOfficeLinkBtn");
    elements.qr = document.getElementById("showOfficeQrBtn");
    elements.previewLink = document.getElementById("previewOfficeLinkBtn");
    elements.qrPanel = document.getElementById("officeQrPanel");
    elements.qrCanvas = document.getElementById("officeQrCanvas");
    elements.qrClose = document.getElementById("closeOfficeQrBtn");
    elements.save = document.getElementById("saveOfficeSettingsBtn");
    elements.logout = document.getElementById("officeLogoutBtn");
    elements.shareCard = document.getElementById("shareOfficeCardBtn");
    elements.bank = document.getElementById("opportunityBankEntry");
    elements.note = document.getElementById("officeSettingsNote");

    const logo = document.getElementById("officeDisplayLogo") ||
      document.querySelector("#officeSettingsBtn img");
    if (logo && !logo.id) logo.id = "officeDisplayLogo";
    defaultOfficeLogoUrl = logo ? logo.src : "";
    apply(loadLocal() || defaults);
    bindMediaEditors();

    elements.officeName.addEventListener("input", () => {
      elements.officeName.setCustomValidity("");
      clearTimeout(availabilityTimer);
      availabilityTimer = setTimeout(() => checkNameAvailability(true), 450);
    });
    elements.officeName.addEventListener("blur", () => checkNameAvailability(true));
    elements.form.addEventListener("submit", onSave);
    elements.copy.addEventListener("click", copyLink);
    elements.shareLink.addEventListener("click", shareLink);
    elements.qr.addEventListener("click", showQr);
    elements.qrClose.addEventListener("click", () => {
      elements.qrPanel.hidden = true;
      elements.qr.focus();
    });
    elements.previewLink.addEventListener("click", previewPublicLink);
    elements.logout.addEventListener("click", onLogout);
    elements.shareCard.addEventListener("click", shareOfficeCard);
    elements.bank.addEventListener("click", openBankEntry);

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
