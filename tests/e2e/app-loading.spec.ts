import { expect, test } from "@playwright/test";
import {
  dismissInstallPrompt,
  mockNotionDisconnected,
  withBasePath,
} from "../helpers";

// /api/notion/status 요청이 응답 없이 매달려도 앱이 화면을 보여주는지 검증한다.
// 제한 시간(3초)이 RootClient와 라이브러리 훅에서 순차로 적용되어 약 6초가 걸린다.
const HUNG_STATUS_VISIBLE_TIMEOUT_MS = 10_000;

test.describe("Landing", () => {
  test("loads the landing page shell", async ({ page }) => {
    await page.goto(withBasePath("/"));
    await expect(
      page.getByRole("heading", { name: /저번에.*했더라/ }),
    ).toBeVisible();
  });
});

test.describe("App loading", () => {
  test("loads the library shell", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));

    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible();
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
  });

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
});
