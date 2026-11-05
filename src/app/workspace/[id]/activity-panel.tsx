"use client";

import Link from "next/link";
import type { ContentComment } from "./comment-actions";

export type ContentActivityEvent = {
  id: string;
  actor_id: string;
  event: string;
  from_status: string;
  to_status: string;
  version_id: string | null;
  note: string | null;
  created_at: string;
  actor_email: string;
  actor_role: string;
};

export function ActivityPanel({
  contentId,
  events,
  comments,
}: {
  contentId: string;
  events: ContentActivityEvent[];
  comments: ContentComment[];
}) {
  const timeline = [
    ...events.map((event) => ({ kind: "event" as const, at: event.created_at, event })),
    ...comments.map((comment) => ({
      kind: "comment" as const,
      at: comment.created_at,
      comment,
    })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Activity</h2>
      <ol className="mt-4 space-y-4">
        {timeline.map((item) => (
          <li className="border-l-2 border-zinc-200 pl-4" key={`${item.kind}-${item.kind === "event" ? item.event.id : item.comment.id}`}>
            {item.kind === "event" ? (
              <>
                <p className="text-sm font-medium capitalize text-zinc-900">
                  {item.event.event.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {item.event.actor_email} ·{" "}
                  {item.event.actor_role.replace("_", " ")} ·{" "}
                  {item.event.from_status.replace("_", " ")} →{" "}
                  {item.event.to_status.replace("_", " ")}
                </p>
                {item.event.note && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
                    {item.event.note}
                  </p>
                )}
                {item.event.version_id && (
                  <Link
                    className="mt-1 inline-block text-xs font-medium text-indigo-700 underline"
                    href={`/workspace/${contentId}/versions/${item.event.version_id}`}
                  >
                    View version
                  </Link>
                )}
              </>
            ) : (
              <>
                <p className="text-xs font-medium text-zinc-700">
                  Comment · {item.comment.author_email} ·{" "}
                  {item.comment.author_role.replace("_", " ")}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
                  {item.comment.body}
                </p>
              </>
            )}
            <time
              className="mt-1 block text-xs text-zinc-500"
              dateTime={item.at}
            >
              {new Date(item.at).toLocaleString()}
            </time>
          </li>
        ))}
        {timeline.length === 0 && (
          <li className="text-sm text-zinc-500">No activity yet.</li>
        )}
      </ol>
    </section>
  );
}
