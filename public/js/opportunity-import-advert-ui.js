/**
 * استيراد إعلان — واجهة المستخدم والحفظ الفعلي في بنك الفرص.
 */

import {
  ATTACHMENT_ACCEPT,
  createExtractionAdapter,
  prepareOpportunityIntake,
  validateAttachment
} from "./opportunity-intake-domain.js";
import {
  buildReviewDefaults,
  reviewValuesToBrokerFields
} from "./reference-catalog.js";
import { mergeAdvertiserFieldsIntoOpportunity } from "./advertiser-phone-domain.js";
import { isEligibleForMatchingRun } from "./opportunity-readiness-domain.js";
import { openOpportunityReview } from "./opportunity-review.js";
import {
  phase4BoundaryGuarantees,
  requestOpportunityRematch,
  shouldRematchAfterOpportunityWrite
} from "./matching-domain.js";
import {
  phase5BoundaryGuarantees,
  requestMissingDataOperationSync
} from "./operations-domain.js";
import {
  buildImportFieldStatuses,
  buildImportOpportunityExtras,
  buildImportReadinessSummary,
  findImportDuplicateOpportunities,
  importReadinessPresentation,
  importSaveButtonLabel,
  pickStrongestImportDuplicate,
  resolveSourceSiteLabel,
  validateImportUrl
} from "./opportunity-import-advert-domain.js";
import {
  authHeader,
  buildOpportunityPersistPayload,
  fileChecksum,
  fetchWithTimeout,
  persistIntake,
  resolveMediaListingText,
  resolveUrlListingText,
  sanitizeFirestoreWrite,
  uploadSourceFile,
  workerBase
} from "./add-opportunity.js";

const EXTRACTION_TIMEOUT_MS = 40000;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2600);
}

function currentOffice() {
  return window.IAQAR?.office || null;
}

function currentUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

let analyzing = false;
let saveInProgress = false;
let importSession = null;
let pendingSaveContext = null;
let duplicateHit = null;

