export type PlatformKey =
  | "LinkedIn"
  | "X (Twitter)"
  | "Instagram"
  | "Facebook"
  | "Blog/Website"
  | "Email";

export type ExportPlatformConfig = {
  key: PlatformKey;
  label: string;
  maxChars: number | null;
  countingRules: string[];
  linksClickable: boolean;
  supportsFormatting: boolean;
  maxHashtags: number | null;
  notes: string[];
  limitsVerifiedOn: string;
};

// Limits change; re-verify before demo
export const EXPORT_PLATFORMS: Record<PlatformKey, ExportPlatformConfig> = {
  LinkedIn: {
    key: "LinkedIn",
    label: "LinkedIn",
    maxChars: 3_000,
    countingRules: ["Grapheme count approximation"],
    linksClickable: true,
    supportsFormatting: false,
    maxHashtags: null,
    notes: [],
    limitsVerifiedOn: "2026-11-05",
  },
  "X (Twitter)": {
    key: "X (Twitter)",
    label: "X",
    maxChars: 280,
    countingRules: ["URLs count as 23 characters", "Grapheme count approximation"],
    linksClickable: true,
    supportsFormatting: false,
    maxHashtags: null,
    notes: [],
    limitsVerifiedOn: "2026-11-05",
  },
  Instagram: {
    key: "Instagram",
    label: "Instagram",
    maxChars: 2_200,
    countingRules: ["Grapheme count approximation"],
    linksClickable: false,
    supportsFormatting: false,
    maxHashtags: 30,
    notes: ["Links aren't clickable in Instagram captions"],
    limitsVerifiedOn: "2026-11-05",
  },
  Facebook: {
    key: "Facebook",
    label: "Facebook",
    maxChars: 63_206,
    countingRules: ["Grapheme count approximation"],
    linksClickable: true,
    supportsFormatting: false,
    maxHashtags: null,
    notes: [],
    limitsVerifiedOn: "2026-11-05",
  },
  "Blog/Website": {
    key: "Blog/Website",
    label: "Blog/Website",
    maxChars: null,
    countingRules: ["Grapheme count approximation"],
    linksClickable: true,
    supportsFormatting: true,
    maxHashtags: null,
    notes: [],
    limitsVerifiedOn: "2026-11-05",
  },
  Email: {
    key: "Email",
    label: "Email",
    maxChars: null,
    countingRules: ["Grapheme count approximation; subject recommendation is 60 characters"],
    linksClickable: true,
    supportsFormatting: true,
    maxHashtags: null,
    notes: ["Recommended subject length: 60 characters"],
    limitsVerifiedOn: "2026-11-05",
  },
};

export function isPlatformKey(value: unknown): value is PlatformKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(EXPORT_PLATFORMS, value)
  );
}
