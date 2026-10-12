import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/app/types";
import { getPreviousSets } from "./previous-record";

function makeSession(
  id: string,
  savedAt: string,
  sets: {
    weight: number;
    reps: number;
    equipment: string;
    memo?: string;
  }[],
  exerciseName = "벤치프레스",
): Session {
  return {
    id,
    savedAt,
    exercises: [
      {
        id: `${id}-ex`,
        name: exerciseName,
        sets: sets.map((set, index) => ({
          setNo: index + 1,
          weight: set.weight,
          reps: set.reps,
          equipment: set.equipment,
          memo: set.memo as string,
        })),
      },
    ],
  };
}

function stubSessions(sessions: Session[]) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "workout.sessions.v1" ? JSON.stringify(sessions) : null,
  });
}

describe("getPreviousSets memo", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("기구가 일치하는 기록은 세트별 memo를 포함한다", () => {
    stubSessions([
      makeSession("s1", "2026-10-01T10:00:00.000Z", [
        { weight: 60, reps: 10, equipment: "barbell", memo: "가볍게" },
        { weight: 70, reps: 8, equipment: "barbell", memo: "마지막 힘들었음" },
      ]),
    ]);

    const result = getPreviousSets("벤치프레스", "barbell");

    expect(result?.sets.map((set) => set.memo)).toEqual([
      "가볍게",
      "마지막 힘들었음",
    ]);
  });

  it("운동명만 일치하는 기록도 memo를 포함한다", () => {
    stubSessions([
      makeSession("s1", "2026-10-01T10:00:00.000Z", [
        { weight: 20, reps: 12, equipment: "dumbbell", memo: "어깨 불편" },
      ]),
    ]);

    const result = getPreviousSets("벤치프레스", "barbell");

    expect(result?.sets).toEqual([
      { weight: 20, reps: 12, equipment: "dumbbell", memo: "어깨 불편" },
    ]);
  });

  it("memo가 비어 있거나 저장되지 않은 세트는 빈 문자열로 반환한다", () => {
    stubSessions([
      makeSession("s1", "2026-10-01T10:00:00.000Z", [
        { weight: 60, reps: 10, equipment: "barbell", memo: "" },
        { weight: 70, reps: 8, equipment: "barbell" },
      ]),
    ]);

    const result = getPreviousSets("벤치프레스", "barbell");

    expect(result?.sets.map((set) => set.memo)).toEqual(["", ""]);
  });

  it("excludeSessionId 세션은 제외하고 그 다음 최신 기록의 memo를 반환한다", () => {
    stubSessions([
      makeSession("current", "2026-10-10T10:00:00.000Z", [
        { weight: 80, reps: 5, equipment: "barbell", memo: "현재 세션 메모" },
      ]),
      makeSession("previous", "2026-10-01T10:00:00.000Z", [
        { weight: 60, reps: 10, equipment: "barbell", memo: "이전 세션 메모" },
      ]),
    ]);

    const result = getPreviousSets("벤치프레스", "barbell", "current");

    expect(result?.savedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(result?.sets.map((set) => set.memo)).toEqual(["이전 세션 메모"]);
  });
});
