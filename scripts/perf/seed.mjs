// 성능 측정용 고정 시드. 측정마다 같은 시작 상태를 만들기 위해 랜덤 값을 쓰지 않는다.
// 시작 상태: 오늘 진행 중인 세션(운동 4개 × 세트 5개) + 지난 30일의 기록 30건(운동 4개 × 세트 5개).

const EXERCISES = [
  { name: "벤치프레스", part: "가슴", weight: 60, reps: 10 },
  { name: "랫풀다운", part: "등", weight: 50, reps: 12 },
  { name: "레그프레스", part: "하체", weight: 100, reps: 12 },
  { name: "숄더프레스", part: "어깨", weight: 30, reps: 10 },
];
const SETS_PER_EXERCISE = 5;
const HISTORY_SESSIONS = 30;

export const SEED_SUMMARY = {
  exercises: EXERCISES.length,
  setsPerExercise: SETS_PER_EXERCISE,
  historySessions: HISTORY_SESSIONS,
};

export function buildDraft(now = new Date()) {
  return {
    session: {
      sessionId: "perf-session",
      sessionName: "Perf Session",
      startedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    },
    exercises: EXERCISES.map((ex, i) => ({
      id: `perf-ex-${i + 1}`,
      name: ex.name,
      part: ex.part,
      exercisePageId: `perf-page-${i + 1}`,
      targetMainSetCount: SETS_PER_EXERCISE,
      targetWarmupSetCount: 0,
      sets: Array.from({ length: SETS_PER_EXERCISE }, () => ({
        weight: ex.weight,
        reps: ex.reps,
        done: false,
        synced: false,
        equipment: "barbell",
        memo: "",
        unit: "kg",
        setType: "main",
      })),
    })),
  };
}

export function buildSessions(now = new Date()) {
  return Array.from({ length: HISTORY_SESSIONS }, (_, i) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (i + 1));
    day.setHours(12, 0, 0, 0);
    return {
      id: `perf-history-${i + 1}`,
      savedAt: day.toISOString(),
      sessionName: `Perf History ${i + 1}`,
      durationSeconds: 3600,
      exercises: EXERCISES.map((ex, j) => ({
        id: `perf-ex-${j + 1}`,
        name: ex.name,
        part: ex.part,
        exercisePageId: `perf-page-${j + 1}`,
        sets: Array.from({ length: SETS_PER_EXERCISE }, (_, k) => ({
          setNo: k + 1,
          weight: ex.weight,
          reps: ex.reps,
          memo: "",
          equipment: "barbell",
        })),
      })),
    };
  });
}
