"use client";

import { TrashIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { restoreHistoryFromNotion } from "@/lib/notion/restoreLocalHistory";
import { readOutbox, removeJob, writeOutbox } from "@/lib/notion-outbox";
import type { SavedExercise, Session } from "./types";

const sessionKey = `workout.sessions.v1`;

// 로컬 표준 시간 가져오기
function getLocalDateString(isoString: string): string {
  return new Date(isoString).toLocaleDateString("sv-SE");
}

// 소요시간(초)을 분, 시 단위로 변환하기
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}시간 ${remainingMinutes}분`;
  }

  return `${minutes}분`;
}

const SWIPE_MAX_OFFSET = -100;
const SWIPE_DELETE_THRESHOLD = -50;
// 이 거리 안에서는 가로/세로 어느 쪽 제스처인지 정하지 않는다.
const SWIPE_AXIS_LOCK_DISTANCE = 8;
// 삭제 배경(빨강)은 row가 비워 준 폭만큼만 그린다. content 밑으로 이만큼 겹쳐서 이음새에 틈이 안 생기게 한다.
const SWIPE_REVEAL_OVERLAP_PX = 1;
const SWIPE_RETURN_DURATION_MS = 150;
const COLLAPSE_DURATION_MS = 200;
// transitionend가 오지 않아도(백그라운드 탭 등) 삭제가 끝나도록 둔 여유 시간
const COLLAPSE_FALLBACK_MS = COLLAPSE_DURATION_MS + 100;

type SwipeAxis = "undecided" | "horizontal" | "vertical";
// idle → collapsing(접히는 중, 아직 데이터는 그대로) → done(onDelete 호출됨)
type DeleteState = "idle" | "collapsing" | "done";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 세트 한 줄. 드래그 중에는 state 없이 ref로 transform만 직접 바꿔서 리렌더를 일으키지 않는다.
// 터치/마우스/펜을 Pointer Events 하나로 받는다. 세로 스크롤은 touch-action이 브라우저에 맡기고,
// 브라우저가 스크롤을 가져가면 pointercancel이 와서 row를 원위치로 돌린다.
// 삭제가 확정되면 row를 접은 뒤에 onDelete를 호출한다(아래 row들이 한 번에 튀지 않게).
function SwipeableSetRow({
  onDelete,
  children,
}: {
  onDelete: () => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const onDeleteRef = useRef(onDelete);
  const deleteStateRef = useRef<DeleteState>("idle");
  const collapseTimerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(
    null,
  );
  const axisRef = useRef<SwipeAxis>("undecided");
  const offsetRef = useRef(0);

  useEffect(() => {
    onDeleteRef.current = onDelete;
  });

  // 접히는 도중 기록 화면이 닫혀 unmount되어도 이미 확정한 삭제는 유실되지 않게 바로 실행한다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commitDelete는 ref만 읽는다
  useEffect(() => {
    return () => commitDelete();
  }, []);

  // 접힘이 끝났을 때(transitionend 또는 fallback 타이머, unmount) 한 번만 실제로 지운다.
  function commitDelete() {
    if (deleteStateRef.current !== "collapsing") return;
    deleteStateRef.current = "done";
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    onDeleteRef.current();
  }

  function collapseAndDelete() {
    deleteStateRef.current = "collapsing";
    const row = rowRef.current;
    if (!row || prefersReducedMotion()) {
      commitDelete();
      return;
    }
    // height: auto는 transition이 안 되므로 현재 높이를 px로 고정한 뒤 0으로 줄인다.
    row.style.height = `${row.getBoundingClientRect().height}px`;
    row.getBoundingClientRect(); // 고정한 높이를 먼저 반영시켜야 0으로 가는 transition이 걸린다.
    row.style.transition = `height ${COLLAPSE_DURATION_MS}ms ease-out`;
    row.style.height = "0px";
    collapseTimerRef.current = window.setTimeout(
      commitDelete,
      COLLAPSE_FALLBACK_MS,
    );
  }

  function moveTo(offset: number, animate: boolean) {
    const content = contentRef.current;
    const reveal = revealRef.current;
    if (!content || !reveal) return;
    offsetRef.current = offset;

    const duration = `${SWIPE_RETURN_DURATION_MS}ms ease-out`;
    content.style.transition = animate ? `transform ${duration}` : "none";
    content.style.transform = `translateX(${offset}px)`;
    // 빨간 배경을 content 밑에 깔아 두면 가장자리 안티앨리어싱으로 빨강이 비쳐 보인다.
    // 그래서 content가 비운 폭만큼만 오른쪽에 그리고, 되돌아올 때도 같은 transition으로 같이 줄인다.
    reveal.style.transition = animate ? `width ${duration}` : "none";
    reveal.style.width =
      offset < 0 ? `${-offset + SWIPE_REVEAL_OVERLAP_PX}px` : "0px";
  }

  function startSwipe(e: React.PointerEvent) {
    // 접히는 중인 row는 더 이상 건드릴 수 없다.
    if (deleteStateRef.current !== "idle") return;
    // 마우스 오른쪽/가운데 버튼은 스와이프가 아니다.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // 이전 제스처의 up/cancel을 놓쳤더라도 새 pointerdown이 항상 처음부터 다시 시작한다.
    startRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    axisRef.current = "undecided";
    moveTo(0, false);
  }

  // 왼쪽(-100px)까지만, 오른쪽으로 되돌리면 row도 같이 돌아온다.
  function moveSwipe(e: React.PointerEvent) {
    const start = startRef.current;
    if (!start || e.pointerId !== start.pointerId) return;

    const diffX = e.clientX - start.x;
    const diffY = e.clientY - start.y;

    if (axisRef.current === "undecided") {
      if (Math.max(Math.abs(diffX), Math.abs(diffY)) < SWIPE_AXIS_LOCK_DISTANCE)
        return;
      axisRef.current =
        Math.abs(diffX) > Math.abs(diffY) ? "horizontal" : "vertical";
    }
    if (axisRef.current !== "horizontal") return;

    moveTo(Math.min(0, Math.max(diffX, SWIPE_MAX_OFFSET)), false);
  }

  function endSwipe(e: React.PointerEvent) {
    const start = startRef.current;
    if (!start || e.pointerId !== start.pointerId) return;
    startRef.current = null;
    // 삭제되는 row는 밀린 위치에 그대로 둔 채 접는다. 되돌리면 사라지기 전에 깜빡인다.
    if (offsetRef.current < SWIPE_DELETE_THRESHOLD) {
      collapseAndDelete();
      return;
    }
    moveTo(0, true);
  }

  // 브라우저가 제스처를 가져가거나(세로 스크롤) 포인터가 row를 벗어나면 삭제 없이 원위치로 돌린다.
  function cancelSwipe() {
    if (!startRef.current) return;
    startRef.current = null;
    moveTo(0, true);
  }

  return (
    <li
      ref={rowRef}
      className="relative cursor-pointer touch-pan-y overflow-hidden"
      onTransitionEnd={(e) => {
        // content의 복귀 transition이 bubble 되어 올라오는 것은 무시하고 row 자신의 접힘만 본다.
        if (e.target === e.currentTarget) commitDelete();
      }}
      onPointerDown={startSwipe}
      onPointerMove={moveSwipe}
      onPointerUp={endSwipe}
      onPointerCancel={cancelSwipe}
      onPointerLeave={cancelSwipe}
    >
      <div
        ref={revealRef}
        className="absolute inset-y-0 right-0 flex w-0 items-center justify-end overflow-hidden bg-destructive"
      >
        {/* 패딩을 주면 border-box라 width 0이어도 그만큼 칠해져 content 밑으로 비친다. 간격은 마진으로 준다. */}
        <TrashIcon className="mr-4 size-4 shrink-0 text-white" />
      </div>
      <div
        ref={contentRef}
        className="relative grid min-h-11 grid-cols-[2.5rem_1fr_1fr] items-center gap-1 border-b border-border bg-background px-1 text-base tabular-nums"
      >
        {children}
      </div>
    </li>
  );
}

export function WorkoutHistoryClient({
  showHistory,
  historyVersion,
  selectedDate,
  notionReady = false,
  onHistoryChanged,
  unsyncedSessionIds = [],
  onRetryNotionJob,
}: {
  showHistory: boolean;
  historyVersion: number;
  selectedDate: string | null;
  notionReady?: boolean;
  onHistoryChanged?: () => void;
  unsyncedSessionIds?: string[];
  onRetryNotionJob?: (sessionId: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [restoring, setRestoring] = useState(false);

  // 사용자가 history를 보고 싶어하면(showHistory==true) 실행되는 이펙터, 로컬스토리지에 저장된 데이터를 가져와서 (배열)
  // 선택된 날짜에 맞는 파싱 히스토리를 sessions state에 담는다.
  useEffect(() => {
    const history = localStorage.getItem(sessionKey);
    const parsedHistory: Session[] = history ? JSON.parse(history) : [];
    if (!showHistory) return;
    try {
      if (history) {
        if (!Array.isArray(parsedHistory)) {
          return;
        }

        let filteredSessions = parsedHistory;
        if (selectedDate) {
          filteredSessions = parsedHistory.filter((session) => {
            const dateStr = getLocalDateString(session.savedAt);
            return dateStr === selectedDate;
          });
        }

        setSessions(filteredSessions);
      } else {
        setSessions([]);
      }
    } catch (e) {
      console.error("올바르지 않은 JSON 데이터", e);
      setSessions([]);
      localStorage.removeItem(sessionKey);
    }
  }, [showHistory, historyVersion, selectedDate]);

  // 가져온 세션 데이터를 로컬 시간에 맞춰 그룹화(중복 허용하지 않음, key는 세션의 savedAt)
  function groupByDate(sessions: Session[]): Map<string, Session[]> {
    const grouped = new Map<string, Session[]>();
    sessions.forEach((session) => {
      const dateStr = getLocalDateString(session.savedAt);
      if (!grouped.has(dateStr)) {
        grouped.set(dateStr, []);
      }
      grouped.get(dateStr)!.push(session);
    });
    return grouped;
  }

  // 헤더 부분 날짜 포맷팅
  function formatDateHeader(dateStr: string): string {
    const [year, month, day] = dateStr.split("-");
    return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일`;
  }

  // 해당 세션 안에 저장된 운동의 개수와 운동 별 세트 개수, 수행 부위, 수행 시간을 세션 요약으로
  function getSessionSummary(session: Session) {
    const exerciseCount = session.exercises.length;
    const totalSets = session.exercises.reduce(
      (sum, ex) => sum + ex.sets.length,
      0,
    );
    const parts = Array.from(
      new Set(session.exercises.map((ex) => ex.part || "기타")),
    );
    const partsStr = parts.join(" · "); // 이거 join 조건 왜 이렇지?
    const durationStr = session.durationSeconds
      ? formatDuration(session.durationSeconds)
      : null;
    return { exerciseCount, totalSets, partsStr, durationStr };
  }

  // 저장된 운동을 파트별로 그룹화
  function groupExercisesByPart(
    exercises: (SavedExercise & { part?: string })[],
  ): Map<string, (SavedExercise & { part?: string })[]> {
    const grouped = new Map<string, (SavedExercise & { part?: string })[]>();
    exercises.forEach((ex) => {
      const part = ex.part || "기타";
      if (!grouped.has(part)) {
        grouped.set(part, []);
      }
      grouped.get(part)!.push(ex);
    });
    return grouped;
  }

  // 세션 삭제(기준은 세션 아이디))
  function deleteSession(sessionId: string) {
    const history = localStorage.getItem(sessionKey);
    const parsedHistory: Session[] = history ? JSON.parse(history) : [];
    const updatedSessions = parsedHistory.filter(
      (session) => session.id !== sessionId,
    );
    localStorage.setItem(sessionKey, JSON.stringify(updatedSessions));
    // 로컬에서 지운 기록은 노션으로 다시 보내지 않는다.
    writeOutbox(removeJob(readOutbox(), sessionId));
    onHistoryChanged?.();
  }

  // 세트 삭제(기준은 세션 아이디, 운동 아이디, 세트 번호)
  function deleteSet(sessionId: string, exerciseId: string, setNo: number) {
    const history = localStorage.getItem(sessionKey);
    const parsedHistory: Session[] = history ? JSON.parse(history) : [];
    const updatedSessions = parsedHistory
      .map((session) => {
        if (session.id !== sessionId) return session;

        const updatedExercises = session.exercises
          .map((exercise) => {
            if (exercise.id !== exerciseId) return exercise;

            const updatedSets = exercise.sets.filter(
              (set) => set.setNo !== setNo,
            );
            return { ...exercise, sets: updatedSets };
          })
          .filter((exercise) => exercise.sets.length > 0);

        return { ...session, exercises: updatedExercises };
      })
      .filter((session) => session.exercises.length > 0);

    localStorage.setItem(sessionKey, JSON.stringify(updatedSessions));
    onHistoryChanged?.();
  }

  // 노션으로부터 데이터 복원
  async function handleRestoreFromNotion() {
    if (!notionReady || restoring) return;

    setRestoring(true);
    try {
      const result = await restoreHistoryFromNotion();

      if (!result.ok) {
        toast.error(result.error, { duration: 2000 });
        return;
      }

      if (result.added === 0) {
        toast.info(
          result.skipped > 0
            ? `추가할 기록이 없습니다. (${result.skipped}개 이미 있음)`
            : "Notion에서 가져올 기록이 없습니다.",
          { duration: 2000 },
        );
      } else {
        toast.success(
          `${result.added}개 세션을 가져왔습니다.${result.skipped > 0 ? ` (${result.skipped}개 건너뜀)` : ""}`,
          { duration: 2000 },
        );
      }

      onHistoryChanged?.();
    } finally {
      setRestoring(false);
    }
  }

  // 노션 import 버튼 렌더링 함수
  function renderImportButton() {
    if (!notionReady) return null;

    return (
      <Button
        type="button"
        variant="outline"
        onClick={handleRestoreFromNotion}
        className="h-11 rounded-md border-foreground bg-transparent text-sm font-semibold"
        disabled={restoring}
      >
        {restoring ? "가져오는 중..." : "Notion에서 가져오기"}
      </Button>
    );
  }

  if (!showHistory) return null;

  if (sessions.length === 0) {
    return (
      <main className="p-4 text-center text-muted-foreground space-y-4">
        <p>저장된 운동 기록이 없습니다.</p>
        {notionReady && (
          <p className="text-sm">
            Notion에 기록이 있다면 로컬에 없는 세션만 가져올 수 있습니다.
          </p>
        )}
        <div className="flex justify-center">{renderImportButton()}</div>
      </main>
    );
  }

  const dateGrouped = groupByDate(sessions);
  const dateEntries = Array.from(dateGrouped.entries()).sort((a, b) =>
    b[0].localeCompare(a[0]),
  );

  return (
    <main className="p-4 space-y-6">
      {notionReady && (
        <div className="flex justify-end">{renderImportButton()}</div>
      )}
      {dateEntries.map(([dateStr, dateSessions]) => {
        const sortedSessions = dateSessions.sort(
          (a, b) =>
            new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );

        return (
          <div key={dateStr}>
            <div className="sticky top-0 z-10 border-b border-foreground bg-background py-2 text-lg font-bold tracking-tight">
              {formatDateHeader(dateStr)}
            </div>

            {sortedSessions.map((session) => {
              const { exerciseCount, totalSets, partsStr, durationStr } =
                getSessionSummary(session);
              const partGrouped = groupExercisesByPart(session.exercises);
              const parts = Array.from(partGrouped.keys());

              return (
                <div
                  key={session.id}
                  className="border-b border-border py-4 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-xl font-bold tracking-tight">
                        {session.sessionName || "운동 세션"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {partsStr} · {exerciseCount} exercises · {totalSets}{" "}
                        sets
                        {durationStr && ` · ${durationStr}`}
                      </p>
                      {unsyncedSessionIds.includes(session.id) && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs font-bold text-destructive">
                            노션 미동기화
                          </span>
                          {onRetryNotionJob && (
                            <button
                              type="button"
                              onClick={() => onRetryNotionJob(session.id)}
                              className="flex h-11 items-center border border-foreground px-3 text-sm font-semibold"
                            >
                              다시 보내기
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => deleteSession(session.id)}
                      className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center text-muted-foreground"
                      title="세션 삭제"
                    >
                      <TrashIcon className="size-5" />
                    </button>
                  </div>

                  <div className="mt-2 space-y-5">
                    {parts.map((part) => {
                      const partExercises = partGrouped.get(part) || [];
                      return (
                        <div key={part}>
                          <div className="mt-1 space-y-3">
                            {partExercises.map((ex) => (
                              <div key={ex.id}>
                                <p className="text-lg font-bold tracking-tight">
                                  {ex.name}
                                </p>

                                <ul className="mt-1 border-t border-border">
                                  {ex.sets.map((set) => (
                                    <SwipeableSetRow
                                      key={set.setNo}
                                      onDelete={() =>
                                        deleteSet(session.id, ex.id, set.setNo)
                                      }
                                    >
                                      <span className="text-sm text-muted-foreground">
                                        {String(set.setNo).padStart(2, "0")}
                                      </span>
                                      <span>
                                        {set.weight}
                                        <span className="ml-1 text-xs text-muted-foreground">
                                          kg
                                        </span>
                                      </span>
                                      <span>
                                        {set.reps}
                                        <span className="ml-1 text-xs text-muted-foreground">
                                          회
                                        </span>
                                      </span>
                                    </SwipeableSetRow>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </main>
  );
}
