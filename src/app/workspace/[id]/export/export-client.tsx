"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PlatformKey } from "@/lib/export/platforms";
import type { ExportResult } from "@/lib/export/convert";
import { splitIntoThread } from "@/lib/export/thread";
import { getExportImageUrls, recordExport } from "./actions";

type ExportView = ExportResult & {
  subject?: string;
  body?: string;
  html?: string;
};

export type ExportHistoryItem = {
  id: string;
  platform: string;
  actor_email: string;
  actor_role: string;
  created_at: string;
};

export function ExportClient({
  contentId,
  title,
  approvedAt,
  approvedBy,
  platforms,
  results,
  imagePaths,
  history,
}: {
  contentId: string;
  title: string;
  approvedAt: string;
  approvedBy: string;
  platforms: PlatformKey[];
  results: Partial<Record<PlatformKey, ExportView>>;
  imagePaths: Array<{ image_path: string | null; alt_text: string }>;
  history: ExportHistoryItem[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<PlatformKey>(platforms[0]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [imagesLoading, setImagesLoading] = useState(imagePaths.length > 0);
  const [feedback, setFeedback] = useState("");
  const [thread, setThread] = useState<ReturnType<typeof splitIntoThread> | null>(null);
  const [isPending, startTransition] = useTransition();
  const result = results[active];
  const previewHtml = result?.html?.replace(
    /<img src="\{\{IMAGE_(\d+)_URL\}\}" alt="([^"]*)">/g,
    (_match, imageIndex: string, alt: string) => {
      const path = imagePaths[Number(imageIndex) - 1]?.image_path;
      const url = path ? urls[path] : undefined;
      return url
        ? `<img src="${escapeHtmlAttribute(url)}" alt="${alt}">`
        : `<img alt="${alt}">`;
    }
  );

  useEffect(() => {
    let activeEffect = true;
    if (imagePaths.length === 0) return;
    void (async () => {
      try {
        const response = await getExportImageUrls(contentId);
        if (!activeEffect) return;
        if ("error" in response) {
          setFeedback(response.error);
        } else {
          setUrls(response.urls);
        }
      } catch (error) {
        if (activeEffect) {
          setFeedback(
            error instanceof Error
              ? error.message
              : "Could not load approved image links."
          );
        }
      } finally {
        if (activeEffect) setImagesLoading(false);
      }
    })();
    return () => {
      activeEffect = false;
    };
  }, [contentId, imagePaths.length]);

  async function loadImageUrls() {
    if (Object.keys(urls).length || imagePaths.length === 0) return;
    setImagesLoading(true);
    try {
      const response = await getExportImageUrls(contentId);
      if ("error" in response) {
        setFeedback(response.error);
        return;
      }
      setUrls(response.urls);
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not load approved image links."
      );
    } finally {
      setImagesLoading(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setFeedback(`Could not copy ${label}. Check clipboard permissions and try again.`);
      return;
    }
    startTransition(async () => {
      try {
        const logged = await recordExport(contentId, active);
        if ("error" in logged) {
          setFeedback(`${label} copied, but export history could not be recorded: ${logged.error}`);
          return;
        }
        setFeedback(`${label} copied and recorded.`);
        router.refresh();
      } catch (error) {
        setFeedback(
          `${label} copied, but export history could not be recorded: ${
            error instanceof Error ? error.message : "Unexpected server error."
          }`
        );
      }
    });
  }

  function splitThread() {
    try {
      setThread(splitIntoThread(result?.text ?? "", 280));
      setFeedback("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not split this post.");
    }
  }

  if (platforms.length === 0) {
    return (
      <section className="mt-5 rounded-2xl border border-zinc-200 bg-white p-8">
        <h1 className="text-xl font-semibold text-zinc-900">No platforms selected</h1>
        <p className="mt-2 text-sm text-zinc-600">
          The approved version does not have any export platforms.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-5 space-y-5">
      <header className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
          Approved snapshot
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Exporting approved version from {new Date(approvedAt).toLocaleString()},
          approved by {approvedBy}.
        </p>
      </header>

      <nav aria-label="Export platforms" className="flex flex-wrap gap-2">
        {platforms.map((platform) => (
          <button
            aria-selected={active === platform}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              active === platform
                ? "bg-indigo-700 text-white"
                : "border border-zinc-300 bg-white text-zinc-700"
            }`}
            key={platform}
            onClick={() => {
              setActive(platform);
              setThread(null);
              setFeedback("");
            }}
            role="tab"
            type="button"
          >
            {platform}
          </button>
        ))}
      </nav>

      {result && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                {active} preview
              </h2>
              <p className={`mt-1 text-sm ${result.overLimit ? "font-semibold text-red-700" : "text-zinc-600"}`}>
                {result.count.toLocaleString()} / {result.limit?.toLocaleString() ?? "No limit"} characters
                {" "}(approximate, the platform may count differently)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={isPending}
                onClick={() => void copy(result.text, "Plain text")}
                type="button"
              >
                Copy
              </button>
              {result.html !== undefined && (
                <button
                  className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => void copy(previewHtml ?? result.html ?? "", "HTML")}
                  type="button"
                >
                  Copy HTML
                </button>
              )}
              {active === "Email" && result.subject !== undefined && (
                <button
                  className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-800 disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => void copy(result.subject ?? "", "Email subject")}
                  type="button"
                >
                  Copy subject
                </button>
              )}
            </div>
          </div>

          {active === "Email" && (
            <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">
              <span className="font-semibold">Subject:</span> {result.subject ?? title}
            </p>
          )}
          <div className="mt-4 min-h-36 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-sm leading-6 text-zinc-800">
            {previewHtml ? (
              <div
                className="space-y-3 [&_a]:text-indigo-700 [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:object-contain [&_li]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_strong]:font-semibold [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <p className="whitespace-pre-wrap">
                {result.text || <span className="text-zinc-400">No text in this approved version.</span>}
              </p>
            )}
          </div>

          {result.changes.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-zinc-900">What we changed</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">
                {result.changes.map((change, index) => (
                  <li key={`${change.description}-${index}`}>{change.description}</li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">Warnings</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          )}

          {active === "X (Twitter)" && result.overLimit && (
            <div className="mt-5">
              <button
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
                onClick={splitThread}
                type="button"
              >
                Split into thread
              </button>
              {thread && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-zinc-600">{thread.explanation}</p>
                  {thread.parts.map((part, index) => (
                    <div className="rounded-lg border border-zinc-200 p-3" key={`${index}-${part}`}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="whitespace-pre-wrap text-sm text-zinc-800">{part}</p>
                        <button
                          className="shrink-0 rounded border px-3 py-1 text-xs font-medium"
                          disabled={isPending}
                          onClick={() => void copy(part, `Post ${index + 1}`)}
                          type="button"
                        >
                          Copy post
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.images.length > 0 && (
            <div className="mt-6 border-t border-zinc-200 pt-5">
              <h3 className="text-sm font-semibold text-zinc-900">Images</h3>
              <div className="mt-3 space-y-3">
                {result.images.map((image) => {
                  const path = imagePaths[image.index - 1]?.image_path;
                  const imageUrl = path ? urls[path] : undefined;
                  return (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-zinc-50 p-3" key={image.index}>
                      <div>
                        <p className="text-sm font-medium text-zinc-800">
                          Image {image.index}: {image.altText || "Alt text missing"}
                        </p>
                        {imageUrl && (
                          <a
                            className="mt-1 inline-block text-sm text-indigo-700 underline"
                            download
                            href={imageUrl}
                          >
                            Download image
                          </a>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!imageUrl && path && (
                          <button
                            className="rounded border px-3 py-1.5 text-xs font-medium"
                            disabled={imagesLoading}
                            onClick={() => void loadImageUrls()}
                            type="button"
                          >
                            {imagesLoading ? "Loading link..." : "Load download link"}
                          </button>
                        )}
                        <button
                          className="rounded border px-3 py-1.5 text-xs font-medium"
                          disabled={!image.altText}
                          onClick={() => void copy(image.altText, "Alt text")}
                          type="button"
                        >
                          Copy alt text
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {feedback && <p className="text-sm text-zinc-700" role="status">{feedback}</p>}
      <p className="text-xs text-zinc-500">
        Exports are rule-based formatting only. No AI is used here.
      </p>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-900">Export history</h2>
        {history.length ? (
          <ul className="mt-3 divide-y divide-zinc-100">
            {history.map((item) => (
              <li className="flex flex-wrap justify-between gap-2 py-3 text-sm" key={item.id}>
                <span className="font-medium text-zinc-800">
                  {item.platform} · {item.actor_email} ({item.actor_role.replaceAll("_", " ")})
                </span>
                <time className="text-zinc-500" dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-zinc-500">No exports recorded yet.</p>
        )}
      </section>
    </div>
  );
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
