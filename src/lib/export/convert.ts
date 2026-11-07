import sanitizeHtml from "sanitize-html";
import { EXPORT_PLATFORMS, type PlatformKey } from "./platforms";
import {
  countHashtags,
  countPlatformCharacters,
  findOverflowCutoff,
  graphemeCount,
} from "./counting";
import { buildExportText, getHref } from "./text";

export { countHashtags, countPlatformCharacters, findOverflowCutoff, graphemeCount };
export { buildExportText } from "./text";

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

const allowedTags = ["p", "br", "strong", "em", "ul", "ol", "li", "a"];
const allowedAttributes = { a: ["href", "target", "rel"] };

export function sanitizeExportHtml(source: string): string {
  return sanitizeHtml(source, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ["http", "https", "mailto"],
  });
}

const sanitize = sanitizeExportHtml;

function plainHtml(source: string): string {
  const sanitized = sanitize(source);
  return sanitized.replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
    const href = getHref(`<a${attributes}>`);
    const targetMatch = /\btarget\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(
      attributes
    );
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

export function convertApprovedSnapshot(
  sectionsValue: readonly ApprovedExportSection[],
  platform: PlatformKey
): ExportResult {
  const config = EXPORT_PLATFORMS[platform];
  const supportsFormatting = config.supportsFormatting;
  const warnings = [...config.notes];
  const changes: ChangeLogEntry[] = [];

  const built = buildExportText(sectionsValue, supportsFormatting, {
    sanitize,
    htmlBlock: ({ section, imageIndex, altText }) => {
      if (section.type === "image") {
        return supportsFormatting
          ? `<p><img src="{{IMAGE_${imageIndex}_URL}}" alt="${escapeHtml(altText)}"></p>`
          : null;
      }
      return supportsFormatting && (section.body ?? "").trim()
        ? plainHtml(section.body ?? "")
        : null;
    },
  });

  const images: ExportImage[] = built.images.map((image) => ({
    index: image.index,
    altText: image.altText,
    signedUrlPlaceholder: `{{IMAGE_${image.index}_URL}}`,
    imagePath: image.imagePath,
  }));
  for (const image of built.images) {
    if (image.emptyAlt) warnings.push(`Image ${image.index} has empty alt text.`);
  }

  const text = built.text;
  const html = supportsFormatting ? built.htmlBlocks.join("\n").trim() : undefined;
  const { formatting, listItems, expandedLinks, paragraphs } = built.stats;
  if (!supportsFormatting && formatting) {
    changes.push({
      description: `Removed bold/italic formatting (${formatting} places)`,
      count: formatting,
    });
  }
  if (!supportsFormatting && listItems) {
    changes.push({
      description: `Converted list items to plain-text bullets or numbering (${listItems} places)`,
      count: listItems,
    });
  }
  if (!supportsFormatting && expandedLinks) {
    changes.push({
      description: `Added URLs next to descriptive link text (${expandedLinks} places)`,
      count: expandedLinks,
    });
  }
  if (paragraphs) {
    changes.push({
      description: `Separated paragraphs with blank lines (${paragraphs} places)`,
      count: paragraphs,
    });
  }
  if (images.length && !supportsFormatting) {
    warnings.push("Attach images manually");
    changes.push({
      description: `Listed images for manual attachment (${images.length} places)`,
      count: images.length,
    });
  }
  if (platform === "Instagram" && built.stats.links) {
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
