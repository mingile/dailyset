"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Exercises,
  SessionMetadata,
  Exercise,
  SetItem,
  Session,
  ExerciseTimers,
} from "./types";
import { useEffect, useState, useRef } from "react";
import {
  TrashIcon,
  Plus,
  CheckCircle2,
  Check,
  ChevronDown,
} from "lucide-react";
import { convertInputToKg } from "@/lib/weightUnit";
import { useExerciseLibrary } from "@/hooks/useExerciseLibrary";
import { groupExercisesByCategory } from "@/lib/library";
import { getPreviousRecord, createDefaultSet } from "@/lib/previous-record";
import { useTimerTick } from "@/hooks/useTimerTick";
import {
  createRunningExerciseTimer,
  getExerciseElapsedSeconds,
  pauseExerciseTimer,
  resumeExerciseTimer,
} from "@/lib/timer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const EQUIPMENT_LABELS: Record<string, string> = {
  "cable-machine": "케이블 머신",
  "smith-machine": "스미스 머신",
  "plate-machine": "원판 머신",
  barbell: "바벨",
  dumbbell: "덤벨",
};

const SET_ROW_GRID = "grid-cols-[2.75rem_4rem_minmax(0,1fr)_4rem_2.75rem]";

function parseRepsInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function getCompletedSetCount(exercise: Exercise): number {
  return exercise.sets.filter((set) => set.done).length;
}

function isExerciseCompleted(exercise: Exercise): boolean {
  return exercise.sets.length > 0 && exercise.sets.every((set) => set.done);
}

