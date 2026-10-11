"use client";

import { useState } from "react";
import { WorkoutSessionClient } from "@/app/WorkoutSessionClient";
import { useSessionExercises } from "@/hooks/useSessionExercises";
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
  const { exercises, actions } = useSessionExercises(INITIAL_EXERCISES);
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
        actions={actions}
        sessionMetadata={sessionMetadata}
        exerciseTimers={exerciseTimers}
        onExerciseTimersChange={setExerciseTimers}
        onCompleteWorkout={() => {}}
        saving={false}
        hideSessionActions
      />
    </div>
  );
}
