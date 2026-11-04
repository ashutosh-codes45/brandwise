import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";
import { VaultManager } from "./vault-manager";

export const instant = false;

export default function VaultPage() {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Suspense
          fallback={
            <p className="rounded-xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading your vault...
            </p>
          }
        >
          <VaultContent />
        </Suspense>
      </div>
    </main>
  );
}

async function VaultContent() {
  await connection();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
  }
  if (member.role !== "brand_manager") {
    redirect("/workspace");
  }

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("vault_items")
    .select(
      "id, kind, title, body, asset_path, owner, valid_until, is_confidential, tags, created_at"
    )
    .eq("org_id", member.orgId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (
    <>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-sm text-zinc-600">
            Signed in as {member.email} · {member.role}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-white"
            href="/vault/team"
          >
            Manage team
          </Link>
          <form action={signOut}>
            <button className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <VaultManager items={items ?? []} />
    </>
  );
}
