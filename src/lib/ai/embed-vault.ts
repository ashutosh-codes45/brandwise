import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { embed } from "./provider";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type VaultEmbeddingInput = {
  id: string;
  title: string;
  tags: string[];
  body: string | null;
};

function embeddingText(item: VaultEmbeddingInput): string {
  return [
    `Title: ${item.title}`,
    `Tags: ${item.tags.join(", ")}`,
    item.body ? `Body: ${item.body}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6_000);
}

export async function embedVaultItems(
  supabase: SupabaseClient,
  items: VaultEmbeddingInput[],
  orgId: string
): Promise<void> {
  const vectors = await embed(items.map(embeddingText));

  for (const [index, item] of items.entries()) {
    const { error } = await supabase
      .from("vault_items")
      .update({ embedding: vectors[index] })
      .eq("id", item.id)
      .eq("org_id", orgId);

    if (error) {
      throw new Error(error.message);
    }
  }
}
