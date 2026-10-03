import test from "node:test";
import assert from "node:assert/strict";
import { checkLibraryFile, guessContentType, normalizeLibraryMeta, LIBRARY_MAIN_SECTIONS } from "../public/os/domain/library-domain.js";

test("allowed types and size limits mirror the Worker", () => {
  assert.equal(checkLibraryFile({ name: "a.pdf", type: "application/pdf", size: 1000 }).ok, true);
  assert.equal(checkLibraryFile({ name: "a.pdf", type: "application/pdf", size: 16 * 1024 * 1024 }).ok, false);
  assert.equal(checkLibraryFile({ name: "a.png", type: "image/png", size: 9 * 1024 * 1024 }).ok, false);
  assert.equal(checkLibraryFile({ name: "a.exe", type: "application/x-msdownload", size: 10 }).ok, false);
  assert.equal(checkLibraryFile({ name: "a.pdf", type: "application/pdf", size: 0 }).ok, false);
  assert.equal(checkLibraryFile(null).ok, false);
});

test("a missing or generic MIME type falls back to the extension", () => {
  assert.equal(guessContentType({ name: "x.DOCX", type: "" }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(guessContentType({ name: "x.jpeg", type: "application/octet-stream" }), "image/jpeg");
});

test("metadata is cleaned, unknown values fall back, and expiry may not precede start", () => {
  const ok = normalizeLibraryMeta({ category: "sale_contract", documentTitle: "  عقد  ", startDate: "2026-01-01", expiryDate: "2027-01-01", documentStatus: "PENDING" });
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.documentTitle, "عقد");
  const fallback = normalizeLibraryMeta({ category: "nope", documentStatus: "nope", startDate: "01/01/2026" });
  assert.equal(fallback.meta.category, "other");
  assert.equal(fallback.meta.documentStatus, "ACTIVE");
  assert.equal(fallback.meta.startDate, "");
  assert.equal(normalizeLibraryMeta({ startDate: "2026-05-10", expiryDate: "2026-05-01" }).ok, false);
});

test("the twelve old folders are all present in three sections", () => {
  assert.equal(LIBRARY_MAIN_SECTIONS.length, 3);
  assert.equal(LIBRARY_MAIN_SECTIONS.reduce((n, s) => n + s.categories.length, 0), 12);
});
