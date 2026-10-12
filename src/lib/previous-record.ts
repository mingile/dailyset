import { SetItem, Session } from "@/app/types";
import { ruleDecision } from "./weightUnit";

export function createDefaultSet(equipment?: string): SetItem {
  return {
    weight: 0,
    reps: 0,
    done: false,
    synced: false,
    equipment: equipment || "cable-machine",
    memo: "",
    unit: equipment === "cable-machine" ? "lb" : "kg",
    setType: "main",
  };
}

export function getPreviousRecord(
  exerciseName: string,
  equipment?: string,
): SetItem[] {
  try {
    const sessionKey = "workout.sessions.v1";
    const sessionsData = localStorage.getItem(sessionKey);

    if (!sessionsData) {
      return [createDefaultSet(equipment)];
    }

    const sessions: Session[] = JSON.parse(sessionsData);

    if (!Array.isArray(sessions) || sessions.length === 0) {
      return [createDefaultSet(equipment)];
    }

    // savedAt 기준으로 내림차순 정렬 (최신 순)
    const sortedSessions = [...sessions].sort((a, b) => {
      const dateA = new Date(a.savedAt).getTime();
      const dateB = new Date(b.savedAt).getTime();
      return dateB - dateA;
    });

    // 1차 시도: 운동명 + Equipment 모두 일치하는 기록 찾기
    if (equipment) {
      for (const session of sortedSessions) {
        const foundExercise = session.exercises.find(
          (ex) =>
            ex.name === exerciseName &&
            ex.sets.some((set) => set.equipment === equipment),
        );

        if (foundExercise && foundExercise.sets.length > 0) {
          const matchingSets = foundExercise.sets.filter(
            (set) => set.equipment === equipment,
          );
          if (matchingSets.length > 0) {
            // 마지막 세트만 가져오기
            return [
              {
                weight: matchingSets[matchingSets.length - 1].weight,
                reps: matchingSets[matchingSets.length - 1].reps,
                done: false,
                synced: false,
                equipment: matchingSets[matchingSets.length - 1].equipment,
                memo: "",
                unit: ruleDecision(
                  matchingSets[matchingSets.length - 1].equipment,
                ).unit,
                setType: "main",
              },
            ];
          }
        }
      }
    }

    // 2차 시도: 운동명만 일치하는 기록 찾기
    for (const session of sortedSessions) {
      const foundExercise = session.exercises.find(
        (ex) => ex.name === exerciseName,
      );

      if (foundExercise && foundExercise.sets.length > 0) {
        return [
          {
            weight: foundExercise.sets[0].weight,
            reps: foundExercise.sets[0].reps,
            done: false,
            synced: false,
            equipment:
              foundExercise.sets[0].equipment || equipment || "cable-machine",
            memo: "",
            unit: ruleDecision(
              foundExercise.sets[0].equipment || equipment || "cable-machine",
            ).unit,
            setType: "main",
          },
        ];
      }
    }

    // 이전 기록을 찾지 못한 경우
    return [createDefaultSet(equipment)];
  } catch (error) {
    console.error("Failed to load previous record:", error);
    return [createDefaultSet(equipment)];
  }
}

export type PreviousSets = {
  savedAt: string;
  sets: { weight: number; reps: number; equipment: string; memo: string }[];
};

/**
 * 같은 운동의 가장 최근 이전 세션 기록을 읽기 전용으로 조회한다.
 * 매칭 규칙은 getPreviousRecord와 같다: 운동명 + 기구 일치 → 운동명만 일치.
 * excludeSessionId(현재 세션)는 제외한다. 저장 시 같은 id로 덮어써지기 때문이다.
 */
export function getPreviousSets(
  exerciseName: string,
  equipment: string,
  excludeSessionId?: string,
): PreviousSets | null {
  try {
    const sessionsData = localStorage.getItem("workout.sessions.v1");
    if (!sessionsData) return null;

    const sessions: Session[] = JSON.parse(sessionsData);
    if (!Array.isArray(sessions)) return null;

    const sortedSessions = sessions
      .filter((session) => session.id !== excludeSessionId)
      .sort(
        (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
      );

    const toPreviousSets = (
      savedAt: string,
      sets: {
        weight: number;
        reps: number;
        equipment: string;
        memo?: string;
      }[],
    ): PreviousSets => ({
      savedAt,
      sets: sets.map((set) => ({
        weight: set.weight,
        reps: set.reps,
        equipment: set.equipment,
        memo: set.memo ?? "",
      })),
    });

    if (equipment) {
      for (const session of sortedSessions) {
        const foundExercise = session.exercises.find(
          (ex) =>
            ex.name === exerciseName &&
            ex.sets.some((set) => set.equipment === equipment),
        );
        if (foundExercise) {
          return toPreviousSets(
            session.savedAt,
            foundExercise.sets.filter((set) => set.equipment === equipment),
          );
        }
      }
    }

    for (const session of sortedSessions) {
      const foundExercise = session.exercises.find(
        (ex) => ex.name === exerciseName && ex.sets.length > 0,
      );
      if (foundExercise) {
        return toPreviousSets(session.savedAt, foundExercise.sets);
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to load previous sets:", error);
    return null;
  }
}
