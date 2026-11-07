"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MemberRole } from "@/lib/auth/roles";
import {
  approve,
  reopen,
  requestChanges,
  submitForReview,
} from "./workflow-actions";

const statusNames: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function WorkflowBar({
  contentId,
  status,
  role,
  isCreator,
  unsavedChanges,
  latestChangeNote,
  approvedBy,
}: {
  contentId: string;
  status: string;
  role: MemberRole;
  isCreator: boolean;
  unsavedChanges: boolean;
  latestChangeNote: string | null;
  approvedBy: { email: string; createdAt: string } | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"changes" | "reopen" | null>(null);
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const canSend = isCreator && (
    status === "draft" || status === "changes_requested"
  );
  const canRequest = (role === "reviewer" || role === "brand_manager") &&
    status === "in_review";
  const canApprove = role === "brand_manager" && status === "in_review";
  const canReopen = role === "brand_manager" && status === "approved";

  function sendForReview() {
    if (unsavedChanges) {
      setFeedback("Save your changes before sending content for review.");
      return;
    }
    startTransition(async () => {
      const result = await submitForReview(contentId, false);
      if ("error" in result && result.requiresAcknowledgement) {
        const count = result.openBlockers ?? 0;
        const overLimit = result.overLimitPlatforms ?? [];
        const platformNote =
          overLimit.length > 0
            ? ` (${overLimit.join(", ")} over the platform limit)`
            : "";
        if (
          !window.confirm(
            `There are ${count} open blockers${platformNote}. Send for review anyway?`
          )
        ) {
          return;
        }
        const confirmed = await submitForReview(contentId, true);
        if ("error" in confirmed) {
          setFeedback(confirmed.error);
          return;
        }
      } else if ("error" in result) {
        setFeedback(result.error);
        return;
      }
      setFeedback("");
      router.refresh();
    });
  }

  function approveContent() {
    startTransition(async () => {
      const result = await approve(contentId, false);
      if ("error" in result && result.requiresAcknowledgement) {
        const count = result.openBlockers ?? 0;
        if (!window.confirm(`There are ${count} open blockers. Approve anyway?`)) {
          return;
        }
        const confirmed = await approve(contentId, true);
        if ("error" in confirmed) {
          setFeedback(confirmed.error);
          return;
        }
      } else if ("error" in result) {
        setFeedback(result.error);
        return;
      }
      setFeedback("");
      router.refresh();
    });
  }

  function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) {
      return;
    }
    startTransition(async () => {
      const result =
        dialog === "changes"
          ? await requestChanges(contentId, note)
          : await reopen(contentId, note);
      if ("error" in result) {
        setFeedback(result.error);
        return;
      }
      setDialog(null);
      setNote("");
      setFeedback("");
      router.refresh();
    });
  }

  return (
    <section className="mb-5 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              status === "approved"
                ? "bg-emerald-100 text-emerald-800"
                : status === "changes_requested"
                  ? "bg-amber-100 text-amber-800"
                  : status === "in_review"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {statusNames[status] ?? status}
          </span>
          {status === "changes_requested" && isCreator && latestChangeNote && (
            <p className="mt-3 max-w-3xl text-sm text-amber-800">
              <span className="font-semibold">Changes requested:</span>{" "}
              {latestChangeNote}
            </p>
          )}
          {status === "approved" && approvedBy && (
            <p className="mt-3 text-sm font-medium text-emerald-800">
              Approved by {approvedBy.email} on{" "}
              {new Date(approvedBy.createdAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {status === "approved" && (
            <Link
              className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
              href={`/workspace/${contentId}/export`}
            >
              Export
            </Link>
          )}
          {canSend && (
            <button
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={isPending || unsavedChanges}
              onClick={sendForReview}
              type="button"
            >
              Send for review
            </button>
          )}
          {canRequest && (
            <button
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
              onClick={() => setDialog("changes")}
              type="button"
            >
              Request changes
            </button>
          )}
          {canApprove && (
            <button
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              disabled={isPending}
              onClick={approveContent}
              type="button"
            >
              Approve
            </button>
          )}
          {canReopen && (
            <button
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => setDialog("reopen")}
              type="button"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <p className="mt-3 text-sm text-red-700" role="status">
          {feedback}
        </p>
      )}

      {dialog && (
        <div
          aria-labelledby="workflow-dialog-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
        >
          <form
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
            onSubmit={submitNote}
          >
            <h2
              className="text-lg font-semibold text-zinc-900"
              id="workflow-dialog-title"
            >
              {dialog === "changes" ? "Request changes" : "Reopen approved content"}
            </h2>
            <label className="mt-4 block text-sm font-medium text-zinc-700">
              {dialog === "changes"
                ? "Explain what needs to change"
                : "Why is this content being reopened?"}
              <textarea
                autoFocus
                className="mt-2 min-h-32 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                maxLength={2_000}
                onChange={(event) => setNote(event.target.value)}
                required
                value={note}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm"
                onClick={() => {
                  setDialog(null);
                  setNote("");
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={isPending || !note.trim()}
                type="submit"
              >
                {isPending ? "Saving..." : "Confirm"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
