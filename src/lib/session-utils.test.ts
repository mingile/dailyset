import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionMetadata,
  generateSessionId,
  generateSessionName,
} from "./session-utils";

// generateSessionName은 로컬 시간 기준이라 타임존에 따라 결과가 달라진다.
// 기대값은 로컬 시각으로 만든 Date에서 직접 조립해 실행 환경과 무관하게 한다.
function localIso(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
) {
  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

describe("generateSessionName", () => {
  it("customName이 있으면 앞뒤 공백을 제거해 그대로 쓴다", () => {
    expect(
      generateSessionName(localIso(2026, 10, 13, 9, 5), "  가슴 운동  "),
    ).toBe("가슴 운동");
  });

  it("customName이 없으면 'YYYY-MM-DD HH:mm 세션' 형식의 로컬 시간 이름이다", () => {
    expect(generateSessionName(localIso(2026, 10, 13, 9, 5))).toBe(
      "2026-10-13 09:05 세션",
    );
  });

  it("월·일·시·분이 한 자리면 0으로 채운다", () => {
    expect(generateSessionName(localIso(2026, 1, 2, 3, 4))).toBe(
      "2026-01-02 03:04 세션",
    );
  });

  it("customName이 빈 문자열이거나 공백뿐이면 날짜 이름으로 대체한다", () => {
    const startedAt = localIso(2026, 10, 13, 18, 30);

    expect(generateSessionName(startedAt, "")).toBe("2026-10-13 18:30 세션");
    expect(generateSessionName(startedAt, "   ")).toBe("2026-10-13 18:30 세션");
  });
});

describe("generateSessionId", () => {
  it("'sess_' 뒤에 소문자·숫자 16자가 붙는다", () => {
    expect(generateSessionId()).toMatch(/^sess_[a-z0-9]{16}$/);
  });

  it("호출할 때마다 다른 값을 만든다", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));

    expect(ids.size).toBe(20);
  });
});

describe("createSessionMetadata", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("현재 시각을 startedAt으로 쓰고 이름을 날짜 형식으로 만든다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 13, 7, 45));

    const metadata = createSessionMetadata();

    expect(metadata.startedAt).toBe(new Date(2026, 9, 13, 7, 45).toISOString());
    expect(metadata.sessionName).toBe("2026-10-13 07:45 세션");
    expect(metadata.sessionId).toMatch(/^sess_[a-z0-9]{16}$/);
  });

  it("customName을 sessionName에 반영한다", () => {
    expect(createSessionMetadata("하체 데이").sessionName).toBe("하체 데이");
  });
});
