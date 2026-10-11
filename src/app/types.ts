export type SetItem = {
  weight: number;
  reps: number;
  done: boolean;
  synced: boolean;
  equipment: string;
  memo: string;
  unit: "kg" | "lb";
  setType?: "warmup" | "main";
};
export type Exercise = {
  id: string;
  name: string;
  sets: SetItem[];
  part?: string;
  exercisePageId?: string;
  targetMainSetCount?: number;
  targetWarmupSetCount?: number;
};
export type Exercises = Exercise[];
export type Part = "back" | "chest" | "legs" | "shoulders";
export type Session = {
  id: string;
  savedAt: string;
  sessionName?: string;
  part?: Part;
  exercises: (SavedExercise & { part?: string })[];
  durationSeconds?: number;
};
export type SavedExercise = {
  id: string;
  name: string;
  exercisePageId?: string;
  sets: {
    setNo: number;
    weight: number;
    reps: number;
    memo: string;
    equipment: string;
  }[];
};

export type SessionMetadata = {
  sessionId: string;
  sessionName: string;
  startedAt: string;
};

export type ExerciseTimerState = {
  status: "running" | "paused";
  accumulatedElapsedSeconds: number;
  segmentStartedAt: string | null;
};

export type ExerciseTimers = Record<string, ExerciseTimerState>;

export type SessionDraft = {
  session: SessionMetadata;
  exercises: Exercises;
  exerciseTimers?: ExerciseTimers;
  historyDirty?: boolean;
};

export type LibraryCategory =
  | "등"
  | "가슴"
  | "하체"
  | "어깨"
  | "팔"
  | "코어"
  | "유산소"
  | "기타";

export type LibraryExercise = {
  id: string;
  name: string;
  category: LibraryCategory;
  equipment?: string;
  primaryEffect?: string;
  notionPageId?: string;
};

export type LibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | {
      status: "success";
      exercises: LibraryExercise[];
      categories: LibraryCategory[];
      source: "builtin" | "notion";
      message?: string;
    };

export type DateInfo = {
  date: Date;
  dayOfMonth: number;
  dayOfWeek: string;
  hasSession: boolean;
  isToday: boolean;
  isFuture: boolean;
};