function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function WorkoutSessionClient({
  exercises,
  displayWeightUnit,
  addSet,
  changeWeight,
  changeReps,
  toggleDone,
  changeMemo,
  deleteSet,
  changeEquipment,
  changeUnit,
  changeSetType,
  sessionMetadata,
  exerciseTimers,
  onExerciseTimersChange,
  addExercisesToSession,
  onSave,
  onCompleteWorkout,
  onStartNewSession,
  saving,
  hideSessionActions = false,
}: {
  exercises: Exercises;
  displayWeightUnit: (
    weight: number,
    unit: "kg" | "lb",
  ) => { displayWeight: number; displayUnit: "kg" | "lb" };
  nextWeight: (
    weight: number,
    equipment: string,
    direction: "increase" | "decrease",
  ) => number;
  addSet: (exIdx: number) => void;
  changeWeight: (exIdx: number, setIdx: number, nextWeight: number) => void;
  changeReps: (exIdx: number, setIdx: number, delta: number) => void;
  toggleDone: (exIdx: number, setIdx: number) => void;
  changeMemo: (exIdx: number, setIdx: number, value: string) => void;
  deleteSet: (exId: string, setIdx: number) => void;
  changeEquipment: (exIdx: number, setIdx: number, equipment: string) => void;
  changeUnit: (exIdx: number, setIdx: number, unit: "kg" | "lb") => void;
  changeSetType: (
    exIdx: number,
    setIdx: number,
    setType: "warmup" | "main",
  ) => void;
  changeTargetMainSetCount: (exIdx: number, delta: number) => void;
  changeTargetWarmupSetCount: (exIdx: number, delta: number) => void;
  sessionMetadata: SessionMetadata | null;
  exerciseTimers: ExerciseTimers;
  onExerciseTimersChange: (
    updater: (prev: ExerciseTimers) => ExerciseTimers,
  ) => void;
  addExercisesToSession: (newExercises: Exercises) => void;
  onSave: () => void;
  onCompleteWorkout: () => void;
  onStartNewSession: () => void;
  saving: boolean;
  hideSessionActions?: boolean;
}) {
  const [isAddExerciseSheetOpen, setIsAddExerciseSheetOpen] = useState(false);
  const [openAccordionIndex, setOpenAccordionIndex] = useState<number | null>(
    null,
  );
  const autoCollapsedExercisesRef = useRef<Set<string>>(new Set());
  const prevActiveExerciseIdRef = useRef<string | null>(null);

  const activeExerciseId =
    openAccordionIndex === null
      ? null
      : (exercises[openAccordionIndex]?.id ?? null);

  useTimerTick(activeExerciseId !== null);

  const displayElapsedSeconds: Record<string, number> = {};
  for (const [exerciseId, timerState] of Object.entries(exerciseTimers)) {
    displayElapsedSeconds[exerciseId] = getExerciseElapsedSeconds(timerState);
  }

  useEffect(() => {
    const prevActiveExerciseId = prevActiveExerciseIdRef.current;
    if (prevActiveExerciseId === activeExerciseId) return;

    onExerciseTimersChange((prev) => {
      let changed = false;
      const next = { ...prev };

      if (
        prevActiveExerciseId &&
        next[prevActiveExerciseId]?.status === "running"
      ) {
        next[prevActiveExerciseId] = pauseExerciseTimer(
          next[prevActiveExerciseId],
        );
        changed = true;
      }

      if (activeExerciseId) {
        const existing = next[activeExerciseId];
        if (existing) {
          if (existing.status !== "running") {
            next[activeExerciseId] = resumeExerciseTimer(existing);
            changed = true;
          }
        } else {
          next[activeExerciseId] = createRunningExerciseTimer();
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    prevActiveExerciseIdRef.current = activeExerciseId;
  }, [activeExerciseId, onExerciseTimersChange]);

  useEffect(() => {
    exercises.forEach((ex, i) => {
      const completed = isExerciseCompleted(ex);
      const wasAutoCollapsed = autoCollapsedExercisesRef.current.has(ex.id);

      if (completed && !wasAutoCollapsed) {
        autoCollapsedExercisesRef.current.add(ex.id);
        if (openAccordionIndex === i) {
          setOpenAccordionIndex(null);
        }
      } else if (!completed && wasAutoCollapsed) {
        autoCollapsedExercisesRef.current.delete(ex.id);
      }
    });
  }, [exercises, openAccordionIndex]);

  function changeSetTotal(exIdx: number, ex: Exercise, draft: string) {
    const nextTotal = parseRepsInput(draft);
    if (nextTotal === null || nextTotal < 1) return;

    const currentTotal = ex.sets.length;
    if (nextTotal > currentTotal) {
      for (let count = currentTotal; count < nextTotal; count++) {
        addSet(exIdx);
      }
      return;
    }

    let removable = currentTotal - nextTotal;
    let remaining = currentTotal;
    for (let idx = currentTotal - 1; idx >= 0; idx--) {
      if (removable <= 0 || remaining <= 1 || ex.sets[idx].done) break;
      deleteSet(ex.id, idx);
      removable--;
      remaining--;
    }
  }

  return (
    <main className="session-font px-4 py-2 space-y-2">
      <div className="border-t border-border">
        {exercises.map((ex, i) => {
          const completed = isExerciseCompleted(ex);
          const completedCount = getCompletedSetCount(ex);
          const targetCount = ex.sets.length;
          const isActive = openAccordionIndex === i;
          const currentSetIndex = ex.sets.findIndex((set) => !set.done);
          const allSetsDone = ex.sets.length > 0 && currentSetIndex === -1;
          const setTotal = ex.sets.length;
          const currentSetIdx = allSetsDone
            ? ex.sets.length - 1
            : currentSetIndex;
          const currentSet =
            ex.sets.length === 0 ? null : ex.sets[currentSetIdx];
          const currentDisplay = currentSet
            ? displayWeightUnit(currentSet.weight, currentSet.unit)
            : null;
          return (
            <Accordion
              key={ex.id}
              type="single"
              collapsible
              value={isActive ? `item-${i}` : ""}
              onValueChange={(val) =>
                setOpenAccordionIndex(val === `item-${i}` ? i : null)
              }
            >
              <AccordionItem
                value={`item-${i}`}
                className="border-b border-border last:border-b"
              >
                <AccordionTrigger
                  className={`min-w-0 hover:no-underline ${isActive ? "items-start pb-1 pt-5" : "items-center py-4"}`}
                >
                  {isActive ? (
                    <div className="flex w-full min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm tabular-nums text-muted-foreground">
                          {String(i + 1).padStart(2, "0")} /{" "}
                          {String(exercises.length).padStart(2, "0")}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="break-words text-3xl font-bold leading-tight tracking-tight">
                            {ex.name}
                          </span>
                          {completed && (
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                          )}
                        </div>
                      </div>
                      {displayElapsedSeconds[ex.id] !== undefined &&
                        displayElapsedSeconds[ex.id] > 0 && (
                          <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">
                            {formatElapsedTime(displayElapsedSeconds[ex.id])}
                          </span>
                        )}
                    </div>
                  ) : (
                    <div className="flex w-full min-w-0 items-center gap-3">
                      <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="h-6 shrink-0 border-l border-border" />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate text-lg font-bold tracking-tight">
                          {ex.name}
                        </span>
                        {completed && (
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                        )}
                      </div>
                      <span className="shrink-0 text-sm tabular-nums uppercase tracking-wider text-muted-foreground">
                        {completedCount} / {targetCount} SETS
                      </span>
                    </div>
                  )}
                </AccordionTrigger>

                {isActive && (
                  <div className="flex items-center gap-1 pb-4 text-sm text-muted-foreground">
                    <select
                      aria-label="현재 세트 기구"
                      disabled={!currentSet}
                      className="-my-2 field-sizing-content cursor-pointer appearance-none rounded-none border-0 bg-transparent py-2 text-sm text-muted-foreground underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={currentSet?.equipment ?? ""}
                      onChange={(e) =>
                        changeEquipment(i, currentSetIdx, e.target.value)
                      }
                    >
                      <option value="">기구 선택</option>
                      {Object.entries(EQUIPMENT_LABELS).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    {ex.part && (
                      <>
                        <span>·</span>
                        <span>{ex.part}</span>
                      </>
                    )}
                  </div>
                )}

                <AccordionContent className="pb-3">
                  <div className="mb-4 border-b border-border pb-4">
                    <div className="grid grid-cols-[1.3fr_1fr_1fr] items-end">
                      <div className="min-w-0 pr-2">
                        <InlineNumberField
                          value={
                            currentDisplay
                              ? String(currentDisplay.displayWeight)
                              : "—"
                          }
                          inputMode="decimal"
                          disabled={!currentSet}
                          ariaLabel="현재 세트 무게"
                          className={`text-[2.75rem] font-bold leading-none tabular-nums ${allSetsDone ? "text-muted-foreground" : ""}`}
                          onCommit={(draft) => {
                            if (!currentSet) return;
                            const kg = convertInputToKg(draft, currentSet.unit);
                            if (kg === null) return;
                            changeWeight(i, currentSetIdx, kg);
                          }}
                        />
                        <button
                          type="button"
                          disabled={!currentSet}
                          aria-label="무게 단위 전환"
                          className="-mb-2 block w-full py-2 text-left text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground"
                          onClick={() => {
                            if (!currentSet) return;
                            changeUnit(
                              i,
                              currentSetIdx,
                              currentSet.unit === "kg" ? "lb" : "kg",
                            );
                          }}
                        >
                          <span className="underline decoration-dotted underline-offset-4">
                            {currentDisplay?.displayUnit ?? "kg"}
                          </span>
                        </button>
                      </div>
                      <div className="min-w-0 border-l border-border px-2">
                        <InlineNumberField
                          value={currentSet ? String(currentSet.reps) : "—"}
                          inputMode="numeric"
                          disabled={!currentSet}
                          ariaLabel="현재 세트 횟수"
                          className={`text-[2.75rem] font-bold leading-none tabular-nums ${allSetsDone ? "text-muted-foreground" : ""}`}
                          onCommit={(draft) => {
                            if (!currentSet) return;
                            const nextReps = parseRepsInput(draft);
                            if (nextReps === null) return;
                            changeReps(
                              i,
                              currentSetIdx,
                              nextReps - currentSet.reps,
                            );
                          }}
                        />
                        <div className="mt-2 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                          reps
                        </div>
                      </div>
                      <div className="min-w-0 border-l border-border pl-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">
                            set
                          </span>
                          <button
                            type="button"
                            aria-label="세트 추가"
                            className="-my-1 flex size-9 items-center justify-center rounded-full border border-border"
                            onClick={() => addSet(i)}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                        <div className="mt-1 flex items-center whitespace-nowrap text-lg font-bold tabular-nums">
                          {currentSet ? (
                            <>
                              <span
                                className={
                                  allSetsDone
                                    ? "text-muted-foreground"
                                    : "rounded-sm bg-(--session-accent) px-1 text-zinc-900"
                                }
                              >
                                {String(
                                  allSetsDone
                                    ? ex.sets.length
                                    : currentSetIndex + 1,
                                ).padStart(2, "0")}
                              </span>
                              <span className="px-1 text-muted-foreground">
                                /
                              </span>
                              <div className="min-w-0 flex-1 text-muted-foreground">
                                <InlineNumberField
                                  value={String(setTotal).padStart(2, "0")}
                                  inputMode="numeric"
                                  hint
                                  ariaLabel="목표 세트 수"
                                  className="py-1 text-lg font-bold tabular-nums"
                                  onCommit={(draft) =>
                                    changeSetTotal(i, ex, draft)
                                  }
                                />
                              </div>
                            </>
                          ) : (
                            "—"
                          )}
                        </div>
                      </div>
                    </div>
                    <input
                      type="text"
                      aria-label="현재 세트 메모"
                      disabled={!currentSet}
                      className="mt-4 w-full rounded-none border-0 border-b-2 border-transparent bg-transparent py-2 text-sm outline-none focus:border-(--session-accent)"
                      value={currentSet?.memo ?? ""}
                      onChange={(e) =>
                        changeMemo(i, currentSetIdx, e.target.value)
                      }
                      placeholder="세트 메모"
                    />
                  </div>
                  <div>
                    <div
                      className={`grid ${SET_ROW_GRID} gap-1 px-1 pb-1 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground`}
                    >
                      <span className="pl-2">Set</span>
                      <span />
                      <span>Weight</span>
                      <span>Reps</span>
                      <span className="text-center">Done</span>
                    </div>
                    <div className="border-t border-border">
                      {ex.sets.map((set, j) => (
                        <Row
                          key={`${ex.id}-set-${j}`}
                          exerciseIndex={i}
                          setIndex={j}
                          weight={set.weight}
                          equipment={set.equipment}
                          reps={set.reps}
                          memo={set.memo || ""}
                          done={set.done}
                          setType={set.setType || "main"}
                          isCurrent={!allSetsDone && j === currentSetIdx}
                          exId={ex.id}
                          deleteSet={deleteSet}
                          onWeightChange={changeWeight}
                          onRepsDelta={changeReps}
                          onToggleDone={toggleDone}
                          changeMemo={changeMemo}
                          displayWeightUnit={displayWeightUnit}
                          changeEquipment={changeEquipment}
                          changeUnit={changeUnit}
                          changeSetType={changeSetType}
                          unit={set.unit}
                        />
                      ))}
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        })}
      </div>

      {!hideSessionActions && (
        <>
          <Sheet
            open={isAddExerciseSheetOpen}
            onOpenChange={setIsAddExerciseSheetOpen}
          >
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className="w-full h-14 border-2 border-dashed flex items-center justify-center gap-2"
              >
                <Plus className="h-5 w-5" />
                운동 추가
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="h-[85vh] overflow-hidden flex flex-col p-2"
            >
              <AddExerciseBottomSheet
                exercises={exercises}
                addExercisesToSession={addExercisesToSession}
                onClose={() => setIsAddExerciseSheetOpen(false)}
              />
            </SheetContent>
          </Sheet>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button onClick={onSave} disabled={saving}>
              {saving ? "저장중..." : "저장"}
            </Button>
            <Button onClick={onStartNewSession}>새 세션</Button>
          </div>

          <Button
            onClick={onCompleteWorkout}
            disabled={saving}
            className="w-full mt-2 bg-green-700 text-white hover:bg-green-600 dark:bg-green-700 dark:hover:bg-green-500"
          >
            {saving ? "처리중..." : "운동 완료"}
          </Button>
        </>
      )}
    </main>
  );
}

function InlineNumberField({
  value,
  inputMode,
  disabled = false,
  ariaLabel,
  className,
  suffix,
  hint = false,
  onCommit,
}: {
  value: string;
  inputMode: "decimal" | "numeric";
  disabled?: boolean;
  ariaLabel: string;
  className: string;
  suffix?: string;
  hint?: boolean;
  onCommit: (draft: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelledRef = useRef(false);

  function beginEdit() {
    cancelledRef.current = false;
    setDraft(value);
    setIsEditing(true);
  }

  function commitEdit() {
    setIsEditing(false);
    if (cancelledRef.current) return;
    if (draft.trim() === value) return;
    onCommit(draft);
  }

  if (isEditing) {
    return (
      <input
        type="text"
        inputMode={inputMode}
        aria-label={ariaLabel}
        className={`${className} w-full min-w-0 rounded-none border-0 border-b-2 border-(--session-accent) bg-transparent p-0 py-0! outline-none`}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            e.currentTarget.blur();
          }
        }}
        onBlur={commitEdit}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      className={`${className} block w-full truncate text-left ${hint ? "underline decoration-dotted underline-offset-4" : ""}`}
      onClick={beginEdit}
    >
      {value}
      {suffix && (
        <span className="ml-1 text-xs font-normal uppercase text-muted-foreground">
          {suffix}
        </span>
      )}
    </button>
  );
}

function Row({
  exId,
  exerciseIndex,
  setIndex,
  weight,
  equipment,
  reps,
  done,
  setType,
  isCurrent,
  onWeightChange,
  onRepsDelta,
  onToggleDone,
  memo,
  changeMemo,
  deleteSet,
  displayWeightUnit,
  changeEquipment,
  changeUnit,
  changeSetType,
  unit,
}: {
  exId: string;
  exerciseIndex: number;
  setIndex: number;
  weight: number;
  equipment: string;
  reps: number;
  done: boolean;
  setType: "warmup" | "main";
  isCurrent: boolean;
  onWeightChange: (exIdx: number, setIdx: number, nextWeight: number) => void;
  onRepsDelta: (exIdx: number, setIdx: number, delta: number) => void;
  onToggleDone: (exIdx: number, setIdx: number) => void;
  memo: string;
  changeMemo: (exIdx: number, setIdx: number, value: string) => void;
  deleteSet: (exId: string, setIdx: number) => void;
  displayWeightUnit: (
    weight: number,
    unit: "kg" | "lb",
  ) => { displayWeight: number; displayUnit: "kg" | "lb" };
  changeEquipment: (exIdx: number, setIdx: number, equipment: string) => void;
  changeUnit: (exIdx: number, setIdx: number, unit: "kg" | "lb") => void;
  changeSetType: (
    exIdx: number,
    setIdx: number,
    setType: "warmup" | "main",
  ) => void;
  unit: "kg" | "lb";
}) {
  const { displayWeight, displayUnit } = displayWeightUnit(weight, unit);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const setLabel = `세트 ${setIndex + 1}`;

  function commitWeight(draft: string) {
    const nextKg = convertInputToKg(draft, unit);
    if (nextKg === null) return;
    onWeightChange(exerciseIndex, setIndex, nextKg);
  }

  function commitReps(draft: string) {
    const nextReps = parseRepsInput(draft);
    if (nextReps === null) return;
    onRepsDelta(exerciseIndex, setIndex, nextReps - reps);
  }

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    setIsSwiping(true);
    setSwipeOffset(0);
    (e.currentTarget as HTMLElement).dataset.startX = String(touch.clientX);
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!isSwiping) return;

    const touch = e.touches[0];
    const startX = Number((e.currentTarget as HTMLElement).dataset.startX);
    const currentX = touch.clientX;
    const diff = currentX - startX;

    if (diff < 0) {
      setSwipeOffset(Math.max(diff, -100));
    }
  }

  function handleTouchEnd() {
    if (swipeOffset < -50) {
      setIsDeleteDialogOpen(true);
    }
    setIsSwiping(false);
    setSwipeOffset(0);
  }

  function handleConfirmDelete() {
    deleteSet(exId, setIndex);
    setIsDeleteDialogOpen(false);
  }

  function handleCancelDelete() {
    setIsDeleteDialogOpen(false);
    setSwipeOffset(0);
  }

  return (
    <div
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {swipeOffset < 0 && (
        <div className="absolute inset-0 bg-destructive flex items-center justify-end pr-4">
          <TrashIcon className="size-6 text-white" />
        </div>
      )}
      <div
        className={`relative border-b border-border ${swipeOffset < 0 ? "bg-background" : ""}`}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: "all 0.3s ease-in-out",
        }}
      >
        <div
          className={`relative grid min-h-12 ${SET_ROW_GRID} items-center gap-1 px-1 ${done ? "text-muted-foreground" : ""}`}
        >
          {isCurrent && (
            <>
              <span className="pointer-events-none absolute inset-0 -z-10 bg-(--session-accent)/20" />
              <span className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1 bg-(--session-accent)" />
            </>
          )}
          <button
            type="button"
            aria-expanded={isDetailOpen}
            aria-label={`${setLabel} 상세`}
            className="flex h-12 items-center gap-0.5 pl-2 text-left tabular-nums"
            onClick={() => setIsDetailOpen((open) => !open)}
          >
            <span className={`text-sm ${isCurrent ? "font-bold" : ""}`}>
              {String(setIndex + 1).padStart(2, "0")}
            </span>
            <ChevronDown
              className={`size-3 transition-transform ${isDetailOpen ? "rotate-180" : ""}`}
            />
          </button>
          <button
            type="button"
            aria-label={`${setLabel} 타입 전환`}
            className="flex h-12 items-center justify-center"
            onClick={() =>
              changeSetType(
                exerciseIndex,
                setIndex,
                setType === "warmup" ? "main" : "warmup",
              )
            }
          >
            <span
              className={`rounded-full border px-2 py-1 text-xs ${setType === "warmup" ? "border-foreground font-semibold" : "border-border"}`}
            >
              {setType === "warmup" ? "웜업" : "본세트"}
            </span>
          </button>
          <InlineNumberField
            value={String(displayWeight)}
            suffix={displayUnit}
            inputMode="decimal"
            ariaLabel={`${setLabel} 무게`}
            className="py-3 text-xl font-semibold tabular-nums"
            onCommit={commitWeight}
          />
          <InlineNumberField
            value={String(reps)}
            inputMode="numeric"
            ariaLabel={`${setLabel} 횟수`}
            className="py-3 text-xl font-semibold tabular-nums"
            onCommit={commitReps}
          />
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={`${setLabel} 완료`}
            className="flex h-12 items-center justify-center text-foreground"
            onClick={() => onToggleDone(exerciseIndex, setIndex)}
          >
            {done ? (
              <Check className="size-6" />
            ) : (
              <span className="size-6 rounded-full border-2 border-muted-foreground/60" />
            )}
          </button>
        </div>
        {!isDetailOpen && memo.trim() !== "" && (
          <div className="-mt-1 truncate px-3 pb-2 text-xs italic text-muted-foreground">
            "{memo}"
          </div>
        )}
        {isDetailOpen && (
          <div className="space-y-3 px-3 pb-3 pt-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">단위</span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={unit === "kg" ? "default" : "outline"}
                  className="h-6 px-2 text-xs"
                  onClick={() => changeUnit(exerciseIndex, setIndex, "kg")}
                >
                  kg
                </Button>
                <Button
                  type="button"
                  variant={unit === "lb" ? "default" : "outline"}
                  className="h-6 px-2 text-xs"
                  onClick={() => changeUnit(exerciseIndex, setIndex, "lb")}
                >
                  lb
                </Button>
              </div>
            </div>
            <div>
              <select
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-ring"
                value={equipment}
                onChange={(e) =>
                  changeEquipment(exerciseIndex, setIndex, e.target.value)
                }
              >
                <option value="">기구 선택</option>
                {Object.entries(EQUIPMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">메모</div>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-ring"
                type="text"
                value={memo}
                onChange={(e) =>
                  changeMemo(exerciseIndex, setIndex, e.target.value)
                }
                placeholder="세트 메모"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-8 text-xs text-destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <TrashIcon className="size-4" />
              세트 삭제
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>세트를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              세트 {setIndex + 1} (
              {setType === "warmup" ? "웜업세트" : "본세트"})
              <br />
              <br />
              삭제된 세트는 복구할 수 없습니다.
              <br />
              목표 세트 수도 함께 조정됩니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelDelete}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              variant="destructive"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddExerciseBottomSheet({
  exercises: currentExercises,
  addExercisesToSession,
  onClose,
}: {
  exercises: Exercises;
  addExercisesToSession: (newExercises: Exercises) => void;
  onClose: () => void;
}) {
  const { libraryState } = useExerciseLibrary();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (libraryState.status === "success" && selectedCategory === null) {
      if (libraryState.categories.length > 0) {
        setSelectedCategory(libraryState.categories[0]);
      }
    }
  }, [libraryState, selectedCategory]);

  function toggleExerciseSelection(exerciseId: string) {
    setSelectedExerciseIds((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  }

  function handleConfirm() {
    if (libraryState.status !== "success") return;
    if (selectedExerciseIds.size === 0) return;

    const selectedIds = Array.from(selectedExerciseIds);
    const exerciseMap = new Map(
      libraryState.exercises.map((ex) => [ex.id, ex]),
    );

    const newExercises: Exercise[] = [];
    for (const id of selectedIds) {
      const libraryEx = exerciseMap.get(id);
      if (libraryEx) {
        const sets = getPreviousRecord(libraryEx.name, libraryEx.equipment);
        const mainSetCount = sets.filter(
          (s) => (s.setType ?? "main") === "main",
        ).length;
        const warmupSetCount = sets.filter(
          (s) => s.setType === "warmup",
        ).length;
        newExercises.push({
          id: libraryEx.id,
          name: libraryEx.name,
          sets,
          part: libraryEx.category as string,
          exercisePageId: libraryEx.notionPageId,
          targetMainSetCount: mainSetCount,
          targetWarmupSetCount: warmupSetCount,
        });
      }
    }

    addExercisesToSession(newExercises);
    setSelectedExerciseIds(new Set());
    onClose();
  }

  if (libraryState.status === "loading") {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-muted-foreground">운동 목록을 불러오는 중...</p>
      </div>
    );
  }

  if (libraryState.status === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4">
        <p className="text-destructive mb-2">운동 목록을 불러오지 못했습니다</p>
        <p className="text-sm text-muted-foreground">{libraryState.message}</p>
      </div>
    );
  }

  if (libraryState.status === "empty") {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4">
        <p className="text-muted-foreground mb-2">등록된 운동이 없습니다</p>
        <p className="text-sm text-muted-foreground">
          Exercise DB에 운동을 추가해주세요
        </p>
      </div>
    );
  }

  const { exercises: libraryExercises, categories } = libraryState;
  const grouped = groupExercisesByCategory(libraryExercises);

  const existingPageIds = new Set(
    currentExercises.map((ex) => ex.exercisePageId).filter(Boolean),
  );

  const availableExercises = (
    selectedCategory ? grouped.get(selectedCategory as any) || [] : []
  ).filter((ex) => !existingPageIds.has(ex.notionPageId));

  const filteredExercises = searchQuery
    ? availableExercises.filter((ex) =>
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : availableExercises;

  return (
    <>
      <SheetHeader>
        <SheetTitle>운동 추가</SheetTitle>
        <SheetDescription>
          세션에 추가할 운동을 선택하세요 (중복 제외됨)
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto mt-4">
        <div className="mb-4">
          <input
            type="text"
            placeholder="운동 이름 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="sticky top-0 bg-background border-b z-10 pb-2">
          <div className="flex overflow-x-auto gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`px-4 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors ${
                  selectedCategory === category
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground hover:bg-accent"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {filteredExercises.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {searchQuery
                ? "검색 결과가 없습니다"
                : existingPageIds.size > 0 && availableExercises.length === 0
                  ? "추가 가능한 운동이 없습니다 (모두 추가됨)"
                  : `${selectedCategory}에 등록된 운동이 없습니다`}
            </p>
          ) : (
            filteredExercises.map((exercise) => {
              const isSelected = selectedExerciseIds.has(exercise.id);
              return (
                <div
                  key={exercise.id}
                  onClick={() => toggleExerciseSelection(exercise.id)}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent border-primary"
                      : "bg-card hover:bg-accent"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-foreground">
                        {exercise.name}
                      </h3>
                      <div className="flex gap-2 mt-1">
                        {exercise.equipment && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            {exercise.equipment}
                          </span>
                        )}
                        {exercise.primaryEffect && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                            {exercise.primaryEffect}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-2">
                      {isSelected && (
                        <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                          <svg
                            className="w-4 h-4 text-primary-foreground"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="border-t pt-4 mt-4">
        <Button
          className="w-full"
          onClick={handleConfirm}
          disabled={selectedExerciseIds.size === 0}
          variant={selectedExerciseIds.size === 0 ? "outline" : "default"}
        >
          추가하기 ({selectedExerciseIds.size})
        </Button>
      </div>
    </>
  );
}
