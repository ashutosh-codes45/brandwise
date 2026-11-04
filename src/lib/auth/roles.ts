export const memberRoles = ["brand_manager", "creator", "reviewer"] as const;

export type MemberRole = (typeof memberRoles)[number];

export function isMemberRole(value: unknown): value is MemberRole {
  return (
    typeof value === "string" &&
    memberRoles.some((memberRole) => memberRole === value)
  );
}
