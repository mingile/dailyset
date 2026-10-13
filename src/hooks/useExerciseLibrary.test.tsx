import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotionConnection } from "@/app/types";
import { createQueryWrapper } from "@/test-utils/query";
import {
  EXERCISE_LIBRARY_QUERY_KEY,
  useExerciseLibrary,
} from "./useExerciseLibrary";

// useExerciseLibrary가 연결하는 것(연결 상태 → exercise-read → 내장 목록 fallback, 캐시, 취소)만 검증한다.
// Notion 행 변환·카테고리 정렬은 lib/library의 책임이고, 연결 상태 조회는 RootClient의 책임이다.

// ---- 경계 stub ----

type Handler = (init?: RequestInit) => Response | Promise<Response>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const notionRow = (
  id: string,
  exerciseId: string,
  name: string,
  cat: string,
) => ({
  id,
  properties: {
    exercise_id: { rich_text: [{ plain_text: exerciseId }] },
    이름: { title: [{ plain_text: name }] },
    카테고리: { select: { name: cat } },
    장비: { select: { name: "케이블" } },
  },
});

const twoRows: Handler = () =>
  jsonResponse({
    data: [
      notionRow("p1", "lat-pulldown", "랫풀다운", "등"),
      notionRow("p2", "bench", "벤치프레스", "가슴"),
    ],
  });

const networkError: Handler = () => {
  throw new TypeError("Failed to fetch");
};

