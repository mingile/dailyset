import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findSyncJobs, parseSessionIdsParam } from "@/lib/notion/syncJobs";

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const userKey = cookieStore.get("user_key")?.value;

  if (!userKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionIds = parseSessionIdsParam(
    new URL(req.url).searchParams.get("sessionIds"),
  );

  try {
    const jobs = await findSyncJobs(userKey, sessionIds);
    return NextResponse.json({ jobs });
  } catch (error) {
    console.error("Failed to read sync job status", error);
    return NextResponse.json(
      { error: "Failed to read sync job status" },
      { status: 500 },
    );
  }
}
