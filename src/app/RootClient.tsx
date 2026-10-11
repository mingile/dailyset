"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTimerTick } from "@/hooks/useTimerTick";
import {
  elapsedSecondsFromStartedAt,
  reconcileStoredExerciseTimers,
} from "@/lib/timer";
import { kgToLb, lbToKg, nextWeight } from "@/lib/weightUnit";
import { withBasePath } from "@/lib/base-path";
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
  type Part,
  SavedExercise,
  type Session,
  type SessionDraft,
  type SessionMetadata,
} from "./types";
import { WorkoutHistoryClient } from "./WorkoutHistoryClient";
import { WorkoutSessionClient } from "./WorkoutSessionClient";

export function RootClient() {
  const [exercises, setExercises] = useState<Exercises>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [historyVersion, setHistoryVersion] = useState<number>(0);
  const [saving, setSaving] = useState<boolean>(false);
  const [entryMode, setEntryMode] = useState<"loading" | "session" | "library">(
    "loading",
  );
  const [sessionMetadata, setSessionMetadata] =
    useState<SessionMetadata | null>(null);
  const [exerciseTimers, setExerciseTimers] = useState<ExerciseTimers>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [historyDirty, setHistoryDirty] = useState<boolean>(false);
  const [notionStatusLoading, setNotionStatusLoading] = useState<boolean>(true);
  const [notionConnected, setNotionConnected] = useState<boolean>(false);
  const [dbConnected, setDbConnected] = useState<boolean>(false);

  const savingRef = useRef<boolean>(false);

  useTimerTick(!!sessionMetadata);

  const currentDurationSeconds = sessionMetadata
    ? elapsedSecondsFromStartedAt(sessionMetadata.startedAt)
    : 0;

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

        setExercises((prev) => {
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
          setExercises(migratedExercises);
          setSessionMetadata(parsedDraft.session);
          setHistoryDirty(
            parsedDraft.historyDirty ??
              computeHistoryDirty(
                parsedDraft.session.sessionId,
                migratedExercises,
              ),
          );
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
          setExercises(migratedExercises);
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

  function markHistoryDirty() {
    setHistoryDirty(true);
  }

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

  function deleteSet(exId: string, setIdx: number) {
    markHistoryDirty();
    setExercises((prev) => {
      return prev.map((ex) => {
        if (ex.id !== exId) return ex;
        if (ex.sets.length === 1) return ex;

        const deletedSet = ex.sets[setIdx];
        if (!deletedSet) return ex;

        const deletedSetType = deletedSet.setType ?? "main";

        let newTargetWarmup = ex.targetWarmupSetCount ?? 0;
        let newTargetMain = ex.targetMainSetCount ?? 0;

        if (deletedSetType === "warmup") {
          newTargetWarmup = Math.max(0, newTargetWarmup - 1);
        } else if (deletedSetType === "main") {
          newTargetMain = Math.max(1, newTargetMain - 1);
        }

        return {
          ...ex,
          targetWarmupSetCount: newTargetWarmup,
          targetMainSetCount: newTargetMain,
          sets: ex.sets.filter((set, idx) => idx !== setIdx),
        };
      });
    });
  }

  function changeReps(exIdx: number, setIdx: number, delta: number) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, reps: Math.max(0, s.reps + delta), synced: false };
          }),
        };
      }),
    );
  }

  function changeWeight(exIdx: number, setIdx: number, nextWeight: number) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, weight: nextWeight, synced: false };
          }),
        };
      }),
    );
  }

  function changeMemo(exIdx: number, setIdx: number, value: string) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, memo: value, synced: false };
          }),
        };
      }),
    );
  }

  function changeEquipment(exIdx: number, setIdx: number, equipment: string) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, equipment, synced: false };
          }),
        };
      }),
    );
  }

  function changeUnit(exIdx: number, setIdx: number, unit: "kg" | "lb") {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, unit, synced: false };
          }),
        };
      }),
    );
  }

  function toggleDone(exIdx: number, setIdx: number) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, done: !s.done };
          }),
        };
      }),
    );
  }
  function addSet(exIdx: number) {
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: [
            ...ex.sets,
            {
              weight: ex.sets[ex.sets.length - 1].weight,
              reps: ex.sets[ex.sets.length - 1].reps,
              done: false,
              synced: false,
              equipment: ex.sets[ex.sets.length - 1].equipment,
              memo: "",
              unit: ex.sets[ex.sets.length - 1].unit,
              setType: ex.sets[ex.sets.length - 1].setType || "main",
            },
          ],
        };
      }),
    );
  }

  function changeSetType(
    exIdx: number,
    setIdx: number,
    newSetType: "warmup" | "main",
  ) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;

        const oldSetType = ex.sets[setIdx]?.setType ?? "main";

        if (oldSetType === newSetType) return ex;

        let newTargetWarmup = ex.targetWarmupSetCount ?? 0;
        let newTargetMain = ex.targetMainSetCount ?? 0;

        if (oldSetType === "main" && newSetType === "warmup") {
          newTargetMain = Math.max(1, newTargetMain - 1);
          newTargetWarmup = newTargetWarmup + 1;
        } else if (oldSetType === "warmup" && newSetType === "main") {
          newTargetWarmup = Math.max(0, newTargetWarmup - 1);
          newTargetMain = newTargetMain + 1;
        }

        return {
          ...ex,
          targetWarmupSetCount: newTargetWarmup,
          targetMainSetCount: newTargetMain,
          sets: ex.sets.map((s, j) => {
            if (j !== setIdx) return s;
            return { ...s, setType: newSetType, synced: false };
          }),
        };
      }),
    );
  }

  function changeTargetMainSetCount(exIdx: number, delta: number) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const currentTarget = ex.targetMainSetCount || 0;
        const nextTarget = Math.max(0, currentTarget + delta);

        if (delta > 0) {
          const currentMainSetCount = ex.sets.filter(
            (s) => (s.setType ?? "main") === "main",
          ).length;

          if (currentMainSetCount < nextTarget) {
            const lastMainIndex =
              ex.sets
                .map((s, idx) => ({ s, idx }))
                .reverse()
                .find(({ s }) => (s.setType ?? "main") === "main")?.idx ??
              ex.sets.length - 1;

            const templateSet =
              ex.sets[lastMainIndex] || ex.sets[ex.sets.length - 1];

            const newSet = {
              weight: templateSet.weight,
              reps: templateSet.reps,
              done: false,
              synced: false,
              equipment: templateSet.equipment,
              memo: "",
              unit: templateSet.unit,
              setType: "main" as const,
            };

            const newSets = [...ex.sets];
            newSets.splice(lastMainIndex + 1, 0, newSet);

            return {
              ...ex,
              targetMainSetCount: nextTarget,
              sets: newSets,
            };
          }
        }

        return {
          ...ex,
          targetMainSetCount: nextTarget,
        };
      }),
    );
  }

  function changeTargetWarmupSetCount(exIdx: number, delta: number) {
    markHistoryDirty();
    setExercises((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const currentTarget = ex.targetWarmupSetCount || 0;
        const nextTarget = Math.max(0, currentTarget + delta);

        if (delta > 0) {
          const currentWarmupSetCount = ex.sets.filter(
            (s) => s.setType === "warmup",
          ).length;

          if (currentWarmupSetCount < nextTarget) {
            const lastWarmupIndex =
              ex.sets
                .map((s, idx) => ({ s, idx }))
                .reverse()
                .find(({ s }) => (s.setType ?? "main") === "warmup")?.idx ?? -1;

            const templateSet =
              lastWarmupIndex >= 0 ? ex.sets[lastWarmupIndex] : ex.sets[0];

            const newSet = {
              weight: templateSet?.weight ?? 0,
              reps: templateSet?.reps ?? 0,
              done: false,
              synced: false,
              equipment: templateSet?.equipment ?? "cable-machine",
              memo: "",
              unit: templateSet?.unit ?? "kg",
              setType: "warmup" as const,
            };

            const insertIndex = lastWarmupIndex + 1;
            const newSets = [...ex.sets];
            newSets.splice(insertIndex, 0, newSet);

            return {
              ...ex,
              targetWarmupSetCount: nextTarget,
              sets: newSets,
            };
          }
        }

        return {
          ...ex,
          targetWarmupSetCount: nextTarget,
        };
      }),
    );
  }

  function addExercisesToSession(newExercises: Exercises) {
    markHistoryDirty();
    setExercises((prev) => {
      const existingPageIds = new Set(
        prev.map((ex) => ex.exercisePageId).filter(Boolean),
      );

      const uniqueNewExercises = newExercises.filter(
        (ex) => !existingPageIds.has(ex.exercisePageId),
      );

      return [...prev, ...uniqueNewExercises];
    });
  }

  function clearDoneStatus() {
    if (confirm("체크 상태를 초기화하시겠습니까?")) {
      markHistoryDirty();
      setExercises((prev) =>
        prev.map((ex) => ({
          ...ex,
          sets: ex.sets.map((set) => ({
            ...set,
            done: false,
          })),
        })),
      );
    }
  }

  function onSavedHistory() {
    setHistoryVersion((v) => v + 1);
  }

  function startNewSession() {
    localStorage.removeItem("workout.currentSession.v1");
    setSessionMetadata(null);
    setExerciseTimers({});
    setHistoryDirty(false);
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

  async function enqueueNotionSessionSync(savedAt: string): Promise<boolean> {
    if (!dbConnected) {
      toast.info("Notion 미연결", {
        description: "로컬에만 저장되었습니다.",
        duration: 2000,
      });
      return false;
    }

    if (!sessionMetadata) {
      toast.warning("세션 정보가 없어 Notion 동기화를 건너뜁니다.", {
        duration: 2000,
      });
      return true;
    }

    const notionExercises = createNotionExercisesPayload(exercises);

    if (notionExercises.length === 0) {
      toast.info("모든 세트가 이미 동기화됨", {
        duration: 2000,
      });
      return true;
    }

    const hasInvalidExercise = notionExercises.some((ex) => !ex.exercisePageId);
    if (hasInvalidExercise) {
      toast.warning("일부 운동에 Exercise 정보가 없습니다.", {
        description: "로컬은 저장됨, Notion 동기화는 건너뜀",
        duration: 3000,
      });
      return true;
    }

    try {
      const enqueueResponse = await fetch(withBasePath("/api/sync/enqueue"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionMetadata.sessionId,
          sessionName: sessionMetadata.sessionName,
          startedAt: sessionMetadata.startedAt,
          savedAt,
          exercises: notionExercises,
        }),
      });

      if (!enqueueResponse.ok) {
        const errorData = await enqueueResponse.json();
        toast.warning("Notion 동기화 요청 실패", {
          description: "로컬은 저장됨: " + errorData.error,
          duration: 3000,
        });
        return false;
      }

      toast.success("Notion 동기화 요청 완료", {
        description: "백그라운드에서 저장됩니다.",
        duration: 2000,
      });
      return true;
    } catch (error) {
      console.error("Sync enqueue 중 오류:", error);
      toast.warning("Notion 동기화 요청 실패", {
        description: "로컬은 저장됨, 네트워크 확인 필요",
        duration: 3000,
      });
      return false;
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
    setHistoryDirty(false);

    return { ok: true, savedAt };
  }

  async function saveSession() {
    // useRef 기반 lock으로 중복 실행 방지
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

      toast.success("로컬 저장 완료");
    } catch (error) {
      console.error("저장 중 예상치 못한 오류:", error);
      toast.error("저장 중 오류 발생", {
        duration: 2000,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
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

      if (dbConnected) {
        await enqueueNotionSessionSync(result.savedAt);
      }

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
    markHistoryDirty();
    setSessionMetadata((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sessionName: newName,
      };
    });
  }

  async function refreshNotionStatus() {
    try {
      setNotionStatusLoading(true);

      const res = await fetch(withBasePath("/api/notion/status"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const data = await res.json();

      setNotionConnected(!!data.notionConnected);
      setDbConnected(!!data.dbConnected);
    } catch (err) {
      console.error("Notion 상태 조회 중 오류", err);
      setNotionConnected(false);
      setDbConnected(false);
    } finally {
      setNotionStatusLoading(false);
    }
  }

  if (notionStatusLoading) {
    return (
      <div className="flex flex-col h-100vh min-h-screen text-center items-center justify-center">
        Loading...
      </div>
    );
  }

  if (entryMode === "loading") {
    return (
      <div className="flex flex-col h-100vh min-h-screen text-center items-center justify-center">
        Loading...
      </div>
    );
  }

  if (entryMode === "library") {
    return (
      <LibraryClient
        onConfirmSelection={(draft) => {
          setExercises(draft.exercises);
          setSessionMetadata(draft.session);
          setHistoryDirty(false);
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
          setNotionReady={setDbConnected}
          sessionMetadata={sessionMetadata}
          changeSessionName={changeSessionName}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
          historyVersion={historyVersion}
          currentDurationSeconds={currentDurationSeconds}
          onHistoryChanged={onSavedHistory}
          onStartNewSession={handleStartNewSession}
        />
        {!showHistory && (
          <WorkoutSessionClient
            exercises={exercises}
            changeReps={changeReps}
            changeWeight={changeWeight}
            toggleDone={toggleDone}
            addSet={addSet}
            changeMemo={changeMemo}
            deleteSet={deleteSet}
            displayWeightUnit={displayWeightUnit}
            nextWeight={nextWeight}
            changeEquipment={changeEquipment}
            changeUnit={changeUnit}
            changeSetType={changeSetType}
            changeTargetMainSetCount={changeTargetMainSetCount}
            changeTargetWarmupSetCount={changeTargetWarmupSetCount}
            sessionMetadata={sessionMetadata}
            exerciseTimers={exerciseTimers}
            onExerciseTimersChange={setExerciseTimers}
            addExercisesToSession={addExercisesToSession}
            onSave={saveSession}
            onCompleteWorkout={handleCompleteWorkout}
            onStartNewSession={handleStartNewSession}
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
            />
          </div>
        )}
      </div>
    );
  }
}
