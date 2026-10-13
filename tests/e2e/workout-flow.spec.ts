import { expect, type Page, test } from "@playwright/test";
import { openLibrarySession, startSessionFromLibrary } from "../helpers";

// 핵심 사용자 여정: 운동 기록 → 세션 완료 → History 확인 → reload 후에도 유지.
// 오류 분기(빈 세션, enqueue 실패 등)는 RTL 통합 테스트(RootClient.test.tsx)가 검증한다.

/** 숫자 필드를 눌러 입력창으로 바꾸고 값을 입력한 뒤 Enter로 커밋한다 */
async function commitNumber(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const input = page.getByRole("textbox", { name: label, exact: true });
  await input.fill(value);
  await input.press("Enter");
}

/** `기록` 시트를 열고 시트 locator를 반환한다 */
async function openHistorySheet(page: Page) {
  await page.getByRole("button", { name: "기록", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("전체 운동 기록")).toBeVisible();
  return sheet;
}

async function expectSavedWorkoutInHistory(page: Page) {
  const sheet = await openHistorySheet(page);

  await expect(sheet.getByText("벤치프레스", { exact: true })).toBeVisible();
  await expect(sheet.getByText(/1 exercises · 1\s+sets/)).toBeVisible();
  // 숫자와 단위가 같은 요소 안에 있어 전체 텍스트("80kg", "8회")로 찾는다
  await expect(sheet.getByText(/^80\s*kg$/)).toBeVisible();
  await expect(sheet.getByText(/^8\s*회$/)).toBeVisible();

  await sheet.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.describe("Workout flow", () => {
  test("records a set, completes the session, and keeps it in history after reload", async ({
    page,
  }) => {
    // 1. 라이브러리에서 운동을 골라 세션 시작
    await openLibrarySession(page, "벤치프레스", "가슴");

    // 2. 무게·횟수를 UI로 입력하고 세트 완료
    await page.getByRole("button", { name: /벤치프레스/ }).click();
    await commitNumber(page, "세트 1 무게", "80");
    await commitNumber(page, "세트 1 횟수", "8");
    await page.getByRole("checkbox", { name: "세트 1 완료" }).click();
    await expect(page.getByText("1 / 1 SETS")).toBeVisible();

    // 3. 운동 완료 → 라이브러리로 복귀, 로컬 history에 저장되고 draft는 비워진다
    await page.getByRole("button", { name: "운동 완료" }).click();
    await expect(
      page.getByRole("heading", { name: "운동 라이브러리" }),
    ).toBeVisible();

    const stored = await page.evaluate(() => ({
      draft: localStorage.getItem("workout.currentSession.v1"),
      sessions: JSON.parse(localStorage.getItem("workout.sessions.v1") ?? "[]"),
    }));
    expect(stored.draft).toBeNull();
    expect(stored.sessions).toHaveLength(1);
    expect(stored.sessions[0].exercises[0].name).toBe("벤치프레스");
    expect(stored.sessions[0].exercises[0].sets).toMatchObject([
      { setNo: 1, weight: 80, reps: 8 },
    ]);

    // 4. 라이브러리에는 `기록` 버튼이 없으므로 새 세션을 연 뒤 History에서 확인
    await startSessionFromLibrary(page, "랫풀다운");
    await expectSavedWorkoutInHistory(page);

    // 5. reload 후에도 History가 유지된다
    await page.reload();
    await expect(page.getByRole("button", { name: "운동 완료" })).toBeVisible();
    await expectSavedWorkoutInHistory(page);
  });
});
