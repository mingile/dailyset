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
} from "@/components/ui/sheet";
import {
  Exercises,
  SessionMetadata,
  Exercise,
  SetItem,
  Session,
  ExerciseTimers,
} from "./types";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";
import { TrashIcon, Plus, Minus, Check } from "lucide-react";
import { convertInputToKg, ruleDecision } from "@/lib/weightUnit";
import {
  getPreviousRecord,
  createDefaultSet,
  getPreviousSets,
  type PreviousSets,
} from "@/lib/previous-record";
import type { SessionExercisesActions } from "@/hooks/useSessionExercises";
import { switchActiveExerciseTimer } from "@/lib/timer";
import { dismissSwipeHint, shouldShowSwipeHint } from "@/lib/swipe-hint";
import { EYEBROW } from "@/components/app/eyebrow";
import { PerfProfiler } from "@/components/perf-profiler";
import { ExerciseElapsedTime } from "./ExerciseElapsedTime";
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

// 앱 상단에 붙어 있는 헤더(HeaderControls의 min-h-14) 높이. 펼친 운동이 이 아래에 보이도록 맞춘다.
const STICKY_HEADER_HEIGHT = 56;

const EQUIPMENT_LABELS: Record<string, string> = {
  "cable-machine": "케이블 머신",
  "smith-machine": "스미스 머신",
  "plate-machine": "원판 머신",
  barbell: "바벨",
  dumbbell: "덤벨",
};

const SET_ROW_GRID = "grid-cols-[2.75rem_4rem_minmax(0,1fr)_4rem_2.75rem]";
// 안내용 시범 움직임: 첫 세트 행을 이만큼 밀었다가 되돌린다.
const SWIPE_HINT_NUDGE_PX = -48;
const SWIPE_HINT_NUDGE_START_MS = 50;
const SWIPE_HINT_NUDGE_END_MS = 750;
const PREVIOUS_ROW_GRID = "grid-cols-[3rem_minmax(0,5rem)_3rem_minmax(0,1fr)]";

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

function CompletedCheck() {
  return (
    <span
      role="img"
      aria-label="완료된 운동"
      className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-(--session-accent) text-(--session-accent-foreground)"
    >
      <Check className="size-4" />
    </span>
  );
}

