import { Exercises, SavedExercise, Session } from "@/app/types";

/**
 * done=true인 세트만 추출하여 로컬 저장용 payload를 생성한다.
 * workout.sessions.v1에 저장되는 형태와 동일하다.
 */
export function createLocalExercisesPayload(
  exercises: Exercises,
): (SavedExercise & { part: string })[] {
  return exercises
    .map((ex) => {
      const doneSets = ex.sets
        .map((set, i) => ({ set, setNo: i + 1 }))
        .filter(({ set }) => set.done);
      return {
        ...ex,
        sets: doneSets,
      };
    })
    .filter((ex) => ex.sets.length > 0)
    .map((ex) => {
      return {
        id: ex.id,
        name: ex.name,
        part: ex.part || "기타",
        exercisePageId: ex.exercisePageId,
        sets: ex.sets.map(({ set, setNo }) => ({
          setNo,
          weight: set.weight,
          reps: set.reps,
          memo: set.memo,
          equipment: set.equipment,
        })),
      };
    });
}

/**
 * 세션 히스토리 payload를 생성한다.
 */
export function createHistoryPayload(params: {
  sessionId: string;
  sessionName: string;
  savedAt: string;
  localExercises: (SavedExercise & { part: string })[];
  durationSeconds?: number;
}): {
  id: string;
  savedAt: string;
  sessionName: string;
  exercises: (SavedExercise & { part: string })[];
  durationSeconds?: number;
} {
  return {
    id: params.sessionId,
    savedAt: params.savedAt,
    sessionName: params.sessionName,
    exercises: params.localExercises,
    durationSeconds: params.durationSeconds,
  };
}

/**
 * 현재 exercises가 workout.sessions.v1에 저장된 내용과 다른지 판별한다.
 * done 세트가 없으면 false, history에 해당 sessionId가 없거나 payload가 다르면 true.
 */
export function computeHistoryDirty(
  sessionId: string,
  exercises: Exercises,
): boolean {
  const localPayload = createLocalExercisesPayload(exercises);
  if (localPayload.length === 0) return false;

  if (typeof window === "undefined") return true;

  try {
    const raw = localStorage.getItem("workout.sessions.v1");
    if (!raw) return true;

    const sessions = JSON.parse(raw) as Session[];
    if (!Array.isArray(sessions)) return true;

    const saved = sessions.find((s) => s.id === sessionId);
    if (!saved) return true;

    return JSON.stringify(localPayload) !== JSON.stringify(saved.exercises);
  } catch {
    return true;
  }
}

/**
 * done=true && synced=false인 세트만 추출하여 Notion 동기화용 payload를 생성한다.
 */
export function createNotionExercisesPayload(
  exercises: Exercises,
): (SavedExercise & {
  part: string;
  exercisePageId?: string;
})[] {
  return exercises
    .map((ex) => {
      const unsyncedSets = ex.sets
        .map((set, i) => ({ set, setNo: i + 1 }))
        .filter(({ set }) => set.done && !set.synced);
      return {
        ...ex,
        sets: unsyncedSets,
      };
    })
    .filter((ex) => ex.sets.length > 0)
    .map((ex) => {
      return {
        id: ex.id,
        name: ex.name,
        part: ex.part || "기타",
        exercisePageId: ex.exercisePageId,
        sets: ex.sets.map(({ set, setNo }) => ({
          setNo,
          weight: set.weight,
          reps: set.reps,
          memo: set.memo,
          equipment: set.equipment,
        })),
      };
    });
}

/**
 * done=true && synced=false인 세트를 synced=true로 변경한 새 배열을 반환한다.
 * 원본 exercises를 직접 mutate하지 않는다.
 */
export function markSyncedSets(exercises: Exercises): Exercises {
  return exercises.map((ex) => ({
    ...ex,
    sets: ex.sets.map((set) =>
      set.done && !set.synced ? { ...set, synced: true } : set,
    ),
  }));
}
