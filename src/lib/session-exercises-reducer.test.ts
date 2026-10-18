import { describe, expect, it } from "vitest";
import type { Exercise, SetItem } from "@/app/types";
import {
  initialSessionExercisesState,
  sessionExercisesReducer,
  type SessionEditAction,
  type SessionExercisesState,
} from "./session-exercises-reducer";

function createSet(overrides: Partial<SetItem> = {}): SetItem {
  return {
    weight: 60,
    reps: 10,
    done: false,
    synced: true,
    equipment: "barbell",
    memo: "",
    unit: "kg",
    setType: "main",
    ...overrides,
  };
}

function createExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: "ex-1",
    name: "Squats",
    exercisePageId: "page-1",
    sets: [createSet(), createSet(), createSet()],
    ...overrides,
  };
}

function createState(
  overrides: Partial<SessionExercisesState> = {},
): SessionExercisesState {
  return {
    exercises: [
      createExercise(),
      createExercise({
        id: "ex-2",
        name: "Bench Press",
        exercisePageId: "page-2",
        sets: [createSet({ weight: 40 }), createSet({ weight: 40 })],
      }),
    ],
    historyDirty: false,
    ...overrides,
  };
}

describe("사용자 편집 action은 모두 historyDirty를 true로 만든다", () => {
  const editActions: SessionEditAction[] = [
    { type: "deleteSet", exId: "ex-1", setIdx: 0 },
    { type: "changeReps", exIdx: 0, setIdx: 0, delta: 1 },
    { type: "changeWeight", exIdx: 0, setIdx: 0, weight: 70 },
    { type: "changeMemo", exIdx: 0, setIdx: 0, value: "메모" },
    { type: "changeEquipment", exIdx: 0, setIdx: 0, equipment: "dumbbell" },
    { type: "changeUnit", exIdx: 0, setIdx: 0, unit: "lb" },
    { type: "toggleDone", exIdx: 0, setIdx: 0 },
    { type: "addSet", exIdx: 0 },
    { type: "changeSetType", exIdx: 0, setIdx: 0, setType: "warmup" },
    { type: "addExercises", exercises: [] },
  ];

  it.each(editActions.map((action) => [action.type, action] as const))(
    "%s",
    (_, action) => {
      const next = sessionExercisesReducer(createState(), action);
      expect(next.historyDirty).toBe(true);
    },
  );

  it("변경이 없는 no-op에도 dirty로 표시한다 (기존 핸들러 동작)", () => {
    const single = createState({
      exercises: [createExercise({ sets: [createSet()] })],
    });
    const deleted = sessionExercisesReducer(single, {
      type: "deleteSet",
      exId: "ex-1",
      setIdx: 0,
    });
    expect(deleted.exercises).toEqual(single.exercises);
    expect(deleted.historyDirty).toBe(true);

    const sameType = sessionExercisesReducer(createState(), {
      type: "changeSetType",
      exIdx: 0,
      setIdx: 0,
      setType: "main",
    });
    expect(sameType.historyDirty).toBe(true);
  });
});

describe("세트 값 변경", () => {
  it("changeReps는 delta만큼 더하고 synced를 false로 만든다", () => {
    const next = sessionExercisesReducer(createState(), {
      type: "changeReps",
      exIdx: 0,
      setIdx: 1,
      delta: 2,
    });
    expect(next.exercises[0].sets[1]).toMatchObject({
      reps: 12,
      synced: false,
    });
    expect(next.exercises[0].sets[0].reps).toBe(10);
  });

  it("changeReps는 0 아래로 내려가지 않는다", () => {
    const next = sessionExercisesReducer(createState(), {
      type: "changeReps",
      exIdx: 0,
      setIdx: 0,
      delta: -99,
    });
    expect(next.exercises[0].sets[0].reps).toBe(0);
  });

  it("changeWeight는 무게를 바꾸고 synced를 false로 만든다", () => {
    const next = sessionExercisesReducer(createState(), {
      type: "changeWeight",
      exIdx: 1,
      setIdx: 0,
      weight: 42.5,
    });
    expect(next.exercises[1].sets[0]).toMatchObject({
      weight: 42.5,
      synced: false,
    });
  });

  it("changeMemo / changeEquipment / changeUnit은 해당 값만 바꾸고 synced를 false로 만든다", () => {
    let state = createState();
    state = sessionExercisesReducer(state, {
      type: "changeMemo",
      exIdx: 0,
      setIdx: 0,
      value: "그립 넓게",
    });
    state = sessionExercisesReducer(state, {
      type: "changeEquipment",
      exIdx: 0,
      setIdx: 0,
      equipment: "smith-machine",
    });
    state = sessionExercisesReducer(state, {
      type: "changeUnit",
      exIdx: 0,
      setIdx: 0,
      unit: "lb",
    });
    expect(state.exercises[0].sets[0]).toMatchObject({
      memo: "그립 넓게",
      equipment: "smith-machine",
      unit: "lb",
      weight: 60,
      synced: false,
    });
  });

  it("toggleDone은 done만 뒤집고 synced는 건드리지 않는다", () => {
    const once = sessionExercisesReducer(createState(), {
      type: "toggleDone",
      exIdx: 0,
      setIdx: 0,
    });
    expect(once.exercises[0].sets[0]).toMatchObject({
      done: true,
      synced: true,
    });

    const twice = sessionExercisesReducer(once, {
      type: "toggleDone",
      exIdx: 0,
      setIdx: 0,
    });
    expect(twice.exercises[0].sets[0].done).toBe(false);
  });

  it("대상이 아닌 운동 객체는 그대로 유지하고 입력 state를 바꾸지 않는다", () => {
    const state = createState();
    const snapshot = JSON.parse(JSON.stringify(state));
    const next = sessionExercisesReducer(state, {
      type: "changeWeight",
      exIdx: 0,
      setIdx: 0,
      weight: 99,
    });
    expect(next.exercises[1]).toBe(state.exercises[1]);
    expect(state).toEqual(snapshot);
  });

  it("범위를 벗어난 인덱스는 값을 바꾸지 않는다", () => {
    const state = createState();
    const next = sessionExercisesReducer(state, {
      type: "changeWeight",
      exIdx: 0,
      setIdx: 99,
      weight: 99,
    });
    expect(next.exercises).toEqual(state.exercises);
  });
});

