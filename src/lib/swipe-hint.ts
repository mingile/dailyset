import { loadLocalSessions } from "@/lib/notion/restoreLocalHistory";

export const SWIPE_HINT_DISMISS_KEY = "workout.swipeHint.dismissed.v1";

/**
 * 세트 스와이프 삭제 안내를 보여줄지 정한다.
 * 완료한 세션 기록이 하나도 없고(최초 사용자), 안내를 이미 확인한 적이 없을 때만 true.
 * 저장소를 읽지 못하면 안내를 띄우지 않는다.
 */
export function shouldShowSwipeHint(): boolean {
  if (typeof window === "undefined") return false;

  try {
    if (localStorage.getItem(SWIPE_HINT_DISMISS_KEY) === "true") return false;
    return loadLocalSessions().length === 0;
  } catch {
    return false;
  }
}

/** 안내를 확인한 것으로 기록한다. 이후로는 기록이 없어도 다시 보이지 않는다. */
export function dismissSwipeHint(): void {
  try {
    localStorage.setItem(SWIPE_HINT_DISMISS_KEY, "true");
  } catch {
    // 저장하지 못해도 이번 화면에서만 다시 보일 뿐이다.
  }
}
