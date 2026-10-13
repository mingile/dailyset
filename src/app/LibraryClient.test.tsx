import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test-utils/query";
import { LibraryClient } from "./LibraryClient";
import type { NotionConnection } from "./types";

// LibraryClient가 hook의 상태를 화면에 연결하는 것(연결 상태별 안내, 오류 화면의 다시 시도)만 검증한다.
// 조회·캐시·fallback 규칙은 useExerciseLibrary.test가 보장한다.

const READ = "/api/notion/exercise-read";

const notionRow = {
  id: "notion-page-lat",
  properties: {
    exercise_id: { rich_text: [{ plain_text: "lat-pulldown" }] },
    이름: { title: [{ plain_text: "랫풀다운" }] },
    카테고리: { select: { name: "등" } },
    장비: { select: { name: "케이블" } },
  },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderLibrary(notionConnection: NotionConnection) {
  const user = userEvent.setup();
  const { Wrapper } = createQueryWrapper();
  render(
    <LibraryClient
      notionConnection={notionConnection}
      onConfirmSelection={() => {}}
    />,
    { wrapper: Wrapper },
  );
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LibraryClient — 연결 상태별 화면", () => {
  it.each([
    ["disconnected", /노션 미연동/],
    ["unknown", /네트워크 연결 없음/],
  ] as const)(
    "%s이면 요청 없이 내장 목록과 안내 문구를 보여준다",
    async (connection, notice) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      renderLibrary(connection);

      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "다시 시도" }),
      ).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("연결되어 있고 exercise-read가 오류 응답이면 다시 시도 버튼을 누를 때 다시 조회해 목록을 보여준다", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "notion down" }, 500)
        : jsonResponse({ data: [notionRow] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = renderLibrary("connected");

    await user.click(await screen.findByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("랫풀다운")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "다시 시도" }),
    ).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes(READ)),
    ).toHaveLength(2);
  });
});
