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

// Button size="text"(ghost) / variant="outline-strong" size="touch"의 외관 확인.
async function readButtonStyle(locator: Locator) {
  await locator.waitFor();
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopWidth: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      paddingLeft: style.paddingLeft,
      minWidth: style.minWidth,
      height: Math.round(rect.height),
    };
  });
}

/** 헤더·시트·Notion 페이지의 텍스트 버튼: h-11 min-w-11 rounded-none px-2 14px/600, 자간 0.1em(=1.4px) */
const TEXT_BUTTON_STYLE = {
  backgroundColor: TRANSPARENT,
  fontSize: "14px",
  fontWeight: "600",
  letterSpacing: "1.4px",
  borderTopLeftRadius: "0px",
  minWidth: "44px",
  height: 44,
};

test.describe("텍스트·보조 버튼", () => {
  test("헤더의 기록 / 새 세션 / 설정과 시트의 닫기", async ({ page }) => {
    await openLibrarySession(page);

    for (const name of ["기록", "새 세션", "설정"]) {
      expect(
        await readButtonStyle(
          page.getByRole("button", { name, exact: true }),
        ),
        name,
      ).toMatchObject(TEXT_BUTTON_STYLE);
    }

    await page.getByRole("button", { name: /운동 추가/ }).click();
    expect(
      await readButtonStyle(
        page.getByRole("dialog").getByRole("button", { name: "닫기" }),
      ),
    ).toMatchObject(TEXT_BUTTON_STYLE);
  });

  test("Notion 설정 페이지의 텍스트 링크(홈으로)", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/settings/notion"));

    expect(
      await readButtonStyle(page.getByRole("link", { name: "홈으로" })),
    ).toMatchObject(TEXT_BUTTON_STYLE);
  });

  test("Notion 연결 페이지의 보조 링크(Notion 설정으로)", async ({ page }) => {
    await dismissInstallPrompt(page);
    await seedHandoff(page);
    await mockNotionStatus(page, {
      notionConnected: false,
      dbConnected: false,
    });
    await page.goto(withBasePath("/notion/connect"));

    expect(
      await readButtonStyle(
        page.getByRole("link", { name: "Notion 설정으로" }),
      ),
    ).toMatchObject({
      backgroundColor: TRANSPARENT,
      fontSize: "14px",
      fontWeight: "600",
      borderTopWidth: "1px",
      borderTopColor: ACCENT_FG,
      paddingLeft: "16px",
      height: 44,
    });
  });
});

// 로고(● daily set)와 페이지 제목의 외관 기준선. 컴포넌트로 옮겨도 계산된 스타일이 같아야 한다.
async function expectBrandMark(page: import("@playwright/test").Page) {
  const mark = page.getByText("daily", { exact: true }).first().locator("..");
  await mark.waitFor();

  expect(
    await mark.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        display: style.display,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        columnGap: style.columnGap,
      };
    }),
  ).toMatchObject({
    display: "flex",
    fontSize: "20px",
    fontWeight: "500",
    letterSpacing: "4px",
    columnGap: "6px",
  });

  const dot = await mark.locator("span").first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      backgroundColor: getComputedStyle(el).backgroundColor,
    };
  });
  expect(dot).toEqual({ width: 8, height: 8, backgroundColor: ACCENT_BG });

  // --session-muted(#686871)
  expect(
    await mark
      .getByText("set", { exact: true })
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe("rgb(104, 104, 113)");
}

async function expectPageTitle(page: import("@playwright/test").Page) {
  const title = page.getByRole("heading", { level: 1 }).first();
  await title.waitFor();
  expect(
    await title.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
      };
    }),
  ).toEqual({ fontSize: "24px", fontWeight: "700", letterSpacing: "-0.6px" });
}

