(() => {
  "use strict";

  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const NOTIFICATION_KEYS = Object.freeze([
    "matches",
    "participants",
    "cooperation",
    "messages",
    "appointmentsFollowUps",
    "systemImportant"
  ]);
  const COOPERATION_MODES = Object.freeze(["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"]);
  const configuredCoverRatio = Number(window.IAQAR_DESIGN_SETTINGS && window.IAQAR_DESIGN_SETTINGS.officeWideCoverRatio);
  const DESIGN_SETTINGS = Object.freeze({
    logo: Object.freeze({ kind: "logo", ratio: 1, outputWidth: 512 }),
    display: Object.freeze({ kind: "display", ratio: 4 / 3, outputWidth: 1200 }),
    whatsappCover: Object.freeze({
      kind: "whatsapp-cover",
      ratio: Number.isFinite(configuredCoverRatio) && configuredCoverRatio > 1 ? configuredCoverRatio : 16 / 9,
      outputWidth: 1600
    })
  });
  const DEFAULT_PREFERENCES = Object.freeze(Object.fromEntries(NOTIFICATION_KEYS.map(key => [key, true])));
  const defaults = Object.freeze({
    officeName: "",
    brokerName: "",
    phone: "",
    licenseNumber: "",
    city: "",
    specialties: [],
    logoUrl: "",
    displayImageUrl: "",
    whatsappCoverUrl: "",
    publicSlug: "",
    notificationPreferences: DEFAULT_PREFERENCES,
    cooperationMode: "APPROVAL_REQUIRED"
  });

  const el = {};
  const images = {};
  let current = { ...defaults };
  let defaultLogoSrc = "";

  function officeRuntime() {
    return window.IAQAR && window.IAQAR.office ? window.IAQAR.office : null;
  }

  function officeId() {
    return (officeRuntime() && officeRuntime().officeId) || "platform";
  }

  function authUser() {
    try {
      return window.firebase && firebase.auth ? firebase.auth().currentUser : null;
    } catch (_) {
      return null;
    }
  }

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function toast(message) {
    const node = document.getElementById("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
  }

  function setState(state, message) {
    if (!el.note) return;
    el.note.dataset.state = state;
    el.note.textContent = message;
  }

  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ـ/g, "")
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      .replace(/[\s._-]+/g, "")
      .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  function visibleCharacterCount(value) {
    const matches = normalizeOfficeNameKey(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function validateOfficeName(value) {
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!/^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name)) {
      return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    }
    if (visibleCharacterCount(name) < 4) return "اسم المكتب يجب أن يكون 4 أحرف ظاهرة على الأقل";
    return "";
  }

  function normalizePreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(NOTIFICATION_KEYS.map(key => [key, source[key] !== false]));
  }

  function clean(data) {
    const source = data || {};
    return {
      officeName: safeText(source.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(source.officeName).slice(0, 100),
      brokerName: safeText(source.brokerName).slice(0, 80),
      phone: safeText(source.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(source.licenseNumber).replace(/\D/g, "").slice(0, 20),
      city: safeText(source.city).slice(0, 60),
      specialties: Array.isArray(source.specialties)
        ? [...new Set(source.specialties.filter(key => SPECIALTY_LABELS[key]))].slice(0, 4)
        : [],
      logoUrl: safeText(source.logoUrl).slice(0, 2000),
      displayImageUrl: safeText(source.displayImageUrl || source.coverUrl).slice(0, 2000),
      whatsappCoverUrl: safeText(source.whatsappCoverUrl).slice(0, 2000),
      publicSlug: safeText(source.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      notificationPreferences: normalizePreferences(source.notificationPreferences),
      cooperationMode: COOPERATION_MODES.includes(source.cooperationMode) ? source.cooperationMode : "APPROVAL_REQUIRED"
    };
  }

  function storageKey() {
    return `iaqar.officeProfile.${officeId()}`;
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
    return (Array.isArray(list) ? list : []).map(key => SPECIALTY_LABELS[key]).filter(Boolean).join(" • ");
  }

  function imageDefinition(key) {
    return {
      logo: {
        design: DESIGN_SETTINGS.logo,
        inputId: "officeLogoInput",
        previewId: "officeLogoPreview",
        emptyId: "officeLogoEmpty",
        controlsId: "officeLogoCropControls",
        xId: "officeLogoCropX",
        yId: "officeLogoCropY",
        zoomId: "officeLogoZoom",
        removeId: "removeOfficeLogoBtn",
        statusId: "officeLogoStatus",
        profileField: "logoUrl"
      },
      display: {
        design: DESIGN_SETTINGS.display,
        inputId: "officeDisplayImageInput",
        previewId: "officeDisplayImagePreview",
        emptyId: "officeDisplayImageEmpty",
        controlsId: "officeDisplayImageCropControls",
        xId: "officeDisplayImageCropX",
        yId: "officeDisplayImageCropY",
        zoomId: "officeDisplayImageZoom",
        removeId: "removeOfficeDisplayImageBtn",
        statusId: "officeDisplayImageStatus",
        profileField: "displayImageUrl"
      },
      whatsappCover: {
        design: DESIGN_SETTINGS.whatsappCover,
        inputId: "officeWhatsappCoverInput",
        previewId: "officeWhatsappCoverPreview",
        emptyId: "officeWhatsappCoverEmpty",
        controlsId: "officeWhatsappCoverCropControls",
        xId: "officeWhatsappCoverCropX",
        yId: "officeWhatsappCoverCropY",
        zoomId: "officeWhatsappCoverZoom",
        removeId: "removeOfficeWhatsappCoverBtn",
        statusId: "officeWhatsappCoverStatus",
        profileField: "whatsappCoverUrl"
      }
    }[key];
  }

  function revokePreview(state) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
  }

  function renderImageState(state) {
    const source = state.objectUrl || (state.removed ? "" : state.url);
    state.preview.src = source;
    state.preview.hidden = !source;
    state.empty.hidden = Boolean(source);
    state.controls.hidden = !state.file;
    state.remove.disabled = !source;
    state.preview.style.objectPosition = `${state.x.value}% ${state.y.value}%`;
    state.preview.style.transformOrigin = `${state.x.value}% ${state.y.value}%`;
    state.preview.style.transform = `scale(${Number(state.zoom.value) / 100})`;
  }

  function setImageUrl(key, url) {
    const state = images[key];
    if (!state) return;
    revokePreview(state);
    state.file = null;
    state.url = safeText(url);
    state.removed = false;
    state.input.value = "";
    state.x.value = "50";
    state.y.value = "50";
    state.zoom.value = "100";
    renderImageState(state);
  }

  function selectImage(state) {
    const file = state.input.files && state.input.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
      state.input.value = "";
      state.status.textContent = "اختر JPG أو PNG أو WebP حتى 10 ميجابايت";
      toast(state.status.textContent);
      return;
    }
    revokePreview(state);
    state.file = file;
    state.removed = false;
    state.objectUrl = URL.createObjectURL(file);
    state.status.textContent = "حرّك موضع القص والتكبير ثم احفظ";
    renderImageState(state);
  }

  function removeImage(state) {
    revokePreview(state);
    state.file = null;
    state.removed = true;
    state.input.value = "";
    state.status.textContent = "ستُزال الصورة عند الحفظ";
    renderImageState(state);
  }

  function setupImages() {
    for (const key of ["logo", "display", "whatsappCover"]) {
      const definition = imageDefinition(key);
      const state = {
        key,
        ...definition,
        input: document.getElementById(definition.inputId),
        preview: document.getElementById(definition.previewId),
        empty: document.getElementById(definition.emptyId),
        controls: document.getElementById(definition.controlsId),
        x: document.getElementById(definition.xId),
        y: document.getElementById(definition.yId),
        zoom: document.getElementById(definition.zoomId),
        remove: document.getElementById(definition.removeId),
        status: document.getElementById(definition.statusId),
        file: null,
        url: "",
        objectUrl: "",
        removed: false
      };
      images[key] = state;
      state.input.addEventListener("change", () => selectImage(state));
      state.remove.addEventListener("click", () => removeImage(state));
      [state.x, state.y, state.zoom].forEach(control => control.addEventListener("input", () => renderImageState(state)));
    }
    document.documentElement.style.setProperty("--office-cover-ratio", String(DESIGN_SETTINGS.whatsappCover.ratio));
  }

  function renderQr(link) {
    const canvas = el.qr;
    if (!canvas || typeof window.qrcode !== "function") return;
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    const ctx = canvas.getContext("2d");
    const modules = qr.getModuleCount();
    const padding = 12;
    const size = canvas.width - padding * 2;
    const cell = size / modules;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const x = padding + Math.floor(col * cell);
        const y = padding + Math.floor(row * cell);
        const nextX = padding + Math.ceil((col + 1) * cell);
        const nextY = padding + Math.ceil((row + 1) * cell);
        ctx.fillRect(x, y, nextX - x, nextY - y);
      }
    }
  }

  function apply(data) {
    current = clean({ ...defaults, ...(data || {}) });
    el.officeName.value = current.officeName;
    el.brokerName.value = current.brokerName;
    el.phone.value = current.phone;
    el.license.value = current.licenseNumber;
    el.city.value = current.city;
    el.link.value = officeLink();
    el.preferences.forEach(input => { input.checked = current.notificationPreferences[input.value] !== false; });
    el.cooperationModes.forEach(input => { input.checked = input.value === current.cooperationMode; });
    setImageUrl("logo", current.logoUrl);
    setImageUrl("display", current.displayImageUrl);
    setImageUrl("whatsappCover", current.whatsappCoverUrl);

    const displayValues = {
      officeDisplayName: current.officeName || "مكتب عقاري",
      officeDisplayBroker: current.brokerName || "وسيط عقاري",
      officeDisplayLicense: current.licenseNumber,
      officeDisplayCity: current.city || "—",
      officeDisplaySpecialties: specialtyText(current.specialties)
    };
    Object.entries(displayValues).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    });
    const specialtyRow = document.querySelector(".specialty-status-row");
    if (specialtyRow) specialtyRow.hidden = !current.specialties.length;

    const logo = document.querySelector("#officeSettingsBtn img");
    if (logo) logo.src = current.logoUrl || defaultLogoSrc;
    const cover = document.getElementById("officeDisplayCover");
    const coverEmpty = document.getElementById("officeDisplayCoverEmpty");
    if (cover && coverEmpty) {
      cover.src = current.displayImageUrl || "";
      cover.hidden = !current.displayImageUrl;
      coverEmpty.hidden = Boolean(current.displayImageUrl);
    }
    renderQr(el.link.value);
  }

  async function loadFirestore() {
    const runtime = officeRuntime();
    const user = authUser();
    if (!runtime || !runtime.db || !user) return false;
    setState("loading", "جارٍ تحميل إعدادات المكتب…");
    try {
      const snapshot = await runtime.db.collection("offices").doc(officeId()).get();
      if (!snapshot.exists) throw new Error("OFFICE_NOT_FOUND");
      apply(snapshot.data() || {});
      saveLocal(current);
      setState("success", "تم تحميل الإعدادات المتزامنة لهذا المكتب.");
      return true;
    } catch (error) {
      console.warn("[iaqar] office settings load failed", error);
      const cached = loadLocal();
      if (cached) {
        apply(cached);
        setState("error", "تعذر التحديث من الخادم؛ تُعرض آخر نسخة محفوظة على هذا الجهاز.");
      } else {
        setState("error", "تعذر تحميل إعدادات المكتب. تحقق من الاتصال والصلاحية.");
      }
      return false;
    }
  }

  function readPreferences() {
    return Object.fromEntries(Array.from(el.preferences).map(input => [input.value, input.checked]));
  }

  function formProfile(imageUrls) {
    return clean({
      officeName: el.officeName.value,
      brokerName: el.brokerName.value,
      phone: el.phone.value,
      licenseNumber: el.license.value,
      city: el.city.value,
      specialties: current.specialties,
      logoUrl: imageUrls.logoUrl,
      displayImageUrl: imageUrls.displayImageUrl,
      whatsappCoverUrl: imageUrls.whatsappCoverUrl,
      publicSlug: current.publicSlug,
      notificationPreferences: readPreferences(),
      cooperationMode: Array.from(el.cooperationModes).find(input => input.checked)?.value || "APPROVAL_REQUIRED"
    });
  }

  async function saveProfileRemote(profile, idToken) {
    const response = await fetch(`${WORKER_BASE}/office/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({ ...profile, officeId: officeId() })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.profile) {
      const error = new Error(result.message || "تعذر حفظ إعدادات المكتب");
      error.code = result.error || "";
      throw error;
    }
    return clean(result.profile);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  async function cropImage(state) {
    const image = await loadImage(state.objectUrl);
    const ratio = state.design.ratio;
    const zoom = Math.max(1, Number(state.zoom.value) / 100);
    let sourceWidth = Math.min(image.naturalWidth, image.naturalHeight * ratio);
    let sourceHeight = sourceWidth / ratio;
    sourceWidth /= zoom;
    sourceHeight /= zoom;
    const sourceX = (image.naturalWidth - sourceWidth) * (Number(state.x.value) / 100);
    const sourceY = (image.naturalHeight - sourceHeight) * (Number(state.y.value) / 100);
    const canvas = document.createElement("canvas");
    canvas.width = state.design.outputWidth;
    canvas.height = Math.round(state.design.outputWidth / ratio);
    canvas.getContext("2d").drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("IMAGE_CROP_FAILED")), "image/webp", 0.9);
    });
  }

  async function uploadImage(state, idToken) {
    state.status.textContent = "جارٍ القص والرفع…";
    const blob = await cropImage(state);
    const response = await fetch(`${WORKER_BASE}/media/office-image`, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "image/webp",
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Office-Image-Kind": state.design.kind
      },
      body: blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.imageUrl) throw new Error(result.message || "تعذر رفع صورة الهوية");
    state.status.textContent = "اكتمل الرفع";
    return result.imageUrl;
  }

  async function deleteImage(state, idToken) {
    const response = await fetch(`${WORKER_BASE}/media/office-image`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Office-Image-Kind": state.design.kind
      }
    });
    if (!response.ok) throw new Error("تعذر حذف ملف الصورة من التخزين");
  }

  async function onSave(event) {
    event.preventDefault();
    const nameError = validateOfficeName(el.officeName.value);
    el.officeName.setCustomValidity(nameError);
    if (nameError) {
      el.officeName.reportValidity();
      toast(nameError);
      return;
    }
    if (!el.form.reportValidity()) return;
    if (safeText(el.phone.value).replace(/\D/g, "").length < 9) {
      toast("اكتب رقم جوال صحيحًا");
      el.phone.focus();
      return;
    }
    const user = authUser();
    if (!user) {
      setState("error", "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.");
      toast("سجل دخول مدير المكتب قبل الحفظ");
      return;
    }

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ…";
    setState("loading", "جارٍ التحقق من الاسم وحفظ البيانات…");
    try {
      const idToken = await user.getIdToken();
      const imageUrls = {
        logoUrl: images.logo.removed ? "" : current.logoUrl,
        displayImageUrl: images.display.removed ? "" : current.displayImageUrl,
        whatsappCoverUrl: images.whatsappCover.removed ? "" : current.whatsappCoverUrl
      };

      // تحفظ المعاملة الأولى الاسم والبيانات قبل أي رفع، فلا تُرفع ملفات عند رفض اسم مكرر.
      let saved = await saveProfileRemote(formProfile(imageUrls), idToken);
      let uploaded = false;
      for (const state of Object.values(images)) {
        if (!state.file) continue;
        imageUrls[state.profileField] = await uploadImage(state, idToken);
        uploaded = true;
      }
      if (uploaded) saved = await saveProfileRemote(formProfile(imageUrls), idToken);

      const deletionFailures = [];
      for (const state of Object.values(images)) {
        if (!state.removed || !state.url) continue;
        try {
          await deleteImage(state, idToken);
        } catch (error) {
          deletionFailures.push(error);
        }
      }

      apply(saved);
      saveLocal(current);
      if (deletionFailures.length) {
        setState("error", "حُفظت الإعدادات، لكن تعذر تنظيف ملف صورة قديم. أعد المحاولة لاحقًا.");
      } else {
        setState("success", "تم حفظ إعدادات المكتب ومزامنتها.");
      }
      toast("تم حفظ إعدادات المكتب");
    } catch (error) {
      console.warn("[iaqar] office settings save failed", error);
      if (["office_name_taken", "office_name_or_id_taken"].includes(error.code)) {
        const message = "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر";
        el.officeName.setCustomValidity(message);
        el.officeName.reportValidity();
        setState("error", message);
        toast(message);
      } else {
        setState("error", error.message || "تعذر حفظ الإعدادات. حاول مرة أخرى.");
        toast(error.message || "تعذر حفظ الإعدادات");
      }
    } finally {
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(el.link.value);
    } catch (_) {
      el.link.select();
      document.execCommand("copy");
    }
    toast("تم نسخ رابط المكتب");
  }

  async function shareLink() {
    const link = el.link.value;
    try {
      if (navigator.share) {
        await navigator.share({ title: current.officeName || "رابط المكتب", text: "رابط المكتب العقاري", url: link });
      } else {
        await copyLink();
      }
    } catch (error) {
      if (error && error.name !== "AbortError") toast("تعذرت المشاركة؛ يمكنك نسخ الرابط");
    }
  }

  function previewLink() {
    window.open(el.link.value, "_blank", "noopener,noreferrer");
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.closePath();
  }

  async function createOfficeCardBlob() {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f4f8f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const coverUrl = current.whatsappCoverUrl || current.displayImageUrl;
    if (coverUrl) {
      try {
        const cover = await loadImage(coverUrl);
        const ratio = canvas.width / 420;
        let sw = Math.min(cover.naturalWidth, cover.naturalHeight * ratio);
        let sh = sw / ratio;
        ctx.drawImage(cover, (cover.naturalWidth - sw) / 2, (cover.naturalHeight - sh) / 2, sw, sh, 0, 0, 1080, 420);
      } catch (_) {}
    } else {
      ctx.fillStyle = "#087064";
      ctx.fillRect(0, 0, 1080, 420);
    }
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, 55, 370, 970, 650, 34);
    ctx.fill();
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillStyle = "#073f35";
    ctx.font = "700 54px Tajawal,Arial,sans-serif";
    ctx.fillText(current.officeName || "مكتب عقاري", 955, 500);
    ctx.font = "600 31px Tajawal,Arial,sans-serif";
    ctx.fillStyle = "#36584f";
    ctx.fillText(`الوسيط: ${current.brokerName}`, 955, 565);
    ctx.fillText(`رخصة فال: ${current.licenseNumber}`, 955, 620);
    ctx.fillText(`المدينة: ${current.city}`, 955, 675);
    ctx.fillText(`التواصل: ${current.phone}`, 955, 730);
    const qr = window.qrcode(0, "M");
    qr.addData(officeLink());
    qr.make();
    const modules = qr.getModuleCount();
    const size = 250;
    const cell = size / modules;
    ctx.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect(100 + col * cell, 700 + row * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
    ctx.textAlign = "right";
    ctx.font = "700 24px Tajawal,Arial,sans-serif";
    ctx.fillText(officeLink().replace(/^https?:\/\//, ""), 955, 940);
    return new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
  }

  async function shareOfficeCard() {
    if (!current.officeName || !current.brokerName || !current.licenseNumber || !current.phone || !current.city) {
      toast("أكمل بيانات المكتب واحفظها أولًا");
      return;
    }
    const buttonText = el.shareCard.textContent;
    el.shareCard.disabled = true;
    el.shareCard.textContent = "جارٍ التجهيز…";
    try {
      const blob = await createOfficeCardBlob();
      if (!blob) throw new Error("CARD_FAILED");
      const file = new File([blob], `بطاقة-${current.officeName}.png`, { type: "image/png" });
      const text = `${current.officeName}\nالوسيط: ${current.brokerName}\n${officeLink()}`;
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: current.officeName, text });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast("تم تنزيل بطاقة المكتب");
      }
    } catch (error) {
      if (error && error.name !== "AbortError") toast("تعذر إنشاء بطاقة المكتب الآن");
    } finally {
      el.shareCard.disabled = false;
      el.shareCard.textContent = buttonText;
    }
  }

  async function onLogout() {
    try {
      await firebase.auth().signOut();
      toast("تم تسجيل الخروج");
    } catch (_) {
      toast("تعذر تسجيل الخروج الآن");
    }
  }

  async function updateAuthState(user) {
    el.logout.disabled = !user;
    if (!user) {
      apply(defaults);
      setState("error", "سجل دخول مدير المكتب لعرض الإعدادات ومزامنتها.");
      return;
    }
    const cached = loadLocal();
    if (cached) apply(cached);
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
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.qr = document.getElementById("officeQrCanvas");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.preferences = document.querySelectorAll('input[name="notificationPreference"]');
    el.cooperationModes = document.querySelectorAll('input[name="cooperationMode"]');
    defaultLogoSrc = document.querySelector("#officeSettingsBtn img")?.src || "";

    setupImages();
    apply(defaults);
    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    el.shareLink.addEventListener("click", shareLink);
    el.previewLink.addEventListener("click", previewLink);
    el.shareCard.addEventListener("click", shareOfficeCard);
    el.logout.addEventListener("click", onLogout);

    try {
      if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(updateAuthState);
      else updateAuthState(null);
    } catch (_) {
      updateAuthState(null);
    }
  }

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.officeSettingsTesting = Object.freeze({
    normalizeOfficeNameKey,
    validateOfficeName,
    normalizePreferences,
    wideCoverRatio: DESIGN_SETTINGS.whatsappCover.ratio
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
