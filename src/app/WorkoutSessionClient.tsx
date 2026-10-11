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
import { TrashIcon, Plus, CheckCircle2 } from "lucide-react";
import { convertInputToKg } from "@/lib/weightUnit";
import { nextWeight } from "@/lib/weightUnit";
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

function getCompletedMainSetCount(exercise: Exercise): number {
  return exercise.sets.filter(
    (set) => (set.setType ?? "main") === "main" && set.done,
  ).length;
}

function isExerciseCompleted(exercise: Exercise): boolean {
  const completedMainSets = getCompletedMainSetCount(exercise);
  const targetMainSets = exercise.targetMainSetCount || 0;
  return completedMainSets >= targetMainSets && targetMainSets > 0;
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
  changeTargetMainSetCount,
  changeTargetWarmupSetCount,
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

  return (
    <main className="p-2 space-y-2">
      {exercises.map((ex, i) => {
        const completed = isExerciseCompleted(ex);
        const completedCount = getCompletedMainSetCount(ex);
        const targetCount = ex.targetMainSetCount || 0;

        return (
          <Accordion
            key={ex.id}
            type="single"
            collapsible
            value={openAccordionIndex === i ? `item-${i}` : ""}
            onValueChange={(val) =>
              setOpenAccordionIndex(val === `item-${i}` ? i : null)
            }
          >
            <AccordionItem
              value={`item-${i}`}
              className={`rounded-lg border px-2 transition-colors ${
                completed
                  ? "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-800"
                  : ""
              }`}
            >
              <AccordionTrigger className="py-3">
                <div className="flex w-full items-center justify-between pr-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-base font-medium ${completed ? "text-green-700 dark:text-green-400" : ""}`}
                    >
                      {ex.name}
                    </span>
                    {completed && (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {displayElapsedSeconds[ex.id] !== undefined &&
                      displayElapsedSeconds[ex.id] > 0 && (
                        <span className="text-sm font-mono text-muted-foreground">
                          {formatElapsedTime(displayElapsedSeconds[ex.id])}
                        </span>
                      )}
                    <span
                      className={`text-sm ${completed ? "text-green-700 dark:text-green-400 font-semibold" : "text-muted-foreground"}`}
                    >
                      {completedCount} / {targetCount}
                    </span>
                  </div>
                </div>
              </AccordionTrigger>

              <AccordionContent className="pb-3">
                <div className="mb-3 space-y-2">
                  <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-sm text-muted-foreground">
                      목표 웜업세트
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() => changeTargetWarmupSetCount(i, -1)}
                      >
                        -
                      </Button>
                      <span className="w-8 text-center font-semibold">
                        {ex.targetWarmupSetCount || 0}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() => changeTargetWarmupSetCount(i, +1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                    <span className="text-sm text-muted-foreground">
                      목표 본세트
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() => changeTargetMainSetCount(i, -1)}
                      >
                        -
                      </Button>
                      <span className="w-8 text-center font-semibold">
                        {ex.targetMainSetCount || 0}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() => changeTargetMainSetCount(i, +1)}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
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
                      exId={ex.id}
                      deleteSet={deleteSet}
                      onWeightChange={changeWeight}
                      onRepsDelta={changeReps}
                      onToggleDone={toggleDone}
                      changeMemo={changeMemo}
                      displayWeightUnit={displayWeightUnit}
                      nextWeight={nextWeight}
                      changeEquipment={changeEquipment}
                      changeUnit={changeUnit}
                      changeSetType={changeSetType}
                      unit={set.unit}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        );
      })}

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

function Row({
  exId,
  exerciseIndex,
  setIndex,
  weight,
  equipment,
  reps,
  done,
  setType,
  onWeightChange,
  onRepsDelta,
  onToggleDone,
  memo,
  changeMemo,
  deleteSet,
  displayWeightUnit,
  nextWeight,
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
  nextWeight: (
    weight: number,
    equipment: string,
    direction: "increase" | "decrease",
  ) => number;
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
  const [isEditingWeight, setIsEditingWeight] = useState(false);
  const [draftWeight, setDraftWeight] = useState<string>(String(displayWeight));
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);

  useEffect(() => {
    if (isEditingWeight) return;
    setDraftWeight(String(displayWeight));
  }, [displayWeight, isEditingWeight]);

  useEffect(() => {
    setIsCollapsed(done);
  }, [done]);

  function beginWeightEdit() {
    setDraftWeight(String(displayWeight));
    setIsEditingWeight(true);
  }

  function commitWeightEdit() {
    const nextKg = convertInputToKg(draftWeight, unit);

    if (nextKg === null) {
      setDraftWeight(String(displayWeight));
      setIsEditingWeight(false);
      return;
    }

    onWeightChange(exerciseIndex, setIndex, nextKg);
    setIsEditingWeight(false);
  }

  function cancelWeightEdit() {
    setDraftWeight(String(displayWeight));
    setIsEditingWeight(false);
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

  function handleCollapse() {
    setIsCollapsed(!isCollapsed);
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="absolute inset-0 bg-destructive flex items-center justify-end pr-4">
        <TrashIcon className="size-6 text-white" />
      </div>
      <div
        className={`rounded-xl border bg-card p-3 space-y-3 ${isCollapsed ? "bg-green-100 dark:bg-green-950/40" : "bg-card"}`}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isCollapsed ? "none" : "all 0.3s ease-in-out",
        }}
      >
        {!isCollapsed && (
          <div className="flex items-center gap-1 mb-2">
            <Button
              type="button"
              variant={setType === "warmup" ? "default" : "outline"}
              className="h-6 px-2 text-xs"
              onClick={() => changeSetType(exerciseIndex, setIndex, "warmup")}
            >
              웜업
            </Button>
            <Button
              type="button"
              variant={setType === "main" ? "default" : "outline"}
              className="h-6 px-2 text-xs"
              onClick={() => changeSetType(exerciseIndex, setIndex, "main")}
            >
              본세트
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between">
          <div
            className={`relative flex items-center gap-2 flex-wrap ${isCollapsed ? "text-foreground font-bold" : ""}`}
          >
            <span
              className={
                isCollapsed
                  ? "text-green-700 dark:text-green-400"
                  : "text-foreground"
              }
            >
              세트 {setIndex + 1}
            </span>
            {isCollapsed ? (
              <div className="flex items-center gap-2 flex-wrap ml-auto text-green-700 dark:text-green-400">
                <span className="font-semibold text-md">
                  {displayWeight}
                  {displayUnit} × {reps}회
                </span>
                {memo.trim() !== "" && (
                  <span className="text-md text-green-800 dark:text-green-300 italic truncate max-w-[150px]">
                    "{memo}"
                  </span>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                className="ml-3 size-8"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDeleteDialogOpen(true);
                }}
              >
                <TrashIcon className="h-5 w-5" />
              </Button>
            )}
          </div>
          <label
            className={`flex items-center gap-2 text-sm text-muted-foreground ${isCollapsed ? "text-foreground" : ""}`}
          >
            {done ? "완료" : "완료 체크"}
            <input
              type="checkbox"
              className="h-5 w-5 accent-primary"
              checked={done}
              onChange={() => onToggleDone(exerciseIndex, setIndex)}
            />
          </label>
        </div>
        {isCollapsed ? null : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">무게</span>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant={unit === "kg" ? "default" : "outline"}
                      className="h-5 px-2 text-xs"
                      onClick={() => changeUnit(exerciseIndex, setIndex, "kg")}
                    >
                      kg
                    </Button>
                    <Button
                      type="button"
                      variant={unit === "lb" ? "default" : "outline"}
                      className="h-5 px-2 text-xs"
                      onClick={() => changeUnit(exerciseIndex, setIndex, "lb")}
                    >
                      lb
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    onClick={() =>
                      onWeightChange(
                        exerciseIndex,
                        setIndex,
                        nextWeight(weight, equipment, "decrease"),
                      )
                    }
                  >
                    -
                  </Button>
                  {isEditingWeight ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      step={displayUnit === "kg" ? "0.1" : "1"}
                      className="flex-1 min-w-0 rounded-md border bg-background px-2 py-1 text-center text-base font-semibold outline-none focus:border-ring"
                      value={draftWeight}
                      onChange={(e) => setDraftWeight(e.currentTarget.value)}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelWeightEdit();
                        }
                      }}
                      onBlur={commitWeightEdit}
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-md font-semibold truncate"
                      onClick={beginWeightEdit}
                    >
                      {displayWeight}
                      {displayUnit}
                    </button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    onClick={() =>
                      onWeightChange(
                        exerciseIndex,
                        setIndex,
                        nextWeight(weight, equipment, "increase"),
                      )
                    }
                  >
                    +
                  </Button>
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-2">횟수</div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    onClick={() => onRepsDelta(exerciseIndex, setIndex, -1)}
                  >
                    -
                  </Button>
                  <div className="flex-1 text-center text-md font-semibold">
                    {reps}회
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-3"
                    onClick={() => onRepsDelta(exerciseIndex, setIndex, +1)}
                  >
                    +
                  </Button>
                </div>
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
                <option value="cable-machine">케이블 머신</option>
                <option value="smith-machine">스미스 머신</option>
                <option value="plate-machine">원판 머신</option>
                <option value="barbell">바벨</option>
                <option value="dumbbell">덤벨</option>
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
          </>
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
