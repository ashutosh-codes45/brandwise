import "server-only";

import { brandKitSchema } from "./brand-kit";
import { createClient } from "@/lib/supabase/server";

export async function getBrandKit(orgId: string): Promise<{
  id: string;
  kit: ReturnType<typeof brandKitSchema.parse>;
  body: string;
} | null> {
  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("vault_items")
    .select("id, structured, body")
    .eq("org_id", orgId)
    .contains("tags", ["brand-kit"])
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the Brand kit: ${error.message}`);
  }
  if (!item) {
    return null;
  }

  const parsed = brandKitSchema.safeParse(item.structured);
  if (!parsed.success) {
    throw new Error("The saved Brand kit is invalid. Ask a Brand Manager to update it.");
  }
  return { id: item.id, kit: parsed.data, body: item.body ?? "" };
}
