"use client";

import { useTimerTick } from "@/hooks/useTimerTick";
import { elapsedSecondsFromStartedAt } from "@/lib/timer";

function formatClock(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function SessionClock({ startedAt }: { startedAt: string | null }) {
  useTimerTick(startedAt !== null);

  const seconds = startedAt ? elapsedSecondsFromStartedAt(startedAt) : 0;

  return <>{formatClock(seconds)}</>;
}