function setImportStatus(message, isError = false) {
  const node = $("importAdvertStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

function setImportMode(mode) {
  const urlPanel = $("importAdvertUrlPanel");
  const textPanel = $("importAdvertTextPanel");
  const imagePanel = $("importAdvertImagePanel");
  const switchUrl = $("importAdvertSwitchUrl");
  const switchText = $("importAdvertSwitchText");
  const switchImage = $("importAdvertSwitchImage");
  if (urlPanel) urlPanel.hidden = mode !== "url";
  if (textPanel) textPanel.hidden = mode !== "text";
  if (imagePanel) imagePanel.hidden = mode !== "image";
  if (switchUrl) switchUrl.hidden = mode === "url";
  if (switchText) switchText.hidden = mode === "text";
  if (switchImage) switchImage.hidden = mode === "image";
}

function openImportOverlay() {
  const overlay = $("importAdvertOverlay");
  if (!overlay) return;
  importSession = null;
  duplicateHit = null;
  pendingSaveContext = null;
  setImportMode("url");
  setImportStatus("");
  const urlInput = $("importAdvertUrlInput");
  const textInput = $("importAdvertTextInput");
  if (urlInput) urlInput.value = "";
  if (textInput) textInput.value = "";
  const imageInput = $("importAdvertImageInput");
  if (imageInput) imageInput.value = "";
  const imageAnalyze = $("importAdvertImageAnalyzeBtn");
  if (imageAnalyze) imageAnalyze.hidden = true;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeImportOverlay() {
  const overlay = $("importAdvertOverlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  if (!$("opportunityReviewOverlay") || $("opportunityReviewOverlay").hidden) {
    document.body.style.overflow = "";
  }
}

function closeDuplicateOverlay() {
  const overlay = $("importDuplicateOverlay");
  if (!overlay) return;
  overlay.hidden = true;
}

function openDuplicateOverlay(hit) {
  duplicateHit = hit;
  const overlay = $("importDuplicateOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

async function listOfficeOpportunities(officeId) {
  const office = currentOffice();
  const db = window.firebase?.firestore?.();
  if (!office?.db || !db || !officeId) return [];
  const snap = await db.collection("offices").doc(officeId).collection("opportunities")
    .where("status", "==", "active")
    .limit(120)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() || {} }));
}

async function writeImportCommunication(officeId, opportunityId, activityText, userId) {
  const db = window.firebase?.firestore?.();
  if (!db || !officeId || !opportunityId || !activityText) return;
  const communicationId = `comm_import_${Date.now().toString(36)}`;
  const ref = db.collection("offices").doc(officeId)
    .collection("opportunities").doc(opportunityId)
    .collection("communications").doc(communicationId);
  await ref.set(sanitizeFirestoreWrite({
    officeId,
    opportunityId,
    type: "import",
    action: "advert_imported",
    result: activityText,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: userId || ""
  }));
}

async function analyzeImportInput({ mode, url = "", text = "", file = null } = {}) {
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId || !user?.uid) throw new Error("auth_required");

  let listingText = String(text || "").trim();
  let sourceUrl = "";
  let sourceSite = "";
  let mediaPath = "";
  let fileChecksumValue = "";
  let mediaExtractionMode = "";

  if (mode === "url") {
    const validated = validateImportUrl(url);
    if (!validated.ok) {
      const err = new Error(validated.error || "invalid_url");
      err.publicMessage = validated.message;
      throw err;
    }
    sourceUrl = validated.normalizedUrl;
    const resolved = await resolveUrlListingText(sourceUrl, office.officeId);
    if (!resolved.ok || !String(resolved.text || "").trim()) {
      const err = new Error(resolved.error || "url_resolve_failed");
      err.publicMessage = "تعذر قراءة بيانات الرابط. الصق نص الإعلان أو ارفع صورته.";
      throw err;
    }
    listingText = String(resolved.text || "").trim();
    sourceSite = resolveSourceSiteLabel(sourceUrl);
  } else if (mode === "text") {
    if (!listingText) {
      const err = new Error("empty_text");
      err.publicMessage = "الصق نص الإعلان أولًا";
      throw err;
    }
    sourceSite = "نص الإعلان";
  } else if (mode === "image") {
    if (!file) {
      const err = new Error("image_missing");
      err.publicMessage = "اختر صورة الإعلان أولًا";
      throw err;
    }
    const validated = validateAttachment(file);
    if (!validated.ok || !["image", "screenshot"].includes(validated.sourceType)) {
      const err = new Error("image_invalid");
      err.publicMessage = "صيغة الصورة غير مدعومة";
      throw err;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(String(file.type || "").toLowerCase())) {
      const err = new Error("image_type_invalid");
      err.publicMessage = "صيغة الصورة غير مدعومة";
      throw err;
    }
    fileChecksumValue = await fileChecksum(file);
    const uploaded = await uploadSourceFile(office.officeId, `src_${fileChecksumValue.slice(0, 40)}`, file);
    mediaPath = uploaded.mediaPath || "";
    const mediaResolved = await resolveMediaListingText(mediaPath, office.officeId, file);
    if (!mediaResolved.ok || !String(mediaResolved.text || "").trim()) {
      const err = new Error(mediaResolved.error || "media_extract_failed");
      err.publicMessage = "تعذر تحليل صورة الإعلان";
      throw err;
    }
    listingText = String(mediaResolved.text || "").trim();
    mediaExtractionMode = mediaResolved.extractionMode || "workers_ai_vision_adapter";
    sourceSite = "صورة الإعلان";
  }

  const prepared = await prepareOpportunityIntake({
    officeId: office.officeId,
    brokerId: user.uid,
    text: listingText,
    listingText,
    url: sourceUrl || undefined,
    sourceType: sourceUrl ? "url" : "text",
    fileChecksum: fileChecksumValue,
    mediaPath,
    fileName: file?.name || "",
    contentType: file?.type || "",
    byteSize: file?.size || 0,
    allowIncomplete: true
  }, createExtractionAdapter());

  if (!prepared.ok) throw new Error(prepared.error || "prepare_failed");
  if (mediaPath) prepared.source.mediaPath = mediaPath;
  if (mediaExtractionMode && prepared.extraction) {
    prepared.extraction.extractionMode = mediaExtractionMode;
    prepared.extraction.productionAi = false;
  }

  importSession = {
    mode,
    listingText,
    sourceUrl,
    sourceSite,
    mediaPath,
    fileChecksumValue,
    fileName: file?.name || "",
    contentType: file?.type || "",
    prepared
  };
  return importSession;
}

function openImportReview() {
  if (!importSession?.prepared) return;
  const prepared = importSession.prepared;
  const fields = prepared.fields || {};
  const reviewDefaults = buildReviewDefaults(fields, importSession.listingText, {
    extended: prepared.extraction?.extended,
    needsReview: prepared.extraction?.needsReview
  });
  const summaryRecord = { ...fields, ...importReadinessPresentation(fields) };
  const importSummary = buildImportReadinessSummary(summaryRecord);
  const approveLabel = importSaveButtonLabel(summaryRecord);
  closeImportOverlay();
  openOpportunityReview({
    fields,
    extended: prepared.extraction?.extended,
    needsReview: prepared.extraction?.needsReview,
    sourceText: importSession.listingText,
    prepared,
    reviewDefaults
  }, saveImportedAdvert, {
    title: "مراجعة الإعلان المستورد",
    subtitle: "عدّل البيانات المستخرجة ثم احفظ الإعلان في بنك الفرص.",
    approveLabel,
    importSummary,
    sourceUrl: importSession.sourceUrl || "",
    showReanalyze: true,
    onReanalyze: () => {
      openImportOverlay();
      if (importSession.mode === "url") {
        const input = $("importAdvertUrlInput");
        if (input) input.value = importSession.sourceUrl || "";
      } else if (importSession.mode === "text") {
        setImportMode("text");
        const input = $("importAdvertTextInput");
        if (input) input.value = importSession.listingText || "";
      } else {
        setImportMode("image");
      }
    }
  });
}

async function runImportAnalysis(mode, payload = {}) {
  if (analyzing) return;
  analyzing = true;
  const analyzeButtons = [
    $("importAdvertAnalyzeBtn"),
    $("importAdvertTextAnalyzeBtn"),
    $("importAdvertImageAnalyzeBtn")
  ];
  for (const btn of analyzeButtons) {
    if (btn) btn.disabled = true;
  }
  setImportStatus("جارٍ تحليل الإعلان…");
  try {
    await analyzeImportInput({ mode, ...payload });
    setImportStatus("");
    openImportReview();
  } catch (error) {
    console.warn("[iaqar:import-advert] analyze failed", error);
    const message = error?.publicMessage
      || (error?.message === "invalid_url" ? "الرابط غير صالح"
        : error?.message === "url_resolve_failed" ? "تعذر الوصول إلى الإعلان"
          : error?.message === "empty_listing_text" ? "لم نجد بيانات عقارية كافية"
            : error?.publicMessage || "تعذر تحليل الإعلان");
    setImportStatus(message, true);
  } finally {
    analyzing = false;
    for (const btn of analyzeButtons) {
      if (btn) btn.disabled = false;
    }
  }
}

async function finalizeImportSave({ forceNew = false, updateExistingId = "" } = {}) {
  if (saveInProgress || !pendingSaveContext) return;
  saveInProgress = true;
  const approveBtn = $("opportunityReviewApprove");
  if (approveBtn) {
    approveBtn.disabled = true;
    approveBtn.textContent = "جارٍ الحفظ…";
  }
  try {
    const office = currentOffice();
    const user = currentUser();
    if (!office?.officeId || !user?.uid) throw new Error("auth_required");
    const ctx = pendingSaveContext;
    const prepared = await prepareOpportunityIntake({
      officeId: office.officeId,
      brokerId: user.uid,
      text: ctx.listingText,
      listingText: ctx.listingText,
      url: ctx.sourceUrl || undefined,
      sourceType: ctx.sourceUrl ? "url" : "text",
      fileChecksum: ctx.fileChecksumValue,
      mediaPath: ctx.mediaPath,
      fileName: ctx.fileName,
      contentType: ctx.contentType,
      brokerFields: ctx.brokerFields,
      allowIncomplete: true
    }, createExtractionAdapter());
    if (!prepared.ok) throw new Error(prepared.error || "prepare_failed");
    if (ctx.mediaPath) prepared.source.mediaPath = ctx.mediaPath;

    const importExtras = buildImportOpportunityExtras({
      sourceUrl: ctx.sourceUrl,
      sourceSite: ctx.sourceSite,
      extractionConfidence: prepared.extraction?.extractionConfidence || prepared.opportunity?.extractionConfidence
    });
    prepared.opportunity = {
      ...prepared.opportunity,
      ...importExtras,
      sourceReference: prepared.source.id,
      importActivityText: importExtras.importActivityText
    };

    const reviewMeta = {
      reviewOperationTypeId: ctx.reviewOperationTypeId || "",
      reviewPropertyTypeId: ctx.reviewPropertyTypeId || "",
      reviewCityId: ctx.reviewCityId || "",
      reviewDistrictId: ctx.reviewDistrictId || "",
      extractedSnapshot: ctx.extractedSnapshot || null,
      ...mergeAdvertiserFieldsIntoOpportunity({}, ctx.advertiser || {}),
      ...importExtras
    };

    const targetOpportunityId = updateExistingId
      || (forceNew ? "" : ctx.resumeOpportunityId || prepared.opportunity.id);

    if (forceNew) {
      const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const newFingerprint = `import_new_${suffix}`;
      prepared.opportunity.id = `opp_${newFingerprint.slice(0, 40)}`;
      prepared.source.id = `src_${newFingerprint.slice(0, 40)}`;
      prepared.deduplicationFingerprint = newFingerprint;
      prepared.source.deduplicationFingerprint = newFingerprint;
      prepared.opportunity.deduplicationFingerprint = newFingerprint;
    }

    const saved = await persistIntake(prepared, reviewMeta, {
      merge: Boolean(updateExistingId || ctx.resumeOpportunityId),
      opportunityId: forceNew ? prepared.opportunity.id : (targetOpportunityId || prepared.opportunity.id)
    });

    if (!saved.duplicate) {
      await writeImportCommunication(
        office.officeId,
        saved.opportunityId,
        importExtras.importActivityText,
        user.uid
      );
    }

    toast("تمت إضافة الإعلان إلى بنك الفرص");
    pendingSaveContext = null;
    duplicateHit = null;
    importSession = null;

    void (async () => {
      const readyForMatching = isEligibleForMatchingRun({ ...prepared.opportunity, ...reviewMeta });
      let matching = { ok: false, matchCount: 0, skipped: true };
      if (readyForMatching && shouldRematchAfterOpportunityWrite({ duplicate: false })) {
        try {
          const token = await user.getIdToken();
          matching = await requestOpportunityRematch({
            workerBase: workerBase(),
            idToken: token,
            officeId: office.officeId,
            opportunityId: saved.opportunityId,
            notify: true
          });
          await requestMissingDataOperationSync({
            workerBase: workerBase(),
            idToken: token,
            officeId: office.officeId,
            opportunityId: saved.opportunityId
          });
        } catch (error) {
          console.warn("[iaqar:import-advert] rematch failed", error);
        }
      }
      window.dispatchEvent(new CustomEvent("iaqar:opportunity-ingested", {
        detail: {
          opportunityId: saved.opportunityId,
          duplicate: saved.duplicate,
          createsOperation: Boolean(matching.createsOperation),
          runsMatching: matching.ok === true,
          matchCount: Number(matching.matchCount || 0),
          productionAi: false,
          ...phase4BoundaryGuarantees(),
          ...phase5BoundaryGuarantees()
        }
      }));
      if (window.IAQAR?.pushSavedOpportunityToWorkspace) {
        window.IAQAR.pushSavedOpportunityToWorkspace({
          opportunityId: saved.opportunityId,
          duplicate: saved.duplicate,
          matchCount: Number(matching.matchCount || 0)
        });
      }
    })();
  } catch (error) {
    console.warn("[iaqar:import-advert] save failed", error);
    toast("تعذر حفظ الفرصة");
    throw error;
  } finally {
    saveInProgress = false;
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.textContent = pendingSaveContext?.approveLabel || "حفظ الإعلان في بنك الفرص";
    }
  }
}

