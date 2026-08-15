import {
  COOPERATION_MODE_VALUES,
  DEFAULT_COOPERATION_MODE,
  NOTIFICATION_CATEGORY_KEYS,
  OFFICE_IMAGE_MESSAGES,
  OFFICE_IMAGE_VARIANTS,
  OFFICE_NAME_MESSAGES,
  buildPublicSlug,
  cooperationSettingsPayload,
  cropRectForAspect,
  defaultNotificationPreferences,
  imagePreset,
  normalizeCooperationMode,
  normalizeOfficeName,
  normalizeOfficeNameKey,
  normalizePublicSlug,
  officeLinkFor,
  resolveCurrentOfficeImage,
  resolveNotificationPreferences,
  safeText,
  sanitizeNotificationPreferences,
  validateImageFile,
  validateOfficeName,
  withOfficeImageCacheBust
} from "./office-domain.js";
import { buildDefaultServiceNeighborhoodIds } from "./neighborhood-adjacency-domain.js";

const SPECIALTY_LABELS = Object.freeze({
  sale: "بيع",
  purchase: "شراء",
  rent: "تأجير",
  property_management: "إدارة أملاك"
});
const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));
function resolveWorkerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  try {
    const host = String(window.location && window.location.hostname || "").toLowerCase();
    if (host.includes("--staging") || host.startsWith("staging.")) {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

const defaults = {
  officeName: "مكتب عقاري",
  brokerName: "وسيط عقاري",
  phone: "",
  whatsapp: "",
  licenseNumber: "",
  city: "المدينة المنورة",
  specialties: [],
  logoUrl: "",
  displayImageUrl: "",
  coverUrl: "",
  publicSlug: ""
};

const IMAGE_FIELDS = Object.freeze({
  logo: "logoUrl",
  display: "displayImageUrl",
  cover: "coverUrl"
});

const el = {};
const imageSlots = new Map();
let current = { ...defaults };
let authClaims = {};
let notificationPreferences = defaultNotificationPreferences();
let cooperationMode = DEFAULT_COOPERATION_MODE;
let nameCheckToken = 0;

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

function serverTimestamp() {
  return window.firebase.firestore.FieldValue.serverTimestamp();
}

function toast(message) {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

function setStatus(node, message, kind = "") {
  if (!node) return;
  node.textContent = message || "";
  node.classList.remove("is-error", "is-done");
  if (kind) node.classList.add(kind);
}

function normalizedSpecialties(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
}

function clean(data) {
  const officeName = normalizeOfficeName(data.officeName || defaults.officeName);
  const phone = safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20);
  return {
    officeName,
    officeNameKey: normalizeOfficeNameKey(officeName),
    brokerName: normalizeOfficeName(data.brokerName || defaults.brokerName),
    phone,
    // رقم واتساب مشتق من رقم الجوال: الحقل يبقى محفوظًا للصفحة العامة وروابط wa.me
    // بينما تعرض الإعدادات رقم جوال واحدًا فقط حسب القسم 7.2.
    whatsapp: safeText(data.whatsapp || phone).replace(/[^0-9+]/g, "").slice(0, 20),
    licenseNumber: safeText(data.licenseNumber, defaults.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
    city: safeText(data.city, defaults.city).slice(0, 60),
    specialties: normalizedSpecialties(data.specialties),
    logoUrl: safeText(data.logoUrl).slice(0, 2000),
    displayImageUrl: safeText(data.displayImageUrl).slice(0, 2000),
    coverUrl: safeText(data.coverUrl).slice(0, 2000),
    publicSlug: normalizePublicSlug(data.publicSlug)
  };
}

function officeLink() {
  return officeLinkFor({
    origin: window.location.origin,
    publicSlug: current.publicSlug,
    officeId: officeId(),
    pathname: window.location.pathname
  });
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function applyOfficeCardImages() {
  const logo = el.cardLogo;
  if (logo) {
    const oid = officeId();
    const worker = resolveWorkerBase();
    const canonicalLogo = oid && worker
      ? `${worker}/media/public/office-covers/${encodeURIComponent(oid)}/logo`
      : "";
    const logoSource = withOfficeImageCacheBust(
      canonicalLogo || resolveCurrentOfficeImage(current) || String(current.logoUrl || "").trim(),
      current.updatedAt || Date.now()
    );
    if (logoSource) {
      logo.hidden = false;
      logo.onerror = () => {
        const fallback = withOfficeImageCacheBust(
          resolveCurrentOfficeImage(current) || String(current.logoUrl || "").trim(),
          current.updatedAt || ""
        );
        if (fallback && logo.src !== fallback) {
          logo.src = fallback;
          return;
        }
        logo.hidden = true;
        if (logo.dataset.defaultSrc) {
          logo.hidden = false;
          logo.src = logo.dataset.defaultSrc;
        }
      };
      logo.onload = () => { logo.hidden = false; };
      if (logo.src !== logoSource) logo.src = logoSource;
    } else if (logo.dataset.defaultSrc) {
      logo.hidden = false;
      logo.src = logo.dataset.defaultSrc;
    }
  }
}

function applyImageSlots() {
  for (const [variant, slot] of imageSlots) {
    if (slot.pending) continue;
    setSlotPreview(slot, current[IMAGE_FIELDS[variant]] || "");
  }
}

function setSlotPreview(slot, source) {
  const url = String(source || "").trim();
  if (!url) {
    slot.image.hidden = true;
    slot.image.removeAttribute("src");
    if (slot.placeholder) slot.placeholder.hidden = false;
    if (slot.remove) slot.remove.hidden = true;
    return;
  }
  if (slot.placeholder) slot.placeholder.hidden = true;
  slot.image.hidden = false;
  slot.image.onerror = () => {
    slot.image.hidden = true;
    if (slot.placeholder) slot.placeholder.hidden = false;
    if (slot.remove) slot.remove.hidden = true;
  };
  slot.image.onload = () => {
    slot.image.hidden = false;
    if (slot.placeholder) slot.placeholder.hidden = true;
    if (slot.remove) slot.remove.hidden = !(slot.preset.removable && url);
  };
  if (slot.image.src !== url) slot.image.src = url;
  else if (slot.image.complete && slot.image.naturalWidth > 0) {
    if (slot.placeholder) slot.placeholder.hidden = true;
    if (slot.remove) slot.remove.hidden = !(slot.preset.removable && url);
  }
}

function apply(data) {
  current = clean({ ...defaults, ...(data || {}) });
  el.officeName.value = current.officeName;
  el.brokerName.value = current.brokerName;
  el.phone.value = current.phone;
  el.license.value = current.licenseNumber;
  el.city.value = current.city;
  if (el.link) el.link.value = officeLink();
  writeSpecialtiesToForm(current.specialties);
  applyImageSlots();
  applyOfficeCardImages();

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
  const specialtyWrap = document.getElementById("officeDisplaySpecialtiesWrap");
  if (specialtyWrap) specialtyWrap.hidden = !current.specialties.length;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

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
        displayImageUrl: data.displayImageUrl,
        coverUrl: data.coverUrl,
        publicSlug: data.publicSlug,
        updatedAt: data.updatedAt || Date.now()
      });
      saveLocal(current);
      // Keep publicOffices image fields mirrored to the current office identity (SSOT).
      try {
        await runtime.db.collection("publicOffices").doc(officeId()).set({
          officeId: officeId(),
          logoUrl: safeText(data.logoUrl).slice(0, 2000),
          displayImageUrl: safeText(data.displayImageUrl).slice(0, 2000),
          coverUrl: safeText(data.coverUrl).slice(0, 2000),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (mirrorError) {
        console.warn("[iaqar] public office image mirror", mirrorError);
      }
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
      updatedAt: serverTimestamp()
    }, { merge: true });

    transaction.set(officeRef, {
      ...data,
      officeId: officeId(),
      ownerUid: officeSnap.exists && officeSnap.data().ownerUid
        ? officeSnap.data().ownerUid
        : user.uid,
      updatedAt: serverTimestamp()
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
      displayImageUrl: data.displayImageUrl,
      coverUrl: data.coverUrl,
      publicSlug: data.publicSlug,
      serviceNeighborhoodIds: buildDefaultServiceNeighborhoodIds(data.city),
      cooperationMode: cooperationMode,
      updatedAt: serverTimestamp()
    }, { merge: true });
  });
}

async function onSave(event) {
  event.preventDefault();

  const nameError = validateOfficeName(el.officeName.value, { isPlatformAdmin: isPlatformAdmin() });
  if (nameError) {
    el.officeName.setCustomValidity(nameError);
    el.officeName.reportValidity();
    toast(nameError);
    return;
  }
  el.officeName.setCustomValidity("");

  const data = clean({
    ...current,
    officeName: el.officeName.value,
    brokerName: el.brokerName.value,
    phone: el.phone.value,
    whatsapp: el.phone.value,
    licenseNumber: el.license.value,
    city: el.city.value,
    specialties: readSpecialtiesFromForm(),
    publicSlug: current.publicSlug || buildPublicSlug(el.officeName.value, officeId())
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
        el.officeName.setCustomValidity(OFFICE_NAME_MESSAGES.taken);
        el.officeName.reportValidity();
        setStatus(el.nameAvailability, OFFICE_NAME_MESSAGES.taken, "is-error");
        toast(OFFICE_NAME_MESSAGES.taken);
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

// ---------------------------------------------------------------------------
// Unique office name availability
// ---------------------------------------------------------------------------

async function checkNameAvailability() {
  const token = ++nameCheckToken;
  const value = el.officeName.value;
  const localError = validateOfficeName(value, { isPlatformAdmin: isPlatformAdmin() });
  if (localError) {
    setStatus(el.nameAvailability, localError, "is-error");
    return;
  }

  const key = normalizeOfficeNameKey(value);
  if (key === current.officeNameKey) {
    setStatus(el.nameAvailability, "");
    return;
  }

  const runtime = officeRuntime();
  if (!runtime || !runtime.db || !authUser()) {
    setStatus(el.nameAvailability, "");
    return;
  }

  setStatus(el.nameAvailability, "جارٍ التحقق من توفر الاسم…");
  try {
    const snap = await runtime.db.collection("officeNameClaims").doc(key).get();
    if (token !== nameCheckToken) return;
    if (snap.exists && snap.data().officeId !== officeId()) {
      setStatus(el.nameAvailability, OFFICE_NAME_MESSAGES.taken, "is-error");
      return;
    }
    setStatus(el.nameAvailability, OFFICE_NAME_MESSAGES.available, "is-done");
  } catch (error) {
    if (token !== nameCheckToken) return;
    console.warn("[iaqar] office name availability", error);
    // الحكم النهائي على التوفر يقع داخل معاملة الحفظ، فلا نعطي انطباعًا خاطئًا هنا.
    setStatus(el.nameAvailability, "يتم التأكد من توفر الاسم عند الحفظ.");
  }
}

// ---------------------------------------------------------------------------
// Visual identity
// ---------------------------------------------------------------------------

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("IMAGE_DECODE_FAILED"));
    };
    image.src = url;
  });
}

