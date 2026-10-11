"use client";

import { useTimerTick } from "@/hooks/useTimerTick";
import { getExerciseElapsedSeconds } from "@/lib/timer";
import type { ExerciseTimerState } from "./types";

function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function ExerciseElapsedTime({
  timer,
}: {
  timer: ExerciseTimerState | undefined;
}) {
  useTimerTick(timer?.status === "running");

  if (!timer) return null;

  const elapsedSeconds = getExerciseElapsedSeconds(timer);
  if (elapsedSeconds <= 0) return null;

  return (
    <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
      {formatElapsedTime(elapsedSeconds)}
    </span>
  );
}
