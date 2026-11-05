import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

const statusLabels: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

const platformLabels: Record<string, string> = {
  "LinkedIn": "LinkedIn",
  "X (Twitter)": "X",
  Instagram: "Instagram",
  Facebook: "Facebook",
  "Blog/Website": "Blog/Website",
  Email: "Email",
};

export default function WorkspacePage() {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading your workspace...
            </section>
          }
        >
          <WorkspaceContent />
        </Suspense>
      </div>
    </main>
  );
}

async function WorkspaceContent() {
  await connection();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: contents, error } = await supabase
    .from("contents")
    .select("id, title, status, platforms, updated_at, created_by")
    .eq("org_id", member.orgId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const orderedContents = [...(contents ?? [])].sort((a, b) => {
    const aOwn = a.created_by === member.userId ? 0 : 1;
    const bOwn = b.created_by === member.userId ? 0 : 1;
    return aOwn - bOwn;
  });

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          {member.role === "brand_manager" && (
            <p className="mb-2 text-sm text-indigo-700">
              Brand Managers can also{" "}
              <Link className="font-medium underline" href="/vault">
                return to the Brand Vault
              </Link>
              .
            </p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Workspace
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Signed in as {member.email} · {member.role}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {member.role === "creator" && (
            <Link
              className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
              href="/workspace/new"
            >
              New content
            </Link>
          )}
          <form action={signOut}>
            <button className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-5 py-4">
          <h2 className="font-semibold text-zinc-900">Content</h2>
        </div>
        {orderedContents.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-zinc-500">
            No content yet. Create a draft to get started.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {orderedContents.map((content) => (
              <li key={content.id}>
                <Link
                  className="block px-5 py-4 transition hover:bg-zinc-50"
                  href={`/workspace/${content.id}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium text-zinc-900">
                      {content.title}
                      {content.created_by === member.userId && (
                        <span className="ml-2 text-xs font-normal text-zinc-500">
                          Your content
                        </span>
                      )}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        content.status === "approved"
                          ? "bg-emerald-100 text-emerald-800"
                          : content.status === "changes_requested"
                            ? "bg-amber-100 text-amber-800"
                            : content.status === "in_review"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-zinc-100 text-zinc-700"
                      }`}
                    >
                      {statusLabels[content.status] ?? content.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                    <span>
                      {(content.platforms ?? [])
                        .map((platform: string) => platformLabels[platform] ?? platform)
                        .join(" · ") || "No platforms selected"}
                    </span>
                    <time dateTime={content.updated_at}>
                      Updated{" "}
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                      }).format(new Date(content.updated_at))}
                    </time>
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
