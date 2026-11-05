"use server";

import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const platforms = [
  "LinkedIn",
  "X (Twitter)",
  "Instagram",
  "Facebook",
  "Blog/Website",
  "Email",
] as const;
type Platform = (typeof platforms)[number];
type SectionType = "text" | "image";
type ContentSection = {
  id: string;
  type: SectionType;
  body: string | null;
  image_path: string | null;
  alt_text: string | null;
  position: number;
};
type WorkspaceContext =
    | { ok: false; error: string }
    | {
        ok: true;
        supabase: Awaited<ReturnType<typeof createClient>>;
        orgId: string;
        userId: string;
        role: string;
      };

const allowedImageTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);
const maxImageSize = 5 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { ok: false, error: userError.message };
  }
  if (!user) {
    return { ok: false, error: "Sign in to access the workspace." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, error: membershipError.message };
  }
  if (!membership) {
    return { ok: false, error: "You have not been added to an organisation." };
  }

  return {
    ok: true,
    supabase,
    orgId: membership.org_id,
    userId: user.id,
    role: membership.role,
  };
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isContentImagePath(
  path: string,
  orgId: string,
  contentId: string
): boolean {
  const [pathOrgId, pathContentId, filename, ...extra] = path.split("/");
  return (
    pathOrgId === orgId &&
    pathContentId === contentId &&
    extra.length === 0 &&
    typeof filename === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-.+$/i.test(
      filename
    )
  );
}

function isPlatforms(value: unknown): value is Platform[] {
  return (
    Array.isArray(value) &&
    value.every(
      (platform): platform is Platform =>
        typeof platform === "string" &&
        platforms.some((allowed) => allowed === platform)
    ) &&
    new Set(value).size === value.length
  );
}

function sanitizeBody(body: string): string {
  return sanitizeHtml(body, {
    allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "a"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform(
        "a",
        { rel: "noopener noreferrer" },
        true
      ),
    },
  });
}

function validateSections(value: unknown, orgId: string, contentId: string):
  | { error: string }
  | { sections: ContentSection[] } {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    return { error: "Add between 1 and 100 content sections." };
  }

  const ids = new Set<string>();
  const sections: ContentSection[] = [];

  for (const [position, section] of value.entries()) {
    if (
      typeof section !== "object" ||
      section === null ||
      !("id" in section) ||
      !isUuid(section.id) ||
      ids.has(section.id)
    ) {
      return { error: "Each section must have a unique valid ID." };
    }
    ids.add(section.id);

    if (section.type !== "text" && section.type !== "image") {
      return { error: "Section type must be text or image." };
    }
    if (
      section.body !== null &&
      section.body !== undefined &&
      typeof section.body !== "string"
    ) {
      return { error: "Section body must be text." };
    }

    const body =
      section.type === "text"
        ? sanitizeBody(typeof section.body === "string" ? section.body : "")
        : typeof section.body === "string"
          ? section.body.slice(0, 100_000)
          : null;

    if (section.type === "image") {
      if (
        typeof section.image_path !== "string" ||
        !isContentImagePath(section.image_path, orgId, contentId)
      ) {
        return { error: "Upload an image for every image section." };
      }
      if (
        typeof section.alt_text !== "string" ||
        !section.alt_text.trim() ||
        section.alt_text.trim().length > 500
      ) {
        return { error: "Alt text is required for every image section." };
      }
    } else if (section.image_path !== null && section.image_path !== undefined) {
      return { error: "Text sections cannot reference an image." };
    }

    sections.push({
      id: section.id,
      type: section.type,
      body,
      image_path:
        section.type === "image" ? (section.image_path as string) : null,
      alt_text:
        section.type === "image"
          ? (section.alt_text as string).trim()
          : null,
      position,
    });
  }

  return { sections };
}

async function getEditableContent(
  contentId: string,
  context: Extract<WorkspaceContext, { ok: true }>
) {
  if (context.role !== "creator") {
    return {
      ok: false,
      error: "Only the content creator can edit this content.",
    } as const;
  }

  const { data: content, error } = await context.supabase
    .from("contents")
    .select("id, status, created_by")
    .eq("id", contentId)
    .eq("org_id", context.orgId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message } as const;
  }
  if (!content || content.created_by !== context.userId) {
    return {
      ok: false,
      error: "Content not found or you are not its creator.",
    } as const;
  }
  if (
    content.status !== "draft" &&
    content.status !== "changes_requested"
  ) {
    return {
      ok: false,
      error: "Only drafts and content with requested changes can be edited.",
    } as const;
  }

  return { ok: true, content } as const;
}

