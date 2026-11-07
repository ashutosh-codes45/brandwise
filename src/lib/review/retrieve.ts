import "server-only";

import { createHash } from "node:crypto";
import { embed } from "@/lib/ai/provider";
import { htmlToText } from "@/lib/html-to-text";
import type { ReviewClient, ReviewSection, VaultSource } from "./types";

export type RetrievedSource = VaultSource & {
  section_ids: string[];
};

type RetrievalTraceItem = {
  id: string;
  similarity: number;
};

type RetrievalTraceEntry = {
  section_id: string;
  text_hash: string;
  items: RetrievalTraceItem[];
};

function parsePreviousTrace(value: unknown): RetrievalTraceEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): RetrievalTraceEntry[] => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("section_id" in entry) ||
      typeof entry.section_id !== "string" ||
      !("text_hash" in entry) ||
      typeof entry.text_hash !== "string" ||
      !("items" in entry) ||
      !Array.isArray(entry.items)
    ) {
      return [];
    }
    const items = entry.items.flatMap((item: unknown): RetrievalTraceItem[] => {
      if (
        typeof item !== "object" ||
        item === null ||
        !("id" in item) ||
        typeof item.id !== "string" ||
        !("similarity" in item) ||
        typeof item.similarity !== "number"
      ) {
        return [];
      }
      return [{ id: item.id, similarity: item.similarity }];
    });
    return [{ section_id: entry.section_id, text_hash: entry.text_hash, items }];
  });
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function retrieveVaultSources(
  supabase: ReviewClient,
  orgId: string,
  sections: ReviewSection[],
  previousTrace?: unknown,
  embedTexts: typeof embed = embed
): Promise<{
  sources: RetrievedSource[];
  trace: RetrievalTraceEntry[];
  retrievalMode: "vector" | "text_search";
}> {
  const textSections = sections
    .filter((section) => section.type === "text")
    .map((section) => ({
      id: section.id,
      text: htmlToText(section.body ?? "").slice(0, 6_000),
    }))
    .filter((section) => section.text.length > 0);

  if (textSections.length === 0) {
    return { sources: [], trace: [], retrievalMode: "vector" };
  }

  const previousBySection = new Map(
    parsePreviousTrace(previousTrace).map((entry) => [entry.section_id, entry])
  );
  const previousForText = textSections.map((section) => {
    const previous = previousBySection.get(section.id);
    return previous?.text_hash === hashText(section.text) ? previous : undefined;
  });
  const cachedIds = [
    ...new Set(
      previousForText.flatMap((entry) => entry?.items.map((item) => item.id) ?? [])
    ),
  ];
  const { data: cachedData, error: cachedError } =
    cachedIds.length > 0
      ? await supabase
          .from("vault_items")
          .select("id, kind, title, body, tags, valid_until, is_confidential")
          .eq("org_id", orgId)
          .in("id", cachedIds)
      : { data: [], error: null };
  if (cachedError) {
    throw new Error(`Could not load cached Vault items: ${cachedError.message}`);
  }
  const cachedSources = new Map(
    (cachedData ?? []).map((source) => [source.id, source])
  );
  const reusableItems = previousForText.map((entry) => {
    if (!entry || entry.items.length === 0) {
      return undefined;
    }
    const sources = entry.items.flatMap((item): RetrievedSource[] => {
      const source = cachedSources.get(item.id);
      return source
        ? [{ ...source, similarity: item.similarity, section_ids: [] }]
        : [];
    });
    return sources.length === entry.items.length ? sources : undefined;
  });
  const vectorsByHash = new Map<string, number[]>();
  const sectionsToEmbed = textSections.filter((_, index) => !reusableItems[index]);
  const uniqueTexts = [
    ...new Map(
      sectionsToEmbed.map((section) => [hashText(section.text), section.text])
    ).values(),
  ];
  let embedded: number[][];
  try {
    embedded = await embedTexts(uniqueTexts, "RETRIEVAL_QUERY");
  } catch (embedError) {
    const sourceMap = new Map<string, RetrievedSource>();
    for (const section of textSections) {
      const { data, error } = await supabase.rpc("search_vault_text", {
        org: orgId,
        q: section.text,
        match_count: 6,
      });
      if (error) {
        const embedMessage =
          embedError instanceof Error ? embedError.message : "Embedding failed.";
        throw new Error(
          `${embedMessage} Text-search fallback failed: ${error.message}`
        );
      }
      for (const source of (data ?? []) as VaultSource[]) {
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
    return {
      sources: [...sourceMap.values()],
      trace: [],
      retrievalMode: "text_search",
    };
  }
  uniqueTexts.forEach((text, index) => {
    vectorsByHash.set(hashText(text), embedded[index]);
  });
  const sourceMap = new Map<string, RetrievedSource>();
  const trace: RetrievalTraceEntry[] = [];

  for (const [index, section] of textSections.entries()) {
    const cached = reusableItems[index];
    let sectionSources: RetrievedSource[];
    if (cached) {
      sectionSources = cached;
    } else {
      const vector = vectorsByHash.get(hashText(section.text));
      if (!vector) {
        throw new Error("Embedding response did not include every review section.");
      }
      const { data, error } = await supabase.rpc("match_vault_items", {
        org: orgId,
        query_embedding: `[${vector.join(",")}]`,
        match_count: 6,
        min_similarity: 0.55,
      });

      if (error) {
        throw new Error(`Vault retrieval failed: ${error.message}`);
      }

      sectionSources = ((data ?? []) as VaultSource[]).map((source) => ({
        ...source,
        section_ids: [],
      }));
    }

    const hash = hashText(section.text);
    trace.push({
      section_id: section.id,
      text_hash: hash,
      items: sectionSources.map(({ id, similarity }) => ({ id, similarity })),
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

  return {
    sources: [...sourceMap.values()],
    trace,
    retrievalMode: "vector",
  };
}
