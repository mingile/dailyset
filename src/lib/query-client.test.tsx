import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryWrapper } from "@/test-utils/query";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { createQueryClient } from "./query-client";

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe("createQueryClient 기본 옵션", () => {
  it("오프라인에서도 실행(always), 재시도 없음, 창 포커스 재조회 없음으로 고정한다", () => {
    const queries = createQueryClient().getDefaultOptions().queries;

    expect(queries?.networkMode).toBe("always");
    expect(queries?.retry).toBe(false);
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });

  it("staleTime·gcTime 전역 기본값은 바꾸지 않는다", () => {
    const queries = createQueryClient().getDefaultOptions().queries;

    expect(queries?.staleTime).toBeUndefined();
    expect(queries?.gcTime).toBeUndefined();
  });
});

describe("오프라인 동작", () => {
  it("[대조군] 기본 QueryClient는 오프라인이면 queryFn을 실행하지 않고 멈춘다", async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn(async () => "data");
    const defaultClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={defaultClient}>
        {children}
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => useQuery({ queryKey: ["offline"], queryFn }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("paused"));
    expect(result.current.isPending).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("createQueryClient는 오프라인에서도 queryFn을 실행하고 실패는 error로 전달한다", async () => {
    onlineManager.setOnline(false);
    const { Wrapper } = createQueryWrapper();
    const queryFn = vi.fn(async () => {
      throw new Error("network down");
    });

    const { result } = renderHook(
      () => useQuery({ queryKey: ["offline"], queryFn }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe("network down");
  });

  it("실패해도 재시도하지 않는다", async () => {
    const { Wrapper } = createQueryWrapper();
    const queryFn = vi.fn(async () => {
      throw new Error("fail");
    });

    const { result } = renderHook(
      () => useQuery({ queryKey: ["no-retry"], queryFn }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithTimeout과 query signal 조합", () => {
  function stubAbortableFetch() {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("query가 구독자 없이 정리되면(unmount) 진행 중인 요청을 중단한다", async () => {
    const fetchMock = stubAbortableFetch();
    const { Wrapper } = createQueryWrapper();

    const { unmount } = renderHook(
      () =>
        useQuery({
          queryKey: ["abort"],
          queryFn: ({ signal }) => fetchWithTimeout("/x", { signal }, 3000),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("signal을 넘기지 않으면 unmount해도 요청이 중단되지 않는다 (대조군)", async () => {
    const fetchMock = stubAbortableFetch();
    const { Wrapper } = createQueryWrapper();

    const { unmount } = renderHook(
      () =>
        useQuery({
          queryKey: ["no-abort"],
          queryFn: () => fetchWithTimeout("/x", undefined, 3000),
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = fetchMock.mock.calls[0][1]?.signal;

    unmount();
    // 정리 로직이 비동기로 돌 시간을 준다
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(signal?.aborted).toBe(false);
  });
});

describe("staleTime 함수", () => {
  type Data = { source: "notion" | "builtin" };

  async function fetchTwice(source: Data["source"]) {
    const client = createQueryClient();
    const queryFn = vi.fn(async (): Promise<Data> => ({ source }));
    const options = {
      queryKey: ["library"],
      queryFn,
      // source가 notion일 때만 신선하게 취급한다
      staleTime: (query: { state: { data: Data | undefined } }) =>
        query.state.data?.source === "notion" ? 60_000 : 0,
    };

    await client.fetchQuery(options);
    await client.fetchQuery(options);
    return queryFn;
  }

  it("신선한 결과(notion)는 두 번째 조회에서 queryFn을 다시 실행하지 않는다", async () => {
    const queryFn = await fetchTwice("notion");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("바로 stale이 되는 결과(builtin)는 두 번째 조회에서 다시 실행한다", async () => {
    const queryFn = await fetchTwice("builtin");
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
