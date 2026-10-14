import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  dismissInstallPrompt,
  mockNotionDisconnected,
  openLibrarySession,
  withBasePath,
} from "../helpers";

// 운동 선택 목록(카테고리 탭 바 + 운동 행)이 운동 라이브러리와 `운동 추가` 시트에서
// 같은 동작·표시를 하는지 확인한다. 정확한 px / 색 값이 아니라 사용자에게 보이는 불변 조건만 본다:
// 활성 탭, 선택 상태, accent 표시, 클릭 동작, 좁은 화면 레이아웃.

test.use({ viewport: { width: 360, height: 740 } });

type TabInfo = {
  text: string;
  fontWeight: number;
  borderBottomColor: string;
};

async function readTabs(scope: Locator) {
  const bar = scope.locator(".sticky");
  await bar.waitFor();
  return bar.evaluate((el) => ({
    sticky: getComputedStyle(el).position === "sticky",
    scrollsHorizontally: getComputedStyle(el.children[0]).overflowX === "auto",
    tabs: Array.from(el.querySelectorAll("button")).map((button) => {
      const style = getComputedStyle(button);
      return {
        text: button.textContent?.trim() ?? "",
        fontWeight: Number(style.fontWeight),
        borderBottomColor: style.borderBottomColor,
      };
    }),
  }));
}

/** 선택된 탭 하나만 더 굵고 밑줄 색이 다르다 */
function expectActiveTab(tabs: TabInfo[], activeText: string) {
  const active = tabs.find((tab) => tab.text === activeText);
  expect(active, `활성 탭 ${activeText}`).toBeTruthy();
  for (const tab of tabs.filter((other) => other.text !== activeText)) {
    expect(active!.fontWeight, tab.text).toBeGreaterThan(tab.fontWeight);
    expect(active!.borderBottomColor, tab.text).not.toBe(tab.borderBottomColor);
  }
}

async function readRow(row: Locator) {
  await row.waitFor();
  return row.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const parts = Array.from(el.children);
    // 선택 하이라이트는 클릭을 가로채지 않는 장식 요소다
    const overlays = parts.filter(
      (part) => getComputedStyle(part).pointerEvents === "none",
    );
    const overlayRects = overlays.map((overlay) => {
      const overlayRect = overlay.getBoundingClientRect();
      return {
        left: overlayRect.left,
        right: overlayRect.right,
        visible:
          getComputedStyle(overlay).backgroundColor !== "rgba(0, 0, 0, 0)",
      };
    });
    const number = parts.find(
      (part) => !overlays.includes(part) && /^\d+$/.test(part.textContent ?? ""),
    );
    const icon = el.querySelector("svg");
    const iconRect = icon?.getBoundingClientRect();
    return {
      pressed: el.getAttribute("aria-pressed"),
      height: rect.height,
      right: rect.right,
      overlays: overlayRects,
      numberWeight: number ? Number(getComputedStyle(number).fontWeight) : null,
      hasCheck: Boolean(icon),
      checkInsideViewport: iconRect
        ? iconRect.left >= 0 && iconRect.right <= window.innerWidth
        : null,
    };
  });
}

async function expectNoHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    "가로 스크롤 없음",
  ).toBe(true);
}

async function checkPicker(page: Page, scope: Locator, ctaName: RegExp) {
  const rows = scope.locator("button[aria-pressed]");
  await rows.first().waitFor();
  const cta = scope.getByRole("button", { name: ctaName });

  // 탭 바: sticky, 가로 스크롤 가능, 첫 탭만 활성
  const initial = await readTabs(scope);
  expect(initial.sticky).toBe(true);
  expect(initial.scrollsHorizontally).toBe(true);
  expect(initial.tabs.length).toBeGreaterThan(1);
  expectActiveTab(initial.tabs, initial.tabs[0].text);

  // 선택 전: 어떤 행도 선택/하이라이트/체크가 없다
  const before = await readRow(rows.nth(1));
  expect(before).toMatchObject({
    pressed: "false",
    overlays: [],
    hasCheck: false,
  });
  expect(before.height).toBeGreaterThanOrEqual(44);
  await expect(cta).toContainText("(0)");

  // 클릭: 선택 표시(aria, accent 하이라이트, 체크, 굵은 번호)와 카운트
  await rows.nth(1).click();
  const selected = await readRow(rows.nth(1));
  expect(selected.pressed).toBe("true");
  expect(selected.hasCheck).toBe(true);
  expect(selected.checkInsideViewport).toBe(true);
  expect(selected.numberWeight!).toBeGreaterThan(before.numberWeight!);
  expect(selected.overlays.length).toBe(2);
  expect(selected.overlays.every((overlay) => overlay.visible)).toBe(true);
  // 하이라이트는 화면 좌우 끝까지 닿는다
  const edges = selected.overlays.map((overlay) => overlay.left);
  expect(Math.min(...edges)).toBeLessThanOrEqual(1);
  expect(Math.max(...selected.overlays.map((overlay) => overlay.right))).toBeGreaterThanOrEqual(359);
  await expect(cta).toContainText("(1)");
  // 다른 행은 영향받지 않는다
  expect(await readRow(rows.nth(0))).toMatchObject({
    pressed: "false",
    overlays: [],
    hasCheck: false,
  });

  // 다시 클릭하면 해제된다
  await rows.nth(1).click();
  expect(await readRow(rows.nth(1))).toMatchObject({
    pressed: "false",
    overlays: [],
    hasCheck: false,
  });
  await expect(cta).toContainText("(0)");

  // 다른 탭을 누르면 활성 탭이 옮겨가고 행 목록이 바뀐다
  const firstRowName = await rows.first().innerText();
  const nextTab = initial.tabs[1].text;
  await scope
    .locator(".sticky")
    .getByRole("button", { name: nextTab, exact: true })
    .click();
  await expect
    .poll(async () => expectActiveTabSafe((await readTabs(scope)).tabs, nextTab))
    .toBe(true);
  const rowsAfter = scope.locator("button[aria-pressed]");
  if (await rowsAfter.count()) {
    expect(await rowsAfter.first().innerText()).not.toBe(firstRowName);
  }

  await expectNoHorizontalScroll(page);
}

function expectActiveTabSafe(tabs: TabInfo[], activeText: string) {
  try {
    expectActiveTab(tabs, activeText);
    return true;
  } catch {
    return false;
  }
}

test.describe("운동 선택 목록", () => {
  test("운동 라이브러리", async ({ page }) => {
    await dismissInstallPrompt(page);
    await mockNotionDisconnected(page);
    await page.goto(withBasePath("/app"));
    await page.getByRole("heading", { name: "운동 라이브러리" }).waitFor();

    await checkPicker(page, page.locator("body"), /선택 완료/);
  });

  test("운동 추가 시트", async ({ page }) => {
    await openLibrarySession(page);
    await page.getByRole("button", { name: /운동 추가/ }).click();

    await checkPicker(page, page.getByRole("dialog"), /추가하기/);
  });
});
