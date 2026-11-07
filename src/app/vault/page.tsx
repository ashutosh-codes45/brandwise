import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";
import { AppNav } from "@/components/app-nav";
import { VaultManager } from "./vault-manager";
import { getBrandKit } from "@/lib/context/get-brand-kit";

export const instant = false;

export default function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
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
          <VaultContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function VaultContent({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const editParam = Array.isArray(params.edit) ? params.edit[0] : params.edit;
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
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
  const brandKit = await getBrandKit(member.orgId);

  return (
    <>
      <AppNav member={member} />
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
        <div>
          <p className="text-sm text-zinc-600">
            Signed in as {member.email} · {member.role}
          </p>
        </div>
        {member.role === "brand_manager" && (
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-white"
              href="/vault/team"
            >
              Manage team
            </Link>
          </div>
        )}
      </header>
      <VaultManager
        brandKit={brandKit}
        canManage={member.role === "brand_manager"}
        initialEditingItemId={editParam}
        items={items ?? []}
      />
    </>
  );
}
