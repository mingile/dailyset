import { useEffect, useState } from "react";
import type {
  LibraryCategory,
  LibraryExercise,
  LibraryState,
} from "@/app/types";
import {
  getOrderedCategories,
  groupExercisesByCategory,
  transformNotionRowToLibraryExercise,
} from "@/lib/library";
import { withBasePath } from "@/lib/base-path";
import {
  fetchWithTimeout,
  NOTION_STATUS_TIMEOUT_MS,
} from "@/lib/fetch-with-timeout";
import builtinExercises from "@/data/exercises.json";

function transformBuiltinExerciseToLibraryExercise(builtin: {
  id: string;
  name: string;
  part: string;
  equipment: string;
}): LibraryExercise {
  return {
    id: builtin.id,
    name: builtin.name,
    category: builtin.part as LibraryCategory,
    equipment: builtin.equipment,
  };
}

function createBuiltinLibraryState(message: string): LibraryState {
  const exercises: LibraryExercise[] = builtinExercises.map(
    transformBuiltinExerciseToLibraryExercise,
  );

  if (exercises.length === 0) {
    return { status: "empty" };
  }

  const grouped = groupExercisesByCategory(exercises);
  const categories = getOrderedCategories(grouped);

  return {
    status: "success",
    exercises,
    categories,
    source: "builtin",
    message,
  };
}

export function useExerciseLibrary() {
  const [libraryState, setLibraryState] = useState<LibraryState>({
    status: "loading",
  });

  async function fetchExercises() {
    try {
      setLibraryState({ status: "loading" });

      const statusRes = await fetchWithTimeout(
        withBasePath("/api/notion/status"),
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
        NOTION_STATUS_TIMEOUT_MS,
      );

      let notionConnected = false;
      let dbConnected = false;

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        notionConnected = statusData.notionConnected || false;
        dbConnected = statusData.dbConnected || false;
      }

      if (!notionConnected || !dbConnected) {
        setLibraryState(
          createBuiltinLibraryState(
            "노션 미연동 상태입니다. 기본 운동 목록을 사용 중입니다.",
          ),
        );
        return;
      }

      const res = await fetch(withBasePath("/api/notion/exercise-read"), {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        const errorData = await res.json();
        setLibraryState({
          status: "error",
          message: errorData.error || "Failed to fetch exercises",
        });
        return;
      }

      const data = await res.json();
      const notionRows = data.data || [];

      if (notionRows.length === 0) {
        setLibraryState({ status: "empty" });
        return;
      }

      const exercises: LibraryExercise[] = [];
      for (const row of notionRows) {
        const exercise = transformNotionRowToLibraryExercise(row);
        if (exercise) {
          exercises.push(exercise);
        }
      }

      if (exercises.length === 0) {
        setLibraryState({ status: "empty" });
        return;
      }

      const grouped = groupExercisesByCategory(exercises);
      const categories = getOrderedCategories(grouped);

      setLibraryState({
        status: "success",
        exercises,
        categories,
        source: "notion",
      });
    } catch (error) {
      console.error("Failed to fetch exercises:", error);
      const fallback = createBuiltinLibraryState(
        "네트워크 연결 없음. 기본 운동 목록을 사용 중입니다.",
      );
      if (fallback.status === "success" || fallback.status === "empty") {
        setLibraryState(fallback);
        return;
      }
      setLibraryState({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  useEffect(() => {
    fetchExercises();
  }, []);

  return { libraryState, refetch: fetchExercises };
}
