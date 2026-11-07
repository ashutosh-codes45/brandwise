"use client";

import { useState, useTransition } from "react";
import {
  applyFindingsAction,
  dismissFindingAction,
  getReviewState,
  refineFindingAction,
  runReviewAction,
} from "./review-actions";
import type { ReviewFindingState } from "@/lib/review/types";
import { dailyAiCallLimit } from "@/lib/review/usage";
import {
  CommentThread,
} from "./comments-panel";
import type { ContentComment } from "./comment-actions";

type AppliedSection = {
  id: string;
  type: "text" | "image";
  body: string | null;
  image_path: string | null;
  alt_text: string | null;
  position: number;
};

const severityStyles: Record<string, string> = {
  blocker: "bg-red-100 text-red-800",
  fix: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
};

export function ReviewPanel({
  contentId,
  sectionLabels,
  editable,
  unsavedChanges,
  initialFindings,
  initialStats,
  initialAiCallsToday,
  comments,
  currentUserId,
  onCommentsRefresh,
  onFocusExcerpt,
  onSectionsApplied,
}: {
  contentId: string;
  sectionLabels: Array<{ id: string; label: string }>;
  editable: boolean;
  unsavedChanges: boolean;
  initialFindings: ReviewFindingState[];
  initialStats: Record<string, unknown> | null;
  initialAiCallsToday: number;
  comments: ContentComment[];
  currentUserId: string;
  onCommentsRefresh: () => Promise<void>;
  onFocusExcerpt: (sectionId: string, excerpt: string) => void;
  onSectionsApplied: (sections: AppliedSection[]) => void;
}) {
  const [findings, setFindings] = useState<ReviewFindingState[]>(initialFindings);
  const [stats, setStats] = useState<Record<string, unknown> | null>(
    initialStats
  );
  const [aiCallsToday, setAiCallsToday] = useState(initialAiCallsToday);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [refinementPrompts, setRefinementPrompts] = useState<
    Record<string, string>
  >({});
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>(
    {}
  );
  const [feedback, setFeedback] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const openFindings = findings.filter((finding) => finding.status === "open");
  const resolvedFindings = findings.filter(
    (finding) => finding.status === "applied" || finding.status === "dismissed"
  );
  const sectionName = new Map(
    sectionLabels.map((section) => [section.id, section.label])
  );
  const groupedOpenFindings = [
    ...openFindings.reduce((groups, finding) => {
      const key = finding.section_id ?? "";
      groups.set(key, [...(groups.get(key) ?? []), finding]);
      return groups;
    }, new Map<string, ReviewFindingState[]>()),
  ];
  const missingSourceDrops =
    typeof stats?.drop_reasons === "object" &&
    stats.drop_reasons !== null &&
    "missing_source" in stats.drop_reasons &&
    typeof stats.drop_reasons.missing_source === "number"
      ? stats.drop_reasons.missing_source
      : 0;

  function loadLatest() {
    startTransition(async () => {
      const state = await getReviewState(contentId);
      if ("error" in state) {
        setFeedback(state.error);
        setIsError(true);
        return;
      }
      setFindings(state.findings);
      setStats(state.stats);
      setAiCallsToday(state.aiCallsToday);
      setSelectedIds([]);
    });
  }

  function runReview() {
    setFeedback("");
    startTransition(async () => {
      const result = await runReviewAction(contentId);
      if ("error" in result) {
        setFeedback(result.error);
        setIsError(true);
        return;
      }
      setFindings((current) => [
        ...result.findings.map(
          (finding) =>
            ({
              ...finding,
                run_id: result.runId,
                status: "open",
                note: finding.note,
                source: null,
                events: [],
                dismiss_reason: null,
              })
        ),
        ...current.filter(
          (finding) => finding.status === "applied" || finding.status === "dismissed"
        ),
      ]);
      setStats({
        ...result.stats,
        drop_reasons: result.stats.drop_reasons,
      });
      setOverrides({});
      setSelectedIds([]);
      setFeedback(
        result.stats.ai_skipped_reason
          ? "Rule-based findings saved; see the AI checks notice below."
          : "Review complete."
      );
      setIsError(false);
      loadLatest();
    });
  }

  function selectAllBlockers() {
    setSelectedIds(
      openFindings
        .filter((finding) => finding.severity === "blocker")
        .map((finding) => finding.id)
    );
  }

  function applySelected() {
    if (unsavedChanges) {
      setFeedback("Save your changes before applying review suggestions.");
      setIsError(true);
      return;
    }
    if (selectedIds.length === 0) {
      setFeedback("Select at least one finding to apply.");
      setIsError(true);
      return;
    }

    startTransition(async () => {
      const result = await applyFindingsAction(
        contentId,
        selectedIds,
        overrides
      );
      if ("error" in result) {
        setFeedback(result.error);
        setIsError(true);
        return;
      }
      onSectionsApplied(result.sections);
      setFeedback(
        result.warning ??
          `Applied ${result.applied} ${result.applied === 1 ? "fix" : "fixes"}.`
      );
      setIsError(Boolean(result.warning));
      setSelectedIds([]);
      loadLatest();
    });
  }

  function dismiss(findingId: string) {
    const reason = dismissReasons[findingId]?.trim() ?? "";
    if (!reason) {
      setFeedback("Enter a reason before dismissing this finding.");
      setIsError(true);
      return;
    }
    startTransition(async () => {
      const error = await dismissFindingAction(findingId, reason);
      if (error) {
        setFeedback(error);
        setIsError(true);
        return;
      }
      setFeedback("Finding dismissed.");
      setIsError(false);
      loadLatest();
    });
  }

  function refine(finding: ReviewFindingState) {
    const prompt = refinementPrompts[finding.id]?.trim() ?? "";
    if (!prompt) {
      setFeedback("Enter an instruction for refining this suggestion.");
      setIsError(true);
      return;
    }
    startTransition(async () => {
      const result = await refineFindingAction(finding.id, prompt);
      if ("error" in result) {
        setFeedback(result.error);
        setIsError(true);
        loadLatest();
        return;
      }
      setFindings((current) =>
        current.map((item) =>
          item.id === finding.id
            ? {
                ...item,
                suggestion: result.suggestion,
                suggestion_origin: "ai",
                events: [
                  ...item.events,
                  {
                    id: `local-${Date.now()}`,
                    actor_type: "ai",
                    event: "refined",
                    prompt,
                    before_text: finding.suggestion,
                    after_text: result.suggestion,
                    note: null,
                    created_at: new Date().toISOString(),
                  },
                ],
              }
            : item
        )
      );
      setOverrides((current) => ({
        ...current,
        [finding.id]: result.suggestion,
      }));
      setFeedback("Suggestion refined. Review it before applying.");
      setIsError(false);
      loadLatest();
    });
  }

  const counted = (key: string) =>
    typeof stats?.[key] === "number" ? (stats[key] as number) : 0;

  return (
    <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Review</h2>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              AI-generated suggestions are advisory. Review each source and
              approve fixes before they change your draft.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-zinc-500">
              AI calls today: {aiCallsToday} / {dailyAiCallLimit} (free tier)
            </span>
            {editable && (
              <button
                className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  isPending || unsavedChanges || aiCallsToday >= dailyAiCallLimit
                }
                onClick={runReview}
                title={
                  unsavedChanges
                    ? "Save your changes before running a review."
                    : aiCallsToday >= dailyAiCallLimit
                      ? "Daily free-tier AI call limit reached."
                      : "Run rule checks and AI review"
                }
                type="button"
              >
                {isPending ? "Working..." : "Run review"}
              </button>
            )}
          </div>
        </div>
        {aiCallsToday >= dailyAiCallLimit && (
          <p className="mt-1 text-right text-xs text-amber-700">
            Daily AI call limit reached. Try again tomorrow.
          </p>
        )}
        {typeof stats?.ai_skipped_reason === "string" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
            AI checks were skipped: {stats.ai_skipped_reason}
          </p>
        )}

        {stats && (
          <div className="mt-3 space-y-1 text-xs text-zinc-600">
            <p>
              Judged by:{" "}
              {stats.judge_provider === "gemini"
                ? `Gemini${typeof stats.fallback_reason === "string" ? ` (fallback: ${stats.fallback_reason})` : ""}`
                : stats.judge_provider === "groq"
                  ? `Groq${typeof stats.fallback_reason === "string" ? ` (fallback: ${stats.fallback_reason})` : ""}`
                  : "None"}
            </p>
            <p>
              Retrieval:{" "}
              {stats.retrieval_mode === "text_search" ? "text search" : "vector"}
            </p>
          </div>
        )}

        {stats && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 text-center">
            <div>
              <p className="text-lg font-semibold text-red-700">
                {openFindings.filter((finding) => finding.severity === "blocker").length}
              </p>
              <p className="text-[11px] text-zinc-500">Blockers</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-amber-700">
                {openFindings.filter((finding) => finding.severity === "fix").length}
              </p>
              <p className="text-[11px] text-zinc-500">Fixes</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-blue-700">
                {openFindings.filter((finding) => finding.severity === "info").length}
              </p>
              <p className="text-[11px] text-zinc-500">Info</p>
            </div>
            <p className="col-span-3 text-xs text-zinc-600">
              {counted("rule_raised")} rules · {counted("ai_raised")} AI ·{" "}
              {counted("dropped")} AI findings dropped; {missingSourceDrops} for
              missing sources
            </p>
          </div>
        )}

        {feedback && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              isError ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"
            }`}
            role="status"
          >
            {feedback}
          </p>
        )}

        {editable && openFindings.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              disabled={isPending}
              onClick={selectAllBlockers}
              type="button"
            >
              Select all blockers
            </button>
            <button
              className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={isPending || unsavedChanges || selectedIds.length === 0}
              title={
                unsavedChanges
                  ? "Save your changes before applying suggestions."
                  : undefined
              }
              onClick={applySelected}
              type="button"
            >
              Apply selected fixes
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {groupedOpenFindings.map(([sectionId, sectionFindings]) => (
            <div className="space-y-3" key={sectionId}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {sectionName.get(sectionId) ?? "General"}
              </h3>
              {sectionFindings.map((finding) => (
            <article
              className="rounded-xl border border-zinc-200 p-3"
              key={finding.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                {editable && (
                  <input
                    aria-label="Select finding for application"
                    checked={selectedIds.includes(finding.id)}
                    className="size-4 rounded border-zinc-300 text-indigo-600"
                    onChange={(event) =>
                      setSelectedIds((current) =>
                        event.target.checked
                          ? [...current, finding.id]
                          : current.filter((id) => id !== finding.id)
                      )
                    }
                    type="checkbox"
                  />
                )}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    severityStyles[finding.severity] ?? "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  {finding.severity}
                </span>
                <span className="text-xs font-medium capitalize text-zinc-700">
                  {finding.category}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600">
                  {finding.origin === "rule" ? "Rule" : "AI suggestion"}
                </span>
              </div>

              {finding.section_id && (
                <button
                  className="mt-3 text-left text-sm font-medium text-indigo-700 underline decoration-dotted underline-offset-2"
                  onClick={() =>
                    onFocusExcerpt(
                      finding.section_id!,
                      finding.excerpt ?? ""
                    )
                  }
                  type="button"
                >
                  {finding.excerpt ? `“${finding.excerpt}”` : "View section"}
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    {sectionName.get(finding.section_id) ?? "Section"}
                  </span>
                </button>
              )}
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Why flagged
              </p>
              <p className="mt-1 text-sm leading-5 text-zinc-700">
                {finding.reason}
              </p>

              <div className="mt-3 rounded-lg bg-zinc-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Source
                </p>
                {finding.source?.is_confidential ? (
                  <p className="mt-1 text-sm text-zinc-800">
                    Confidential source: {finding.source.title}
                  </p>
                ) : finding.source ? (
                  <>
                    <p className="mt-1 text-sm font-medium text-zinc-800">
                      {finding.source.kind} · {finding.source.title}
                    </p>
                    {finding.source.valid_until && (
                      <p className="mt-1 text-xs text-zinc-500">
                        Valid until {finding.source.valid_until}
                      </p>
                    )}
                    {finding.source_quote && (
                      <blockquote className="mt-2 border-l-2 border-zinc-300 pl-2 text-xs italic text-zinc-600">
                        {finding.source_quote}
                      </blockquote>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-sm text-zinc-600">
                    {finding.source_label ?? "No Vault source (deterministic rule)."}
                  </p>
                )}
              </div>

              <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Suggested fix
                  </p>
                  {finding.suggestion_origin === "correction_history" && (
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800">
                      Recommended from past correction
                    </span>
                  )}
                </div>
                {finding.note && (
                  <p className="mt-1 text-xs text-violet-700">{finding.note}</p>
                )}
                {editable ? (
                  <textarea
                    className="mt-2 min-h-20 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-800"
                    disabled={isPending}
                    onChange={(event) =>
                      setOverrides((current) => ({
                        ...current,
                        [finding.id]: event.target.value,
                      }))
                    }
                    value={overrides[finding.id] ?? finding.suggestion ?? ""}
                  />
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                    {finding.suggestion}
                  </p>
                )}
              </div>

              <details className="mt-3 border-t border-zinc-100 pt-2">
                <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                  Comments (
                  {comments.filter((comment) => comment.finding_id === finding.id).length}
                  )
                </summary>
                <div className="mt-3">
                  <CommentThread
                    comments={comments}
                    compact
                    contentId={contentId}
                    currentUserId={currentUserId}
                    onRefresh={onCommentsRefresh}
                    target={{ type: "finding", findingId: finding.id }}
                  />
                </div>
              </details>

              {editable && (
                <>
                  <label className="mt-3 block text-xs font-semibold text-zinc-600">
                    Refine with AI
                    <textarea
                      className="mt-1 min-h-14 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal text-zinc-800"
                      maxLength={1_000}
                      onChange={(event) =>
                        setRefinementPrompts((current) => ({
                          ...current,
                          [finding.id]: event.target.value,
                        }))
                      }
                      placeholder="For example: make the wording more concise"
                      value={refinementPrompts[finding.id] ?? ""}
                    />
                  </label>
                  <button
                    className="mt-2 rounded-md border border-indigo-200 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    disabled={
                      isPending ||
                      aiCallsToday >= dailyAiCallLimit ||
                      !refinementPrompts[finding.id]?.trim()
                    }
                    onClick={() => refine(finding)}
                    type="button"
                  >
                    {isPending ? "Refining..." : "Refine with AI"}
                  </button>

                  <label className="mt-3 block text-xs font-semibold text-zinc-600">
                    Dismiss reason
                    <input
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-normal text-zinc-800"
                      maxLength={1_000}
                      onChange={(event) =>
                        setDismissReasons((current) => ({
                          ...current,
                          [finding.id]: event.target.value,
                        }))
                      }
                      required
                      value={dismissReasons[finding.id] ?? ""}
                    />
                  </label>
                  <button
                    className="mt-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    disabled={isPending || !dismissReasons[finding.id]?.trim()}
                    onClick={() => dismiss(finding.id)}
                    type="button"
                  >
                    Dismiss
                  </button>
                </>
              )}

              <details className="mt-3 border-t border-zinc-100 pt-2">
                <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                  History ({finding.events.length})
                </summary>
                <ol className="mt-2 space-y-2 border-l border-zinc-200 pl-3">
                  {finding.events.map((event) => (
                    <li className="text-xs text-zinc-600" key={event.id}>
                      <p className="font-medium capitalize">
                        {event.event.replaceAll("_", " ")} ·{" "}
                        {new Date(event.created_at).toLocaleString()}
                      </p>
                      {event.prompt && <p>Instruction: {event.prompt}</p>}
                      {event.before_text && <p>Before: {event.before_text}</p>}
                      {event.after_text && <p>After: {event.after_text}</p>}
                      {event.note && <p>{event.note}</p>}
                    </li>
                  ))}
                  {finding.events.length === 0 && (
                    <li className="text-xs text-zinc-500">No history yet.</li>
                  )}
                </ol>
              </details>
            </article>
              ))}
            </div>
          ))}
          {openFindings.length === 0 && (
            <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
              {editable
                ? "No open findings. Run a review to check this saved draft."
                : "No open findings."}
            </p>
          )}
        </div>

        {resolvedFindings.length > 0 && (
          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-medium text-zinc-700">
              Resolved ({resolvedFindings.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {resolvedFindings.map((finding) => (
                <li
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"
                  key={finding.id}
                >
                  <span className="mr-2 rounded-full bg-zinc-200 px-2 py-0.5 text-xs capitalize text-zinc-700">
                    {finding.status}
                  </span>
                  <span className="font-medium text-zinc-800">
                    {finding.excerpt || finding.category}
                  </span>
                  {finding.dismiss_reason && (
                    <p className="mt-1 text-xs text-zinc-600">
                      {finding.dismiss_reason}
                    </p>
                  )}
                  <details className="mt-2 border-t border-zinc-200 pt-2">
                    <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                      Comments (
                      {comments.filter(
                        (comment) => comment.finding_id === finding.id
                      ).length}
                      )
                    </summary>
                    <div className="mt-3">
                      <CommentThread
                        comments={comments}
                        compact
                        contentId={contentId}
                        currentUserId={currentUserId}
                        onRefresh={onCommentsRefresh}
                        target={{ type: "finding", findingId: finding.id }}
                      />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </aside>
  );
}
