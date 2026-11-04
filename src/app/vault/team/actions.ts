"use server";

import { revalidatePath } from "next/cache";
import { isMemberRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManagerContext =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      orgId: string;
      userId: string;
    };

async function getManagerContext(): Promise<ManagerContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return { ok: false, error: userError.message } as const;
  }
  if (!user) {
    return { ok: false, error: "Sign in to manage your team." } as const;
  }

  const { data: membership, error: membershipError } = await supabase
    .from("members")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("role", "brand_manager")
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return { ok: false, error: membershipError.message } as const;
  }
  if (!membership) {
    return {
      ok: false,
      error: "Only a Brand Manager can manage team access.",
    } as const;
  }

  return {
    ok: true,
    supabase,
    orgId: membership.org_id,
    userId: user.id,
  } as const;
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && emailPattern.test(value.trim());
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isInviteRole(value: unknown): value is "creator" | "reviewer" {
  return value === "creator" || value === "reviewer";
}

export async function addByEmail(
  email: unknown,
  role: unknown
): Promise<string | null> {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }
  if (!isMemberRole(role)) {
    return "Select a valid member role.";
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return context.error;
  }

  const { error } = await context.supabase.rpc("add_member_by_email", {
    org: context.orgId,
    member_email: email.trim(),
    member_role: role,
  });

  if (error) {
    return error.message;
  }

  revalidatePath("/vault/team");
  return null;
}

export async function changeRole(
  userId: unknown,
  role: unknown
): Promise<string | null> {
  if (!isValidId(userId)) {
    return "Select a valid team member.";
  }
  if (!isMemberRole(role)) {
    return "Select a valid member role.";
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return context.error;
  }

  const { data: updatedMember, error } = await context.supabase
    .from("members")
    .update({ role })
    .eq("org_id", context.orgId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    return error.message;
  }
  if (!updatedMember) {
    return "Team member not found.";
  }

  revalidatePath("/vault/team");
  return null;
}

export async function removeMember(userId: unknown): Promise<string | null> {
  if (!isValidId(userId)) {
    return "Select a valid team member.";
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return context.error;
  }
  if (userId === context.userId) {
    return "You cannot remove your own account.";
  }

  const { data: removedMember, error } = await context.supabase
    .from("members")
    .delete()
    .eq("org_id", context.orgId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();

  if (error) {
    return error.message;
  }
  if (!removedMember) {
    return "Team member not found.";
  }

  revalidatePath("/vault/team");
  return null;
}

export async function createInvite(
  role: unknown
): Promise<{ error: string } | { code: string; expiresAt: string }> {
  if (!isInviteRole(role)) {
    return { error: "Invite codes can only be created for Creators or Reviewers." };
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return { error: context.error };
  }

  const { data: code, error: inviteError } = await context.supabase.rpc(
    "create_invite",
    {
      org: context.orgId,
      invite_role: role,
    }
  );

  if (inviteError) {
    return { error: inviteError.message };
  }
  if (typeof code !== "string") {
    return { error: "The invite code could not be created." };
  }

  const { data: invite, error: lookupError } = await context.supabase
    .from("invites")
    .select("expires_at")
    .eq("org_id", context.orgId)
    .eq("code", code)
    .maybeSingle();

  if (lookupError) {
    return { error: lookupError.message };
  }
  if (!invite) {
    return { error: "Invite code was created, but its expiry could not be loaded." };
  }

  revalidatePath("/vault/team");
  return { code, expiresAt: invite.expires_at };
}

export async function deleteInvite(inviteId: unknown): Promise<string | null> {
  if (!isValidId(inviteId)) {
    return "Select a valid invite.";
  }

  const context = await getManagerContext();
  if (!context.ok) {
    return context.error;
  }

  const { data: invite, error } = await context.supabase
    .from("invites")
    .delete()
    .eq("id", inviteId)
    .eq("org_id", context.orgId)
    .is("used_by", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return error.message;
  }
  if (!invite) {
    return "Invite not found or it has already been used.";
  }

  revalidatePath("/vault/team");
  return null;
}