test.describe("로고와 제목 블록", () => {
  test("랜딩의 로고", async ({ page }) => {
    await dismissInstallPrompt(page);
    await page.goto(withBasePath("/"));
    await expectBrandMark(page);
  });

  test("라이브러리의 로고와 제목", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));
    await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();
    await expectBrandMark(page);
    await expectPageTitle(page);
  });

  test("세션 헤더의 로고", async ({ page }) => {
    await openLibrarySession(page);
    await expectBrandMark(page);
  });

  test("Notion 설정 페이지의 로고와 제목", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/settings/notion"));
    await expectBrandMark(page);
    await expectPageTitle(page);
  });

  test("Notion 연결 페이지의 로고와 제목", async ({ page }) => {
    await dismissInstallPrompt(page);
    await seedHandoff(page);
    await mockNotionStatus(page, {
      notionConnected: false,
      dbConnected: false,
    });
    await page.goto(withBasePath("/notion/connect"));
    await expectBrandMark(page);
    await expectPageTitle(page);
  });
});

/** `from` 요소의 아래쪽 끝에서 그 아래에 처음 나오는 1px `border-foreground` 선(제목 블록 구분선)의 아래쪽 끝까지 거리 */
async function gapToDivider(from: Locator) {
  await from.waitFor();
  return from.evaluate((el) => {
    const fromBottom = el.getBoundingClientRect().bottom;
    let lineBottom = Number.POSITIVE_INFINITY;
    for (const node of document.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      if (
        style.borderBottomWidth !== "1px" ||
        style.borderBottomColor !== "rgb(24, 24, 27)"
      ) {
        continue;
      }
      const bottom = node.getBoundingClientRect().bottom;
      if (bottom >= fromBottom - 0.5 && bottom < lineBottom) {
        lineBottom = bottom;
      }
    }
    return Math.round(lineBottom - fromBottom);
  });
}

// 제목 블록의 구분선 간격은 16px(pb-4) + 선 1px = 17로 통일한다. 통일 전에는 라이브러리만 12px(mt-3) + 1px = 13이었다.
test.describe("제목 블록 구분선 간격", () => {
  test("라이브러리: 안내 박스(없으면 제목) 아래", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));
    await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();

    const notice = page.getByRole("button", { name: "Notion 연동 설정" });
    const from = (await notice.count())
      ? notice.locator("..")
      : page.getByRole("heading", { level: 1 });
    expect(await gapToDivider(from)).toBe(17);
  });

  test("Notion 설정: 설명 아래", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/settings/notion"));

    expect(
      await gapToDivider(
        page.getByText("먼저 Notion OAuth 연결을 완료해야", { exact: false }),
      ),
    ).toBe(17);
  });

  test("Notion 연결: 설명 아래", async ({ page }) => {
    await dismissInstallPrompt(page);
    await seedHandoff(page);
    await mockNotionStatus(page, {
      notionConnected: false,
      dbConnected: false,
    });
    await page.goto(withBasePath("/notion/connect"));

    expect(
      await gapToDivider(
        page
          .getByRole("heading", { level: 1 })
          .locator("xpath=following-sibling::p[1]"),
      ),
    ).toBe(17);
  });
});

type EyebrowLabel = { text: string; letterSpacing: string };

/** 화면에서 12px / 500 / uppercase인 라벨(eyebrow)을 자기 텍스트 기준으로 모은다 */
async function collectEyebrows(page: import("@playwright/test").Page) {
  return page.evaluate((): EyebrowLabel[] => {
    const labels: EyebrowLabel[] = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (
        style.textTransform !== "uppercase" ||
        style.fontSize !== "12px" ||
        style.fontWeight !== "500"
      ) {
        continue;
      }
      const own = Array.from(el.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent?.trim() ?? "")
        .join("")
        .trim();
      if (own) labels.push({ text: own, letterSpacing: style.letterSpacing });
    }
    return labels;
  });
}

/** eyebrow 라벨의 자간은 모두 0.15em(=12px × 0.15 = 1.8px)이고, 기대한 라벨이 실제로 잡혔는지 함께 본다 */
function expectEyebrows(
  labels: EyebrowLabel[],
  expectedTexts: Array<string | string[]>,
) {
  expect(
    labels.filter((label) => label.letterSpacing !== "1.8px"),
    "자간이 1.8px이 아닌 eyebrow 라벨",
  ).toEqual([]);
  const texts = labels.map((label) => label.text);
  for (const expected of expectedTexts) {
    // 배열이면 그중 하나만 있으면 된다(예: 단위는 kg 또는 lb)
    const options = Array.isArray(expected) ? expected : [expected];
    expect(
      options.some((text) => texts.includes(text)),
      `eyebrow 라벨 ${options.join(" 또는 ")}`,
    ).toBe(true);
  }
}

