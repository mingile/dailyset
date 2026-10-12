import { expect, test } from "@playwright/test";
import {
  markFirstSetDone,
  mockNotionConnected,
  openLibrarySession,
  withBasePath,
} from "./helpers";

test.describe("PWA local storage flow", () => {
  test("persists workout draft and history after save and reload", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await openLibrarySession(page);
    await markFirstSetDone(page);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("로컬 저장 완료")).toBeVisible();

    const savedDraft = await page.evaluate(() =>
      localStorage.getItem("workout.currentSession.v1"),
    );
    expect(savedDraft).toBeTruthy();

    const savedHistory = await page.evaluate(() =>
      localStorage.getItem("workout.sessions.v1"),
    );
    expect(savedHistory).toContain("랫풀다운");

    await page.reload();
    await page.getByRole("button", { name: "저장" }).waitFor();
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
  });
});

test.describe("PWA notion failure handling", () => {
  test("keeps local history and returns to library when sync enqueue fails", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("pwa.installPrompt.dismissed.v1", "true");
      const draft = {
        session: {
          sessionId: "qa-session-1",
          sessionName: "QA Session",
          startedAt: new Date().toISOString(),
        },
        exercises: [
          {
            id: "ex-qa-1",
            name: "벤치프레스",
            part: "가슴",
            exercisePageId: "notion-page-qa-1",
            targetMainSetCount: 1,
            targetWarmupSetCount: 0,
            sets: [
              {
                weight: 60,
                reps: 10,
                done: true,
                synced: false,
                equipment: "barbell",
                memo: "",
                unit: "kg",
                setType: "main",
              },
            ],
          },
        ],
      };
      localStorage.setItem(
        "workout.currentSession.v1",
        JSON.stringify(draft),
      );
    });

    await mockNotionConnected(page);
    await page.route("**/api/sync/enqueue", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "queue unavailable" }),
      }),
    );

    await page.goto(withBasePath("/app"));
    await page.getByRole("button", { name: "운동 완료" }).click();

    await expect(page.getByText("Notion 동기화 요청 실패")).toBeVisible();
    await expect(page.getByRole("button", { name: "운동 완료" })).not.toBeVisible();

    const draft = await page.evaluate(() =>
      localStorage.getItem("workout.currentSession.v1"),
    );
    expect(draft).toBeNull();

    const history = await page.evaluate(() =>
      localStorage.getItem("workout.sessions.v1"),
    );
    expect(history).toContain("qa-session-1");
  });
});
