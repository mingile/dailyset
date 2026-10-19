import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissSwipeHint,
  SWIPE_HINT_DISMISS_KEY,
  shouldShowSwipeHint,
} from "./swipe-hint";

const SESSIONS_KEY = "workout.sessions.v1";

// node 환경이라 window와 localStorage를 직접 흉내 낸다.
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  });
  return store;
}

describe("shouldShowSwipeHint", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("저장된 데이터가 전혀 없으면 보여준다", () => {
    stubStorage();
    expect(shouldShowSwipeHint()).toBe(true);
  });

  it("세션 기록이 빈 배열이어도 보여준다", () => {
    stubStorage({ [SESSIONS_KEY]: "[]" });
    expect(shouldShowSwipeHint()).toBe(true);
  });

  it("세션 기록이 깨져 있으면 기록이 없는 것으로 보고 보여준다", () => {
    stubStorage({ [SESSIONS_KEY]: "{not json" });
    expect(shouldShowSwipeHint()).toBe(true);
  });

  it("세션 기록이 하나라도 있으면 보여주지 않는다", () => {
    stubStorage({ [SESSIONS_KEY]: JSON.stringify([{ id: "s1" }]) });
    expect(shouldShowSwipeHint()).toBe(false);
  });

  it("이미 확인한 적이 있으면 기록이 없어도 보여주지 않는다", () => {
    stubStorage({ [SWIPE_HINT_DISMISS_KEY]: "true" });
    expect(shouldShowSwipeHint()).toBe(false);
  });

  it("저장소를 읽지 못하면 보여주지 않는다", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(shouldShowSwipeHint()).toBe(false);
  });

  it("브라우저가 아니면 보여주지 않는다", () => {
    expect(shouldShowSwipeHint()).toBe(false);
  });
});

describe("dismissSwipeHint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("확인 표시를 저장하고 이후로는 보여주지 않는다", () => {
    const store = stubStorage();

    dismissSwipeHint();

    expect(store.get(SWIPE_HINT_DISMISS_KEY)).toBe("true");
    expect(shouldShowSwipeHint()).toBe(false);
  });

  it("저장소에 쓰지 못해도 에러를 던지지 않는다", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => dismissSwipeHint()).not.toThrow();
  });
});
