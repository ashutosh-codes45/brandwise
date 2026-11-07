"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  PLATFORM_OVER_LIMIT_RULE_ID,
  platformLabelFromSource,
} from "@/lib/review/platform-rules";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TransitionResult =
  | {
      error: string;
      requiresAcknowledgement?: boolean;
      openBlockers?: number;
      overLimitPlatforms?: string[];
    }
  | { status: string };

type WorkflowContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>;
      orgId: string;
      userId: string;
      role: string;
      content: { id: string; status: string; created_by: string };
    };

async function getWorkflowContext(value: unknown): Promise<WorkflowContext> {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    return { error: "Select valid content." };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return { error: userError.message };
  }
  if (!user) {
    return { error: "Sign in to manage this review." };
  }

  const { data: membership, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (memberError) {
    return { error: memberError.message };
  }
  if (!membership) {
    return { error: "You have not been added to an organisation." };
  }

  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, status, created_by")
    .eq("id", value)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (contentError) {
    return { error: contentError.message };
  }
  if (!content) {
    return { error: "Content not found or you cannot access it." };
  }

  return {
    supabase,
    orgId: membership.org_id,
    userId: user.id,
    role: membership.role,
    content,
  };
}

async function openBlockerCount(
  context: Extract<WorkflowContext, { supabase: unknown }>
): Promise<number | string> {
  const { count, error } = await context.supabase
    .from("findings")
    .select("id", { count: "exact", head: true })
    .eq("org_id", context.orgId)
    .eq("content_id", context.content.id)
    .eq("status", "open")
    .eq("severity", "blocker");
  return error ? error.message : count ?? 0;
}

async function openOverLimitPlatforms(
  context: Extract<WorkflowContext, { supabase: unknown }>
): Promise<string[] | string> {
  const { data, error } = await context.supabase
    .from("findings")
    .select("source_label")
    .eq("org_id", context.orgId)
    .eq("content_id", context.content.id)
    .eq("status", "open")
    .eq("severity", "blocker")
    .eq("category", "platform")
    .eq("rule_id", PLATFORM_OVER_LIMIT_RULE_ID);
  if (error) {
    return error.message;
  }
  const labels = (data ?? [])
    .map((row) => platformLabelFromSource(row.source_label))
    .filter((label): label is string => Boolean(label));
  return [...new Set(labels)];
}

async function latestReviewIsCurrent(
  context: Extract<WorkflowContext, { supabase: unknown }>
): Promise<boolean | string> {
  const [{ data: latestRun, error: runError }, { data: latestVersion, error: versionError }] =
    await Promise.all([
      context.supabase
        .from("review_runs")
        .select("created_at")
        .eq("org_id", context.orgId)
        .eq("content_id", context.content.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase
        .from("content_versions")
        .select("created_at")
        .eq("org_id", context.orgId)
        .eq("content_id", context.content.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (runError) {
    return runError.message;
  }
  if (versionError) {
    return versionError.message;
  }
  if (!latestRun || !latestVersion) {
    return false;
  }
  return latestRun.created_at > latestVersion.created_at;
}

async function transition(
  context: Extract<WorkflowContext, { supabase: unknown }>,
  to: "in_review" | "changes_requested" | "approved" | "draft",
  note: string | null
): Promise<TransitionResult> {
  const { data, error } = await context.supabase.rpc("transition_content", {
    p_content: context.content.id,
    p_to: to,
    p_note: note,
  });
  if (error) {
    return { error: error.message };
  }
  revalidatePath(`/workspace/${context.content.id}`);
  revalidatePath("/workspace");
  revalidatePath("/review");
  return { status: typeof data === "string" ? data : to };
}

export async function submitForReview(
  contentId: unknown,
  ackBlockers: unknown
): Promise<TransitionResult> {
  if (typeof ackBlockers !== "boolean") {
    return { error: "Confirm whether you want to submit with open blockers." };
  }
  const context = await getWorkflowContext(contentId);
  if ("error" in context) {
    return context;
  }
  if (context.content.created_by !== context.userId) {
    return { error: "Only the content creator can submit it for review." };
  }

  const reviewed = await latestReviewIsCurrent(context);
  if (typeof reviewed === "string") {
    return { error: reviewed };
  }
  if (!reviewed) {
    return {
      error: "Run the AI review on the latest saved version first.",
    };
  }

  const blockers = await openBlockerCount(context);
  if (typeof blockers === "string") {
    return { error: blockers };
  }
  if (blockers > 0 && !ackBlockers) {
    const overLimit = await openOverLimitPlatforms(context);
    if (typeof overLimit === "string") {
      return { error: overLimit };
    }
    const platformNote =
      overLimit.length > 0
        ? ` (${overLimit.join(", ")} over the platform limit)`
        : "";
    return {
      error: `There are ${blockers} open blocker${blockers === 1 ? "" : "s"}${platformNote}. Confirm submission to continue.`,
      requiresAcknowledgement: true,
      openBlockers: blockers,
      overLimitPlatforms: overLimit,
    };
  }

  const note =
    blockers > 0 ? `Submitted with ${blockers} open blockers` : null;
  return transition(context, "in_review", note);
}

export async function requestChanges(
  contentId: unknown,
  noteValue: unknown
): Promise<TransitionResult> {
  if (
    typeof noteValue !== "string" ||
    !noteValue.trim() ||
    noteValue.trim().length > 2_000
  ) {
    return { error: "Enter a request-changes note of 1 to 2,000 characters." };
  }
  const context = await getWorkflowContext(contentId);
  if ("error" in context) {
    return context;
  }
  if (context.role !== "reviewer" && context.role !== "brand_manager") {
    return { error: "Only a Reviewer or Brand Manager can request changes." };
  }
  return transition(context, "changes_requested", noteValue.trim());
}

export async function approve(
  contentId: unknown,
  ackBlockers: unknown
): Promise<TransitionResult> {
  if (typeof ackBlockers !== "boolean") {
    return { error: "Confirm whether you want to approve with open blockers." };
  }
  const context = await getWorkflowContext(contentId);
  if ("error" in context) {
    return context;
  }
  if (context.role !== "brand_manager") {
    return { error: "Only a Brand Manager can approve content." };
  }

  const blockers = await openBlockerCount(context);
  if (typeof blockers === "string") {
    return { error: blockers };
  }
  if (blockers > 0 && !ackBlockers) {
    return {
      error: `There are ${blockers} open blocker${blockers === 1 ? "" : "s"}. Confirm approval to continue.`,
      requiresAcknowledgement: true,
      openBlockers: blockers,
    };
  }
  return transition(
    context,
    "approved",
    blockers > 0 ? `Approved with ${blockers} open blockers` : null
  );
}

export async function reopen(
  contentId: unknown,
  noteValue: unknown
): Promise<TransitionResult> {
  if (
    typeof noteValue !== "string" ||
    !noteValue.trim() ||
    noteValue.trim().length > 2_000
  ) {
    return { error: "Enter a reopen note of 1 to 2,000 characters." };
  }
  const context = await getWorkflowContext(contentId);
  if ("error" in context) {
    return context;
  }
  if (context.role !== "brand_manager") {
    return { error: "Only a Brand Manager can reopen approved content." };
  }
  return transition(context, "draft", noteValue.trim());
}
