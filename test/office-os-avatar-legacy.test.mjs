import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkPhotoFile, isSafePhotoDataUrl, squareCrop, MAX_PHOTO_INPUT_BYTES } from "../public/os/domain/avatar-domain.js";

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

test("the Office OS app never navigates to the old app except the two pre-login entries", () => {
  const dir = path.resolve("public/os");
  const hits = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.js$/.test(e.name)) fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (/legacy\.html/.test(line) && !/^\s*(\*|\/\/)/.test(line)) hits.push(`${path.relative(dir, f)}:${i + 1}`); });
  });
  walk(dir);
  assert.deepEqual(hits.filter((h) => !h.startsWith("views/login.js")), [], hits.join(", "));
});
