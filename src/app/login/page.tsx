import { LoginForm } from "@/app/(auth)/login-form";

export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; message?: string; error?: string }>;
}) {
  const { notice, message, error } = await searchParams;
  // If notice is not provided, fall back to allowlisted keys or ignore unvalidated parameters
  const effectiveNotice = notice ?? (error ? undefined : message ? "account_created" : undefined);

  return <LoginForm initialNotice={effectiveNotice} />;
}
