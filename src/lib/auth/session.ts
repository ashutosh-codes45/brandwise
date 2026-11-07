import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { isMemberRole, type MemberRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export type Membership = {
  org_id: string;
  role: MemberRole;
};

export type SessionContext = {
  user: User | null;
  membership: Membership | null;
};

export async function getSessionContext(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { user: null, membership: null };
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (memberError || !member || !isMemberRole(member.role)) {
    return { user, membership: null };
  }

  return {
    user,
    membership: {
      org_id: member.org_id,
      role: member.role,
    },
  };
}

export async function requireMember(): Promise<{
  user: User;
  membership: Membership;
}> {
  const { user, membership } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (!membership) {
    redirect("/onboarding");
  }

  return { user, membership };
}
