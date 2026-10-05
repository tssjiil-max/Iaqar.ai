// Office OS — property photos through the real Worker on the in-memory Firestore and media doubles.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  IMAGE_LONG_EDGE, MAX_IMAGE_UPLOAD_BYTES, MAX_RECORD_IMAGES, RECORD_IMAGE_KEY_PATTERN, arrangeImages, checkImageFile, coverUrlOf,
  fitWithin, imageFields, isImageId, keyBelongsTo, moveItem, recordImageKey, recordImageUrl, recordImages, sniffImageType
} from "../public/os/domain/record-media-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, BROKER_A2, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const JPEG = (size = 64, fill = 7) => { const b = new Uint8Array(size).fill(fill); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
const PNG = () => { const b = new Uint8Array(40).fill(1); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const WEBP = () => { const b = new Uint8Array(40).fill(2); b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b; };

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
async function upload(recordId, bytes, uid, { officeId = OFFICE_A, type = "image/jpeg" } = {}) {
  const headers = { "content-type": type, "content-length": String(bytes.length), "x-office-id": officeId, "x-record-id": recordId };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request("https://worker.test/media/record-image", { method: "POST", headers, body: bytes }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const fetchPublic = (url) => h.worker.fetch(new Request(url.replace(/^https?:\/\/[^/]+(\/worker)?/, "https://worker.test")), h.env, { waitUntil() {} });
const doc = (id, office = OFFICE_A) => h.store.get(`offices/${office}/opportunities/${id}`);
const ctx = {};

test("domain: type is read from the bytes; sizes, keys and ids are strict", () => {
  assert.equal(sniffImageType(JPEG()), "image/jpeg");
  assert.equal(sniffImageType(PNG()), "image/png");
  assert.equal(sniffImageType(WEBP()), "image/webp");
  for (const bad of [new Uint8Array(0), new TextEncoder().encode("<html><script>alert(1)</script>"), new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), new Uint8Array([0x47, 0x49, 0x46, 0x38])]) assert.equal(sniffImageType(bad), "");
  assert.deepEqual(fitWithin(4000, 3000), { width: IMAGE_LONG_EDGE, height: 1200 });
  assert.deepEqual(fitWithin(900, 1800), { width: 800, height: IMAGE_LONG_EDGE });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 }, "small photos are never enlarged");
  assert.deepEqual(fitWithin(0, 10), { width: 0, height: 0 });
  assert.equal(checkImageFile({ type: "image/jpeg", size: 1000 }).ok, true);
  assert.equal(checkImageFile({ type: "image/svg+xml", size: 10 }).ok, false);
  assert.equal(checkImageFile({ type: "application/pdf", size: 10 }).ok, false);
  assert.equal(checkImageFile({ type: "image/png", size: 0 }).ok, false);
  const id = "0123456789abcdef0123456789abcdef";
  const key = recordImageKey("office-a", "opp_1", id, "image/jpeg");
  assert.equal(key, `record-media/office-a/opp_1/${id}.jpg`);
  assert.match(key, RECORD_IMAGE_KEY_PATTERN);
  assert.equal(recordImageKey("office-a", "../x", id, "image/jpeg"), "", "no path tricks in the record id");
  assert.equal(recordImageKey("office-a", "opp_1", "short", "image/jpeg"), "");
  assert.equal(recordImageKey("office-a", "opp_1", id, "image/gif"), "");
  assert.equal(isImageId(id.toUpperCase()), false);
  assert.equal(keyBelongsTo(key, "office-a", "opp_1"), true);
  assert.equal(keyBelongsTo(key, "office-b", "opp_1"), false);
  assert.equal(keyBelongsTo(`office-covers/office-a/logo`, "office-a", "opp_1"), false);
  assert.equal(recordImageUrl("https://w.test/", key), `https://w.test/media/public/${key}`);
  assert.equal(recordImageUrl("https://w.test", "office-library/office-a/x/secret.pdf"), "", "only record photos get a public address");
});

test("domain: arrangement keeps only chosen ids in order; the first photo is the main one", () => {
  const img = (n) => ({ id: String(n).repeat(32), url: `https://w.test/${n}`, path: `record-media/o/r/${String(n).repeat(32)}.jpg` });
  const list = [img(1), img(2), img(3)];
  const arranged = arrangeImages(list, [list[2].id, "unknown", list[0].id, list[2].id]);
  assert.deepEqual(arranged.images.map((i) => i.id[0]), ["3", "1"]);
  assert.deepEqual(arranged.removed.map((i) => i.id[0]), ["2"]);
  assert.equal(coverUrlOf(arranged.images), "https://w.test/3");
  assert.deepEqual(imageFields([]), { images: [], coverUrl: null, imageCount: 0 });
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 5), ["a", "b", "c"], "out-of-range moves change nothing");
  const dirty = recordImages({ images: [list[0], list[0], { id: "x", url: "javascript:alert(1)", path: "p" }, null, { ...img(4), url: "data:text/html,x" }, list[1]] });
  assert.deepEqual(dirty.map((i) => i.id[0]), ["1", "2"], "duplicates and malformed entries are dropped");
});