function cropToPresetBlob(image, preset, offsetX, offsetY) {
  const rect = cropRectForAspect({
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    aspectRatio: preset.aspectRatio,
    offsetX,
    offsetY
  });
  if (!rect) return Promise.reject(new Error("IMAGE_CROP_FAILED"));

  const canvas = document.createElement("canvas");
  canvas.width = preset.outputWidth;
  canvas.height = preset.outputHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("IMAGE_CROP_FAILED"));
  if (preset.outputType !== "image/png") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(
    image,
    rect.sourceX, rect.sourceY, rect.sourceWidth, rect.sourceHeight,
    0, 0, canvas.width, canvas.height
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error("IMAGE_CROP_FAILED"))),
      preset.outputType,
      preset.outputQuality
    );
  });
}

async function refreshSlotPending(slot) {
  if (!slot.pending) return;
  try {
    const blob = await cropToPresetBlob(
      slot.pending.image,
      slot.preset,
      slot.offsetX.valueAsNumber / 100,
      slot.offsetY.valueAsNumber / 100
    );
    if (slot.pending.previewUrl) URL.revokeObjectURL(slot.pending.previewUrl);
    slot.pending.blob = blob;
    slot.pending.previewUrl = URL.createObjectURL(blob);
    setSlotPreview(slot, slot.pending.previewUrl);
    slot.save.disabled = false;
  } catch (error) {
    console.warn("[iaqar] office image crop", error);
    setStatus(slot.status, OFFICE_IMAGE_MESSAGES.failed, "is-error");
    slot.save.disabled = true;
  }
}

