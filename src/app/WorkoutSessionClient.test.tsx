import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionExercises } from "@/hooks/useSessionExercises";
import { kgToLb } from "@/lib/weightUnit";
import type {
  Exercises,
  ExerciseTimers,
  Session,
  SessionMetadata,
} from "./types";
import { WorkoutSessionClient } from "./WorkoutSessionClient";

// 이 파일은 "사용자가 누르고 입력했을 때 화면에 무엇이 보이는가"만 검증한다.
// reducer 계산·단위 변환 규칙 자체는 session-exercises-reducer / weightUnit 테스트가 이미 보장한다.

const SESSION_METADATA: SessionMetadata = {
  sessionId: "test-session",
  sessionName: "테스트 세션",
  startedAt: "2026-10-13T00:00:00.000Z",
};

function makeExercises(): Exercises {
  return [
    {
      id: "ex-bench",
      name: "벤치프레스",
      part: "가슴",
      sets: [1, 2, 3].map(() => ({
        weight: 60,
        reps: 10,
        done: false,
        synced: false,
        equipment: "barbell",
        memo: "",
        unit: "kg" as const,
        setType: "main" as const,
      })),
    },
  ];
}

function displayWeightUnit(weight: number, unit: "kg" | "lb") {
  if (unit === "lb") {
    return { displayWeight: Math.round(kgToLb(weight)), displayUnit: unit };
  }
  return { displayWeight: Math.round(weight * 10) / 10, displayUnit: unit };
}

// RootClient가 하던 조립(useSessionExercises + 타이머 state)만 흉내 낸 하네스.
// 네트워크·localStorage 저장은 포함하지 않는다.
function Harness({
  onCompleteWorkout = () => {},
  saving = false,
  hideSessionActions = false,
  withAddExerciseSlot = true,
}: {
  onCompleteWorkout?: () => void;
  saving?: boolean;
  hideSessionActions?: boolean;
  withAddExerciseSlot?: boolean;
}) {
  const { exercises, actions } = useSessionExercises(makeExercises());
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});

  return (
    <>
      <WorkoutSessionClient
        exercises={exercises}
        displayWeightUnit={displayWeightUnit}
        actions={actions}
        sessionMetadata={SESSION_METADATA}
        exerciseTimers={exerciseTimers}
        onExerciseTimersChange={setExerciseTimers}
        onCompleteWorkout={onCompleteWorkout}
        saving={saving}
        addExerciseSlot={
          withAddExerciseSlot ? (
            <button type="button">운동 추가</button>
          ) : undefined
        }
        hideSessionActions={hideSessionActions}
      />
      <output data-testid="exercise-timers">
        {JSON.stringify(exerciseTimers)}
      </output>
    </>
  );
}

/** Harness가 노출한 운동 타이머 state를 읽는다 */
function readTimers(): ExerciseTimers {
  return JSON.parse(screen.getByTestId("exercise-timers").textContent ?? "{}");
}

/** 운동을 펼친 상태로 렌더한다 (세트 입력 UI는 펼친 운동 안에 있다) */
async function renderOpenedSession(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: /벤치프레스/ }));
  return user;
}

/** 숫자 필드를 눌러 편집 모드로 바꾸고 입력창을 반환한다 */
async function startEditing(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
  return screen.getByRole("textbox", { name: label });
}

describe("WorkoutSessionClient — 운동 목록", () => {
  it("운동 이름과 완료 세트 진행도를 보여준다", () => {
    render(<Harness />);

    expect(screen.getByText("벤치프레스")).toBeInTheDocument();
    expect(screen.getByText("0 / 3 SETS")).toBeInTheDocument();
  });

  it("운동을 누르면 세트 행이 펼쳐지고, 다시 누르면 접힌다", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole("checkbox", { name: "세트 1 완료" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));
    expect(
      screen.getByRole("checkbox", { name: "세트 1 완료" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));
    expect(screen.queryByRole("checkbox", { name: "세트 1 완료" })).toBeNull();
  });
});

