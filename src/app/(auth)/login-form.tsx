"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { signIn } from "./actions";
import { AuthNoticeBanner } from "@/components/auth-notice";
import { getAuthNotice } from "@/lib/auth/notices";

export function LoginForm({
  initialNotice,
}: {
  initialNotice?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const notice = error ? null : getAuthNotice(initialNotice);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await signIn(
        formData.get("email"),
        formData.get("password")
      );
      if (result) {
        setError(result);
      }
    });
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          Sign in to BrandWise
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Access your organisation workspace.
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
              Password
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-zinc-50"
              disabled={isPending}
              id="password"
              name="password"
              required
              type="password"
            />
          </div>

          <button
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            {isPending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600">
          New to BrandWise?{" "}
          <Link
            className="font-medium text-indigo-600 hover:text-indigo-700"
            href="/signup"
          >
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
