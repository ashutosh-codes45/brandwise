import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AppNav } from "@/components/app-nav";
import { requireMember } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { htmlToText } from "@/lib/html-to-text";

export const instant = false;

type VersionPageProps = {
  params: Promise<{ id: string; versionId: string }>;
};

type VersionSnapshot = {
  title?: string;
  platforms?: string[];
  sections?: Array<{
    type: "text" | "image";
    body: string | null;
    image_path: string | null;
    alt_text: string | null;
    position: number;
  }>;
};

export default function VersionPage({ params }: VersionPageProps) {
  return (
    <main className="min-h-full flex-1 bg-zinc-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Suspense
          fallback={
            <section className="rounded-2xl border border-zinc-200 bg-white p-8 text-sm text-zinc-500">
              Loading saved version...
            </section>
          }
        >
          <VersionContent params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function VersionContent({ params }: VersionPageProps) {
  await connection();
  const { id, versionId } = await params;
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
    .select("id, org_id, title")
    .eq("id", id)
    .eq("org_id", member.orgId)
    .maybeSingle();
  if (contentError) {
    throw new Error(contentError.message);
  }
  if (!content) {
    notFound();
  }
  const { data: version, error: versionError } = await supabase
    .from("content_versions")
    .select("id, snapshot, created_at")
    .eq("id", versionId)
    .eq("content_id", content.id)
    .eq("org_id", member.orgId)
    .maybeSingle();
  if (versionError) {
    throw new Error(versionError.message);
  }
  if (!version) {
    notFound();
  }
  const snapshot = version.snapshot as VersionSnapshot;
  const sections = [...(snapshot.sections ?? [])].sort(
    (a, b) => a.position - b.position
  );
  const sectionsWithUrls = await Promise.all(
    sections.map(async (section) => {
      if (
        section.type !== "image" ||
        !section.image_path?.startsWith(`${member.orgId}/${content.id}/`)
      ) {
        return { ...section, imageUrl: null };
      }
      const { data, error } = await supabase.storage
        .from("content-images")
        .createSignedUrl(section.image_path, 60 * 60);
      if (error) {
        throw new Error(`Could not load a saved image: ${error.message}`);
      }
      return { ...section, imageUrl: data.signedUrl };
    })
  );

  return (
    <>
      <AppNav member={member} />
      <Link
        className="text-sm font-medium text-indigo-700 hover:text-indigo-800"
        href={`/workspace/${content.id}`}
      >
        &larr; Back to content
      </Link>
      <header className="my-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Read-only version
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          {snapshot.title ?? content.title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Saved {new Date(version.created_at).toLocaleString()}
        </p>
        <p className="mt-3 text-sm text-zinc-600">
          {(snapshot.platforms ?? []).join(" · ") || "No platforms selected"}
        </p>
      </header>
      <section className="space-y-4">
        {sectionsWithUrls.map((section, index) => (
          <article
            className="rounded-2xl border border-zinc-200 bg-white p-5"
            key={`${section.position}-${index}`}
          >
            <h2 className="font-semibold text-zinc-800">
              {section.type === "image" ? "Image section" : "Text section"}{" "}
              {index + 1}
            </h2>
            {section.type === "image" ? (
              <>
                {section.imageUrl && (
                  <Image
                    alt={section.alt_text || ""}
                    className="mt-3 max-h-96 w-full rounded-lg bg-zinc-100 object-contain"
                    height={600}
                    src={section.imageUrl}
                    unoptimized
                    width={900}
                  />
                )}
                <p className="mt-2 text-sm text-zinc-600">
                  Alt text: {section.alt_text || "Not provided"}
                </p>
              </>
            ) : (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                {htmlToText(section.body ?? "")}
              </p>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
