import { expect, type Locator, test } from "@playwright/test";
import {
  dismissInstallPrompt,
  mockNotionDisconnected,
  openLibrarySession,
  startSessionFromLibrary,
  withBasePath,
} from "../helpers";

// accent CTA(Button variant="accent")의 외관 회귀 확인.
// Component System 정리 전의 값(노란 배경 #F2EC00, 글자 #18181B, 크기·굵기)이 그대로인지 계산된 스타일로 본다.

const ACCENT_BG = "rgb(242, 236, 0)";
const ACCENT_FG = "rgb(24, 24, 27)";
const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** 하단 전폭 액션: 운동 완료 / 선택 완료 / 추가하기 */
const XL = { fontSize: "18px", fontWeight: "700", height: 56 };
/** 페이지 안 인라인 CTA: Notion 설정·연결, 랜딩 */
const CTA = { fontSize: "16px", fontWeight: "700", height: 48 };

test.use({ viewport: { width: 390, height: 844 } });

async function readStyle(locator: Locator) {
  await locator.waitFor();
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderTopWidth: style.borderTopWidth,
      height: Math.round(rect.height),
      width: Math.round(rect.width),
    };
  });
}

async function expectAccent(
  locator: Locator,
  size: { fontSize: string; fontWeight: string; height: number },
) {
  await locator.waitFor();
  // Button은 transition-all이라 상태가 바뀐 직후에는 색이 전환 중일 수 있어 poll로 기다린다
  await expect.poll(() => readStyle(locator)).toMatchObject({
    backgroundColor: ACCENT_BG,
    color: ACCENT_FG,
    ...size,
  });
}

async function useDarkTheme(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
}

async function mockNotionStatus(
  page: import("@playwright/test").Page,
  status: { notionConnected: boolean; dbConnected: boolean },
) {
  await page.route("**/api/notion/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    }),
  );
}

async function seedHandoff(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("notion_connect_handoff_id", "e2e-handoff");
    sessionStorage.setItem("notion_oauth_pending", "1");
    // launched가 아니면 페이지가 마운트 직후 Safari 핸드오프 URL로 이동한다
    sessionStorage.setItem("notion_connect_handoff_launched", "1");
    sessionStorage.setItem(
      "notion_connect_handoff_started_at",
      String(Date.now()),
    );
  });
}

test.describe("랜딩", () => {
  test("시작하기 CTA와 하이라이트가 accent 외관이고 hover 시 색이 바뀐다", async ({
    page,
  }) => {
    await dismissInstallPrompt(page);
    await page.goto(withBasePath("/"));

    const cta = page.getByRole("link", { name: "시작하기" });
    await expectAccent(cta, CTA);
    expect((await readStyle(cta)).width).toBeGreaterThan(0);

    const highlight = page.getByText("몇 세트", { exact: true });
    expect(await readStyle(highlight)).toMatchObject({
      backgroundColor: ACCENT_BG,
      color: ACCENT_FG,
    });

    await cta.hover();
    await expect
      .poll(async () => (await readStyle(cta)).backgroundColor)
      .not.toBe(ACCENT_BG);
  });

  test("다크모드에서도 글자색이 고정이다", async ({ page }) => {
    await dismissInstallPrompt(page);
    await useDarkTheme(page);
    await page.goto(withBasePath("/"));

    await expectAccent(page.getByRole("link", { name: "시작하기" }), CTA);
    expect(
      await readStyle(page.getByText("몇 세트", { exact: true })),
    ).toMatchObject({ backgroundColor: ACCENT_BG, color: ACCENT_FG });
  });
});

test.describe("Notion 페이지", () => {
  test("설정 페이지의 Notion 연동하기 CTA", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/settings/notion"));

    await expectAccent(
      page.getByRole("button", { name: "Notion 연동하기" }),
      CTA,
    );
  });

  test("연결 페이지의 DB 선택 링크(<a>)", async ({ page }) => {
    await dismissInstallPrompt(page);
    await seedHandoff(page);
    await mockNotionStatus(page, { notionConnected: true, dbConnected: false });
    await page.goto(withBasePath("/notion/connect"));

    await expectAccent(
      page.getByRole("link", { name: "Safari에서 DB 선택하기" }),
      CTA,
    );
  });

  test("연결 페이지의 완료 링크(Link)", async ({ page }) => {
    await dismissInstallPrompt(page);
    await seedHandoff(page);
    await mockNotionStatus(page, { notionConnected: true, dbConnected: true });
    await page.goto(withBasePath("/notion/connect"));

    await expectAccent(
      page.getByRole("link", { name: "Dailyset 홈으로" }),
      CTA,
    );
  });
});

test.describe("앱 화면", () => {
  test("라이브러리 선택 완료: 0개면 외곽선, 선택하면 accent", async ({
    page,
  }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));
    await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();

    const confirm = page.getByRole("button", { name: /선택 완료/ });
    expect(await readStyle(confirm)).toMatchObject({
      backgroundColor: TRANSPARENT,
      borderTopWidth: "1px",
      ...XL,
    });

    await page.getByText("랫풀다운", { exact: true }).click();
    await expectAccent(confirm, XL);
  });

  test("세션 운동 완료: 전폭 accent", async ({ page }) => {
    await openLibrarySession(page);

    const complete = page.getByRole("button", { name: "운동 완료" });
    await expectAccent(complete, XL);
    // 좌우 여백 16px씩을 뺀 전폭
    expect((await readStyle(complete)).width).toBe(390 - 32);
  });

  // 각 test는 새 context라 localStorage가 비어 있다. 같은 context에서 페이지를 더 열면 세션 draft가 남아 라이브러리를 건너뛴다.
  test("다크모드에서도 운동 완료 글자색이 고정이다", async ({ page }) => {
    await dismissInstallPrompt(page);
    await useDarkTheme(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));
    await startSessionFromLibrary(page);

    await expectAccent(page.getByRole("button", { name: "운동 완료" }), XL);
  });

  test("운동 추가 시트의 추가하기: 0개면 외곽선, 선택하면 accent", async ({
    page,
  }) => {
    await openLibrarySession(page);

    await page.getByRole("button", { name: /운동 추가/ }).click();
    const sheet = page.getByRole("dialog");
    const add = sheet.getByRole("button", { name: /추가하기/ });
    expect(await readStyle(add)).toMatchObject({
      backgroundColor: TRANSPARENT,
      borderTopWidth: "1px",
      ...XL,
    });

    await sheet.locator("button[aria-pressed]").first().click();
    await expectAccent(add, XL);
  });
});
