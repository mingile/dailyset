"use client";

import { useState } from "react";
import { WorkoutSessionClient } from "@/app/WorkoutSessionClient";
import type { ExerciseTimers, Exercises, SessionMetadata } from "@/app/types";
import { kgToLb } from "@/lib/weightUnit";

const DEMO_SESSION_ID = "landing-demo-session";
const DEMO_EXERCISE_ID = "landing-demo-bench-press";

function createDemoSet(
  weight: number,
  reps: number,
): Exercises[number]["sets"][number] {
  return {
    weight,
    reps,
    done: false,
    synced: false,
    equipment: "barbell",
    memo: "",
    unit: "kg",
    setType: "main",
  };
}

const INITIAL_EXERCISES: Exercises = [
  {
    id: DEMO_EXERCISE_ID,
    name: "Squats",
    part: "legs",
    targetMainSetCount: 3,
    targetWarmupSetCount: 0,
    sets: [createDemoSet(60, 10), createDemoSet(60, 10), createDemoSet(60, 8)],
  },
];

function createInitialSessionMetadata(): SessionMetadata {
  return {
    sessionId: DEMO_SESSION_ID,
    sessionName: "Daily Set 세션",
    startedAt: new Date().toISOString(),
  };
}

export function LandingSessionDemo() {
  const [exercises, setExercises] = useState<Exercises>(INITIAL_EXERCISES);
  const [sessionMetadata, setSessionMetadata] = useState<SessionMetadata>(
    createInitialSessionMetadata,
  );
  const [sessionNameInput, setSessionNameInput] = useState("Daily Set 세션");
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});

  function displayWeightUnit(
    weight: number,
    unit: "kg" | "lb",
  ): { displayWeight: number; displayUnit: "kg" | "lb" } {
    if (unit === "lb") {
      return { displayWeight: Math.round(kgToLb(weight)), displayUnit: "lb" };
    }
    return { displayWeight: Math.round(weight * 10) / 10, displayUnit: "kg" };
  }

  function deleteSet(exId: string, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex) => {
        if (ex.id !== exId) return ex;
        if (ex.sets.length === 1) return ex;

        const deletedSet = ex.sets[setIdx];
        if (!deletedSet) return ex;

        const deletedSetType = deletedSet.setType ?? "main";
        let newTargetWarmup = ex.targetWarmupSetCount ?? 0;
        let newTargetMain = ex.targetMainSetCount ?? 0;

        if (deletedSetType === "warmup") {
          newTargetWarmup = Math.max(0, newTargetWarmup - 1);
        } else {
          newTargetMain = Math.max(1, newTargetMain - 1);
        }

        return {
          ...ex,
          targetWarmupSetCount: newTargetWarmup,
          targetMainSetCount: newTargetMain,
          sets: ex.sets.filter((_, idx) => idx !== setIdx),
        };
      }),
    );
  }

  function changeReps(exIdx: number, setIdx: number, delta: number) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx
              ? { ...s, reps: Math.max(0, s.reps + delta), synced: false }
              : s,
          ),
        };
      }),
    );
  }

  function changeWeight(exIdx: number, setIdx: number, next: number) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, weight: next, synced: false } : s,
          ),
        };
      }),
    );
  }

  function changeMemo(exIdx: number, setIdx: number, value: string) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, memo: value, synced: false } : s,
          ),
        };
      }),
    );
  }

  function changeEquipment(exIdx: number, setIdx: number, equipment: string) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, equipment, synced: false } : s,
          ),
        };
      }),
    );
  }

  function changeUnit(exIdx: number, setIdx: number, unit: "kg" | "lb") {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, unit, synced: false } : s,
          ),
        };
      }),
    );
  }

  function toggleDone(exIdx: number, setIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, done: !s.done } : s,
          ),
        };
      }),
    );
  }

  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const lastSet = ex.sets[ex.sets.length - 1];
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
      }),
    );
  }

  function changeSetType(
    exIdx: number,
    setIdx: number,
    newSetType: "warmup" | "main",
  ) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const oldSetType = ex.sets[setIdx]?.setType ?? "main";
        if (oldSetType === newSetType) return ex;

        let newTargetWarmup = ex.targetWarmupSetCount ?? 0;
        let newTargetMain = ex.targetMainSetCount ?? 0;

        if (oldSetType === "main" && newSetType === "warmup") {
          newTargetMain = Math.max(1, newTargetMain - 1);
          newTargetWarmup = newTargetWarmup + 1;
        } else if (oldSetType === "warmup" && newSetType === "main") {
          newTargetWarmup = Math.max(0, newTargetWarmup - 1);
          newTargetMain = newTargetMain + 1;
        }

        return {
          ...ex,
          targetWarmupSetCount: newTargetWarmup,
          targetMainSetCount: newTargetMain,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? { ...s, setType: newSetType, synced: false } : s,
          ),
        };
      }),
    );
  }

  function handleSessionNameBlur() {
    const trimmed = sessionNameInput.trim();
    const nextName = trimmed || "Daily Set 세션";
    setSessionNameInput(nextName);
    setSessionMetadata((prev) => ({ ...prev, sessionName: nextName }));
  }

  return (
    <div className="dark mx-auto w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#27272A] text-zinc-50 shadow-sm">
      <div className="border-b border-white/10 px-2 py-2">
        <input
          type="text"
          value={sessionNameInput}
          onChange={(e) => setSessionNameInput(e.target.value)}
          onBlur={handleSessionNameBlur}
          placeholder="세션 이름을 입력하세요"
          aria-label="세션 이름"
          className="w-full rounded-md bg-transparent px-1 py-1.5 text-xl font-medium text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-[#F2EC00]/50"
        />
      </div>

      <WorkoutSessionClient
        exercises={exercises}
        displayWeightUnit={displayWeightUnit}
        addSet={addSet}
        changeWeight={changeWeight}
        changeReps={changeReps}
        toggleDone={toggleDone}
        changeMemo={changeMemo}
        deleteSet={deleteSet}
        changeEquipment={changeEquipment}
        changeUnit={changeUnit}
        changeSetType={changeSetType}
        sessionMetadata={sessionMetadata}
        exerciseTimers={exerciseTimers}
        onExerciseTimersChange={setExerciseTimers}
        addExercisesToSession={() => {}}
        onCompleteWorkout={() => {}}
        saving={false}
        hideSessionActions
      />
    </div>
  );
}
