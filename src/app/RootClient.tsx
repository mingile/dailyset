"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSessionExercises } from "@/hooks/useSessionExercises";
import { reconcileStoredExerciseTimers } from "@/lib/timer";
import { kgToLb, lbToKg } from "@/lib/weightUnit";
import { withBasePath } from "@/lib/base-path";
import {
  fetchWithTimeout,
  NOTION_STATUS_TIMEOUT_MS,
} from "@/lib/fetch-with-timeout";
import {
  addJob,
  flushNotionOutbox,
  readLastKnownDbConnected,
  readOutbox,
  reconcileNotionOutbox,
  retryFailed,
  selectFailedJobs,
  selectPendingJobs,
  writeLastKnownDbConnected,
  writeOutbox,
} from "@/lib/notion-outbox";
import {
  computeHistoryDirty,
  createHistoryPayload,
  createLocalExercisesPayload,
  createNotionExercisesPayload,
} from "@/lib/workoutSessionPayload";
import { HeaderControls } from "./HeaderControls";
import { LibraryClient } from "./LibraryClient";
import {
  type Exercises,
  type ExerciseTimers,
  type NotionConnection,
  type Part,
  SavedExercise,
  type Session,
  type SessionDraft,
  type SessionMetadata,
} from "./types";
import { WorkoutHistoryClient } from "./WorkoutHistoryClient";
import { WorkoutSessionClient } from "./WorkoutSessionClient";

