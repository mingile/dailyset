import { withBasePath } from "./base-path";
import type { createNotionExercisesPayload } from "./workoutSessionPayload";

export const NOTION_OUTBOX_KEY = "workout.notionOutbox.v1";

export type NotionOutboxStatus = "pending" | "queued" | "failed";

/** POST /api/sync/enqueue 요청 body와 동일한 완료 시점 스냅샷 */
export type NotionOutboxPayload = {
  sessionId: string;
  sessionName: string;
  startedAt: string;
  savedAt: string;
  exercises: ReturnType<typeof createNotionExercisesPayload>;
};

export type NotionOutboxJob = {
  sessionId: string;
  savedAt: string;
  payload: NotionOutboxPayload;
  status: NotionOutboxStatus;
  attempts: number;
  /** 사용자가 failed 작업을 다시 보낸 횟수. 0이거나 없으면 최초 전송. */
  retryCount?: number;
  lastError?: string;
  failedReason?: string;
  createdAt: string;
  updatedAt: string;
};

const STATUSES: readonly string[] = ["pending", "queued", "failed"];

function isJob(value: unknown): value is NotionOutboxJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.sessionId === "string" &&
    typeof job.savedAt === "string" &&
    typeof job.payload === "object" &&
    job.payload !== null &&
    typeof job.status === "string" &&
    STATUSES.includes(job.status) &&
    typeof job.attempts === "number" &&
    typeof job.createdAt === "string" &&
    typeof job.updatedAt === "string"
  );
}

/** 손상된 JSON이나 형태가 다른 항목은 버리고 읽을 수 있는 작업만 반환한다. */
export function parseOutbox(raw: string | null): NotionOutboxJob[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isJob);
  } catch {
    return [];
  }
}

export function readOutbox(): NotionOutboxJob[] {
  if (typeof window === "undefined") return [];
  try {
    return parseOutbox(localStorage.getItem(NOTION_OUTBOX_KEY));
  } catch {
    return [];
  }
}

export function writeOutbox(jobs: NotionOutboxJob[]): boolean {
  try {
    localStorage.setItem(NOTION_OUTBOX_KEY, JSON.stringify(jobs));
    return true;
  } catch {
    return false;
  }
}

function updateJob(
  jobs: NotionOutboxJob[],
  sessionId: string,
  update: (job: NotionOutboxJob) => NotionOutboxJob,
): NotionOutboxJob[] {
  return jobs.map((job) => (job.sessionId === sessionId ? update(job) : job));
}

