import { send } from "@vercel/queue";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const NOTION_SYNC_TOPIC = "notion-session-sync";
const NOTION_SESSION_SYNC_TYPE = "NOTION_SESSION_SYNC";

type SyncExerciseSet = {
  setNo: number;
  weight: number;
  reps: number;
  memo: string;
  equipment: string;
};

type SyncExercise = {
  id: string;
  name: string;
  part: string;
  exercisePageId?: string;
  sets: SyncExerciseSet[];
};

type NotionSessionSyncMessage = {
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

function parseRequestBody(
  body: unknown,
):
  | { ok: true; data: Omit<NotionSessionSyncMessage, "type" | "userKey"> }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }

  const payload = body as Record<string, unknown>;
  const { sessionId, sessionName, startedAt, savedAt, exercises, retryNo } =
    payload;

  if (!isNonEmptyString(sessionId)) {
    return { ok: false, error: "Missing or invalid sessionId" };
  }
  if (!isNonEmptyString(sessionName)) {
    return { ok: false, error: "Missing or invalid sessionName" };
  }
  if (!isNonEmptyString(startedAt)) {
    return { ok: false, error: "Missing or invalid startedAt" };
  }
  if (!isNonEmptyString(savedAt)) {
    return { ok: false, error: "Missing or invalid savedAt" };
  }
  if (
    retryNo !== undefined &&
    !(Number.isInteger(retryNo) && (retryNo as number) >= 0)
  ) {
    return { ok: false, error: "Invalid retryNo" };
  }
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { ok: false, error: "Missing or invalid exercises" };
  }
  if (!exercises.every(isSyncExercise)) {
    return { ok: false, error: "Invalid exercise payload" };
  }

  return {
    ok: true,
    data: {
      sessionId,
      sessionName,
      startedAt,
      savedAt,
      ...(retryNo ? { retryNo: retryNo as number } : {}),
      exercises,
    },
  };
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const userKey = cookieStore.get("user_key")?.value;

  if (!userKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseRequestBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const message: NotionSessionSyncMessage = {
    type: NOTION_SESSION_SYNC_TYPE,
    userKey,
    ...parsed.data,
  };

  try {
    // 수동 재전송(retryNo > 0)은 같은 키로 보내면 큐가 중복으로 무시할 수 있어 번호를 붙인다.
    const retrySuffix = message.retryNo ? `:r${message.retryNo}` : "";
    const { messageId } = await send(NOTION_SYNC_TOPIC, message, {
      idempotencyKey: `${userKey}:${message.sessionId}:${message.savedAt}${retrySuffix}`,
    });

    return NextResponse.json(
      {
        ok: true,
        status: "accepted",
        message: "Sync job accepted",
        messageId,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to enqueue Notion sync job", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to enqueue sync job",
      },
      { status: 500 },
    );
  }
}