function clearSlotPending(slot) {
  if (slot.pending && slot.pending.previewUrl) URL.revokeObjectURL(slot.pending.previewUrl);
  slot.pending = null;
  slot.file.value = "";
  slot.crop.hidden = true;
  slot.cancel.hidden = true;
  slot.save.disabled = true;
  slot.offsetX.value = "50";
  slot.offsetY.value = "50";
  setSlotPreview(slot, current[IMAGE_FIELDS[slot.preset.variant]] || "");
}

async function onSlotFileChange(slot) {
  const file = slot.file.files && slot.file.files[0];
  const error = validateImageFile(file);
  if (error) {
    setStatus(slot.status, error, "is-error");
    clearSlotPending(slot);
    return;
  }

  setStatus(slot.status, "جارٍ تجهيز الصورة…");
  try {
    const image = await loadImageFromFile(file);
    slot.pending = { image, blob: null, previewUrl: "" };
    slot.crop.hidden = false;
    slot.cancel.hidden = false;
    await refreshSlotPending(slot);
    setStatus(slot.status, "اضبط موضع الاقتصاص ثم احفظ الصورة.");
  } catch (_) {
    setStatus(slot.status, OFFICE_IMAGE_MESSAGES.failed, "is-error");
    clearSlotPending(slot);
  }
}

async function persistImageUrl(variant, url) {
  const runtime = officeRuntime();
  const user = authUser();
  const field = IMAGE_FIELDS[variant];
  if (!runtime || !runtime.db || !user || !field) throw new Error("NOT_AUTHORIZED");
  const now = serverTimestamp();
  await Promise.all([
    runtime.db.collection("offices").doc(officeId())
      .set({ officeId: officeId(), [field]: url, updatedAt: now }, { merge: true }),
    runtime.db.collection("publicOffices").doc(officeId())
      .set({ officeId: officeId(), [field]: url, updatedAt: now }, { merge: true })
  ]);
  current = clean({ ...current, [field]: url, updatedAt: Date.now() });
  saveLocal(current);
  applyOfficeCardImages();
}

async function onSlotSave(slot) {
  if (!slot.pending || !slot.pending.blob) return;
  const user = authUser();
  if (!user) {
    setStatus(slot.status, "سجل دخول مدير المكتب قبل رفع الصورة", "is-error");
    return;
  }

  slot.save.disabled = true;
  slot.choose.disabled = true;
  setStatus(slot.status, OFFICE_IMAGE_MESSAGES.uploading);
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(`${resolveWorkerBase()}/media/office-cover`, {
      method: "POST",
      headers: {
        "Content-Type": slot.pending.blob.type || slot.preset.outputType,
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Office-Image-Variant": slot.preset.variant
      },
      body: slot.pending.blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.imageUrl) {
      throw new Error(result.message || "تعذر رفع الصورة");
    }
    await persistImageUrl(slot.preset.variant, result.imageUrl);
    clearSlotPending(slot);
    setStatus(slot.status, OFFICE_IMAGE_MESSAGES.uploaded, "is-done");
    toast(OFFICE_IMAGE_MESSAGES.uploaded);
  } catch (error) {
    console.warn("[iaqar] office image upload", error);
    setStatus(slot.status, error.message || OFFICE_IMAGE_MESSAGES.failed, "is-error");
    slot.save.disabled = false;
  } finally {
    slot.choose.disabled = false;
  }
}

async function onSlotRemove(slot) {
  if (!slot.preset.removable) return;
  const user = authUser();
  if (!user) {
    setStatus(slot.status, "سجل دخول مدير المكتب أولًا", "is-error");
    return;
  }
  slot.remove.disabled = true;
  setStatus(slot.status, OFFICE_IMAGE_MESSAGES.removing);
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(`${resolveWorkerBase()}/media/office-cover`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "X-Office-Id": officeId(),
        "X-Office-Image-Variant": slot.preset.variant
      }
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "تعذر إزالة الصورة");
    await persistImageUrl(slot.preset.variant, "");
    clearSlotPending(slot);
    setStatus(slot.status, OFFICE_IMAGE_MESSAGES.removed, "is-done");
  } catch (error) {
    console.warn("[iaqar] office image remove", error);
    setStatus(slot.status, error.message || OFFICE_IMAGE_MESSAGES.failed, "is-error");
  } finally {
    slot.remove.disabled = false;
  }
}

