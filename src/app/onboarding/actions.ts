"use server";

import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function createOrganisation(
  name: unknown
): Promise<string | null> {
  const { user, membership } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (membership) {
    return "You already belong to an organisation.";
  }

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (trimmedName.length < 2 || trimmedName.length > 80) {
    return "Organisation name must be between 2 and 80 characters.";
  }

  const supabase = await createClient();

  // IMPORTANT: Do NOT chain .select() on the organisations insert
  const { error: insertError } = await supabase
    .from("organisations")
    .insert({ name: trimmedName, created_by: user.id });

  if (insertError) {
    return insertError.message;
  }

  // Confirm membership created by trigger
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (memberError || !member) {
    return "Organisation created, but membership could not be verified. Please refresh.";
  }

  redirect("/vault");
}

export async function joinWithInvite(
  inviteCode: unknown
): Promise<string | null> {
  const { user, membership } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (membership) {
    return "You already belong to an organisation.";
  }

  const trimmedCode =
    typeof inviteCode === "string" ? inviteCode.trim().toUpperCase() : "";

  if (!trimmedCode) {
    return "Enter an invite code.";
  }

  const supabase = await createClient();
  const { data: role, error: rpcError } = await supabase.rpc("redeem_invite", {
    invite_code: trimmedCode,
  });

  if (rpcError) {
    return "That invite code is invalid, expired or already used.";
  }

  if (role === "reviewer") {
    redirect("/review");
  } else {
    redirect("/workspace");
  }
}
