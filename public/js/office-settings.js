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

  const defaults = {
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    whatsapp: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    coverUrl: "",
    publicSlug: ""
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
    const cleanList = [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
    return cleanList;
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
      whatsapp: safeText(data.whatsapp || data.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, defaults.city).slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
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
    if (el.coverPreview) {
      el.coverPreview.src = current.coverUrl || "";
      el.coverPreview.hidden = !current.coverUrl;
    }

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

    let coverUrl = current.coverUrl || "";
    const coverFile = el.cover && el.cover.files ? el.cover.files[0] : null;
    if (coverFile) {
      if (!/^image\/(jpeg|png|webp)$/.test(coverFile.type) || coverFile.size > 10 * 1024 * 1024) {
        toast("اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 10 ميجابايت");
        return;
      }
      const user = authUser();
      if (!user) {
        toast("سجل دخول مدير المكتب قبل رفع الصورة");
        return;
      }
      const idToken = await user.getIdToken();
      const response = await fetch(`${WORKER_BASE}/media/office-cover`, {
        method: "POST",
        headers: {
          "Content-Type": coverFile.type,
          "Authorization": `Bearer ${idToken}`,
          "X-Office-Id": officeId()
        },
        body: coverFile
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.coverUrl) {
        toast(result.message || "تعذر رفع صورة المكتب");
        return;
      }
      coverUrl = result.coverUrl;
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
      publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value)
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
      el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
      toast("غير مصرح لك بتعديل إعدادات المكتب");
      el.save.disabled = false;
      el.save.textContent = "حفظ التعديلات";
      return;
    }

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
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');

    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.cover) el.cover.addEventListener("change", () => {
      const file = el.cover.files && el.cover.files[0];
      if (!file || !el.coverPreview) return;
      el.coverPreview.src = URL.createObjectURL(file);
      el.coverPreview.hidden = false;
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
