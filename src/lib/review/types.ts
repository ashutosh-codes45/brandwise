import type { createClient } from "@/lib/supabase/server";

export type ReviewSection = {
  id: string;
  type: "text" | "image";
  body: string | null;
  alt_text: string | null;
  image_role: "logo" | "graphic" | "photo" | null;
  image_meta: import("@/lib/visual/analyze-image").ImageAnalysis | null;
  placed_background: string | null;
};

export type VaultSource = {
  id: string;
  kind: "guideline" | "fact" | "term" | "asset";
  title: string;
  body: string | null;
  tags: string[];
  valid_until: string | null;
  is_confidential: boolean;
  similarity: number;
  section_ids?: string[];
};

export type ReviewFinding = {
  section_id: string | null;
  category:
    | "claim"
    | "outdated"
    | "voice"
    | "terminology"
    | "visual"
    | "accessibility"
    | "platform";
  severity: "blocker" | "fix" | "info";
  excerpt: string;
  reason: string;
  source_item_id: string | null;
  source_label: string | null;
  source_quote: string | null;
  suggestion: string;
  origin: "rule" | "ai";
  rule_id: string | null;
  confidence: number | null;
  suggestion_origin: "ai" | "correction_history" | "human";
  suggestion_kind?: "text" | "manual";
  recommended_from_correction_id: string | null;
  note: string | null;
};

export type ReviewFindingEvent = {
  id: string;
  actor_type: string;
  event: string;
  prompt: string | null;
  before_text: string | null;
  after_text: string | null;
  note: string | null;
  created_at: string;
};

export type ReviewFindingState = {
  id: string;
  run_id: string | null;
  section_id: string | null;
  category: string;
  severity: string;
  excerpt: string | null;
  reason: string;
  source_item_id: string | null;
  source_label: string | null;
  source_quote: string | null;
  suggestion: string | null;
  status: string;
  dismiss_reason: string | null;
  origin: string | null;
  rule_id: string | null;
  confidence: number | null;
  suggestion_origin: string | null;
  suggestion_kind: "text" | "manual";
  recommended_from_correction_id: string | null;
  note: string | null;
  source: {
    kind: string;
    title: string;
    valid_until: string | null;
    is_confidential: boolean;
  } | null;
  events: ReviewFindingEvent[];
};

export type ReviewClient = Awaited<ReturnType<typeof createClient>>;

export function plainReviewSection(section: ReviewSection): string {
  if (section.type === "image") {
    return "";
  }
  return section.body ?? "";
}
