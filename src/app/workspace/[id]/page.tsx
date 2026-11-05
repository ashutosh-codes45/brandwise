import { Suspense } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { ContentEditor } from "./content-editor";
import { getReviewState } from "./review-actions";
import type { ContentComment } from "./comment-actions";
import type { ContentActivityEvent } from "./activity-panel";

export const instant = false;

type ContentPageProps = {
  params: Promise<{ id: string }>;
};

export default function ContentPage({ params }: ContentPageProps) {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading content...
            </section>
          }
        >
          <ContentPageContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ContentPageContent({ params }: ContentPageProps) {
  await connection();
  const { id } = await params;
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id, title, status, platforms, created_by")
    .eq("id", id)
    .eq("org_id", member.orgId)
    .maybeSingle();

  if (contentError) {
    throw new Error(contentError.message);
  }
  if (!content) {
    notFound();
  }

  const { data: membership, error: membershipError } = await supabase
    .from("members")
    .select("role")
    .eq("org_id", content.org_id)
    .eq("user_id", member.userId)
    .maybeSingle();

  if (membershipError) {
    throw new Error(membershipError.message);
  }
  if (!membership) {
    redirect("/workspace");
  }

  const { data: sections, error: sectionsError } = await supabase
    .from("content_sections")
    .select("id, type, body, image_path, alt_text, position")
    .eq("org_id", content.org_id)
    .eq("content_id", content.id)
    .order("position", { ascending: true });

  if (sectionsError) {
    throw new Error(sectionsError.message);
  }

  const canEdit =
    membership.role === "creator" &&
    content.created_by === member.userId &&
    (content.status === "draft" || content.status === "changes_requested");
  const reviewState = await getReviewState(content.id);

  if ("error" in reviewState) {
    throw new Error(reviewState.error);
  }
  const [{ data: commentsData, error: commentsError }, { data: eventsData, error: eventsError }] =
    await Promise.all([
      supabase.rpc("list_content_comments", { p_content: content.id }),
      supabase.rpc("list_content_events", { p_content: content.id }),
    ]);
  if (commentsError) {
    throw new Error(commentsError.message);
  }
  if (eventsError) {
    throw new Error(eventsError.message);
  }
  const comments = (commentsData ?? []) as ContentComment[];
  const events = (eventsData ?? []) as ContentActivityEvent[];
  const latestChangeNote =
    content.status === "changes_requested"
      ? events.find((event) => event.event === "changes_requested")?.note ?? null
      : null;
  const approvedEvent =
    content.status === "approved"
      ? events.find((event) => event.event === "approved")
      : undefined;

  return (
    <>
      <AppNav member={member} />
      <div className="mb-5">
        <Link
          className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          href="/workspace"
        >
          &larr; Back to workspace
        </Link>
      </div>
      <ContentEditor
        content={{
          id: content.id,
          title: content.title,
          status: content.status,
          platforms: content.platforms ?? [],
          sections: (sections ?? []).map((section) => ({
            ...section,
            type: section.type === "image" ? "image" : "text",
          })),
        }}
        canEdit={canEdit}
        initialFindings={reviewState.findings}
        initialStats={reviewState.stats}
        initialComments={comments}
        initialEvents={events}
        currentUserId={member.userId}
        role={membership.role}
        isCreator={content.created_by === member.userId}
        latestChangeNote={latestChangeNote}
        approvedBy={
          approvedEvent
            ? {
                email: approvedEvent.actor_email,
                createdAt: approvedEvent.created_at,
              }
            : null
        }
      />
    </>
  );
}
