// Queue Consumer

import { handleCallback } from "@vercel/queue";
import { getNotionSyncErrorStatusCode } from "@/lib/notion/errors";
import { ensureNotionSession } from "@/lib/notion/sessionEnsure";
import {
  recordSyncJob,
  type SyncJobStatus,
  toReason,
} from "@/lib/notion/syncJobs";
import { parseNotionSessionSyncMessage } from "@/lib/notion/syncMessage";
import { writeNotionSets } from "@/lib/notion/writeSets";

const MAX_DELIVERY_COUNT = 3;

function shouldAckWithoutRetry(error: unknown): boolean {
  const statusCode = getNotionSyncErrorStatusCode(error);
  if (statusCode !== undefined) {
    if (statusCode === 429) {
      return false;
    }
    return statusCode < 500;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "No connection found" ||
    error.message === "No Session database configured" ||
    error.message === "No databaseId found" ||
    error.message.includes("has no exercisePageId")
  );
}

function getRetryDelaySeconds(deliveryCount: number): number {
  return Math.min(300, 2 ** deliveryCount * 5);
}

// 상태 기록 실패가 노션 동기화 결과(ack/재시도)를 바꾸지 않도록 삼킨다.
async function recordJobStatus(
  job: {
    userKey: string;
    sessionId: string;
    savedAt: string;
    retryNo?: number;
  },
  status: SyncJobStatus,
  error?: unknown,
): Promise<void> {
  try {
    await recordSyncJob({
      ...job,
      status,
      reason: error === undefined ? undefined : toReason(error),
    });
  } catch (recordError) {
    console.error("Failed to record Notion sync job status", {
      sessionId: job.sessionId,
      userKey: job.userKey,
      status,
      error: recordError instanceof Error ? recordError.message : recordError,
    });
  }
}

export const POST = handleCallback(
  async (message, metadata) => {
    const parsed = parseNotionSessionSyncMessage(message);

    if (!parsed) {
      console.error("Invalid Notion session sync message", {
        messageId: metadata.messageId,
        message,
      });
      return;
    }

    console.log("Processing Notion session sync job", {
      messageId: metadata.messageId,
      sessionId: parsed.sessionId,
      userKey: parsed.userKey,
      deliveryCount: metadata.deliveryCount,
      consumerGroup: metadata.consumerGroup,
      region: metadata.region,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
    });

    try {
      const { pageId } = await ensureNotionSession({
        userKey: parsed.userKey,
        sessionId: parsed.sessionId,
        sessionName: parsed.sessionName,
        startedAt: parsed.startedAt,
      });

      const result = await writeNotionSets({
        userKey: parsed.userKey,
        savedAt: parsed.savedAt,
        exercises: parsed.exercises,
        sessionPageId: pageId,
      });

      console.log("Notion session sync job completed", {
        messageId: metadata.messageId,
        sessionId: parsed.sessionId,
        sessionPageId: pageId,
        created_count: result.created_count,
      });
      await recordJobStatus(parsed, "done");
    } catch (error) {
      const statusCode = getNotionSyncErrorStatusCode(error);

      if (shouldAckWithoutRetry(error)) {
        console.error("Permanent Notion sync failure; skipping retry", {
          messageId: metadata.messageId,
          sessionId: parsed.sessionId,
          userKey: parsed.userKey,
          statusCode,
          error: error instanceof Error ? error.message : error,
        });
        await recordJobStatus(parsed, "failed", error);
        return;
      }

      console.error("Retryable Notion sync failure", {
        messageId: metadata.messageId,
        sessionId: parsed.sessionId,
        userKey: parsed.userKey,
        statusCode,
        deliveryCount: metadata.deliveryCount,
        error: error instanceof Error ? error.message : error,
      });
      // retry 콜백에는 메시지 본문이 없어, 마지막 시도 실패는 여기서 먼저 기록한다.
      if (metadata.deliveryCount > MAX_DELIVERY_COUNT) {
        await recordJobStatus(parsed, "failed", error);
      }
      throw error;
    }
  },
  {
    visibilityTimeoutSeconds: 600,
    retry: (error, metadata) => {
      if (metadata.deliveryCount > MAX_DELIVERY_COUNT) {
        console.error("Notion sync job abandoned after max retries", {
          messageId: metadata.messageId,
          deliveryCount: metadata.deliveryCount,
          error: error instanceof Error ? error.message : error,
        });
        return { acknowledge: true };
      }

      return { afterSeconds: getRetryDelaySeconds(metadata.deliveryCount) };
    },
  },
);
