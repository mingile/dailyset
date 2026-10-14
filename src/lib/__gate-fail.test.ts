import { expect, it } from "vitest";

// CI gate 검증용 임시 테스트: 의도적 실패
it("fails on purpose", () => {
  expect(1).toBe(2);
});