describe("addSet", () => {
  it("마지막 세트의 값을 복사해 끝에 추가하고 done / memo를 초기화한다", () => {
    const state = createState({
      exercises: [
        createExercise({
          sets: [
            createSet(),
            createSet({
              weight: 80,
              reps: 5,
              done: true,
              memo: "무거움",
              equipment: "dumbbell",
              unit: "lb",
              setType: "warmup",
            }),
          ],
        }),
      ],
    });
    const next = sessionExercisesReducer(state, { type: "addSet", exIdx: 0 });
    expect(next.exercises[0].sets).toHaveLength(3);
    expect(next.exercises[0].sets[2]).toEqual({
      weight: 80,
      reps: 5,
      done: false,
      synced: false,
      equipment: "dumbbell",
      memo: "",
      unit: "lb",
      setType: "warmup",
    });
  });

  it("setType이 없는 세트를 복사하면 main으로 채운다", () => {
    const state = createState({
      exercises: [
        createExercise({ sets: [createSet({ setType: undefined })] }),
      ],
    });
    const next = sessionExercisesReducer(state, { type: "addSet", exIdx: 0 });
    expect(next.exercises[0].sets[1].setType).toBe("main");
  });

  it("세트가 없는 운동에는 아무것도 추가하지 않는다", () => {
    const state = createState({
      exercises: [createExercise({ sets: [] })],
    });
    const next = sessionExercisesReducer(state, { type: "addSet", exIdx: 0 });
    expect(next.exercises[0].sets).toEqual([]);
  });
});

describe("deleteSet", () => {
  it("exId로 운동을 찾아 그 세트만 지운다", () => {
    const state = createState();
    const next = sessionExercisesReducer(state, {
      type: "deleteSet",
      exId: "ex-1",
      setIdx: 1,
    });
    expect(next.exercises[0].sets).toEqual([
      state.exercises[0].sets[0],
      state.exercises[0].sets[2],
    ]);
    expect(next.exercises[1]).toBe(state.exercises[1]);
  });

  it("웜업 세트를 지우면 남은 본세트는 그대로 둔다", () => {
    const state = createState({
      exercises: [
        createExercise({
          sets: [createSet({ setType: "warmup" }), createSet()],
        }),
      ],
    });
    const next = sessionExercisesReducer(state, {
      type: "deleteSet",
      exId: "ex-1",
      setIdx: 0,
    });
    expect(next.exercises[0].sets).toEqual([state.exercises[0].sets[1]]);
  });

  it("마지막 남은 세트는 지우지 않는다", () => {
    const state = createState({
      exercises: [createExercise({ sets: [createSet()] })],
    });
    const next = sessionExercisesReducer(state, {
      type: "deleteSet",
      exId: "ex-1",
      setIdx: 0,
    });
    expect(next.exercises[0].sets).toHaveLength(1);
  });

  it("없는 세트 인덱스 / 없는 exId는 아무것도 바꾸지 않는다", () => {
    const state = createState();
    expect(
      sessionExercisesReducer(state, {
        type: "deleteSet",
        exId: "ex-1",
        setIdx: 9,
      }).exercises,
    ).toEqual(state.exercises);
    expect(
      sessionExercisesReducer(state, {
        type: "deleteSet",
        exId: "missing",
        setIdx: 0,
      }).exercises,
    ).toEqual(state.exercises);
  });
});

