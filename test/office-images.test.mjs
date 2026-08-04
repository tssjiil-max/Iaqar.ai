// Phase 1 visual identity: crop presets, crop geometry, validation and storage keys.
// Directive §7.1: upload, preview, crop, replace, remove when allowed, validation, and a
// cover crop ratio that is a configurable design setting rather than a hard-coded
// unverified external platform dimension.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  OFFICE_IMAGE_MESSAGES,
  OFFICE_IMAGE_PRESETS,
  OFFICE_IMAGE_VARIANTS,
  cropRectForAspect,
  imagePreset,
  officeImageStorageKey,
  validateImageFile
} from "../public/js/office-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("the three approved identity images each have a preset", () => {
  assert.deepEqual([...OFFICE_IMAGE_VARIANTS].sort(), ["cover", "display", "logo"]);
  for (const variant of OFFICE_IMAGE_VARIANTS) {
    const preset = imagePreset(variant);
    assert.ok(preset, variant);
    assert.equal(preset.variant, variant);
    assert.ok(preset.aspectRatio > 0, `${variant} needs a positive ratio`);
    assert.ok(preset.outputWidth > 0 && preset.outputHeight > 0, variant);
    assert.ok(ACCEPTED_IMAGE_TYPES[preset.outputType], `${variant} output type must be one we accept`);
  }
  assert.equal(imagePreset("nope"), null);
});

test("output dimensions agree with the declared aspect ratio", () => {
  for (const preset of Object.values(OFFICE_IMAGE_PRESETS)) {
    const actual = preset.outputWidth / preset.outputHeight;
    assert.ok(
      Math.abs(actual - preset.aspectRatio) < 0.01,
      `${preset.variant}: ${actual} vs ${preset.aspectRatio}`
    );
  }
});

test("the logo is square, the display image is 4:3 and the cover is wide", () => {
  assert.equal(OFFICE_IMAGE_PRESETS.logo.aspectRatio, 1);
  assert.ok(Math.abs(OFFICE_IMAGE_PRESETS.display.aspectRatio - 4 / 3) < 0.001);
  assert.ok(OFFICE_IMAGE_PRESETS.cover.aspectRatio > 1.5, "the share cover must be wide");
});

test("the cover ratio lives only in the preset, so it stays configurable", () => {
  // Directive §7.1: the ratio must be changeable without rewriting the upload workflow.
  // If the number leaks into the settings module or the shell, that promise is broken.
  const ratio = String(OFFICE_IMAGE_PRESETS.cover.aspectRatio);
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  assert.equal(settings.includes(ratio), false, "office-settings.js must read the ratio from the preset");
  const domain = readRepositoryFile("public", "js", "office-domain.js");
  const occurrences = domain.split(ratio).length - 1;
  assert.equal(occurrences, 1, `the cover ratio literal should appear once, found ${occurrences}`);
});

test("the cover ratio is documented as our default, not as a verified WhatsApp requirement", () => {
  const domain = readRepositoryFile("public", "js", "office-domain.js");
  assert.match(
    domain.replace(/\s+\*\s+/g, " ").replace(/\s+/g, " "),
    /not a verified WhatsApp requirement/i,
    "the preset must say plainly that the ratio is unverified"
  );
  const claims = [
    "whatsapp recommends",
    "whatsapp requires",
    "required by whatsapp",
    "official whatsapp",
    "whatsapp official",
    "per whatsapp spec"
  ];
  for (const [name, source] of Object.entries({
    "office-domain.js": domain,
    "office-settings.js": readRepositoryFile("public", "js", "office-settings.js"),
    "index.html": readRepositoryFile("public", "index.html")
  })) {
    const lowered = source.toLowerCase();
    for (const claim of claims) {
      assert.equal(lowered.includes(claim), false, `${name} asserts: ${claim}`);
    }
  }
});

test("only the removable variants may be removed", () => {
  assert.equal(OFFICE_IMAGE_PRESETS.logo.removable, true);
  assert.equal(OFFICE_IMAGE_PRESETS.display.removable, true);
  // The cover feeds the office card and every share preview, so it is replace-only.
  assert.equal(OFFICE_IMAGE_PRESETS.cover.removable, false);
});

test("image validation accepts the three approved types and rejects anything else", () => {
  for (const type of Object.keys(ACCEPTED_IMAGE_TYPES)) {
    assert.equal(validateImageFile({ type, size: 1024 }), "");
  }
  for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/html", "", "IMAGE/BMP"]) {
    assert.equal(validateImageFile({ type, size: 1024 }), OFFICE_IMAGE_MESSAGES.type, type);
  }
});

test("image validation is case-insensitive about the mime type", () => {
  assert.equal(validateImageFile({ type: "IMAGE/PNG", size: 10 }), "");
});

test("image validation enforces the 10 MB ceiling", () => {
  assert.equal(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES }), "");
  assert.equal(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }), OFFICE_IMAGE_MESSAGES.size);
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});

test("a missing file is reported as missing rather than as a type error", () => {
  assert.equal(validateImageFile(null), OFFICE_IMAGE_MESSAGES.missing);
  assert.equal(validateImageFile(undefined), OFFICE_IMAGE_MESSAGES.missing);
});

