import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";
import { TeamAccess } from "./team-access";

export const instant = false;

export default function TeamPage() {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7">
          <Link
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            href="/vault"
          >
            &larr; Back to vault
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900">
            Team access
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Manage organisation members and invite codes.
          </p>
        </header>
        <Suspense
          fallback={
            <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
              Loading team access...
            </p>
          }
        >
          <TeamContent />
        </Suspense>
      </div>
    </main>
  );
}

async function TeamContent() {
  await connection();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
  }
  if (member.role !== "brand_manager") {
    redirect("/workspace");
  }

  const supabase = await createClient();
  const [{ data: members, error: membersError }, { data: invites, error: invitesError }] =
    await Promise.all([
      supabase.rpc("list_members", { org: member.orgId }),
      supabase
        .from("invites")
        .select("id, code, role, expires_at")
        .eq("org_id", member.orgId)
        .is("used_by", null)
        .order("created_at", { ascending: false }),
    ]);

  if (membersError) {
    throw new Error(membersError.message);
  }
  if (invitesError) {
    throw new Error(invitesError.message);
  }

  return (
    <TeamAccess
      currentUserId={member.userId}
      invites={invites ?? []}
      members={members ?? []}
    />
  );
}
