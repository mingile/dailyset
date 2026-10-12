import { getMongoDb } from "../mongodb";

export type SyncJobStatus = "done" | "failed";

export type SyncJobRecord = {
  userKey: string;
  sessionId: string;
  savedAt: string;
  retryNo?: number;
  status: SyncJobStatus;
  reason?: string;
  updatedAt: Date;
};

export type SyncJobStatusView = {
  sessionId: string;
  savedAt: string;
  retryNo: number;
  status: SyncJobStatus;
  reason?: string;
  updatedAt: string;
};

const COLLECTION = "sync_jobs";
const MAX_SESSION_IDS = 50;
const MAX_REASON_LENGTH = 300;

export function parseSessionIdsParam(value: string | null): string[] {
  if (!value) {
    return [];
  }

  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  return [...new Set(ids)].slice(0, MAX_SESSION_IDS);
}

export function toReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_REASON_LENGTH);
}

// 같은 작업(userKey, sessionId, savedAt)의 재처리는 덮어쓴다.
// 예: 재시도 소진으로 failed가 된 뒤 수동 재전송이 성공하면 done으로 바뀐다.
export async function recordSyncJob(input: {
  userKey: string;
  sessionId: string;
  savedAt: string;
  retryNo?: number;
  status: SyncJobStatus;
  reason?: string;
}): Promise<void> {
  const db = await getMongoDb();
  const { userKey, sessionId, savedAt, retryNo = 0, status, reason } = input;

  const update =
    reason === undefined
      ? {
          $set: { status, retryNo, updatedAt: new Date() },
          $unset: { reason: "" as const },
        }
      : { $set: { status, retryNo, reason, updatedAt: new Date() } };

  await db
    .collection<SyncJobRecord>(COLLECTION)
    .updateOne({ userKey, sessionId, savedAt }, update, { upsert: true });
}

export async function findSyncJobs(
  userKey: string,
  sessionIds: string[],
): Promise<SyncJobStatusView[]> {
  if (sessionIds.length === 0) {
    return [];
  }

  const db = await getMongoDb();
  const records = await db
    .collection<SyncJobRecord>(COLLECTION)
    .find({ userKey, sessionId: { $in: sessionIds } })
    .toArray();

  return records.map((record) => ({
    sessionId: record.sessionId,
    savedAt: record.savedAt,
    retryNo: record.retryNo ?? 0,
    status: record.status,
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    updatedAt: record.updatedAt.toISOString(),
  }));
}