test("a member uploads photos to an offer of his office; the first is the cover", async () => {
  const saved = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "media-1", record: { kind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض", district: "حطين", price: 3100000, contactName: "مالك الصور", contactPhone: "0554440000" } }, OWNER_A);
  ctx.offerId = saved.body.recordId;
  const version = doc(ctx.offerId).version;
  const first = await upload(ctx.offerId, JPEG(200, 1), OWNER_A);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await upload(ctx.offerId, PNG(), BROKER_A2, { type: "image/png" });
  assert.equal(second.status, 201, "any member of the office may add photos");
  const third = await upload(ctx.offerId, WEBP(), OWNER_A, { type: "image/jpeg" });
  assert.equal(third.body.image.contentType, "image/webp", "the stored type comes from the bytes, not the header");
  const record = doc(ctx.offerId);
  const images = recordImages(record);
  assert.equal(images.length, 3);
  assert.equal(record.imageCount, 3);
  assert.equal(record.coverUrl, images[0].url);
  assert.equal(record.version, version, "photos never change the matching version");
  for (const image of images) {
    assert.ok(keyBelongsTo(image.path, OFFICE_A, ctx.offerId));
    assert.ok(isImageId(image.id));
    assert.ok(image.uploadedBy);
  }
  ctx.images = images;
  const served = await fetchPublic(images[0].url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  assert.match(served.headers.get("cache-control"), /immutable/);
  assert.equal((await served.arrayBuffer()).byteLength, 200);
});

test("uploads are refused without membership, for another office, for requests, for non-images and oversize files", async () => {
  assert.equal((await upload(ctx.offerId, JPEG())).status, 401, "no token");
  assert.equal((await upload(ctx.offerId, JPEG(), OWNER_B)).status, 403, "member of another office");
  assert.equal((await upload(ctx.offerId, JPEG(), OWNER_B, { officeId: OFFICE_B })).status, 404, "the record does not exist in office B");
  assert.equal((await upload("opp_b_offer", JPEG(), OWNER_A)).status, 404, "office B's record is not reachable from office A");
  assert.equal((await upload("../../x", JPEG(), OWNER_A)).status, 400);
  const html = await upload(ctx.offerId, new TextEncoder().encode("<html><script>alert(1)</script></html>"), OWNER_A);
  assert.equal(html.status, 415, "declared image/jpeg but not an image");
  const big = await upload(ctx.offerId, JPEG(MAX_IMAGE_UPLOAD_BYTES + 1), OWNER_A);
  assert.equal(big.status, 413);
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "media-req", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "الرياض", district: "الخير", price: 500000, contactName: "عميل", contactPhone: "0554440001" } }, OWNER_A);
  assert.equal((await upload(request.body.recordId, JPEG(), OWNER_A)).status, 409, "requests never carry photos");
  assert.equal(recordImages(doc(ctx.offerId)).length, 3, "nothing was added by the refused uploads");
  assert.equal(h.env.IAQAR_MEDIA.keys().filter((k) => k.startsWith("record-media/")).length, 3, "no stray files were stored");
});

test("only well-formed photo addresses are served", async () => {
  for (const bad of [
    "https://worker.test/media/public/record-media/office-alpha/x/not-an-id.jpg",
    "https://worker.test/media/public/record-media/office-alpha/../office-library/secret.pdf",
    `https://worker.test/media/public/record-media/${OFFICE_A}/${ctx.offerId}/${"f".repeat(32)}.jpg`,
    `https://worker.test/media/public/record-media/${OFFICE_A}/${ctx.offerId}/${ctx.images[0].id}.png`
  ]) {
    const response = await h.worker.fetch(new Request(bad), h.env, { waitUntil() {} });
    assert.equal(response.status, 404, bad);
  }
});

