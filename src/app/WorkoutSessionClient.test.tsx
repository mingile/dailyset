import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSessionExercises } from "@/hooks/useSessionExercises";
import { kgToLb } from "@/lib/weightUnit";
import type { Exercises, ExerciseTimers, SessionMetadata } from "./types";
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
      targetMainSetCount: 3,
      targetWarmupSetCount: 0,
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
}: {
  onCompleteWorkout?: () => void;
  saving?: boolean;
  hideSessionActions?: boolean;
}) {
  const { exercises, actions } = useSessionExercises(makeExercises());
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});

  return (
    <WorkoutSessionClient
      exercises={exercises}
      displayWeightUnit={displayWeightUnit}
      actions={actions}
      sessionMetadata={SESSION_METADATA}
      exerciseTimers={exerciseTimers}
      onExerciseTimersChange={setExerciseTimers}
      onCompleteWorkout={onCompleteWorkout}
      saving={saving}
      hideSessionActions={hideSessionActions}
    />
  );
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

  it("기본 상태에서는 운동 추가 버튼이 보인다", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: /운동 추가/ }),
    ).toBeInTheDocument();
  });
});
