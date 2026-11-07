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

// PostgREST serialises bigint/numeric columns either as JSON numbers or as
// numeric strings, so the raw rows keep that union and are coerced below.
type Numeric = number | string;

type RawInsightsSummary = {
  contents_checked: Numeric;
  findings_raised: Numeric;
  blockers_raised: Numeric;
  fixes_applied: Numeric;
  fixes_edited: Numeric;
  fixes_rejected: Numeric;
  acceptance_rate: Numeric | null;
  dropped_uncited: Numeric;
  approvals: Numeric;
  avg_blockers_per_first_review: Numeric | null;
};

type RawAttentionSuggestion = {
  suggestion_type: string;
  vault_item_id: string | null;
  vault_item_title: string;
  evidence: Record<string, number | string | null>;
  message: string;
  evidence_count: Numeric;
};

type RawTopSource = {
  source_kind: "vault" | "rule";
  source_item_id: string | null;
  rule_id: string | null;
  label: string;
  times_cited: Numeric;
  applied: Numeric;
  edited: Numeric;
  rejected: Numeric;
  acceptance_rate: Numeric | null;
  sample_size: Numeric;
};

type RawInsightPattern = {
  category: string;
  rule_id: string | null;
  source_item_id: string | null;
  label: string;
  occurrences: Numeric;
  distinct_contents: Numeric;
};

type RawOriginSplit = {
  split_type: "finding_origin" | "suggestion_origin";
  origin: string;
  findings_count: Numeric;
  applied: Numeric;
  edited: Numeric;
  rejected: Numeric;
  acceptance_rate: Numeric | null;
  sample_size: Numeric;
};

type RawInsightTrend = {
  week_start: string;
  contents_reviewed: Numeric;
  findings_raised: Numeric;
  blockers_raised: Numeric;
  blockers_per_content: Numeric | null;
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

function toNumber(value: Numeric): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(value: Numeric | null): number | null {
  return value === null ? null : toNumber(value);
}

async function rpcRows<Raw, Row>(
  client: InsightsClient,
  functionName: string,
  args: { org: string; p_days: InsightsRange; p_mine: boolean },
  map: (row: Raw) => Row
): Promise<Row[]> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    const parts = [`Could not load ${functionName}: ${error.message}`];
    if (error.details) {
      parts.push(`details: ${error.details}`);
    }
    if (error.hint) {
      parts.push(`hint: ${error.hint}`);
    }
    throw new Error(parts.join(" | "));
  }
  return ((data ?? []) as Raw[]).map(map);
}

export async function getInsightsSummary(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightsSummary> {
  const rows = await rpcRows<RawInsightsSummary, InsightsSummary>(
    client,
    "insights_summary",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      contents_checked: toNumber(row.contents_checked),
      findings_raised: toNumber(row.findings_raised),
      blockers_raised: toNumber(row.blockers_raised),
      fixes_applied: toNumber(row.fixes_applied),
      fixes_edited: toNumber(row.fixes_edited),
      fixes_rejected: toNumber(row.fixes_rejected),
      acceptance_rate: toNullableNumber(row.acceptance_rate),
      dropped_uncited: toNumber(row.dropped_uncited),
      approvals: toNumber(row.approvals),
      avg_blockers_per_first_review: toNullableNumber(
        row.avg_blockers_per_first_review
      ),
    })
  );
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
  return rpcRows<RawAttentionSuggestion, AttentionSuggestion>(
    client,
    "insights_needs_attention",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      suggestion_type: row.suggestion_type,
      vault_item_id: row.vault_item_id,
      vault_item_title: row.vault_item_title,
      evidence: row.evidence,
      message: row.message,
      evidence_count: toNumber(row.evidence_count),
    })
  );
}

export function getInsightsTopSources(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<TopSource[]> {
  return rpcRows<RawTopSource, TopSource>(
    client,
    "insights_top_sources",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      source_kind: row.source_kind,
      source_item_id: row.source_item_id,
      rule_id: row.rule_id,
      label: row.label,
      times_cited: toNumber(row.times_cited),
      applied: toNumber(row.applied),
      edited: toNumber(row.edited),
      rejected: toNumber(row.rejected),
      acceptance_rate: toNullableNumber(row.acceptance_rate),
      sample_size: toNumber(row.sample_size),
    })
  );
}

export function getInsightsPatterns(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightPattern[]> {
  return rpcRows<RawInsightPattern, InsightPattern>(
    client,
    "insights_patterns",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      category: row.category,
      rule_id: row.rule_id,
      source_item_id: row.source_item_id,
      label: row.label,
      occurrences: toNumber(row.occurrences),
      distinct_contents: toNumber(row.distinct_contents),
    })
  );
}

export function getInsightsOriginSplit(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<OriginSplit[]> {
  return rpcRows<RawOriginSplit, OriginSplit>(
    client,
    "insights_origin_split",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      split_type: row.split_type,
      origin: row.origin,
      findings_count: toNumber(row.findings_count),
      applied: toNumber(row.applied),
      edited: toNumber(row.edited),
      rejected: toNumber(row.rejected),
      acceptance_rate: toNullableNumber(row.acceptance_rate),
      sample_size: toNumber(row.sample_size),
    })
  );
}

export function getInsightsTrend(
  client: InsightsClient,
  orgId: string,
  days: InsightsRange,
  mine: boolean
): Promise<InsightTrend[]> {
  return rpcRows<RawInsightTrend, InsightTrend>(
    client,
    "insights_trend",
    {
      org: orgId,
      p_days: days,
      p_mine: mine,
    },
    (row) => ({
      week_start: row.week_start,
      contents_reviewed: toNumber(row.contents_reviewed),
      findings_raised: toNumber(row.findings_raised),
      blockers_raised: toNumber(row.blockers_raised),
      blockers_per_content: toNullableNumber(row.blockers_per_content),
    })
  );
}
