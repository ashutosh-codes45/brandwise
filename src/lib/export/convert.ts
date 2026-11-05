import sanitizeHtml from "sanitize-html";
import { EXPORT_PLATFORMS, type PlatformKey } from "./platforms";

export type ApprovedExportSection = {
  type: "text" | "image";
  body: string | null;
  image_path: string | null;
  alt_text: string | null;
  position: number;
};

export type ChangeLogEntry = {
  description: string;
  count: number;
};

export type ExportImage = {
  index: number;
  altText: string;
  signedUrlPlaceholder: string;
  imagePath: string | null;
};

export type ExportResult = {
  text: string;
  html?: string;
  changes: ChangeLogEntry[];
  warnings: string[];
  count: number;
  limit: number | null;
  overLimit: boolean;
  images: ExportImage[];
};

type ParsedText = {
  text: string;
  links: number;
  expandedLinks: number;
  formatting: number;
  listItems: number;
  paragraphs: number;
};

const allowedTags = ["p", "br", "strong", "em", "ul", "ol", "li", "a"];
const allowedAttributes = { a: ["href", "target", "rel"] };
const urlPattern = /https?:\/\/[^\s<>"']+/giu;
const hashtagPattern = /#[\p{L}\p{N}_]+/gu;

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function graphemeCount(value: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
    .length;
}

export function countPlatformCharacters(
  value: string,
  platform: PlatformKey
): number {
  if (platform !== "X (Twitter)") return graphemeCount(value);

  let count = 0;
  let previousIndex = 0;
  for (const match of value.matchAll(urlPattern)) {
    const url = match[0].replace(/[.,!?;:)\]}]+$/u, "");
    const index = match.index ?? 0;
    const trailing = match[0].slice(url.length);
    count += graphemeCount(value.slice(previousIndex, index));
    count += 23;
    count += graphemeCount(trailing);
    previousIndex = index + match[0].length;
  }
  return count + graphemeCount(value.slice(previousIndex));
}

function sanitize(source: string): string {
  return sanitizeHtml(source, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto"],
  });
}

function getTagName(tag: string): string {
  const match = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(tag);
  return match ? `${match[1]}${match[2].toLowerCase()}` : "";
}

function getHref(tag: string): string {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function parsePlainText(source: string, includeLinkTargets: boolean): ParsedText {
  let text = "";
  let links = 0;
  let expandedLinks = 0;
  let formatting = 0;
  let listItems = 0;
  let paragraphs = 0;
  let currentLink: { href: string; start: number } | null = null;
  const listStack: Array<{ type: "ul" | "ol"; itemCount: number }> = [];
  const inListItem: boolean[] = [];

  const append = (value: string) => {
    text += value;
  };
  const ensureNewline = () => {
    if (text && !text.endsWith("\n")) append("\n");
  };

  const input = sanitize(source);
  for (const token of input.split(/(<[^>]+>)/g).filter(Boolean)) {
    if (!token.startsWith("<")) {
      append(decodeEntities(token));
      continue;
    }

    const name = getTagName(token);
    const closing = name.startsWith("/");
    const tag = closing ? name.slice(1) : name;

    if (tag === "br" && !closing) {
      append("\n");
    } else if (tag === "p") {
      if (closing) {
        if (!inListItem[inListItem.length - 1]) append("\n\n");
      } else {
        paragraphs += 1;
        if (!inListItem[inListItem.length - 1] && text.trim()) {
          text = text.replace(/[ \t]*$/, "");
          if (!text.endsWith("\n\n")) append(text.endsWith("\n") ? "\n" : "\n\n");
        }
      }
    } else if (tag === "ul" || tag === "ol") {
      if (closing) {
        listStack.pop();
        if (listStack.length === 0 && text.trim()) {
          text = text.replace(/\n+$/, "");
          append("\n\n");
        }
      } else {
        if (text.trim() && !text.endsWith("\n\n")) {
          text = text.replace(/\n+$/, "");
          append("\n\n");
        }
        listStack.push({ type: tag, itemCount: 0 });
      }
    } else if (tag === "li") {
      if (closing) {
        ensureNewline();
        inListItem.pop();
      } else {
        if (text && !text.endsWith("\n")) append("\n");
        const list = listStack[listStack.length - 1];
        if (list?.type === "ol") {
          list.itemCount += 1;
          append(`${list.itemCount}. `);
        } else {
          append("• ");
        }
        listItems += 1;
        inListItem.push(true);
      }
    } else if (tag === "strong" || tag === "em") {
      if (!closing) formatting += 1;
    } else if (tag === "a") {
      if (closing) {
        if (currentLink && includeLinkTargets) {
          const label = text.slice(currentLink.start);
          if (label && currentLink.href && label !== currentLink.href) {
            append(` (${currentLink.href})`);
            expandedLinks += 1;
          }
        }
        currentLink = null;
      } else {
        links += 1;
        currentLink = { href: getHref(token), start: text.length };
      }
    }
  }

  return {
    text: text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    links,
    expandedLinks,
    formatting,
    listItems,
    paragraphs,
  };
}

function plainHtml(source: string): string {
  const sanitized = sanitize(source);
  return sanitized
    .replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
      const href = getHref(`<a${attributes}>`);
      const targetMatch = /\btarget\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
      const target = targetMatch?.[1] ?? targetMatch?.[2];
      return `<a href="${escapeHtml(href)}"${target ? ` target="${escapeHtml(target)}"` : ""} rel="noopener noreferrer">`;
    });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function countHashtags(value: string): number {
  return [...value.matchAll(hashtagPattern)].length;
}

