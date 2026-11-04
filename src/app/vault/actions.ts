"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { extractText } from "@/lib/extract-text";
import { createClient } from "@/lib/supabase/server";

const kinds = ["guideline", "fact", "term", "asset"] as const;
type VaultKind = (typeof kinds)[number];
type StorageBucket = "vault-files" | "vault-assets";
type ParsedItem = {
  id: string | null;
  title: string;
  kind: VaultKind;
  body: string;
  owner: string;
  validUntil: string | null;
  confidential: boolean;
  tags: string[];
  file: File | null;
};
type ManagerContext =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      orgId: string;
      userId: string;
    };

const fileTypes: Record<string, { bucket: StorageBucket; mimeTypes: string[]; maxSize: number }> = {
  pdf: {
    bucket: "vault-files",
    mimeTypes: ["application/pdf"],
    maxSize: 10 * 1024 * 1024,
  },
  docx: {
    bucket: "vault-files",
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxSize: 10 * 1024 * 1024,
  },
  txt: {
    bucket: "vault-files",
    mimeTypes: ["text/plain"],
    maxSize: 10 * 1024 * 1024,
  },
  png: {
    bucket: "vault-assets",
    mimeTypes: ["image/png"],
    maxSize: 5 * 1024 * 1024,
  },
  jpg: {
    bucket: "vault-assets",
    mimeTypes: ["image/jpeg"],
    maxSize: 5 * 1024 * 1024,
  },
  jpeg: {
    bucket: "vault-assets",
    mimeTypes: ["image/jpeg"],
    maxSize: 5 * 1024 * 1024,
  },
  webp: {
    bucket: "vault-assets",
    mimeTypes: ["image/webp"],
    maxSize: 5 * 1024 * 1024,
  },
  svg: {
    bucket: "vault-assets",
    mimeTypes: ["image/svg+xml"],
    maxSize: 5 * 1024 * 1024,
  },
};

function isVaultKind(value: string): value is VaultKind {
  return kinds.some((kind) => kind === value);
}

function isTagList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 10 &&
    value.every(
      (tag) =>
        typeof tag === "string" &&
        Boolean(tag.trim()) &&
        tag.trim().length <= 80
    )
  );
}

async function getManagerContext(): Promise<ManagerContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { ok: false, error: userError.message };
  }
  if (!user) {
    return { ok: false, error: "Sign in to manage the vault." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("role", "brand_manager")
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, error: membershipError.message };
  }
  if (!membership) {
    return { ok: false, error: "Only a Brand Manager can manage the vault." };
  }

  return { ok: true, supabase, orgId: membership.org_id, userId: user.id };
}

