"use client";

import { useEffect, useState } from "react";
import {
  LibraryCategory,
  LibraryExercise,
  Exercise,
  NotionConnection,
  SessionDraft,
} from "./types";
import { groupExercisesByCategory, getFirstValidCategory } from "@/lib/library";
import { createSessionMetadata } from "@/lib/session-utils";
import { BrandMark } from "@/components/app/brand-mark";
import { CategoryTabs } from "@/components/app/category-tabs";
import { ExerciseRow } from "@/components/app/exercise-row";
import { PageHeader } from "@/components/app/page-header";
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
          <BrandMark />
        </div>
        <PageHeader title="운동 라이브러리">
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
        </PageHeader>
      </header>

      <div className="flex-1 overflow-y-auto">
        <CategoryTabs
          categories={categories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />

        <div className="px-4 pb-4">
          {currentExercises.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {selectedCategory}에 등록된 운동이 없습니다
            </p>
          ) : (
            currentExercises.map((exercise, index) => (
              <ExerciseRow
                key={exercise.id}
                exercise={exercise}
                index={index}
                isSelected={selectedExercises.has(exercise.id)}
                onToggle={() => toggleExerciseSelection(exercise.id)}
              />
            ))
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
