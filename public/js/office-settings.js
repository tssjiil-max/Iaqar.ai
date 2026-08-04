(() => {
  "use strict";

  const Core = window.IAQAROfficeCore;
  const SPECIALTY_LABELS = Core.SPECIALTY_LABELS;
  const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

  const defaults = { ...Core.DEFAULTS, notificationPreferences: Core.defaultNotificationPreferences() };

  const el = {};
  let current = Core.cleanProfile(defaults);
  let authClaims = {};
  let pendingRemoveLogo = false;
  let pendingRemoveCover = false;

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
    return Core.safeText(value, fallback);
  }

  function validateOfficeName(value) {
    return Core.validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
  }

  function clean(data) {
    return Core.cleanProfile(data);
  }

  function officeLink() {
    if (current.publicSlug) return new URL(`/o/${encodeURIComponent(current.publicSlug)}`, window.location.origin).toString();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("office", officeId());
    url.searchParams.set("view", "public");
    return url.toString();
  }

  function specialtyText(list) {
    return Core.normalizedSpecialties(list).map(key => SPECIALTY_LABELS[key]).join(" • ");
  }

  function readSpecialtiesFromForm() {
    return Array.from(el.specialties || [])
      .filter(input => input.checked)
      .map(input => input.value);
  }

  function writeSpecialtiesToForm(list) {
    const selected = new Set(Core.normalizedSpecialties(list));
    Array.from(el.specialties || []).forEach(input => {
      input.checked = selected.has(input.value);
    });
  }

  function readNotificationPreferencesFromForm() {
    const prefs = {};
    Array.from(el.notifInputs || []).forEach(input => {
      prefs[input.value] = input.checked;
    });
    return Core.normalizeNotificationPreferences(prefs);
  }

  function writeNotificationPreferencesToForm(prefs) {
    const normalized = Core.normalizeNotificationPreferences(prefs);
    Array.from(el.notifInputs || []).forEach(input => {
      input.checked = normalized[input.value] !== false;
    });
  }

  function updateCardLogo() {
    const logoImg = document.querySelector(".office-logo img");
    if (logoImg && current.logoUrl) logoImg.src = current.logoUrl;
  }

  function updateCardCover() {
    if (el.cardCover) {
      el.cardCover.src = current.coverUrl || "";
      el.cardCover.hidden = !current.coverUrl;
    }
    if (el.cardCoverEmpty) el.cardCoverEmpty.hidden = !!current.coverUrl;
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
    writeNotificationPreferencesToForm(current.notificationPreferences);
    if (el.cooperation) el.cooperation.value = Core.normalizeCooperationMode(current.cooperationMode);

    if (el.coverPreview) {
      el.coverPreview.src = current.coverUrl || "";
      el.coverPreview.hidden = !current.coverUrl;
    }
    if (el.removeCover) el.removeCover.hidden = !current.coverUrl;
    if (el.logoPreview) {
      el.logoPreview.src = current.logoUrl || "";
      el.logoPreview.hidden = !current.logoUrl;
    }
    if (el.removeLogo) el.removeLogo.hidden = !current.logoUrl;

    updateCardLogo();
    updateCardCover();
    renderLinkQr();

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
          logoUrl: data.logoUrl,
          coverUrl: data.coverUrl,
          publicSlug: data.publicSlug,
          cooperationMode: data.cooperationMode,
          notificationPreferences: data.notificationPreferences
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

      // publicOffices is world-readable: expose only non-sensitive fields.
      // Notification preferences and cooperation mode stay private on the office doc.
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
        publicSlug: data.publicSlug,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
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

  function validateImageFile(file, maxBytes) {
    if (!file) return "لم يتم اختيار ملف";
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return "اختر صورة JPG أو PNG أو WebP";
    if (file.size > maxBytes) return `حجم الصورة يتجاوز ${Math.round(maxBytes / (1024 * 1024))} ميجابايت`;
    return "";
  }

  // Deterministic center-crop to the configured WhatsApp-style cover ratio.
  async function cropCoverFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url);
      const rect = Core.coverCropRect(image.naturalWidth, image.naturalHeight, Core.COVER_ASPECT);
      const out = Core.coverOutputSize(1200, Core.COVER_ASPECT);
      const canvas = document.createElement("canvas");
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, out.width, out.height);
      return await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function uploadMedia(path, headerContentType, body) {
    const user = authUser();
    if (!user) throw new Error("سجل دخول مدير المكتب قبل رفع الصورة");
    const idToken = await user.getIdToken();
    const response = await fetch(`${WORKER_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": headerContentType,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId()
      },
      body
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر رفع الصورة");
    return result;
  }

  function renderLinkQr() {
    if (!el.qr) return;
    const text = officeLink();
    try {
      if (typeof window.qrcode !== "function") throw new Error("QR_UNAVAILABLE");
      const qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const modules = qr.getModuleCount();
      const size = 148;
      const cell = size / modules;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
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
      el.qr.textContent = "";
      el.qr.appendChild(canvas);
    } catch (_) {
      el.qr.textContent = "تعذر إنشاء رمز QR";
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
    const notificationPreferences = readNotificationPreferencesFromForm();
    const cooperationMode = Core.normalizeCooperationMode(el.cooperation ? el.cooperation.value : current.cooperationMode);

    el.save.disabled = true;
    el.save.textContent = "جارٍ الحفظ...";

    try {
      let logoUrl = current.logoUrl || "";
      let coverUrl = current.coverUrl || "";

      const logoFile = el.logo && el.logo.files ? el.logo.files[0] : null;
      if (logoFile) {
        const logoError = validateImageFile(logoFile, 5 * 1024 * 1024);
        if (logoError) { toast(logoError); return; }
        const result = await uploadMedia("/media/office-logo", logoFile.type, logoFile);
        if (!result.logoUrl) { toast("تعذر رفع شعار المكتب"); return; }
        logoUrl = result.logoUrl;
      } else if (pendingRemoveLogo) {
        logoUrl = "";
      }

      const coverFile = el.cover && el.cover.files ? el.cover.files[0] : null;
      if (coverFile) {
        const coverError = validateImageFile(coverFile, 10 * 1024 * 1024);
        if (coverError) { toast(coverError); return; }
        const cropped = await cropCoverFile(coverFile);
        const blob = cropped || coverFile;
        const result = await uploadMedia("/media/office-cover", blob.type || "image/jpeg", blob);
        if (!result.coverUrl) { toast("تعذر رفع صورة المكتب"); return; }
        coverUrl = result.coverUrl;
      } else if (pendingRemoveCover) {
        coverUrl = "";
      }

      const data = clean({
        officeName: el.officeName.value,
        brokerName: el.brokerName.value,
        phone: el.phone.value,
        whatsapp: el.whatsapp.value,
        licenseNumber: el.license.value,
        city: el.city.value,
        specialties,
        logoUrl,
        coverUrl,
        publicSlug: current.publicSlug || Core.buildPublicSlug(el.officeName.value, officeId()),
        cooperationMode,
        notificationPreferences
      });

      if (!data.officeName || !data.brokerName || !data.licenseNumber || !data.city) {
        toast("أكمل بيانات المكتب المطلوبة");
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
            return;
          }
        }
      }

      if (!synced) {
        el.note.textContent = "لم يتم الحفظ: يلزم حساب مدير مخوّل لهذا المكتب.";
        toast("غير مصرح لك بتعديل إعدادات المكتب");
        return;
      }

      pendingRemoveLogo = false;
      pendingRemoveCover = false;
      if (el.logo) el.logo.value = "";
      if (el.cover) el.cover.value = "";
      apply(data);
      saveLocal(data);
      el.note.textContent = "تم حفظ البيانات ومزامنتها مع Firestore.";
      toast("تم حفظ إعدادات المكتب");
    } catch (error) {
      console.warn("[iaqar] office settings save error", error);
      toast(String(error && error.message) || "تعذر حفظ إعدادات المكتب");
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
    const link = officeLink();
    const shareText = `${current.officeName}\nزيارة صفحة المكتب:\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: current.officeName, text: shareText, url: link });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast("تم نسخ رابط المكتب للمشاركة");
    } catch (_) {
      toast("انسخ الرابط من الحقل أعلاه");
    }
  }

  function previewOfficeLink() {
    window.open(officeLink(), "_blank", "noopener,noreferrer");
  }

  function openOpportunityBank() {
    if (el.bankNote) {
      el.bankNote.textContent = "بنك الفرص الخاص بهذا المكتب — تُفعّل الواجهة الكاملة في مرحلة بنك الفرص.";
    }
    toast("بنك الفرص: يُفتح للمكتب في مرحلة بنك الفرص القادمة");
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
    const slug = Core.buildPublicSlug(current.officeName, officeId());
    current = clean({ ...current, publicSlug: slug });
    el.link.value = officeLink();
    renderLinkQr();
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
    el.logo = document.getElementById("officeLogoInput");
    el.logoPreview = document.getElementById("officeLogoPreview");
    el.removeLogo = document.getElementById("removeOfficeLogoBtn");
    el.cover = document.getElementById("officeCoverInput");
    el.coverPreview = document.getElementById("officeCoverPreview");
    el.removeCover = document.getElementById("removeOfficeCoverBtn");
    el.cardCover = document.getElementById("officeCardCover");
    el.cardCoverEmpty = document.getElementById("officeCardCoverEmpty");
    el.link = document.getElementById("officeLinkInput");
    el.copy = document.getElementById("copyOfficeLinkBtn");
    el.shareLink = document.getElementById("shareOfficeLinkBtn");
    el.previewLink = document.getElementById("previewOfficeLinkBtn");
    el.qr = document.getElementById("officeLinkQr");
    el.save = document.getElementById("saveOfficeSettingsBtn");
    el.logout = document.getElementById("officeLogoutBtn");
    el.shareCard = document.getElementById("shareOfficeCardBtn");
    el.note = document.getElementById("officeSettingsNote");
    el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
    el.notifInputs = document.querySelectorAll('input[name="notifPref"]');
    el.cooperation = document.getElementById("cooperationModeSelect");
    el.openBank = document.getElementById("openOpportunityBankBtn");
    el.bankNote = document.getElementById("opportunityBankNote");

    apply(loadLocal() || defaults);

    el.officeName.addEventListener("input", () => el.officeName.setCustomValidity(""));
    el.form.addEventListener("submit", onSave);
    el.copy.addEventListener("click", copyLink);
    if (el.shareLink) el.shareLink.addEventListener("click", shareOfficeLink);
    if (el.previewLink) el.previewLink.addEventListener("click", previewOfficeLink);
    el.logout.addEventListener("click", onLogout);
    if (el.shareCard) el.shareCard.addEventListener("click", shareOfficeCard);
    if (el.openBank) el.openBank.addEventListener("click", openOpportunityBank);

    if (el.cover) el.cover.addEventListener("change", () => {
      const file = el.cover.files && el.cover.files[0];
      if (!file) return;
      const coverError = validateImageFile(file, 10 * 1024 * 1024);
      if (coverError) { toast(coverError); el.cover.value = ""; return; }
      pendingRemoveCover = false;
      if (el.coverPreview) {
        el.coverPreview.src = URL.createObjectURL(file);
        el.coverPreview.hidden = false;
      }
      if (el.removeCover) el.removeCover.hidden = false;
    });

    if (el.logo) el.logo.addEventListener("change", () => {
      const file = el.logo.files && el.logo.files[0];
      if (!file) return;
      const logoError = validateImageFile(file, 5 * 1024 * 1024);
      if (logoError) { toast(logoError); el.logo.value = ""; return; }
      pendingRemoveLogo = false;
      if (el.logoPreview) {
        el.logoPreview.src = URL.createObjectURL(file);
        el.logoPreview.hidden = false;
      }
      if (el.removeLogo) el.removeLogo.hidden = false;
    });

    if (el.removeLogo) el.removeLogo.addEventListener("click", () => {
      pendingRemoveLogo = true;
      if (el.logo) el.logo.value = "";
      if (el.logoPreview) { el.logoPreview.hidden = true; el.logoPreview.src = ""; }
      el.removeLogo.hidden = true;
      toast("سيُزال الشعار عند الحفظ");
    });

    if (el.removeCover) el.removeCover.addEventListener("click", () => {
      pendingRemoveCover = true;
      if (el.cover) el.cover.value = "";
      if (el.coverPreview) { el.coverPreview.hidden = true; el.coverPreview.src = ""; }
      el.removeCover.hidden = true;
      toast("ستُزال صورة الواجهة عند الحفظ");
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
