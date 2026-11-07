// Deterministic platform-fit checks. Pure and client-safe: the review pipeline
// and the editor's live counters both call these helpers, which reuse the same
// conversion/counting modules as the export so the numbers always match.

import { EXPORT_PLATFORMS, isPlatformKey, type PlatformKey } from "@/lib/export/platforms";
import {
  countHashtags,
  countPlatformCharacters,
  findOverflowCutoff,
  hashtagPattern,
  urlPattern,
} from "@/lib/export/counting";
import { buildExportText } from "@/lib/export/text";
import type { ReviewFinding, VaultSource } from "./types";

export const PLATFORM_OVER_LIMIT_RULE_ID = "platform_over_limit";
export const PLATFORM_HASHTAG_RULE_ID = "platform_hashtags";
export const EMAIL_SUBJECT_RULE_ID = "email_subject_length";
export const PLATFORM_LINK_RULE_ID = "platform_link_not_clickable";
export const PLATFORM_NONE_RULE_ID = "platform_none_selected";

export const EMAIL_SUBJECT_RECOMMENDATION = 60;

export type PlatformCheckSection = {
  id: string;
  type: "text" | "image";
  body: string | null;
  alt_text: string | null;
  position?: number;
};

export type PlatformFitRow = {
  platform: PlatformKey;
  label: string;
  count: number;
  limit: number | null;
  over: boolean;
  hashtags: number;
  overflowSectionId: string | null;
};

export type PlatformCheckInput = {
  platforms: readonly string[];
  title: string;
  sections: readonly PlatformCheckSection[];
  guidelines?: readonly VaultSource[];
};

function buildFor(
  sections: readonly PlatformCheckSection[],
  platform: PlatformKey,
  sanitize?: (value: string) => string
) {
  const config = EXPORT_PLATFORMS[platform];
  return buildExportText(sections, config.supportsFormatting, { sanitize });
}

export function selectedPlatforms(values: readonly string[]): PlatformKey[] {
  const seen = new Set<PlatformKey>();
  for (const value of values) {
    if (isPlatformKey(value)) seen.add(value);
  }
  return [...seen];
}

export function platformKeyFromLabel(label: string): PlatformKey | null {
  for (const key of Object.keys(EXPORT_PLATFORMS) as PlatformKey[]) {
    if (EXPORT_PLATFORMS[key].label === label) return key;
  }
  return null;
}

/**
 * Derives the platform label stored on a platform finding's source_label.
 * Returns null for non-platform findings.
 */
export function platformLabelFromSource(sourceLabel: string | null): string | null {
  if (!sourceLabel) return null;
  let match: string | null = null;
  for (const key of Object.keys(EXPORT_PLATFORMS) as PlatformKey[]) {
    const label = EXPORT_PLATFORMS[key].label;
    if (sourceLabel === label || sourceLabel.startsWith(`${label} `)) {
      if (!match || label.length > match.length) match = label;
    }
  }
  return match;
}