describe("WorkoutSessionClient — 숫자 입력", () => {
  it("무게를 누르면 입력창으로 바뀌고 Enter로 커밋하면 새 값이 보인다", async () => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "세트 1 무게");
    await user.clear(input);
    await user.type(input, "80{Enter}");

    expect(screen.queryByRole("textbox", { name: "세트 1 무게" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "세트 1 무게" }),
    ).toHaveTextContent("80");
    // 현재 세트(첫 미완료 세트)의 큰 표시에도 반영된다
    expect(
      screen.getByRole("button", { name: "현재 세트 무게" }),
    ).toHaveTextContent("80");
    // 다른 세트는 그대로
    expect(
      screen.getByRole("button", { name: "세트 2 무게" }),
    ).toHaveTextContent("60");
  });

  it("Escape를 누르면 입력을 취소하고 원래 값을 유지한다", async () => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "세트 1 무게");
    await user.clear(input);
    await user.type(input, "99{Escape}");

    expect(screen.queryByRole("textbox", { name: "세트 1 무게" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "세트 1 무게" }),
    ).toHaveTextContent("60");
  });

  it("입력창에서 포커스가 벗어나면(blur) 값이 커밋된다", async () => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "세트 1 횟수");
    await user.clear(input);
    await user.type(input, "7");
    await user.tab();

    expect(
      screen.getByRole("button", { name: "세트 1 횟수" }),
    ).toHaveTextContent("7");
  });

  it.each([
    ["숫자가 아닌 값", "abc"],
    ["빈 값", ""],
    ["음수", "-5"],
  ])("무게에 %s을 입력하면 원래 값을 유지한다", async (_label, value) => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "세트 1 무게");
    await user.clear(input);
    if (value) await user.type(input, value);
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", { name: "세트 1 무게" }),
    ).toHaveTextContent("60");
  });

  it.each([
    ["소수", "7.5"],
    ["음수", "-3"],
    ["문자", "열"],
  ])("횟수에 %s를 입력하면 원래 값을 유지한다", async (_label, value) => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "세트 1 횟수");
    await user.clear(input);
    await user.type(input, `${value}{Enter}`);

    expect(
      screen.getByRole("button", { name: "세트 1 횟수" }),
    ).toHaveTextContent("10");
  });

  it("현재 세트 횟수를 고치면 해당 세트 행에 반영된다", async () => {
    const user = await renderOpenedSession();

    const input = await startEditing(user, "현재 세트 횟수");
    await user.clear(input);
    await user.type(input, "8{Enter}");

    expect(
      screen.getByRole("button", { name: "세트 1 횟수" }),
    ).toHaveTextContent("8");
    expect(
      screen.getByRole("button", { name: "세트 2 횟수" }),
    ).toHaveTextContent("10");
  });

  it("목표 세트 수를 늘리면 세트 행이 추가되고, 줄이면 뒤쪽 미완료 세트부터 사라진다", async () => {
    const user = await renderOpenedSession();

    let input = await startEditing(user, "목표 세트 수");
    await user.clear(input);
    await user.type(input, "5{Enter}");
    expect(
      screen.getByRole("checkbox", { name: "세트 5 완료" }),
    ).toBeInTheDocument();

    input = await startEditing(user, "목표 세트 수");
    await user.clear(input);
    await user.type(input, "2{Enter}");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("무게 단위를 전환하면 표시 단위가 lb로 바뀌고, lb로 입력한 값이 그대로 보인다", async () => {
    const user = await renderOpenedSession();
    const unitToggle = screen.getByRole("button", { name: "무게 단위 전환" });
    expect(unitToggle).toHaveTextContent("kg");

    await user.click(unitToggle);

    expect(unitToggle).toHaveTextContent("lb");
    expect(
      screen.getByRole("button", { name: "세트 1 무게" }),
    ).toHaveTextContent("lb");

    const input = await startEditing(user, "세트 1 무게");
    await user.clear(input);
    await user.type(input, "135{Enter}");

    expect(
      screen.getByRole("button", { name: "세트 1 무게" }),
    ).toHaveTextContent("135");
  });
});

