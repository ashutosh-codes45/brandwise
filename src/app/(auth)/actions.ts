"use server";

import { redirect } from "next/navigation";
import { isMemberRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const noMembershipMessage =
  "You haven't been added to an organisation yet. Ask your Brand Manager.";

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && emailPattern.test(value.trim());
}

function isPassword(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export async function signIn(
  email: unknown,
  password: unknown,
  selectedRole: unknown
): Promise<string | null> {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }
  if (!isPassword(password)) {
    return "Enter your password.";
  }
  if (!isMemberRole(selectedRole)) {
    return "Select a valid role.";
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
    const { error: signOutError } = await supabase.auth.signOut();
    return signOutError
      ? `${memberError.message} ${signOutError.message}`
      : memberError.message;
  }

  if (!member || !isMemberRole(member.role)) {
    const { error: signOutError } = await supabase.auth.signOut();
    return signOutError
      ? `${noMembershipMessage} ${signOutError.message}`
      : noMembershipMessage;
  }

  if (member.role !== selectedRole) {
    const { error: signOutError } = await supabase.auth.signOut();
    const mismatchMessage = `Your account role is ${member.role}, not ${selectedRole}.`;
    return signOutError
      ? `${mismatchMessage} ${signOutError.message}`
      : mismatchMessage;
  }

  redirect(member.role === "brand_manager" ? "/vault" : "/workspace");
}

export async function signUp(
  email: unknown,
  password: unknown,
  selectedRole: unknown,
  orgName?: unknown,
  inviteCode?: unknown
): Promise<string | null> {
  if (!isValidEmail(email)) {
    return "Enter a valid email address.";
  }
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  if (!isMemberRole(selectedRole)) {
    return "Select a valid role.";
  }

  const trimmedOrgName =
    typeof orgName === "string" ? orgName.trim() : "";
  if (selectedRole === "brand_manager" && !trimmedOrgName) {
    return "Enter an organisation name.";
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });

  if (error || !data.user) {
    return error?.message ?? "Unable to create your account.";
  }

  if (selectedRole === "brand_manager") {
    const { error: organisationError } = await supabase
      .from("organisations")
      .insert({ name: trimmedOrgName, created_by: data.user.id });

    if (organisationError) {
      return organisationError.message;
    }

    redirect("/vault");
  }

  const trimmedInviteCode =
    typeof inviteCode === "string" ? inviteCode.trim() : "";
  if (trimmedInviteCode) {
    const { error: inviteError } = await supabase.rpc("redeem_invite", {
      invite_code: trimmedInviteCode,
    });

    if (inviteError) {
      const { error: signOutError } = await supabase.auth.signOut();
      return signOutError
        ? `${inviteError.message} ${signOutError.message}`
        : inviteError.message;
    }

    redirect("/workspace");
  }

  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    return signOutError.message;
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Account created. Ask your Brand Manager to add you."
    )}`
  );
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login");
}
