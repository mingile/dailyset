import type { Page } from "@playwright/test";
import { withBasePath } from "../src/lib/base-path";

export async function dismissInstallPrompt(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("pwa.installPrompt.dismissed.v1", "true");
  });
}

export async function mockNotionDisconnected(page: Page) {
  await page.route("**/api/notion/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        notionConnected: false,
        dbConnected: false,
      }),
    }),
  );
}

export async function mockNotionConnected(page: Page) {
  await page.route("**/api/notion/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        notionConnected: true,
        dbConnected: true,
      }),
    }),
  );
}

/** 라이브러리에서 운동 하나를 골라 세션 화면(`운동 완료` 버튼)까지 연다 */
export async function openLibrarySession(
  page: Page,
  exerciseName = "랫풀다운",
) {
  await dismissInstallPrompt(page);
  await mockNotionDisconnected(page);
  await page.goto(withBasePath("/app"));
  await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();
  await page.getByText(exerciseName, { exact: true }).click();
  await page.getByRole("button", { name: /선택 완료/ }).click();
  await page.getByRole("button", { name: "운동 완료" }).waitFor();
}

/**
 * 운동을 펼쳐 첫 세트의 완료 체크를 누른다.
 * 세트가 하나뿐인 운동은 완료하면 자동으로 접힌다.
 */
export async function markFirstSetDone(page: Page, exerciseName = "랫풀다운") {
  await page.getByRole("button", { name: new RegExp(exerciseName) }).click();
  await page.getByRole("checkbox", { name: "세트 1 완료" }).click();
}

export { withBasePath };