test("arrange: choose the main photo, reorder and remove — removed files are deleted", async () => {
  const [a, b, c] = ctx.images;
  const foreign = await call("/os/records/media", { officeId: OFFICE_A, recordId: ctx.offerId, order: [a.id] }, OWNER_B);
  assert.equal(foreign.status, 403);
  const arranged = await call("/os/records/media", { officeId: OFFICE_A, recordId: ctx.offerId, order: [c.id, a.id] }, OWNER_A);
  assert.equal(arranged.status, 200, JSON.stringify(arranged.body));
  assert.deepEqual(arranged.body.images.map((i) => i.id), [c.id, a.id]);
  const record = doc(ctx.offerId);
  assert.equal(record.coverUrl, c.url, "the first photo is the main one");
  assert.equal(record.imageCount, 2);
  assert.equal((await fetchPublic(b.url)).status, 404, "the removed photo's file is gone");
  assert.equal((await fetchPublic(a.url)).status, 200);
  const same = await call("/os/records/media", { officeId: OFFICE_A, recordId: ctx.offerId, order: [c.id, a.id] }, OWNER_A);
  assert.equal(same.body.changed, false, "saving the same arrangement is a no-op");
  const missing = await call("/os/records/media", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(missing.status, 400, "an arrangement is required (never an accidental wipe)");
  assert.equal(recordImages(doc(ctx.offerId)).length, 2);
  const audit = h.store.list(`offices/${OFFICE_A}/auditLogs`).filter((e) => e.action === "RECORD_MEDIA_UPDATED" && e.entityId === ctx.offerId);
  assert.ok(audit.length >= 4, "uploads and the arrangement are in the audit trail");
});

test("at most ten photos per offer", async () => {
  for (let i = recordImages(doc(ctx.offerId)).length; i < MAX_RECORD_IMAGES; i += 1) assert.equal((await upload(ctx.offerId, JPEG(32, i), OWNER_A)).status, 201);
  const over = await upload(ctx.offerId, JPEG(), OWNER_A);
  assert.equal(over.status, 409);
  assert.equal(over.body.error, "record_images_limit");
  assert.equal(recordImages(doc(ctx.offerId)).length, MAX_RECORD_IMAGES);
  assert.equal(h.env.IAQAR_MEDIA.keys().filter((k) => k.startsWith(`record-media/${OFFICE_A}/${ctx.offerId}/`)).length, MAX_RECORD_IMAGES, "the refused photo was not kept");
});

test("photos an owner attaches on the office link become the offer's photos", async () => {
  const intakeId = "intakephoto01";
  const put = async (index, bytes, type = "image/jpeg") => h.worker.fetch(new Request("https://worker.test/media/public-intake", {
    method: "POST", headers: { "content-type": type, "content-length": String(bytes.length), "x-office-id": OFFICE_A, "x-intake-id": intakeId, "x-media-kind": "image", "x-media-index": String(index) }, body: bytes
  }), h.env, { waitUntil() {} });
  const one = await (await put(1, JPEG(120, 3))).json();
  const two = await (await put(2, PNG(), "image/png")).json();
  assert.ok(one.mediaPath && two.mediaPath, JSON.stringify([one, two]));
  h.store.seed(`offices/${OFFICE_A}/publicIntake/${intakeId}`, {
    officeId: OFFICE_A, kind: "owner", name: "مالك الرابط العام", phone: "0556660000", propertyType: "دور", district: "قرطبة", city: "الرياض",
    purpose: "SALE", transactionType: "sale", amount: 1900000, area: 300, rooms: 5, details: "دور أرضي", mediaPaths: [one.mediaPath, two.mediaPath, `public-intake/${OFFICE_B}/zzzzzzzzzz/image-1.jpg`, "office-library/x/y.pdf"], imageCount: 2,
    hasVideo: false, source: "office_public_link", status: "new"
  });
  const intake = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId });
  assert.ok([200, 201].includes(intake.status), JSON.stringify(intake.body));
  const record = doc(intake.body.opportunityId);
  const images = recordImages(record);
  assert.equal(images.length, 2, "only this office's own intake photos are promoted");
  assert.equal(record.coverUrl, images[0].url);
  assert.ok(images.every((i) => i.source === "OFFICE_LINK" && keyBelongsTo(i.path, OFFICE_A, intake.body.opportunityId)));
  const served = await fetchPublic(images[0].url);
  assert.equal(served.status, 200);
  assert.equal((await served.arrayBuffer()).byteLength, 120);
});

test("screens: the form previews before saving, offers only; the record page shows the gallery", () => {
  const read = (file) => fs.readFileSync(path.join(ROOT, "public/os", file), "utf8");
  const picker = read("views/record-images.js");
  for (const action of ["main", "earlier", "later", "remove"]) assert.match(picker, new RegExp(`"${action}"`), `picker action: ${action}`);
  assert.match(picker, /multiple: true/, "several photos can be chosen at once");
  assert.match(picker, /URL\.createObjectURL\(blob\)/, "preview before anything is uploaded");
  const form = read("views/record-form.js");
  assert.match(form, /picker\.el\.hidden = initialKind !== RECORD_KIND\.OFFER/, "requests have no photo picker");
  assert.match(form, /picker\.commit\(saved\.recordId\)/, "photos are uploaded to the saved record");
  assert.match(read("views/record-detail.js"), /imageGallery\(record\)/);
  assert.match(read("views/public-office.js"), /imagePicker\(\{ max: 5/);
  const core = read("core/record-media.js");
  assert.match(core, /"X-Office-Id": session\.officeId, "X-Record-Id": recordId/, "the upload names the office and the record");
  assert.doesNotMatch(core + picker, /localStorage|sessionStorage/, "photos are stored on the server, not on the device");
});
