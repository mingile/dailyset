// DevTools 콘솔에 붙여 넣어 측정 시작 상태를 만드는 스니펫을 출력한다. 붙여 넣은 뒤 /app 을 새로고침한다.
//   node scripts/perf/print-seed.mjs | pbcopy
import { buildDraft, buildSessions } from "./seed.mjs";

console.log(
  [
    `localStorage.setItem("pwa.installPrompt.dismissed.v1", "true");`,
    `localStorage.setItem("workout.currentSession.v1", ${JSON.stringify(JSON.stringify(buildDraft()))});`,
    `localStorage.setItem("workout.sessions.v1", ${JSON.stringify(JSON.stringify(buildSessions()))});`,
    `location.reload();`,
  ].join("\n"),
);
