/**
 * Interactive square image crop modal with pan and zoom.
 * Returns a 512×512 PNG blob plus crop parameters.
 */

import { cropRectForAspect } from "./office-domain.js";

const CROP_VIEWPORT_PX = 280;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createModal() {
  const overlay = document.createElement("div");
  overlay.className = "image-crop-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.innerHTML = `
    <div class="image-crop-sheet">
      <header class="image-crop-head">
        <strong>قص شعار المكتب</strong>
        <p>اسحب لتحريك الصورة، واستخدم التكبير قبل الحفظ</p>
      </header>
      <div class="image-crop-viewport" data-role="viewport">
        <img data-role="image" alt="" draggable="false">
      </div>
      <label class="image-crop-zoom-label" for="imageCropZoom">التكبير</label>
      <input id="imageCropZoom" class="image-crop-zoom" type="range" min="100" max="300" value="100" data-role="zoom">
      <div class="image-crop-actions">
        <button type="button" class="image-crop-btn" data-role="cancel">إلغاء</button>
        <button type="button" class="image-crop-btn primary" data-role="save">حفظ القص</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function baseScaleForCover(image, viewportSize) {
  return Math.max(viewportSize / image.naturalWidth, viewportSize / image.naturalHeight);
}

function computePanLimits(image, viewportSize, zoomFactor) {
  const scale = baseScaleForCover(image, viewportSize) * zoomFactor;
  const displayW = image.naturalWidth * scale;
  const displayH = image.naturalHeight * scale;
  const maxX = Math.max(0, (displayW - viewportSize) / 2);
  const maxY = Math.max(0, (displayH - viewportSize) / 2);
  return { scale, maxX, maxY };
}

function applyTransform(imageEl, panX, panY, scale) {
  imageEl.style.transform = `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${scale})`;
}

function panToOffsets(panX, panY, limits) {
  const offsetX = limits.maxX > 0 ? (panX + limits.maxX) / (2 * limits.maxX) : 0.5;
  const offsetY = limits.maxY > 0 ? (panY + limits.maxY) / (2 * limits.maxY) : 0.5;
  return { offsetX: clamp(offsetX, 0, 1), offsetY: clamp(offsetY, 0, 1) };
}

function offsetsToPan(offsetX, offsetY, limits) {
  return {
    panX: limits.maxX > 0 ? offsetX * 2 * limits.maxX - limits.maxX : 0,
    panY: limits.maxY > 0 ? offsetY * 2 * limits.maxY - limits.maxY : 0
  };
}

/**
 * @param {object} options
 * @param {HTMLImageElement} options.image
 * @param {number} [options.aspectRatio=1]
 * @param {number} [options.outputWidth=512]
 * @param {number} [options.outputHeight=512]
 * @param {number} [options.initialOffsetX=0.5]
 * @param {number} [options.initialOffsetY=0.5]
 * @param {number} [options.initialZoom=1]
 * @returns {Promise<{blob: Blob, offsetX: number, offsetY: number, zoom: number}>}
 */
export function openImageCropModal({
  image,
  aspectRatio = 1,
  outputWidth = 512,
  outputHeight = 512,
  initialOffsetX = 0.5,
  initialOffsetY = 0.5,
  initialZoom = 1
} = {}) {
  return new Promise((resolve, reject) => {
    if (!image || !image.naturalWidth) {
      reject(new Error("IMAGE_DECODE_FAILED"));
      return;
    }

    const overlay = createModal();
    const viewport = overlay.querySelector('[data-role="viewport"]');
    const imageEl = overlay.querySelector('[data-role="image"]');
    const zoomInput = overlay.querySelector('[data-role="zoom"]');
    const cancelBtn = overlay.querySelector('[data-role="cancel"]');
    const saveBtn = overlay.querySelector('[data-role="save"]');

    imageEl.src = image.src;
    imageEl.style.width = `${image.naturalWidth}px`;
    imageEl.style.height = `${image.naturalHeight}px`;
    let zoomFactor = Math.max(1, initialZoom);
    zoomInput.value = String(Math.round(zoomFactor * 100));

    let limits = computePanLimits(image, CROP_VIEWPORT_PX, zoomFactor);
    let pan = offsetsToPan(initialOffsetX, initialOffsetY, limits);
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panStartX = 0;
    let panStartY = 0;

    function refreshTransform() {
      limits = computePanLimits(image, CROP_VIEWPORT_PX, zoomFactor);
      pan.panX = clamp(pan.panX, -limits.maxX, limits.maxX);
      pan.panY = clamp(pan.panY, -limits.maxY, limits.maxY);
      applyTransform(imageEl, pan.panX, pan.panY, limits.scale);
    }

    function setZoomFromInput() {
      zoomFactor = Number(zoomInput.value) / 100;
      refreshTransform();
    }

    function finish(result) {
      overlay.remove();
      resolve(result);
    }

    function abort() {
      overlay.remove();
      reject(new Error("CROP_CANCELLED"));
    }

    function onPointerDown(event) {
      dragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      panStartX = pan.panX;
      panStartY = pan.panY;
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    }

    function onPointerMove(event) {
      if (!dragging) return;
      pan.panX = panStartX + (event.clientX - dragStartX);
      pan.panY = panStartY + (event.clientY - dragStartY);
      refreshTransform();
    }

    function onPointerUp(event) {
      dragging = false;
      try { viewport.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    function onWheel(event) {
      event.preventDefault();
      const delta = event.deltaY > 0 ? -8 : 8;
      zoomInput.value = String(clamp(Number(zoomInput.value) + delta, 100, 300));
      setZoomFromInput();
    }

    async function renderCropBlob() {
      const { offsetX, offsetY } = panToOffsets(pan.panX, pan.panY, limits);
      const rect = cropRectForAspect({
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        aspectRatio,
        offsetX,
        offsetY,
        zoom: zoomFactor
      });
      if (!rect) throw new Error("IMAGE_CROP_FAILED");

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("IMAGE_CROP_FAILED");
      ctx.drawImage(
        image,
        rect.sourceX, rect.sourceY, rect.sourceWidth, rect.sourceHeight,
        0, 0, outputWidth, outputHeight
      );
      const blob = await new Promise((res, rej) => {
        canvas.toBlob(b => (b ? res(b) : rej(new Error("IMAGE_CROP_FAILED"))), "image/png", 1);
      });
      return { blob, offsetX, offsetY, zoom: zoomFactor };
    }

    zoomInput.addEventListener("input", setZoomFromInput);
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    cancelBtn.addEventListener("click", abort);
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        const result = await renderCropBlob();
        finish(result);
      } catch (error) {
        saveBtn.disabled = false;
        reject(error);
      }
    });

    refreshTransform();
    requestAnimationFrame(() => overlay.classList.add("is-open"));
  });
}
