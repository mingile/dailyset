import { expect, test } from "@playwright/test";
import {
  markFirstSetDone,
  mockNotionConnected,
  openLibrarySession,
  withBasePath,
} from "../helpers";

test.describe("Workout session draft", () => {
  test("keeps the in-progress workout after reload", async ({ page }) => {
    await openLibrarySession(page);
    await markFirstSetDone(page);

    // 세트가 하나뿐이라 완료하면 운동이 접히고 진행도가 보인다
    await expect(page.getByText("1 / 1 SETS")).toBeVisible();

    // draft는 상태가 바뀔 때 effect로 저장되므로 저장될 때까지 기다린다
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("workout.currentSession.v1");
          if (!raw) return null;
          const draft = JSON.parse(raw);
          return {
            name: draft.exercises[0].name,
            done: draft.exercises[0].sets[0].done,
          };
        }),
      )
      .toEqual({ name: "랫풀다운", done: true });

    await page.reload();

    await expect(page.getByRole("button", { name: "운동 완료" })).toBeVisible();
    await expect(page.getByText("랫풀다운", { exact: true })).toBeVisible();
    await expect(page.getByText("1 / 1 SETS")).toBeVisible();
  });
});

test.describe("Notion failure handling", () => {
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
      localStorage.setItem("workout.currentSession.v1", JSON.stringify(draft));
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
    await expect(
      page.getByRole("button", { name: "운동 완료" }),
    ).not.toBeVisible();

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
