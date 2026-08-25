import { test, expect } from "@playwright/test";
import { openHarness, resetQa } from "./helpers/qa.mjs";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

test("complete-deal double click does not create a second completed task", async ({ page, request }) => {
  await openHarness(page);
  const card = page.locator('[data-cv2-exec-task][data-match-id="match_close_9901"]');
  await card.getByTestId("match-open").click();
  await card.getByTestId("complete-deal").dblclick();
  await expect(page.locator("#toast")).toContainText("تم إتمام الصفقة");
  await page.reload();
  await expect(page.locator('[data-match-id="match_close_9901"]')).toHaveCount(0);
  const state = await request.get("/qa/state");
  const payload = await state.json();
  expect(payload.state.matches.match_close_9901.livingStage).toBe("COMPLETED");
});

test("double-booking an appointment slot fails safely", async ({ request }) => {
  const first = await request.post("/qa/appointments", {
    data: { matchId: "match_aziz_1842", slot: "2026-08-26T10:00:00.000Z" }
  });
  expect(first.ok()).toBeTruthy();
  const second = await request.post("/qa/appointments", {
    data: { matchId: "match_aziz_1842", slot: "2026-08-26T10:00:00.000Z" }
  });
  expect(second.status()).toBe(409);
  const payload = await second.json();
  expect(payload.ok).toBeFalsy();
});

for (const viewport of VIEWPORTS) {
  test(`critical actions remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openHarness(page);
    const card = page.locator('[data-cv2-exec-task][data-match-id="match_aziz_1842"]');
    await card.getByTestId("match-open").click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const box = await card.getByTestId("send-client").boundingBox();
    expect(box?.width || 0).toBeGreaterThan(40);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(viewport.width + 1);
  });
}

test("extremely long district text does not overflow the editor", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  await row.getByTestId("complete-missing").click();
  await row.getByTestId("field-district").fill("السكب".repeat(80));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
});
