"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { signUp } from "./actions";
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

export function SignupForm() {
  const [role, setRole] = useState<MemberRole>("brand_manager");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (formData.get("password") !== formData.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    startTransition(async () => {
      const result = await signUp(
        formData.get("email"),
        formData.get("password"),
        role,
        formData.get("orgName"),
        formData.get("inviteCode")
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
          Create your BrandWise account
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Set up your account to get started.
        </p>

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
              autoComplete="new-password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
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
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="confirmPassword"
              name="confirmPassword"
              required
              type="password"
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="role"
            >
              Role
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

          {role === "brand_manager" && (
            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="orgName"
              >
                Organisation name
              </label>
              <input
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                id="orgName"
                name="orgName"
                required
                type="text"
              />
            </div>
          )}

          {role !== "brand_manager" && (
            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-zinc-700"
                htmlFor="inviteCode"
              >
                Invite code <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input
                autoCapitalize="characters"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 uppercase text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                id="inviteCode"
                maxLength={8}
                name="inviteCode"
                pattern="[A-Za-z0-9]{8}"
                type="text"
              />
            </div>
          )}

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
            {isPending ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600">
          Already have an account?{" "}
          <Link className="font-medium text-indigo-600 hover:text-indigo-700" href="/login">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