test("the crop rectangle is the largest centred rectangle of the requested ratio", () => {
  // Wide source, square target: full height, centred horizontally.
  assert.deepEqual(
    cropRectForAspect({ naturalWidth: 400, naturalHeight: 200, aspectRatio: 1 }),
    { sourceX: 100, sourceY: 0, sourceWidth: 200, sourceHeight: 200 }
  );
  // Tall source, square target: full width, centred vertically.
  assert.deepEqual(
    cropRectForAspect({ naturalWidth: 200, naturalHeight: 400, aspectRatio: 1 }),
    { sourceX: 0, sourceY: 100, sourceWidth: 200, sourceHeight: 200 }
  );
  // Square source, wide target: full width, centred vertically.
  assert.deepEqual(
    cropRectForAspect({ naturalWidth: 1000, naturalHeight: 1000, aspectRatio: 2 }),
    { sourceX: 0, sourceY: 250, sourceWidth: 1000, sourceHeight: 500 }
  );
});

test("a source already at the target ratio is not cropped", () => {
  assert.deepEqual(
    cropRectForAspect({ naturalWidth: 1200, naturalHeight: 628, aspectRatio: 1200 / 628 }),
    { sourceX: 0, sourceY: 0, sourceWidth: 1200, sourceHeight: 628 }
  );
});

test("the crop offset repositions the rectangle and stays inside the image", () => {
  const top = cropRectForAspect({ naturalWidth: 200, naturalHeight: 400, aspectRatio: 1, offsetY: 0 });
  const bottom = cropRectForAspect({ naturalWidth: 200, naturalHeight: 400, aspectRatio: 1, offsetY: 1 });
  assert.equal(top.sourceY, 0);
  assert.equal(bottom.sourceY, 200);
  assert.equal(bottom.sourceY + bottom.sourceHeight, 400, "the crop must not run past the image");

  const left = cropRectForAspect({ naturalWidth: 400, naturalHeight: 200, aspectRatio: 1, offsetX: 0 });
  const right = cropRectForAspect({ naturalWidth: 400, naturalHeight: 200, aspectRatio: 1, offsetX: 1 });
  assert.equal(left.sourceX, 0);
  assert.equal(right.sourceX + right.sourceWidth, 400);
});

test("out-of-range and non-numeric offsets are clamped instead of producing a bad crop", () => {
  for (const offsetY of [-5, 2, Number.NaN, "abc", null, undefined]) {
    const rect = cropRectForAspect({ naturalWidth: 200, naturalHeight: 400, aspectRatio: 1, offsetY });
    assert.ok(rect.sourceY >= 0 && rect.sourceY + rect.sourceHeight <= 400, `offsetY ${offsetY}`);
  }
});

test("degenerate inputs return no rectangle rather than a broken one", () => {
  for (const input of [
    { naturalWidth: 0, naturalHeight: 100, aspectRatio: 1 },
    { naturalWidth: 100, naturalHeight: 0, aspectRatio: 1 },
    { naturalWidth: 100, naturalHeight: 100, aspectRatio: 0 },
    { naturalWidth: 100, naturalHeight: 100, aspectRatio: -1 },
    {}
  ]) {
    assert.equal(cropRectForAspect(input), null, JSON.stringify(input));
  }
});

test("every crop preset produces a usable rectangle for a realistic photo", () => {
  for (const preset of Object.values(OFFICE_IMAGE_PRESETS)) {
    const rect = cropRectForAspect({
      naturalWidth: 4032,
      naturalHeight: 3024,
      aspectRatio: preset.aspectRatio
    });
    assert.ok(rect.sourceWidth > 0 && rect.sourceHeight > 0, preset.variant);
    assert.ok(rect.sourceX + rect.sourceWidth <= 4032, preset.variant);
    assert.ok(rect.sourceY + rect.sourceHeight <= 3024, preset.variant);
    const ratio = rect.sourceWidth / rect.sourceHeight;
    assert.ok(Math.abs(ratio - preset.aspectRatio) < 0.01, `${preset.variant}: ${ratio}`);
  }
});

test("storage keys are scoped to the office and to a known variant", () => {
  assert.equal(officeImageStorageKey("office-alqiq", "logo"), "office-covers/office-alqiq/logo");
  assert.equal(officeImageStorageKey("office-alqiq", "display"), "office-covers/office-alqiq/display");
  assert.equal(officeImageStorageKey("office-alqiq", "cover"), "office-covers/office-alqiq/cover");
});

test("storage keys refuse traversal, empty and unknown inputs", () => {
  for (const officeId of ["", "../other", "office/../../etc", "OFFICE UPPER", "a".repeat(81)]) {
    assert.equal(officeImageStorageKey(officeId, "logo"), "", JSON.stringify(officeId));
  }
  assert.equal(officeImageStorageKey("office-alqiq", "private"), "");
  assert.equal(officeImageStorageKey("office-alqiq", ""), "");
});

test("the worker accepts exactly the variants the client can produce", () => {
  const worker = readRepositoryFile("worker", "src", "index.js");
  const declared = worker.match(/OFFICE_IMAGE_VARIANTS = Object\.freeze\(\[([^\]]+)\]\)/);
  assert.ok(declared, "worker must declare its accepted variants");
  const workerVariants = declared[1].split(",").map(part => part.trim().replace(/"/g, "")).sort();
  assert.deepEqual(workerVariants, [...OFFICE_IMAGE_VARIANTS].sort());

  // The public serving route must allow the same set and nothing more, or an uploaded
  // image would 404 — or worse, a private key would become readable.
  assert.ok(
    worker.includes("^office-covers\\/[a-z0-9_-]{1,80}\\/(cover|logo|display)$"),
    "the public media route must allow-list exactly the office image keys"
  );
});
