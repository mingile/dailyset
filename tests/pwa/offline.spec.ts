import { expect, type Page, test } from "@playwright/test";
import {
  dismissInstallPrompt,
  mockNotionDisconnected,
  withBasePath,
} from "../helpers";

// 오프라인에서는 /api/notion/status 요청이 실패하고, 앱은 제한 시간(3초)이
// RootClient와 라이브러리 훅에서 순차로 적용된 뒤(약 6초) 라이브러리를 보여준다.
const OFFLINE_SHELL_TIMEOUT_MS = 10_000;

async function expectLibraryShell(page: Page, timeout?: number) {
  await expect(
    page.getByRole("heading", { name: "운동 라이브러리" }),
  ).toBeVisible({ timeout });
  await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible({
    timeout,
  });
}

/** 앱을 열어 Service Worker를 등록하고, 캐시가 채워지도록 한 번 reload 한다 */
async function openAppWithServiceWorker(page: Page) {
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
}

test.describe("PWA offline scenario", () => {
  test("reloads cached app shell while offline", async ({ page, context }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await openAppWithServiceWorker(page);

    await context.setOffline(true);
    await page.reload();

    await expectLibraryShell(page);
  });

  // status API를 mock하지 않아 오프라인에서 실제로 요청이 실패하는 경로를 검증한다.
  test("reloads the app shell offline when the status request fails", async ({
    page,
    context,
  }) => {
    await dismissInstallPrompt(page);
    await openAppWithServiceWorker(page);

    await context.setOffline(true);
    await page.reload();

    await expectLibraryShell(page, OFFLINE_SHELL_TIMEOUT_MS);
  });
});
