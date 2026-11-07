"use server";

import { redirect } from "next/navigation";
import { isMemberRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && emailPattern.test(value.trim());
}

function isPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function signIn(
  email: unknown,
  password: unknown
): Promise<string | null> {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }
  if (!isPassword(password)) {
    return "Enter your password.";
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return error?.message ?? "Unable to sign in.";
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", data.user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    return memberError.message;
  }

  if (!member || !isMemberRole(member.role)) {
    redirect("/onboarding");
  }

  redirect(
    member.role === "brand_manager"
      ? "/vault"
      : member.role === "reviewer"
        ? "/review"
        : "/workspace"
  );
}

export async function signUp(
  email: unknown,
  password: unknown,
  pathType: unknown,
  inviteCode?: unknown
): Promise<string | null> {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (pathType !== "create" && pathType !== "join") {
    return "Select whether to create a new workspace or join with an invite code.";
  }

  const trimmedInviteCode =
    typeof inviteCode === "string" ? inviteCode.trim().toUpperCase() : "";

  if (pathType === "join") {
    if (!trimmedInviteCode) {
      return "Enter an invite code.";
    }
    if (!/^[A-Z0-9]{8}$/.test(trimmedInviteCode)) {
      return "Enter a valid 8-character invite code.";
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return error?.message ?? "Unable to create your account.";
  }

  // If email confirmation is ON and signUp returns no session
  if (!data.session) {
    redirect("/login?notice=check_email");
  }

  if (pathType === "create") {
    redirect("/onboarding");
  }

  // Path "join"
  const { data: role, error: inviteError } = await supabase.rpc("redeem_invite", {
    invite_code: trimmedInviteCode,
  });

  if (inviteError) {
    // Keep the account, do not sign out
    redirect("/onboarding?notice=invite_invalid");
  }

  if (role === "reviewer") {
    redirect("/review");
  } else {
    redirect("/workspace");
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?notice=signed_out");
}
