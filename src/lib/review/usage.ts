import type { ReviewClient } from "./types";

export const dailyAiCallLimit = 20;
export const minuteAiCallLimit = 5;

export type AiUsage = {
  today: number;
  lastMinute: number;
};

export async function getAiUsage(
  supabase: ReviewClient,
  orgId: string
): Promise<AiUsage> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const minuteStart = new Date(now.getTime() - 60_000);
  const [runsToday, refinementsToday, runsLastMinute, refinementsLastMinute] =
    await Promise.all([
      supabase
        .from("review_runs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", dayStart.toISOString()),
      supabase
        .from("finding_events")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("event", "refine_requested")
        .gte("created_at", dayStart.toISOString()),
      supabase
        .from("review_runs")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .gte("created_at", minuteStart.toISOString()),
      supabase
        .from("finding_events")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("event", "refine_requested")
        .gte("created_at", minuteStart.toISOString()),
    ]);

  const error =
    runsToday.error ??
    refinementsToday.error ??
    runsLastMinute.error ??
    refinementsLastMinute.error;
  if (error) {
    throw new Error(`Could not check AI usage: ${error.message}`);
  }

  return {
    today: (runsToday.count ?? 0) + (refinementsToday.count ?? 0),
    lastMinute:
      (runsLastMinute.count ?? 0) + (refinementsLastMinute.count ?? 0),
  };
}

export function getAiUsageLimitMessage(): string {
  return "AI rate limit reached (free tier: 5 requests/min, 20/day). Try again in a minute, or tomorrow if the daily limit is used.";
}
