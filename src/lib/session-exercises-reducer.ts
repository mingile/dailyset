import type { Exercise, Exercises, SetItem } from "@/app/types";

export type SessionExercisesState = {
  exercises: Exercises;
  historyDirty: boolean;
};

export const initialSessionExercisesState: SessionExercisesState = {
  exercises: [],
  historyDirty: false,
};

/**
 * 사용자가 세션 운동을 편집하는 action. 모두 historyDirty를 true로 만든다.
 * 변경이 없는 no-op(세트 1개 삭제, 같은 타입으로 변경 등)도 기존 핸들러와 같이 dirty로 표시한다.
 */
export type SessionEditAction =
  | { type: "deleteSet"; exId: string; setIdx: number }
  | { type: "changeReps"; exIdx: number; setIdx: number; delta: number }
  | { type: "changeWeight"; exIdx: number; setIdx: number; weight: number }
  | { type: "changeMemo"; exIdx: number; setIdx: number; value: string }
  | {
      type: "changeEquipment";
      exIdx: number;
      setIdx: number;
      equipment: string;
    }
  | { type: "changeUnit"; exIdx: number; setIdx: number; unit: "kg" | "lb" }
  | { type: "toggleDone"; exIdx: number; setIdx: number }
  | { type: "addSet"; exIdx: number }
  | {
      type: "changeSetType";
      exIdx: number;
      setIdx: number;
      setType: "warmup" | "main";
    }
  | { type: "addExercises"; exercises: Exercises };

/** 사용자 편집이 아닌 action. historyDirty를 올리지 않고, 값을 바꾸면 action이 명시한다. */
export type SessionSyncAction =
  /** draft 복원 / 라이브러리 선택 확정: 운동과 dirty 값을 통째로 지정 */
  | { type: "hydrate"; exercises: Exercises; historyDirty: boolean }
  /** 저장 완료 / 새 세션 시작: 운동은 두고 dirty만 false */
  | { type: "clearDirty" }
  /** 운동 밖 변경(세션 이름 등)을 dirty로 표시 */
  | { type: "markDirty" }
  /** Notion 이전 기록 병합처럼 사용자 편집이 아닌 운동 갱신: dirty 유지 */
  | { type: "mergeExternal"; update: (prev: Exercises) => Exercises };

export type SessionExercisesAction = SessionEditAction | SessionSyncAction;

function updateSet(
  exercises: Exercises,
  exIdx: number,
  setIdx: number,
  update: (set: SetItem) => SetItem,
): Exercises {
  return exercises.map((ex, i) => {
    if (i !== exIdx) return ex;
    return {
      ...ex,
      sets: ex.sets.map((set, j) => (j === setIdx ? update(set) : set)),
    };
  });
}

function deleteSet(exercises: Exercises, exId: string, setIdx: number) {
  return exercises.map((ex) => {
    if (ex.id !== exId) return ex;
    if (ex.sets.length === 1) return ex;

    if (!ex.sets[setIdx]) return ex;

    return {
      ...ex,
      sets: ex.sets.filter((_, idx) => idx !== setIdx),
    };
  });
}

function addSet(exercises: Exercises, exIdx: number) {
  return exercises.map((ex, i) => {
    if (i !== exIdx) return ex;

    const lastSet = ex.sets[ex.sets.length - 1];
    if (!lastSet) return ex;

    return {
      ...ex,
      sets: [
        ...ex.sets,
        {
          weight: lastSet.weight,
          reps: lastSet.reps,
          done: false,
          synced: false,
          equipment: lastSet.equipment,
          memo: "",
          unit: lastSet.unit,
          setType: lastSet.setType || "main",
        },
      ],
    };
  });
}

function changeSetType(
  exercises: Exercises,
  exIdx: number,
  setIdx: number,
  newSetType: "warmup" | "main",
) {
  return exercises.map((ex, i): Exercise => {
    if (i !== exIdx) return ex;

    const oldSetType = ex.sets[setIdx]?.setType ?? "main";

    if (oldSetType === newSetType) return ex;

    return {
      ...ex,
      sets: ex.sets.map((set, j) =>
        j === setIdx ? { ...set, setType: newSetType, synced: false } : set,
      ),
    };
  });
}

function addExercises(prev: Exercises, newExercises: Exercises) {
  const existingPageIds = new Set(
    prev.map((ex) => ex.exercisePageId).filter(Boolean),
  );

  const uniqueNewExercises = newExercises.filter(
    (ex) => !existingPageIds.has(ex.exercisePageId),
  );

  return [...prev, ...uniqueNewExercises];
}

function applyEdit(exercises: Exercises, action: SessionEditAction): Exercises {
  switch (action.type) {
    case "deleteSet":
      return deleteSet(exercises, action.exId, action.setIdx);
    case "changeReps":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        reps: Math.max(0, set.reps + action.delta),
        synced: false,
      }));
    case "changeWeight":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        weight: action.weight,
        synced: false,
      }));
    case "changeMemo":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        memo: action.value,
        synced: false,
      }));
    case "changeEquipment":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        equipment: action.equipment,
        synced: false,
      }));
    case "changeUnit":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        unit: action.unit,
        synced: false,
      }));
    case "toggleDone":
      return updateSet(exercises, action.exIdx, action.setIdx, (set) => ({
        ...set,
        done: !set.done,
      }));
    case "addSet":
      return addSet(exercises, action.exIdx);
    case "changeSetType":
      return changeSetType(
        exercises,
        action.exIdx,
        action.setIdx,
        action.setType,
      );
    case "addExercises":
      return addExercises(exercises, action.exercises);
  }
}

export function sessionExercisesReducer(
  state: SessionExercisesState,
  action: SessionExercisesAction,
): SessionExercisesState {
  switch (action.type) {
    case "hydrate":
      return {
        exercises: action.exercises,
        historyDirty: action.historyDirty,
      };
    case "clearDirty":
      return { ...state, historyDirty: false };
    case "markDirty":
      return { ...state, historyDirty: true };
    case "mergeExternal":
      return { ...state, exercises: action.update(state.exercises) };
    default:
      return {
        exercises: applyEdit(state.exercises, action),
        historyDirty: true,
      };
  }
}