async function saveImportedAdvert(brokerExtras, review, advertiser = {}) {
  if (saveInProgress) throw new Error("save_in_progress");
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId || !user?.uid) throw new Error("auth_required");
  if (!importSession?.prepared) throw new Error("context_missing");

  const brokerFields = reviewValuesToBrokerFields(review);
  const criteria = {
    officeId: office.officeId,
    sourceUrl: importSession.sourceUrl,
    url: importSession.sourceUrl,
    phone: advertiser.advertiserPhoneNormalized,
    contactPhone: advertiser.advertiserPhoneNormalized,
    contactType: brokerFields.opportunityKind === "OFFER" ? "owner" : "buyer",
    opportunityKind: brokerFields.opportunityKind,
    propertyType: brokerFields.propertyType,
    city: brokerFields.city,
    district: brokerFields.district,
    priceOrBudget: brokerFields.priceOrBudget,
    salePrice: brokerFields.salePrice,
    budget: brokerFields.budget,
    annualRent: brokerFields.annualRent,
    area: brokerFields.area,
    description: importSession.listingText
  };

  const docs = await listOfficeOpportunities(office.officeId);
  const hits = findImportDuplicateOpportunities(docs, criteria, office.officeId);
  const strongest = pickStrongestImportDuplicate(hits);

  pendingSaveContext = {
    listingText: importSession.listingText,
    sourceUrl: importSession.sourceUrl,
    sourceSite: importSession.sourceSite,
    mediaPath: importSession.mediaPath,
    fileChecksumValue: importSession.fileChecksumValue,
    fileName: importSession.fileName,
    contentType: importSession.contentType,
    brokerFields,
    reviewOperationTypeId: brokerExtras.reviewOperationTypeId || review.operationTypeId || "",
    reviewPropertyTypeId: brokerExtras.reviewPropertyTypeId || review.propertyTypeId || "",
    reviewCityId: brokerExtras.reviewCityId || review.cityId || "",
    reviewDistrictId: brokerExtras.reviewDistrictId || review.districtId || "",
    extractedSnapshot: brokerExtras.extractedSnapshot || null,
    advertiser,
    approveLabel: importSaveButtonLabel({ ...brokerFields, ...advertiser }),
    resumeOpportunityId: ""
  };

  if (strongest && strongest.strength === "strong") {
    openDuplicateOverlay(strongest);
    return;
  }

  await finalizeImportSave();
}

