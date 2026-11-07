import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { EXPORT_PLATFORMS, type PlatformKey } from "@/lib/export/platforms";
import { convertApprovedSnapshot } from "@/lib/export/convert";
import { createEmailExport } from "@/lib/export/email";
import {
  PLATFORM_OVER_LIMIT_RULE_ID,
  platformLabelFromSource,
} from "@/lib/review/platform-rules";
import {
  ExportClient,
  type ExportHistoryItem,
  type PlatformRecap,
} from "./export-client";

export const instant = false;

type ExportPageProps = { params: Promise<{ id: string }> };
type SnapshotSection = {
  type: "text" | "image";
  body: string | null;
  image_path: string | null;
  alt_text: string | null;
  position: number;
};

export default function ExportPage({ params }: ExportPageProps) {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border bg-white p-8 text-sm text-zinc-500">
              Loading approved export...
            </section>
          }
        >
          <ExportPageContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ExportPageContent({ params }: ExportPageProps) {
  await connection();
  const { id } = await params;
  const { user, membership } = await requireMember();

  const member = {
    email: user.email ?? "",
    orgId: membership.org_id,
    role: membership.role,
    userId: user.id,
  };

  const supabase = await createClient();
  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id, title, status, platforms")
    .eq("id", id)
    .eq("org_id", member.orgId)
    .maybeSingle();
  if (contentError) throw new Error(contentError.message);
  if (!content) notFound();

  return (
    <>
      <AppNav member={member} />
      <Link
        className="text-sm font-medium text-indigo-700 hover:text-indigo-800"
        href={`/workspace/${content.id}`}
      >
        &larr; Back to content
      </Link>
      {content.status !== "approved" ? (
        <section className="mt-5 rounded-2xl border border-zinc-200 bg-white p-8">
          <h1 className="text-xl font-semibold text-zinc-900">
            Export unavailable
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Export is available only after Brand Manager approval.
          </p>
        </section>
      ) : (
        <ApprovedExport
          contentId={content.id}
          title={content.title}
          platformValues={content.platforms ?? []}
          orgId={content.org_id}
          supabase={supabase}
        />
      )}
    </>
  );
}

async function ApprovedExport({
  contentId,
  title,
  platformValues,
  orgId,
  supabase,
}: {
  contentId: string;
  title: string;
  platformValues: string[];
  orgId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data: approval, error: approvalError } = await supabase
    .from("content_events")
    .select("id, version_id, created_at")
    .eq("org_id", orgId)
    .eq("content_id", contentId)
    .eq("event", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (approvalError) throw new Error(approvalError.message);
  if (!approval?.version_id) {
    return (
      <section className="mt-5 rounded-2xl border border-zinc-200 bg-white p-8">
        <p className="text-sm text-zinc-700">
          Export is available only after Brand Manager approval.
        </p>
      </section>
    );
  }

  const [{ data: version, error: versionError }, { data: events, error: eventsError }] =
    await Promise.all([
      supabase
        .from("content_versions")
        .select("snapshot")
        .eq("id", approval.version_id)
        .eq("org_id", orgId)
        .eq("content_id", contentId)
        .maybeSingle(),
      supabase.rpc("list_content_events", { p_content: contentId }),
    ]);
  if (versionError) throw new Error(versionError.message);
  if (eventsError) throw new Error(eventsError.message);
  if (!version) notFound();

  const eventRows = (events ?? []) as Array<{
    id: string;
    actor_email: string;
  }>;
  const approvedBy = eventRows.find((event) => event.id === approval.id);
  const snapshot = version.snapshot as {
    title?: string;
    platforms?: string[];
    sections?: SnapshotSection[];
  };
  const sections = snapshot.sections ?? [];
  const approvedPlatforms = snapshot.platforms ?? platformValues;
  const platforms = platformValues.filter(
    (value): value is PlatformKey =>
      approvedPlatforms.includes(value) &&
      Object.prototype.hasOwnProperty.call(EXPORT_PLATFORMS, value)
  );
  const results = Object.fromEntries(
    platforms.map((platform) => {
      const result = convertApprovedSnapshot(sections, platform);
      return [
        platform,
        platform === "Email"
          ? {
              ...result,
              ...createEmailExport(snapshot.title ?? title, result),
            }
          : result,
      ];
    })
  );

  const { data: historyRows, error: historyError } = await supabase.rpc(
    "list_export_events",
    { p_content: contentId }
  );
  if (historyError) throw new Error(historyError.message);
  const history = (historyRows ?? []) as ExportHistoryItem[];

  const { data: latestRun, error: runError } = await supabase
    .from("review_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("content_id", contentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw new Error(runError.message);

  const { data: platformRows, error: platformError } = latestRun
    ? await supabase
        .from("findings")
        .select("rule_id, source_label")
        .eq("org_id", orgId)
        .eq("content_id", contentId)
        .eq("category", "platform")
        .eq("run_id", latestRun.id)
    : { data: [], error: null };
  if (platformError) throw new Error(platformError.message);

  const overLimitLabels = new Set(
    (platformRows ?? [])
      .filter((row) => row.rule_id === PLATFORM_OVER_LIMIT_RULE_ID)
      .map((row) => platformLabelFromSource(row.source_label))
      .filter((label): label is string => Boolean(label))
  );
  const recaps: Partial<Record<PlatformKey, PlatformRecap>> = {};
  if (latestRun) {
    for (const platform of platforms) {
      const over = overLimitLabels.has(EXPORT_PLATFORMS[platform].label);
      recaps[platform] = {
        over,
        message: over
          ? "Over limit when reviewed"
          : "Passed platform checks at review",
      };
    }
  }

  return (
    <ExportClient
      approvedAt={approval.created_at}
      approvedBy={approvedBy?.actor_email ?? "Brand Manager"}
      contentId={contentId}
      history={history}
      imagePaths={sections
        .filter((section) => section.type === "image")
        .map((section) => ({
          image_path: section.image_path,
          alt_text: section.alt_text ?? "",
        }))}
      platforms={platforms}
      recaps={recaps}
      results={results}
      title={snapshot.title ?? title}
    />
  );
}