/** 같은 sessionId의 작업이 있으면 새 pending 작업으로 덮어쓴다. */
export function addJob(
  jobs: NotionOutboxJob[],
  payload: NotionOutboxPayload,
  now: string,
): NotionOutboxJob[] {
  const job: NotionOutboxJob = {
    sessionId: payload.sessionId,
    savedAt: payload.savedAt,
    payload,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  return [...jobs.filter((j) => j.sessionId !== payload.sessionId), job];
}

/** enqueue가 202로 접수된 작업. 이전 오류 기록은 지운다. */
export function markQueued(
  jobs: NotionOutboxJob[],
  sessionId: string,
  now: string,
): NotionOutboxJob[] {
  return updateJob(jobs, sessionId, (job) => ({
    ...job,
    status: "queued",
    lastError: undefined,
    failedReason: undefined,
    updatedAt: now,
  }));
}

/** enqueue 전송 실패. pending을 유지하고 시도 횟수와 오류를 기록한다. */
export function recordAttemptFailure(
  jobs: NotionOutboxJob[],
  sessionId: string,
  error: string,
  now: string,
): NotionOutboxJob[] {
  return updateJob(jobs, sessionId, (job) => ({
    ...job,
    status: "pending",
    attempts: job.attempts + 1,
    lastError: error,
    updatedAt: now,
  }));
}

/** 서버에서 재시도 소진 또는 영구 실패로 확인된 작업. */
export function markFailed(
  jobs: NotionOutboxJob[],
  sessionId: string,
  reason: string,
  now: string,
): NotionOutboxJob[] {
  return updateJob(jobs, sessionId, (job) => ({
    ...job,
    status: "failed",
    failedReason: reason,
    updatedAt: now,
  }));
}

/** 사용자가 다시 보내기를 누른 failed 작업만 pending으로 되돌린다. */
export function retryFailed(
  jobs: NotionOutboxJob[],
  sessionId: string,
  now: string,
): NotionOutboxJob[] {
  return updateJob(jobs, sessionId, (job) =>
    job.status === "failed"
      ? {
          ...job,
          status: "pending",
          failedReason: undefined,
          retryCount: (job.retryCount ?? 0) + 1,
          updatedAt: now,
        }
      : job,
  );
}

export function removeJob(
  jobs: NotionOutboxJob[],
  sessionId: string,
): NotionOutboxJob[] {
  return jobs.filter((job) => job.sessionId !== sessionId);
}

export function selectFailedJobs(jobs: NotionOutboxJob[]): NotionOutboxJob[] {
  return jobs.filter((job) => job.status === "failed");
}

/** GET /api/sync/status 응답의 작업 하나 */
export type NotionServerJob = {
  sessionId: string;
  savedAt: string;
  retryNo?: number;
  status: "done" | "failed";
  reason?: string;
};

/**
 * 서버 처리 결과로 queued 작업을 정리한다.
 * - done → outbox에서 제거
 * - failed → markFailed. 단, 서버 기록의 retryNo가 작업의 retryCount보다 작으면
 *   다시 보내기 이전 시도의 실패 기록이므로 무시한다.
 */
export function reconcileJobs(
  jobs: NotionOutboxJob[],
  serverJobs: NotionServerJob[],
  now: string,
): NotionOutboxJob[] {
  let next = jobs;
  for (const job of jobs) {
    if (job.status !== "queued") continue;
    const server = serverJobs.find(
      (s) => s.sessionId === job.sessionId && s.savedAt === job.savedAt,
    );
    if (!server) continue;

    if (server.status === "done") {
      next = removeJob(next, job.sessionId);
    } else if ((server.retryNo ?? 0) >= (job.retryCount ?? 0)) {
      next = markFailed(
        next,
        job.sessionId,
        server.reason ?? "Notion 동기화 실패",
        now,
      );
    }
  }
  return next;
}

export type NotionReconcileResult = { done: number; failed: number };

const MAX_STATUS_SESSION_IDS = 50;

/** queued 작업의 서버 처리 결과를 조회해 outbox에 반영한다. 조회에 실패하면 아무것도 바꾸지 않는다. */
export async function reconcileNotionOutbox(): Promise<NotionReconcileResult> {
  const empty = { done: 0, failed: 0 };
  const queued = readOutbox()
    .filter((job) => job.status === "queued")
    .slice(0, MAX_STATUS_SESSION_IDS);
  if (queued.length === 0) return empty;

  try {
    const ids = queued.map((job) => encodeURIComponent(job.sessionId));
    const res = await fetch(
      withBasePath(`/api/sync/status?sessionIds=${ids.join(",")}`),
    );
    if (!res.ok) return empty;

    const data = (await res.json()) as { jobs?: NotionServerJob[] };
    if (!Array.isArray(data.jobs)) return empty;

    // await 이후의 최신 outbox에 적용한다.
    const before = readOutbox();
    const after = reconcileJobs(before, data.jobs, new Date().toISOString());
    if (after !== before) writeOutbox(after);

    return {
      done: before.length - after.length,
      failed: selectFailedJobs(after).length - selectFailedJobs(before).length,
    };
  } catch {
    return empty;
  }
}

/** 자동 재전송 대상. queued 작업의 서버 결과 확인은 reconcileNotionOutbox가 맡는다. */
export function selectPendingJobs(jobs: NotionOutboxJob[]): NotionOutboxJob[] {
  return jobs.filter((job) => job.status === "pending");
}

export const NOTION_DB_CONNECTED_KEY = "workout.notionDbConnected.v1";

/** 마지막으로 확인된 노션 DB 연결 상태. 기록이 없으면 null. */
export function readLastKnownDbConnected(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(NOTION_DB_CONNECTED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

export function writeLastKnownDbConnected(connected: boolean): void {
  try {
    localStorage.setItem(NOTION_DB_CONNECTED_KEY, String(connected));
  } catch {
    // 저장소를 쓸 수 없으면 마지막 상태를 남기지 않는다.
  }
}

export type NotionFlushOutcome = "queued" | "retry" | "failed";

export type NotionFlushResult = {
  sessionId: string;
  outcome: NotionFlushOutcome;
  error?: string;
};

// 같은 탭에서 flush가 겹쳐 같은 작업을 두 번 보내지 않도록 한다.
let inFlightFlush: Promise<NotionFlushResult[]> | null = null;

async function sendJob(job: NotionOutboxJob): Promise<NotionFlushResult> {
  const now = () => new Date().toISOString();
  const apply = (update: (jobs: NotionOutboxJob[]) => NotionOutboxJob[]) =>
    writeOutbox(update(readOutbox()));

  try {
    const res = await fetch(withBasePath("/api/sync/enqueue"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        job.retryCount
          ? { ...job.payload, retryNo: job.retryCount }
          : job.payload,
      ),
    });

    if (res.ok) {
      apply((jobs) => markQueued(jobs, job.sessionId, now()));
      return { sessionId: job.sessionId, outcome: "queued" };
    }

    const error = await res
      .json()
      .then((data: { error?: string }) => data.error)
      .catch(() => undefined);
    const message = error ?? `HTTP ${res.status}`;

    // 400은 같은 payload로 다시 보내도 같은 결과이므로 재시도 대상에서 뺀다.
    if (res.status === 400) {
      apply((jobs) => markFailed(jobs, job.sessionId, message, now()));
      return { sessionId: job.sessionId, outcome: "failed", error: message };
    }

    apply((jobs) => recordAttemptFailure(jobs, job.sessionId, message, now()));
    return { sessionId: job.sessionId, outcome: "retry", error: message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    apply((jobs) => recordAttemptFailure(jobs, job.sessionId, message, now()));
    return { sessionId: job.sessionId, outcome: "retry", error: message };
  }
}

/**
 * pending 작업을 순서대로 enqueue한다. 오프라인이면 전송하지 않고 빈 결과를 반환한다.
 * 각 작업의 결과는 outbox에 바로 반영된다. 같은 탭에서 겹쳐 호출하면 앞선 flush가 끝난 뒤 이어서 실행한다.
 */
export function flushNotionOutbox(): Promise<NotionFlushResult[]> {
  // 진행 중인 flush는 시작 시점의 pending만 보내므로, 끝난 뒤 다시 실행해 그 사이 추가된 작업도 보낸다.
  if (inFlightFlush) return inFlightFlush.then(() => flushNotionOutbox());

  const run = async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return [];
    }
    const results: NotionFlushResult[] = [];
    for (const job of selectPendingJobs(readOutbox())) {
      results.push(await sendJob(job));
    }
    return results;
  };

  inFlightFlush = run().finally(() => {
    inFlightFlush = null;
  });
  return inFlightFlush;
}