function initImageSlots() {
  document.querySelectorAll("[data-image-variant]").forEach(node => {
    const variant = node.dataset.imageVariant;
    const preset = imagePreset(variant);
    if (!preset) return;

    const slot = {
      preset,
      root: node,
      preview: node.querySelector('[data-role="preview"]'),
      image: node.querySelector('[data-role="preview-image"]'),
      placeholder: node.querySelector('[data-role="placeholder"]'),
      crop: node.querySelector('[data-role="crop"]'),
      offsetX: node.querySelector('[data-role="offset-x"]'),
      offsetY: node.querySelector('[data-role="offset-y"]'),
      choose: node.querySelector('[data-role="choose"]'),
      save: node.querySelector('[data-role="save"]'),
      cancel: node.querySelector('[data-role="cancel"]'),
      remove: node.querySelector('[data-role="remove"]'),
      file: node.querySelector('[data-role="file"]'),
      status: node.querySelector('[data-role="status"]'),
      ratioHint: node.querySelector('[data-role="ratio-hint"]'),
      pending: null
    };
    if (!slot.image || !slot.file || !slot.choose || !slot.save) return;

    // نسبة الاقتصاص مصدرها الإعداد في office-domain.js؛ شعار المكتب يُقيَّد بـ CSS المستقل.
    if (slot.preview && preset.variant !== "logo") {
      slot.preview.style.aspectRatio = String(preset.aspectRatio);
    }
    if (slot.ratioHint) {
      slot.ratioHint.textContent = `${preset.outputWidth}×${preset.outputHeight}`;
    }

    slot.choose.addEventListener("click", () => slot.file.click());
    slot.file.addEventListener("change", () => onSlotFileChange(slot));
    slot.save.addEventListener("click", () => onSlotSave(slot));
    if (slot.cancel) slot.cancel.addEventListener("click", () => {
      clearSlotPending(slot);
      setStatus(slot.status, "");
    });
    if (slot.remove) slot.remove.addEventListener("click", () => onSlotRemove(slot));
    [slot.offsetX, slot.offsetY].forEach(input => {
      if (input) input.addEventListener("input", () => refreshSlotPending(slot));
    });

    imageSlots.set(variant, slot);
  });
}

// ---------------------------------------------------------------------------
// Office link, QR and sharing
// ---------------------------------------------------------------------------

async function ensurePublicSlug() {
  if (current.publicSlug) return current.publicSlug;
  const slug = buildPublicSlug(current.officeName, officeId());
  current = clean({ ...current, publicSlug: slug });
  if (el.link) el.link.value = officeLink();
  const runtime = officeRuntime();
  const user = authUser();
  if (runtime && runtime.db && user) {
    const now = serverTimestamp();
    await Promise.all([
      runtime.db.collection("offices").doc(officeId()).set({ officeId: officeId(), publicSlug: slug, updatedAt: now }, { merge: true }),
      runtime.db.collection("publicOffices").doc(officeId()).set({ officeId: officeId(), publicSlug: slug, updatedAt: now }, { merge: true })
    ]);
    saveLocal(current);
  }
  return slug;
}

async function copyLink() {
  const link = el.link.value;
  try {
    await navigator.clipboard.writeText(link);
    setStatus(el.linkStatus, "تم نسخ رابط المكتب", "is-done");
    toast("تم نسخ رابط المكتب");
  } catch (_) {
    el.link.select();
    document.execCommand("copy");
    setStatus(el.linkStatus, "تم نسخ رابط المكتب", "is-done");
    toast("تم نسخ رابط المكتب");
  }
}

