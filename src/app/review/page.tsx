import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";

export const instant = false;

const queueTabs = [
  { status: "in_review", label: "Awaiting review" },
  { status: "changes_requested", label: "Changes requested" },
  { status: "approved", label: "Approved" },
] as const;

type QueueStatus = (typeof queueTabs)[number]["status"];
type ReviewQueueItem = {
  id: string;
  title: string;
  status: QueueStatus;
  platforms: string[];
  creator_email: string;
  updated_at: string;
  submitted_at: string | null;
  open_blockers: number;
  comment_count: number;
};

type ReviewPageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default function ReviewPage({ searchParams }: ReviewPageProps) {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading review queue...
            </section>
          }
        >
          <ReviewQueue searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function ReviewQueue({ searchParams }: ReviewPageProps) {
  await connection();
  const { user, membership } = await requireMember();

  if (membership.role === "creator") {
    redirect("/workspace");
  }

  const member = {
    email: user.email ?? "",
    orgId: membership.org_id,
    role: membership.role,
    userId: user.id,
  };

  const params = await searchParams;
  const selectedStatus = queueTabs.some((tab) => tab.status === params.status)
    ? (params.status as QueueStatus)
    : "in_review";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_review_queue", {
    p_status: selectedStatus,
  });
  if (error) {
    throw new Error(error.message);
  }
  const rows = (data ?? []) as ReviewQueueItem[];

  return (
    <>
      <AppNav member={member} />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Review queue
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Reviewers can request changes. Final approval is reserved for Brand
          Managers.
        </p>
      </header>

      <nav
        aria-label="Review queue status"
        className="mb-5 flex gap-5 overflow-x-auto border-b border-zinc-200"
      >
        {queueTabs.map((tab) => (
          <Link
            aria-current={selectedStatus === tab.status ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium ${
              selectedStatus === tab.status
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-zinc-500 hover:text-zinc-700"
            }`}
            href={`/review?status=${tab.status}`}
            key={tab.status}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">
            No content in this queue.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  className="block p-5 transition hover:bg-zinc-50"
                  href={`/workspace/${row.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-zinc-900">{row.title}</h2>
                      <p className="mt-1 text-xs text-zinc-500">
                        Creator: {row.creator_email}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {row.open_blockers > 0 && (
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-800">
                          {row.open_blockers} open blocker
                          {row.open_blockers === 1 ? "" : "s"}
                        </span>
                      )}
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium capitalize text-zinc-700">
                        {row.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>{row.platforms.join(" · ") || "No platforms selected"}</span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {row.submitted_at && (
                        <time dateTime={row.submitted_at}>
                          Submitted {new Date(row.submitted_at).toLocaleString()}
                        </time>
                      )}
                      <span>{row.comment_count} comments</span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
