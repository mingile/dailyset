"use client";

import { useEffect, useState } from "react";
import { SessionClock } from "@/app/SessionClock";
import type { Exercises, ExerciseTimers, SessionMetadata } from "@/app/types";
import { WorkoutSessionClient } from "@/app/WorkoutSessionClient";
import { useSessionExercises } from "@/hooks/useSessionExercises";
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

function formatDemoDateLabel(startedAt: string): string {
  const date = new Date(startedAt);
  const dayOfWeek = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][
    date.getDay()
  ];

  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()} ${dayOfWeek}`;
}

export function LandingSessionDemo() {
  const { exercises, actions } = useSessionExercises(INITIAL_EXERCISES);
  const [sessionMetadata, setSessionMetadata] = useState<SessionMetadata>(
    createInitialSessionMetadata,
  );
  const [sessionNameInput, setSessionNameInput] = useState("Daily Set 세션");
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    <div className="w-full max-w-md">
      <div className="space-y-3 pt-1 pb-2">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-7">
            <div className="px-1 text-sm text-muted-foreground">
              {mounted
                ? formatDemoDateLabel(sessionMetadata.startedAt)
                : "\u00A0"}
            </div>
            <input
              type="text"
              value={sessionNameInput}
              onChange={(e) => setSessionNameInput(e.target.value)}
              onBlur={handleSessionNameBlur}
              placeholder="세션 이름을 입력하세요"
              aria-label="세션 이름"
              className="w-full truncate bg-transparent px-1 py-1 text-2xl font-bold tracking-tight rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="min-w-0 flex-3 whitespace-nowrap pb-2 text-right text-2xl font-bold tabular-nums leading-none">
            {mounted ? (
              <SessionClock startedAt={sessionMetadata.startedAt} />
            ) : (
              "00:00"
            )}
          </div>
        </div>

        <div className="border-b border-foreground" />
      </div>

      {/* WorkoutSessionClient의 main px-4를 상쇄해 헤더 Divider와 같은 열에 맞춘다 */}
      <div className="-mx-4">
        <WorkoutSessionClient
          exercises={exercises}
          displayWeightUnit={displayWeightUnit}
          actions={actions}
          sessionMetadata={sessionMetadata}
          exerciseTimers={exerciseTimers}
          onExerciseTimersChange={setExerciseTimers}
          onCompleteWorkout={() => {}}
          saving={false}
          notionConnection="disconnected"
          hideSessionActions
        />
      </div>
    </div>
  );
}
