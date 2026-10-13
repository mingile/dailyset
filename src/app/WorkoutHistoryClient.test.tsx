import { fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "./types";
import { WorkoutHistoryClient } from "./WorkoutHistoryClient";

// 이 파일은 "세트를 스와이프했을 때 row가 어떻게 움직이고 무엇이 지워지는가"만 검증한다.
// jsdom은 레이아웃/스크롤/touch-action을 구현하지 않는다. 브라우저가 세로 스크롤을 가져가는 동작
// 자체는 확인할 수 없고, 가져갔을 때 오는 pointercancel에 row가 어떻게 반응하는지만 확인한다.

const SESSION_KEY = "workout.sessions.v1";

function makeSession(): Session {
  return {
    id: "session-1",
    savedAt: new Date().toISOString(),
    sessionName: "테스트 세션",
    exercises: [
      {
        id: "ex-bench",
        name: "벤치프레스",
        part: "가슴",
        sets: [1, 2, 3, 4].map((setNo) => ({
          setNo,
          weight: 60 + setNo * 5,
          reps: 12 - setNo,
          memo: "",
          equipment: "barbell",
        })),
      },
    ],
  };
}

function storedSetNos(): number[] {
  const sessions: Session[] = JSON.parse(
    localStorage.getItem(SESSION_KEY) ?? "[]",
  );
  return sessions.flatMap((session) =>
    session.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => set.setNo),
    ),
  );
}

// 세트 row(li)와, 실제로 움직이는 안쪽 content div
function getRow(setNo: number) {
  const row = screen.getByText(String(setNo).padStart(2, "0")).closest("li");
  if (!(row instanceof HTMLElement)) throw new Error("row를 찾지 못했습니다");
  const content = row.children[1];
  if (!(content instanceof HTMLElement)) {
    throw new Error("content를 찾지 못했습니다");
  }
  return { row, content };
}

function renderHistory() {
  const onHistoryChanged = vi.fn();
  const onRender = vi.fn();
  const { unmount } = render(
    <Profiler id="history" onRender={onRender}>
      <WorkoutHistoryClient
        showHistory
        historyVersion={0}
        selectedDate={null}
        onHistoryChanged={onHistoryChanged}
      />
    </Profiler>,
  );
  // 마운트 중 effect로 일어난 commit은 세지 않는다. 이후 포인터 동작만 센다.
  onRender.mockClear();
  return { onHistoryChanged, onRender, unmount };
}

const START_X = 300;
const START_Y = 100;

type PointerOptions = {
  y?: number;
  pointerId?: number;
  pointerType?: "touch" | "mouse" | "pen";
  button?: number;
};

function pointerInit(x: number, options: PointerOptions) {
  return {
    clientX: x,
    clientY: options.y ?? START_Y,
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? "touch",
    button: options.button ?? 0,
  };
}

function pointerDown(
  row: HTMLElement,
  x = START_X,
  options: PointerOptions = {},
) {
  fireEvent.pointerDown(row, pointerInit(x, options));
}

function pointerMove(
  row: HTMLElement,
  x: number,
  options: PointerOptions = {},
) {
  fireEvent.pointerMove(row, pointerInit(x, options));
}

function pointerUp(row: HTMLElement, x?: number, options: PointerOptions = {}) {
  fireEvent.pointerUp(row, pointerInit(x ?? START_X, options));
}

// 삭제가 확정되면 row가 접히고, 접힘이 끝난 뒤(transitionend)에 실제로 지운다.
// jsdom은 transition을 실행하지 않으므로 끝났다는 이벤트를 직접 보낸다.
function finishCollapse(row: HTMLElement) {
  fireEvent.transitionEnd(row);
}

function swipeLeft(
  row: HTMLElement,
  distance: number,
  options: PointerOptions = {},
) {
  pointerDown(row, START_X, options);
  pointerMove(row, START_X - distance, options);
  pointerUp(row, START_X - distance, options);
}

