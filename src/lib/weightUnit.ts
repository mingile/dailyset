export const KG_TO_LB = 2.20462;

export function kgToLb(kg: number) {
  return kg * KG_TO_LB;
}

export function lbToKg(lb: number) {
  return lb / KG_TO_LB;
}

export function convertInputToKg(
  value: string,
  unit: "kg" | "lb",
): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  if (unit === "kg") {
    const normalizedKg = Math.round(parsed * 10) / 10;
    if (normalizedKg < 0) return null;
    return normalizedKg;
  }

  const normalizedLb = Math.round(parsed);
  if (normalizedLb < 0) return null;
  return Math.round(lbToKg(normalizedLb) * 10) / 10;
}

export function nextWeight(
  weight: number,
  equipment: string,
  direction: "increase" | "decrease",
) {
  const { unit, step, stepUnit } = ruleDecision(equipment);
  let delta = 0;
  if (stepUnit === "kg") {
    delta = direction === "increase" ? step : -step;
  } else {
    delta = direction === "increase" ? lbToKg(step) : -lbToKg(step);
  }
  if (weight + delta < 0) return 0;
  return Math.round((weight + delta) * 10) / 10;
}

export function ruleDecision(equipment: string): {
  unit: "kg" | "lb";
  step: number;
  stepUnit: "kg" | "lb";
} {
  let unit = "kg";
  let step = 0;
  let stepUnit = "kg";
  switch (equipment) {
    case "cable-machine":
      unit = "lb";
      step = 10;
      stepUnit = "lb";
      break;
    case "plate-machine":
      unit = "kg";
      step = 2.5;
      stepUnit = "kg";
      break;
    case "barbell":
      unit = "kg";
      step = 2.5;
      stepUnit = "kg";
      break;
    case "dumbbell":
      unit = "kg";
      step = 1;
      stepUnit = "kg";
      break;
    case "smith-machine":
      unit = "kg";
      step = 2.5;
      stepUnit = "kg";
      break;
    default:
      unit = "kg";
      step = 5;
      stepUnit = "kg";
      break;
  }
  return {
    unit: unit as "kg" | "lb",
    step,
    stepUnit: stepUnit as "kg" | "lb",
  };
}