async function onDuplicateOpen() {
  if (!duplicateHit?.opportunityId) return;
  closeDuplicateOverlay();
  if (window.IAQAR?.openOpportunityBankDetail) {
    window.IAQAR.openOpportunityBankDetail(duplicateHit.opportunityId);
  } else {
    window.dispatchEvent(new CustomEvent("iaqar:open-bank-opportunity", {
      detail: { opportunityId: duplicateHit.opportunityId }
    }));
  }
}

async function onDuplicateUpdate() {
  if (!duplicateHit?.opportunityId) return;
  closeDuplicateOverlay();
  await finalizeImportSave({ updateExistingId: duplicateHit.opportunityId });
}

async function onDuplicateSaveNew() {
  const confirmed = window.confirm("هل تريد حفظ هذا الإعلان كفرصة جديدة رغم وجود فرصة مشابهة؟");
  if (!confirmed) return;
  closeDuplicateOverlay();
  await finalizeImportSave({ forceNew: true });
}

function bootImportAdvertUi() {
  const option = $("importAdvertOption");
  if (!option || option.dataset.bound === "1") return;
  option.dataset.bound = "1";

  option.addEventListener("click", () => openImportOverlay());
  $("importAdvertClose")?.addEventListener("click", () => closeImportOverlay());
  $("importAdvertOverlay")?.addEventListener("click", (event) => {
    if (event.target?.id === "importAdvertOverlay") closeImportOverlay();
  });

  $("importAdvertSwitchText")?.addEventListener("click", () => setImportMode("text"));
  $("importAdvertSwitchImage")?.addEventListener("click", () => setImportMode("image"));
  $("importAdvertSwitchUrl")?.addEventListener("click", () => setImportMode("url"));

  $("importAdvertAnalyzeBtn")?.addEventListener("click", () => {
    const url = ($("importAdvertUrlInput")?.value || "").trim();
    void runImportAnalysis("url", { url });
  });

  $("importAdvertTextAnalyzeBtn")?.addEventListener("click", () => {
    const text = ($("importAdvertTextInput")?.value || "").trim();
    void runImportAnalysis("text", { text });
  });

  const imageInput = $("importAdvertImageInput");
  $("importAdvertImageChoose")?.addEventListener("click", () => imageInput?.click());
  imageInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const analyzeBtn = $("importAdvertImageAnalyzeBtn");
    if (!file) {
      if (analyzeBtn) analyzeBtn.hidden = true;
      return;
    }
    if (analyzeBtn) analyzeBtn.hidden = false;
    importSession = importSession || {};
    importSession.pendingImageFile = file;
  });
  $("importAdvertImageAnalyzeBtn")?.addEventListener("click", () => {
    const file = importSession?.pendingImageFile;
    void runImportAnalysis("image", { file });
  });

  $("importDuplicateClose")?.addEventListener("click", () => closeDuplicateOverlay());
  $("importDuplicateOpen")?.addEventListener("click", () => void onDuplicateOpen());
  $("importDuplicateUpdate")?.addEventListener("click", () => void onDuplicateUpdate());
  $("importDuplicateSaveNew")?.addEventListener("click", () => void onDuplicateSaveNew());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootImportAdvertUi, { once: true });
} else {
  bootImportAdvertUi();
}

export const __test = {
  validateImportUrl,
  buildImportReadinessSummary,
  findImportDuplicateOpportunities,
  analyzeImportInput,
  saveImportedAdvert
};
