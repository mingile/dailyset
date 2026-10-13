import { expect, test } from "@playwright/test";
import {
  countRequests,
  dismissInstallPrompt,
  mockNotionConnected,
  mockNotionExerciseRead,
  mockNotionWorkoutRecords,
  startSessionFromLibrary,
  withBasePath,
} from "../helpers";

// Notion 연결 상태와 운동 라이브러리 조회가 중복 요청 없이 한 번씩만 나가는지 검증한다.
// 요청 횟수는 production build 기준이며, 모든 /api/notion/* 응답은 mock이다.

test.describe("Server state requests", () => {
  test.beforeEach(async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionConnected(page);
    await mockNotionExerciseRead(page);
    await mockNotionWorkoutRecords(page);
  });

  test("asks for the connection status and the exercise list once each when the app opens", async ({
    page,
  }) => {
    const statusRequests = countRequests(page, "/api/notion/status");
    const exerciseReadRequests = countRequests(
      page,
      "/api/notion/exercise-read",
    );

    await page.goto(withBasePath("/app"));

    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
    await expect(page.getByText("노션 미연동")).toHaveCount(0);
    expect(statusRequests()).toBe(1);
    expect(exerciseReadRequests()).toBe(1);
  });

  test("does not ask again when the add-exercise sheet is opened twice during a session", async ({
    page,
  }) => {
    const statusRequests = countRequests(page, "/api/notion/status");
    const exerciseReadRequests = countRequests(
      page,
      "/api/notion/exercise-read",
    );

    await page.goto(withBasePath("/app"));
    await startSessionFromLibrary(page, "랫풀다운");

    const addExercise = page.getByRole("button", { name: /운동 추가/ });
    await addExercise.click();
    // 시티드로우는 세션에 없으므로 시트 안에서만 보인다
    await expect(page.getByText("시티드로우", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("시티드로우", { exact: true })).toHaveCount(0);

    await addExercise.click();
    await expect(page.getByText("시티드로우", { exact: true })).toBeVisible();

    expect(statusRequests()).toBe(1);
    expect(exerciseReadRequests()).toBe(1);
  });
});
