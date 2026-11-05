"use server";

import { createClient } from "@/lib/supabase/server";
import { isPlatformKey } from "@/lib/export/platforms";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ExportContext =
  | { error: string }
  | {
    supabase: Awaited<ReturnType<typeof createClient>>;
    orgId: string;
  };

async function getExportContext(contentValue: unknown): Promise<ExportContext> {
  if (typeof contentValue !== "string" || !uuidPattern.test(contentValue)) {
    return { error: "Select valid content to export." };
  }
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) return { error: userError.message };
  if (!user) return { error: "Sign in to export content." };

  const { data: membership, error: memberError } = await supabase
    .from("members")
    .select("org_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (memberError) return { error: memberError.message };
  if (!membership) return { error: "You are not a member of an organisation." };

  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id, status")
    .eq("id", contentValue)
    .eq("org_id", membership.org_id)
    .maybeSingle();
  if (contentError) return { error: contentError.message };
  if (!content) return { error: "Content not found or you cannot access it." };
  if (content.status !== "approved") {
    return { error: "Only approved content can be exported." };
  }

  return { supabase, orgId: membership.org_id };
}

export async function recordExport(
  contentId: unknown,
  platformValue: unknown
): Promise<{ error: string } | { id: string }> {
  if (!isPlatformKey(platformValue)) {
    return { error: "Select a supported export platform." };
  }
  const context = await getExportContext(contentId);
  if ("error" in context) return context;

  const { data, error } = await context.supabase.rpc("log_export", {
    p_content: contentId as string,
    p_platform: platformValue,
  });
  if (error) return { error: error.message };
  if (typeof data !== "string") {
    return { error: "The export was copied, but its history could not be recorded." };
  }
  return { id: data };
}

export async function getExportImageUrls(
  contentId: unknown
): Promise<{ error: string } | { urls: Record<string, string> }> {
  const context = await getExportContext(contentId);
  if ("error" in context) return context;

  const { data: approvedEvent, error: eventError } = await context.supabase
    .from("content_events")
    .select("version_id")
    .eq("org_id", context.orgId)
    .eq("content_id", contentId as string)
    .eq("event", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eventError) return { error: eventError.message };
  if (!approvedEvent?.version_id) {
    return { error: "No approved version is available for export." };
  }

  const { data: version, error: versionError } = await context.supabase
    .from("content_versions")
    .select("snapshot")
    .eq("id", approvedEvent.version_id)
    .eq("org_id", context.orgId)
    .eq("content_id", contentId as string)
    .maybeSingle();
  if (versionError) return { error: versionError.message };
  if (!version) return { error: "The approved version could not be found." };

  const snapshot = version.snapshot as {
    sections?: Array<{ type?: string; image_path?: string | null }>;
  };
  const paths = [...new Set(
    (snapshot.sections ?? []).flatMap((section) =>
      section.type === "image" &&
      typeof section.image_path === "string" &&
      section.image_path.startsWith(`${context.orgId}/${contentId}/`)
        ? [section.image_path]
        : []
    )
  )];
  const entries = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await context.supabase.storage
        .from("content-images")
        .createSignedUrl(path, 60 * 60);
      if (error) return { error: error.message };
      return { path, url: data.signedUrl };
    })
  );
  const failed = entries.find(
    (entry): entry is { error: string } => "error" in entry
  );
  if (failed) return { error: failed.error };
  const successful = entries.filter(
    (entry): entry is { path: string; url: string } => "path" in entry
  );
  return {
    urls: Object.fromEntries(successful.map(({ path, url }) => [path, url])),
  };
}
