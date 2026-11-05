import "server-only";

import { htmlToText } from "@/lib/html-to-text";
import type { JudgeFinding } from "./judge";
import type { ReviewFinding, ReviewSection, VaultSource } from "./types";

export type FilterStats = {
  raised: number;
  dropped: number;
  drop_reasons: Record<string, number>;
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function filterAiFindings(
  candidates: JudgeFinding[],
  sections: ReviewSection[],
  sources: VaultSource[],
  ruleFindings: ReviewFinding[]
): { findings: ReviewFinding[]; stats: FilterStats } {
  const sectionMap = new Map(
    sections.map((section) => [
      section.id,
      section.type === "text" ? section.body ?? "" : "",
    ])
  );
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const ruleKeys = new Set(
    ruleFindings.map(
      (finding) =>
        `${finding.section_id}:${normalized(finding.excerpt)}`
    )
  );
  const findings: ReviewFinding[] = [];
  const drop_reasons: Record<string, number> = {};

  function drop(reason: string) {
    drop_reasons[reason] = (drop_reasons[reason] ?? 0) + 1;
  }

  for (const candidate of candidates) {
    const text = sectionMap.get(candidate.section_id);
    if (text === undefined) {
      drop("unknown_section");
      continue;
    }

    const source = sourceMap.get(candidate.source_item_id);
    if (!source) {
      drop("missing_source");
      continue;
    }
    if (!source.section_ids?.includes(candidate.section_id)) {
      drop("source_not_retrieved_for_section");
      continue;
    }

    const plainText = htmlToText(text);
    if (!plainText.includes(candidate.excerpt)) {
      drop("excerpt_not_found");
      continue;
    }
    if (!source.body?.includes(candidate.source_quote)) {
      drop("source_quote_not_found");
      continue;
    }
    if (candidate.confidence < 0.5) {
      drop("low_confidence");
      continue;
    }
    if (
      ruleKeys.has(
        `${candidate.section_id}:${normalized(candidate.excerpt)}`
      )
    ) {
      drop("duplicate_rule_finding");
      continue;
    }

    findings.push({
      section_id: candidate.section_id,
      category: candidate.category,
      severity: candidate.severity,
      excerpt: candidate.excerpt,
      reason: candidate.reason,
      source_item_id: source.id,
      source_label: source.title,
      source_quote: source.is_confidential ? null : candidate.source_quote,
      suggestion: candidate.suggestion,
      origin: "ai",
      rule_id: null,
      confidence: candidate.confidence,
      suggestion_origin: "ai",
      recommended_from_correction_id: null,
      note: null,
    });
  }

  const dropped = Object.values(drop_reasons).reduce(
    (sum, count) => sum + count,
    0
  );
  return {
    findings,
    stats: {
      raised: findings.length,
      dropped,
      drop_reasons,
    },
  };
}
