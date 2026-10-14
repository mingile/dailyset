import { Check } from "lucide-react";

/**
 * 운동 선택 목록의 한 행: 번호 + 이름/부제 + 체크 원, 선택되면 accent 하이라이트.
 * 선택 상태는 부모가 가지고, 이 컴포넌트는 그리기와 클릭 전달만 한다.
 * 하이라이트가 화면 좌우 여백(px-4)까지 덮도록 부모는 `px-4` 안에 행을 놓아야 한다.
 */
export function ExerciseRow({
  exercise,
  index,
  isSelected,
  onToggle,
}: {
  exercise: { name: string; equipment?: string; primaryEffect?: string };
  index: number;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const subtitle = [exercise.equipment, exercise.primaryEffect]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={onToggle}
      className="relative flex min-h-14 w-full items-center gap-3 border-b border-border py-2 text-left"
    >
      {isSelected && (
        <>
          <span className="pointer-events-none absolute inset-0 -mx-4 bg-(--session-accent)/20" />
          <span className="pointer-events-none absolute inset-y-0 -left-4 w-1 bg-(--session-accent)" />
        </>
      )}
      <span
        className={`relative w-6 shrink-0 text-sm tabular-nums ${isSelected ? "font-bold" : "text-muted-foreground"}`}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="relative h-6 shrink-0 border-l border-border" />
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-lg font-bold tracking-tight">
          {exercise.name}
        </span>
        {subtitle && (
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      <span
        className={`relative flex size-7 shrink-0 items-center justify-center rounded-full border ${
          isSelected
            ? "border-foreground bg-foreground text-background"
            : "border-border"
        }`}
      >
        {isSelected && <Check className="size-4" />}
      </span>
    </button>
  );
}
