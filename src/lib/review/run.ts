import "server-only";

import { embed } from "@/lib/ai/provider";
import { createClient } from "@/lib/supabase/server";
import { addCorrectionRecommendations } from "./history";
import { filterAiFindings } from "./filter";
import { judgeSections, PROMPT_VERSION, type JudgeFinding } from "./judge";
import { retrieveVaultSources } from "./retrieve";
import { runRuleChecks } from "./rules";
import {
  dailyAiCallLimit,
  getAiUsage,
  getAiUsageLimitMessage,
  minuteAiCallLimit,
} from "./usage";
import type {
  ReviewClient,
  ReviewFinding,
  ReviewSection,
  VaultSource,
} from "./types";

export type RunReviewResult = {
  runId: string;
  findings: Array<ReviewFinding & { id: string }>;
  stats: {
    rule_raised: number;
    ai_raised: number;
    dropped: number;
    drop_reasons: Record<string, number>;
    ai_skipped_reason?: string;
    judge_provider: "gemini" | "groq" | "none";
    fallback_reason: string | null;
    retrieval_mode: "vector" | "text_search";
    timings_ms: Record<string, number>;
  };
};

type ReviewStage =
  | "setup"
  | "rules"
  | "embed"
  | "retrieve"
  | "judge"
  | "filter"
  | "history"
  | "save";

class ReviewStageFailure extends Error {
  constructor(
    readonly stage: ReviewStage,
    readonly durationMs: number,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : "Review failed.");
  }
}

function formatStageFailure(error: unknown): string {
  if (error instanceof ReviewStageFailure) {
    return `${error.message} Failed at: ${error.stage} (${error.durationMs.toLocaleString("en-US")} ms)`;
  }
  return error instanceof Error ? error.message : "Review failed.";
}

async function timeStage<T>(
  name: Exclude<ReviewStage, "setup">,
  timings: Record<string, number>,
  operation: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  try {
    const result = await operation();
    const duration = Math.round(performance.now() - started);
    timings[name] =
      name === "retrieve"
        ? Math.max(0, duration - (timings.embed ?? 0))
        : duration;
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - started);
    timings[name] =
      name === "retrieve"
        ? Math.max(
            0,
            duration -
              (error instanceof ReviewStageFailure && error.stage === "embed"
                ? error.durationMs
                : (timings.embed ?? 0))
          )
        : duration;
    if (error instanceof ReviewStageFailure) {
      throw error;
    }
    throw new ReviewStageFailure(name, duration, error);
  }
}

async function supersedeOpenFindings(
  supabase: ReviewClient,
  orgId: string,
  contentId: string,
  currentRunId: string
): Promise<void> {
  const { error } = await supabase
    .from("findings")
    .update({ status: "superseded" })
    .eq("org_id", orgId)
    .eq("content_id", contentId)
    .eq("status", "open")
    .or(`run_id.is.null,run_id.neq.${currentRunId}`);

  if (error) {
    throw new Error(`Could not archive previous findings: ${error.message}`);
  }
}

export async function runReview(contentId: string): Promise<RunReviewResult> {
  const timings: Record<string, number> = {};
  const setupStarted = performance.now();
  try {
    return await runReviewPipeline(contentId, timings, setupStarted);
  } catch (error) {
    if (error instanceof ReviewStageFailure) {
      throw new Error(formatStageFailure(error));
    }
    const duration = Math.round(performance.now() - setupStarted);
    throw new Error(
      `${error instanceof Error ? error.message : "Review failed."} Failed at: setup (${duration.toLocaleString("en-US")} ms)`
    );
  }
}

