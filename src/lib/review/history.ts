import "server-only";

import { embed } from "@/lib/ai/provider";
import type { ReviewClient, ReviewFinding } from "./types";

export async function addCorrectionRecommendations(
  supabase: ReviewClient,
  orgId: string,
  findings: ReviewFinding[]
): Promise<ReviewFinding[]> {
  if (findings.length === 0) {
    return [];
  }
  const vectors = await embed(
    findings.map((finding) => `${finding.category}: ${finding.excerpt}`),
    "RETRIEVAL_QUERY"
  );
  const result: ReviewFinding[] = [];

  for (const [index, finding] of findings.entries()) {
    const { data, error } = await supabase.rpc("match_corrections", {
      org: orgId,
      query_embedding: `[${vectors[index].join(",")}]`,
      category: finding.category,
      match_count: 1,
      min_similarity: 0.8,
    });
    if (error) {
      throw new Error(`Correction history lookup failed: ${error.message}`);
    }

    const recommendation = data?.[0];
    if (!recommendation) {
      result.push(finding);
      continue;
    }

    const text = recommendation.final_text || recommendation.suggested_text;
    if (!text) {
      result.push(finding);
      continue;
    }

    result.push({
      ...finding,
      suggestion: text,
      suggestion_origin: "correction_history",
      recommended_from_correction_id: recommendation.id,
      note: "Recommended because you fixed a similar issue before",
    });
  }

  return result;
}
