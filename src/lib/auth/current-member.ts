import { createClient } from "@/lib/supabase/server";
import { isMemberRole, type MemberRole } from "@/lib/auth/roles";

export async function getCurrentMember(): Promise<{
  email: string;
  orgId: string;
  role: MemberRole;
  userId: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  if (!user) {
    return null;
  }

  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (memberError) {
    throw new Error(memberError.message);
  }

  if (!member || !isMemberRole(member.role)) {
    return null;
  }

  return {
    email: user.email ?? "",
    orgId: member.org_id,
    role: member.role,
    userId: user.id,
  };
}
