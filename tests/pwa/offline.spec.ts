import { expect, test } from "@playwright/test";
import { dismissInstallPrompt, mockNotionDisconnected, withBasePath } from "./helpers";

test.describe("PWA offline scenario", () => {
  test("reloads cached app shell while offline", async ({ page, context }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);

    await page.goto(withBasePath("/app"));
    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible();

    await page.evaluate(async (swPath) => {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register(swPath);
        await navigator.serviceWorker.ready;
      }
    }, withBasePath("/sw.js"));

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible();

    await context.setOffline(true);
    await page.reload();

    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible();
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
  });
});
