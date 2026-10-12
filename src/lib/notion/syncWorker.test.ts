import { beforeEach, describe, expect, it, vi } from "vitest";

// handleCallback을 그대로 노출해 handler와 retry 옵션을 직접 호출한다.
vi.mock("@vercel/queue", () => ({
  handleCallback: (
    handler: unknown,
    options: { retry: unknown; visibilityTimeoutSeconds: number },
  ) => ({ handler, options }),
}));

const ensureNotionSession = vi.fn();
const writeNotionSets = vi.fn();
const recordSyncJob = vi.fn();

vi.mock("@/lib/notion/errors", () => ({
  getNotionSyncErrorStatusCode: (error: unknown) => {
    const code = (error as { statusCode?: unknown } | null)?.statusCode;
    return typeof code === "number" ? code : undefined;
  },
}));
vi.mock("@/lib/notion/sessionEnsure", () => ({
  ensureNotionSession: (...args: unknown[]) => ensureNotionSession(...args),
}));
vi.mock("@/lib/notion/writeSets", () => ({
  writeNotionSets: (...args: unknown[]) => writeNotionSets(...args),
}));
vi.mock("@/lib/notion/syncJobs", () => ({
  recordSyncJob: (...args: unknown[]) => recordSyncJob(...args),
  toReason: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock("@/lib/notion/syncMessage", () => ({
  parseNotionSessionSyncMessage: (message: unknown) => message,
}));

type Handler = (
  message: unknown,
  metadata: Record<string, unknown>,
) => Promise<void>;
type Retry = (
  error: unknown,
  metadata: { messageId: string; deliveryCount: number },
) => { acknowledge: true } | { afterSeconds: number } | undefined;

async function loadWorker() {
  const route = (await import(
    "../../app/api/queues/notion-session-sync/route"
  )) as unknown as { POST: { handler: Handler; options: { retry: Retry } } };
  return route.POST;
}

const message = {
  userKey: "u1",
  sessionId: "s1",
  sessionName: "가슴",
  startedAt: "2026-10-12T09:00:00.000Z",
  savedAt: "2026-10-12T10:00:00.000Z",
  exercises: [],
};

function metadata(deliveryCount: number) {
  return { messageId: "m1", deliveryCount };
}

function syncError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureNotionSession.mockResolvedValue({ pageId: "page-1" });
  writeNotionSets.mockResolvedValue({ created_count: 1 });
  recordSyncJob.mockResolvedValue(undefined);
});

describe("notion-session-sync 워커의 sync_jobs 기록", () => {
  it("성공하면 done을 기록한다", async () => {
    const { handler } = await loadWorker();
    await handler(message, metadata(1));

    expect(recordSyncJob).toHaveBeenCalledTimes(1);
    expect(recordSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        userKey: "u1",
        sessionId: "s1",
        savedAt: message.savedAt,
        status: "done",
      }),
    );
  });

  it("retryNo가 있으면 같이 기록한다", async () => {
    const { handler } = await loadWorker();
    await handler({ ...message, retryNo: 2 }, metadata(1));
    expect(recordSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done", retryNo: 2 }),
    );
  });

  it("영구 실패(401)는 재시도 없이 ack하고 failed를 기록한다", async () => {
    writeNotionSets.mockRejectedValue(syncError("Unauthorized", 401));
    const { handler } = await loadWorker();

    await expect(handler(message, metadata(1))).resolves.toBeUndefined();
    expect(recordSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", reason: "Unauthorized" }),
    );
  });

  it("재시도 가능한 실패는 마지막 시도 전까지 기록하지 않고 throw한다", async () => {
    writeNotionSets.mockRejectedValue(syncError("Bad gateway", 502));
    const { handler } = await loadWorker();

    for (const count of [1, 2, 3]) {
      await expect(handler(message, metadata(count))).rejects.toThrow(
        "Bad gateway",
      );
    }
    expect(recordSyncJob).not.toHaveBeenCalled();
  });

  it("마지막 시도(deliveryCount 4)의 실패는 failed를 기록하고 throw한다", async () => {
    writeNotionSets.mockRejectedValue(syncError("Bad gateway", 502));
    const { handler } = await loadWorker();

    await expect(handler(message, metadata(4))).rejects.toThrow("Bad gateway");
    expect(recordSyncJob).toHaveBeenCalledTimes(1);
    expect(recordSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", reason: "Bad gateway" }),
    );
  });

  it("마지막 시도에서 throw하면 retry 콜백이 ack한다", async () => {
    const { options } = await loadWorker();
    const error = new Error("x");
    expect(options.retry(error, metadata(3))).toEqual({ afterSeconds: 40 });
    expect(options.retry(error, metadata(4))).toEqual({ acknowledge: true });
  });

  it("상태 기록이 실패해도 성공 처리(ack)를 바꾸지 않는다", async () => {
    recordSyncJob.mockRejectedValue(new Error("mongo down"));
    const { handler } = await loadWorker();
    await expect(handler(message, metadata(1))).resolves.toBeUndefined();
  });

  it("마지막 시도에서 상태 기록이 실패해도 원래 오류를 throw한다", async () => {
    writeNotionSets.mockRejectedValue(syncError("Bad gateway", 502));
    recordSyncJob.mockRejectedValue(new Error("mongo down"));
    const { handler } = await loadWorker();
    await expect(handler(message, metadata(4))).rejects.toThrow("Bad gateway");
  });

  it("failed 뒤 같은 작업이 다시 성공하면 같은 키로 done을 기록한다", async () => {
    writeNotionSets.mockRejectedValueOnce(syncError("Unauthorized", 401));
    const { handler } = await loadWorker();
    await handler(message, metadata(1));
    await handler({ ...message, retryNo: 1 }, metadata(1));

    const [first, second] = recordSyncJob.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ status: "failed", sessionId: "s1" });
    expect(second).toMatchObject({
      status: "done",
      sessionId: "s1",
      savedAt: message.savedAt,
      retryNo: 1,
    });
  });
});