async function shareLink() {
  const link = el.link.value;
  const text = `${current.officeName}\n${link}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: current.officeName, text, url: link });
      return;
    } catch (error) {
      if (error && error.name === "AbortError") return;
    }
  }
  await copyLink();
  setStatus(el.linkStatus, "المشاركة غير مدعومة على هذا الجهاز، ونُسخ الرابط بدلًا منها.");
}

function renderQrCode() {
  if (!el.qrCanvas || typeof window.qrcode !== "function") return false;
  const context = el.qrCanvas.getContext("2d");
  if (!context) return false;
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(el.link.value);
    qr.make();
    const modules = qr.getModuleCount();
    const size = el.qrCanvas.width;
    const quiet = 4;
    const cell = size / (modules + quiet * 2);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#073f35";
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const x = Math.floor((col + quiet) * cell);
        const y = Math.floor((row + quiet) * cell);
        const nextX = Math.ceil((col + quiet + 1) * cell);
        const nextY = Math.ceil((row + quiet + 1) * cell);
        context.fillRect(x, y, nextX - x, nextY - y);
      }
    }
    return true;
  } catch (error) {
    console.warn("[iaqar] office qr", error);
    return false;
  }
}

async function toggleQrCode() {
  if (!el.qrWrap) return;
  const willShow = el.qrWrap.hidden;
  if (!willShow) {
    el.qrWrap.hidden = true;
    el.toggleQr.setAttribute("aria-expanded", "false");
    el.toggleQr.textContent = "إظهار رمز QR";
    return;
  }
  try {
    await ensurePublicSlug();
  } catch (error) {
    console.warn("[iaqar] office slug", error);
  }
  if (!renderQrCode()) {
    setStatus(el.linkStatus, "تعذر إنشاء رمز QR الآن", "is-error");
    return;
  }
  el.qrWrap.hidden = false;
  el.toggleQr.setAttribute("aria-expanded", "true");
  el.toggleQr.textContent = "إخفاء رمز QR";
  setStatus(el.linkStatus, "");
}

function downloadQrCode() {
  if (!el.qrCanvas) return;
  try {
    const anchor = document.createElement("a");
    anchor.href = el.qrCanvas.toDataURL("image/png");
    anchor.download = `qr-${current.publicSlug || officeId()}.png`;
    anchor.click();
    setStatus(el.linkStatus, "تم تنزيل رمز QR", "is-done");
  } catch (error) {
    console.warn("[iaqar] office qr download", error);
    setStatus(el.linkStatus, "تعذر تنزيل الرمز", "is-error");
  }
}

async function previewPublicLink() {
  try {
    await ensurePublicSlug();
  } catch (error) {
    console.warn("[iaqar] office slug", error);
  }
  window.open(el.link.value, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// Office card image (share material)
// ---------------------------------------------------------------------------

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

function officeMissingFields() {
  const fields = [
    ["اسم المكتب", current.officeName && current.officeName !== defaults.officeName],
    ["اسم الوسيط", current.brokerName && current.brokerName !== defaults.brokerName],
    ["رخصة فال", current.licenseNumber],
    ["رقم الجوال", current.phone],
    ["المدينة", current.city],
    ["ترويسة المكتب", current.coverUrl || current.displayImageUrl]
  ];
  return fields.filter(([, valid]) => !valid).map(([label]) => label);
}

async function createOfficeCardBlob() {
  const missing = officeMissingFields();
  if (missing.length) throw new Error(`MISSING:${missing.join("، ")}`);

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  const link = officeLink();

  ctx.fillStyle = "#f6faf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const platformLogo = await loadImage("/icons/icon-192.png");
    drawImageContain(ctx, platformLogo, 48, 28, 40, 40);
  } catch (_) {}

  ctx.direction = "rtl";
  ctx.textAlign = "left";
  ctx.fillStyle = "#005C4B";
  ctx.font = "600 22px Tajawal, Arial, sans-serif";
  ctx.fillText("مكاتب عقارية ذكية", 108, 58);

  const oid = officeId();
  const worker = resolveWorkerBase();
  const canonicalLogo = oid && worker
    ? `${worker}/media/public/office-covers/${encodeURIComponent(oid)}/logo`
    : "";
  const displaySrc = withOfficeImageCacheBust(
    canonicalLogo || resolveCurrentOfficeImage(current),
    current.updatedAt || Date.now()
  );
  const imageCenterX = 540;
  const imageY = 118;
  if (displaySrc) {
    try {
      const displayImg = await loadImage(displaySrc);
      drawImageCover(ctx, displayImg, imageCenterX - 74, imageY, 148, 148, 22);
    } catch (_) {}
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#073f35";
  ctx.font = "800 42px Tajawal, Arial, sans-serif";
  ctx.fillText(current.officeName, imageCenterX, imageY + 196);

  ctx.textAlign = "right";
  ctx.fillStyle = "#073f35";
  ctx.font = "700 30px Tajawal, Arial, sans-serif";
  ctx.fillText(current.brokerName, 940, 360);
  ctx.font = "500 22px Tajawal, Arial, sans-serif";
  ctx.fillStyle = "#6a7d77";
  ctx.fillText("وسيط عقاري — المرخص له", 940, 396);

  const specialty = specialtyText(current.specialties) || "بيع • شراء • تأجير • إدارة أملاك";
  const rows = [
    ["رخصة فال", current.licenseNumber],
    ["المدينة", current.city],
    ["الخدمات", specialty.replace(/ • /g, " • ")]
  ];
  let rowY = 450;
  for (const [label, value] of rows) {
    ctx.fillStyle = "#6a7d77";
    ctx.font = "500 24px Tajawal, Arial, sans-serif";
    ctx.fillText(label, 940, rowY);
    ctx.fillStyle = "#073f35";
    ctx.font = "700 28px Tajawal, Arial, sans-serif";
    ctx.fillText(value || "—", 700, rowY);
    rowY += 52;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#087064";
  ctx.font = "800 30px Tajawal, Arial, sans-serif";
  ctx.fillText("رابط المكتب", 540, 640);

  ctx.fillStyle = "#073f35";
  ctx.font = "700 26px Tajawal, Arial, sans-serif";
  const linkDisplay = link.replace(/^https?:\/\//, "");
  ctx.fillText(linkDisplay, 540, 690);

  ctx.textAlign = "right";
  ctx.fillStyle = "#71817c";
  ctx.font = "500 20px Tajawal, Arial, sans-serif";
  ctx.fillText("منصة الفرص العقارية — IAQAR", 940, 990);

  return new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
}

async function createOpportunityShareCardBlob({
  propertyType = "",
  city = "",
  district = "",
  priceOrBudget = "",
  imageSrc = ""
} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f6faf8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    const platformLogo = await loadImage("/icons/icon-192.png");
    drawImageContain(ctx, platformLogo, 502, 18, 40, 40);
  } catch (_) {}

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.fillStyle = "#005C4B";
  ctx.font = "700 24px Tajawal, Arial, sans-serif";
  ctx.fillText("مكاتب عقارية ذكية", 540, 78);

  ctx.fillStyle = "#E8F5E8";
  roundedRect(ctx, 56, 96, 968, 58, 16);
  ctx.fill();
  ctx.fillStyle = "#087064";
  ctx.font = "800 34px Tajawal, Arial, sans-serif";
  const title = [propertyType, district || city].filter(Boolean).join(" — ") || "فرصة عقارية";
  ctx.fillText(title, 540, 138);

  const imageBox = { x: 80, y: 170, w: 280, h: 210 };
  ctx.fillStyle = "#e8ecea";
  roundedRect(ctx, imageBox.x, imageBox.y, imageBox.w, imageBox.h, 18);
  ctx.fill();
  let drewImage = false;
  if (imageSrc) {
    try {
      const propertyImg = await loadImage(imageSrc);
      drawImageCover(ctx, propertyImg, imageBox.x, imageBox.y, imageBox.w, imageBox.h, 18);
      drewImage = true;
    } catch (_) {}
  }
  if (!drewImage) {
    ctx.fillStyle = "#9ab0a8";
    ctx.font = "600 22px Tajawal, Arial, sans-serif";
    ctx.fillText("صورة العقار", imageBox.x + imageBox.w / 2, imageBox.y + imageBox.h / 2 + 8);
  }

  ctx.textAlign = "right";
  ctx.fillStyle = "#073f35";
  ctx.font = "700 30px Tajawal, Arial, sans-serif";
  if (city) ctx.fillText(`المدينة: ${city}`, 940, 220);
  if (priceOrBudget) {
    ctx.font = "700 28px Tajawal, Arial, sans-serif";
    ctx.fillText(`السعر / الميزانية: ${priceOrBudget} ريال`, 940, 268);
  }

  ctx.fillStyle = "#71817c";
  ctx.font = "500 20px Tajawal, Arial, sans-serif";
  ctx.fillText("فرصة عقارية من منصة مكاتب عقارية ذكية", 940, 860);

  return new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.95));
}

async function shareOpportunityCard(record, source = null) {
  const imageSrc = extractPropertyImageUrl(source?.text || source?.url || "");
  const blob = await createOpportunityShareCardBlob({
    propertyType: record.propertyType || "",
    city: record.city || "",
    district: record.district || "",
    priceOrBudget: record.priceOrBudget ?? record.price ?? "",
    imageSrc
  });
  if (!blob) throw new Error("CARD_FAILED");
  const file = new File([blob], `فرصة-${record.propertyType || "عقارية"}.png`, { type: "image/png" });
  const text = [
    record.propertyType || "فرصة عقارية",
    record.district ? `الحي: ${record.district}` : "",
    record.city ? `المدينة: ${record.city}` : "",
    record.priceOrBudget ? `السعر: ${record.priceOrBudget} ريال` : ""
  ].filter(Boolean).join("\n");
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: record.propertyType || "فرصة عقارية", text });
    window.dispatchEvent(new CustomEvent("iaqar:share-handoff", { detail: { state: "OPENED_EXTERNAL" } }));
    return;
  }
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
}

function extractPropertyImageUrl(text) {
  const raw = String(text || "");
  const match = raw.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i);
  return match ? match[0] : "";
}

async function shareOfficeLinkCard() {
  const missing = officeMissingFields();
  if (missing.length) {
    setStatus(el.linkStatus, `أكمل بيانات المكتب أولًا: ${missing.join("، ")}`, "is-error");
    return;
  }
  const originalText = el.shareLinkCard?.textContent || "مشاركة رابط المكتب";
  if (el.shareLinkCard) {
    el.shareLinkCard.disabled = true;
    el.shareLinkCard.textContent = "جارٍ تجهيز البطاقة...";
  }
  try {
    await ensurePublicSlug();
    const link = officeLink();
    const text = `${current.officeName}\nرابط المكتب:\n${link}`;
    const blob = await createOfficeCardBlob();
    if (!blob) throw new Error("CARD_FAILED");
    const file = new File([blob], `رابط-${current.officeName}.png`, { type: "image/png" });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file], text })) {
      await navigator.share({ files: [file], title: current.officeName, text });
      setStatus(el.linkStatus, "تمت مشاركة بطاقة المكتب والرابط", "is-done");
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: current.officeName, text });
        setStatus(el.linkStatus, "تمت مشاركة الرابط", "is-done");
        return;
      } catch (shareError) {
        if (shareError && shareError.name === "AbortError") return;
      }
    }
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
    try {
      await navigator.clipboard.writeText(link);
      setStatus(el.linkStatus, "تم تنزيل البطاقة ونسخ الرابط", "is-done");
      toast("تم تنزيل البطاقة ونسخ الرابط");
    } catch (_) {
      setStatus(el.linkStatus, "تم تنزيل البطاقة — انسخ الرابط يدويًا من الإعدادات", "is-done");
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (String(error && error.message || "").startsWith("MISSING:")) {
      setStatus(el.linkStatus, `أكمل بيانات المكتب أولًا: ${error.message.slice(8)}`, "is-error");
    } else {
      console.warn("[iaqar] office link card", error);
      setStatus(el.linkStatus, "تعذر إنشاء بطاقة المكتب الآن", "is-error");
    }
  } finally {
    if (el.shareLinkCard) {
      el.shareLinkCard.disabled = false;
      el.shareLinkCard.textContent = originalText;
    }
  }
}

async function shareOfficeCard() {
  const missing = officeMissingFields();
  if (missing.length) {
    setStatus(el.linkStatus, `أكمل بيانات المكتب أولًا: ${missing.join("، ")}`, "is-error");
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
      "زيارة المكتب وإضافة عرض أو طلب بدون تسجيل",
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
    setStatus(el.linkStatus, "تم تنزيل بطاقة المكتب", "is-done");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (String(error && error.message || "").startsWith("MISSING:")) {
      setStatus(el.linkStatus, `أكمل بيانات المكتب أولًا: ${error.message.slice(8)}`, "is-error");
    } else {
      console.warn("[iaqar] office card", error);
      setStatus(el.linkStatus, "تعذر إنشاء بطاقة المكتب الآن", "is-error");
    }
  } finally {
    el.shareCard.disabled = false;
    el.shareCard.textContent = originalText;
  }
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

function writePreferencesToForm(preferences) {
  Array.from(el.notificationInputs || []).forEach(input => {
    if (NOTIFICATION_CATEGORY_KEYS.includes(input.value)) {
      input.checked = preferences[input.value] !== false;
    }
  });
}

function readPreferencesFromForm() {
  const preferences = {};
  Array.from(el.notificationInputs || []).forEach(input => {
    if (NOTIFICATION_CATEGORY_KEYS.includes(input.value)) {
      preferences[input.value] = input.checked;
    }
  });
  return preferences;
}

async function loadNotificationPreferences() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime || !runtime.db || !user) return;
  try {
    const officeRef = runtime.db.collection("offices").doc(officeId());
    const [officeSnap, brokerSnap] = await Promise.all([
      officeRef.collection("officeSettings").doc("notifications").get(),
      officeRef.collection("brokerSettings").doc(user.uid).get()
    ]);
    notificationPreferences = resolveNotificationPreferences({
      officeDefaults: officeSnap.exists ? officeSnap.data() : null,
      brokerOverrides: brokerSnap.exists ? brokerSnap.data() : null
    });
    writePreferencesToForm(notificationPreferences);
    setStatus(el.notificationStatus, "");
  } catch (error) {
    console.warn("[iaqar] notification preferences load", error);
    setStatus(el.notificationStatus, "تعذر قراءة تفضيلات الإشعارات لهذا المكتب", "is-error");
  }
}

async function saveNotificationPreferences() {
  const runtime = officeRuntime();
  const user = authUser();
  const preferences = sanitizeNotificationPreferences(readPreferencesFromForm());
  notificationPreferences = resolveNotificationPreferences({ officeDefaults: preferences });

  if (!runtime || !runtime.db || !user) {
    setStatus(el.notificationStatus, "سجل دخول المكتب لحفظ تفضيلات الإشعارات", "is-error");
    return;
  }

  setStatus(el.notificationStatus, "جارٍ الحفظ…");
  const officeRef = runtime.db.collection("offices").doc(officeId());
  const now = serverTimestamp();
  const officeWrite = officeRef.collection("officeSettings").doc("notifications").set({
    officeId: officeId(),
    ...preferences,
    updatedAt: now,
    updatedBy: user.uid
  }, { merge: true });
  const brokerWrite = officeRef.collection("brokerSettings").doc(user.uid).set({
    officeId: officeId(),
    brokerId: user.uid,
    ...preferences,
    updatedAt: now
  }, { merge: true });

  const [officeResult, brokerResult] = await Promise.allSettled([officeWrite, brokerWrite]);
  if (officeResult.status === "fulfilled") {
    setStatus(el.notificationStatus, "تم حفظ تفضيلات الإشعارات لهذا المكتب", "is-done");
    return;
  }
  console.warn("[iaqar] notification preferences save", officeResult.reason);
  if (brokerResult.status === "fulfilled") {
    // الخادم يقرأ إعداد المكتب، فلا نزعم أنه سيطبّق تفضيلًا لم يُحفظ إلا لحسابك.
    setStatus(
      el.notificationStatus,
      "تم الحفظ لحسابك فقط. يلزم حساب مدير مخوّل لتطبيق التفضيل على إشعارات المكتب.",
      "is-error"
    );
    return;
  }
  setStatus(el.notificationStatus, "تعذر حفظ تفضيلات الإشعارات", "is-error");
}

// ---------------------------------------------------------------------------
// Smart cooperation
// ---------------------------------------------------------------------------

function writeCooperationToForm(mode) {
  Array.from(el.cooperationInputs || []).forEach(input => {
    input.checked = input.value === mode;
  });
}

async function loadCooperationSettings() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime || !runtime.db || !user) return;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("officeSettings").doc("cooperation").get();
    cooperationMode = normalizeCooperationMode(snap.exists ? snap.data().mode : DEFAULT_COOPERATION_MODE);
    writeCooperationToForm(cooperationMode);
    setStatus(el.cooperationStatus, "");
  } catch (error) {
    console.warn("[iaqar] cooperation settings load", error);
    setStatus(el.cooperationStatus, "تعذر قراءة إعداد التعاون لهذا المكتب", "is-error");
  }
}

async function saveCooperationSettings(value) {
  const runtime = officeRuntime();
  const user = authUser();
  const payload = cooperationSettingsPayload(value);
  cooperationMode = payload.mode;

  if (!runtime || !runtime.db || !user) {
    setStatus(el.cooperationStatus, "سجل دخول المكتب لحفظ إعداد التعاون", "is-error");
    return;
  }

  setStatus(el.cooperationStatus, "جارٍ الحفظ…");
  try {
    await runtime.db.collection("offices").doc(officeId())
      .collection("officeSettings").doc("cooperation").set({
        officeId: officeId(),
        ...payload,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });
    await runtime.db.collection("publicOffices").doc(officeId()).set({
      officeId: officeId(),
      cooperationMode: payload.mode,
      updatedAt: serverTimestamp()
    }, { merge: true });
    setStatus(el.cooperationStatus, "تم حفظ إعداد التعاون", "is-done");
  } catch (error) {
    console.warn("[iaqar] cooperation settings save", error);
    writeCooperationToForm(cooperationMode);
    setStatus(el.cooperationStatus, "تعذر حفظ إعداد التعاون. يلزم حساب مدير مخوّل.", "is-error");
  }
}

// ---------------------------------------------------------------------------
// Opportunity bank — owned by opportunity-bank.js (Phase 3)
// ---------------------------------------------------------------------------

function closeOpportunityBank() {
  if (typeof window.IAQAR?.closeOpportunityBank === "function") {
    window.IAQAR.closeOpportunityBank();
  } else {
    const overlay = document.getElementById("opportunityBank");
    if (overlay) overlay.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Settings overlay
// ---------------------------------------------------------------------------

function openSettings() {
  const overlay = document.getElementById("officeSettings");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  window.dispatchEvent(new CustomEvent("iaqar:office-settings-opened"));
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "officeSettings" } }));
}

function completeSettingsClose() {
  if (typeof window.IAQAR?.closeOpportunityBank === "function") {
    window.IAQAR.closeOpportunityBank({ fromPopstate: true });
  } else {
    const bankOverlay = document.getElementById("opportunityBank");
    if (bankOverlay && bankOverlay.dataset.inlineBank !== "1") bankOverlay.hidden = true;
  }
  const overlay = document.getElementById("officeSettings");
  if (overlay) overlay.hidden = true;
  const bankOverlay = document.getElementById("opportunityBank");
  const inlineBank = bankOverlay?.dataset.inlineBank === "1";
  if (!bankOverlay || bankOverlay.hidden || inlineBank) document.body.style.overflow = "";
  window.IAQAR?.navigation?.updateBackButton?.();
  window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
}

function closeSettings(options = {}) {
  const overlay = document.getElementById("officeSettings");
  if (!overlay || overlay.hidden) return;
  if (!options.explicit && window.history?.state?.iaqarOverlay) {
    window.IAQAR?.navigation?.requestBack?.();
    return;
  }
  completeSettingsClose();
  window.dispatchEvent(new CustomEvent("iaqar:office-settings-closed"));
}

function ensureSettingsNavDelegation() {
  if (globalThis.__iaqarOfficeSettingsNavDelegation) return;
  globalThis.__iaqarOfficeSettingsNavDelegation = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest("#officeSettingsClose")) {
      event.preventDefault();
      if (typeof window.IAQAR?.closeOfficeSettings === "function") {
        window.IAQAR.closeOfficeSettings();
      }
    }
  });
}
ensureSettingsNavDelegation();

window.IAQAR = window.IAQAR || {};
window.IAQAR.openOfficeSettings = openSettings;
window.IAQAR.closeOfficeSettings = closeSettings;
window.IAQAR.shareOpportunityCard = shareOpportunityCard;

async function onLogout() {
  const user = authUser();
  if (!user) {
    toast("لا يوجد حساب مسجل حاليًا");
    return;
  }
  try {
    try { localStorage.removeItem("iaqar.auth.remember"); } catch (_) { /* ignore */ }
    try { localStorage.removeItem("iaqar.pendingSharedMessage"); } catch (_) { /* ignore */ }
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (/^iaqar\.(draft|pending|cache)\./i.test(key)) localStorage.removeItem(key);
      });
    } catch (_) { /* ignore */ }
    try {
      await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);
    } catch (_) { /* ignore */ }
    await firebase.auth().signOut();
    toast("تم تسجيل الخروج");
    const officeId = window.IAQAR?.office?.officeId || "";
    const next = officeId && officeId !== "platform"
      ? `${location.pathname}?office=${encodeURIComponent(officeId)}`
      : location.pathname;
    location.assign(next);
  } catch (_) {
    toast("تعذر تسجيل الخروج الآن");
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
  await Promise.all([loadNotificationPreferences(), loadCooperationSettings()]);
}

function init() {
  el.form = document.getElementById("officeProfileForm");
  el.overlay = document.getElementById("officeSettings");
  if (!el.form || !el.overlay) return;
  if (el.overlay.dataset.officeSettingsBound === "1") return;

  el.officeName = document.getElementById("officeNameInput");
  el.nameAvailability = document.getElementById("officeNameAvailability");
  el.brokerName = document.getElementById("brokerNameInput");
  el.phone = document.getElementById("officePhoneInput");
  el.license = document.getElementById("licenseNumberInput");
  el.city = document.getElementById("officeCityInput");
  el.link = document.getElementById("officeLinkInput");
  el.linkStatus = document.getElementById("officeLinkStatus");
  el.shareLinkCard = document.getElementById("shareOfficeLinkCardBtn");
  el.save = document.getElementById("saveOfficeSettingsBtn");
  el.logout = document.getElementById("officeLogoutBtn");
  el.note = document.getElementById("officeSettingsNote");
  el.specialties = document.querySelectorAll('input[name="officeSpecialty"]');
  el.notificationInputs = document.querySelectorAll('input[name="notificationPreference"]');
  el.notificationStatus = document.getElementById("notificationPrefsStatus");
  el.cooperationInputs = document.querySelectorAll('input[name="cooperationMode"]');
  el.cooperationStatus = document.getElementById("cooperationStatus");
  el.settingsOpeners = document.querySelectorAll("#officeSettingsBtn");
  el.settingsClose = document.getElementById("officeSettingsClose");
  el.cardLogo = document.querySelector("#officeSettingsBtn img");
  el.bankOverlay = document.getElementById("opportunityBank");

  if (el.cardLogo && el.cardLogo.getAttribute("src")) {
    el.cardLogo.dataset.defaultSrc = el.cardLogo.getAttribute("src");
  }

  initImageSlots();
  writeCooperationToForm(cooperationMode);
  writePreferencesToForm(notificationPreferences);
  apply(loadLocal() || defaults);

  Array.from(el.settingsOpeners || []).forEach(button => {
    button.addEventListener("click", openSettings);
    // الأزرار تدعم Enter و Space أصلًا؛ هذا يحفظ السلوك لو تغيّر العنصر مستقبلًا.
    button.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openSettings();
    });
  });
  if (el.settingsClose) el.settingsClose.addEventListener("click", closeSettings);
  el.overlay.addEventListener("click", event => {
    if (event.target === el.overlay) closeSettings();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (el.bankOverlay && el.bankOverlay.dataset.inlineBank !== "1" && !el.bankOverlay.hidden) {
      if (typeof window.IAQAR?.closeOpportunityBank === "function") {
        window.IAQAR.closeOpportunityBank();
      } else {
        closeOpportunityBank();
      }
      return;
    }
    if (!document.getElementById("officeSettings")?.hidden) closeSettings();
  });

  window.addEventListener("iaqar:office-settings-closed", () => {
    completeSettingsClose();
  });

  el.officeName.addEventListener("input", () => {
    el.officeName.setCustomValidity("");
    clearTimeout(init.nameTimer);
    init.nameTimer = setTimeout(checkNameAvailability, 400);
  });
  el.form.addEventListener("submit", onSave);
  if (el.shareLinkCard) el.shareLinkCard.addEventListener("click", shareOfficeLinkCard);
  el.logout.addEventListener("click", onLogout);

  Array.from(el.notificationInputs || []).forEach(input => {
    input.addEventListener("change", saveNotificationPreferences);
  });
  Array.from(el.cooperationInputs || []).forEach(input => {
    input.addEventListener("change", () => {
      if (COOPERATION_MODE_VALUES.includes(input.value) && input.checked) {
        saveCooperationSettings(input.value);
      }
    });
  });

  try {
    if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(updateAuthState);
    else updateAuthState(null);
  } catch (_) {
    updateAuthState(null);
  }
  el.overlay.dataset.officeSettingsBound = "1";
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

// أدوات للاختبار الآلي فقط: لا تعتمد عليها أي واجهة.
window.IAQAR = window.IAQAR || {};
window.IAQAR.officeSettingsTestHooks = Object.freeze({
  imageVariants: OFFICE_IMAGE_VARIANTS,
  readPreferencesFromForm: () => readPreferencesFromForm(),
  currentCooperationMode: () => cooperationMode
});
