"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { signUp } from "./actions";
import { AuthNoticeBanner } from "@/components/auth-notice";
import { getAuthNotice } from "@/lib/auth/notices";

export function SignupForm({
  initialNotice,
}: {
  initialNotice?: string;
}) {
  const [pathType, setPathType] = useState<"create" | "join">("create");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const notice = error ? null : getAuthNotice(initialNotice);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const email = formData.get("email");
    const inviteCode = formData.get("inviteCode");

    setError(null);
    startTransition(async () => {
      const result = await signUp(
        email,
        password,
        pathType,
        pathType === "join" ? inviteCode : undefined
      );
      if (result) {
        setError(result);
      }
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Create your BrandWise account
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Set up your credentials and choose how to get started.
        </p>

        <div className="mt-5">
          {error ? (
            <AuthNoticeBanner message={error} type="error" />
          ) : notice ? (
            <AuthNoticeBanner message={notice.message} type={notice.type} />
          ) : null}
        </div>

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="email"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
              disabled={isPending}
              id="email"
              name="email"
              required
              type="email"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="password"
            >
              Password (min 8 characters)
            </label>
            <input
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
              disabled={isPending}
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="confirmPassword"
            >
              Confirm password
            </label>
            <input
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
              disabled={isPending}
              id="confirmPassword"
              minLength={8}
              name="confirmPassword"
              required
              type="password"
            />
          </div>

          {/* Path selection: two big radio cards */}
          <div>
            <span className="mb-2 block text-sm font-medium text-zinc-700">
              Select your path
            </span>
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                className={`relative flex cursor-pointer flex-col rounded-xl border p-4 transition ${
                  pathType === "create"
                    ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20"
                    : "border-zinc-200 hover:border-zinc-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-900">
                    Create a new workspace
                  </span>
                  <input
                    checked={pathType === "create"}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                    disabled={isPending}
                    name="pathType"
                    onChange={() => setPathType("create")}
                    type="radio"
                    value="create"
                  />
                </div>
                <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                  Start an organisation. You will become the Brand Manager and can invite your team.
                </p>
              </label>

              <label
                className={`relative flex cursor-pointer flex-col rounded-xl border p-4 transition ${
                  pathType === "join"
                    ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20"
                    : "border-zinc-200 hover:border-zinc-300 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-900">
                    Join with an invite code
                  </span>
                  <input
                    checked={pathType === "join"}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500"
                    disabled={isPending}
                    name="pathType"
                    onChange={() => setPathType("join")}
                    type="radio"
                    value="join"
                  />
                </div>
                <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">
                  Join an existing organisation using an 8-character invite code from your Brand Manager.
                </p>
              </label>
            </div>
          </div>

          {pathType === "join" && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="inviteCode"
              >
                Invite code <span className="text-red-500">*</span>
              </label>
              <input
                autoCapitalize="characters"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 uppercase tracking-wider text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-100"
                disabled={isPending}
                id="inviteCode"
                maxLength={8}
                minLength={8}
                name="inviteCode"
                pattern="[A-Za-z0-9]{8}"
                placeholder="e.g. 8 characters"
                required={pathType === "join"}
                type="text"
              />
              <p className="mt-1 text-xs text-zinc-500">
                Creators and Reviewers must join with a valid invite code.
              </p>
            </div>
          )}

          <button
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            {isPending ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600">
          Already have an account?{" "}
          <Link
            className="font-medium text-indigo-600 hover:text-indigo-700"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