describe("WorkoutHistoryClient — 세트 스와이프", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SESSION_KEY, JSON.stringify([makeSession()]));
  });

  it("드래그하는 동안 React가 다시 렌더링하지 않는다", () => {
    const { onRender } = renderHistory();
    const { row } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 30);
    pointerMove(row, START_X - 80);
    pointerMove(row, START_X - 120);
    pointerMove(row, START_X - 10);

    expect(onRender).not.toHaveBeenCalled();
  });

  it("손가락을 따라 움직이고 왼쪽 -100px에서 멈춘다", () => {
    renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 50);
    expect(content.style.transform).toBe("translateX(-50px)");

    pointerMove(row, START_X - 150);
    expect(content.style.transform).toBe("translateX(-100px)");
  });

  it("오른쪽으로 되돌리면 row도 같이 돌아오고 시작점을 넘어서 밀리지 않는다", () => {
    renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 80);
    expect(content.style.transform).toBe("translateX(-80px)");

    pointerMove(row, START_X - 30);
    expect(content.style.transform).toBe("translateX(-30px)");

    pointerMove(row, START_X + 100);
    expect(content.style.transform).toBe("translateX(0px)");
  });

  it("드래그 중에는 transition이 꺼져 있고, 덜 끌고 놓으면 애니메이션과 함께 원위치로 돌아온다", () => {
    renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 40);
    expect(content.style.transition).toBe("none");

    pointerUp(row, START_X - 40);
    expect(content.style.transform).toBe("translateX(0px)");
    expect(content.style.transition).toContain("150ms");
  });

  it("덜 끌고 놓으면 세트를 지우지 않는다", () => {
    const { onHistoryChanged } = renderHistory();

    swipeLeft(getRow(2).row, 40);

    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("충분히 끌고 놓으면 해당 세트만 지우고 변경을 알린다", () => {
    const { onHistoryChanged } = renderHistory();

    const { row } = getRow(2);
    swipeLeft(row, 80);
    finishCollapse(row);

    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("삭제 기준은 -50px 초과다", () => {
    renderHistory();

    swipeLeft(getRow(1).row, 50);
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);

    const { row } = getRow(1);
    swipeLeft(row, 51);
    finishCollapse(row);
    expect(storedSetNos()).toEqual([2, 3, 4]);
  });

  it("누르지 않은 row의 move/up은 무시한다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(3);

    pointerMove(row, START_X - 100);
    pointerUp(row, START_X - 100);

    expect(content.style.transform).not.toBe("translateX(-100px)");
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });
});

