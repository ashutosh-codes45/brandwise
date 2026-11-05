"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CommentTarget =
  | { type: "content" }
  | { type: "section"; sectionId: string }
  | { type: "finding"; findingId: string };

export type ContentComment = {
  id: string;
  org_id: string;
  content_id: string;
  section_id: string | null;
  finding_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  author_email: string;
  author_role: string;
};

type CommentContext =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      orgId: string;
      content: { id: string; org_id: string };
    };

function isCommentTarget(value: unknown): value is CommentTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const target = value as Record<string, unknown>;
  return (
    target.type === "content" ||
    (target.type === "section" &&
      typeof target.sectionId === "string" &&
      uuidPattern.test(target.sectionId)) ||
    (target.type === "finding" &&
      typeof target.findingId === "string" &&
      uuidPattern.test(target.findingId))
  );
}

async function getCommentContext(
  contentId: unknown
): Promise<CommentContext> {
  if (typeof contentId !== "string" || !uuidPattern.test(contentId)) {
    return { ok: false, error: "Select valid content." };
  }
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return { ok: false, error: userError.message };
  }
  if (!user) {
    return { ok: false, error: "Sign in to view or add comments." };
  }
  const { data: membership, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (memberError) {
    return { ok: false, error: memberError.message };
  }
  if (!membership) {
    return { ok: false, error: "You have not been added to an organisation." };
  }
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id")
    .eq("id", contentId)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (contentError) {
    return { ok: false, error: contentError.message };
  }
  if (!content) {
    return {
      ok: false,
      error: "Content not found or you cannot access it.",
    };
  }
  return {
    ok: true,
    supabase,
    userId: user.id,
    orgId: membership.org_id,
    content,
  } as const;
}

export async function listComments(
  contentId: unknown
): Promise<{ error: string } | { comments: ContentComment[] }> {
  const context = await getCommentContext(contentId);
  if (!context.ok) {
    return context;
  }
  const { data, error } = await context.supabase.rpc("list_content_comments", {
    p_content: context.content.id,
  });
  if (error) {
    return { error: error.message };
  }
  return { comments: (data ?? []) as ContentComment[] };
}

export async function addComment(
  contentId: unknown,
  bodyValue: unknown,
  targetValue: CommentTarget
): Promise<{ error: string } | { success: true }> {
  if (
    typeof bodyValue !== "string" ||
    !bodyValue.trim() ||
    bodyValue.trim().length > 2_000
  ) {
    return { error: "Enter a comment of 1 to 2,000 characters." };
  }
  if (!isCommentTarget(targetValue)) {
    return { error: "Select a valid comment target." };
  }
  const target = targetValue;

  const context = await getCommentContext(contentId);
  if (!context.ok) {
    return context;
  }

  let sectionId: string | null = null;
  let findingId: string | null = null;
  if (target.type === "section") {
    const { data: section, error } = await context.supabase
      .from("content_sections")
      .select("id")
      .eq("id", target.sectionId)
      .eq("org_id", context.orgId)
      .eq("content_id", context.content.id)
      .maybeSingle();
    if (error) {
      return { error: error.message };
    }
    if (!section) {
      return { error: "That section does not belong to this content." };
    }
    sectionId = section.id;
  } else if (target.type === "finding") {
    const { data: finding, error } = await context.supabase
      .from("findings")
      .select("id")
      .eq("id", target.findingId)
      .eq("org_id", context.orgId)
      .eq("content_id", context.content.id)
      .maybeSingle();
    if (error) {
      return { error: error.message };
    }
    if (!finding) {
      return { error: "That finding does not belong to this content." };
    }
    findingId = finding.id;
  }

  const { error } = await context.supabase.from("comments").insert({
    org_id: context.orgId,
    content_id: context.content.id,
    section_id: sectionId,
    finding_id: findingId,
    author_id: context.userId,
    body: bodyValue.trim(),
  });
  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/workspace/${context.content.id}`);
  return { success: true };
}

export async function deleteComment(
  commentIdValue: unknown
): Promise<string | null> {
  if (typeof commentIdValue !== "string" || !uuidPattern.test(commentIdValue)) {
    return "Select a valid comment.";
  }
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return userError.message;
  }
  if (!user) {
    return "Sign in to delete a comment.";
  }
  const { data: comment, error: lookupError } = await supabase
    .from("comments")
    .select("id, content_id, author_id")
    .eq("id", commentIdValue)
    .maybeSingle();
  if (lookupError) {
    return lookupError.message;
  }
  if (!comment) {
    return "Comment not found.";
  }
  if (comment.author_id !== user.id) {
    return "You can delete only your own comments.";
  }
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", comment.id)
    .eq("author_id", user.id);
  if (error) {
    return error.message;
  }
  revalidatePath(`/workspace/${comment.content_id}`);
  return null;
}
