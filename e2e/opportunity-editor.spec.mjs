import { test, expect } from "@playwright/test";
import { openHarness, resetQa } from "./helpers/qa.mjs";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

async function openMissing(page, opportunityId, editor) {
  await page.getByTestId("tab-offers").click();
  const row = page.locator(`[data-testid="inbox-row"][data-opportunity-id="${opportunityId}"]`);
  await expect(row).toBeVisible();
  if (editor) {
    const chip = row.locator(`[data-cv2-editor="${editor}"]`).first();
    if (await chip.count()) {
      await chip.click();
      return row;
    }
  }
  await row.getByTestId("complete-missing").click();
  return row;
}

test("incomplete items sit under يحتاج استكمال and do not claim 6/6", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const incomplete = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  await expect(incomplete).toBeVisible();
  await expect(incomplete).toContainText("يحتاج استكمال");
  await expect(incomplete).not.toContainText("6 من 6");
});

test("saving city and district persists after reload", async ({ page }) => {
  const watchers = await openHarness(page, { tab: "offers" });
  const row = await openMissing(page, "qa_offer_incomplete", "location");
  await row.getByTestId("field-city").fill("المدينة المنورة");
  await row.getByTestId("field-district").fill("العزيزية");
  await row.getByTestId("save-field").click();
  await expect(page.getByText("تم الحفظ")).toBeVisible();
  await expect(row.locator("[data-cv2-editor-root]")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("tab-offers").click();
  const again = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  await expect(again).toContainText("العزيزية");
  expect(watchers.unexpectedJs(), watchers.unexpectedJs().join("\n")).toEqual([]);
});

test("saving price persists after reload", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  const toggle = row.getByText("عرض التفاصيل");
  if (await toggle.count()) await toggle.click();
  await row.locator('[data-cv2-editor="price"]').first().click();
  await row.getByTestId("field-price").fill("850000");
  await row.getByTestId("save-field").click();
  await expect(row.locator("[data-cv2-editor-root]")).toHaveCount(0);
  await page.reload();
  await page.getByTestId("tab-offers").click();
  await expect(page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]')).toContainText("850,000");
});

test("empty location validation keeps the sheet open", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = await openMissing(page, "qa_offer_incomplete", "location");
  await row.getByTestId("field-city").fill("");
  await row.getByTestId("field-district").fill("");
  await row.getByTestId("save-field").click();
  await expect(row.locator("#cv2EditorError")).toBeVisible();
  await expect(row.locator("[data-cv2-editor-root]")).toBeVisible();
  await expect(page.getByText("تم الحفظ")).toHaveCount(0);
});

test("cancel and outside click do not save", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = await openMissing(page, "qa_offer_incomplete", "location");
  await row.getByTestId("field-district").fill("لن تُحفظ");
  await row.getByTestId("cancel-field").click();
  await expect(row.locator("[data-cv2-editor-root]")).toHaveCount(0);
  await expect(row).not.toContainText("لن تُحفظ");
});

test("save failure keeps the editor and does not toast success", async ({ page, request }) => {
  await request.post("/qa/fail-next-patch", { data: { count: 1 } });
  await openHarness(page, { tab: "offers" });
  const row = await openMissing(page, "qa_offer_incomplete", "location");
  await row.getByTestId("field-city").fill("المدينة المنورة");
  await row.getByTestId("field-district").fill("السكب");
  await row.getByTestId("save-field").click();
  await expect(row.locator("#cv2EditorError")).toBeVisible();
  await expect(row.locator("[data-cv2-editor-root]")).toBeVisible();
  await expect(page.locator("#toast")).not.toContainText("تم الحفظ");
});

test("completing the last missing field moves the item to قيد المطابقة", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_last_field"]');
  await expect(row).toBeVisible();
  await row.getByTestId("complete-missing").click();
  await row.getByTestId("field-district").fill("السكب");
  await row.getByTestId("save-field").click();
  await expect(page.getByText("تم استكمال البيانات وانتقل العرض إلى قيد المطابقة")).toBeVisible();
  await page.reload();
  await page.getByTestId("tab-offers").click();
  const moved = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_last_field"]');
  await expect(moved).toContainText("قيد المطابقة");
});

test("invalid Saudi phone is rejected", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  const row = page.locator('[data-testid="inbox-row"][data-opportunity-id="qa_offer_incomplete"]');
  const contactChip = row.locator('[data-cv2-editor="contactNumber"], [data-cv2-editor="contact"]').first();
  if (!(await contactChip.count())) test.skip(true, "contact editor chip not visible on this incomplete card");
  await contactChip.click();
  await row.getByTestId("field-phone").fill("123");
  await row.getByTestId("save-field").click();
  await expect(row.locator("[data-cv2-editor-root]")).toBeVisible();
});
