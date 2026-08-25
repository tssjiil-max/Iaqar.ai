import { test, expect } from "@playwright/test";
import { attachWatchers, resetQa, stubRemoteWorker } from "./helpers/qa.mjs";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

test("Access Gate appears on broker home without a party token", async ({ page }) => {
  const watchers = attachWatchers(page);
  await page.goto("/");
  await expect(page.locator("#accessGate, .access-gate")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("[data-party-shell]")).toHaveCount(0);
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});

test("Party link in a clean context skips Access Gate and broker login", async ({ page, request }) => {
  const mint = await request.post("/party/sessions", {
    data: { officeId: "qa-office-client", matchId: "match_aziz_1842", party: "client" }
  });
  const payload = await mint.json();
  expect(payload.token).toBeTruthy();
  const watchers = attachWatchers(page);
  await stubRemoteWorker(page, "http://127.0.0.1:4191");
  await page.goto(`/?cv2Party=${payload.token}`);
  await expect(page.locator("[data-party-shell]")).toBeVisible();
  await expect(page.locator("#accessGate, .access-gate")).toHaveCount(0);
  await expect(page.getByText("تسجيل دخول مكتب")).toHaveCount(0);
  await expect(page.getByText("أنا عميل")).toHaveCount(0);
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});

test("Invalid party token shows a safe error, not the office login", async ({ page }) => {
  const watchers = attachWatchers(page);
  await page.goto("/?cv2Party=not-a-valid-token");
  await expect(page.locator("[data-party-error], [data-party-shell]")).toBeVisible();
  await expect(page.getByText("هذا الرابط غير صالح أو لم يعد متاحًا.")).toBeVisible();
  await expect(page.locator("#accessGate, .access-gate")).toHaveCount(0);
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});
