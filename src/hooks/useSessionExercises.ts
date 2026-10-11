import { useReducer } from "react";
import type { Exercises } from "@/app/types";
import {
  initialSessionExercisesState,
  sessionExercisesReducer,
} from "@/lib/session-exercises-reducer";

/** 세션 화면이 운동 데이터를 편집할 때 쓰는 함수 모음 */
export type SessionExercisesActions = {
  deleteSet: (exId: string, setIdx: number) => void;
  changeReps: (exIdx: number, setIdx: number, delta: number) => void;
  changeWeight: (exIdx: number, setIdx: number, weight: number) => void;
  changeMemo: (exIdx: number, setIdx: number, value: string) => void;
  changeEquipment: (exIdx: number, setIdx: number, equipment: string) => void;
  changeUnit: (exIdx: number, setIdx: number, unit: "kg" | "lb") => void;
  toggleDone: (exIdx: number, setIdx: number) => void;
  addSet: (exIdx: number) => void;
  changeSetType: (
    exIdx: number,
    setIdx: number,
    setType: "warmup" | "main",
  ) => void;
  addExercisesToSession: (newExercises: Exercises) => void;
};

export function useSessionExercises(initialExercises: Exercises = []) {
  const [{ exercises, historyDirty }, dispatch] = useReducer(
    sessionExercisesReducer,
    { ...initialSessionExercisesState, exercises: initialExercises },
  );

  function deleteSet(exId: string, setIdx: number) {
    dispatch({ type: "deleteSet", exId, setIdx });
  }

  function changeReps(exIdx: number, setIdx: number, delta: number) {
    dispatch({ type: "changeReps", exIdx, setIdx, delta });
  }

  function changeWeight(exIdx: number, setIdx: number, weight: number) {
    dispatch({ type: "changeWeight", exIdx, setIdx, weight });
  }

  function changeMemo(exIdx: number, setIdx: number, value: string) {
    dispatch({ type: "changeMemo", exIdx, setIdx, value });
  }

  function changeEquipment(exIdx: number, setIdx: number, equipment: string) {
    dispatch({ type: "changeEquipment", exIdx, setIdx, equipment });
  }

  function changeUnit(exIdx: number, setIdx: number, unit: "kg" | "lb") {
    dispatch({ type: "changeUnit", exIdx, setIdx, unit });
  }

  function toggleDone(exIdx: number, setIdx: number) {
    dispatch({ type: "toggleDone", exIdx, setIdx });
  }

  function addSet(exIdx: number) {
    dispatch({ type: "addSet", exIdx });
  }

  function changeSetType(
    exIdx: number,
    setIdx: number,
    setType: "warmup" | "main",
  ) {
    dispatch({ type: "changeSetType", exIdx, setIdx, setType });
  }

  function addExercisesToSession(newExercises: Exercises) {
    dispatch({ type: "addExercises", exercises: newExercises });
  }

  /** draft 복원 / 라이브러리 선택 확정: 운동과 dirty 값을 통째로 지정한다 */
  function hydrate(nextExercises: Exercises, nextHistoryDirty: boolean) {
    dispatch({
      type: "hydrate",
      exercises: nextExercises,
      historyDirty: nextHistoryDirty,
    });
  }

  /** 저장 완료 / 새 세션 시작 */
  function clearDirty() {
    dispatch({ type: "clearDirty" });
  }

  /** 운동 밖 변경(세션 이름 등)을 dirty로 표시한다 */
  function markDirty() {
    dispatch({ type: "markDirty" });
  }

  /** Notion 이전 기록 병합처럼 사용자 편집이 아닌 운동 갱신. dirty는 그대로 둔다 */
  function mergeExternal(update: (prev: Exercises) => Exercises) {
    dispatch({ type: "mergeExternal", update });
  }

  const actions: SessionExercisesActions = {
    deleteSet,
    changeReps,
    changeWeight,
    changeMemo,
    changeEquipment,
    changeUnit,
    toggleDone,
    addSet,
    changeSetType,
    addExercisesToSession,
  };

  return {
    exercises,
    historyDirty,
    actions,
    hydrate,
    clearDirty,
    markDirty,
    mergeExternal,
  };
}
