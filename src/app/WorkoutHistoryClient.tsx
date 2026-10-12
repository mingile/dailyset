"use client";

import { useEffect, useState } from "react";
import { Session, SavedExercise } from "./types";
import { TrashIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { restoreHistoryFromNotion } from "@/lib/notion/restoreLocalHistory";

const sessionKey = `workout.sessions.v1`;

// 로컬 표준 시간 가져오기, 근데 왜 스웨덴 시간?
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

export function WorkoutHistoryClient({
  showHistory,
  historyVersion,
  selectedDate,
  notionReady = false,
  onHistoryChanged,
}: {
  showHistory: boolean;
  historyVersion: number;
  selectedDate: string | null;
  notionReady?: boolean;
  onHistoryChanged?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [swipingSet, setSwipingSet] = useState<string | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
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

  // 터치 시작 이벤트
  function handleTouchStart(e: React.TouchEvent, setKey: string) {
    const touch = e.touches[0];
    setSwipingSet(setKey);
    setSwipeOffset(0);
    (e.currentTarget as HTMLElement).dataset.startX = String(touch.clientX);
  }

  // 터치 이벤트 이동 중 좌표 계산
  function handleTouchMove(e: React.TouchEvent, setKey: string) {
    if (swipingSet !== setKey) return;

    const touch = e.touches[0];
    const startX = Number((e.currentTarget as HTMLElement).dataset.startX);
    const currentX = touch.clientX;
    const diff = currentX - startX;

    if (diff < 0) {
      setSwipeOffset(Math.max(diff, -100));
    }
  }

  // 터치 끝날 때 이벤트
  function handleTouchEnd(
    sessionId: string,
    exerciseId: string,
    setNo: number,
  ) {
    if (swipeOffset < -50) {
      deleteSet(sessionId, exerciseId, setNo);
    }
    setSwipingSet(null);
    setSwipeOffset(0);
  }

  // 스와이핑에 대한 마우스 클릭 이벤트
  function handleMouseDown(e: React.MouseEvent, setKey: string) {
    setSwipingSet(setKey);
    setSwipeOffset(0);
    (e.currentTarget as HTMLElement).dataset.startX = String(e.clientX);
  }

  // 스와이핑 마우스 이동 이벤트
  function handleMouseMove(e: React.MouseEvent, setKey: string) {
    if (swipingSet !== setKey) return;

    const startX = Number((e.currentTarget as HTMLElement).dataset.startX);
    const currentX = e.clientX;
    const diff = currentX - startX;

    if (diff < 0) {
      setSwipeOffset(Math.max(diff, -100));
    }
  }

  // 스와이핑 마우스 끝날 때 이벤트
  function handleMouseUp(sessionId: string, exerciseId: string, setNo: number) {
    if (swipeOffset < -50) {
      deleteSet(sessionId, exerciseId, setNo);
    }
    setSwipingSet(null);
    setSwipeOffset(0);
  }

  // 마우스 커서가 html 요소 바깥으로 이동할 때
  function handleMouseLeave() {
    setSwipingSet(null);
    setSwipeOffset(0);
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
                                  {ex.sets.map((set) => {
                                    const setKey = `${session.id}-${ex.id}-${set.setNo}`;
                                    const isActive = swipingSet === setKey;
                                    const offset = isActive ? swipeOffset : 0;

                                    return (
                                      <li
                                        key={set.setNo}
                                        className="relative cursor-pointer overflow-hidden"
                                        onTouchStart={(e) =>
                                          handleTouchStart(e, setKey)
                                        }
                                        onTouchMove={(e) =>
                                          handleTouchMove(e, setKey)
                                        }
                                        onTouchEnd={() =>
                                          handleTouchEnd(
                                            session.id,
                                            ex.id,
                                            set.setNo,
                                          )
                                        }
                                        onMouseDown={(e) =>
                                          handleMouseDown(e, setKey)
                                        }
                                        onMouseMove={(e) =>
                                          handleMouseMove(e, setKey)
                                        }
                                        onMouseUp={() =>
                                          handleMouseUp(
                                            session.id,
                                            ex.id,
                                            set.setNo,
                                          )
                                        }
                                        onMouseLeave={handleMouseLeave}
                                      >
                                        <div className="absolute inset-0 bg-destructive flex items-center justify-end pr-4">
                                          <TrashIcon className="size-4 text-white" />
                                        </div>
                                        <div
                                          className="grid min-h-11 grid-cols-[2.5rem_1fr_1fr] items-center gap-1 border-b border-border bg-background px-1 text-base tabular-nums transition-transform"
                                          style={{
                                            transform: `translateX(${offset}px)`,
                                          }}
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
                                        </div>
                                      </li>
                                    );
                                  })}
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
