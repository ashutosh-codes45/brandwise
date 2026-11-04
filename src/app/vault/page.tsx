import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { getCurrentMember } from "@/lib/auth/current-member";

export const instant = false;

export default function VaultPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <Suspense
        fallback={
          <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Brand Manager Vault
            </h1>
            <p className="mt-6 text-sm text-zinc-500">Loading your vault...</p>
          </section>
        }
      >
        <VaultContent />
      </Suspense>
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

  return (
    <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Brand Manager Vault
      </h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="font-medium text-zinc-500">Email</dt>
          <dd className="mt-1 text-zinc-900">{member.email}</dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-500">Role</dt>
          <dd className="mt-1 text-zinc-900">{member.role}</dd>
        </div>
      </dl>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          className="rounded-lg border border-zinc-300 px-4 py-2.5 font-medium text-zinc-700 hover:bg-zinc-50"
          href="/vault/team"
        >
          Manage team
        </Link>
        <form action={signOut}>
          <button className="rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white hover:bg-zinc-700">
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}
