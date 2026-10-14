"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  LibraryCategory,
  LibraryExercise,
  Exercise,
  NotionConnection,
  SessionDraft,
} from "./types";
import { groupExercisesByCategory, getFirstValidCategory } from "@/lib/library";
import { createSessionMetadata } from "@/lib/session-utils";
import { Button } from "@/components/ui/button";
import { useExerciseLibrary } from "@/hooks/useExerciseLibrary";
import { getPreviousRecord } from "@/lib/previous-record";
import { withBasePath } from "@/lib/base-path";

function convertLibraryExerciseToSessionExercise(
  libraryExercise: LibraryExercise,
): Exercise {
  return {
    id: libraryExercise.id,
    name: libraryExercise.name,
    sets: getPreviousRecord(libraryExercise.name, libraryExercise.equipment),
    part: libraryExercise.category,
    exercisePageId: libraryExercise.notionPageId,
  };
}

interface LibraryClientProps {
  notionConnection: NotionConnection;
  onConfirmSelection: (draft: SessionDraft) => void;
}

export function LibraryClient({
  notionConnection,
  onConfirmSelection,
}: LibraryClientProps) {
  const { libraryState, refetch } = useExerciseLibrary(notionConnection);
  const [selectedCategory, setSelectedCategory] =
    useState<LibraryCategory | null>(null);
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(
    new Set(),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (libraryState.status === "success" && selectedCategory === null) {
      const firstCategory = getFirstValidCategory(libraryState.categories);
      if (firstCategory) {
        setSelectedCategory(firstCategory);
      }
    }
  }, [libraryState, selectedCategory]);

  function toggleExerciseSelection(exerciseId: string) {
    setSelectedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });

    if (validationError) {
      setValidationError(null);
    }
  }

  function handleConfirmSelection() {
    if (selectedExercises.size === 0) {
      setValidationError("운동을 최소 1개 이상 선택해주세요");
      return;
    }

    if (libraryState.status !== "success") {
      setValidationError("운동 데이터를 불러오지 못했습니다");
      return;
    }

    const selectedIds: string[] = Array.from(selectedExercises);

    const exerciseMap = new Map<string, LibraryExercise>();
    for (const exercise of libraryState.exercises) {
      exerciseMap.set(exercise.id, exercise);
    }

    const sessionExercises: Exercise[] = [];
    for (const id of selectedIds) {
      const libraryExercise = exerciseMap.get(id);
      if (libraryExercise) {
        sessionExercises.push(
          convertLibraryExerciseToSessionExercise(libraryExercise),
        );
      }
    }

    if (sessionExercises.length === 0) {
      setValidationError("선택한 운동 데이터를 변환하지 못했습니다");
      return;
    }

    try {
      const sessionMetadata = createSessionMetadata();

      const draftData: SessionDraft = {
        session: sessionMetadata,
        exercises: sessionExercises,
      };

      localStorage.setItem(
        "workout.currentSession.v1",
        JSON.stringify(draftData),
      );

      onConfirmSelection(draftData);
    } catch (error) {
      console.error("localStorage 저장 실패:", error);
      setValidationError("선택 내용을 저장하지 못했습니다. 다시 시도해주세요");
    }
  }

  if (libraryState.status === "loading") {
    return (
      <div className="session-surface session-font flex flex-col h-screen items-center justify-center">
        <p className="text-muted-foreground">운동 목록을 불러오는 중...</p>
      </div>
    );
  }

  if (libraryState.status === "error") {
    return (
      <div className="session-surface session-font flex flex-col h-screen items-center justify-center px-4">
        <p className="text-destructive mb-4">운동 목록을 불러오지 못했습니다</p>
        <p className="text-sm text-muted-foreground mb-4">
          {libraryState.message}
        </p>
        <Button onClick={refetch}>다시 시도</Button>
      </div>
    );
  }

  if (libraryState.status === "empty") {
    return (
      <div className="session-surface session-font flex flex-col h-screen items-center justify-center px-4">
        <p className="text-muted-foreground mb-4">등록된 운동이 없습니다</p>
        <p className="text-sm text-muted-foreground">
          Exercise DB에 운동을 추가해주세요
        </p>
      </div>
    );
  }

  const { exercises, categories } = libraryState;
  const grouped = groupExercisesByCategory(exercises);
  const currentExercises = selectedCategory
    ? grouped.get(selectedCategory) || []
    : [];

  return (
    <div className="session-surface session-font flex flex-col h-screen">
      <header className="px-4">
        <div className="flex min-h-14 items-center">
          <span className="flex items-center gap-1.5 font-(family-name:--font-brand) text-xl font-medium tracking-[0.2em]">
            <span className="size-2 rounded-full bg-(--session-accent)" />
            <span>daily</span>
            <span className="text-(--session-muted)">set</span>
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">운동 라이브러리</h1>
        {libraryState.status === "success" &&
          libraryState.source === "builtin" &&
          libraryState.message && (
            <div className="mt-3 flex items-center gap-2 border-l-2 border-(--session-accent) pl-3 text-xs text-muted-foreground">
              {libraryState.message}
              <Button
                variant="ghost"
                className="ml-auto h-11 px-2 text-xs underline underline-offset-4"
                onClick={() => {
                  window.location.href = withBasePath("/settings/notion");
                }}
              >
                Notion 연동 설정
              </Button>
            </div>
          )}
        <div className="mt-3 border-b border-foreground" />
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 border-b border-border bg-background">
          <div className="flex overflow-x-auto px-4">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`h-11 whitespace-nowrap border-b-2 px-3 text-sm ${
                  selectedCategory === category
                    ? "border-foreground font-bold"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 pb-4">
          {currentExercises.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {selectedCategory}에 등록된 운동이 없습니다
            </p>
          ) : (
            currentExercises.map((exercise, index) => {
              const isSelected = selectedExercises.has(exercise.id);
              const subtitle = [exercise.equipment, exercise.primaryEffect]
                .filter(Boolean)
                .join(" · ");

              return (
                <button
                  key={exercise.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleExerciseSelection(exercise.id)}
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
            })
          )}
        </div>
      </div>

      <div className="border-t border-border px-4 py-4 bg-background">
        {validationError && (
          <p className="mb-3 border-l-2 border-destructive pl-3 text-sm text-destructive">
            {validationError}
          </p>
        )}
        <Button
          size="xl"
          variant={selectedExercises.size === 0 ? "default" : "accent"}
          className={
            selectedExercises.size === 0
              ? "w-full border border-foreground bg-transparent text-foreground hover:bg-transparent"
              : "w-full"
          }
          onClick={handleConfirmSelection}
        >
          선택 완료 ({selectedExercises.size})
        </Button>
      </div>
    </div>
  );
}
