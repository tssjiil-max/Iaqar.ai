import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkPhotoFile, containFit, isSafePhotoDataUrl, squareCrop, MAX_PHOTO_INPUT_BYTES, PHOTO_SIZE } from "../public/os/domain/avatar-domain.js";

test("photo file: only images, sane size", () => {
  assert.equal(checkPhotoFile({ type: "image/png", size: 1000 }).ok, true);
  assert.equal(checkPhotoFile({ type: "application/x-msdownload", size: 10 }).ok, false);
  assert.equal(checkPhotoFile({ type: "image/svg+xml", size: 10 }).ok, false);
  assert.equal(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_INPUT_BYTES + 1 }).ok, false);
  assert.equal(checkPhotoFile(null).ok, false);
});

test("stored photo must be our small inline JPEG — never a URL or script", () => {
  assert.equal(isSafePhotoDataUrl("data:image/jpeg;base64,AAAA"), true);
  for (const bad of ["", null, "https://x.test/a.jpg", "javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "data:text/html;base64,AAAA", `data:image/jpeg;base64,${"A".repeat(70001)}`]) assert.equal(isSafePhotoDataUrl(bad), false, String(bad).slice(0, 30));
});

test("crop is a centred square", () => {
  assert.deepEqual(squareCrop(900, 500), { sx: 200, sy: 0, side: 500 });
  assert.deepEqual(squareCrop(400, 800), { sx: 0, sy: 200, side: 400 });
});

test("an uploaded logo is kept whole: scaled to fit, centred, never cropped", () => {
  assert.deepEqual(containFit(900, 300, 256), { dx: 0, dy: 85, dw: 256, dh: 85 }, "wide logo: full width, letterboxed");
  assert.deepEqual(containFit(300, 900, 256), { dx: 85, dy: 0, dw: 85, dh: 256 }, "tall logo: full height");
  assert.deepEqual(containFit(512, 512), { dx: 0, dy: 0, dw: PHOTO_SIZE, dh: PHOTO_SIZE }, "square fills the frame");
  for (const [w, h] of [[1200, 630], [40, 400], [3, 2]]) {
    const fit = containFit(w, h, 256);
    assert.ok(fit.dw <= 256 && fit.dh <= 256 && fit.dx >= 0 && fit.dy >= 0, "stays inside the frame");
    assert.ok(Math.abs(fit.dw / fit.dh - w / h) < 0.06, "aspect ratio kept");
  }
  assert.deepEqual(containFit(0, 10), { dx: 0, dy: 0, dw: 0, dh: 0 });
  const save = fs.readFileSync(path.resolve("public/os/core/office-profile.js"), "utf8");
  assert.match(save, /containFit\(bitmap\.width, bitmap\.height/, "the upload path must not crop");
  assert.doesNotMatch(save, /squareCrop\(/, "no square crop when saving the office image");
  const css = fs.readFileSync(path.resolve("public/os/os.css"), "utf8");
  assert.match(css, /\.ref-office-logo-box \.ref-office-avatar\s*\{[^}]*object-fit:\s*contain/, "office card shows the whole image");
  assert.doesNotMatch(css, /\.ref-office-logo-box \.ref-office-avatar\s*\{[^}]*border-radius:\s*50%/, "no circular mask cutting the logo corners");
});

test("the Office OS app never navigates to the old app except any screen", () => {
  const dir = path.resolve("public/os");
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.js$/.test(e.name)) fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (/legacy\.html/.test(line) && !/^\s*(\*|\/\/)/.test(line)) hits.push(`${path.relative(dir, f)}:${i + 1}`); });
  });
  walk(dir);
  assert.deepEqual(hits, [], hits.join(", "));
});