function parseItem(formData: FormData, requireId: boolean): ParsedItem | string {
  const idValue = formData.get("id");
  const id =
    typeof idValue === "string" && idValue.trim() ? idValue.trim() : null;
  const title = formData.get("title");
  const kind = formData.get("kind");
  const body = formData.get("body");
  const owner = formData.get("owner");
  const validUntil = formData.get("validUntil");
  const confidential = formData.get("confidential");
  const tagsValue = formData.get("tags");
  const fileValue = formData.get("file");

  if (requireId && (!id || !isUuid(id))) {
    return "Select a valid vault item.";
  }
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
    return "Enter a title of 1 to 200 characters.";
  }
  if (typeof kind !== "string" || !isVaultKind(kind)) {
    return "Select a valid item kind.";
  }
  if (typeof body !== "string" || body.length > 100_000) {
    return "Body must be 100,000 characters or fewer.";
  }
  if (typeof owner !== "string" || owner.length > 200) {
    return "Owner must be 200 characters or fewer.";
  }
  if (
    typeof validUntil !== "string" ||
    (validUntil !== "" && !isValidDate(validUntil))
  ) {
    return "Enter a valid expiry date.";
  }
  if (confidential !== "true" && confidential !== "false") {
    return "Select whether this item is confidential.";
  }

  let tags: unknown;
  try {
    tags = JSON.parse(typeof tagsValue === "string" ? tagsValue : "");
  } catch {
    return "The tags could not be read.";
  }
  if (!isTagList(tags)) {
    return "Add no more than 10 tags, each up to 80 characters.";
  }

  let file: File | null = null;
  if (fileValue instanceof File && fileValue.size > 0) {
    file = fileValue;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const fileType = fileTypes[extension];
    if (!fileType) {
      return "Choose a PDF, DOCX, TXT, PNG, JPEG, WEBP, or SVG file.";
    }
    if (!fileType.mimeTypes.includes(file.type)) {
      return "The uploaded file type does not match its filename.";
    }
    if (file.size > fileType.maxSize) {
      return `The file exceeds the ${fileType.maxSize / (1024 * 1024)} MB limit.`;
    }
    if (
      (kind === "asset" && fileType.bucket !== "vault-assets") ||
      (kind !== "asset" && fileType.bucket !== "vault-files")
    ) {
      return kind === "asset"
        ? "Assets must be PNG, JPEG, WEBP, or SVG images."
        : "Guidelines, facts, and terms accept PDF, DOCX, or TXT files.";
    }
  }

  return {
    id,
    title: title.trim(),
    kind,
    body,
    owner: owner.trim(),
    validUntil: validUntil || null,
    confidential: confidential === "true",
    tags: [...new Set(tags.map((tag) => tag.trim()))],
    file,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function getBucket(kind: VaultKind): StorageBucket {
  return kind === "asset" ? "vault-assets" : "vault-files";
}

function storagePath(orgId: string, file: File): string {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
  return `${orgId}/${randomUUID()}-${safeName || "upload"}`;
}

async function prepareBody(item: ParsedItem): Promise<{
  body: string;
  warning?: string;
}> {
  if (!item.file || item.kind === "asset") {
    return { body: item.body.trim() };
  }

  const extension = item.file.name.split(".").pop()?.toLowerCase() ?? "";
  try {
    const extracted = await extractText(item.file, extension);
    if (!extracted) {
      return {
        body: item.body.trim(),
        warning: "The file was saved, but no text could be extracted.",
      };
    }
    return {
      body: item.body.trim()
        ? `${item.body.trim()}\n\n${extracted}`
        : extracted,
    };
  } catch (error) {
    return {
      body: item.body.trim(),
      warning: `The file was saved, but text extraction failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

export async function createItem(
  formData: FormData
): Promise<{ error: string } | { warning?: string }> {
  const parsed = parseItem(formData, false);
  if (typeof parsed === "string") {
    return { error: parsed };
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return { error: context.error };
  }

  const { body, warning } = await prepareBody(parsed);
  let assetPath: string | null = null;
  const bucket = getBucket(parsed.kind);

  if (parsed.file) {
    assetPath = storagePath(context.orgId, parsed.file);
    const { error } = await context.supabase.storage
      .from(bucket)
      .upload(assetPath, parsed.file, {
        contentType: parsed.file.type,
        upsert: false,
      });
    if (error) {
      return { error: `File upload failed: ${error.message}` };
    }
  }

  const { error } = await context.supabase.from("vault_items").insert({
    org_id: context.orgId,
    kind: parsed.kind,
    title: parsed.title,
    body,
    owner: parsed.owner || null,
    valid_until: parsed.validUntil,
    is_confidential: parsed.confidential,
    tags: parsed.tags,
    asset_path: assetPath,
    created_by: context.userId,
  });

  if (error) {
    const cleanupError = assetPath
      ? (
          await context.supabase.storage.from(bucket).remove([assetPath])
        ).error
      : null;
    return {
      error: cleanupError
        ? `${error.message} Uploaded file cleanup failed: ${cleanupError.message}`
        : error.message,
    };
  }

  revalidatePath("/vault");
  return { warning };
}

export async function updateItem(
  formData: FormData
): Promise<{ error: string } | { warning?: string }> {
  const parsed = parseItem(formData, true);
  if (typeof parsed === "string" || !parsed.id) {
    return { error: typeof parsed === "string" ? parsed : "Select a valid vault item." };
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return { error: context.error };
  }

  const { data: existing, error: lookupError } = await context.supabase
    .from("vault_items")
    .select("kind, asset_path")
    .eq("id", parsed.id)
    .eq("org_id", context.orgId)
    .maybeSingle();

  if (lookupError) {
    return { error: lookupError.message };
  }
  if (!existing) {
    return { error: "Vault item not found." };
  }

  const { body, warning } = await prepareBody(parsed);
  const nextBucket = getBucket(parsed.kind);
  let nextPath =
    parsed.file || existing.kind !== parsed.kind ? null : existing.asset_path;
  let uploadedPath: string | null = null;

  if (parsed.file) {
    uploadedPath = storagePath(context.orgId, parsed.file);
    const { error } = await context.supabase.storage
      .from(nextBucket)
      .upload(uploadedPath, parsed.file, {
        contentType: parsed.file.type,
        upsert: false,
      });
    if (error) {
      return { error: `File upload failed: ${error.message}` };
    }
    nextPath = uploadedPath;
  }

  const { error } = await context.supabase
    .from("vault_items")
    .update({
      kind: parsed.kind,
      title: parsed.title,
      body,
      owner: parsed.owner || null,
      valid_until: parsed.validUntil,
      is_confidential: parsed.confidential,
      tags: parsed.tags,
      asset_path: nextPath,
    })
    .eq("id", parsed.id)
    .eq("org_id", context.orgId);

  if (error) {
    const cleanupError = uploadedPath
      ? (await context.supabase.storage.from(nextBucket).remove([uploadedPath]))
          .error
      : null;
    return {
      error: cleanupError
        ? `${error.message} Uploaded file cleanup failed: ${cleanupError.message}`
        : error.message,
    };
  }

  if (existing.asset_path && existing.asset_path !== nextPath) {
    const oldBucket = getBucket(existing.kind);
    const { error: removalError } = await context.supabase.storage
      .from(oldBucket)
      .remove([existing.asset_path]);
    if (removalError) {
      revalidatePath("/vault");
      return {
        warning: `Item updated, but its previous file could not be removed: ${removalError.message}`,
      };
    }
  }

  revalidatePath("/vault");
  return { warning };
}

export async function deleteItem(
  itemId: unknown
): Promise<string | null> {
  if (typeof itemId !== "string" || !isUuid(itemId)) {
    return "Select a valid vault item.";
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return context.error;
  }

  const { data: item, error: lookupError } = await context.supabase
    .from("vault_items")
    .select("kind, asset_path")
    .eq("id", itemId)
    .eq("org_id", context.orgId)
    .maybeSingle();

  if (lookupError) {
    return lookupError.message;
  }
  if (!item) {
    return "Vault item not found.";
  }

  const { error } = await context.supabase
    .from("vault_items")
    .delete()
    .eq("id", itemId)
    .eq("org_id", context.orgId);

  if (error) {
    return error.message;
  }

  if (item.asset_path) {
    const { error: removalError } = await context.supabase.storage
      .from(getBucket(item.kind))
      .remove([item.asset_path]);
    if (removalError) {
      revalidatePath("/vault");
      return `Item deleted, but its stored file could not be removed: ${removalError.message}`;
    }
  }

  revalidatePath("/vault");
  return null;
}

export async function getSignedUrl(
  path: unknown,
  bucket: unknown
): Promise<{ url: string } | { error: string }> {
  if (
    typeof path !== "string" ||
    (bucket !== "vault-assets" && bucket !== "vault-files")
  ) {
    return { error: "Select a valid vault file." };
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return { error: context.error };
  }
  if (!path.startsWith(`${context.orgId}/`)) {
    return { error: "Vault file not found." };
  }

  const { data, error } = await context.supabase.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    return { error: error.message };
  }

  return { url: data.signedUrl };
}
