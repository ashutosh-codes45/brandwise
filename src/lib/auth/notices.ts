export type NoticeType = "success" | "error";

export type AuthNotice = {
  message: string;
  type: NoticeType;
};

export const AUTH_NOTICES: Record<string, AuthNotice> = {
  check_email: {
    message: "Check your email to confirm, then log in.",
    type: "success",
  },
  invite_invalid: {
    message: "That invite code is invalid, expired or already used.",
    type: "error",
  },
  invite_required: {
    message: "An invite code is required to join an organisation.",
    type: "error",
  },
  signed_out: {
    message: "You have signed out.",
    type: "success",
  },
  account_created: {
    message: "Account created successfully.",
    type: "success",
  },
};

export function getAuthNotice(key: unknown): AuthNotice | null {
  if (
    typeof key === "string" &&
    Object.prototype.hasOwnProperty.call(AUTH_NOTICES, key)
  ) {
    return AUTH_NOTICES[key];
  }
  return null;
}
