"use server";

import sanitizeHtml from "sanitize-html";
import { extractText } from "@/lib/extract-text";
import { createClient } from "@/lib/supabase/server";

const maxFileSize = 10 * 1024 * 1024;
const maxCharacters = 50_000;
const targetSectionCharacters = 1_500;
const longParagraphThreshold = 3_000;
const supportedFiles: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

type ParsedSection = {
  html: string;
  preview: string;
  charCount: number;
};

export async function parseDocumentAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { error: userError.message };
  }
  if (!user) {
    return { error: "Sign in to import a document." };
  }

  const contentId = formData.get("contentId");
  if (typeof contentId !== "string" || !isUuid(contentId)) {
    return { error: "Select valid content to import into." };
  }

  const { data: content, error: contentError } = await supabase
    .from("contents")
    .select("id, org_id, created_by, status")
    .eq("id", contentId)
    .maybeSingle();

  if (contentError) {
    return { error: contentError.message };
  }
  if (!content) {
    return { error: "Content not found or you do not have permission to edit it." };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("members")
    .select("user_id")
    .eq("org_id", content.org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    return { error: membershipError.message };
  }
  if (
    !membership ||
    content.created_by !== user.id ||
    (content.status !== "draft" && content.status !== "changes_requested")
  ) {
    return { error: "Only the creator can import into drafts or content with requested changes." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Choose a PDF, DOCX, or TXT document to import." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expectedMimeType = supportedFiles[extension];
  if (!expectedMimeType || file.type !== expectedMimeType) {
    return { error: "Choose a PDF, DOCX, or TXT file with a matching file type." };
  }
  if (file.size > maxFileSize) {
    return { error: "The document exceeds the 10 MB limit." };
  }
  if (file.size === 0) {
    return {
      error: "No readable text found. Scanned documents aren't supported.",
    };
  }

  let extractedText: string;
  try {
    extractedText = await extractText(file, extension, null);
  } catch {
    return {
      error: "Could not read this file. Make sure it is a valid PDF, DOCX, or TXT document.",
    };
  }

  if (!extractedText.trim()) {
    return {
      error: "No readable text found. Scanned documents aren't supported.",
    };
  }

  const truncatedChars = Math.max(0, extractedText.length - maxCharacters);
  const text = extractedText.slice(0, maxCharacters);
  const sections = splitIntoSections(text);
  const warnings =
    extension === "pdf" || extension === "docx"
      ? ["Images and tables in the document are not imported"]
      : [];

  return {
    sections,
    stats: {
      fileName: file.name,
      totalChars: text.length,
      sectionCount: sections.length,
      truncatedChars,
    },
    warnings,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function splitIntoSections(text: string): ParsedSection[] {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").trim())
    .filter(Boolean);
  const splitParagraphs = paragraphs.flatMap((paragraph) =>
    paragraph.length > longParagraphThreshold
      ? splitLongParagraph(paragraph)
      : [paragraph]
  );
  const groupedParagraphs: string[][] = [];
  let current: string[] = [];

  for (const paragraph of splitParagraphs) {
    const candidate = [...current, paragraph].join("\n\n");
    if (current.length > 0 && candidate.length > targetSectionCharacters) {
      groupedParagraphs.push(current);
      current = [paragraph];
    } else {
      current.push(paragraph);
    }
  }
  if (current.length > 0) {
    groupedParagraphs.push(current);
  }

  return groupedParagraphs.map((group) => {
    const plainText = group.join("\n\n");
    const html = group
      .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
      .join("");

    return {
      html: sanitizeHtml(html, {
        allowedTags: ["p", "br", "strong", "em", "ul", "ol", "li", "a"],
        allowedAttributes: { a: ["href", "target", "rel"] },
        transformTags: {
          a: sanitizeHtml.simpleTransform(
            "a",
            { rel: "noopener noreferrer" },
            true
          ),
        },
      }),
      preview: plainText.slice(0, 200),
      charCount: plainText.length,
    };
  });
}

function splitLongParagraph(paragraph: string): string[] {
  const sentences = paragraph.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && candidate.length > targetSectionCharacters) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
