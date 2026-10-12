import { describe, expect, it } from "vitest";
import { parseSessionIdsParam, toReason } from "./syncJobs";

describe("parseSessionIdsParam", () => {
  it("빈 값이면 빈 배열", () => {
    expect(parseSessionIdsParam(null)).toEqual([]);
    expect(parseSessionIdsParam("")).toEqual([]);
    expect(parseSessionIdsParam(" , ,")).toEqual([]);
  });

  it("쉼표로 나누고 공백·중복을 제거한다", () => {
    expect(parseSessionIdsParam("a, b,a ,c")).toEqual(["a", "b", "c"]);
  });

  it("최대 50개까지만 허용한다", () => {
    const ids = Array.from({ length: 80 }, (_, i) => `s${i}`).join(",");
    expect(parseSessionIdsParam(ids)).toHaveLength(50);
  });
});

describe("toReason", () => {
  it("Error는 message를, 그 외는 문자열로 바꾼다", () => {
    expect(toReason(new Error("boom"))).toBe("boom");
    expect(toReason("plain")).toBe("plain");
  });

  it("300자로 자른다", () => {
    expect(toReason(new Error("x".repeat(500)))).toHaveLength(300);
  });
});
