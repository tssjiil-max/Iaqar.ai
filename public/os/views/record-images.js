/**
 * Property photos UI.
 *   imagePicker()  — in the offer form: add several photos, preview before saving, choose the
 *                    main photo, reorder, remove. Nothing is uploaded until the form is saved.
 *   imageGallery() — on the record page: main photo with thumbnails; tap to view.
 */

import { h, ic, clear } from "../core/dom.js";
import { openSheet } from "../core/ui.js";
import { arrangeRecordImages, prepareImage, uploadIntakeImage, uploadRecordImage } from "../core/record-media.js";
import { IMAGE_MESSAGES, MAX_RECORD_IMAGES, RECORD_IMAGE_ACCEPT, moveItem, recordImages } from "../domain/record-media-domain.js";

let pickerSeq = 0;

/**
 * @param {{ existing?: object[], max?: number }} opts  existing = recordImages(record)
 * @returns {{ el: HTMLElement, count: () => number, changed: () => boolean,
 *             commit: (recordId: string) => Promise<{ uploaded: number, failed: number }>,
 *             commitToIntake: (officeId: string, intakeId: string) => Promise<string[]> }}
 */
export function imagePicker({ existing = [], max = MAX_RECORD_IMAGES, hint = "" } = {}) {
  let items = existing.map((image) => ({ key: `e-${image.id}`, id: image.id, url: image.url, blob: null }));
  const initial = items.map((item) => item.id).join(",");
  // Only photos the broker removed here are deleted on save (never ones a colleague added meanwhile).
  const removedIds = new Set();
  let busy = 0;
  const grid = h("div", { class: "os-photos-grid", "data-photo-grid": "", "aria-live": "polite" });
  const message = h("small", { class: "os-field-error", role: "alert", "data-photo-error": "" });
  const counter = h("small", { class: "os-sub", "data-photo-count": "" });
  const input = h("input", { type: "file", accept: RECORD_IMAGE_ACCEPT, multiple: true, class: "os-file-hidden", "data-photo-files": "", "aria-label": "اختيار صور العقار" });
  const add = h("button", { type: "button", class: "os-btn secondary", "data-photo-add": "" }, ic("plus"), "إضافة صور");
  add.addEventListener("click", () => input.click());

  const draw = () => {
    clear(grid);
    items.forEach((item, index) => {
      const first = index === 0;
      const control = (label, iconName, name, onClick, disabled = false) => {
        const b = h("button", { type: "button", class: "os-photo-btn", "aria-label": label, title: label, "data-photo-action": name, disabled: disabled || null }, ic(iconName));
        b.addEventListener("click", onClick);
        return b;
      };
      grid.append(h("figure", { class: "os-photo" + (first ? " is-main" : ""), "data-photo": item.key, "data-photo-new": item.blob ? "1" : null },
        h("img", { src: item.url, alt: first ? "الصورة الرئيسية" : `صورة ${index + 1}`, loading: "lazy" }),
        first ? h("figcaption", { class: "os-photo-main", text: "الرئيسية" }) : null,
        h("div", { class: "os-photo-controls" },
          first ? null : control("اجعلها الصورة الرئيسية", "flag", "main", () => { items = moveItem(items, index, 0); draw(); }),
          control("تقديم", "chev-right", "earlier", () => { items = moveItem(items, index, index - 1); draw(); }, first),
          control("تأخير", "chev-left", "later", () => { items = moveItem(items, index, index + 1); draw(); }, index === items.length - 1),
          control("حذف الصورة", "trash", "remove", () => { if (item.blob) URL.revokeObjectURL(item.url); else if (item.id) removedIds.add(item.id); items = items.filter((x) => x !== item); message.textContent = ""; draw(); }))));
    });
    counter.textContent = items.length ? `${items.length} من ${max} — الصورة الأولى هي الرئيسية` : hint || `حتى ${max} صور. تُصغَّر تلقائيًا مع الحفاظ على وضوحها.`;
    add.disabled = items.length >= max || busy > 0;
  };

  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    input.value = "";
    message.textContent = "";
    for (const file of files) {
      if (items.length >= max) { message.textContent = max === MAX_RECORD_IMAGES ? IMAGE_MESSAGES.limit : `الحد الأقصى ${max} صور.`; break; }
      busy += 1; draw();
      try {
        const { blob } = await prepareImage(file);
        pickerSeq += 1;
        items = [...items, { key: `n-${pickerSeq}`, id: "", url: URL.createObjectURL(blob), blob }];
      } catch (error) {
        message.textContent = error?.message || IMAGE_MESSAGES.unreadable;
      } finally {
        busy -= 1; draw();
      }
    }
  });
  draw();

  const el = h("div", { class: "os-field os-photos", "data-photo-picker": "" },
    h("span", {}, "صور العقار", h("small", { text: " (اختياري)" })),
    grid, h("div", { class: "os-photos-foot" }, add, counter), message, input);

  return {
    el,
    count: () => items.length,
    changed: () => items.some((item) => item.blob) || items.map((item) => item.id).join(",") !== initial,
    /** Upload the new photos, then save the final order. Photos that fail are reported, never silently dropped. */
    async commit(recordId) {
      let uploaded = 0;
      let failed = 0;
      for (const item of items) {
        if (!item.blob) continue;
        try {
          const image = await uploadRecordImage(recordId, item.blob);
          URL.revokeObjectURL(item.url);
          Object.assign(item, { id: image.id, url: image.url, blob: null });
          uploaded += 1;
        } catch (error) {
          failed += 1;
          message.textContent = error?.message || "تعذر رفع صورة";
        }
      }
      const order = items.filter((item) => item.id).map((item) => item.id);
      if (uploaded || order.join(",") !== initial) await arrangeRecordImages(recordId, order, [...removedIds]);
      draw();
      return { uploaded, failed };
    },
    /** Public office link: upload in the chosen order; returns the stored paths. */
    async commitToIntake(officeId, intakeId) {
      const paths = [];
      let index = 0;
      for (const item of items) {
        if (!item.blob) continue;
        index += 1;
        paths.push(await uploadIntakeImage({ officeId, intakeId, index, blob: item.blob }));
      }
      return paths;
    }
  };
}

/** Record page: the offer's photos. Returns null when there are none. */
export function imageGallery(record) {
  const images = recordImages(record);
  if (!images.length) return null;
  const view = (image, index) => openSheet(index === 0 ? "الصورة الرئيسية" : `صورة ${index + 1}`, h("div", { class: "os-photo-full" }, h("img", { src: image.url, alt: "صورة العقار" })), { wide: true });
  const thumb = (image, index) => {
    const b = h("button", { type: "button", class: "os-gallery-thumb", "aria-label": `عرض الصورة ${index + 1}`, "data-gallery-image": image.id }, h("img", { src: image.url, alt: "", loading: "lazy" }));
    b.addEventListener("click", () => view(image, index));
    return b;
  };
  const main = h("button", { type: "button", class: "os-gallery-main", "aria-label": "عرض الصورة الرئيسية", "data-gallery-main": images[0].id }, h("img", { src: images[0].url, alt: "الصورة الرئيسية للعقار" }));
  main.addEventListener("click", () => view(images[0], 0));
  return h("div", { class: "os-gallery", "data-gallery": "" }, main,
    images.length > 1 ? h("div", { class: "os-gallery-strip" }, images.slice(1).map((image, i) => thumb(image, i + 1))) : null);
}
