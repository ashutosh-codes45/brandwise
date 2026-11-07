"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createOrganisation, joinWithInvite } from "./actions";
import { signOut } from "@/app/(auth)/actions";
import { AuthNoticeBanner } from "@/components/auth-notice";
import { getAuthNotice } from "@/lib/auth/notices";

export function OnboardingView({
  initialNotice,
  userEmail,
}: {
  initialNotice?: string;
  userEmail: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isCreating, startCreateTransition] = useTransition();
  const [isJoining, startJoinTransition] = useTransition();

  const notice = error ? null : getAuthNotice(initialNotice);
  const isPending = isCreating || isJoining;

  function handleCreateOrg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const orgName = formData.get("orgName");
    setError(null);

    startCreateTransition(async () => {
      const result = await createOrganisation(orgName);
      if (result) {
        setError(result);
      }
    });
  }

  function handleJoinWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const inviteCode = formData.get("inviteCode");
    setError(null);

    startJoinTransition(async () => {
      const result = await joinWithInvite(inviteCode);
      if (result) {
        setError(result);
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-2xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            Welcome to BrandWise
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Signed in as <span className="font-medium text-zinc-800">{userEmail}</span>. Choose how you want to get started.
          </p>
        </header>

        {error ? (
          <div className="mb-6">
            <AuthNoticeBanner message={error} type="error" />
          </div>
        ) : notice ? (
          <div className="mb-6">
            <AuthNoticeBanner message={notice.message} type={notice.type} />
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Card 1: Create Organisation */}
          <section className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex-1">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-zinc-900">
                Create an organisation
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Set up a new organisation workspace. You will become its Brand Manager.
              </p>

              <form className="mt-5 space-y-4" onSubmit={handleCreateOrg}>
                <div>
                  <label
                    className="mb-1.5 block text-sm font-medium text-zinc-700"
                    htmlFor="orgName"
                  >
                    Organisation name
                  </label>
                  <input
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
                    disabled={isPending}
                    id="orgName"
                    maxLength={80}
                    minLength={2}
                    name="orgName"
                    placeholder="e.g. Acme Corp"
                    required
                    type="text"
                  />
                </div>

                <button
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  type="submit"
                >
                  {isCreating ? "Creating organisation..." : "Create organisation"}
                </button>
              </form>
            </div>
          </section>

          {/* Card 2: Join with Invite Code */}
          <section className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex-1">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <h2 className="mt-4 text-lg font-semibold text-zinc-900">
                Join with an invite code
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Received an 8-character invite code from your Brand Manager? Enter it here.
              </p>

              <form className="mt-5 space-y-4" onSubmit={handleJoinWithCode}>
                <div>
                  <label
                    className="mb-1.5 block text-sm font-medium text-zinc-700"
                    htmlFor="inviteCode"
                  >
                    Invite code
                  </label>
                  <input
                    autoCapitalize="characters"
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 uppercase tracking-wider text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
                    disabled={isPending}
                    id="inviteCode"
                    maxLength={8}
                    minLength={8}
                    name="inviteCode"
                    pattern="[A-Za-z0-9]{8}"
                    placeholder="e.g. 8 characters"
                    required
                    type="text"
                  />
                </div>

                <button
                  className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  type="submit"
                >
                  {isJoining ? "Joining..." : "Join with code"}
                </button>
              </form>
            </div>
          </section>
        </div>

        <div className="mt-8 text-center">
          <form action={signOut}>
            <button
              className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
              type="submit"
            >
              Sign out of {userEmail}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