export function WorkoutSessionClient({
  exercises,
  displayWeightUnit,
  actions,
  sessionMetadata,
  exerciseTimers,
  onExerciseTimersChange,
  onCompleteWorkout,
  saving,
  addExerciseSlot,
  hideSessionActions = false,
  enableSwipeHint = false,
}: {
  exercises: Exercises;
  displayWeightUnit: (
    weight: number,
    unit: "kg" | "lb",
  ) => { displayWeight: number; displayUnit: "kg" | "lb" };
  actions: SessionExercisesActions;
  sessionMetadata: SessionMetadata | null;
  exerciseTimers: ExerciseTimers;
  onExerciseTimersChange: (
    updater: (prev: ExerciseTimers) => ExerciseTimers,
  ) => void;
  onCompleteWorkout: () => void;
  saving: boolean;
  /**
   * 목록 끝에 놓이는 `운동 추가` 버튼과 시트. 넘기지 않으면 아무것도 그리지 않는다(랜딩 데모).
   * 시트가 운동 라이브러리(react-query)에 의존하므로 이 컴포넌트가 직접 import하지 않고 호출하는 쪽이 넘긴다.
   */
  addExerciseSlot?: ReactNode;
  hideSessionActions?: boolean;
  /**
   * 저장 데이터가 없는 최초 사용자에게 세트 스와이프 삭제 안내를 보여준다.
   * 앱 화면만 켠다. 랜딩 데모는 넘기지 않아 안내가 나오지 않는다.
   */
  enableSwipeHint?: boolean;
}) {
  const {
    addSet,
    changeWeight,
    changeReps,
    changeMemo,
    deleteSet,
    changeEquipment,
    changeUnit,
    changeSetType,
  } = actions;
  const [openAccordionIndex, setOpenAccordionIndex] = useState<number | null>(
    null,
  );
  const [swipeHintVisible, setSwipeHintVisible] = useState(false);
  const [swipeHintNudged, setSwipeHintNudged] = useState(false);
  const autoCollapsedExercisesRef = useRef<Set<string>>(new Set());
  const prevActiveExerciseIdRef = useRef<string | null>(null);
  const openItemRef = useRef<HTMLDivElement>(null);

  // 타이머는 펼쳐져 있고 아직 끝나지 않은 운동만 흐른다. 완료된 운동은 다시 펼쳐도 재개하지 않고,
  // 완료를 해제하면 이 값이 다시 그 운동의 id가 되어 이어서 흐른다.
  const openExercise =
    openAccordionIndex === null ? undefined : exercises[openAccordionIndex];
  const activeExerciseId =
    openExercise && !isExerciseCompleted(openExercise) ? openExercise.id : null;

  useEffect(() => {
    const prevActiveExerciseId = prevActiveExerciseIdRef.current;
    if (prevActiveExerciseId === activeExerciseId) return;

    onExerciseTimersChange((prev) =>
      switchActiveExerciseTimer(prev, prevActiveExerciseId, activeExerciseId),
    );

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

  // 저장소는 브라우저에서만 읽을 수 있어서 마운트 뒤에 판단한다 (서버 렌더와 어긋나지 않게).
  useEffect(() => {
    if (enableSwipeHint && shouldShowSwipeHint()) setSwipeHintVisible(true);
  }, [enableSwipeHint]);

  const markSwipeHintNudged = useCallback(() => setSwipeHintNudged(true), []);

  function dismissSwipeHintUi() {
    setSwipeHintVisible(false);
    dismissSwipeHint();
  }

  // 펼친 운동은 목록 맨 위로 올라가는데 스크롤 위치는 그대로라, 아래쪽 행을 펼치면 그 운동이 화면 위로 벗어난다.
  // 헤더에 가려졌거나 화면 위로 벗어났을 때만 보이는 위치로 옮긴다. (이미 보이면 건드리지 않는다)
  function scrollOpenExerciseIntoView() {
    const top = openItemRef.current?.getBoundingClientRect().top;
    if (top === undefined || top >= STICKY_HEADER_HEIGHT) return;
    window.scrollTo({ top: window.scrollY + top - STICKY_HEADER_HEIGHT });
  }

  function toggleExercise(index: number, open: boolean) {
    setOpenAccordionIndex(open ? index : null);
    // 목록이 다시 그려져 펼친 운동이 맨 위로 올라간 뒤에 위치를 잡도록 다음 프레임에 맡긴다.
    if (open) window.requestAnimationFrame(scrollOpenExerciseIntoView);
  }

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

  // 펼친(활성) 운동은 화면에서만 맨 위에 두고, 나머지는 원래 순서를 유지한다.
  // 번호와 핸들러 인덱스는 exercises 배열의 원래 인덱스를 그대로 쓴다.
  const displayOrder = exercises.map((_, index) => index);
  if (openAccordionIndex !== null && openAccordionIndex < exercises.length) {
    displayOrder.splice(openAccordionIndex, 1);
    displayOrder.unshift(openAccordionIndex);
  }

  return (
    <main className="session-font px-4 py-2 space-y-2">
      <div className="border-t border-border">
        {displayOrder.map((i) => {
          const ex = exercises[i];
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
          const exerciseSubtitle = [
            currentSet ? EQUIPMENT_LABELS[currentSet.equipment] : undefined,
            ex.part,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Accordion
              key={ex.id}
              type="single"
              collapsible
              value={isActive ? `item-${i}` : ""}
              onValueChange={(val) => toggleExercise(i, val === `item-${i}`)}
            >
              <AccordionItem
                ref={isActive ? openItemRef : undefined}
                value={`item-${i}`}
                className={`border-b border-border last:border-b ${completed ? "-mx-2 bg-(--session-accent)/8 px-2" : ""}`}
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
                          {completed && <CompletedCheck />}
                          <span className="break-words text-3xl font-bold leading-tight tracking-tight">
                            {ex.name}
                          </span>
                        </div>
                      </div>
                      <ExerciseElapsedTime timer={exerciseTimers[ex.id]} />
                    </div>
                  ) : (
                    <div className="flex w-full min-w-0 items-center gap-3">
                      {completed ? (
                        <span
                          role="img"
                          aria-label="완료된 운동"
                          className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-(--session-accent) text-(--session-accent-foreground)"
                        >
                          <Check className="size-4" />
                        </span>
                      ) : (
                        <span className="w-6 shrink-0 text-sm tabular-nums text-muted-foreground">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      )}
                      <span className="h-6 shrink-0 border-l border-border" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-lg font-bold tracking-tight">
                          {ex.name}
                        </div>
                        {exerciseSubtitle && (
                          <div className="truncate text-xs text-muted-foreground">
                            {exerciseSubtitle}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-sm tabular-nums uppercase tracking-wider text-muted-foreground">
                        {completedCount} / {targetCount} SETS
                      </span>
                    </div>
                  )}
                </AccordionTrigger>

                {isActive && (
                  <div className="flex items-baseline gap-1 pb-3 text-sm text-muted-foreground">
                    <select
                      aria-label="현재 세트 기구"
                      disabled={!currentSet}
                      className="-mx-3 -mb-3 -mt-1 field-sizing-content cursor-pointer appearance-none rounded-none border-0 bg-transparent px-3 py-3 text-sm text-muted-foreground underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          className={`-mb-3.5 -mt-1.5 block w-full py-3.5 text-left ${EYEBROW}`}
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
                        <div className={`mt-2 ${EYEBROW}`}>reps</div>
                      </div>
                      <div className="min-w-0 border-l border-border pl-2">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            aria-label="세트 삭제"
                            disabled={
                              ex.sets.length <= 1 ||
                              ex.sets[ex.sets.length - 1].done
                            }
                            className="-mx-1.5 -my-2 flex size-11 items-center justify-center disabled:opacity-40"
                            onClick={() =>
                              changeSetTotal(i, ex, String(ex.sets.length - 1))
                            }
                          >
                            <span className="flex size-7 items-center justify-center rounded-full border border-border">
                              <Minus className="size-4" />
                            </span>
                          </button>
                          <span className={EYEBROW}>set</span>
                          <button
                            type="button"
                            aria-label="세트 추가"
                            className="-mx-1.5 -my-2 flex size-11 items-center justify-center"
                            onClick={() => addSet(i)}
                          >
                            <span className="flex size-7 items-center justify-center rounded-full border border-border">
                              <Plus className="size-4" />
                            </span>
                          </button>
                        </div>
                        <div className="mt-1 flex items-center whitespace-nowrap text-lg font-bold tabular-nums">
                          {currentSet ? (
                            <>
                              <span
                                className={
                                  allSetsDone
                                    ? "text-muted-foreground"
                                    : "rounded-sm bg-(--session-accent) px-1 text-(--session-accent-foreground)"
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
                                  className="-my-1 min-w-11 py-2 text-lg font-bold tabular-nums"
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
                      className="mt-3 w-full rounded-none border-0 border-b-2 border-transparent bg-transparent py-3 text-sm outline-none focus:border-(--session-focus)"
                      value={currentSet?.memo ?? ""}
                      onChange={(e) =>
                        changeMemo(i, currentSetIdx, e.target.value)
                      }
                      placeholder="세트 메모"
                    />
                  </div>
                  <div>
                    <div
                      className={`grid ${SET_ROW_GRID} gap-1 px-1 pb-1 ${EYEBROW}`}
                    >
                      <span className="pl-2">세트</span>
                      <span />
                      <span>무게</span>
                      <span>횟수</span>
                      <span className="text-center">완료</span>
                    </div>
                    <div className="border-t border-border">
                      {ex.sets.map((set, j) => (
                        <Fragment key={`${ex.id}-set-${j}`}>
                          <PerfProfiler id={`Row:${i}:${j}`}>
                            <Row
                              exerciseIndex={i}
                              setIndex={j}
                              weight={set.weight}
                              reps={set.reps}
                              memo={set.memo || ""}
                              done={set.done}
                              setType={set.setType || "main"}
                              isCurrent={!allSetsDone && j === currentSetIdx}
                              exId={ex.id}
                              actions={actions}
                              displayWeightUnit={displayWeightUnit}
                              unit={set.unit}
                              nudge={
                                j === 0 && swipeHintVisible && !swipeHintNudged
                              }
                              onNudged={markSwipeHintNudged}
                              onSwipeDelete={
                                swipeHintVisible
                                  ? dismissSwipeHintUi
                                  : undefined
                              }
                            />
                          </PerfProfiler>
                          {j === 0 && swipeHintVisible && (
                            <SwipeHint onDismiss={dismissSwipeHintUi} />
                          )}
                        </Fragment>
                      ))}
                    </div>
                    <PreviousRecord
                      exerciseName={ex.name}
                      equipment={currentSet?.equipment ?? ""}
                      sessionId={sessionMetadata?.sessionId}
                      displayWeightUnit={displayWeightUnit}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        })}
        {!hideSessionActions && addExerciseSlot}
      </div>

      {!hideSessionActions && (
        <Button
          onClick={onCompleteWorkout}
          disabled={saving}
          variant="accent"
          size="xl"
          className="mt-6 w-full"
        >
          {saving ? "처리중..." : "운동 완료"}
        </Button>
      )}
    </main>
  );
}

function SwipeHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="note"
      className="flex items-center justify-between gap-2 border-b border-border px-3 text-xs text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-1.5 py-2">
        <span aria-hidden>←</span>
        <span>왼쪽으로 밀어서 세트를 삭제할 수 있어요</span>
      </span>
      <button
        type="button"
        aria-label="스와이프 안내 닫기"
        className="-my-1 shrink-0 px-2 py-3 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onDismiss}
      >
        닫기
      </button>
    </div>
  );
}

function PreviousRecord({
  exerciseName,
  equipment,
  sessionId,
  displayWeightUnit,
}: {
  exerciseName: string;
  equipment: string;
  sessionId?: string;
  displayWeightUnit: (
    weight: number,
    unit: "kg" | "lb",
  ) => { displayWeight: number; displayUnit: "kg" | "lb" };
}) {
  const [record, setRecord] = useState<PreviousSets | null>(null);
  const [memoSheetOpen, setMemoSheetOpen] = useState(false);
  const [selectedMemo, setSelectedMemo] = useState<{
    setNo: number;
    memo: string;
  } | null>(null);

  useEffect(() => {
    setRecord(getPreviousSets(exerciseName, equipment, sessionId));
  }, [exerciseName, equipment, sessionId]);

  if (!record || record.sets.length === 0) return null;

  const savedAt = new Date(record.savedAt);
  const dateLabel = Number.isNaN(savedAt.getTime())
    ? ""
    : `${savedAt.getFullYear()}. ${savedAt.getMonth() + 1}. ${savedAt.getDate()}`;

  return (
    <div className="mt-4 text-muted-foreground">
      <div className={`flex items-baseline gap-2 px-1 pl-3 ${EYEBROW}`}>
        <span>이전 기록</span>
        <span>/</span>
        <span className="tabular-nums">{dateLabel}</span>
      </div>
      <div
        className={`mt-4 grid ${PREVIOUS_ROW_GRID} gap-1 px-1 pb-1 ${EYEBROW}`}
      >
        <span className="pl-2">세트</span>
        <span>무게</span>
        <span>횟수</span>
        <span>메모</span>
      </div>
      <div className="border-t border-border">
        {record.sets.map((set, index) => {
          const { displayWeight, displayUnit } = displayWeightUnit(
            set.weight,
            ruleDecision(set.equipment).unit,
          );
          return (
            <div
              key={index}
              className={`grid ${PREVIOUS_ROW_GRID} items-center gap-1 border-b border-border px-1 py-1 text-sm tabular-nums`}
            >
              <span className="pl-2">{String(index + 1).padStart(2, "0")}</span>
              <span>
                {displayWeight}
                <span className="ml-1 text-xs">{displayUnit}</span>
              </span>
              <span>{set.reps}</span>
              {set.memo.trim() !== "" ? (
                <button
                  type="button"
                  aria-label={`세트 ${index + 1} 메모 전문 보기`}
                  className="-my-1 flex min-w-0 items-center self-stretch py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setSelectedMemo({ setNo: index + 1, memo: set.memo });
                    setMemoSheetOpen(true);
                  }}
                >
                  <span className="truncate">{set.memo}</span>
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>
      <Sheet open={memoSheetOpen} onOpenChange={setMemoSheetOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="session-surface session-font flex max-h-[85vh] flex-col gap-0 overflow-hidden"
        >
          <SheetHeader className="gap-0 pb-2">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-2xl font-bold tracking-tight">
                {`세트 ${String(selectedMemo?.setNo ?? 0).padStart(2, "0")} 메모`}
              </SheetTitle>
              <Button
                type="button"
                variant="ghost"
                size="text"
                className="-mr-2"
                onClick={() => setMemoSheetOpen(false)}
              >
                닫기
              </Button>
            </div>
            <SheetDescription>
              {exerciseName} · {dateLabel} 이전 기록
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            <p className="whitespace-pre-wrap wrap-break-word text-base">
              {selectedMemo?.memo}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
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
  const scrollYBeforeEditRef = useRef(0);

  function beginEdit() {
    cancelledRef.current = false;
    // 포커스가 가면 모바일 브라우저가 키패드에 맞춰 화면을 스크롤한다. 입력을 마치면 이 위치로 돌려놓는다.
    scrollYBeforeEditRef.current = window.scrollY;
    setDraft(value);
    setIsEditing(true);
  }

  function commitEdit() {
    setIsEditing(false);
    // 키패드가 닫히며 브라우저가 스크롤을 만지는 것이 끝난 뒤 복귀하도록 다음 프레임에 맡긴다.
    const top = scrollYBeforeEditRef.current;
    window.requestAnimationFrame(() => window.scrollTo({ top }));
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
        className={`${className} w-full min-w-0 rounded-none border-0 border-b-2 border-(--session-focus) bg-transparent p-0 py-0! outline-none`}
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
  reps,
  done,
  setType,
  isCurrent,
  memo,
  actions,
  displayWeightUnit,
  unit,
  nudge = false,
  onNudged,
  onSwipeDelete,
}: {
  exId: string;
  exerciseIndex: number;
  setIndex: number;
  weight: number;
  reps: number;
  done: boolean;
  setType: "warmup" | "main";
  isCurrent: boolean;
  memo: string;
  actions: Pick<
    SessionExercisesActions,
    "deleteSet" | "changeWeight" | "changeReps" | "toggleDone" | "changeSetType"
  >;
  displayWeightUnit: (
    weight: number,
    unit: "kg" | "lb",
  ) => { displayWeight: number; displayUnit: "kg" | "lb" };
  unit: "kg" | "lb";
  /** true면 마운트 직후 행을 살짝 밀었다 돌려 스와이프를 시범 보인다 */
  nudge?: boolean;
  /** 시범 움직임이 끝났을 때 (움직임 줄이기 설정이면 바로) */
  onNudged?: () => void;
  /** 사용자가 직접 스와이프해서 삭제 확인 창을 띄웠을 때 */
  onSwipeDelete?: () => void;
}) {
  const { displayWeight, displayUnit } = displayWeightUnit(weight, unit);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const setLabel = `세트 ${setIndex + 1}`;

  useEffect(() => {
    if (!nudge) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onNudged?.();
      return;
    }

    const startId = window.setTimeout(
      () => setSwipeOffset(SWIPE_HINT_NUDGE_PX),
      SWIPE_HINT_NUDGE_START_MS,
    );
    const endId = window.setTimeout(() => {
      setSwipeOffset(0);
      onNudged?.();
    }, SWIPE_HINT_NUDGE_END_MS);

    return () => {
      window.clearTimeout(startId);
      window.clearTimeout(endId);
    };
  }, [nudge, onNudged]);

  function commitWeight(draft: string) {
    const nextKg = convertInputToKg(draft, unit);
    if (nextKg === null) return;
    actions.changeWeight(exerciseIndex, setIndex, nextKg);
  }

  function commitReps(draft: string) {
    const nextReps = parseRepsInput(draft);
    if (nextReps === null) return;
    actions.changeReps(exerciseIndex, setIndex, nextReps - reps);
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
      onSwipeDelete?.();
    }
    setIsSwiping(false);
    setSwipeOffset(0);
  }

  function handleConfirmDelete() {
    actions.deleteSet(exId, setIndex);
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
        {isCurrent && (
          <>
            <span className="pointer-events-none absolute inset-0 -z-10 bg-(--session-accent)/20" />
            <span className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1 bg-(--session-accent)" />
          </>
        )}
        <div
          className={`relative grid min-h-12 ${SET_ROW_GRID} items-center gap-1 px-1 ${done ? "text-muted-foreground" : ""}`}
        >
          <span
            className={`flex h-12 items-center pl-2 text-sm tabular-nums ${isCurrent ? "font-bold" : ""}`}
          >
            {String(setIndex + 1).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label={`${setLabel} 타입 전환`}
            className="flex h-12 items-center justify-center"
            onClick={() =>
              actions.changeSetType(
                exerciseIndex,
                setIndex,
                setType === "warmup" ? "main" : "warmup",
              )
            }
          >
            <span
              className={`rounded-full border px-2 py-1 text-xs ${setType === "main" ? "border-foreground font-semibold" : "border-border"}`}
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
            onClick={() => actions.toggleDone(exerciseIndex, setIndex)}
          >
            {done ? (
              <Check className="size-6" />
            ) : (
              <span className="size-6 rounded-full border-2 border-muted-foreground/80 dark:border-muted-foreground/60" />
            )}
          </button>
        </div>
        {memo.trim() !== "" && (
          <div className="-mt-1 truncate px-3 pb-2 text-xs italic text-muted-foreground">
            "{memo}"
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
