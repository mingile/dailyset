"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useExerciseLibrary } from "@/hooks/useExerciseLibrary";
import { groupExercisesByCategory } from "@/lib/library";
import { getPreviousRecord } from "@/lib/previous-record";
import type { Exercise, Exercises, NotionConnection } from "./types";

function AddExerciseBottomSheet({
  exercises: currentExercises,
  notionConnection,
  addExercisesToSession,
  onClose,
}: {
  exercises: Exercises;
  notionConnection: NotionConnection;
  addExercisesToSession: (newExercises: Exercises) => void;
  onClose: () => void;
}) {
  const { libraryState } = useExerciseLibrary(notionConnection);
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

  const header = (
    <SheetHeader className="gap-0 pb-2">
      <div className="flex items-center justify-between">
        <SheetTitle className="text-2xl font-bold tracking-tight">
          운동 추가
        </SheetTitle>
        <Button
          type="button"
          variant="ghost"
          size="text"
          className="-mr-2"
          onClick={onClose}
        >
          닫기
        </Button>
      </div>
      <SheetDescription>
        세션에 추가할 운동을 선택하세요 (중복 제외됨)
      </SheetDescription>
    </SheetHeader>
  );

  if (libraryState.status === "loading") {
    return (
      <>
        {header}
        <div className="flex items-center justify-center py-8">
          <p className="text-muted-foreground">운동 목록을 불러오는 중...</p>
        </div>
      </>
    );
  }

  if (libraryState.status === "error") {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <p className="text-destructive mb-2">
            운동 목록을 불러오지 못했습니다
          </p>
          <p className="text-sm text-muted-foreground">
            {libraryState.message}
          </p>
        </div>
      </>
    );
  }

  if (libraryState.status === "empty") {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center py-8 px-4">
          <p className="text-muted-foreground mb-2">등록된 운동이 없습니다</p>
          <p className="text-sm text-muted-foreground">
            Exercise DB에 운동을 추가해주세요
          </p>
        </div>
      </>
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
      {header}

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pb-2">
          <input
            type="text"
            placeholder="운동 이름 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 w-full rounded-none border-0 border-b border-foreground bg-transparent text-base outline-none placeholder:text-muted-foreground focus:border-b-2 focus:border-(--session-focus)"
          />
        </div>

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
          {filteredExercises.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {searchQuery
                ? "검색 결과가 없습니다"
                : existingPageIds.size > 0 && availableExercises.length === 0
                  ? "추가 가능한 운동이 없습니다 (모두 추가됨)"
                  : `${selectedCategory}에 등록된 운동이 없습니다`}
            </p>
          ) : (
            filteredExercises.map((exercise, index) => {
              const isSelected = selectedExerciseIds.has(exercise.id);
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

      <div className="border-t border-border px-4 py-4">
        <Button
          size="xl"
          variant={selectedExerciseIds.size === 0 ? "default" : "accent"}
          className={
            selectedExerciseIds.size === 0
              ? "w-full border border-foreground bg-transparent text-foreground hover:bg-transparent"
              : "w-full"
          }
          onClick={handleConfirm}
          disabled={selectedExerciseIds.size === 0}
        >
          추가하기 ({selectedExerciseIds.size})
        </Button>
      </div>
    </>
  );
}

/**
 * 세션 화면의 `운동 추가` 버튼과 시트. 열림 상태와 시트를 이 컴포넌트가 가진다.
 * WorkoutSessionClient는 `addExerciseSlot`으로 이 요소를 받아 그리기만 한다(랜딩 데모는 넘기지 않는다).
 * 운동 라이브러리 조회(useExerciseLibrary)는 시트 내용 안에서만 일어나므로, 시트를 열 때 마운트되고 열기 전에는 조회하지 않는다.
 */
export function AddExerciseSheet({
  exercises,
  notionConnection,
  addExercisesToSession,
}: {
  exercises: Exercises;
  notionConnection: NotionConnection;
  addExercisesToSession: (newExercises: Exercises) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex h-14 w-full items-center gap-3 border-b border-border text-left text-muted-foreground"
        >
          <span className="flex w-6 shrink-0 justify-center">
            <Plus className="size-4" />
          </span>
          <span className="h-6 shrink-0 border-l border-border" />
          <span className="text-lg font-bold tracking-tight">운동 추가</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="session-surface session-font h-[85vh] flex flex-col gap-0 overflow-hidden"
      >
        <AddExerciseBottomSheet
          exercises={exercises}
          notionConnection={notionConnection}
          addExercisesToSession={addExercisesToSession}
          onClose={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
