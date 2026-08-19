import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import {
  buildAgreementLibraryEntries,
  buildLibraryItem,
  libraryRowLabel,
  resolveLibraryCategory
} from "../public/js/office-library-domain.js";

test("agreement library creates mirrored entries for both offices", () => {
  const entries = buildAgreementLibraryEntries({
    agreementId: "coop_1",
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    originatingOfficeName: "مكتب أ",
    targetOfficeName: "مكتب ب",
    commissionRate: 50,
    now: new Date("2026-01-01T00:00:00.000Z")
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].officeId, "office-a");
  assert.equal(entries[1].officeId, "office-b");
  assert.equal(entries[0].agreementId, "coop_1");
  assert.equal(entries[1].agreementId, "coop_1");
});

test("library row label for manual file uses file name", () => {
  const item = buildLibraryItem({
    officeId: "office-a",
    fileName: "عقد.pdf",
    contentType: "application/pdf",
    mediaPath: "office-library/office-a/x/عقد.pdf"
  });
  assert.equal(libraryRowLabel(item), "عقد.pdf");
});

test("library upload encodes Arabic file names for HTTP headers", () => {
  const source = readRepositoryFile("public", "js", "office-library.js");
  assert.ok(source.includes("encodeURIComponent(file.name"));
  assert.ok(source.includes("guessLibraryContentType"));
  assert.ok(source.includes("pendingUploadFile"));
  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.ok(worker.includes("decodeURIComponent(fileNameRaw)"));
});

test("legacy library item resolves to other category", () => {
  const item = buildLibraryItem({
    officeId: "office-a",
    fileName: "old.jpg",
    contentType: "image/jpeg",
    mediaPath: "office-library/office-a/x/old.jpg"
  });
  delete item.category;
  assert.equal(resolveLibraryCategory(item), "other");
});
