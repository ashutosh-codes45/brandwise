import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { getCurrentMember } from "@/lib/auth/current-member";
import {
  calculateAcceptanceRate,
  getInsightsNeedsAttention,
  getInsightsOriginSplit,
  getInsightsPatterns,
  getInsightsSummary,
  getInsightsTopSources,
  getInsightsTrend,
  smallSampleLabel,
  sortAttentionSuggestions,
  type InsightsRange,
  type OriginSplit,
} from "@/lib/insights";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

type SearchParams = Promise<{
  days?: string | string[];
  view?: string | string[];
}>;

type SectionProps = {
  orgId: string;
  days: InsightsRange;
  mine: boolean;
  client: Awaited<ReturnType<typeof createClient>>;
};

const ranges = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const;

export default function InsightsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Suspense fallback={<PageSkeleton />}>
          <InsightsContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function InsightsContent({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const member = await getCurrentMember();
  if (!member) {
    redirect("/login");
  }

  const params = await searchParams;
  const selectedDays = Array.isArray(params.days) ? params.days[0] : params.days;
  const selectedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const memberRole = member.role;
  const days = ranges.some((range) => range.value === selectedDays)
    ? selectedDays === "all"
      ? null
      : (Number(selectedDays) as 7 | 30 | 90)
    : 30;
  const mine = memberRole === "creator" && selectedView === "mine";
  const client = await createClient();

  function insightsHref(nextDays: string, nextMine = mine) {
    const query = new URLSearchParams({ days: nextDays });
    if (memberRole === "creator") {
      query.set("view", nextMine ? "mine" : "org");
    }
    return `/insights?${query.toString()}`;
  }

  return (
    <>
      <AppNav member={member} />
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Guideline insights
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Fixed-rule insights from review history, ordered to surface the most
          useful improvements first.
        </p>
      </header>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Time range
          </p>
          <nav aria-label="Insights time range" className="flex flex-wrap gap-2">
            {ranges.map((range) => (
              <Link
                aria-current={
                  (range.value === "all" ? days === null : days === Number(range.value))
                    ? "page"
                    : undefined
                }
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  (range.value === "all" ? days === null : days === Number(range.value))
                    ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                href={insightsHref(range.value)}
                key={range.value}
              >
                {range.label}
              </Link>
            ))}
          </nav>
        </div>
        {memberRole === "creator" && (
          <nav aria-label="Insights view" className="flex gap-5 border-b border-zinc-200">
            <Link
              aria-current={!mine ? "page" : undefined}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                !mine
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
              href={insightsHref(days === null ? "all" : String(days), false)}
            >
              Organisation
            </Link>
            <Link
              aria-current={mine ? "page" : undefined}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                mine
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-zinc-500 hover:text-zinc-700"
              }`}
              href={insightsHref(days === null ? "all" : String(days), true)}
            >
              My insights
            </Link>
          </nav>
        )}
      </div>

      <div className="space-y-6">
        <Suspense fallback={<SectionSkeleton title="Summary" />}>
          <SummarySection {...{ client, orgId: member.orgId, days, mine }} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Needs attention" prominent />}>
          <AttentionSection
            {...{ client, orgId: member.orgId, days, mine }}
            canEditVault={member.role === "brand_manager"}
          />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Most-flagged guidelines and facts" />}>
          <TopSourcesSection {...{ client, orgId: member.orgId, days, mine }} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Repeated mistakes" />}>
          <PatternsSection {...{ client, orgId: member.orgId, days, mine }} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="What happens to suggestions" />}>
          <OutcomesSection {...{ client, orgId: member.orgId, days, mine }} />
        </Suspense>
        <Suspense fallback={<SectionSkeleton title="Trend over time" />}>
          <TrendSection {...{ client, orgId: member.orgId, days, mine }} />
        </Suspense>
      </div>

      <footer className="mt-8 border-t border-zinc-200 pt-5 text-center text-xs text-zinc-500">
        Insights are calculated with fixed rules from your review history. No AI
        is used here.
      </footer>
    </>
  );
}

function SectionHeading({
  title,
  why,
  calculation,
  prominent = false,
}: {
  title: string;
  why: string;
  calculation: string;
  prominent?: boolean;
}) {
  return (
    <div className="border-b border-zinc-100 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{why}</p>
        </div>
        <details className="relative max-w-full text-sm">
          <summary className="cursor-pointer list-none rounded-lg border border-zinc-300 px-3 py-2 font-medium text-indigo-700 hover:bg-indigo-50">
            How this is calculated
          </summary>
          <p className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-4 text-xs leading-5 text-zinc-700 shadow-lg sm:w-96">
            {calculation}
          </p>
        </details>
      </div>
      {prominent && (
        <p className="mt-3 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
          Prioritised guideline improvements
        </p>
      )}
    </div>
  );
}

function SectionCard({
  title,
  why,
  calculation,
  children,
  prominent = false,
}: {
  title: string;
  why: string;
  calculation: string;
  children: React.ReactNode;
  prominent?: boolean;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        prominent ? "border-amber-300 ring-1 ring-amber-100" : "border-zinc-200"
      }`}
    >
      <SectionHeading {...{ title, why, calculation, prominent }} />
      <div className="p-5">{children}</div>
    </section>
  );
}

function SummarySection({ client, orgId, days, mine }: SectionProps) {
  return (
    <SummaryData {...{ client, orgId, days, mine }} />
  );
}

async function SummaryData({ client, orgId, days, mine }: SectionProps) {
  const summary = await getInsightsSummary(client, orgId, days, mine);
  const outcomes =
    summary.fixes_applied + summary.fixes_edited + summary.fixes_rejected;
  const acceptance = calculateAcceptanceRate(
    summary.fixes_applied,
    summary.fixes_edited,
    summary.fixes_rejected
  );
  const stats = [
    { label: "Contents checked", value: summary.contents_checked },
    { label: "Findings raised", value: summary.findings_raised },
    { label: "Blockers raised", value: summary.blockers_raised },
    {
      label: "Fix acceptance rate",
      value: formatRate(acceptance, outcomes),
    },
    {
      label: "Uncited AI findings blocked",
      value: summary.dropped_uncited,
    },
  ];

  return (
    <SectionCard
      title="Summary"
      why="A quick read on review coverage and whether recommendations are useful."
      calculation="Contents checked is the distinct number of contents with a review run in the selected range. Findings and blockers count findings created in that range. Acceptance is (applied + edited) / (applied + edited + rejected) from correction history; n is the number of these outcomes. Uncited AI findings blocked sums review-run drop reasons missing_source and source_not_retrieved_for_section. Approvals count approved content events. Average first-review blockers is the average blocker count on each content's earliest review run in the selected range."
    >
      {summary.contents_checked === 0 ? (
        <p className="mb-4 text-sm text-zinc-500">
          Not enough data yet: run reviews to see this
        </p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map((stat) => (
          <div
            className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"
            key={stat.label}
          >
            <dt className="text-xs font-medium text-zinc-500">{stat.label}</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-600">
        <span>Approvals: {summary.approvals}</span>
        <span>
          Average blockers on first review:{" "}
          {summary.avg_blockers_per_first_review ?? "—"}
        </span>
      </div>
    </SectionCard>
  );
}

async function AttentionSection({
  client,
  orgId,
  days,
  mine,
  canEditVault,
}: SectionProps & { canEditVault: boolean }) {
  const suggestions = sortAttentionSuggestions(
    await getInsightsNeedsAttention(client, orgId, days, mine)
  );

  return (
    <SectionCard
      title="Needs attention"
      why="These rule-based signals point to the most urgent Vault updates."
      calculation="Expired items are cited at least once in the selected range. Repeat mistakes occur in at least 3 distinct contents for the same category and Vault source, or the same rule. Often rejected requires at least 3 citations and at least 50% rejected correction outcomes. Often rewritten requires at least 3 edited corrections. Never cited excludes assets and requires an item older than 14 days with no matching findings in this view. Results are ordered expired, repeat, rejected, rewritten, never cited; ties use evidence count descending. At most 8 are shown."
      prominent
    >
      {suggestions.length === 0 ? (
        <p className="text-sm text-zinc-500">No guideline problems detected</p>
      ) : (
        <ul className="space-y-3">
          {suggestions.map((suggestion, index) => (
            <li
              className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"
              key={`${suggestion.suggestion_type}-${suggestion.vault_item_id ?? suggestion.vault_item_title}-${index}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                      {suggestion.suggestion_type.replaceAll("_", " ")}
                    </span>
                    <span className="text-sm font-semibold text-zinc-900">
                      {suggestion.vault_item_title}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-800">
                    {suggestion.message}
                  </p>
                  <AttentionEvidence suggestion={suggestion} />
                </div>
                {canEditVault && suggestion.vault_item_id && (
                  <Link
                    className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
                    href={`/vault?edit=${encodeURIComponent(suggestion.vault_item_id)}`}
                  >
                    Edit in Vault
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function AttentionEvidence({
  suggestion,
}: {
  suggestion: {
    suggestion_type: string;
    evidence: Record<string, number | string | null>;
  };
}) {
  const evidence = suggestion.evidence;
  const sampleSize =
    typeof evidence.sample_size === "number" ? evidence.sample_size : null;

  switch (suggestion.suggestion_type) {
    case "often_rejected": {
      const citations = evidence.times_cited ?? 0;
      const rejected = evidence.rejected ?? 0;
      const rate =
        typeof evidence.rejection_rate === "number"
          ? evidence.rejection_rate
          : null;
      return (
        <p className="mt-2 text-xs text-zinc-700">
          Cited {citations} times, dismissed {rejected} times
          {rate !== null ? ` (${formatRate(rate, sampleSize ?? 0)})` : ""}
        </p>
      );
    }
    case "often_rewritten":
      return (
        <p className="mt-2 text-xs text-zinc-700">
          Rewritten {evidence.edited ?? 0} times
          {sampleSize !== null ? ` · n = ${sampleSize}` : ""}
          {sampleSize !== null && smallSampleLabel(sampleSize)
            ? " · small sample"
            : ""}
        </p>
      );
    case "expired_still_cited":
      return (
        <p className="mt-2 text-xs text-zinc-700">
          Cited {evidence.times_cited ?? 0} times in this range · expired{" "}
          {evidence.valid_until}
        </p>
      );
    case "repeat_mistake":
      return (
        <p className="mt-2 text-xs text-zinc-700">
          {evidence.occurrences ?? 0} occurrences across{" "}
          {evidence.distinct_contents ?? 0} contents
        </p>
      );
    case "never_cited":
      return (
        <p className="mt-2 text-xs text-zinc-700">
          No citations · {evidence.age_days} days old
        </p>
      );
    default:
      return null;
  }
}

async function TopSourcesSection({ client, orgId, days, mine }: SectionProps) {
  const sources = await getInsightsTopSources(client, orgId, days, mine);
  const maxCitations = Math.max(1, ...sources.map((source) => source.times_cited));

  return (
    <SectionCard
      title="Most-flagged guidelines and facts"
      why="Frequently cited sources are where clearer wording can have the widest effect."
      calculation="Findings are grouped by Vault item; findings with no Vault item are grouped by rule_id. The list shows the 10 sources with the most findings in the selected range. Acceptance is (applied + edited) / (applied + edited + rejected) from linked correction records; n is the number of recorded outcomes."
    >
      {sources.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-4">
          {sources.map((source) => {
            const rate = calculateAcceptanceRate(
              source.applied,
              source.edited,
              source.rejected
            );
            const outcomes = source.applied + source.edited + source.rejected;
            const width = Math.min(100, (source.times_cited / maxCitations) * 100);
            return (
              <li key={`${source.source_kind}-${source.source_item_id ?? source.rule_id}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-zinc-900">{source.label}</span>
                  <span className="text-xs text-zinc-600">
                    {source.times_cited} citations · acceptance{" "}
                    {rate === null ? "no outcomes" : formatRate(rate, outcomes)}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div
                    aria-label={`${source.times_cited} citations`}
                    className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-100"
                    role="img"
                  >
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-zinc-600">
                    {source.times_cited}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Applied {source.applied} · edited {source.edited} · dismissed{" "}
                  {source.rejected}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

async function PatternsSection({ client, orgId, days, mine }: SectionProps) {
  const patterns = await getInsightsPatterns(client, orgId, days, mine);

  return (
    <SectionCard
      title="Repeated mistakes"
      why="Repeated patterns can be addressed with a more precise guideline or a reusable template."
      calculation="Findings are grouped by category and rule_id when present, otherwise by Vault source item. Only groups with at least 2 occurrences are returned; the top 8 are sorted by occurrences and then by distinct contents. The term_avoid rule may label a pattern with its avoided Vault term; other finding excerpts are never included."
    >
      {patterns.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-3 pr-4 font-medium">What</th>
                <th className="py-3 pr-4 font-medium">Category</th>
                <th className="py-3 pr-4 font-medium">Occurrences</th>
                <th className="py-3 font-medium">Contents</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {patterns.map((pattern, index) => (
                <tr key={`${pattern.category}-${pattern.rule_id ?? pattern.source_item_id}-${index}`}>
                  <td className="py-3 pr-4 font-medium text-zinc-900">
                    {pattern.label}
                  </td>
                  <td className="py-3 pr-4 capitalize text-zinc-600">
                    {pattern.category.replaceAll("_", " ")}
                  </td>
                  <td className="py-3 pr-4 tabular-nums text-zinc-700">
                    {pattern.occurrences}
                  </td>
                  <td className="py-3 tabular-nums text-zinc-700">
                    {pattern.distinct_contents}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

async function OutcomesSection({ client, orgId, days, mine }: SectionProps) {
  const rows = await getInsightsOriginSplit(client, orgId, days, mine);
  const allOutcomes = rows
    .filter((row) => row.split_type === "suggestion_origin")
    .reduce(
      (totals, row) => ({
        applied: totals.applied + row.applied,
        edited: totals.edited + row.edited,
        rejected: totals.rejected + row.rejected,
      }),
      { applied: 0, edited: 0, rejected: 0 }
    );
  const totalOutcomes =
    allOutcomes.applied + allOutcomes.edited + allOutcomes.rejected;
  const suggestionOrigins = rows.filter(
    (row) => row.split_type === "suggestion_origin"
  );
  const historyRow = suggestionOrigins.find(
    (row) => row.origin === "correction_history"
  );
  const freshAiRow = suggestionOrigins.find((row) => row.origin === "ai");
  const findingOrigins = rows.filter(
    (row) => row.split_type === "finding_origin"
  );

  return (
    <SectionCard
      title="What happens to suggestions"
      why="Acceptance and rewrite rates help distinguish useful recommendations from ones that need work."
      calculation="The stacked bar counts correction outcomes as applied, edited, or rejected. Origin cards group these same recorded outcomes by finding origin (rule or AI) and by suggestion origin (past correction history, fresh AI, or human). Acceptance is (applied + edited) / all recorded outcomes; n is the outcome count. A sample under 10 is marked small."
    >
      {totalOutcomes === 0 ? (
        <EmptyState />
      ) : (
        <>
          <StackedOutcomeBar {...allOutcomes} total={totalOutcomes} />
          <p className="mt-4 text-sm text-zinc-700">
            Past-correction recommendations accepted{" "}
            {historyRow
              ? formatRate(
                  calculateAcceptanceRate(
                    historyRow.applied,
                    historyRow.edited,
                    historyRow.rejected
                  ),
                  historyRow.sample_size
                )
              : "not enough data"}
            {" vs "}
            fresh AI suggestions{" "}
            {freshAiRow
              ? formatRate(
                  calculateAcceptanceRate(
                    freshAiRow.applied,
                    freshAiRow.edited,
                    freshAiRow.rejected
                  ),
                  freshAiRow.sample_size
                )
              : "not enough data"}
            .
          </p>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">
                Past-correction vs fresh AI suggestions
              </h3>
              <div className="space-y-3">
                {["correction_history", "ai"].map((origin) => {
                  const row = suggestionOrigins.find((item) => item.origin === origin);
                  return (
                    <OriginCard
                      key={origin}
                      label={
                        origin === "correction_history"
                          ? "Past-correction recommendations"
                          : "Fresh AI suggestions"
                      }
                      row={row}
                    />
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-zinc-900">
                By finding origin
              </h3>
              <div className="space-y-3">
                {findingOrigins.length === 0 ? (
                  <p className="text-sm text-zinc-500">No resolved findings yet.</p>
                ) : (
                  findingOrigins.map((row) => (
                    <OriginCard
                      key={row.origin}
                      label={row.origin === "rule" ? "Rule checks" : "AI review"}
                      row={row}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}

function StackedOutcomeBar({
  applied,
  edited,
  rejected,
  total,
}: {
  applied: number;
  edited: number;
  rejected: number;
  total: number;
}) {
  const segments = [
    { label: "Applied", value: applied, color: "bg-emerald-500" },
    { label: "Edited", value: edited, color: "bg-amber-400" },
    { label: "Dismissed", value: rejected, color: "bg-rose-500" },
  ];
  return (
    <div>
      <div
        aria-label={`Correction outcomes, n = ${total}`}
        className="flex h-5 overflow-hidden rounded-full bg-zinc-100"
        role="img"
      >
        {segments.map((segment) => (
          <span
            className={segment.color}
            key={segment.label}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-600">
        {segments.map((segment) => (
          <span className="inline-flex items-center gap-1.5" key={segment.label}>
            <span className={`h-2.5 w-2.5 rounded-full ${segment.color}`} />
            {segment.label}: {segment.value}
          </span>
        ))}
        <span>n = {total}</span>
        {smallSampleLabel(total) && (
          <span className="font-medium text-amber-700">small sample</span>
        )}
      </div>
    </div>
  );
}

function OriginCard({ label, row }: { label: string; row?: OriginSplit }) {
  if (!row) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
        {label}: not enough data yet
      </p>
    );
  }
  const rate = calculateAcceptanceRate(row.applied, row.edited, row.rejected);
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-zinc-900">{label}</span>
        <span className="text-sm font-semibold text-zinc-900">
          {rate === null ? "No outcomes" : formatRate(rate, row.sample_size)}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-600">
        Applied {row.applied} · edited {row.edited} · dismissed {row.rejected}
      </p>
    </div>
  );
}

async function TrendSection({ client, orgId, days, mine }: SectionProps) {
  const trend = await getInsightsTrend(client, orgId, days, mine);
  const maxFindings = Math.max(1, ...trend.map((week) => week.findings_raised));
  const maxBlockers = Math.max(
    1,
    ...trend.map((week) => week.blockers_per_content ?? 0)
  );
  const points = trend
    .map((week, index) => {
      const x = trend.length < 2 ? 150 : 8 + (index / (trend.length - 1)) * 284;
      const y =
        42 - ((week.blockers_per_content ?? 0) / maxBlockers) * 34;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <SectionCard
      title="Trend over time"
      why="Compare weekly findings and blockers per reviewed content to see whether mistakes are going down."
      calculation="Weeks start on Monday (ISO week). Contents reviewed is the distinct count of contents with a review run that week. Findings and blockers count findings created that week. Blockers per content is blockers divided by contents reviewed; weeks with findings but no review run have no rate."
    >
      {trend.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="mb-4 rounded-xl border border-zinc-100 bg-zinc-50 p-3">
            <p className="mb-2 text-xs font-medium text-zinc-600">
              Blockers per reviewed content
            </p>
            <svg
              aria-label="Weekly blockers per reviewed content"
              className="h-12 w-full overflow-visible"
              preserveAspectRatio="none"
              role="img"
              viewBox="0 0 300 48"
            >
              <polyline
                fill="none"
                points={points}
                stroke="#4f46e5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </div>
          <ol className="space-y-4">
            {trend.map((week) => {
              const findingsWidth = Math.max(
                week.findings_raised > 0 ? 2 : 0,
                (week.findings_raised / maxFindings) * 100
              );
              const blockerRate = week.blockers_per_content ?? 0;
              const blockerWidth = Math.max(
                blockerRate > 0 ? 2 : 0,
                (blockerRate / maxBlockers) * 100
              );
              return (
                <li
                  className="grid gap-2 sm:grid-cols-[7rem_1fr]"
                  key={week.week_start}
                >
                  <time className="pt-1 text-xs font-medium text-zinc-600" dateTime={week.week_start}>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                      day: "numeric",
                    }).format(new Date(`${week.week_start}T00:00:00`))}
                  </time>
                  <div className="space-y-2">
                    <TrendBar
                      label="Findings"
                      value={week.findings_raised}
                      width={findingsWidth}
                      color="bg-indigo-500"
                    />
                    <TrendBar
                      label="Blockers / content"
                      value={week.blockers_per_content}
                      width={blockerWidth}
                      color="bg-rose-500"
                    />
                    <p className="text-[11px] text-zinc-500">
                      {week.contents_reviewed} contents reviewed · {week.blockers_raised} blockers
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </SectionCard>
  );
}

function TrendBar({
  label,
  value,
  width,
  color,
}: {
  label: string;
  value: number | null;
  width: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[11px] text-zinc-500">{label}</span>
      <div className="h-2 min-w-0 flex-1 rounded-full bg-zinc-100">
        <div
          className={`h-2 rounded-full ${color}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-zinc-700">
        {value === null ? "—" : value}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <p className="text-sm text-zinc-500">
      Not enough data yet: run reviews to see this
    </p>
  );
}

function formatRate(rate: number | null, sampleSize: number): string {
  if (rate === null) {
    return "No outcomes";
  }
  return `${Math.round(rate * 100)}% · n = ${sampleSize}${
    smallSampleLabel(sampleSize) ? " · small sample" : ""
  }`;
}

function SectionSkeleton({
  title,
  prominent = false,
}: {
  title: string;
  prominent?: boolean;
}) {
  return (
    <section
      aria-label={`Loading ${title}`}
      className={`animate-pulse overflow-hidden rounded-2xl border bg-white shadow-sm ${
        prominent ? "border-amber-300" : "border-zinc-200"
      }`}
    >
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="h-5 w-48 rounded bg-zinc-200" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="p-5">
        <div className="h-10 w-full rounded-lg bg-zinc-100" />
      </div>
    </section>
  );
}

function PageSkeleton() {
  return (
    <div aria-label="Loading insights" className="animate-pulse">
      <div className="mb-6 h-10 w-full border-b border-zinc-200" />
      <div className="mb-8 h-20 rounded-xl bg-white" />
      <div className="space-y-6">
        {["Summary", "Needs attention", "Top guidelines"].map((title) => (
          <SectionSkeleton key={title} title={title} />
        ))}
      </div>
    </div>
  );
}
