import test from "node:test";
import assert from "node:assert/strict";
import { isHostedPreviewHost, officeShareUrl, shareCardKey, shareCardLines } from "../public/os/domain/share-card-domain.js";

test("hosted preview domains use the Worker link, custom domains the short link", () => {
  const base = { slug: "Sultan", officeId: "o1", origin: "https://iaqar-ai-staging--staging-x.web.app", workerOrigin: "https://w.example.workers.dev/" };
  assert.equal(officeShareUrl({ ...base, hostname: "iaqar-ai-staging--staging-x.web.app" }), "https://w.example.workers.dev/m/sultan");
  assert.equal(officeShareUrl({ ...base, origin: "https://iaqar.ai", hostname: "iaqar.ai" }), "https://iaqar.ai/m/sultan");
  assert.equal(isHostedPreviewHost("x.firebaseapp.com"), true);
  assert.equal(isHostedPreviewHost("iaqar.ai"), false);
});

test("without a slug the link falls back to the public landing of the office", () => {
  const url = officeShareUrl({ officeId: "o1", origin: "https://iaqar.ai", hostname: "iaqar.ai" });
  assert.match(url, /office=o1/);
});

test("card key changes only when something on the card changes", () => {
  const office = { officeName: "مكتب", brokerName: "س", licenseNumber: "1", city: "الرياض", phone: "0501111111", publicSlug: "wadi" };
  const a = shareCardKey(office);
  assert.equal(shareCardKey({ ...office, phone: "0509999999" }), a, "phone is not on the card");
  assert.notEqual(shareCardKey({ ...office, brokerPhotoUrl: "data:image/jpeg;base64,AAAA" }), a);
  assert.notEqual(shareCardKey({ ...office, city: "جدة" }), a);
  assert.notEqual(shareCardKey({ ...office, publicSlug: "wadi2" }), a, "a new slug needs the card stored under it");
});

test("card shows the license, but claims «مرخص» only with a real verification", () => {
  const plain = shareCardLines({ officeName: "م", brokerName: "سلطان", licenseNumber: "1200012345", city: "الرياض" });
  assert.deepEqual(plain.license, ["رخصة فال: 1200012345"]);
  assert.equal(plain.broker, "الوسيط: سلطان");
  const verified = shareCardLines({ officeName: "م", licenseNumber: "1200012345", licenseVerified: true });
  assert.ok(verified.license.includes("✓ مكتب عقاري مرخص"));
  assert.ok(!JSON.stringify(plain).includes("0501111111"));
});
