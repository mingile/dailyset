import { afterEach, describe, expect, it, vi } from "vitest";
import type { Exercise, SetItem } from "@/app/types";
import {
  computeHistoryDirty,
  createHistoryPayload,
  createLocalExercisesPayload,
  createNotionExercisesPayload,
  markSyncedSets,
} from "./workoutSessionPayload";

function makeSet(overrides: Partial<SetItem> = {}): SetItem {
  return {
    weight: 60,
    reps: 10,
    done: true,
    synced: false,
    equipment: "barbell",
    memo: "",
    unit: "kg",
    setType: "main",
    ...overrides,
  };
}

function makeExercise(
  overrides: Partial<Exercise> & { sets: SetItem[] },
): Exercise {
  return {
    id: "ex-1",
    name: "벤치프레스",
    part: "가슴",
    ...overrides,
  };
}

describe("createLocalExercisesPayload", () => {
  it("done인 세트만 포함하고 setNo를 done 세트 기준으로 1부터 다시 매긴다", () => {
    const exercise = makeExercise({
      sets: [
        makeSet({ weight: 40, done: true }),
        makeSet({ weight: 50, done: false }),
        makeSet({ weight: 60, done: true }),
      ],
    });

    const [payload] = createLocalExercisesPayload([exercise]);

    expect(payload.sets).toEqual([
      { setNo: 1, weight: 40, reps: 10, memo: "", equipment: "barbell" },
      { setNo: 2, weight: 60, reps: 10, memo: "", equipment: "barbell" },
    ]);
  });

  it("done 세트가 없는 운동은 제외한다", () => {
    const result = createLocalExercisesPayload([
      makeExercise({ id: "ex-1", sets: [makeSet({ done: false })] }),
      makeExercise({ id: "ex-2", name: "스쿼트", sets: [makeSet()] }),
    ]);

    expect(result.map((ex) => ex.id)).toEqual(["ex-2"]);
  });

  it("part가 없으면 '기타'로 채우고 id·name·exercisePageId를 그대로 전달한다", () => {
    const [payload] = createLocalExercisesPayload([
      makeExercise({
        id: "ex-9",
        name: "랫풀다운",
        part: undefined,
        exercisePageId: "page-9",
        sets: [makeSet()],
      }),
    ]);

    expect(payload).toMatchObject({
      id: "ex-9",
      name: "랫풀다운",
      part: "기타",
      exercisePageId: "page-9",
    });
  });

  it("세트에서 저장 대상 필드(weight, reps, memo, equipment)만 남긴다", () => {
    const [payload] = createLocalExercisesPayload([
      makeExercise({
        sets: [makeSet({ memo: "마지막 세트 힘듦", unit: "lb", synced: true })],
      }),
    ]);

    expect(Object.keys(payload.sets[0]).sort()).toEqual([
      "equipment",
      "memo",
      "reps",
      "setNo",
      "weight",
    ]);
    expect(payload.sets[0].memo).toBe("마지막 세트 힘듦");
  });

  it("빈 배열이면 빈 배열을 반환한다", () => {
    expect(createLocalExercisesPayload([])).toEqual([]);
  });
});

describe("createHistoryPayload", () => {
  const localExercises = createLocalExercisesPayload([
    makeExercise({ sets: [makeSet()] }),
  ]);

  it("파라미터를 history 세션 형태로 매핑한다", () => {
    expect(
      createHistoryPayload({
        sessionId: "sess_1",
        sessionName: "가슴 운동",
        savedAt: "2026-10-13T05:00:00.000Z",
        localExercises,
        durationSeconds: 3600,
      }),
    ).toEqual({
      id: "sess_1",
      savedAt: "2026-10-13T05:00:00.000Z",
      sessionName: "가슴 운동",
      exercises: localExercises,
      durationSeconds: 3600,
    });
  });

  it("durationSeconds를 생략하면 undefined이다", () => {
    const payload = createHistoryPayload({
      sessionId: "sess_1",
      sessionName: "가슴 운동",
      savedAt: "2026-10-13T05:00:00.000Z",
      localExercises,
    });

    expect(payload.durationSeconds).toBeUndefined();
  });
});