/** exercise-read만 stub한다. status는 이 hook의 책임이 아니므로 호출되면 실패시킨다. */
function stubFetch(exerciseRead: Handler = twoRows) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/notion/exercise-read")) return exerciseRead(init);
      throw new Error(`stub되지 않은 요청: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function countCalls(fetchMock: ReturnType<typeof stubFetch>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes(path))
    .length;
}

const STATUS = "/api/notion/status";
const READ = "/api/notion/exercise-read";

/** 연결 상태는 hook의 인자다. 바꿀 때는 rerender({ connection })을 쓴다. */
function renderLibrary(
  wrapper: ReturnType<typeof createQueryWrapper>["Wrapper"],
  connection: NotionConnection = "connected",
) {
  return renderHook(
    ({ connection }: { connection: NotionConnection }) =>
      useExerciseLibrary(connection),
    { wrapper, initialProps: { connection } },
  );
}

type Rendered = { current: ReturnType<typeof useExerciseLibrary> };

function readState(result: Rendered) {
  return result.current.libraryState;
}

function expectSuccess(state: ReturnType<typeof readState>) {
  if (state.status !== "success") throw new Error("success가 아님");
  return state;
}

beforeEach(() => {
  // fallback 경로의 console.error는 테스트 출력에서 제외한다
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useExerciseLibrary — 연결됨(connected)", () => {
  it("처음에는 loading이다", () => {
    stubFetch();
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    expect(readState(result)).toEqual({ status: "loading" });
  });

  it("Notion 운동 목록을 success로 보여주고 status는 조회하지 않는다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() => expect(readState(result).status).toBe("success"));
    const state = expectSuccess(readState(result));
    expect(state.source).toBe("notion");
    expect(state.exercises.map((e) => e.name)).toEqual([
      "랫풀다운",
      "벤치프레스",
    ]);
    expect(countCalls(fetchMock, READ)).toBe(1);
    expect(countCalls(fetchMock, STATUS)).toBe(0);
  });

  it("Notion 목록이 비어 있으면 empty다", async () => {
    stubFetch(() => jsonResponse({ data: [] }));
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() => expect(readState(result)).toEqual({ status: "empty" }));
  });

  it("네트워크 오류(예외)는 내장 목록으로 fallback한다", async () => {
    stubFetch(networkError);
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() => expect(readState(result).status).toBe("success"));
    const state = expectSuccess(readState(result));
    expect(state.source).toBe("builtin");
    expect(state.message).toContain("네트워크 연결 없음");
    expect(state.exercises.length).toBeGreaterThan(0);
  });

  it("exercise-read 오류 응답은 error로 보여준다 (내장 목록으로 대체하지 않는다)", async () => {
    stubFetch(() => jsonResponse({ error: "boom" }, 500));
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() =>
      expect(readState(result)).toEqual({ status: "error", message: "boom" }),
    );
  });

  it("오류 응답에 메시지가 없으면 기본 문구를 쓴다", async () => {
    stubFetch(() => jsonResponse({}, 500));
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() =>
      expect(readState(result)).toEqual({
        status: "error",
        message: "Failed to fetch exercises",
      }),
    );
  });

  it("오류 응답 본문이 JSON이 아니면 네트워크 오류처럼 내장 목록으로 fallback한다", async () => {
    stubFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() => expect(readState(result).status).toBe("success"));
    const state = expectSuccess(readState(result));
    expect(state.source).toBe("builtin");
    expect(state.message).toContain("네트워크 연결 없음");
  });

  it("refetch는 loading을 거쳐 새 결과를 보여준다 (error → success)", async () => {
    let exerciseRead: Handler = () => jsonResponse({ error: "boom" }, 500);
    stubFetch((init) => exerciseRead(init));
    const { Wrapper } = createQueryWrapper();
    const { result } = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(result).status).toBe("error"));

    // 응답을 보류시켜 loading이 화면에 실제로 보이는 구간을 만든다
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    exerciseRead = async (init) => {
      await gate;
      return twoRows(init);
    };
    act(() => {
      void result.current.refetch();
    });

    await waitFor(() =>
      expect(readState(result)).toEqual({ status: "loading" }),
    );
    release();
    await waitFor(() => expect(readState(result).status).toBe("success"));
  });
});

describe("useExerciseLibrary — 연결 상태에 따른 동작", () => {
  it("disconnected이면 요청 없이 곧바로 내장 목록과 미연동 안내를 보여준다", () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper, "disconnected");

    const state = expectSuccess(readState(result));
    expect(state.source).toBe("builtin");
    expect(state.message).toContain("노션 미연동");
    expect(state.exercises.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown이고 캐시가 없으면 요청 없이 내장 목록과 네트워크 안내를 보여준다", () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper, "unknown");

    const state = expectSuccess(readState(result));
    expect(state.source).toBe("builtin");
    expect(state.message).toContain("네트워크 연결 없음");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unknown이어도 캐시된 Notion 목록이 있으면 그것을 보여준다 (확인 못 한 것이지 연결 안 됨이 아니다)", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(result).status).toBe("success"));

    rerender({ connection: "unknown" });

    const state = expectSuccess(readState(result));
    expect(state.source).toBe("notion");
    expect(state.exercises.map((e) => e.name)).toEqual([
      "랫풀다운",
      "벤치프레스",
    ]);
    expect(countCalls(fetchMock, READ)).toBe(1);
  });

  it("disconnected이면 캐시된 Notion 목록이 있어도 보여주지 않는다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(result).status).toBe("success"));

    rerender({ connection: "disconnected" });

    const state = expectSuccess(readState(result));
    expect(state.source).toBe("builtin");
    expect(state.message).toContain("노션 미연동");
    expect(countCalls(fetchMock, READ)).toBe(1);
  });

  it("disconnected에서 connected로 바뀌면 그때 Notion 목록을 조회한다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderLibrary(Wrapper, "disconnected");
    expect(countCalls(fetchMock, READ)).toBe(0);

    rerender({ connection: "connected" });

    await waitFor(() => {
      const s = readState(result);
      expect(s.status === "success" && s.source).toBe("notion");
    });
    expect(countCalls(fetchMock, READ)).toBe(1);
  });
});

describe("useExerciseLibrary — 캐시", () => {
  it("Notion 목록은 hook을 다시 마운트해도(시트 재오픈) 재요청하지 않고 바로 보여준다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("success"));
    first.unmount();

    const second = renderLibrary(Wrapper);

    // 첫 렌더부터 캐시된 목록이 보인다 (loading을 거치지 않는다)
    expect(readState(second.result).status).toBe("success");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(countCalls(fetchMock, READ)).toBe(1);
  });

  it("동시에 쓰는 소비자가 여러 개여도 요청은 한 번이다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () =>
        [
          useExerciseLibrary("connected"),
          useExerciseLibrary("connected"),
        ] as const,
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(result.current[1].libraryState.status).toBe("success"),
    );
    expect(countCalls(fetchMock, READ)).toBe(1);
  });

  it("내장 목록 fallback은 캐시에 굳히지 않고 다시 마운트하면 재조회한다", async () => {
    const fetchMock = stubFetch(networkError);
    const { Wrapper } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("success"));
    first.unmount();

    renderLibrary(Wrapper);

    await waitFor(() => expect(countCalls(fetchMock, READ)).toBe(2));
  });

  it("빈 목록(empty)도 캐시에 굳히지 않는다", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ data: [] }));
    const { Wrapper } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("empty"));
    first.unmount();

    renderLibrary(Wrapper);

    await waitFor(() => expect(countCalls(fetchMock, READ)).toBe(2));
  });

  it("무효화하면 캐시된 Notion 목록도 다시 마운트할 때 재조회한다", async () => {
    const fetchMock = stubFetch();
    const { Wrapper, queryClient } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("success"));
    first.unmount();

    await queryClient.invalidateQueries({
      queryKey: EXERCISE_LIBRARY_QUERY_KEY,
    });
    renderLibrary(Wrapper);

    await waitFor(() => expect(countCalls(fetchMock, READ)).toBe(2));
  });

  it("오류(error)는 캐시에 굳히지 않고 다시 마운트하면 재조회한다", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ error: "boom" }, 500));
    const { Wrapper } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("error"));
    first.unmount();

    renderLibrary(Wrapper);

    await waitFor(() => expect(countCalls(fetchMock, READ)).toBe(2));
  });
});

describe("useExerciseLibrary — 취소", () => {
  it("exercise-read 진행 중에 unmount하면 요청을 중단한다", async () => {
    let readSignal: AbortSignal | null | undefined;
    stubFetch((init) => {
      readSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    });
    const { Wrapper } = createQueryWrapper();
    const { unmount } = renderLibrary(Wrapper);
    await waitFor(() => expect(readSignal).toBeDefined());
    expect(readSignal?.aborted).toBe(false);

    unmount();

    await waitFor(() => expect(readSignal?.aborted).toBe(true));
  });
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

describe("useExerciseLibrary — Notion 목록 2시간 캐시", () => {
  async function mountOnce(
    wrapper: ReturnType<typeof createQueryWrapper>["Wrapper"],
  ) {
    const mounted = renderLibrary(wrapper);
    await waitFor(() =>
      expect(readState(mounted.result).status).toBe("success"),
    );
    return mounted;
  }

  it("2시간 안에는 다시 마운트해도 재요청하지 않고, 2시간이 지나면 재조회한다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));
    const fetchMock = stubFetch();
    const { Wrapper } = createQueryWrapper();
    (await mountOnce(Wrapper)).unmount();

    vi.setSystemTime(Date.now() + TWO_HOURS_MS - MINUTE_MS);
    const withinCache = renderLibrary(Wrapper);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(countCalls(fetchMock, READ)).toBe(1);
    withinCache.unmount();

    vi.setSystemTime(Date.now() + 2 * MINUTE_MS);
    renderLibrary(Wrapper);
    await waitFor(() => expect(countCalls(fetchMock, READ)).toBe(2));
  });

  it("구독자가 없는 채로 기본 gcTime(5분)이 지나도 캐시가 남고, 2시간이 지나면 지워진다", async () => {
    stubFetch();
    const { Wrapper, queryClient } = createQueryWrapper();
    const { unmount } = await mountOnce(Wrapper);

    // 구독 해제 시 예약되는 gc 타이머를 가짜 시계로 받는다
    vi.useFakeTimers();
    unmount();

    vi.advanceTimersByTime(10 * MINUTE_MS);
    expect(queryClient.getQueryData(EXERCISE_LIBRARY_QUERY_KEY)).toBeDefined();

    vi.advanceTimersByTime(TWO_HOURS_MS);
    expect(
      queryClient.getQueryData(EXERCISE_LIBRARY_QUERY_KEY),
    ).toBeUndefined();
  });
});

describe("useExerciseLibrary — 재조회 실패 시 이전 Notion 목록 유지", () => {
  /** Notion 목록을 캐시에 올리고 무효화(= 재조회 대상)한 뒤, 이후 응답을 바꿀 수 있는 handlers를 돌려준다 */
  async function setupCachedNotion() {
    const handlers: { exerciseRead: Handler } = { exerciseRead: twoRows };
    const fetchMock = stubFetch((init) => handlers.exerciseRead(init));
    const { Wrapper, queryClient } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("success"));
    first.unmount();
    await queryClient.invalidateQueries({
      queryKey: EXERCISE_LIBRARY_QUERY_KEY,
    });
    return { handlers, fetchMock, Wrapper, queryClient };
  }

  const failures: [string, Handler][] = [
    ["exercise-read 네트워크 예외", networkError],
    ["exercise-read 오류 응답", () => jsonResponse({ error: "boom" }, 500)],
    [
      "exercise-read 비-JSON 오류 응답",
      () => new Response("<html>502</html>", { status: 502 }),
    ],
  ];

  it.each(failures)(
    "%s로 재조회가 실패해도 이전 Notion 목록을 유지하고, 다음 마운트에서 다시 시도한다",
    async (_name, failure) => {
      const { handlers, fetchMock, Wrapper, queryClient } =
        await setupCachedNotion();
      handlers.exerciseRead = failure;

      const second = renderLibrary(Wrapper);
      await waitFor(() =>
        expect(
          queryClient.getQueryState(EXERCISE_LIBRARY_QUERY_KEY)?.status,
        ).toBe("error"),
      );

      const state = expectSuccess(readState(second.result));
      expect(state.source).toBe("notion");
      expect(state.exercises.map((e) => e.name)).toEqual([
        "랫풀다운",
        "벤치프레스",
      ]);
      second.unmount();

      // 실패한 결과를 신선한 것으로 취급하지 않는다: 다음 마운트에서 다시 조회하고, 복구되면 새 목록이 보인다
      const readCallsBefore = countCalls(fetchMock, READ);
      handlers.exerciseRead = () =>
        jsonResponse({ data: [notionRow("p3", "squat", "스쿼트", "하체")] });
      const third = renderLibrary(Wrapper);
      await waitFor(() => {
        const s = readState(third.result);
        expect(
          s.status === "success" && s.exercises.map((e) => e.name),
        ).toEqual(["스쿼트"]);
      });
      expect(countCalls(fetchMock, READ)).toBeGreaterThan(readCallsBefore);
    },
  );

  it("캐시된 것이 Notion 목록이 아니면(내장 목록) exercise-read 오류는 그대로 error로 보여준다", async () => {
    const handlers: { exerciseRead: Handler } = { exerciseRead: networkError };
    stubFetch((init) => handlers.exerciseRead(init));
    const { Wrapper } = createQueryWrapper();
    const first = renderLibrary(Wrapper);
    await waitFor(() => expect(readState(first.result).status).toBe("success"));
    first.unmount();
    handlers.exerciseRead = () => jsonResponse({ error: "boom" }, 500);

    const { result } = renderLibrary(Wrapper);

    await waitFor(() =>
      expect(readState(result)).toEqual({ status: "error", message: "boom" }),
    );
  });

  it("최초 조회(캐시 없음) 실패는 기존처럼 내장 목록으로 fallback한다", async () => {
    stubFetch(networkError);
    const { Wrapper } = createQueryWrapper();

    const { result } = renderLibrary(Wrapper);

    await waitFor(() => {
      const s = readState(result);
      expect(s.status === "success" && s.source).toBe("builtin");
    });
  });
});