export function RootClient() {
  const {
    exercises,
    historyDirty,
    actions,
    hydrate,
    clearDirty,
    markDirty,
    mergeExternal,
  } = useSessionExercises();
  const [hydrated, setHydrated] = useState(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyVersion, setHistoryVersion] = useState<number>(0);
  const [unsyncedSessionIds, setUnsyncedSessionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [entryMode, setEntryMode] = useState<"loading" | "session" | "library">(
    "loading",
  );
  const [sessionMetadata, setSessionMetadata] =
    useState<SessionMetadata | null>(null);
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [notionStatusLoading, setNotionStatusLoading] = useState<boolean>(true);
  const [notionConnected, setNotionConnected] = useState<boolean>(false);
  const [dbConnected, setDbConnected] = useState<boolean>(false);
  // 운동 라이브러리에 내려주는 연결 상태. dbConnected와 달리 "확인 못 함"과 "연결 안 됨"을 구분한다.
  const [notionConnection, setNotionConnection] =
    useState<NotionConnection>("unknown");

  const savingRef = useRef<boolean>(false);
  // 상태 조회가 실패하면 "연결 안 됨"이 아니라 "확인 못 함"이다.
  const notionStatusUnknownRef = useRef<boolean>(false);

  useEffect(() => {
    if (notionStatusLoading || notionStatusUnknownRef.current) return;
    writeLastKnownDbConnected(dbConnected);
  }, [notionStatusLoading, dbConnected]);

  useEffect(() => {
    if (!hydrated) return;
    if (!dbConnected) return;
    if (entryMode !== "session") return;
    if (!sessionMetadata) return;
    if (!exercises.length) return;

    const fetchWorkoutRecords = async () => {
      try {
        const res = await fetch(withBasePath("/api/notion/workout-records"), {
          method: "GET",
          credentials: "include",
        });

        const data = await res.json();

        function getTitle(properties: any) {
          if (!properties) return null;
          if (!properties.Name) return null;
          if (!Array.isArray(properties.Name.title)) return null;
          if (properties.Name.title.length === 0) return null;
          const title = properties.Name.title
            .map((t: any) => t.plain_text)
            .join("");
          if (title.trim() === "") return null;
          return title;
        }
        function getSetNo(properties: any) {
          if (!properties) return null;
          return properties["Set No"]?.number ?? null;
        }
        function getWeight(properties: any) {
          if (!properties) return null;
          return properties.Weight?.number ?? null;
        }
        function getReps(properties: any) {
          if (!properties) return null;
          return properties.Reps?.number ?? null;
        }
        function getDate(properties: any) {
          if (!properties) return null;
          if (!properties.Date) return null;
          if (!properties.Date.date) return null;
          if (!properties.Date.date.start) return null;
          return properties.Date.date.start;
        }
        function getPart(properties: any) {
          if (!properties) return null;
          if (!properties.Part) return null;
          if (!properties.Part.select) return null;
          if (!properties.Part.select.name) return null;
          return properties.Part.select.name;
        }
        function getMemo(properties: any) {
          if (!properties) return null;
          if (!properties.Memo) return null;
          if (!Array.isArray(properties.Memo.rich_text)) return null;
          if (properties.Memo.rich_text.length === 0) return null;
          const memo = properties.Memo.rich_text
            .map((t: any) => t.plain_text)
            .join("");
          if (memo.trim() === "") return null;
          return memo;
        }

        function getEquipment(properties: any) {
          if (!properties) return null;
          const name = properties.Equipment?.select?.name;
          if (typeof name !== "string" || name.trim() === "") return null;
          switch (name) {
            case "케이블":
              return "cable-machine";
            case "스미스":
              return "smith-machine";
            case "원판":
              return "plate-machine";
            case "바벨":
              return "barbell";
            case "덤벨":
              return "dumbbell";
            default:
              return "cable-machine";
          }
        }

        function getExerciseRelation(properties: any) {
          if (!properties) return null;
          if (!properties.Exercise) return null;
          if (!Array.isArray(properties.Exercise.relation)) return null;
          if (properties.Exercise.relation.length === 0) return null;
          return properties.Exercise.relation[0]?.id ?? null;
        }

        const rawRow = data.results.map((result: any) => {
          return {
            title: getTitle(result.properties),
            setNo: getSetNo(result.properties),
            weight: getWeight(result.properties),
            reps: getReps(result.properties),
            date: getDate(result.properties),
            part: getPart(result.properties),
            exercisePageId: getExerciseRelation(result.properties),
            memo: getMemo(result.properties),
            equipment: getEquipment(result.properties),
          };
        });

        mergeExternal((prev) => {
          // Exercise pageId로 필터링
          const filteredRow = rawRow.filter(
            (row: any) =>
              row.exercisePageId &&
              prev.some((ex: any) => ex.exercisePageId === row.exercisePageId),
          );

          // Exercise pageId 기준으로 그룹핑
          const groupedRow = filteredRow.reduce((acc: any, row: any) => {
            const key = row.exercisePageId;
            if (!acc[key]) {
              acc[key] = [];
            }
            acc[key].push(row);
            return acc;
          }, {});

          // 각 그룹에서 최신 row 1개 선택 (날짜 최신, 같은 날짜면 setNo 큰 것)
          const filteredRowbyExercise = Object.values(groupedRow).map(
            (group: any) => {
              return group.sort((a: any, b: any) => {
                if (new Date(b.date).getTime() === new Date(a.date).getTime()) {
                  return (b.setNo ?? 0) - (a.setNo ?? 0);
                }
                return new Date(b.date).getTime() - new Date(a.date).getTime();
              })[0];
            },
          );

          // Exercise pageId를 key로 맵 생성
          const latestMap = filteredRowbyExercise.reduce(
            (acc: any, row: any) => {
              acc[row.exercisePageId] = row;
              return acc;
            },
            {},
          );

          return prev.map((ex: any) => {
            // Exercise pageId로 최신 기록 조회
            const latest = latestMap[ex.exercisePageId];

            if (!latest) return ex;
            if (ex.sets[0]?.done === true) return ex;

            const newSets = ex.sets.map((set: any, index: number) => {
              if (index !== 0) return set;

              return {
                ...set,
                weight: latest.weight ?? set.weight,
                reps: latest.reps ?? set.reps,
                memo: latest.memo ?? set.memo,
                equipment: latest.equipment ?? set.equipment,
              };
            });

            return {
              ...ex,
              sets: newSets,
            };
          });
        });
      } catch (error) {
        console.error("fetch 실패:", error);
      }
    };

    fetchWorkoutRecords();
  }, [hydrated, dbConnected, entryMode, sessionMetadata?.sessionId]);

  useEffect(() => {
    const storedDraft = localStorage.getItem("workout.currentSession.v1");
    const oldStoredEx = localStorage.getItem("workout.session.v1");

    function isObject(v: unknown): v is Record<string, unknown> {
      return typeof v === "object" && v !== null;
    }
    function isNumber(v: unknown): v is number {
      return typeof v === "number" && Number.isFinite(v);
    }
    function isSetItem(v: unknown): v is {
      weight: number;
      reps: number;
      done: boolean;
      synced: boolean;
      equipment: string;
      memo: string;
      unit?: "kg" | "lb";
      setType?: "warmup" | "main";
    } {
      if (!isObject(v)) return false;
      return (
        isNumber(v.weight) &&
        isNumber(v.reps) &&
        typeof v.done === "boolean" &&
        typeof v.synced === "boolean" &&
        typeof v.equipment === "string" &&
        typeof v.memo === "string" &&
        (v.unit === undefined || v.unit === "kg" || v.unit === "lb") &&
        (v.setType === undefined ||
          v.setType === "warmup" ||
          v.setType === "main")
      );
    }
    function isExercise(
      v: unknown,
    ): v is { id: string; name: string; sets: unknown[] } {
      if (!isObject(v)) return false;
      if (typeof v.id !== "string" || v.id.trim() === "") return false;
      if (typeof v.name !== "string" || v.name.trim() === "") return false;
      if (!Array.isArray(v.sets)) return false;
      if (v.sets.length === 0) return false;
      return v.sets.every(isSetItem);
    }
    function isExerciseArray(v: unknown): v is {
      id: string;
      name: string;
      sets: {
        weight: number;
        reps: number;
        done: boolean;
        synced: boolean;
        equipment: string;
        memo: string;
        unit?: "kg" | "lb";
      }[];
    }[] {
      if (!Array.isArray(v)) return false;
      if (v.length === 0) return false;
      return v.every(isExercise);
    }
    function isPart(v: unknown): v is Part {
      return (
        typeof v === "string" &&
        ["back", "chest", "legs", "shoulders"].includes(v)
      );
    }

    function isSessionMetadata(v: unknown): v is SessionMetadata {
      if (!isObject(v)) return false;
      return (
        typeof v.sessionId === "string" &&
        typeof v.sessionName === "string" &&
        typeof v.startedAt === "string"
      );
    }

    function isSessionDraft(v: unknown): v is SessionDraft {
      if (!isObject(v)) return false;
      return isSessionMetadata(v.session) && isExerciseArray(v.exercises);
    }

    function isLegacySession(
      v: unknown,
    ): v is { selectedPart: Part; exercises: Exercises } {
      if (!isObject(v)) return false;
      return isPart(v.selectedPart) && isExerciseArray(v.exercises);
    }

    try {
      if (storedDraft) {
        const parsedDraft = JSON.parse(storedDraft);
        if (isSessionDraft(parsedDraft)) {
          const migratedExercises = parsedDraft.exercises.map((ex) => {
            const mainSetCount = ex.sets.filter(
              (s) => (s.setType ?? "main") === "main",
            ).length;
            const warmupSetCount = ex.sets.filter(
              (s) => s.setType === "warmup",
            ).length;
            return {
              ...ex,
              sets: ex.sets.map((set) => ({
                ...set,
                unit:
                  set.unit ?? (set.equipment === "cable-machine" ? "lb" : "kg"),
                setType: set.setType ?? "main",
              })),
              targetMainSetCount: ex.targetMainSetCount ?? mainSetCount,
              targetWarmupSetCount: ex.targetWarmupSetCount ?? warmupSetCount,
            };
          });
          hydrate(
            migratedExercises,
            parsedDraft.historyDirty ??
              computeHistoryDirty(
                parsedDraft.session.sessionId,
                migratedExercises,
              ),
          );
          setSessionMetadata(parsedDraft.session);
          if (parsedDraft.exerciseTimers) {
            setExerciseTimers(
              reconcileStoredExerciseTimers(parsedDraft.exerciseTimers),
            );
          }
        } else {
          localStorage.removeItem("workout.currentSession.v1");
        }
      } else if (oldStoredEx) {
        const parsedEx = JSON.parse(oldStoredEx);
        if (isLegacySession(parsedEx)) {
          const migratedExercises = parsedEx.exercises.map((ex) => {
            const mainSetCount = ex.sets.filter(
              (s) => (s.setType ?? "main") === "main",
            ).length;
            const warmupSetCount = ex.sets.filter(
              (s) => s.setType === "warmup",
            ).length;
            return {
              ...ex,
              sets: ex.sets.map((set) => ({
                ...set,
                unit:
                  set.unit ?? (set.equipment === "cable-machine" ? "lb" : "kg"),
                setType: set.setType ?? "main",
              })),
              part: parsedEx.selectedPart,
              targetMainSetCount: ex.targetMainSetCount ?? mainSetCount,
              targetWarmupSetCount: ex.targetWarmupSetCount ?? warmupSetCount,
            };
          });
          hydrate(migratedExercises, false);
        }
        localStorage.removeItem("workout.session.v1");
      }
    } catch (e) {
      console.error("올바르지 않은 JSON 데이터", e);
      localStorage.removeItem("workout.currentSession.v1");
      localStorage.removeItem("workout.session.v1");
    } finally {
      const hasDraft = !!localStorage.getItem("workout.currentSession.v1");
      setEntryMode(hasDraft ? "session" : "library");
      refreshUnsyncedSessionIds();
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    refreshNotionStatus();
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (entryMode !== "session") return;
    if (!exercises.length) return;
    if (!sessionMetadata) return;

    const draftData: SessionDraft = {
      session: sessionMetadata,
      exercises,
      exerciseTimers:
        Object.keys(exerciseTimers).length > 0 ? exerciseTimers : undefined,
      historyDirty,
    };

    localStorage.setItem(
      "workout.currentSession.v1",
      JSON.stringify(draftData),
    );
  }, [
    exercises,
    sessionMetadata,
    exerciseTimers,
    historyDirty,
    hydrated,
    entryMode,
  ]);

  function displayWeightUnit(
    weight: number,
    unit: "kg" | "lb",
  ): { displayWeight: number; displayUnit: "kg" | "lb" } {
    let displayWeight = weight;
    const displayUnit: "kg" | "lb" = unit;

    if (unit === "lb") {
      displayWeight = Math.round(kgToLb(weight));
    } else {
      displayWeight = Math.round(weight * 10) / 10;
    }

    return { displayWeight, displayUnit };
  }

  function onSavedHistory() {
    setHistoryVersion((v) => v + 1);
    refreshUnsyncedSessionIds();
  }

  /** outbox의 failed 작업을 화면 state에 반영한다. */
  function refreshUnsyncedSessionIds() {
    const ids = selectFailedJobs(readOutbox()).map((job) => job.sessionId);
    setUnsyncedSessionIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids,
    );
  }

  function startNewSession() {
    localStorage.removeItem("workout.currentSession.v1");
    setSessionMetadata(null);
    setExerciseTimers({});
    clearDirty();
    setEntryMode("library");
  }

  function handleStartNewSession() {
    const confirmed = window.confirm(
      historyDirty
        ? "저장되지 않은 변경사항이 있습니다.\n새 세션을 시작하시겠습니까?\n(현재 세션이 종료됩니다)"
        : "새 세션을 시작하시겠습니까?\n(현재 세션이 종료됩니다)",
    );
    if (!confirmed) return;

    startNewSession();
    toast.success("새 세션을 시작합니다", {
      duration: 1000,
    });
  }

  function canSyncNotion(): boolean {
    if (dbConnected) return true;
    return (
      notionStatusUnknownRef.current && readLastKnownDbConnected() === true
    );
  }

  useEffect(() => {
    if (!hydrated || notionStatusLoading) return;

    async function flushPendingNotionJobs() {
      // 서버 처리 결과 확인은 노션 연결 상태와 무관하게 queued 작업이 있으면 한다.
      await reconcileNotionOutbox();
      refreshUnsyncedSessionIds();

      if (!canSyncNotion()) return;
      if (selectPendingJobs(readOutbox()).length === 0) return;

      const results = await flushNotionOutbox();
      refreshUnsyncedSessionIds();
      const queued = results.filter((r) => r.outcome === "queued").length;
      if (queued > 0) {
        toast.success(`Notion 동기화 요청 ${queued}건 완료`, {
          duration: 2000,
        });
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void flushPendingNotionJobs();
      }
    }

    void flushPendingNotionJobs();
    window.addEventListener("online", flushPendingNotionJobs);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", flushPendingNotionJobs);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // canSyncNotion은 dbConnected를 읽으므로 dbConnected 변경 시 다시 등록한다.
    // biome-ignore lint/correctness/useExhaustiveDependencies: 위 이유
  }, [hydrated, notionStatusLoading, dbConnected]);

  /** 기록 화면에서 "다시 보내기"를 누른 failed 작업을 pending으로 되돌리고 바로 전송한다. */
  async function handleRetryNotionJob(sessionId: string) {
    writeOutbox(retryFailed(readOutbox(), sessionId, new Date().toISOString()));
    refreshUnsyncedSessionIds();

    if (!canSyncNotion()) {
      toast.info("Notion 미연결", {
        description: "연결되면 다시 보냅니다.",
        duration: 2000,
      });
      return;
    }

    const results = await flushNotionOutbox();
    refreshUnsyncedSessionIds();
    const result = results.find((r) => r.sessionId === sessionId);

    if (!result) {
      toast.info("오프라인", {
        description: "연결되면 Notion에 자동으로 저장됩니다.",
        duration: 3000,
      });
    } else if (result.outcome === "queued") {
      toast.success("Notion 동기화 요청 완료", {
        description: "백그라운드에서 저장됩니다.",
        duration: 2000,
      });
    } else {
      toast.warning("Notion 동기화 요청 실패", {
        description: result.error,
        duration: 3000,
      });
    }
  }

  /** 완료한 세션을 outbox에 기록하고 바로 enqueue를 시도한다. 실패해도 outbox에 남는다. */
  async function queueNotionSessionSync(savedAt: string): Promise<void> {
    if (!canSyncNotion()) {
      toast.info("Notion 미연결", {
        description: "로컬에만 저장되었습니다.",
        duration: 2000,
      });
      return;
    }

    if (!sessionMetadata) {
      toast.warning("세션 정보가 없어 Notion 동기화를 건너뜁니다.", {
        duration: 2000,
      });
      return;
    }

    const notionExercises = createNotionExercisesPayload(exercises);

    if (notionExercises.length === 0) {
      toast.info("모든 세트가 이미 동기화됨", {
        duration: 2000,
      });
      return;
    }

    const hasInvalidExercise = notionExercises.some((ex) => !ex.exercisePageId);
    if (hasInvalidExercise) {
      toast.warning("일부 운동에 Exercise 정보가 없습니다.", {
        description: "로컬은 저장됨, Notion 동기화는 건너뜀",
        duration: 3000,
      });
      return;
    }

    const sessionId = sessionMetadata.sessionId;
    const saved = writeOutbox(
      addJob(
        readOutbox(),
        {
          sessionId,
          sessionName: sessionMetadata.sessionName,
          startedAt: sessionMetadata.startedAt,
          savedAt,
          exercises: notionExercises,
        },
        new Date().toISOString(),
      ),
    );

    if (!saved) {
      toast.warning("Notion 동기화 대기열 저장 실패", {
        description: "로컬은 저장됨, Notion 동기화는 건너뜀",
        duration: 3000,
      });
      return;
    }

    const results = await flushNotionOutbox();
    refreshUnsyncedSessionIds();
    const result = results.find((r) => r.sessionId === sessionId);

    if (!result) {
      toast.info("오프라인", {
        description: "연결되면 Notion에 자동으로 저장됩니다.",
        duration: 3000,
      });
    } else if (result.outcome === "queued") {
      toast.success("Notion 동기화 요청 완료", {
        description: "백그라운드에서 저장됩니다.",
        duration: 2000,
      });
    } else if (result.outcome === "retry") {
      toast.warning("Notion 동기화 요청 실패", {
        description: "로컬은 저장됨, 연결되면 다시 보냅니다.",
        duration: 3000,
      });
    } else {
      toast.warning("Notion 동기화 요청 실패", {
        description: "로컬은 저장됨: " + result.error,
        duration: 3000,
      });
    }
  }

  function persistSessionLocally():
    | { ok: true; savedAt: string }
    | { ok: false } {
    const savedAt = new Date().toISOString();
    const sessionId = sessionMetadata?.sessionId || new Date().toISOString();
    const sessionName = sessionMetadata?.sessionName || "세션";

    const localExercises = createLocalExercisesPayload(exercises);

    if (localExercises.length === 0) {
      return { ok: false };
    }

    const currentSessionSnapshot: SessionDraft = {
      session: sessionMetadata!,
      exercises: exercises,
      exerciseTimers:
        Object.keys(exerciseTimers).length > 0 ? exerciseTimers : undefined,
    };
    localStorage.setItem(
      "workout.currentSession.v1",
      JSON.stringify(currentSessionSnapshot),
    );

    const now = Date.now();
    const durationSeconds = sessionMetadata?.startedAt
      ? Math.floor((now - new Date(sessionMetadata.startedAt).getTime()) / 1000)
      : undefined;

    const historyPayload = createHistoryPayload({
      sessionId,
      sessionName,
      savedAt,
      localExercises,
      durationSeconds,
    });

    const sessionKey = "workout.sessions.v1";
    let sessionData: Session[] = [];
    try {
      const session = localStorage.getItem(sessionKey);
      if (session) {
        sessionData = JSON.parse(session);
        if (!Array.isArray(sessionData)) {
          sessionData = [];
        }
      }
    } catch (e) {
      console.error("올바르지 않은 JSON 데이터", e);
      sessionData = [];
    }

    const filtered = sessionData.filter((s) => s.id !== sessionId);
    const nextSessions = [historyPayload, ...filtered];
    localStorage.setItem(sessionKey, JSON.stringify(nextSessions));
    onSavedHistory();
    clearDirty();

    return { ok: true, savedAt };
  }

  async function handleCompleteWorkout() {
    if (savingRef.current) {
      console.log("이미 저장 중입니다");
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const result = persistSessionLocally();

      if (!result.ok) {
        toast.error("저장할 내용이 없습니다.", {
          duration: 1000,
        });
        return;
      }

      await queueNotionSessionSync(result.savedAt);

      startNewSession();
      toast.success("운동을 완료했습니다", {
        duration: 1000,
      });
    } catch (error) {
      console.error("운동 완료 처리 중 오류:", error);
      toast.error("운동 완료 처리 중 오류 발생", {
        duration: 2000,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function changeSessionName(newName: string) {
    markDirty();
    setSessionMetadata((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sessionName: newName,
      };
    });
  }

  async function refreshNotionStatus() {
    // 조회에 실패하면 "연결 안 됨"이 아니라 "확인 못 함"이다. 단 401은 쿠키가 없다는 확정 응답(연결한 적 없음)이다.
    let nextConnection: NotionConnection = "unknown";
    try {
      setNotionStatusLoading(true);

      const res = await fetchWithTimeout(
        withBasePath("/api/notion/status"),
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
        NOTION_STATUS_TIMEOUT_MS,
      );

      if (!res.ok) {
        if (res.status === 401) nextConnection = "disconnected";
        throw new Error(`Notion status HTTP ${res.status}`);
      }
      const data = await res.json();

      notionStatusUnknownRef.current = false;
      nextConnection = data.dbConnected ? "connected" : "disconnected";
      setNotionConnected(!!data.notionConnected);
      setDbConnected(!!data.dbConnected);
    } catch (err) {
      console.error("Notion 상태 조회 중 오류", err);
      notionStatusUnknownRef.current = true;
      setNotionConnected(false);
      setDbConnected(false);
    } finally {
      setNotionConnection(nextConnection);
      setNotionStatusLoading(false);
    }
  }

  /** HeaderControls가 연결 해제 뒤 다시 확인한 결과를 반영한다 */
  function handleNotionReadyChange(ready: boolean) {
    setDbConnected(ready);
    setNotionConnection(ready ? "connected" : "disconnected");
  }

  if (notionStatusLoading) {
    return (
      <div className=" session-surface session-font s flex flex-col h-100vh min-h-screen text-center items-center justify-center">
        Loading...
      </div>
    );
  }

  if (entryMode === "loading") {
    return (
      <div className=" session-surface session-font flex flex-col h-100vh min-h-screen text-center items-center justify-center">
        Loading...
      </div>
    );
  }

  if (entryMode === "library") {
    return (
      <LibraryClient
        notionConnection={notionConnection}
        onConfirmSelection={(draft) => {
          hydrate(draft.exercises, false);
          setSessionMetadata(draft.session);
          setEntryMode("session");
        }}
      />
    );
  }

  if (entryMode === "session") {
    return (
      <div className="session-surface session-font flex flex-col h-100vh min-h-screen">
        <HeaderControls
          notionReady={dbConnected}
          setNotionReady={handleNotionReadyChange}
          sessionMetadata={sessionMetadata}
          changeSessionName={changeSessionName}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
          historyVersion={historyVersion}
          onHistoryChanged={onSavedHistory}
          unsyncedSessionIds={unsyncedSessionIds}
          onRetryNotionJob={handleRetryNotionJob}
          onStartNewSession={handleStartNewSession}
        />
        {!showHistory && (
          <WorkoutSessionClient
            notionConnection={notionConnection}
            exercises={exercises}
            displayWeightUnit={displayWeightUnit}
            actions={actions}
            sessionMetadata={sessionMetadata}
            exerciseTimers={exerciseTimers}
            onExerciseTimersChange={setExerciseTimers}
            onCompleteWorkout={handleCompleteWorkout}
            saving={saving}
          />
        )}
        {showHistory && (
          <div className="overflow-y-auto flex-grow pb-16">
            <WorkoutHistoryClient
              showHistory={showHistory}
              historyVersion={historyVersion}
              selectedDate={selectedDate}
              notionReady={dbConnected}
              onHistoryChanged={onSavedHistory}
              unsyncedSessionIds={unsyncedSessionIds}
              onRetryNotionJob={handleRetryNotionJob}
            />
          </div>
        )}
      </div>
    );
  }
}
