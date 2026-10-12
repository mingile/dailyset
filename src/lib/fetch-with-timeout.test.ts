import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetch-with-timeout";

function hangingFetch(_input: RequestInfo | URL, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("제한 시간 안에 응답이 오면 그대로 반환한다", async () => {
    const response = new Response("ok");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchWithTimeout("/api", undefined, 3000)).resolves.toBe(
      response,
    );
  });

  it("제한 시간을 넘기면 abort 에러로 reject한다", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));

    const promise = fetchWithTimeout("/api", undefined, 3000);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });

    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("제한 시간 직전에는 아직 reject하지 않는다", async () => {
    const fetchMock = vi.fn(hangingFetch);
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    fetchWithTimeout("/api", undefined, 3000).catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("정상 완료 후에는 타이머가 남지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));

    await fetchWithTimeout("/api", undefined, 3000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("요청이 실패해도 타이머가 남지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(fetchWithTimeout("/api", undefined, 3000)).rejects.toThrow(
      "offline",
    );

    expect(vi.getTimerCount()).toBe(0);
  });

  it("호출자의 signal이 abort되면 요청도 중단한다", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));
    const caller = new AbortController();

    const promise = fetchWithTimeout("/api", { signal: caller.signal }, 3000);
    const assertion = expect(promise).rejects.toMatchObject({
      name: "AbortError",
    });

    caller.abort();
    await assertion;
  });

  it("fetch에 init 옵션을 전달한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await fetchWithTimeout("/api", { method: "GET", cache: "no-store" }, 3000);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});
