import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentMember } from "@/lib/auth/current-member";
import { NewContentForm } from "./new-content-form";
import { AppNav } from "@/components/app-nav";

export const instant = false;

export default function NewContentPage() {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading...
            </section>
          }
        >
          <NewContentContent />
        </Suspense>
      </div>
    </main>
  );
}

async function NewContentContent() {
  await connection();
  const member = await getCurrentMember();

  if (!member) {
    redirect("/login");
  }
  if (member.role !== "creator") {
    redirect("/workspace");
  }

  return (
    <>
    <AppNav member={member} />
    <section className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
      <Link
        className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
        href="/workspace"
      >
        &larr; Back to workspace
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-900">
        New content
      </h1>
      <p className="mt-2 text-sm text-zinc-600">
        Start a draft. You can add sections and platforms in the editor.
      </p>
      <NewContentForm />
    </section>
    </>
  );
}