describe("WorkoutSessionClient — 세트 조작", () => {
  it("완료 체크를 누르면 체크되고 다시 누르면 해제된다", async () => {
    const user = await renderOpenedSession();
    const checkbox = screen.getByRole("checkbox", { name: "세트 1 완료" });
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");

    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("모든 세트를 완료하면 운동이 접히고 진행도가 3 / 3 SETS로 보인다", async () => {
    const user = await renderOpenedSession();

    for (const n of [1, 2, 3]) {
      await user.click(
        screen.getByRole("checkbox", { name: `세트 ${n} 완료` }),
      );
    }

    expect(screen.getByText("3 / 3 SETS")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "세트 1 완료" })).toBeNull();
  });

  it("세트 추가를 누르면 세트 행이 하나 늘어난다", async () => {
    const user = await renderOpenedSession();

    await user.click(screen.getByRole("button", { name: "세트 추가" }));

    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(
      screen.getByRole("checkbox", { name: "세트 4 완료" }),
    ).toBeInTheDocument();
  });

  it("세트 삭제(−)를 누르면 마지막 세트가 사라지고, 마지막 세트가 완료돼 있으면 비활성화된다", async () => {
    const user = await renderOpenedSession();
    const remove = screen.getByRole("button", { name: "세트 삭제" });

    await user.click(remove);
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);

    await user.click(screen.getByRole("checkbox", { name: "세트 2 완료" }));
    expect(remove).toBeDisabled();
  });

  it("세트 타입 전환을 누르면 본세트와 웜업이 번갈아 표시된다", async () => {
    const user = await renderOpenedSession();
    const toggle = screen.getByRole("button", { name: "세트 1 타입 전환" });
    expect(toggle).toHaveTextContent("본세트");

    await user.click(toggle);
    expect(toggle).toHaveTextContent("웜업");

    await user.click(toggle);
    expect(toggle).toHaveTextContent("본세트");
  });

  it("세트 메모를 입력하면 입력창과 세트 행에 메모가 보인다", async () => {
    const user = await renderOpenedSession();

    await user.type(
      screen.getByRole("textbox", { name: "현재 세트 메모" }),
      "컨디션 좋음",
    );

    expect(screen.getByRole("textbox", { name: "현재 세트 메모" })).toHaveValue(
      "컨디션 좋음",
    );
    expect(
      screen.getByText(/컨디션 좋음/, { selector: "div" }),
    ).toBeInTheDocument();
  });
});

describe("WorkoutSessionClient — 운동 완료 표시", () => {
  const FILL = "bg-(--session-accent)/8";

  async function completeAllSets(user: ReturnType<typeof userEvent.setup>) {
    for (const n of [1, 2, 3]) {
      await user.click(
        screen.getByRole("checkbox", { name: `세트 ${n} 완료` }),
      );
    }
  }

  // 닫힌 행에서는 번호 자리에, 열린 헤더에서는 운동 이름 앞에 붙는 완료 체크
  function getCheck() {
    const trigger = screen.getByRole("button", { name: /벤치프레스/ });
    return within(trigger).queryByRole("img", { name: "완료된 운동" });
  }

  function getItem() {
    const item = screen
      .getByRole("button", { name: /벤치프레스/ })
      .closest("[data-slot='accordion-item']");
    if (!(item instanceof HTMLElement))
      throw new Error("항목을 찾지 못했습니다");
    return item;
  }

  it("미완료 운동은 접혀 있든 펼쳐져 있든 체크와 배경이 모두 없다", async () => {
    const user = await renderOpenedSession();
    expect(getCheck()).toBeNull();
    expect(getItem()).not.toHaveClass(FILL);

    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));
    expect(getCheck()).toBeNull();
    expect(getItem()).not.toHaveClass(FILL);
    expect(screen.getByText("01")).toBeInTheDocument();
  });

  it("닫힌 완료 운동은 번호 대신 체크를 보이고 배경이 칠해진다", async () => {
    const user = await renderOpenedSession();

    await completeAllSets(user);

    expect(getCheck()).toBeInTheDocument();
    expect(screen.queryByText("01")).toBeNull();
    expect(getItem()).toHaveClass(FILL);
  });

  it("열린 완료 운동은 운동 이름 앞에 체크를 보이고 배경이 유지된다", async () => {
    const user = await renderOpenedSession();
    await completeAllSets(user);

    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));

    expect(getCheck()).toBeInTheDocument();
    expect(getItem()).toHaveClass(FILL);
  });

  it("완료를 해제하면 체크와 배경이 모두 사라진다", async () => {
    const user = await renderOpenedSession();
    await completeAllSets(user);
    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));

    await user.click(screen.getByRole("checkbox", { name: "세트 3 완료" }));

    expect(getCheck()).toBeNull();
    expect(getItem()).not.toHaveClass(FILL);
  });
});