describe("changeSetType", () => {
  it("본세트 → 웜업: 그 세트만 웜업으로 바꾸고 synced를 false로 만든다", () => {
    const state = createState();
    const next = sessionExercisesReducer(state, {
      type: "changeSetType",
      exIdx: 0,
      setIdx: 0,
      setType: "warmup",
    });
    expect(next.exercises[0].sets[0]).toMatchObject({
      setType: "warmup",
      synced: false,
    });
    expect(next.exercises[0].sets[1]).toBe(state.exercises[0].sets[1]);
  });

  it("웜업 → 본세트: 그 세트만 본세트로 바꾸고 synced를 false로 만든다", () => {
    const state = createState({
      exercises: [
        createExercise({
          sets: [createSet({ setType: "warmup" }), createSet()],
        }),
      ],
    });
    const next = sessionExercisesReducer(state, {
      type: "changeSetType",
      exIdx: 0,
      setIdx: 0,
      setType: "main",
    });
    expect(next.exercises[0].sets[0]).toMatchObject({
      setType: "main",
      synced: false,
    });
    expect(next.exercises[0].sets[1]).toBe(state.exercises[0].sets[1]);
  });

  it("같은 타입이면 운동 객체를 그대로 둔다", () => {
    const state = createState();
    const next = sessionExercisesReducer(state, {
      type: "changeSetType",
      exIdx: 0,
      setIdx: 0,
      setType: "main",
    });
    expect(next.exercises[0]).toBe(state.exercises[0]);
  });

  it("setType이 없는 세트는 본세트로 취급한다", () => {
    const state = createState({
      exercises: [
        createExercise({ sets: [createSet({ setType: undefined })] }),
      ],
    });
    const next = sessionExercisesReducer(state, {
      type: "changeSetType",
      exIdx: 0,
      setIdx: 0,
      setType: "main",
    });
    expect(next.exercises[0]).toBe(state.exercises[0]);
  });
});

describe("addExercises", () => {
  it("새 운동을 끝에 추가한다", () => {
    const added = createExercise({
      id: "ex-3",
      name: "Deadlift",
      exercisePageId: "page-3",
    });
    const next = sessionExercisesReducer(createState(), {
      type: "addExercises",
      exercises: [added],
    });
    expect(next.exercises.map((ex) => ex.id)).toEqual(["ex-1", "ex-2", "ex-3"]);
  });

  it("이미 있는 exercisePageId는 추가하지 않는다", () => {
    const duplicate = createExercise({ id: "ex-9", exercisePageId: "page-1" });
    const next = sessionExercisesReducer(createState(), {
      type: "addExercises",
      exercises: [duplicate],
    });
    expect(next.exercises).toHaveLength(2);
  });
});

describe("사용자 편집이 아닌 action", () => {
  it("hydrate는 운동과 dirty 값을 통째로 지정한다", () => {
    const exercises = [createExercise({ id: "restored" })];

    const dirty = sessionExercisesReducer(initialSessionExercisesState, {
      type: "hydrate",
      exercises,
      historyDirty: true,
    });
    expect(dirty).toEqual({ exercises, historyDirty: true });

    const clean = sessionExercisesReducer(createState({ historyDirty: true }), {
      type: "hydrate",
      exercises,
      historyDirty: false,
    });
    expect(clean).toEqual({ exercises, historyDirty: false });
  });

  it("clearDirty는 운동은 두고 dirty만 false로 만든다", () => {
    const state = createState({ historyDirty: true });
    const next = sessionExercisesReducer(state, { type: "clearDirty" });
    expect(next.historyDirty).toBe(false);
    expect(next.exercises).toBe(state.exercises);
  });

  it("markDirty는 운동은 두고 dirty만 true로 만든다", () => {
    const state = createState();
    const next = sessionExercisesReducer(state, { type: "markDirty" });
    expect(next.historyDirty).toBe(true);
    expect(next.exercises).toBe(state.exercises);
  });

  it("mergeExternal은 운동만 바꾸고 dirty는 그대로 둔다", () => {
    const update = (prev: Exercise[]) =>
      prev.map((ex) => ({ ...ex, part: "legs" }));

    const clean = sessionExercisesReducer(createState(), {
      type: "mergeExternal",
      update,
    });
    expect(clean.exercises.every((ex) => ex.part === "legs")).toBe(true);
    expect(clean.historyDirty).toBe(false);

    const dirty = sessionExercisesReducer(createState({ historyDirty: true }), {
      type: "mergeExternal",
      update,
    });
    expect(dirty.historyDirty).toBe(true);
  });
});