/** 첫 운동이 접혀 있으면 펼친다 */
async function expandFirstExercise(page: import("@playwright/test").Page) {
  const firstSet = page.getByRole("checkbox", { name: "세트 1 완료" });
  if (!(await firstSet.isVisible())) {
    await page.getByRole("button", { name: /랫풀다운/ }).click();
  }
  await firstSet.waitFor();
}

test.describe("eyebrow 라벨 자간", () => {
  test("세션: kg / reps / set 라벨과 세트 표 머리글", async ({ page }) => {
    await openLibrarySession(page);
    await expandFirstExercise(page);

    expectEyebrows(await collectEyebrows(page), [
      ["kg", "lb"],
      "reps",
      "set",
      "세트",
      "무게",
      "횟수",
      "완료",
    ]);
  });

  test("세션: 이전 기록 영역", async ({ page }) => {
    await openLibrarySession(page);
    await page.getByRole("button", { name: /랫풀다운/ }).click();
    await page.getByRole("checkbox", { name: "세트 1 완료" }).click();
    await page.getByRole("button", { name: "운동 완료" }).click();
    await startSessionFromLibrary(page, "랫풀다운");
    await expandFirstExercise(page);

    expectEyebrows(await collectEyebrows(page), [
      "이전 기록",
      "메모",
      ["kg", "lb"],
      "reps",
    ]);
  });

  test("헤더 설정 메뉴: 테마", async ({ page }) => {
    await openLibrarySession(page);
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await page.getByText("테마", { exact: true }).waitFor();

    expectEyebrows(await collectEyebrows(page), ["테마"]);
  });

  test("랜딩: Session Demo와 섹션 번호", async ({ page }) => {
    await dismissInstallPrompt(page);
    await page.goto(withBasePath("/"));

    expectEyebrows(await collectEyebrows(page), ["Session Demo"]);

    // 섹션 번호는 숫자라 uppercase 여부와 무관하므로 값으로 직접 확인한다
    const index = page
      .locator('section[aria-label="Product philosophy"]')
      .getByText("01", { exact: true });
    expect(
      await index.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
        };
      }),
    ).toEqual({ fontSize: "12px", fontWeight: "500", letterSpacing: "1.8px" });
  });

  test.describe("360px", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("set 라벨이 −/+ 원과 겹치지 않고 가로 스크롤이 없다", async ({
      page,
    }) => {
      await openLibrarySession(page);
      await expandFirstExercise(page);

      // Playwright의 getByText가 uppercase 텍스트를 못 찾아서 DOM에서 직접 찾는다
      const rects = await page.evaluate(() => {
        const rectOf = (el: Element | null | undefined) => {
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        };
        // 헤더 로고(daily set)에도 "set" 스팬이 있어서, 앞 형제가 "세트 삭제" 버튼인 것만 고른다
        const label = Array.from(document.querySelectorAll("span")).find(
          (el) =>
            el.children.length === 0 &&
            el.textContent?.trim() === "set" &&
            el.previousElementSibling?.getAttribute("aria-label") ===
              "세트 삭제",
        );
        // 세트 행에도 같은 이름의 버튼이 있어서, set 라벨 바로 앞뒤의 −/+ 버튼 안 원을 쓴다
        return {
          minus: rectOf(label?.previousElementSibling?.querySelector("span")),
          label: rectOf(label),
          plus: rectOf(label?.nextElementSibling?.querySelector("span")),
        };
      });
      const { minus, label, plus } = rects;
      expect(minus && label && plus, "− 원, set 라벨, + 원을 모두 찾음").toBeTruthy();

      expect(minus!.right, "− 원 오른쪽 끝 ≤ 라벨 왼쪽 끝").toBeLessThanOrEqual(
        label!.left,
      );
      expect(label!.right, "라벨 오른쪽 끝 ≤ + 원 왼쪽 끝").toBeLessThanOrEqual(
        plus!.left,
      );
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        "가로 스크롤 없음",
      ).toBe(true);
    });
  });
});