describe("WorkoutSessionClient — 운동 타이머", () => {
  async function completeAllSets(user: ReturnType<typeof userEvent.setup>) {
    for (const n of [1, 2, 3]) {
      await user.click(
        screen.getByRole("checkbox", { name: `세트 ${n} 완료` }),
      );
    }
  }

  it("운동을 펼치면 타이머가 running으로 시작한다", async () => {
    await renderOpenedSession();

    expect(readTimers()["ex-bench"]?.status).toBe("running");
  });

  it("모든 세트를 완료하면 타이머가 멈춘다", async () => {
    const user = await renderOpenedSession();

    await completeAllSets(user);

    expect(readTimers()["ex-bench"]?.status).toBe("paused");
  });

  it("완료된 운동을 다시 펼쳐도 타이머가 재개되지 않는다", async () => {
    const user = await renderOpenedSession();
    await completeAllSets(user);
    const before = readTimers()["ex-bench"];

    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));

    expect(
      screen.getByRole("checkbox", { name: "세트 1 완료" }),
    ).toBeInTheDocument();
    expect(readTimers()["ex-bench"]).toEqual(before);
  });

  it("완료를 해제하면 타이머가 다시 이어진다", async () => {
    const user = await renderOpenedSession();
    await completeAllSets(user);
    await user.click(screen.getByRole("button", { name: /벤치프레스/ }));

    await user.click(screen.getByRole("checkbox", { name: "세트 3 완료" }));

    expect(readTimers()["ex-bench"]?.status).toBe("running");
  });
});