async function runReviewPipeline(
  contentId: string,
  timings: Record<string, number>,
  setupStarted: number
): Promise<RunReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }
  if (!user) {
    throw new Error("Sign in to review content.");
  }

  const { data: membership, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    throw new Error(memberError.message);
  }
  if (!membership) {
    throw new Error("You have not been added to an organisation.");
  }
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id, created_by, status")
    .eq("id", contentId)
    .eq("org_id", membership.org_id)
    .maybeSingle();

  if (contentError) {
    throw new Error(contentError.message);
  }
  if (!content) {
    throw new Error("Content not found or you cannot access it.");
  }
  if (content.created_by !== user.id) {
    throw new Error("Only the creator can review this content.");
  }
  if (content.status !== "draft" && content.status !== "changes_requested") {
    throw new Error("This content is not in a reviewable state.");
  }

  const usage = await getAiUsage(supabase, membership.org_id);
  if (
    usage.today >= dailyAiCallLimit ||
    usage.lastMinute >= minuteAiCallLimit
  ) {
    throw new Error(getAiUsageLimitMessage());
  }

  const { data: dbSections, error: sectionError } = await supabase
    .from("content_sections")
    .select("id, type, body, alt_text")
    .eq("org_id", membership.org_id)
    .eq("content_id", content.id)
    .order("position", { ascending: true });

  if (sectionError) {
    throw new Error(sectionError.message);
  }
  const sections: ReviewSection[] = (dbSections ?? []).map((section) => ({
    id: section.id,
    type: section.type === "image" ? "image" : "text",
    body: section.body,
    alt_text: section.alt_text,
  }));
  if (sections.length === 0) {
    throw new Error("Save at least one section before running a review.");
  }

  timings.setup = Math.round(performance.now() - setupStarted);
  const retrieval = await timeStage("retrieve", timings, async () => {
    const { data: previousRun, error: previousRunError } = await supabase
      .from("review_runs")
      .select("retrieved")
      .eq("org_id", membership.org_id)
      .eq("content_id", content.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousRunError) {
      throw new Error(
        `Could not load previous review retrieval: ${previousRunError.message}`
      );
    }

    return retrieveVaultSources(
      supabase,
      membership.org_id,
      sections,
      previousRun?.retrieved,
      (texts, taskType) =>
        timeStage("embed", timings, () => embed(texts, taskType))
    );
  });
  timings.embed ??= 0;

  const allSources = new Map<string, VaultSource>();
  for (const source of retrieval.sources) {
    allSources.set(source.id, source);
  }

  const rules = await timeStage("rules", timings, async () => {
    const { data: ruleItems, error: rulesError } = await supabase
      .from("vault_items")
      .select("id, kind, title, body, tags, valid_until, is_confidential")
      .eq("org_id", membership.org_id)
      .in("kind", ["term", "fact", "guideline"]);

    if (rulesError) {
      throw new Error(`Could not load Vault rules: ${rulesError.message}`);
    }
    for (const source of ruleItems ?? []) {
      if (!allSources.has(source.id)) {
        allSources.set(source.id, {
          ...source,
          similarity: 0,
        });
      }
    }
    return runRuleChecks(sections, [...allSources.values()]).map((finding) => {
      const source = finding.source_item_id
        ? allSources.get(finding.source_item_id)
        : undefined;
      return {
        ...finding,
        source_quote: source?.is_confidential ? null : finding.source_quote,
      };
    });
  });

  let candidates: JudgeFinding[] = [];
  let aiSkippedReason: string | undefined;
  let judgeProvider: RunReviewResult["stats"]["judge_provider"] = "none";
  let fallbackReason: string | null = null;
  if (retrieval.sources.length > 0) {
    try {
      const judgeResult = await timeStage("judge", timings, () =>
        judgeSections(sections, retrieval.sources)
      );
      candidates = judgeResult.findings;
      judgeProvider = judgeResult.provider;
      fallbackReason = judgeResult.fallbackReason;
    } catch (error) {
      aiSkippedReason = formatStageFailure(error);
    }
  } else {
    timings.judge = 0;
  }
  const filtered = await timeStage("filter", timings, async () =>
    filterAiFindings(candidates, sections, retrieval.sources, rules)
  );
  const checkedAiFindings = filtered.findings;
  let findings: ReviewFinding[];
  if (retrieval.retrievalMode === "text_search") {
    timings.history = 0;
    findings = [...rules, ...checkedAiFindings];
  } else {
    findings = await timeStage("history", timings, () =>
      addCorrectionRecommendations(supabase, membership.org_id, [
        ...rules,
        ...checkedAiFindings,
      ])
    );
  }

  const hasConfidentialSources =
    retrieval.sources.some((source) => source.is_confidential) ||
    findings.some((finding) => {
      if (!finding.source_item_id) {
        return false;
      }
      return allSources.get(finding.source_item_id)?.is_confidential ?? false;
    });
  const visibleRawOutput = hasConfidentialSources
    ? null
    : { findings: candidates };
  const stats: RunReviewResult["stats"] = {
    rule_raised: rules.length,
    ai_raised: checkedAiFindings.length,
    dropped: filtered.stats.dropped,
    drop_reasons: filtered.stats.drop_reasons,
    judge_provider: judgeProvider,
    fallback_reason: fallbackReason,
    retrieval_mode: retrieval.retrievalMode,
    timings_ms: { ...timings },
    ...(aiSkippedReason ? { ai_skipped_reason: aiSkippedReason } : {}),
  };
  const savedResult = await timeStage("save", timings, async () => {
  const saveStarted = performance.now();
  const { data: run, error: runError } = await supabase
    .from("review_runs")
    .insert({
      org_id: membership.org_id,
      content_id: content.id,
      triggered_by: user.id,
      model: process.env.GEMINI_CHAT_MODEL ?? "unknown",
      prompt_version: PROMPT_VERSION,
      retrieved: hasConfidentialSources ? [] : retrieval.trace,
      raw_output: visibleRawOutput,
      stats,
    })
    .select("id")
    .single();

  if (runError) {
    throw new Error(`Could not save review run: ${runError.message}`);
  }
  const persistTimings = async () => {
    timings.save = Math.round(performance.now() - saveStarted);
    stats.timings_ms = { ...timings };
    const { error } = await supabase.rpc("set_review_run_timings", {
      p_run: run.id,
      p_timings: stats.timings_ms,
    });
    if (error) {
      throw new Error(`Could not save review timings: ${error.message}`);
    }
  };

  const rows = findings.map((finding) => ({
    org_id: membership.org_id,
    content_id: content.id,
    section_id: finding.section_id,
    category: finding.category,
    severity: finding.severity,
    excerpt: finding.excerpt,
    reason: finding.reason,
    source_item_id: finding.source_item_id,
    source_confidential: finding.source_item_id
      ? allSources.get(finding.source_item_id)?.is_confidential ?? false
      : false,
    source_label: finding.source_label,
    source_quote: finding.source_quote,
    suggestion: finding.suggestion,
    status: "open",
    origin: finding.origin,
    rule_id: finding.rule_id,
    confidence: finding.confidence,
    suggestion_origin: finding.suggestion_origin,
    recommended_from_correction_id:
      finding.recommended_from_correction_id,
    run_id: run.id,
  }));

  if (rows.length === 0) {
    await supersedeOpenFindings(
      supabase,
      membership.org_id,
      content.id,
      run.id
    );
    await persistTimings();
    return {
      runId: run.id,
      findings: [],
      stats,
    };
  }

  const { data: savedFindings, error: findingsError } = await supabase
    .from("findings")
    .insert(rows)
    .select(
      "id, section_id, category, severity, excerpt, reason, source_item_id, source_label, source_quote, suggestion, origin, rule_id, confidence, suggestion_origin, recommended_from_correction_id"
    );

  if (findingsError) {
    throw new Error(`Could not save review findings: ${findingsError.message}`);
  }

  const events = (savedFindings ?? []).map((finding) => {
    const input = findings.find(
      (candidate) =>
        candidate.section_id === finding.section_id &&
        candidate.excerpt === finding.excerpt &&
        candidate.category === finding.category
    );
    return {
      org_id: membership.org_id,
      finding_id: finding.id,
      actor_id: null,
      actor_type: finding.origin === "ai" ? "ai" : "system",
      event: "raised",
      after_text: finding.suggestion,
      note: input?.note ?? null,
    };
  });
  const { error: eventError } = await supabase
    .from("finding_events")
    .insert(events);

  if (eventError) {
    throw new Error(`Findings saved, but their history could not be recorded: ${eventError.message}`);
  }

  await supersedeOpenFindings(
    supabase,
    membership.org_id,
    content.id,
    run.id
  );
  await persistTimings();

  const result = (savedFindings ?? []).map((finding) => ({
    ...finding,
    source_quote: finding.source_quote,
    origin: finding.origin === "ai" ? "ai" as const : "rule" as const,
    suggestion_origin:
      finding.suggestion_origin === "correction_history" ||
      finding.suggestion_origin === "human"
        ? finding.suggestion_origin
        : "ai" as const,
    rule_id: finding.rule_id,
    confidence: finding.confidence,
    recommended_from_correction_id:
      finding.recommended_from_correction_id,
    note:
      findings.find(
        (candidate) =>
          candidate.section_id === finding.section_id &&
          candidate.excerpt === finding.excerpt &&
          candidate.category === finding.category
      )?.note ?? null,
  }));

  return {
    runId: run.id,
    findings: result as Array<ReviewFinding & { id: string }>,
    stats,
  };
  });
  stats.timings_ms = { ...timings };
  return savedResult;
}
