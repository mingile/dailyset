import { expect, test } from "@playwright/test";
import { dismissInstallPrompt, withBasePath } from "./helpers";

// /api/notion/status 요청이 응답 없이 매달려도 앱이 화면을 보여주는지 검증한다.
// 제한 시간(3초)이 RootClient와 라이브러리 훅에서 순차로 적용되어 약 6초가 걸린다.
const HUNG_STATUS_VISIBLE_TIMEOUT_MS = 10_000;

test.describe("Notion status timeout", () => {
  test("shows the library when the status request never responds", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await dismissInstallPrompt(page);
    await page.route("**/api/notion/status", () => new Promise(() => {}));

    await page.goto(withBasePath("/app"));

    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible({ timeout: HUNG_STATUS_VISIBLE_TIMEOUT_MS });
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
    await expect(page.getByText("Loading...")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("reloads the app shell offline without mocking the status API", async ({
    page,
    context,
  }) => {
    await dismissInstallPrompt(page);

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
    ).toBeVisible({ timeout: HUNG_STATUS_VISIBLE_TIMEOUT_MS });
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
  });
});
