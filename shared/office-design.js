(function (global, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.IAQAR = global.IAQAR || {};
  global.IAQAR.OfficeDesign = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Configurable visual-identity design settings.
   * Update whatsappCoverCropRatio here without rewriting the upload workflow.
   * Default 1.91 approximates common wide link-preview style covers.
   */
  const OFFICE_IMAGE_DESIGN = Object.freeze({
    maxBytes: 10 * 1024 * 1024,
    acceptMimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    displayCoverCropRatio: 16 / 9,
    whatsappCoverCropRatio: 1.91,
    logoCropRatio: 1,
    labels: Object.freeze({
      logo: "شعار المكتب",
      displayCover: "صورة العرض",
      whatsappCover: "ترويسة واتساب العريضة"
    })
  });

  function isAcceptedImageType(mimeType) {
    return OFFICE_IMAGE_DESIGN.acceptMimeTypes.indexOf(String(mimeType || "").toLowerCase()) !== -1;
  }

  function validateImageFile(file) {
    if (!file) return "اختر صورة أولاً";
    if (!isAcceptedImageType(file.type)) return "اختر صورة JPG أو PNG أو WebP";
    if (file.size > OFFICE_IMAGE_DESIGN.maxBytes) {
      return "حجم الصورة يتجاوز 10 ميجابايت";
    }
    return "";
  }

  function cropRatioForKind(kind) {
    const key = String(kind || "").toLowerCase();
    if (key === "logo") return OFFICE_IMAGE_DESIGN.logoCropRatio;
    if (key === "whatsapp-cover" || key === "whatsapp_cover") {
      return OFFICE_IMAGE_DESIGN.whatsappCoverCropRatio;
    }
    return OFFICE_IMAGE_DESIGN.displayCoverCropRatio;
  }

  /**
   * Compute source rectangle for a centered cover crop at the target ratio.
   */
  function computeCoverCropRect(naturalWidth, naturalHeight, ratio) {
    const width = Number(naturalWidth) || 0;
    const height = Number(naturalHeight) || 0;
    const targetRatio = Number(ratio) > 0 ? Number(ratio) : OFFICE_IMAGE_DESIGN.displayCoverCropRatio;
    if (width <= 0 || height <= 0) {
      return { sx: 0, sy: 0, sw: 0, sh: 0, ratio: targetRatio };
    }
    const imageRatio = width / height;
    if (imageRatio > targetRatio) {
      const sw = Math.round(height * targetRatio);
      const sx = Math.round((width - sw) / 2);
      return { sx: sx, sy: 0, sw: sw, sh: height, ratio: targetRatio };
    }
    const sh = Math.round(width / targetRatio);
    const sy = Math.round((height - sh) / 2);
    return { sx: 0, sy: sy, sw: width, sh: sh, ratio: targetRatio };
  }

  return {
    OFFICE_IMAGE_DESIGN,
    isAcceptedImageType,
    validateImageFile,
    cropRatioForKind,
    computeCoverCropRect
  };
});
