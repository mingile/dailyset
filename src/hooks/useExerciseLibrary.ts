import { useQuery } from "@tanstack/react-query";
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

type LibraryResult = Extract<LibraryState, { status: "success" | "empty" }>;

function createBuiltinLibraryState(message: string): LibraryResult {
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

export const EXERCISE_LIBRARY_QUERY_KEY = ["exercise-library"] as const;

// Notion에서 읽은 목록은 운동 중(30분~2시간)에 바뀔 일이 드물므로 이 시간 안에는 시트를 다시 열어도 재요청하지 않는다.
// gcTime도 같이 늘려야 한다. 기본값(5분)이면 구독자가 없는 동안 캐시가 먼저 지워져 staleTime이 의미를 잃는다.
const NOTION_LIBRARY_CACHE_MS = 2 * 60 * 60 * 1000;

type NotionLibrary = Extract<LibraryResult, { status: "success" }> & {
  source: "notion";
};

function isNotionLibrary(
  data: LibraryResult | undefined,
): data is NotionLibrary {
  return data?.status === "success" && data.source === "notion";
}

/** exercise-read가 오류 응답을 준 경우. 화면에는 error 상태(다시 시도 버튼)로 보인다. */
class ExerciseReadError extends Error {}

/**
 * @param hasNotionCache 캐시에 Notion 목록이 있는지. 있으면 재조회 실패를 내장 목록으로 바꾸지 않고 throw해,
 *   Query가 이전 목록을 유지하게 한다. (성공으로 반환하면 갱신 시각이 새로워져 실패한 채 fresh로 취급된다.)
 */
async function fetchExerciseLibrary(
  signal: AbortSignal,
  hasNotionCache: boolean,
): Promise<LibraryResult> {
  try {
    const statusRes = await fetchWithTimeout(
      withBasePath("/api/notion/status"),
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        signal,
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
      return createBuiltinLibraryState(
        "노션 미연동 상태입니다. 기본 운동 목록을 사용 중입니다.",
      );
    }

    const res = await fetch(withBasePath("/api/notion/exercise-read"), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new ExerciseReadError(
        errorData.error || "Failed to fetch exercises",
      );
    }

    const data = await res.json();
    const notionRows = data.data || [];

    if (notionRows.length === 0) {
      return { status: "empty" };
    }

    const exercises: LibraryExercise[] = [];
    for (const row of notionRows) {
      const exercise = transformNotionRowToLibraryExercise(row);
      if (exercise) {
        exercises.push(exercise);
      }
    }

    if (exercises.length === 0) {
      return { status: "empty" };
    }

    const grouped = groupExercisesByCategory(exercises);
    const categories = getOrderedCategories(grouped);

    return {
      status: "success",
      exercises,
      categories,
      source: "notion",
    };
  } catch (error) {
    if (error instanceof ExerciseReadError) throw error;

    console.error("Failed to fetch exercises:", error);
    if (hasNotionCache) throw error;
    return createBuiltinLibraryState(
      "네트워크 연결 없음. 기본 운동 목록을 사용 중입니다.",
    );
  }
}

export function useExerciseLibrary() {
  const query = useQuery({
    queryKey: EXERCISE_LIBRARY_QUERY_KEY,
    queryFn: ({ signal, client }) =>
      fetchExerciseLibrary(
        signal,
        isNotionLibrary(client.getQueryData(EXERCISE_LIBRARY_QUERY_KEY)),
      ),
    // Notion 목록만 재사용한다. 내장 목록 fallback과 빈 목록은 일시적일 수 있어 바로 stale로 둔다.
    staleTime: (q) =>
      isNotionLibrary(q.state.data) ? NOTION_LIBRARY_CACHE_MS : 0,
    gcTime: NOTION_LIBRARY_CACHE_MS,
  });

  function refetch() {
    return query.refetch().then(() => undefined);
  }

  let libraryState: LibraryState;
  if (query.status === "pending") {
    libraryState = { status: "loading" };
  } else if (query.status === "error") {
    // 재조회가 실패했어도 이전 Notion 목록이 있으면 그것을 유지한다. 그 외에는 error 화면.
    libraryState = isNotionLibrary(query.data)
      ? query.data
      : { status: "error", message: query.error.message };
  } else {
    libraryState = query.data;
  }

  return { libraryState, refetch };
}
