import { describe, expect, it } from "vitest";
import { convertInputToKg, kgToLb, lbToKg, nextWeight } from "./weightUnit";

describe("convertInputToKg", () => {
  it("kg 입력값을 소수점 1자리로 정규화한다", () => {
    expect(convertInputToKg("10", "kg")).toBe(10);
    expect(convertInputToKg("10.25", "kg")).toBe(10.3);
  });

  it("kg 입력값이 음수면 null을 반환한다", () => {
    expect(convertInputToKg("-1", "kg")).toBe(null);
  });

  it("kg 입력값이 숫자가 아니면 null을 반환한다", () => {
    expect(convertInputToKg("abc", "kg")).toBe(null);
    expect(convertInputToKg("", "kg")).toBe(null);
  });
  it("lb 입력값을 kg로 변환한 뒤 소수점 1자리로 정규화한다", () => {
    expect(convertInputToKg("10", "lb")).toBe(4.5);
    expect(convertInputToKg("11", "lb")).toBe(5);
  });

  it("lb 입력값이 음수면 null을 반환한다", () => {
    expect(convertInputToKg("-1", "lb")).toBe(null);
  });

  it("lb 입력값이 숫자가 아니면 null을 반환한다", () => {
    expect(convertInputToKg("abc", "lb")).toBe(null);
    expect(convertInputToKg("", "lb")).toBe(null);
  });
  it("소수 lb 입력은 먼저 정수 lb로 반올림한 뒤 kg로 변환한다", () => {
    expect(convertInputToKg("10.5", "lb")).toBe(5);
    expect(convertInputToKg("11.5", "lb")).toBe(5.4);
  });
});

describe("nextWeight", () => {
  //dumbbell
  it("kg 단위 장비는 kg step만큼 증가한다", () => {
    expect(nextWeight(10, "dumbbell", "increase")).toBe(11);
  });
  it("kg 단위 장비는 kg step만큼 감소한다", () => {
    expect(nextWeight(10, "dumbbell", "decrease")).toBe(9);
  });

  //cable-machine
  it("lb 단위 장비는 lb step만큼 증가한다", () => {
    const weightKg = lbToKg(10);
    // nextWeight는 결과를 0.1kg 단위로 반올림한다
    expect(nextWeight(weightKg, "cable-machine", "increase")).toBe(
      Math.round(lbToKg(20) * 10) / 10,
    );
  });
  it("lb 단위 장비는 lb step만큼 감소한다", () => {
    const weightKg = lbToKg(10);
    expect(nextWeight(weightKg, "cable-machine", "decrease")).toBe(0);
  });
  //barbell
  it("2.5kg씩 증가한다", () => {
    expect(nextWeight(10, "barbell", "increase")).toBe(12.5);
  });

  it("2.5kg씩 감소한다", () => {
    expect(nextWeight(10, "barbell", "decrease")).toBe(7.5);
  });
  //plate-machine
  it("2.5kg씩 증가한다", () => {
    expect(nextWeight(10, "plate-machine", "increase")).toBe(12.5);
  });

  it("2.5kg씩 감소한다", () => {
    expect(nextWeight(10, "plate-machine", "decrease")).toBe(7.5);
  });
  //smith-machine
  it("2.5kg씩 증가한다", () => {
    expect(nextWeight(10, "smith-machine", "increase")).toBe(12.5);
  });

  it("2.5kg씩 감소한다", () => {
    expect(nextWeight(10, "smith-machine", "decrease")).toBe(7.5);
  });
  //default
  it("감소 결과가 0보다 작으면 0을 반환한다", () => {
    expect(nextWeight(0, "dumbbell", "decrease")).toBe(0);
  });
});
