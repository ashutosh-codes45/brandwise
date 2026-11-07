import { SignupForm } from "@/app/(auth)/signup-form";

export const instant = false;

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;

  return <SignupForm initialNotice={notice} />;
}
