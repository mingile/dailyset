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

function notionExerciseRow(pageId: string, exerciseId: string, name: string) {
  return {
    id: pageId,
    properties: {
      exercise_id: { rich_text: [{ plain_text: exerciseId }] },
      이름: { title: [{ plain_text: name }] },
      카테고리: { select: { name: "등" } },
      장비: { select: { name: "케이블" } },
    },
  };
}

/** Notion 운동 목록(랫풀다운, 시티드로우)을 돌려준다 */
export async function mockNotionExerciseRead(page: Page) {
  await page.route("**/api/notion/exercise-read", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          notionExerciseRow("notion-page-lat", "lat-pulldown", "랫풀다운"),
          notionExerciseRow("notion-page-row", "seated-row", "시티드로우"),
        ],
      }),
    }),
  );
}

/** 세션 진입 시 부르는 최근 기록 조회를 빈 결과로 막는다 */
export async function mockNotionWorkoutRecords(page: Page) {
  await page.route("**/api/notion/workout-records", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    }),
  );
}

/** 페이지가 보낸 요청 중 경로가 `pathname`으로 끝나는 것의 횟수를 센다 */
export function countRequests(page: Page, pathname: string) {
  let count = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith(pathname)) count += 1;
  });
  return () => count;
}

/**
 * 라이브러리 화면에서 운동 하나를 골라 세션 화면(`운동 완료` 버튼)까지 연다.
 * 첫 카테고리가 아닌 운동은 `category` 탭을 먼저 누른다.
 */
export async function startSessionFromLibrary(
  page: Page,
  exerciseName = "랫풀다운",
  category?: string,
) {
  await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();
  if (category) {
    await page.getByRole("button", { name: category, exact: true }).click();
  }
  await page.getByText(exerciseName, { exact: true }).click();
  await page.getByRole("button", { name: /선택 완료/ }).click();
  await page.getByRole("button", { name: "운동 완료" }).waitFor();
}

/** /app을 열어(Notion 미연결) 운동 하나를 골라 세션 화면까지 연다 */
export async function openLibrarySession(
  page: Page,
  exerciseName = "랫풀다운",
  category?: string,
) {
  await dismissInstallPrompt(page);
  await mockNotionDisconnected(page);
  await page.goto(withBasePath("/app"));
  await startSessionFromLibrary(page, exerciseName, category);
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