/** Parses a hashtag maximum declared in a Vault guideline body, if any. */
export function parseHashtagLimit(value: string): number | null {
  const patterns = [
    /hashtags?[^.\n]{0,40}?(?:max(?:imum)?|limit|no more than|at most|up to)\D{0,12}(\d{1,3})/i,
    /(?:max(?:imum)?|limit|no more than|at most|up to)\D{0,12}(\d{1,3})\s*hashtags?/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function guidelineHashtagLimit(
  guidelines: readonly VaultSource[]
): number | null {
  let limit: number | null = null;
  for (const guideline of guidelines) {
    if (guideline.kind !== "guideline") continue;
    const parsed = parseHashtagLimit(guideline.body ?? "");
    if (parsed === null) continue;
    limit = limit === null ? parsed : Math.min(limit, parsed);
  }
  return limit;
}

function hashtagLimitFor(
  platformLimit: number | null,
  guidelineLimit: number | null
): number | null {
  if (platformLimit === null) return guidelineLimit ?? null;
  if (guidelineLimit === null) return platformLimit;
  return Math.min(platformLimit, guidelineLimit);
}

/** Expands a cut-off index back to the start of the sentence it sits in. */
export function findSentenceStart(text: string, cutoff: number): number {
  const before = text.slice(0, cutoff);
  let last = -1;
  for (const match of before.matchAll(/[.!?]\s+/gu)) {
    last = (match.index ?? 0) + match[0].length;
  }
  if (last >= 0) return last;
  const newline = before.lastIndexOf("\n");
  return newline >= 0 ? newline + 1 : 0;
}

function locateSection(
  parts: ReturnType<typeof buildExportText>["parts"],
  cutoff: number
): { id: string | null } | null {
  if (parts.length === 0) return null;
  const containing = parts.find((part) => cutoff < part.end) ?? parts[parts.length - 1];
  if (containing.type === "text") return containing;
  const textParts = parts.filter((part) => part.type === "text");
  const nearest =
    textParts.filter((part) => part.start <= cutoff).pop() ?? textParts[0];
  return nearest ?? containing;
}

function baseFinding(
  values: Pick<
    ReviewFinding,
    | "section_id"
    | "severity"
    | "excerpt"
    | "reason"
    | "source_label"
    | "suggestion"
    | "rule_id"
  >
): ReviewFinding {
  return {
    ...values,
    category: "platform",
    source_item_id: null,
    source_quote: null,
    origin: "rule",
    confidence: 1,
    suggestion_origin: "human",
    suggestion_kind: "manual",
    recommended_from_correction_id: null,
    note: null,
  };
}

export function runPlatformChecks(
  input: PlatformCheckInput,
  options: { sanitize?: (value: string) => string } = {}
): ReviewFinding[] {
  const platforms = selectedPlatforms(input.platforms);
  if (platforms.length === 0) {
    return [
      baseFinding({
        section_id: null,
        severity: "info",
        excerpt: "",
        reason: "Select the platforms to check platform limits.",
        source_label: null,
        suggestion: "Choose at least one platform in the editor, then run the review again.",
        rule_id: PLATFORM_NONE_RULE_ID,
      }),
    ];
  }

  const guidelineLimit = guidelineHashtagLimit(input.guidelines ?? []);
  const findings: ReviewFinding[] = [];

  for (const platform of platforms) {
    const config = EXPORT_PLATFORMS[platform];
    const built = buildFor(input.sections, platform, options.sanitize);
    const text = built.text;
    const count = countPlatformCharacters(text, platform);

    if (config.maxChars !== null && count > config.maxChars) {
      const max = config.maxChars;
      const cutoff = findOverflowCutoff(text, platform, max);
      const excerpt = text.slice(findSentenceStart(text, cutoff)).trim();
      const over = count - max;
      findings.push(
        baseFinding({
          section_id: locateSection(built.parts, cutoff)?.id ?? null,
          severity: "blocker",
          excerpt,
          reason: `${over.toLocaleString("en-US")} character${over === 1 ? "" : "s"} over the ${config.label} limit of ${max.toLocaleString("en-US")}`,
          source_label: `${config.label} limit (${max.toLocaleString("en-US")} characters, verified ${config.limitsVerifiedOn})`,
          suggestion: `Shorten this section so the ${config.label} text is ${max.toLocaleString("en-US")} characters or fewer.`,
          rule_id: PLATFORM_OVER_LIMIT_RULE_ID,
        })
      );
    }

    const hashtagLimit = hashtagLimitFor(config.maxHashtags, guidelineLimit);
    if (hashtagLimit !== null) {
      const hashtags = countHashtags(text);
      if (hashtags > hashtagLimit) {
        const matches = [...text.matchAll(hashtagPattern)];
        const firstExtra = matches[hashtagLimit];
        const extra = matches
          .slice(hashtagLimit)
          .map((match) => match[0])
          .join(" ");
        findings.push(
          baseFinding({
            section_id: locateSection(built.parts, firstExtra?.index ?? 0)?.id ?? null,
            severity: "fix",
            excerpt: extra.slice(0, 200),
            reason: `${hashtags} hashtags found; the maximum is ${hashtagLimit}. Hashtags were not changed.`,
            source_label:
              config.maxHashtags !== null && config.maxHashtags <= hashtagLimit
                ? `${config.label} hashtag limit (${hashtagLimit})`
                : `Hashtag guideline limit (${hashtagLimit})`,
            suggestion: `Remove ${hashtags - hashtagLimit} hashtag${hashtags - hashtagLimit === 1 ? "" : "s"} so no more than ${hashtagLimit} remain.`,
            rule_id: PLATFORM_HASHTAG_RULE_ID,
          })
        );
      }
    }

    const firstUrl = [...text.matchAll(urlPattern)][0]?.[0] ?? null;
    if (!config.linksClickable && (built.stats.links > 0 || firstUrl !== null)) {
      findings.push(
        baseFinding({
          section_id:
            locateSection(built.parts, firstUrl ? text.indexOf(firstUrl) : 0)?.id ?? null,
          severity: "info",
          excerpt: firstUrl ?? "",
          reason: `Links aren't clickable in ${config.label} captions.`,
          source_label: `${config.label} note`,
          suggestion: "Point readers to the link in your bio or another clickable channel.",
          rule_id: PLATFORM_LINK_RULE_ID,
        })
      );
    }

    if (platform === "Email") {
      const subjectCount = countPlatformCharacters(input.title, "Email");
      if (subjectCount > EMAIL_SUBJECT_RECOMMENDATION) {
        findings.push(
          baseFinding({
            section_id: null,
            severity: "fix",
            excerpt: "",
            reason: `The email subject is ${subjectCount.toLocaleString("en-US")} characters; the recommended maximum is ${EMAIL_SUBJECT_RECOMMENDATION}.`,
            source_label: `Email subject recommendation (${EMAIL_SUBJECT_RECOMMENDATION} characters)`,
            suggestion: `Shorten the title so the email subject is ${EMAIL_SUBJECT_RECOMMENDATION} characters or fewer.`,
            rule_id: EMAIL_SUBJECT_RULE_ID,
          })
        );
      }
    }
  }

  return findings;
}

export function summarizePlatformFit(
  sections: readonly PlatformCheckSection[],
  platformsValue: readonly string[],
  options: { sanitize?: (value: string) => string } = {}
): PlatformFitRow[] {
  return selectedPlatforms(platformsValue).map((platform) => {
    const config = EXPORT_PLATFORMS[platform];
    const built = buildFor(sections, platform, options.sanitize);
    const count = countPlatformCharacters(built.text, platform);
    const over = config.maxChars !== null && count > config.maxChars;
    const cutoff =
      over && config.maxChars !== null
        ? findOverflowCutoff(built.text, platform, config.maxChars)
        : null;
    return {
      platform,
      label: config.label,
      count,
      limit: config.maxChars,
      over,
      hashtags: countHashtags(built.text),
      overflowSectionId:
        cutoff === null ? null : locateSection(built.parts, cutoff)?.id ?? null,
    };
  });
}

export function formatPlatformCount(row: PlatformFitRow): string {
  const count = row.count.toLocaleString("en-US");
  if (row.limit === null) return `${count} characters (no limit)`;
  return `${count} / ${row.limit.toLocaleString("en-US")}`;
}

export function formatPlatformChip(row: PlatformFitRow): string {
  if (row.limit === null) return `${row.label} ${row.count} (no limit)`;
  return `${row.label} ${row.count}/${row.limit}`;
}

const figurePatterns = [
  /https?:\/\/[^\s<>"']+/giu,
  /[$€£¥₹]\s?\d[\d,.]*/gu,
  /\b\d[\d,]*(?:\.\d+)?\s?%/gu,
  /\b\d[\d,]*(?:\.\d+)?\b/gu,
];

function normalizeFigure(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s,]/gu, "").replace(/[$€£¥₹]/gu, "");
}

export function extractFigures(value: string): Set<string> {
  const found = new Set<string>();
  for (const pattern of figurePatterns) {
    for (const match of value.matchAll(pattern)) {
      found.add(normalizeFigure(match[0]));
    }
  }
  return found;
}

/** True when the suggestion contains a figure the original text never had. */
export function hasNewFigures(suggestion: string, original: string): boolean {
  const originalFigures = extractFigures(original);
  for (const figure of extractFigures(suggestion)) {
    if (!originalFigures.has(figure)) return true;
  }
  return false;
}

export type DiffToken = { value: string; removed: boolean };

function tokenizeForDiff(value: string): string[] {
  return value.split(/(\s+)/u).filter((token) => token.trim().length > 0);
}

/**
 * Marks each word of the original text that no longer appears in the updated
 * text, so the removed words can be shown in red.
 */
export function diffWords(original: string, updated: string): DiffToken[] {
  const remaining = new Map<string, number>();
  for (const token of tokenizeForDiff(updated)) {
    const key = token.toLocaleLowerCase();
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return tokenizeForDiff(original).map((token) => {
    const key = token.toLocaleLowerCase();
    const left = remaining.get(key) ?? 0;
    const removed = left <= 0;
    if (!removed) remaining.set(key, left - 1);
    return { value: token, removed };
  });
}
