import { LoginForm } from "@/app/(auth)/login-form";

export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const { message, error } = await searchParams;

  return <LoginForm message={message} initialError={error} />;
}
