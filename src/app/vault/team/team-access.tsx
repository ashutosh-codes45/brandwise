"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { isMemberRole, type MemberRole } from "@/lib/auth/roles";
import {
  addByEmail,
  changeRole,
  createInvite,
  deleteInvite,
  removeMember,
} from "./actions";

type TeamMember = {
  user_id: string;
  email: string | null;
  role: MemberRole;
};

type TeamInvite = {
  id: string;
  code: string;
  role: "creator" | "reviewer";
  expires_at: string;
};

const roleLabels: Record<MemberRole, string> = {
  brand_manager: "Brand Manager",
  creator: "Creator",
  reviewer: "Reviewer",
};

export function TeamAccess({
  currentUserId,
  members,
  invites,
}: {
  currentUserId: string;
  members: TeamMember[];
  invites: TeamInvite[];
}) {
  const router = useRouter();
  const [memberRole, setMemberRole] = useState<MemberRole>("creator");
  const [inviteRole, setInviteRole] = useState<"creator" | "reviewer">("creator");
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [generatedInvite, setGeneratedInvite] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showResult(error: string | null) {
    setFeedback(error ?? "Changes saved.");
    setFeedbackIsError(Boolean(error));
    router.refresh();
  }

  function handleAddByEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setFeedback("");
    startTransition(async () => {
      const error = await addByEmail(formData.get("email"), memberRole);
      showResult(error);
      if (!error) {
        form.reset();
      }
    });
  }

  function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    startTransition(async () => {
      const result = await createInvite(inviteRole);
      if ("error" in result) {
        setFeedback(result.error);
        setFeedbackIsError(true);
        return;
      }
      setGeneratedInvite({ code: result.code, expiresAt: result.expiresAt });
      setFeedback("Invite code created.");
      setFeedbackIsError(false);
      router.refresh();
    });
  }

  function handleChangeRole(userId: string, value: string) {
    if (!isMemberRole(value)) {
      setFeedback("Select a valid member role.");
      return;
    }
    setFeedback("");
    startTransition(async () => {
      showResult(await changeRole(userId, value));
    });
  }

  function handleRemoveMember(member: TeamMember) {
    if (!window.confirm(`Remove ${member.email ?? "this member"} from the organisation?`)) {
      return;
    }
    setFeedback("");
    startTransition(async () => {
      showResult(await removeMember(member.user_id));
    });
  }

  async function handleCopyCode() {
    if (!generatedInvite) {
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedInvite.code);
      setFeedback("Invite code copied.");
      setFeedbackIsError(false);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? `Could not copy invite code: ${error.message}`
          : "Could not copy invite code."
      );
      setFeedbackIsError(true);
    }
  }

  function handleDeleteInvite(invite: TeamInvite) {
    if (!window.confirm(`Delete the unused invite code ${invite.code}?`)) {
      return;
    }
    setFeedback("");
    startTransition(async () => {
      showResult(await deleteInvite(invite.id));
    });
  }

  return (
    <div className="space-y-8">
      {feedback && (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${
            feedbackIsError
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-800"
          }`}
          role="status"
        >
          {feedback}
        </p>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Team members</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Role</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {members.map((member) => {
                const isCurrentUser = member.user_id === currentUserId;
                return (
                  <tr key={member.user_id}>
                    <td className="px-3 py-3 text-zinc-900">
                      {member.email ?? "Email unavailable"}
                      {isCurrentUser && (
                        <span className="ml-2 text-xs text-zinc-500">(you)</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`Role for ${member.email ?? member.user_id}`}
                        className="rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-zinc-900 disabled:opacity-60"
                        disabled={isPending}
                        onChange={(event) =>
                          handleChangeRole(member.user_id, event.target.value)
                        }
                        value={member.role}
                      >
                        {Object.entries(roleLabels).map(([role, label]) => (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      {isCurrentUser ? (
                        <span className="text-zinc-400">Cannot remove</span>
                      ) : (
                        <button
                          className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                          disabled={isPending}
                          onClick={() => handleRemoveMember(member)}
                          type="button"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td className="px-3 py-5 text-zinc-500" colSpan={3}>
                    No members found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Add by email</h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
          onSubmit={handleAddByEmail}
        >
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="memberEmail"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="memberEmail"
              name="email"
              required
              type="email"
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="memberRole"
            >
              Role
            </label>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
              id="memberRole"
              onChange={(event) => {
                if (isMemberRole(event.target.value)) {
                  setMemberRole(event.target.value);
                }
              }}
              value={memberRole}
            >
              {Object.entries(roleLabels).map(([role, label]) => (
                <option key={role} value={role}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            className="self-end rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            Add member
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-zinc-900">Invite code</h2>
        <form
          className="mt-4 flex flex-wrap items-end gap-4"
          onSubmit={handleCreateInvite}
        >
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor="inviteRole"
            >
              Role
            </label>
            <select
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
              id="inviteRole"
              onChange={(event) => {
                if (event.target.value === "creator" || event.target.value === "reviewer") {
                  setInviteRole(event.target.value);
                }
              }}
              value={inviteRole}
            >
              <option value="creator">Creator</option>
              <option value="reviewer">Reviewer</option>
            </select>
          </div>
          <button
            className="rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={isPending}
            type="submit"
          >
            Generate code
          </button>
        </form>

        {generatedInvite && (
          <div className="mt-4 rounded-lg bg-indigo-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <code className="text-lg font-semibold tracking-widest text-indigo-900">
                {generatedInvite.code}
              </code>
              <button
                className="rounded-md border border-indigo-200 px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-white"
                onClick={handleCopyCode}
                type="button"
              >
                Copy
              </button>
            </div>
            <p className="mt-2 text-sm text-indigo-800">
              Expires{" "}
              <time dateTime={generatedInvite.expiresAt}>
                {generatedInvite.expiresAt}
              </time>
            </p>
          </div>
        )}

        <h3 className="mt-7 text-sm font-semibold text-zinc-800">
          Unused invites
        </h3>
        <ul className="mt-3 divide-y divide-zinc-100">
          {invites.map((invite) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              key={invite.id}
            >
              <div>
                <code className="font-semibold tracking-wider text-zinc-900">
                  {invite.code}
                </code>
                <span className="ml-3 text-zinc-600">
                  {roleLabels[invite.role]}
                </span>
                <p className="mt-1 text-xs text-zinc-500">
                  Expires {invite.expires_at}
                </p>
              </div>
              <button
                className="font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                disabled={isPending}
                onClick={() => handleDeleteInvite(invite)}
                type="button"
              >
                Delete
              </button>
            </li>
          ))}
          {invites.length === 0 && (
            <li className="py-3 text-sm text-zinc-500">
              No unused invite codes.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
