import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addJob,
  flushNotionOutbox,
  markFailed,
  markQueued,
  NOTION_OUTBOX_KEY,
  type NotionOutboxPayload,
  parseOutbox,
  readLastKnownDbConnected,
  readOutbox,
  recordAttemptFailure,
  removeJob,
  retryFailed,
  selectPendingJobs,
  writeLastKnownDbConnected,
  writeOutbox,
} from "./notion-outbox";

const T0 = "2026-10-12T10:00:00.000Z";
const T1 = "2026-10-12T10:01:00.000Z";
const T2 = "2026-10-12T10:02:00.000Z";

function makePayload(sessionId: string, savedAt = T0): NotionOutboxPayload {
  return {
    sessionId,
    sessionName: "가슴",
    startedAt: "2026-10-12T09:00:00.000Z",
    savedAt,
    exercises: [
      {
        id: `${sessionId}-ex`,
        name: "벤치프레스",
        part: "가슴",
        exercisePageId: "page-1",
        sets: [
          { setNo: 1, weight: 60, reps: 10, memo: "", equipment: "barbell" },
        ],
      },
    ],
  };
}

describe("addJob", () => {
  it("payload 스냅샷을 pending 작업으로 추가한다", () => {
    const payload = makePayload("s1");
    const jobs = addJob([], payload, T0);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      sessionId: "s1",
      savedAt: T0,
      payload,
      status: "pending",
      attempts: 0,
      createdAt: T0,
      updatedAt: T0,
    });
  });

  it("같은 sessionId는 새 pending 작업으로 덮어쓴다", () => {
    const first = markQueued(addJob([], makePayload("s1"), T0), "s1", T1);
    const jobs = addJob(first, makePayload("s1", T2), T2);

    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].savedAt).toBe(T2);
    expect(jobs[0].attempts).toBe(0);
    expect(jobs[0].createdAt).toBe(T2);
  });

  it("다른 sessionId의 작업은 유지한다", () => {
    const jobs = addJob(
      addJob([], makePayload("s1"), T0),
      makePayload("s2"),
      T1,
    );
    expect(jobs.map((j) => j.sessionId)).toEqual(["s1", "s2"]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const original = addJob([], makePayload("s1"), T0);
    const snapshot = JSON.stringify(original);
    addJob(original, makePayload("s2"), T1);
    markQueued(original, "s1", T1);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("상태 전이", () => {
  it("추가 → queued → 제거", () => {
    let jobs = addJob([], makePayload("s1"), T0);
    jobs = markQueued(jobs, "s1", T1);
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].updatedAt).toBe(T1);

    jobs = removeJob(jobs, "s1");
    expect(jobs).toEqual([]);
  });

  it("전송 실패는 pending을 유지하고 attempts와 lastError를 기록한다", () => {
    let jobs = addJob([], makePayload("s1"), T0);
    jobs = recordAttemptFailure(jobs, "s1", "Failed to fetch", T1);
    jobs = recordAttemptFailure(jobs, "s1", "HTTP 500", T2);

    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].attempts).toBe(2);
    expect(jobs[0].lastError).toBe("HTTP 500");
  });

  it("전송 실패 후 queued가 되면 lastError를 지운다", () => {
    let jobs = addJob([], makePayload("s1"), T0);
    jobs = recordAttemptFailure(jobs, "s1", "Failed to fetch", T1);
    jobs = markQueued(jobs, "s1", T2);

    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].lastError).toBeUndefined();
  });

  it("failed → pending 재시도는 failedReason을 지우고 payload를 유지한다", () => {
    const payload = makePayload("s1");
    let jobs = markQueued(addJob([], payload, T0), "s1", T1);
    jobs = markFailed(jobs, "s1", "retries_exhausted", T2);
    expect(jobs[0].status).toBe("failed");
    expect(jobs[0].failedReason).toBe("retries_exhausted");

    jobs = retryFailed(jobs, "s1", T2);
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].failedReason).toBeUndefined();
    expect(jobs[0].payload).toEqual(payload);
  });

  it("retryFailed는 failed가 아닌 작업을 바꾸지 않는다", () => {
    const jobs = markQueued(addJob([], makePayload("s1"), T0), "s1", T1);
    expect(retryFailed(jobs, "s1", T2)).toEqual(jobs);
  });

  it("없는 sessionId에 대한 변경은 목록을 그대로 둔다", () => {
    const jobs = addJob([], makePayload("s1"), T0);
    expect(markQueued(jobs, "none", T1)).toEqual(jobs);
    expect(markFailed(jobs, "none", "x", T1)).toEqual(jobs);
    expect(recordAttemptFailure(jobs, "none", "x", T1)).toEqual(jobs);
    expect(removeJob(jobs, "none")).toEqual(jobs);
  });
});

describe("selectPendingJobs", () => {
  it("pending 작업만 선택한다", () => {
    let jobs = addJob([], makePayload("s1"), T0);
    jobs = addJob(jobs, makePayload("s2"), T0);
    jobs = addJob(jobs, makePayload("s3"), T0);
    jobs = markQueued(jobs, "s2", T1);
    jobs = markFailed(jobs, "s3", "permanent", T1);

    expect(selectPendingJobs(jobs).map((j) => j.sessionId)).toEqual(["s1"]);
  });
});

