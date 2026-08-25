import { test, expect } from "@playwright/test";
import { openHarness, resetQa } from "./helpers/qa.mjs";

test.beforeEach(async ({ request }) => {
  await resetQa(request);
});

test("switching المهام اليومية / العروض والطلبات / إعداد المكتب does not leak panels", async ({ page }) => {
  const watchers = await openHarness(page);
  await expect(page.getByTestId("panel-tasks")).toBeVisible();
  await expect(page.getByTestId("panel-offers")).toBeHidden();

  await page.getByTestId("tab-offers").click();
  await expect(page.getByTestId("panel-offers")).toBeVisible();
  await expect(page.getByTestId("panel-tasks")).toBeHidden();
  await expect(page.getByText("يحتاج استكمال")).toBeVisible();

  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("panel-settings")).toBeVisible();
  await expect(page.getByText("التعاون بين المكاتب")).toBeVisible();
  await expect(page.getByText("مشاركات نشطة مع مكاتب أخرى")).toHaveCount(0);

  await page.getByTestId("tab-tasks").click();
  await expect(page.getByTestId("panel-tasks")).toBeVisible();
  await expect(page.getByTestId("match-open").first()).toBeVisible();
  expect(watchers.pageErrors, watchers.pageErrors.join("\n")).toEqual([]);
});

test("reload and back keep the selected tab's data", async ({ page }) => {
  await openHarness(page, { tab: "offers" });
  await expect(page.getByTestId("panel-offers")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("inbox-row").first()).toBeVisible();
  await page.getByTestId("tab-tasks").click();
  await page.goBack();
  await expect(page.getByTestId("panel-offers")).toBeVisible();
});
