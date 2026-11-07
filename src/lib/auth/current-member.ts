import { getSessionContext } from "@/lib/auth/session";
import type { MemberRole } from "@/lib/auth/roles";

export async function getCurrentMember(): Promise<{
  email: string;
  orgId: string;
  role: MemberRole;
  userId: string;
} | null> {
  const { user, membership } = await getSessionContext();

  if (!user || !membership) {
    return null;
  }

  return {
    email: user.email ?? "",
    orgId: membership.org_id,
    role: membership.role,
    userId: user.id,
  };
}