describe("parseOutbox", () => {
  it("값이 없으면 빈 목록을 반환한다", () => {
    expect(parseOutbox(null)).toEqual([]);
    expect(parseOutbox("")).toEqual([]);
  });

  it("손상된 JSON이면 빈 목록을 반환한다", () => {
    expect(parseOutbox("{not json")).toEqual([]);
  });

  it("배열이 아니면 빈 목록을 반환한다", () => {
    expect(parseOutbox(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("형태가 맞지 않는 항목만 걸러낸다", () => {
    const valid = addJob([], makePayload("s1"), T0)[0];
    const raw = JSON.stringify([
      valid,
      { sessionId: "bad" },
      null,
      { ...valid, sessionId: "s2", status: "unknown" },
    ]);

    expect(parseOutbox(raw)).toEqual([valid]);
  });
});

describe("readOutbox / writeOutbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocalStorage(initial?: string) {
    const store = new Map<string, string>();
    if (initial !== undefined) store.set(NOTION_OUTBOX_KEY, initial);
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });
    return store;
  }

  it("저장한 작업을 그대로 읽는다", () => {
    stubLocalStorage();
    const jobs = addJob([], makePayload("s1"), T0);

    expect(writeOutbox(jobs)).toBe(true);
    expect(readOutbox()).toEqual(jobs);
  });

  it("저장소가 비어 있거나 손상돼도 빈 목록을 반환한다", () => {
    stubLocalStorage();
    expect(readOutbox()).toEqual([]);

    stubLocalStorage("{broken");
    expect(readOutbox()).toEqual([]);
  });

  it("저장소 접근이 throw해도 읽기는 빈 목록, 쓰기는 false를 반환한다", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });

    expect(readOutbox()).toEqual([]);
    expect(writeOutbox([])).toBe(false);
  });
});

function stubBrowser(options: { online?: boolean; jobs?: string } = {}) {
  const store = new Map<string, string>();
  if (options.jobs !== undefined) store.set(NOTION_OUTBOX_KEY, options.jobs);
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { onLine: options.online ?? true });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

describe("flushNotionOutbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pending 작업을 enqueue body 그대로 보내고 202면 queued로 바꾼다", async () => {
    const payload = makePayload("s1");
    stubBrowser({ jobs: JSON.stringify(addJob([], payload, T0)) });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(202, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await flushNotionOutbox();

    expect(results).toEqual([{ sessionId: "s1", outcome: "queued" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/dailyset/api/sync/enqueue");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(payload);
    expect(readOutbox()[0].status).toBe("queued");
  });

  it("네트워크 오류면 pending을 유지하고 attempts와 lastError를 기록한다", async () => {
    stubBrowser({ jobs: JSON.stringify(addJob([], makePayload("s1"), T0)) });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    );

    const results = await flushNotionOutbox();

    expect(results).toEqual([
      { sessionId: "s1", outcome: "retry", error: "Failed to fetch" },
    ]);
    const [job] = readOutbox();
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.lastError).toBe("Failed to fetch");
  });

  it("5xx 응답은 재시도 대상으로 남긴다", async () => {
    stubBrowser({ jobs: JSON.stringify(addJob([], makePayload("s1"), T0)) });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(500, { error: "Failed to enqueue" })),
    );

    const results = await flushNotionOutbox();

    expect(results[0].outcome).toBe("retry");
    expect(readOutbox()[0].status).toBe("pending");
  });

  it("400 응답은 failed로 표시해 재시도 대상에서 뺀다", async () => {
    stubBrowser({ jobs: JSON.stringify(addJob([], makePayload("s1"), T0)) });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(400, { error: "Invalid exercise payload" }),
        ),
    );

    const results = await flushNotionOutbox();

    expect(results[0].outcome).toBe("failed");
    const [job] = readOutbox();
    expect(job.status).toBe("failed");
    expect(job.failedReason).toBe("Invalid exercise payload");
    expect(selectPendingJobs(readOutbox())).toEqual([]);
  });

  it("오프라인이면 전송하지 않고 attempts도 올리지 않는다", async () => {
    stubBrowser({
      online: false,
      jobs: JSON.stringify(addJob([], makePayload("s1"), T0)),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushNotionOutbox()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readOutbox()[0].attempts).toBe(0);
  });

  it("queued·failed 작업은 보내지 않는다", async () => {
    let jobs = addJob([], makePayload("s1"), T0);
    jobs = addJob(jobs, makePayload("s2"), T0);
    jobs = markQueued(jobs, "s1", T1);
    jobs = markFailed(jobs, "s2", "x", T1);
    stubBrowser({ jobs: JSON.stringify(jobs) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await flushNotionOutbox()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("동시에 호출해도 같은 작업을 한 번만 보낸다", async () => {
    stubBrowser({ jobs: JSON.stringify(addJob([], makePayload("s1"), T0)) });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(202, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      flushNotionOutbox(),
      flushNotionOutbox(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ sessionId: "s1", outcome: "queued" }]);
    expect(b).toEqual([]);
  });

  it("진행 중인 flush 도중 추가된 작업도 이어서 보낸다", async () => {
    stubBrowser({ jobs: JSON.stringify(addJob([], makePayload("s1"), T0)) });
    let release: (res: Response) => void = () => {};
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(jsonResponse(202, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const first = flushNotionOutbox();
    writeOutbox(addJob(readOutbox(), makePayload("s2"), T1));
    const second = flushNotionOutbox();
    release(jsonResponse(202, { ok: true }));

    expect(await first).toEqual([{ sessionId: "s1", outcome: "queued" }]);
    expect(await second).toEqual([{ sessionId: "s2", outcome: "queued" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("마지막 연결 상태", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("기록이 없으면 null, 저장한 값은 그대로 읽는다", () => {
    stubBrowser();
    expect(readLastKnownDbConnected()).toBeNull();

    writeLastKnownDbConnected(true);
    expect(readLastKnownDbConnected()).toBe(true);

    writeLastKnownDbConnected(false);
    expect(readLastKnownDbConnected()).toBe(false);
  });
});
