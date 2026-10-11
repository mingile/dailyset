import { describe, expect, it } from "vitest";
import type { ExerciseTimers } from "@/app/types";
import {
  computeElapsedMs,
  computeRemainingMs,
  elapsedSecondsFromStartedAt,
  pauseTimer,
  reconcileTimerState,
  resumeTimer,
  startTimer,
  switchActiveExerciseTimer,
} from "./timer";

const T0 = 1_700_000_000_000;

describe("computeElapsedMs", () => {
  it("running 상태에서는 누적 시간과 현재 구간을 합산한다", () => {
    const state = {
      status: "running" as const,
      accumulatedElapsedMs: 30_000,
      segmentStartedAtMs: T0,
    };

    expect(computeElapsedMs(state, T0 + 10_000)).toBe(40_000);
  });

  it("paused 상태에서는 누적 시간만 반환한다", () => {
    const state = {
      status: "paused" as const,
      accumulatedElapsedMs: 45_000,
      segmentStartedAtMs: null,
    };

    expect(computeElapsedMs(state, T0 + 120_000)).toBe(45_000);
  });
});

describe("pauseTimer / resumeTimer", () => {
  it("일시정지 시 현재까지 경과 시간을 누적한다", () => {
    const running = startTimer(undefined, T0);
    const paused = pauseTimer(running, T0 + 15_000);

    expect(paused.status).toBe("paused");
    expect(paused.accumulatedElapsedMs).toBe(15_000);
    expect(paused.segmentStartedAtMs).toBeNull();
  });

  it("재개 후에는 재개 시각부터 경과 시간을 계산한다", () => {
    const paused = {
      status: "paused" as const,
      accumulatedElapsedMs: 20_000,
      segmentStartedAtMs: null,
    };
    const resumed = resumeTimer(paused, T0 + 60_000);

    expect(resumed.status).toBe("running");
    expect(resumed.segmentStartedAtMs).toBe(T0 + 60_000);
    expect(computeElapsedMs(resumed, T0 + 75_000)).toBe(35_000);
  });
});

describe("reconcileTimerState", () => {
  it("목표 시간을 초과하면 completed 상태로 전환한다", () => {
    const running = startTimer(60_000, T0);
    const completed = reconcileTimerState(running, T0 + 90_000);

    expect(completed.status).toBe("completed");
    expect(completed.accumulatedElapsedMs).toBe(60_000);
    expect(computeRemainingMs(completed)).toBe(0);
  });
});

describe("elapsedSecondsFromStartedAt", () => {
  it("시작 시각 기준 경과 초를 계산한다", () => {
    const startedAt = new Date(T0).toISOString();
    expect(elapsedSecondsFromStartedAt(startedAt, T0 + 125_000)).toBe(125);
  });
});

describe("switchActiveExerciseTimer", () => {
  const running = (accumulated = 0, startedAtMs = T0) => ({
    status: "running" as const,
    accumulatedElapsedSeconds: accumulated,
    segmentStartedAt: new Date(startedAtMs).toISOString(),
  });
  const paused = (accumulated: number) => ({
    status: "paused" as const,
    accumulatedElapsedSeconds: accumulated,
    segmentStartedAt: null,
  });

  it("활성 운동이 없어지면 이전 운동의 running 타이머를 일시정지한다", () => {
    const timers: ExerciseTimers = { ex1: running(5, T0) };

    const result = switchActiveExerciseTimer(timers, "ex1", null, T0 + 12_500);

    expect(result.ex1).toEqual(paused(17));
  });

  it("처음 열린 운동은 running 타이머를 새로 만든다", () => {
    const result = switchActiveExerciseTimer({}, null, "ex1", T0 + 3_000);

    expect(result.ex1).toEqual(running(0, T0 + 3_000));
  });

  it("paused 타이머가 있는 운동이 열리면 누적 시간을 유지한 채 재개한다", () => {
    const timers: ExerciseTimers = { ex1: paused(7) };

    const result = switchActiveExerciseTimer(timers, null, "ex1", T0 + 9_000);

    expect(result.ex1).toEqual(running(7, T0 + 9_000));
  });

  it("다른 운동으로 전환하면 이전 운동은 일시정지하고 새 운동은 시작한다", () => {
    const timers: ExerciseTimers = { ex1: running(0, T0) };

    const result = switchActiveExerciseTimer(timers, "ex1", "ex2", T0 + 20_000);

    expect(result.ex1).toEqual(paused(20));
    expect(result.ex2).toEqual(running(0, T0 + 20_000));
  });

  it("이전 운동이 paused이고 활성 운동이 없으면 같은 객체를 반환한다", () => {
    const timers: ExerciseTimers = { ex1: paused(4) };

    expect(switchActiveExerciseTimer(timers, "ex1", null, T0)).toBe(timers);
  });

  it("새 활성 운동이 이미 running이면 같은 객체를 반환한다", () => {
    const timers: ExerciseTimers = { ex1: running(2, T0) };

    expect(switchActiveExerciseTimer(timers, null, "ex1", T0 + 5_000)).toBe(
      timers,
    );
  });

  it("이전·새 활성 운동이 모두 없으면 같은 객체를 반환한다", () => {
    const timers: ExerciseTimers = { ex1: paused(4) };

    expect(switchActiveExerciseTimer(timers, null, null, T0)).toBe(timers);
  });

  it("입력 timers를 변경하지 않는다", () => {
    const timers: ExerciseTimers = { ex1: running(0, T0) };
    const snapshot = structuredClone(timers);

    const result = switchActiveExerciseTimer(timers, "ex1", "ex2", T0 + 5_000);

    expect(result).not.toBe(timers);
    expect(timers).toEqual(snapshot);
  });
});
