"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  addComment,
  deleteComment,
  type CommentTarget,
  type ContentComment,
} from "./comment-actions";

export function CommentThread({
  contentId,
  target,
  comments,
  currentUserId,
  onRefresh,
  compact = false,
}: {
  contentId: string;
  target: CommentTarget;
  comments: ContentComment[];
  currentUserId: string;
  onRefresh: () => Promise<void>;
  compact?: boolean;
}) {
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();
  const scopedComments = comments.filter((comment) =>
    target.type === "content"
      ? comment.section_id === null && comment.finding_id === null
      : target.type === "section"
        ? comment.section_id === target.sectionId
        : comment.finding_id === target.findingId
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await addComment(contentId, body, target);
      if ("error" in result) {
        setFeedback(result.error);
        return;
      }
      setBody("");
      setFeedback("");
      await onRefresh();
    });
  }

  function remove(commentId: string) {
    if (!window.confirm("Delete this comment?")) {
      return;
    }
    startTransition(async () => {
      const error = await deleteComment(commentId);
      if (error) {
        setFeedback(error);
        return;
      }
      await onRefresh();
    });
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {scopedComments.map((comment) => (
        <article className="rounded-lg bg-zinc-50 p-3" key={comment.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-800">
                {comment.author_email}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 capitalize text-zinc-600">
                {comment.author_role.replace("_", " ")}
              </span>
              <time className="text-zinc-500" dateTime={comment.created_at}>
                {new Date(comment.created_at).toLocaleString()}
              </time>
            </div>
            {comment.author_id === currentUserId && (
              <button
                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                disabled={isPending}
                onClick={() => remove(comment.id)}
                type="button"
              >
                Delete
              </button>
            )}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-zinc-700">
            {comment.body}
          </p>
        </article>
      ))}
      {scopedComments.length === 0 && (
        <p className="text-xs text-zinc-500">No comments yet.</p>
      )}

      <form className="space-y-2" onSubmit={submit}>
        <label className="sr-only" htmlFor={`comment-${contentId}-${targetKey(target)}`}>
          Add a comment
        </label>
        <textarea
          className="min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800"
          id={`comment-${contentId}-${targetKey(target)}`}
          maxLength={2_000}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a comment..."
          required
          value={body}
        />
        {feedback && (
          <p className="text-xs text-red-700" role="status">
            {feedback}
          </p>
        )}
        <button
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          disabled={isPending || !body.trim()}
          type="submit"
        >
          {isPending ? "Posting..." : "Comment"}
        </button>
      </form>
    </div>
  );
}

function targetKey(target: CommentTarget): string {
  if (target.type === "content") {
    return "content";
  }
  return target.type === "section"
    ? `section-${target.sectionId}`
    : `finding-${target.findingId}`;
}

export function CommentsPanel({
  contentId,
  comments,
  currentUserId,
  onRefresh,
}: {
  contentId: string;
  comments: ContentComment[];
  currentUserId: string;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Content comments</h2>
      <p className="mb-4 mt-1 text-xs text-zinc-500">
        Comments are available to organisation members in every content status.
      </p>
      <CommentThread
        comments={comments}
        contentId={contentId}
        currentUserId={currentUserId}
        onRefresh={onRefresh}
        target={{ type: "content" }}
      />
    </section>
  );
}