export function convertApprovedSnapshot(
  sectionsValue: readonly ApprovedExportSection[],
  platform: PlatformKey
): ExportResult {
  const config = EXPORT_PLATFORMS[platform];
  const supportsFormatting = config.supportsFormatting;
  const warnings = [...config.notes];
  const changes: ChangeLogEntry[] = [];
  const images: ExportImage[] = [];
  const ordered = [...sectionsValue].sort((a, b) => a.position - b.position);
  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  let totalLinks = 0;
  let formattingCount = 0;
  let listCount = 0;
  let paragraphCount = 0;
  let expandedLinkCount = 0;

  for (const section of ordered) {
    if (section.type === "image") {
      const index = images.length + 1;
      const altText = section.alt_text?.trim() ?? "";
      images.push({
        index,
        altText,
        signedUrlPlaceholder: `{{IMAGE_${index}_URL}}`,
        imagePath: section.image_path,
      });
      if (!altText) warnings.push(`Image ${index} has empty alt text.`);
      if (supportsFormatting) {
        htmlBlocks.push(
          `<p><img src="{{IMAGE_${index}_URL}}" alt="${escapeHtml(altText)}"></p>`
        );
      }
      if (altText) textBlocks.push(`[Image ${index}: ${altText}]`);
      continue;
    }

    const body = section.body ?? "";
    const parsed = parsePlainText(body, !supportsFormatting);
    totalLinks += parsed.links;
    formattingCount += parsed.formatting;
    listCount += parsed.listItems;
    paragraphCount += parsed.paragraphs;
    expandedLinkCount += parsed.expandedLinks;
    textBlocks.push(parsed.text);
    if (supportsFormatting && body.trim()) htmlBlocks.push(plainHtml(body));
  }

  const text = textBlocks.filter(Boolean).join("\n\n").trim();
  const html = supportsFormatting
    ? htmlBlocks.join("\n").trim()
    : undefined;
  if (!supportsFormatting && formattingCount) {
    changes.push({
      description: `Removed bold/italic formatting (${formattingCount} places)`,
      count: formattingCount,
    });
  }
  if (!supportsFormatting && listCount) {
    changes.push({
      description: `Converted list items to plain-text bullets or numbering (${listCount} places)`,
      count: listCount,
    });
  }
  if (!supportsFormatting && expandedLinkCount) {
    changes.push({
      description: `Added URLs next to descriptive link text (${expandedLinkCount} places)`,
      count: expandedLinkCount,
    });
  }
  if (paragraphCount) {
    changes.push({
      description: `Separated paragraphs with blank lines (${paragraphCount} places)`,
      count: paragraphCount,
    });
  }
  if (images.length && !supportsFormatting) {
    warnings.push("Attach images manually");
    changes.push({
      description: `Listed images for manual attachment (${images.length} places)`,
      count: images.length,
    });
  }
  if (platform === "Instagram" && totalLinks) {
    warnings.push("Links aren't clickable in Instagram captions");
  }

  const hashtags = countHashtags(text);
  if (config.maxHashtags !== null && hashtags > config.maxHashtags) {
    warnings.push(
      `${hashtags} hashtags found; the maximum is ${config.maxHashtags}. Hashtags were preserved.`
    );
  }
  const count = countPlatformCharacters(text, platform);
  const overLimit = config.maxChars !== null && count > config.maxChars;
  if (overLimit && config.maxChars !== null) {
    warnings.push(
      `Over the ${config.label} limit by ${count - config.maxChars} characters. Nothing was truncated.`
    );
  }

  return {
    text,
    html,
    changes,
    warnings: [...new Set(warnings)],
    count,
    limit: config.maxChars,
    overLimit,
    images,
  };
}
