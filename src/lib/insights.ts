import type { SupabaseClient } from "@supabase/supabase-js";

export type InsightsRange = 7 | 30 | 90 | null;

export type InsightsSummary = {
  contents_checked: number;
  findings_raised: number;
  blockers_raised: number;
  fixes_applied: number;
  fixes_edited: number;
  fixes_rejected: number;
  acceptance_rate: number | null;
  dropped_uncited: number;
  approvals: number;
  avg_blockers_per_first_review: number | null;
};

export type AttentionSuggestion = {
  suggestion_type: string;
  vault_item_id: string | null;
  vault_item_title: string;
  evidence: Record<string, number | string | null>;
  message: string;
  evidence_count: number;
};

export type TopSource = {
  source_kind: "vault" | "rule";
  source_item_id: string | null;
  rule_id: string | null;
  label: string;
  times_cited: number;
  applied: number;
  edited: number;
  rejected: number;
  acceptance_rate: number | null;
  sample_size: number;
};

export type InsightPattern = {
  category: string;
  rule_id: string | null;
  source_item_id: string | null;
  label: string;
  occurrences: number;
  distinct_contents: number;
};

export type OriginSplit = {
  split_type: "finding_origin" | "suggestion_origin";
  origin: string;
  findings_count: number;
  applied: number;
  edited: number;
  rejected: number;
  acceptance_rate: number | null;
  sample_size: number;
};

export type InsightTrend = {
  week_start: string;
  contents_reviewed: number;
  findings_raised: number;
  blockers_raised: number;
  blockers_per_content: number | null;
};

export function calculateAcceptanceRate(
  applied: number,
  edited: number,
  rejected: number
): number | null {
  const decided = applied + edited + rejected;
  return decided === 0 ? null : (applied + edited) / decided;
}

export function smallSampleLabel(sampleSize: number): string | null {
  return sampleSize < 10 ? "small sample" : null;
}

const suggestionOrder = [
  "expired_still_cited",
  "repeat_mistake",
  "often_rejected",
  "often_rewritten",
  "never_cited",
];

export function sortAttentionSuggestions<T extends AttentionSuggestion>(
  suggestions: readonly T[]
): T[] {
  return [...suggestions].sort((a, b) => {
    const aOrder = suggestionOrder.indexOf(a.suggestion_type);
    const bOrder = suggestionOrder.indexOf(b.suggestion_type);
    return (
      (aOrder < 0 ? suggestionOrder.length : aOrder) -
        (bOrder < 0 ? suggestionOrder.length : bOrder) ||
      b.evidence_count - a.evidence_count
    );
  });
}

type InsightsClient = SupabaseClient;

async function rpcRows<T>(
  client: InsightsClient,
  functionName: string,
  args: { org: string; p_days: InsightsRange; p_mine: boolean }
): Promise<T[]> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    throw new Error(`Could not load ${functionName}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

export async function getInsightsSummary(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightsSummary> {
  const rows = await rpcRows<InsightsSummary>(client, "insights_summary", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
  if (!rows[0]) {
    throw new Error("The insights summary function returned no row.");
  }
  return rows[0];
}

export function getInsightsNeedsAttention(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<AttentionSuggestion[]> {
  return rpcRows(client, "insights_needs_attention", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
}

export function getInsightsTopSources(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<TopSource[]> {
  return rpcRows(client, "insights_top_sources", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
}

export function getInsightsPatterns(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightPattern[]> {
  return rpcRows(client, "insights_patterns", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
}

export function getInsightsOriginSplit(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<OriginSplit[]> {
  return rpcRows(client, "insights_origin_split", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
}

export function getInsightsTrend(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightTrend[]> {
  return rpcRows(client, "insights_trend", {
    org: orgId,
    p_days: days,
    p_mine: mine,
  });
}