export async function createContent(
  titleValue: unknown
): Promise<{ error: string } | { id: string }> {
  if (
    typeof titleValue !== "string" ||
    !titleValue.trim() ||
    titleValue.trim().length > 200
  ) {
    return { error: "Enter a title of 1 to 200 characters." };
  }

  const context = await getWorkspaceContext();
  if (!context.ok) {
    return { error: context.error };
  }
  if (context.role !== "creator") {
    return { error: "Only Creators can create content." };
  }

  const { data: content, error } = await context.supabase
    .from("contents")
    .insert({
      org_id: context.orgId,
      title: titleValue.trim(),
      status: "draft",
      platforms: [],
      created_by: context.userId,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  const { error: sectionError } = await context.supabase
    .from("content_sections")
    .insert({
      org_id: context.orgId,
      content_id: content.id,
      position: 0,
      type: "text",
      body: "",
      image_path: null,
      alt_text: null,
    });

  if (sectionError) {
    const { error: cleanupError } = await context.supabase
      .from("contents")
      .delete()
      .eq("id", content.id)
      .eq("org_id", context.orgId);
    return {
      error: cleanupError
        ? `${sectionError.message} Content cleanup failed: ${cleanupError.message}`
        : sectionError.message,
    };
  }

  revalidatePath("/workspace");
  return { id: content.id };
}

export async function saveContent(
  contentIdValue: unknown,
  titleValue: unknown,
  platformsValue: unknown,
  sectionsValue: unknown
): Promise<{ error: string } | { success: true }> {
  if (!isUuid(contentIdValue)) {
    return { error: "Select valid content to save." };
  }
  if (
    typeof titleValue !== "string" ||
    !titleValue.trim() ||
    titleValue.trim().length > 200
  ) {
    return { error: "Enter a title of 1 to 200 characters." };
  }
  if (!isPlatforms(platformsValue)) {
    return { error: "Select only the supported platforms." };
  }

  const context = await getWorkspaceContext();
  if (!context.ok) {
    return { error: context.error };
  }
  const editable = await getEditableContent(contentIdValue, context);
  if (editable.ok === false) {
    return { error: editable.error };
  }

  const validatedSections = validateSections(
    sectionsValue,
    context.orgId,
    contentIdValue
  );
  if ("error" in validatedSections) {
    return validatedSections;
  }

  const { data: previousSections, error: sectionsError } = await context.supabase
    .from("content_sections")
    .select("id, content_id, image_path")
    .eq("org_id", context.orgId)
    .eq("content_id", contentIdValue);

  if (sectionsError) {
    return { error: sectionsError.message };
  }

  const submittedIds = validatedSections.sections.map((section) => section.id);
  const { data: conflictingSections, error: conflictError } =
    await context.supabase
      .from("content_sections")
      .select("id, content_id")
      .eq("org_id", context.orgId)
      .in("id", submittedIds);

  if (conflictError) {
    return { error: conflictError.message };
  }
  if (
    (conflictingSections ?? []).some(
      (section) => section.content_id !== contentIdValue
    )
  ) {
    return { error: "A section ID is already used by other content." };
  }

  const { data: updatedContent, error: updateError } = await context.supabase
    .from("contents")
    .update({
      title: titleValue.trim(),
      platforms: platformsValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contentIdValue)
    .eq("org_id", context.orgId)
    .eq("created_by", context.userId)
    .in("status", ["draft", "changes_requested"])
    .select("id")
    .maybeSingle();

  if (updateError) {
    return { error: updateError.message };
  }
  if (!updatedContent) {
    return { error: "Content is no longer editable." };
  }

  const { error: upsertError } = await context.supabase
    .from("content_sections")
    .upsert(
      validatedSections.sections.map((section) => ({
        ...section,
        org_id: context.orgId,
        content_id: contentIdValue,
      })),
      { onConflict: "id" }
    );

  if (upsertError) {
    return { error: `Content title saved, but sections could not be saved: ${upsertError.message}` };
  }

  const removedSections = (previousSections ?? []).filter(
    (section) => !submittedIds.includes(section.id)
  );
  if (removedSections.length > 0) {
    const { error: deleteSectionsError } = await context.supabase
      .from("content_sections")
      .delete()
      .eq("org_id", context.orgId)
      .eq("content_id", contentIdValue)
      .in(
        "id",
        removedSections.map((section) => section.id)
      );
    if (deleteSectionsError) {
      return {
        error: `Content saved, but removed sections could not be deleted: ${deleteSectionsError.message}`,
      };
    }
  }

  const sectionSnapshot = validatedSections.sections.map(
    ({ type, body, image_path, alt_text, position }) => ({
      type,
      body,
      image_path,
      alt_text,
      position,
    })
  );
  const { error: versionError } = await context.supabase
    .from("content_versions")
    .insert({
      org_id: context.orgId,
      content_id: contentIdValue,
      created_by: context.userId,
      snapshot: {
        title: titleValue.trim(),
        platforms: platformsValue,
        sections: sectionSnapshot,
      },
    });

  if (versionError) {
    return {
      error: `Content saved, but revision history could not be recorded: ${versionError.message}`,
    };
  }

  const removedImagePaths = removedSections
    .map((section) => section.image_path)
    .filter((path): path is string => Boolean(path));
  if (removedImagePaths.length > 0) {
    const { error: imageCleanupError } = await context.supabase.storage
      .from("content-images")
      .remove(removedImagePaths);
    if (imageCleanupError) {
      revalidatePath(`/workspace/${contentIdValue}`);
      revalidatePath("/workspace");
      return {
        error: `Content saved, but removed image files could not be cleaned up: ${imageCleanupError.message}`,
      };
    }
  }

  revalidatePath(`/workspace/${contentIdValue}`);
  revalidatePath("/workspace");
  return { success: true };
}

export async function uploadImage(
  contentIdValue: unknown,
  fileValue: unknown
): Promise<{ error: string } | { path: string; url: string }> {
  if (!isUuid(contentIdValue)) {
    return { error: "Select valid content before uploading an image." };
  }
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { error: "Choose an image to upload." };
  }
  const extension = allowedImageTypes.get(fileValue.type);
  if (!extension) {
    return { error: "Only PNG, JPEG, and WEBP images are allowed." };
  }
  if (fileValue.size > maxImageSize) {
    return { error: "Images must be 5 MB or smaller." };
  }

  const context = await getWorkspaceContext();
  if (!context.ok) {
    return { error: context.error };
  }
  const editable = await getEditableContent(contentIdValue, context);
  if (editable.ok === false) {
    return { error: editable.error };
  }

  const filename = fileValue.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160);
  const path = `${context.orgId}/${contentIdValue}/${randomUUID()}-${filename || `image.${extension}`}`;
  const { error } = await context.supabase.storage
    .from("content-images")
    .upload(path, fileValue, {
      contentType: fileValue.type,
      upsert: false,
    });

  if (error) {
    return { error: error.message };
  }

  const { data: signedUrl, error: signedUrlError } = await context.supabase.storage
    .from("content-images")
    .createSignedUrl(path, 60 * 60);
  if (signedUrlError) {
    const { error: cleanupError } = await context.supabase.storage
      .from("content-images")
      .remove([path]);
    return {
      error: cleanupError
        ? `${signedUrlError.message} Image cleanup failed: ${cleanupError.message}`
        : signedUrlError.message,
    };
  }

  revalidatePath(`/workspace/${contentIdValue}`);
  return { path, url: signedUrl.signedUrl };
}

export async function getImageUrl(
  contentIdValue: unknown,
  pathValue: unknown
): Promise<{ error: string } | { url: string }> {
  if (!isUuid(contentIdValue) || typeof pathValue !== "string") {
    return { error: "Select a valid content image." };
  }

  const context = await getWorkspaceContext();
  if (!context.ok) {
    return { error: context.error };
  }

  if (!isContentImagePath(pathValue, context.orgId, contentIdValue)) {
    return { error: "Content image not found." };
  }

  const { data: content, error: contentError } = await context.supabase
    .from("contents")
    .select("id")
    .eq("org_id", context.orgId)
    .eq("id", contentIdValue)
    .maybeSingle();

  if (contentError) {
    return { error: contentError.message };
  }
  if (!content) {
    return { error: "Content image not found." };
  }

  const { data, error } = await context.supabase.storage
    .from("content-images")
    .createSignedUrl(pathValue, 60 * 60);
  if (error) {
    return { error: error.message };
  }

  return { url: data.signedUrl };
}

export async function deleteContent(
  contentIdValue: unknown
): Promise<string | null> {
  if (!isUuid(contentIdValue)) {
    return "Select valid content to delete.";
  }

  const context = await getWorkspaceContext();
  if (!context.ok) {
    return context.error;
  }
  if (context.role !== "creator") {
    return "Only Creators can delete content.";
  }

  const { data: content, error: contentError } = await context.supabase
    .from("contents")
    .select("id, created_by, status")
    .eq("id", contentIdValue)
    .eq("org_id", context.orgId)
    .maybeSingle();

  if (contentError) {
    return contentError.message;
  }
  if (!content || content.created_by !== context.userId) {
    return "Content not found or you are not its creator.";
  }
  if (content.status !== "draft") {
    return "Only draft content can be deleted.";
  }

  const { data: sections, error: sectionsError } = await context.supabase
    .from("content_sections")
    .select("image_path")
    .eq("org_id", context.orgId)
    .eq("content_id", contentIdValue);

  if (sectionsError) {
    return sectionsError.message;
  }

  const { error } = await context.supabase
    .from("contents")
    .delete()
    .eq("id", contentIdValue)
    .eq("org_id", context.orgId)
    .eq("created_by", context.userId)
    .eq("status", "draft");

  if (error) {
    return error.message;
  }

  const imagePaths = (sections ?? [])
    .map((section) => section.image_path)
    .filter((path): path is string => Boolean(path));
  if (imagePaths.length > 0) {
    const { error: cleanupError } = await context.supabase.storage
      .from("content-images")
      .remove(imagePaths);
    if (cleanupError) {
      revalidatePath("/workspace");
      return `Content deleted, but image cleanup failed: ${cleanupError.message}`;
    }
  }

  revalidatePath("/workspace");
  return null;
}
