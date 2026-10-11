import type { ExerciseTimerState, ExerciseTimers } from "@/app/types";

export type TimerStatus = "idle" | "running" | "paused" | "completed";

export type TimestampTimerState = {
  status: TimerStatus;
  accumulatedElapsedMs: number;
  segmentStartedAtMs: number | null;
  totalDurationMs?: number;
};

export function computeElapsedMs(
  state: TimestampTimerState,
  nowMs: number = Date.now(),
): number {
  if (state.status === "idle") return 0;

  const accumulated = state.accumulatedElapsedMs;
  if (state.status === "running" && state.segmentStartedAtMs != null) {
    return accumulated + (nowMs - state.segmentStartedAtMs);
  }

  return accumulated;
}

export function computeRemainingMs(
  state: TimestampTimerState,
  nowMs: number = Date.now(),
): number | null {
  if (state.totalDurationMs == null) return null;

  const elapsed = computeElapsedMs(state, nowMs);
  return Math.max(0, state.totalDurationMs - elapsed);
}

export function reconcileTimerState(
  state: TimestampTimerState,
  nowMs: number = Date.now(),
): TimestampTimerState {
  if (state.status !== "running" || state.totalDurationMs == null) {
    return state;
  }

  const elapsed = computeElapsedMs(state, nowMs);
  if (elapsed < state.totalDurationMs) {
    return state;
  }

  return {
    ...state,
    status: "completed",
    accumulatedElapsedMs: state.totalDurationMs,
    segmentStartedAtMs: null,
  };
}

export function pauseTimer(
  state: TimestampTimerState,
  nowMs: number = Date.now(),
): TimestampTimerState {
  if (state.status !== "running") {
    return state;
  }

  return {
    ...state,
    status: "paused",
    accumulatedElapsedMs: computeElapsedMs(state, nowMs),
    segmentStartedAtMs: null,
  };
}

export function resumeTimer(
  state: TimestampTimerState,
  nowMs: number = Date.now(),
): TimestampTimerState {
  if (state.status === "completed") {
    return state;
  }

  return {
    ...state,
    status: "running",
    segmentStartedAtMs: nowMs,
  };
}

export function startTimer(
  totalDurationMs?: number,
  nowMs: number = Date.now(),
): TimestampTimerState {
  return {
    status: "running",
    accumulatedElapsedMs: 0,
    segmentStartedAtMs: nowMs,
    totalDurationMs,
  };
}

export function elapsedSecondsFromStartedAt(
  startedAt: string,
  nowMs: number = Date.now(),
): number {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return 0;

  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function exerciseTimerToTimestampState(
  state: ExerciseTimerState,
): TimestampTimerState {
  return {
    status: state.status,
    accumulatedElapsedMs: state.accumulatedElapsedSeconds * 1000,
    segmentStartedAtMs: state.segmentStartedAt
      ? new Date(state.segmentStartedAt).getTime()
      : null,
  };
}

export function pauseExerciseTimer(
  state: ExerciseTimerState,
  nowMs: number = Date.now(),
): ExerciseTimerState {
  const paused = pauseTimer(exerciseTimerToTimestampState(state), nowMs);

  return {
    status: "paused",
    accumulatedElapsedSeconds: Math.floor(paused.accumulatedElapsedMs / 1000),
    segmentStartedAt: null,
  };
}

export function resumeExerciseTimer(
  state: ExerciseTimerState,
  nowMs: number = Date.now(),
): ExerciseTimerState {
  return {
    ...state,
    status: "running",
    segmentStartedAt: new Date(nowMs).toISOString(),
  };
}

export function createRunningExerciseTimer(
  nowMs: number = Date.now(),
): ExerciseTimerState {
  return {
    status: "running",
    accumulatedElapsedSeconds: 0,
    segmentStartedAt: new Date(nowMs).toISOString(),
  };
}

export function getExerciseElapsedSeconds(
  state: ExerciseTimerState,
  nowMs: number = Date.now(),
): number {
  return Math.floor(
    computeElapsedMs(exerciseTimerToTimestampState(state), nowMs) / 1000,
  );
}

export function switchActiveExerciseTimer(
  timers: ExerciseTimers,
  prevActiveId: string | null,
  nextActiveId: string | null,
  nowMs: number = Date.now(),
): ExerciseTimers {
  let changed = false;
  const next = { ...timers };

  if (prevActiveId && next[prevActiveId]?.status === "running") {
    next[prevActiveId] = pauseExerciseTimer(next[prevActiveId], nowMs);
    changed = true;
  }

  if (nextActiveId) {
    const existing = next[nextActiveId];
    if (existing) {
      if (existing.status !== "running") {
        next[nextActiveId] = resumeExerciseTimer(existing, nowMs);
        changed = true;
      }
    } else {
      next[nextActiveId] = createRunningExerciseTimer(nowMs);
      changed = true;
    }
  }

  return changed ? next : timers;
}

export function reconcileStoredExerciseTimers(
  timers: ExerciseTimers,
): ExerciseTimers {
  const next: ExerciseTimers = {};

  for (const [exerciseId, state] of Object.entries(timers)) {
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.accumulatedElapsedSeconds !== "number" ||
      (state.status !== "running" && state.status !== "paused")
    ) {
      continue;
    }

    next[exerciseId] =
      state.status === "running" && state.segmentStartedAt
        ? pauseExerciseTimer(state)
        : state;
  }

  return next;
}