describe("WorkoutSessionClient — 스와이프 삭제", () => {
  // Row 루트에 touch 핸들러가 걸려 있다. 완료 체크박스에서 위로 올라가 Row 루트를 찾는다.
  function getRow(setNumber: number) {
    const row = screen
      .getByRole("checkbox", { name: `세트 ${setNumber} 완료` })
      .closest("div.overflow-hidden");
    if (!(row instanceof HTMLElement)) throw new Error("Row를 찾지 못했습니다");
    return row;
  }

  function swipeLeft(row: HTMLElement, distance: number) {
    fireEvent.touchStart(row, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 200 - distance }] });
    fireEvent.touchEnd(row);
  }

  it("충분히 왼쪽으로 밀면 삭제 확인 창이 뜬다", async () => {
    await renderOpenedSession();

    swipeLeft(getRow(2), 100);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("세트를 삭제할까요?")).toBeInTheDocument();
  });

  it("조금만 밀면 확인 창이 뜨지 않는다", async () => {
    await renderOpenedSession();

    swipeLeft(getRow(2), 30);

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("취소하면 세트가 유지되고, 삭제하면 해당 세트가 사라진다", async () => {
    const user = await renderOpenedSession();

    swipeLeft(getRow(2), 100);
    await user.click(await screen.findByRole("button", { name: "취소" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);

    swipeLeft(getRow(2), 100);
    await user.click(await screen.findByRole("button", { name: "삭제" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("WorkoutSessionClient — 운동 완료 버튼", () => {
  it("누르면 onCompleteWorkout을 호출한다", async () => {
    const onCompleteWorkout = vi.fn();
    const user = userEvent.setup();
    render(<Harness onCompleteWorkout={onCompleteWorkout} />);

    await user.click(screen.getByRole("button", { name: "운동 완료" }));

    expect(onCompleteWorkout).toHaveBeenCalledTimes(1);
  });

  it("저장 중이면 '처리중...'으로 바뀌고 비활성화된다", () => {
    render(<Harness saving />);

    expect(screen.getByRole("button", { name: "처리중..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "운동 완료" })).toBeNull();
  });

  it("hideSessionActions면 운동 완료·운동 추가 버튼을 숨긴다", () => {
    render(<Harness hideSessionActions />);

    expect(screen.queryByRole("button", { name: "운동 완료" })).toBeNull();
    expect(screen.queryByRole("button", { name: /운동 추가/ })).toBeNull();
  });

  it("addExerciseSlot을 넘기면 목록 끝에 그려진다", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: /운동 추가/ }),
    ).toBeInTheDocument();
  });

  it("addExerciseSlot을 넘기지 않으면 운동 추가 버튼 자체가 없다 (랜딩 데모)", () => {
    render(<Harness withAddExerciseSlot={false} />);

    expect(screen.queryByRole("button", { name: /운동 추가/ })).toBeNull();
    // 운동 완료 등 나머지 동작은 그대로다
    expect(screen.getByRole("button", { name: "운동 완료" })).toBeEnabled();
  });
});

// ---- 이전 기록(PreviousRecord) · 기구 select ----
// 이전 기록 매칭 규칙(기구 일치 → 운동명 fallback, 현재 세션 제외)은 previous-record.test.ts가 검증한다.
// 여기서는 그 결과가 화면에 나오는지만 본다.

const SESSIONS_KEY = "workout.sessions.v1";

function seedSessions(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function makePastSession(
  id: string,
  savedAt: string,
  sets: {
    weight: number;
    reps: number;
    equipment?: string;
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
          equipment: set.equipment ?? "barbell",
          memo: set.memo ?? "",
        })),
      },
    ],
  };
}

/** 이전 기록 영역. 현재 세트 행의 숫자와 섞이지 않도록 이 안에서만 찾는다 */
function getPreviousRecordArea() {
  const area = screen.getByText("이전 기록").closest("div.mt-4");
  if (!(area instanceof HTMLElement)) {
    throw new Error("이전 기록 영역을 찾지 못했습니다");
  }
  return area;
}

function formatDateLabel(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}`;
}

describe("WorkoutSessionClient — 이전 기록", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("같은 운동의 지난 기록이 있으면 날짜와 세트별 무게·횟수를 보여준다", async () => {
    const savedAt = "2026-09-20T03:00:00.000Z";
    seedSessions([
      makePastSession("past-1", savedAt, [
        { weight: 80, reps: 8 },
        { weight: 85, reps: 6 },
      ]),
    ]);

    await renderOpenedSession();

    const area = within(getPreviousRecordArea());
    expect(area.getByText(formatDateLabel(savedAt))).toBeInTheDocument();
    expect(area.getByText("80")).toBeInTheDocument();
    expect(area.getByText("8")).toBeInTheDocument();
    expect(area.getByText("85")).toBeInTheDocument();
    expect(area.getByText("6")).toBeInTheDocument();
  });

  it("지난 기록이 없으면 이전 기록 영역을 보여주지 않는다", async () => {
    await renderOpenedSession();

    expect(screen.queryByText("이전 기록")).toBeNull();
  });

  it("다른 운동의 기록만 있으면 이전 기록 영역을 보여주지 않는다", async () => {
    seedSessions([
      makePastSession(
        "past-1",
        "2026-09-20T03:00:00.000Z",
        [{ weight: 100, reps: 5 }],
        "스쿼트",
      ),
    ]);

    await renderOpenedSession();

    expect(screen.queryByText("이전 기록")).toBeNull();
  });

  it("현재 세션의 저장 기록은 이전 기록으로 쓰지 않고 그 전 기록을 보여준다", async () => {
    seedSessions([
      makePastSession("test-session", "2026-10-13T01:00:00.000Z", [
        { weight: 100, reps: 3 },
      ]),
      makePastSession("past-1", "2026-09-20T03:00:00.000Z", [
        { weight: 80, reps: 8 },
      ]),
    ]);

    await renderOpenedSession();

    const area = within(getPreviousRecordArea());
    expect(area.getByText("80")).toBeInTheDocument();
    expect(area.queryByText("100")).toBeNull();
  });

  it("lb 기구로 저장한 기록은 lb 단위로 표시한다", async () => {
    seedSessions([
      makePastSession("past-1", "2026-09-20T03:00:00.000Z", [
        { weight: 45.4, reps: 10, equipment: "cable-machine" },
      ]),
    ]);

    await renderOpenedSession();

    expect(within(getPreviousRecordArea()).getByText("lb")).toBeInTheDocument();
  });

  it("메모가 있는 세트만 메모 보기 버튼이 있고, 누르면 메모 전문이 시트에 보인다", async () => {
    seedSessions([
      makePastSession("past-1", "2026-09-20T03:00:00.000Z", [
        { weight: 80, reps: 8, memo: "마지막 반복이 힘들었음" },
        { weight: 85, reps: 6 },
      ]),
    ]);
    const user = await renderOpenedSession();
    expect(
      screen.queryByRole("button", { name: "세트 2 메모 전문 보기" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "세트 1 메모 전문 보기" }),
    );

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("세트 01 메모")).toBeInTheDocument();
    expect(
      within(sheet).getByText("마지막 반복이 힘들었음"),
    ).toBeInTheDocument();
  });

  it("메모 시트의 닫기를 누르면 시트가 닫힌다", async () => {
    seedSessions([
      makePastSession("past-1", "2026-09-20T03:00:00.000Z", [
        { weight: 80, reps: 8, memo: "메모" },
      ]),
    ]);
    const user = await renderOpenedSession();
    await user.click(
      screen.getByRole("button", { name: "세트 1 메모 전문 보기" }),
    );
    const sheet = await screen.findByRole("dialog");

    await user.click(within(sheet).getByRole("button", { name: "닫기" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("WorkoutSessionClient — 기구 선택", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("현재 세트의 기구가 선택돼 있다", async () => {
    await renderOpenedSession();

    expect(
      screen.getByRole("combobox", { name: "현재 세트 기구" }),
    ).toHaveDisplayValue("바벨");
  });

  it("다른 기구를 고르면 선택값이 바뀐다", async () => {
    const user = await renderOpenedSession();
    const select = screen.getByRole("combobox", { name: "현재 세트 기구" });

    await user.selectOptions(select, "dumbbell");

    expect(select).toHaveDisplayValue("덤벨");
  });

  it("기구를 바꾸면 그 기구로 저장한 이전 기록으로 표시가 바뀐다", async () => {
    seedSessions([
      makePastSession("past-dumbbell", "2026-09-25T03:00:00.000Z", [
        { weight: 30, reps: 12, equipment: "dumbbell" },
      ]),
      makePastSession("past-barbell", "2026-09-20T03:00:00.000Z", [
        { weight: 80, reps: 8, equipment: "barbell" },
      ]),
    ]);
    const user = await renderOpenedSession();

    // 현재 기구(바벨) 기록이 먼저 보인다
    let area = within(getPreviousRecordArea());
    expect(area.getByText("80")).toBeInTheDocument();
    expect(area.queryByText("30")).toBeNull();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "현재 세트 기구" }),
      "dumbbell",
    );

    area = within(getPreviousRecordArea());
    expect(area.getByText("30")).toBeInTheDocument();
    expect(area.queryByText("80")).toBeNull();
  });
});
