// Client-safe HTML-to-plain-text conversion for export. The sanitizing step is
// injected so the server export can clean untrusted HTML while the editor can
// reuse the exact same conversion on its own trusted draft.

export type ExportTextSection = {
  id?: string;
  type: "text" | "image";
  body: string | null;
  alt_text: string | null;
  image_path?: string | null;
  position?: number;
};

export type ParsedText = {
  text: string;
  links: number;
  expandedLinks: number;
  formatting: number;
  listItems: number;
  paragraphs: number;
};

export type ExportTextImage = {
  index: number;
  altText: string;
  imagePath: string | null;
  emptyAlt: boolean;
};

export type ExportTextPart = {
  id: string | null;
  type: "text" | "image";
  index: number;
  text: string;
  start: number;
  end: number;
};

export type BuildExportTextOptions = {
  sanitize?: (value: string) => string;
  htmlBlock?: (context: {
    section: ExportTextSection;
    imageIndex: number;
    altText: string;
  }) => string | null;
};

export type BuiltExportText = {
  text: string;
  parts: ExportTextPart[];
  images: ExportTextImage[];
  htmlBlocks: string[];
  stats: {
    links: number;
    expandedLinks: number;
    formatting: number;
    listItems: number;
    paragraphs: number;
  };
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function getTagName(tag: string): string {
  const match = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(tag);
  return match ? `${match[1]}${match[2].toLowerCase()}` : "";
}

export function getHref(tag: string): string {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

export function parsePlainText(
  source: string,
  includeLinkTargets: boolean
): ParsedText {
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

  for (const token of source.split(/(<[^>]+>)/g).filter(Boolean)) {
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

export function buildExportText(
  sections: readonly ExportTextSection[],
  supportsFormatting: boolean,
  options: BuildExportTextOptions = {}
): BuiltExportText {
  const sanitize = options.sanitize ?? ((value: string) => value);
  const ordered = [...sections].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  const parts: ExportTextPart[] = [];
  const images: ExportTextImage[] = [];
  const htmlBlocks: string[] = [];
  const stats = {
    links: 0,
    expandedLinks: 0,
    formatting: 0,
    listItems: 0,
    paragraphs: 0,
  };
  let cursor = 0;
  let imageIndex = 0;

  const pushPart = (section: ExportTextSection, text: string) => {
    if (!text) return;
    if (cursor > 0) cursor += 2;
    parts.push({
      id: section.id ?? null,
      type: section.type === "image" ? "image" : "text",
      index: imageIndex,
      text,
      start: cursor,
      end: cursor + text.length,
    });
    cursor += text.length;
  };

  for (const section of ordered) {
    if (section.type === "image") {
      imageIndex += 1;
      const altText = (section.alt_text ?? "").trim();
      images.push({
        index: imageIndex,
        altText,
        imagePath: section.image_path ?? null,
        emptyAlt: !altText,
      });
      const html = options.htmlBlock?.({ section, imageIndex, altText });
      if (html) htmlBlocks.push(html);
      pushPart(section, altText ? `[Image ${imageIndex}: ${altText}]` : "");
      continue;
    }

    const parsed = parsePlainText(
      sanitize(section.body ?? ""),
      !supportsFormatting
    );
    stats.links += parsed.links;
    stats.expandedLinks += parsed.expandedLinks;
    stats.formatting += parsed.formatting;
    stats.listItems += parsed.listItems;
    stats.paragraphs += parsed.paragraphs;
    const html = options.htmlBlock?.({ section, imageIndex, altText: "" });
    if (html) htmlBlocks.push(html);
    pushPart(section, parsed.text);
  }

  return {
    text: parts.map((part) => part.text).join("\n\n"),
    parts,
    images,
    htmlBlocks,
    stats,
  };
}
