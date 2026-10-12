export const NOTION_SYNC_TOPIC = "notion-session-sync";
export const NOTION_SESSION_SYNC_TYPE = "NOTION_SESSION_SYNC";

export type SyncExerciseSet = {
  setNo: number;
  weight: number;
  reps: number;
  memo: string;
  equipment: string;
};

export type SyncExercise = {
  id: string;
  name: string;
  part: string;
  exercisePageId?: string;
  sets: SyncExerciseSet[];
};

export type NotionSessionSyncMessage = {
  type: typeof NOTION_SESSION_SYNC_TYPE;
  userKey: string;
  sessionId: string;
  sessionName: string;
  startedAt: string;
  savedAt: string;
  retryNo?: number;
  exercises: SyncExercise[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isSyncExerciseSet(value: unknown): value is SyncExerciseSet {
  if (typeof value !== "object" || value === null) return false;
  const set = value as Record<string, unknown>;
  return (
    typeof set.setNo === "number" &&
    Number.isFinite(set.setNo) &&
    typeof set.weight === "number" &&
    Number.isFinite(set.weight) &&
    typeof set.reps === "number" &&
    Number.isFinite(set.reps) &&
    typeof set.memo === "string" &&
    typeof set.equipment === "string"
  );
}

function isSyncExercise(value: unknown): value is SyncExercise {
  if (typeof value !== "object" || value === null) return false;
  const exercise = value as Record<string, unknown>;
  return (
    isNonEmptyString(exercise.id) &&
    isNonEmptyString(exercise.name) &&
    isNonEmptyString(exercise.part) &&
    (exercise.exercisePageId === undefined ||
      isNonEmptyString(exercise.exercisePageId)) &&
    Array.isArray(exercise.sets) &&
    exercise.sets.length > 0 &&
    exercise.sets.every(isSyncExerciseSet)
  );
}

export function parseNotionSessionSyncMessage(
  message: unknown,
): NotionSessionSyncMessage | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }

  const payload = message as Record<string, unknown>;

  if (payload.type !== NOTION_SESSION_SYNC_TYPE) {
    return null;
  }
  if (!isNonEmptyString(payload.userKey)) {
    return null;
  }
  if (!isNonEmptyString(payload.sessionId)) {
    return null;
  }
  if (!isNonEmptyString(payload.sessionName)) {
    return null;
  }
  if (!isNonEmptyString(payload.startedAt)) {
    return null;
  }
  if (!isNonEmptyString(payload.savedAt)) {
    return null;
  }
  if (!Array.isArray(payload.exercises) || payload.exercises.length === 0) {
    return null;
  }
  if (!payload.exercises.every(isSyncExercise)) {
    return null;
  }

  return {
    type: NOTION_SESSION_SYNC_TYPE,
    userKey: (payload.userKey as string).trim(),
    sessionId: (payload.sessionId as string).trim(),
    sessionName: (payload.sessionName as string).trim(),
    startedAt: (payload.startedAt as string).trim(),
    savedAt: (payload.savedAt as string).trim(),
    ...(typeof payload.retryNo === "number" &&
    Number.isInteger(payload.retryNo) &&
    payload.retryNo > 0
      ? { retryNo: payload.retryNo }
      : {}),
    exercises: payload.exercises,
  };
}