describe("createNotionExercisesPayload", () => {
  it("done이면서 아직 synced되지 않은 세트만 포함하고 setNo를 다시 매긴다", () => {
    const [payload] = createNotionExercisesPayload([
      makeExercise({
        sets: [
          makeSet({ weight: 40, synced: true }),
          makeSet({ weight: 50, done: false }),
          makeSet({ weight: 60 }),
          makeSet({ weight: 70 }),
        ],
      }),
    ]);

    expect(payload.sets.map((set) => [set.setNo, set.weight])).toEqual([
      [1, 60],
      [2, 70],
    ]);
  });

  it("모든 세트가 synced이거나 done이 아니면 운동을 제외한다", () => {
    const result = createNotionExercisesPayload([
      makeExercise({ id: "ex-1", sets: [makeSet({ synced: true })] }),
      makeExercise({ id: "ex-2", sets: [makeSet({ done: false })] }),
    ]);

    expect(result).toEqual([]);
  });

  it("part 기본값 '기타'와 exercisePageId를 전달한다", () => {
    const [payload] = createNotionExercisesPayload([
      makeExercise({
        part: undefined,
        exercisePageId: "notion-page-1",
        sets: [makeSet()],
      }),
    ]);

    expect(payload.part).toBe("기타");
    expect(payload.exercisePageId).toBe("notion-page-1");
  });
});

describe("markSyncedSets", () => {
  it("done이면서 synced되지 않은 세트만 synced: true로 바꾼다", () => {
    const result = markSyncedSets([
      makeExercise({
        sets: [
          makeSet({ weight: 40, synced: true }),
          makeSet({ weight: 50, done: false }),
          makeSet({ weight: 60 }),
        ],
      }),
    ]);

    expect(result[0].sets.map((set) => set.synced)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("원본 exercises를 변경하지 않는다", () => {
    const original = [makeExercise({ sets: [makeSet()] })];
    const snapshot = structuredClone(original);

    const result = markSyncedSets(original);

    expect(original).toEqual(snapshot);
    expect(result).not.toBe(original);
    expect(result[0].sets[0]).not.toBe(original[0].sets[0]);
  });
});

describe("computeHistoryDirty", () => {
  const SESSIONS_KEY = "workout.sessions.v1";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocalStorage(raw?: string) {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => (key === SESSIONS_KEY ? (raw ?? null) : null),
    });
  }

  const exercises = [
    makeExercise({ sets: [makeSet({ weight: 60 }), makeSet({ weight: 70 })] }),
  ];

  function savedSessionsJson(id: string, savedExercises = exercises) {
    return JSON.stringify([
      {
        id,
        savedAt: "2026-10-13T05:00:00.000Z",
        exercises: createLocalExercisesPayload(savedExercises),
      },
    ]);
  }

  it("done 세트가 없으면 저장소와 무관하게 false이다", () => {
    stubLocalStorage();
    const notDone = [makeExercise({ sets: [makeSet({ done: false })] })];

    expect(computeHistoryDirty("sess_1", notDone)).toBe(false);
  });

  it("window가 없으면(SSR) true이다", () => {
    expect(computeHistoryDirty("sess_1", exercises)).toBe(true);
  });

  it("저장된 history가 없으면 true이다", () => {
    stubLocalStorage();

    expect(computeHistoryDirty("sess_1", exercises)).toBe(true);
  });

  it("같은 sessionId에 동일한 payload가 저장돼 있으면 false이다", () => {
    stubLocalStorage(savedSessionsJson("sess_1"));

    expect(computeHistoryDirty("sess_1", exercises)).toBe(false);
  });

  it("저장된 payload와 내용이 다르면 true이다", () => {
    stubLocalStorage(savedSessionsJson("sess_1"));
    const edited = [
      makeExercise({
        sets: [makeSet({ weight: 60 }), makeSet({ weight: 75 })],
      }),
    ];

    expect(computeHistoryDirty("sess_1", edited)).toBe(true);
  });

  it("done 세트가 늘어나면 true이다", () => {
    stubLocalStorage(savedSessionsJson("sess_1"));
    const moreDone = [
      makeExercise({
        sets: [
          makeSet({ weight: 60 }),
          makeSet({ weight: 70 }),
          makeSet({ weight: 80 }),
        ],
      }),
    ];

    expect(computeHistoryDirty("sess_1", moreDone)).toBe(true);
  });

  it("해당 sessionId가 history에 없으면 true이다", () => {
    stubLocalStorage(savedSessionsJson("other-session"));

    expect(computeHistoryDirty("sess_1", exercises)).toBe(true);
  });

  it("저장된 값이 배열이 아니거나 JSON이 깨져 있으면 true이다", () => {
    stubLocalStorage(JSON.stringify({ id: "sess_1" }));
    expect(computeHistoryDirty("sess_1", exercises)).toBe(true);

    stubLocalStorage("{not json");
    expect(computeHistoryDirty("sess_1", exercises)).toBe(true);
  });
});
