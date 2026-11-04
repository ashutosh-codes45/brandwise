"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { signIn } from "./actions";
import {
  isMemberRole,
  memberRoles,
  type MemberRole,
} from "@/lib/auth/roles";

const roleLabels: Record<MemberRole, string> = {
  brand_manager: "Brand Manager",
  creator: "Creator",
  reviewer: "Reviewer",
};

export function LoginForm({
  message,
  initialError,
}: {
  message?: string;
  initialError?: string;
}) {
  const [role, setRole] = useState<MemberRole>("brand_manager");
  const [error, setError] = useState(initialError ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError("");

    startTransition(async () => {
      const result = await signIn(
        formData.get("email"),
        formData.get("password"),
        role
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

        {message && (
          <p className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </p>
        )}

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
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="password"
              name="password"
              required
              type="password"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="role"
            >
              Sign in as
            </label>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="role"
              name="role"
              onChange={(event) => {
                if (isMemberRole(event.target.value)) {
                  setRole(event.target.value);
                }
              }}
              value={role}
            >
              {memberRoles.map((memberRole) => (
                <option key={memberRole} value={memberRole}>
                  {roleLabels[memberRole]}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

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
          <Link className="font-medium text-indigo-600 hover:text-indigo-700" href="/signup">
            Create an account
          </Link>
        </p>
      </section>
    </main>
  );
}
