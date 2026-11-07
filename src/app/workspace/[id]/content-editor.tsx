"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "next/image";
import {
  deleteContent,
  getImageUrl,
  saveContent,
  uploadImage,
} from "../actions";
import { ReviewPanel } from "./review-panel";
import type { ReviewFindingState } from "@/lib/review/types";
import {
  CommentsPanel,
  CommentThread,
} from "./comments-panel";
import {
  listComments,
  type ContentComment,
} from "./comment-actions";
import {
  ActivityPanel,
  type ContentActivityEvent,
} from "./activity-panel";
import { WorkflowBar } from "./workflow-bar";
import { ImportDocumentDialog } from "./import-document-dialog";
import type { MemberRole } from "@/lib/auth/roles";
import type { BrandKit } from "@/lib/context/brand-kit";
import type { ImageAnalysis } from "@/lib/visual/analyze-image";
import { analyzeImage } from "@/lib/visual/analyze-image";
import { evaluateImage } from "@/lib/visual/evaluate";

const platforms = [
  "LinkedIn",
  "X (Twitter)",
  "Instagram",
  "Facebook",
  "Blog/Website",
  "Email",
] as const;

type SectionType = "text" | "image";
type ContentSection = {
  id: string;
  type: SectionType;
  body: string | null;
  image_path: string | null;
  alt_text: string | null;
  image_role: "logo" | "graphic" | "photo" | null;
  image_meta: ImageAnalysis | null;
  placed_background: string | null;
  position: number;
};
type ContentData = {
  id: string;
  title: string;
  status: string;
  platforms: string[];
  sections: ContentSection[];
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function ContentEditor({
  content,
  brandKit,
  canEdit,
  initialFindings,
  initialStats,
  initialAiCallsToday,
  initialComments,
  initialEvents,
  currentUserId,
  role,
  isCreator,
  latestChangeNote,
  approvedBy,
}: {
  content: ContentData;
  brandKit: BrandKit | null;
  canEdit: boolean;
  initialFindings: ReviewFindingState[];
  initialStats: Record<string, unknown> | null;
  initialAiCallsToday: number;
  initialComments: ContentComment[];
  initialEvents: ContentActivityEvent[];
  currentUserId: string;
  role: MemberRole;
  isCreator: boolean;
  latestChangeNote: string | null;
  approvedBy: { email: string; createdAt: string } | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(content.title);
  const [selectedPlatforms, setSelectedPlatforms] = useState(
    content.platforms
  );
  const [sections, setSections] = useState(content.sections);
  const [savedSections, setSavedSections] = useState(content.sections);
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackIsError, setFeedbackIsError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [highlightTarget, setHighlightTarget] = useState<{
    sectionId: string;
    excerpt: string;
  } | null>(null);
  const [comments, setComments] = useState(initialComments);
  const [activeSideTab, setActiveSideTab] = useState<
    "review" | "comments" | "activity"
  >("review");
  const [openSectionComments, setOpenSectionComments] = useState<
    Record<string, boolean>
  >({});

  const markDirty = useCallback(() => setDirty(true), []);
  const imagePathKey = useMemo(
    () =>
      JSON.stringify(
        sections
          .filter(
            (section) => section.type === "image" && section.image_path
          )
          .map((section) => [section.id, section.image_path])
      ),
    [sections]
  );

  useEffect(() => {
    if (!canEdit || !dirty) {
      return;
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmInternalNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname !== window.location.pathname &&
        !window.confirm("You have unsaved changes. Leave without saving?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", confirmInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", confirmInternalNavigation, true);
    };
  }, [canEdit, dirty]);

  useEffect(() => {
    let active = true;
    const imageSections = JSON.parse(imagePathKey) as [string, string][];

    void Promise.all(
      imageSections.map(async ([sectionId, imagePath]) => {
        const result = await getImageUrl(content.id, imagePath);
        if ("error" in result) {
          setFeedback(result.error);
          setFeedbackIsError(true);
          return null;
        }
        return [sectionId, result.url] as const;
      })
    ).then((results) => {
      if (active) {
        setImageUrls((current) => ({
          ...current,
          ...Object.fromEntries(
            results.filter(
              (result): result is readonly [string, string] => result !== null
            )
          ),
        }));
      }
    });

    return () => {
      active = false;
    };
  }, [content.id, imagePathKey]);

  function updateSection(id: string, change: Partial<ContentSection>) {
    setSections((current) =>
      current.map((section) =>
        section.id === id ? { ...section, ...change } : section
      )
    );
    markDirty();
  }

  function addSection(type: SectionType) {
    setSections((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type,
        body: type === "text" ? "<p></p>" : null,
        image_path: null,
        alt_text: null,
        image_role: type === "image" ? "photo" : null,
        image_meta: null,
        placed_background: null,
        position: current.length,
      },
    ]);
    markDirty();
  }

  function addImportedSections(
    importedSections: { html: string }[],
    fileName: string
  ) {
    const replaceEmptySection =
      sections.length === 1 &&
      sections[0].type === "text" &&
      !(sections[0].body ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
        .trim();
    const existingSections = replaceEmptySection ? [] : sections;
    const addedSections = importedSections.map((section, index) => ({
      id: crypto.randomUUID(),
      type: "text" as const,
      body: section.html,
      image_path: null,
      alt_text: null,
      image_role: null,
      image_meta: null,
      placed_background: null,
      position: existingSections.length + index,
    }));

    setSections([...existingSections, ...addedSections]);
    markDirty();
    setFeedback(
      `Imported from ${fileName}. Review the sections, then press Save.`
    );
    setFeedbackIsError(false);
  }

  function moveSection(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= sections.length) {
      return;
    }
    const reordered = [...sections];
    [reordered[index], reordered[destination]] = [
      reordered[destination],
      reordered[index],
    ];
    setSections(reordered);
    markDirty();
  }

  function removeSection(sectionId: string) {
    setSections((current) =>
      current
        .filter((section) => section.id !== sectionId)
        .map((section, position) => ({ ...section, position }))
    );
    markDirty();
  }

  function changePlatform(platform: string, checked: boolean) {
    setSelectedPlatforms((current) =>
      checked
        ? [...current, platform]
        : current.filter((value) => value !== platform)
    );
    markDirty();
  }

  async function refreshComments() {
    const result = await listComments(content.id);
    if ("error" in result) {
      setFeedback(result.error);
      setFeedbackIsError(true);
      return;
    }
    setComments(result.comments);
    setFeedback("");
    setFeedbackIsError(false);
  }

  function handleSave() {
    setFeedback("");
    startTransition(async () => {
      const result = await saveContent(
        content.id,
        title,
        selectedPlatforms,
        sections
      );
      if ("error" in result) {
        setFeedback(result.error);
        setFeedbackIsError(true);
        return;
      }
      setDirty(false);
      setSavedSections(sections);
      setFeedback("Saved. A revision was added to the history.");
      setFeedbackIsError(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!window.confirm("Delete this draft and all of its sections?")) {
      return;
    }
    startTransition(async () => {
      const error = await deleteContent(content.id);
      if (error) {
        setFeedback(error);
        setFeedbackIsError(true);
        return;
      }
      router.push("/workspace");
      router.refresh();
    });
  }

  const dirtyChanged = dirty || !sameSections(sections, savedSections);

  function focusExcerpt(sectionId: string, excerpt: string) {
    setHighlightTarget({ sectionId, excerpt });
    document
      .getElementById(`section-${sectionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function acceptAppliedSections(
    appliedSections: Array<{
      id: string;
      type: "text" | "image";
      body: string | null;
      image_path: string | null;
      alt_text: string | null;
      image_role: "logo" | "graphic" | "photo" | null;
      image_meta: ImageAnalysis | null;
      placed_background: string | null;
      position: number;
    }>
  ) {
    setSections(appliedSections);
    setSavedSections(appliedSections);
    setDirty(false);
  }

  return (
    <div>
      <WorkflowBar
        approvedBy={approvedBy}
        contentId={content.id}
        isCreator={isCreator}
        latestChangeNote={latestChangeNote}
        role={role}
        status={content.status}
        unsavedChanges={dirtyChanged}
      />
      <header className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[min(100%,20rem)] flex-1">
            {canEdit ? (
              <label className="sr-only" htmlFor="contentTitle">
                Content title
              </label>
            ) : null}
            <input
              className={`w-full rounded-lg border px-3 py-2 text-2xl font-semibold tracking-tight text-zinc-900 ${
                canEdit
                  ? "border-zinc-300 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  : "border-transparent bg-transparent"
              }`}
              disabled={!canEdit}
              id="contentTitle"
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                markDirty();
              }}
              required
              value={title}
            />
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              content.status === "approved"
                ? "bg-emerald-100 text-emerald-800"
                : content.status === "changes_requested"
                  ? "bg-amber-100 text-amber-800"
                  : content.status === "in_review"
                    ? "bg-blue-100 text-blue-800"
                    : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {statusLabels[content.status] ?? content.status}
          </span>
        </div>
        {!canEdit && (
          <p className="mt-2 text-sm text-zinc-500">
            Read-only view. Only the creator can edit while the content is a
            draft or has changes requested.
          </p>
        )}
        {canEdit && dirtyChanged && (
          <p className="mt-3 text-sm font-medium text-amber-700">
            Unsaved changes
          </p>
        )}
      </header>

      <section className="mt-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold text-zinc-900">Platforms</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
          {platforms.map((platform) => (
            <label
              className="inline-flex items-center gap-2 text-sm text-zinc-700"
              key={platform}
            >
              <input
                checked={selectedPlatforms.includes(platform)}
                className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                disabled={!canEdit}
                onChange={(event) =>
                  changePlatform(platform, event.target.checked)
                }
                type="checkbox"
              />
              {platform}
            </label>
          ))}
        </div>
      </section>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
      <div className="min-w-0">
      <section className="space-y-4">
        {sections.map((section, index) => (
          <article
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
            id={`section-${section.id}`}
            key={section.id}
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-zinc-900">
                {section.type === "text" ? "Text section" : "Image section"}{" "}
                <span className="font-normal text-zinc-500">
                  {index + 1} of {sections.length}
                </span>
                <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-normal text-zinc-600">
                  {
                    comments.filter(
                      (comment) => comment.section_id === section.id
                    ).length
                  }{" "}
                  comments
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md border border-indigo-200 px-2.5 py-1.5 text-sm text-indigo-700 hover:bg-indigo-50"
                  onClick={() =>
                    setOpenSectionComments((current) => ({
                      ...current,
                      [section.id]: !current[section.id],
                    }))
                  }
                  type="button"
                >
                  {openSectionComments[section.id] ? "Hide comments" : "Add comment"}
                </button>
                {canEdit && (
                <>
                  <button
                    aria-label="Move section up"
                    className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 disabled:opacity-40"
                    disabled={index === 0 || isPending}
                    onClick={() => moveSection(index, -1)}
                    type="button"
                  >
                    Move up
                  </button>
                  <button
                    aria-label="Move section down"
                    className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm text-zinc-700 disabled:opacity-40"
                    disabled={index === sections.length - 1 || isPending}
                    onClick={() => moveSection(index, 1)}
                    type="button"
                  >
                    Move down
                  </button>
                  <button
                    className="rounded-md px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                    disabled={sections.length === 1 || isPending}
                    onClick={() => removeSection(section.id)}
                    type="button"
                  >
                    Delete
                  </button>
                </>
                )}
              </div>
            </div>

            {openSectionComments[section.id] && (
              <div className="mb-4 border-b border-zinc-100 pb-4">
                <CommentThread
                  comments={comments}
                  compact
                  contentId={content.id}
                  currentUserId={currentUserId}
                  onRefresh={refreshComments}
                  target={{ type: "section", sectionId: section.id }}
                />
              </div>
            )}

            {section.type === "text" ? (
              <TextSection
                body={section.body ?? ""}
                canEdit={canEdit}
                highlightExcerpt={
                  highlightTarget?.sectionId === section.id
                    ? highlightTarget.excerpt
                    : ""
                }
                onChange={(body) => updateSection(section.id, { body })}
              />
            ) : (
              <ImageSection
                altText={section.alt_text ?? ""}
                canEdit={canEdit}
                contentId={content.id}
                imagePath={section.image_path}
                imageRole={section.image_role ?? "photo"}
                imageMeta={section.image_meta}
                placedBackground={section.placed_background}
                brandKit={brandKit}
                imageUrl={imageUrls[section.id]}
                isPending={isPending}
                onAltTextChange={(alt_text) =>
                  updateSection(section.id, { alt_text })
                }
                onImageChange={(image_path, imageUrl, image_meta) => {
                  updateSection(section.id, { image_path, image_meta });
                  if (imageUrl) {
                    setImageUrls((current) => ({
                      ...current,
                      [section.id]: imageUrl,
                    }));
                  }
                }}
                onImageRoleChange={(image_role) =>
                  updateSection(section.id, { image_role })
                }
                onPlacedBackgroundChange={(placed_background) =>
                  updateSection(section.id, { placed_background })
                }
              />
            )}
          </article>
        ))}
      </section>

      {canEdit && (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => addSection("text")}
              type="button"
            >
              Add text section
            </button>
            <ImportDocumentDialog
              contentId={content.id}
              onAdd={addImportedSections}
            />
            <button
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => addSection("image")}
              type="button"
            >
              Add image section
            </button>
          </div>

          <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50/95 py-4 backdrop-blur">
            <div className="flex items-center gap-4">
              <span className="text-sm text-zinc-600">
                {dirtyChanged ? "Unsaved changes" : "All changes saved"}
              </span>
              {content.status === "draft" && (
                <button
                  className="text-sm font-medium text-red-600 hover:text-red-700"
                  disabled={isPending}
                  onClick={handleDelete}
                  type="button"
                >
                  Delete draft
                </button>
              )}
            </div>
            <button
              className="rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || !dirtyChanged || !title.trim()}
              onClick={handleSave}
              type="button"
            >
              {isPending ? "Saving..." : "Save"}
            </button>
          </div>
        </>
      )}
      </div>
      <aside className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <nav
          aria-label="Content side panel"
          className="flex rounded-xl border border-zinc-200 bg-white p-1 shadow-sm"
        >
          {(["review", "comments", "activity"] as const).map((tab) => (
            <button
              aria-current={activeSideTab === tab ? "page" : undefined}
              className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium capitalize ${
                activeSideTab === tab
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-50"
              }`}
              key={tab}
              onClick={() => setActiveSideTab(tab)}
              type="button"
            >
              {tab}
              {tab === "comments" &&
                comments.filter(
                  (comment) =>
                    comment.section_id === null && comment.finding_id === null
                ).length > 0 &&
                ` (${comments.filter((comment) => comment.section_id === null && comment.finding_id === null).length})`}
            </button>
          ))}
        </nav>
        {activeSideTab === "review" && (
          <ReviewPanel
            comments={comments}
            contentId={content.id}
            currentUserId={currentUserId}
            editable={canEdit}
            initialFindings={initialFindings}
            initialStats={initialStats}
            initialAiCallsToday={initialAiCallsToday}
            onCommentsRefresh={refreshComments}
            onFocusExcerpt={focusExcerpt}
            onSectionsApplied={acceptAppliedSections}
            sectionLabels={sections.map((section, index) => ({
              id: section.id,
              label: `${section.type === "text" ? "Text" : "Image"} section ${index + 1}`,
            }))}
            unsavedChanges={dirtyChanged}
          />
        )}
        {activeSideTab === "comments" && (
          <CommentsPanel
            comments={comments}
            contentId={content.id}
            currentUserId={currentUserId}
            onRefresh={refreshComments}
          />
        )}
        {activeSideTab === "activity" && (
          <ActivityPanel
            comments={comments}
            contentId={content.id}
            events={initialEvents}
          />
        )}
      </aside>
      </div>

      {feedback && (
        <p
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            feedbackIsError
              ? "bg-red-50 text-red-700"
              : "bg-emerald-50 text-emerald-800"
          }`}
          role="status"
        >
          {feedback}
        </p>
      )}
    </div>
  );
}

function sameSections(a: ContentSection[], b: ContentSection[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function TextSection({
  body,
  canEdit,
  highlightExcerpt,
  onChange,
}: {
  body: string;
  canEdit: boolean;
  highlightExcerpt: string;
  onChange: (body: string) => void;
}) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer" },
        }),
      ],
      content: body || "<p></p>",
      editable: canEdit,
      immediatelyRender: false,
      onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML()),
    },
    [canEdit]
  );

  useEffect(() => {
    if (!editor || !highlightExcerpt) {
      return;
    }

    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const index = text.indexOf(highlightExcerpt);
      if (index < 0) {
        continue;
      }

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + highlightExcerpt.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.parentElement?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      break;
    }
  }, [editor, highlightExcerpt]);

  if (!editor) {
    return (
      <div className="min-h-32 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-400">
        Loading text editor...
      </div>
    );
  }

  function addLink() {
    if (!editor) {
      return;
    }
    const url = window.prompt("Enter the link URL");
    if (!url) {
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url, rel: "noopener noreferrer" })
      .run();
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      {canEdit && (
        <div className="flex flex-wrap gap-1 border-b border-zinc-200 bg-zinc-50 p-2">
          <ToolbarButton
            active={editor.isActive("bold")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            Bold
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            Italic
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("bulletList")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            Bullet list
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("orderedList")}
            disabled={!canEdit}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            Numbered list
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("link")}
            disabled={!canEdit}
            onClick={addLink}
          >
            Link
          </ToolbarButton>
        </div>
      )}
      <EditorContent
        className={`content-prose min-h-40 px-4 py-3 text-sm leading-6 text-zinc-800 [&_.tiptap]:min-h-32 [&_.tiptap]:outline-none [&_a]:text-indigo-700 [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6`}
        editor={editor}
      />
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  children: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`rounded px-2.5 py-1.5 text-xs font-medium ${
        active
          ? "bg-indigo-100 text-indigo-800"
          : "text-zinc-700 hover:bg-zinc-200"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ImageSection({
  altText,
  canEdit,
  contentId,
  imagePath,
  imageRole,
  imageMeta,
  placedBackground,
  brandKit,
  imageUrl,
  isPending,
  onAltTextChange,
  onImageChange,
  onImageRoleChange,
  onPlacedBackgroundChange,
}: {
  altText: string;
  canEdit: boolean;
  contentId: string;
  imagePath: string | null;
  imageRole: "logo" | "graphic" | "photo";
  imageMeta: ImageAnalysis | null;
  placedBackground: string | null;
  brandKit: BrandKit | null;
  imageUrl?: string;
  isPending: boolean;
  onAltTextChange: (value: string) => void;
  onImageChange: (path: string, url: string | undefined, imageMeta: ImageAnalysis) => void;
  onImageRoleChange: (role: "logo" | "graphic" | "photo") => void;
  onPlacedBackgroundChange: (value: string | null) => void;
}) {
  const [error, setError] = useState("");
  const [uploadPending, startUpload] = useTransition();

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    setError("");
    startUpload(async () => {
      let analysis: ImageAnalysis;
      try {
        analysis = await analyzeImage(file);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Could not analyze this image."
        );
        return;
      }
      const result = await uploadImage(contentId, file);
      if ("error" in result) {
        setError(result.error);
      } else {
        onImageChange(result.path, result.url, analysis);
      }
    });
  }

  const checks =
    brandKit && imageMeta
      ? evaluateImage(imageMeta, imageRole, placedBackground, brandKit)
      : [];

  return (
    <div className="space-y-4">
      {canEdit && (
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-zinc-700"
            htmlFor={`image-${contentId}-${imagePath ?? "new"}`}
          >
            Upload image
          </label>
          <input
            accept="image/png,image/jpeg,image/webp"
            className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
            disabled={isPending || uploadPending}
            id={`image-${contentId}-${imagePath ?? "new"}`}
            onChange={handleUpload}
            type="file"
          />
          <p className="mt-1 text-xs text-zinc-500">
            PNG, JPEG, or WEBP. Maximum 5 MB.
          </p>
        </div>
      )}
      {imageUrl && (
        <Image
          alt={altText || "Content image preview"}
          className="max-h-96 w-full rounded-lg border border-zinc-200 bg-zinc-50 object-contain"
          height={600}
          unoptimized
          src={imageUrl}
          width={900}
        />
      )}
      {imagePath && !imageUrl && (
        <p className="text-sm text-zinc-500">Loading image preview...</p>
      )}
      {canEdit ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor={`image-role-${contentId}-${imagePath ?? "new"}`}
            >
              Image role
            </label>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-900"
              id={`image-role-${contentId}-${imagePath ?? "new"}`}
              onChange={(event) => {
                const role = event.target.value;
                if (role === "logo" || role === "graphic" || role === "photo") {
                  onImageRoleChange(role);
                }
              }}
              value={imageRole}
            >
              <option value="logo">Logo</option>
              <option value="graphic">Brand graphic</option>
              <option value="photo">Photo</option>
            </select>
          </div>
          <div>
            <label
              className="mb-1.5 block text-sm font-medium text-zinc-700"
              htmlFor={`image-background-${contentId}-${imagePath ?? "new"}`}
            >
              Placed on background colour (optional)
            </label>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900"
              id={`image-background-${contentId}-${imagePath ?? "new"}`}
              maxLength={7}
              onChange={(event) =>
                onPlacedBackgroundChange(event.target.value || null)
              }
              pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
              placeholder="#ffffff"
              type="text"
              value={placedBackground ?? ""}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          Image role: {imageRole === "graphic" ? "Brand graphic" : imageRole}
          {placedBackground && ` · Background ${placedBackground}`}
        </p>
      )}
      {imageMeta && (
        <div className="space-y-2">
          {checks.length ? (
            <ul aria-label="Visual check results" className="flex flex-wrap gap-2">
              {checks.map((check) => (
                <li
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    check.status === "pass"
                      ? "bg-emerald-100 text-emerald-800"
                      : check.status === "fail"
                        ? "bg-red-100 text-red-800"
                        : "bg-zinc-100 text-zinc-600"
                  }`}
                  key={check.id}
                  title={check.message}
                >
                  {check.id.replaceAll("_", " ")}:{" "}
                  {check.status === "pass"
                    ? "Pass"
                    : check.status === "fail"
                      ? "Check"
                      : "Skipped"}
                </li>
              ))}
            </ul>
          ) : !brandKit && imageRole !== "photo" ? (
            <p className="text-xs text-amber-700">
              No Brand kit set up; visual checks are skipped.
            </p>
          ) : null}
          <p className="text-xs text-zinc-500">
            {imageMeta.width} × {imageMeta.height}px · {imageMeta.format}
            {imageMeta.hasTransparency ? " · transparent" : ""}
          </p>
        </div>
      )}
      {canEdit ? (
        <div>
          <label
            className="mb-1.5 block text-sm font-medium text-zinc-700"
            htmlFor={`alt-${contentId}-${imagePath ?? "new"}`}
          >
            Alt text
          </label>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-zinc-900"
            id={`alt-${contentId}-${imagePath ?? "new"}`}
            maxLength={500}
            onChange={(event) => onAltTextChange(event.target.value)}
            required
            type="text"
            value={altText}
          />
          {!altText.trim() && (
            <p className="mt-1 text-xs text-amber-700">
              Add alt text before saving this image section.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          <span className="font-medium">Alt text:</span>{" "}
          {altText || "Not provided"}
        </p>
      )}
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {uploadPending && (
        <p className="text-sm text-zinc-500">Uploading image...</p>
      )}
    </div>
  );
}