describe("WorkoutHistoryClient — 제스처 안정화", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SESSION_KEY, JSON.stringify([makeSession()]));
  });

  it("브라우저에 세로 스크롤을 허용하도록 touch-action: pan-y가 걸려 있다", () => {
    renderHistory();

    expect(getRow(2).row).toHaveClass("touch-pan-y");
  });

  it("세로로 먼저 움직이면 그 제스처에서는 가로로 밀리지 않고 삭제되지도 않는다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 3, { y: START_Y + 40 });
    // 세로로 정해진 뒤에는 가로로 크게 움직여도 따라가지 않는다.
    pointerMove(row, START_X - 120, { y: START_Y + 40 });
    expect(content.style.transform).toBe("translateX(0px)");

    pointerUp(row, START_X - 120, { y: START_Y + 40 });
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("방향이 정해지기 전의 아주 작은 움직임에는 반응하지 않는다", () => {
    renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 5);
    expect(content.style.transform).toBe("translateX(0px)");

    pointerMove(row, START_X - 50);
    expect(content.style.transform).toBe("translateX(-50px)");
  });

  it("제스처가 취소되면 삭제 없이 원위치로 돌아오고, 이후 스와이프는 정상 동작한다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 80);
    fireEvent.pointerCancel(row, pointerInit(START_X - 80, {}));

    expect(content.style.transform).toBe("translateX(0px)");
    expect(content.style.transition).toContain("150ms");

    // 취소 뒤에 늦게 도착한 up은 삭제로 이어지지 않는다.
    pointerUp(row, START_X - 80);
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();

    swipeLeft(row, 80);
    finishCollapse(row);
    expect(storedSetNos()).toEqual([1, 3, 4]);
  });

  it("마우스 오른쪽 버튼으로는 스와이프가 시작되지 않는다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);
    const mouse = { pointerType: "mouse", button: 2 } as const;

    pointerDown(row, START_X, mouse);
    pointerMove(row, START_X - 80, mouse);
    pointerUp(row, START_X - 80, mouse);

    expect(content.style.transform).not.toBe("translateX(-80px)");
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("마우스 왼쪽 버튼으로도 같은 방식으로 지울 수 있다", () => {
    renderHistory();

    const { row } = getRow(2);
    swipeLeft(row, 80, { pointerType: "mouse" });
    finishCollapse(row);

    expect(storedSetNos()).toEqual([1, 3, 4]);
  });

  it("끄는 도중 포인터가 row를 벗어나면 삭제 없이 원위치로 돌아온다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);
    const mouse = { pointerType: "mouse" } as const;

    pointerDown(row, START_X, mouse);
    pointerMove(row, START_X - 80, mouse);
    fireEvent.pointerLeave(row, pointerInit(START_X - 80, mouse));

    expect(content.style.transform).toBe("translateX(0px)");

    pointerUp(row, START_X - 80, mouse);
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("처음 누른 포인터가 아닌 다른 손가락의 움직임은 무시한다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);

    pointerDown(row, START_X, { pointerId: 1 });
    pointerMove(row, START_X - 80, { pointerId: 2 });
    pointerUp(row, START_X - 80, { pointerId: 2 });

    expect(content.style.transform).toBe("translateX(0px)");
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("취소/세로 제스처 중에도 React가 다시 렌더링하지 않는다", () => {
    const { onRender } = renderHistory();
    const { row } = getRow(2);

    pointerDown(row);
    pointerMove(row, START_X - 3, { y: START_Y + 40 });
    pointerMove(row, START_X - 100, { y: START_Y + 40 });
    fireEvent.pointerCancel(row, pointerInit(START_X - 100, {}));

    expect(onRender).not.toHaveBeenCalled();
  });
});

describe("WorkoutHistoryClient — 삭제 연출", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(SESSION_KEY, JSON.stringify([makeSession()]));
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  function setReducedMotion(reduced: boolean) {
    window.matchMedia = ((query: string) => ({
      ...originalMatchMedia(query),
      matches: reduced && query.includes("prefers-reduced-motion"),
    })) as typeof window.matchMedia;
  }

  it("삭제가 확정되면 row를 접기 시작하지만, 접힘이 끝나기 전에는 지우지 않는다", () => {
    const { onHistoryChanged, onRender } = renderHistory();
    const { row, content } = getRow(2);

    swipeLeft(row, 80);

    expect(row.style.height).toBe("0px");
    expect(row.style.transition).toContain("height");
    // 접히는 동안 content는 되돌아가지 않고 밀린 자리에 있다.
    expect(content.style.transform).toBe("translateX(-80px)");
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
    expect(onRender).not.toHaveBeenCalled();
  });

  it("접힘이 끝나면 해당 세트만 지운다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row } = getRow(2);

    swipeLeft(row, 80);
    finishCollapse(row);

    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("row 안쪽 content의 transition 종료는 접힘 종료로 취급하지 않는다", () => {
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);

    swipeLeft(row, 80);
    fireEvent.transitionEnd(content);

    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("transitionend가 오지 않아도 여유 시간이 지나면 지운다", () => {
    vi.useFakeTimers();
    const { onHistoryChanged } = renderHistory();

    swipeLeft(getRow(2).row, 80);
    vi.advanceTimersByTime(299);
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);

    vi.advanceTimersByTime(1);
    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("접히는 도중에 다시 건드려도 중복으로 지우지 않는다", () => {
    vi.useFakeTimers();
    const { onHistoryChanged } = renderHistory();
    const { row, content } = getRow(2);

    swipeLeft(row, 80);
    // 접히는 중에 다른 거리로 스와이프를 시도해도 시작되지 않아 content가 그대로 있다.
    swipeLeft(row, 30);
    expect(content.style.transform).toBe("translateX(-80px)");
    expect(content.style.transition).toBe("none");

    finishCollapse(row);
    finishCollapse(row);
    vi.advanceTimersByTime(1000);

    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("접히는 도중 화면이 닫혀 unmount되어도 확정한 삭제는 지운다", () => {
    const { onHistoryChanged, unmount } = renderHistory();

    swipeLeft(getRow(2).row, 80);
    expect(storedSetNos()).toEqual([1, 2, 3, 4]);

    unmount();

    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("삭제 확정 전에 unmount되면 아무것도 지우지 않는다", () => {
    const { onHistoryChanged, unmount } = renderHistory();
    const { row } = getRow(2);

    swipeLeft(row, 40);
    unmount();

    expect(storedSetNos()).toEqual([1, 2, 3, 4]);
    expect(onHistoryChanged).not.toHaveBeenCalled();
  });

  it("움직임 줄이기 설정이면 접지 않고 바로 지운다", () => {
    setReducedMotion(true);
    const { onHistoryChanged } = renderHistory();
    const { row } = getRow(2);

    swipeLeft(row, 80);

    expect(row.style.height).toBe("");
    expect(storedSetNos()).toEqual([1, 3, 4]);
    expect(onHistoryChanged).toHaveBeenCalledTimes(1);
  });

  it("움직임 줄이기 설정이 아니면 접는다", () => {
    setReducedMotion(false);
    renderHistory();
    const { row } = getRow(2);

    swipeLeft(row, 80);

    expect(row.style.height).toBe("0px");
  });
});
