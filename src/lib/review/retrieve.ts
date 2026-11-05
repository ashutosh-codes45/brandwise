import "server-only";

import { embed } from "@/lib/ai/provider";
import { htmlToText } from "@/lib/html-to-text";
import type { ReviewClient, ReviewSection, VaultSource } from "./types";

export type RetrievedSource = VaultSource & {
  section_ids: string[];
};

export async function retrieveVaultSources(
  supabase: ReviewClient,
  orgId: string,
  sections: ReviewSection[]
): Promise<{
  sources: RetrievedSource[];
  trace: Array<{ section_id: string; items: Array<{ id: string; similarity: number }> }>;
}> {
  const textSections = sections
    .filter((section) => section.type === "text")
    .map((section) => ({
      id: section.id,
      text: htmlToText(section.body ?? "").slice(0, 6_000),
    }))
    .filter((section) => section.text.length > 0);

  if (textSections.length === 0) {
    return { sources: [], trace: [] };
  }

  const vectors = await embed(
    textSections.map((section) => section.text),
    "RETRIEVAL_QUERY"
  );
  const sourceMap = new Map<string, RetrievedSource>();
  const trace: Array<{
    section_id: string;
    items: Array<{ id: string; similarity: number }>;
  }> = [];

  for (const [index, section] of textSections.entries()) {
    const { data, error } = await supabase.rpc("match_vault_items", {
      org: orgId,
      query_embedding: `[${vectors[index].join(",")}]`,
      match_count: 6,
      min_similarity: 0.55,
    });

    if (error) {
      throw new Error(`Vault retrieval failed: ${error.message}`);
    }

    const sectionSources = (data ?? []) as Array<
      VaultSource & { similarity: number }
    >;
    trace.push({
      section_id: section.id,
      items: sectionSources.map((source) => ({
        id: source.id,
        similarity: source.similarity,
      })),
    });

    for (const source of sectionSources) {
      const existing = sourceMap.get(source.id);
      if (existing) {
        existing.similarity = Math.max(existing.similarity, source.similarity);
        if (!existing.section_ids.includes(section.id)) {
          existing.section_ids.push(section.id);
        }
      } else {
        sourceMap.set(source.id, {
          ...source,
          section_ids: [section.id],
        });
      }
    }
  }

  return { sources: [...sourceMap.values()], trace };
}
