import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { OnboardingView } from "./onboarding-view";

export const instant = false;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { user, membership } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (membership) {
    redirect(
      membership.role === "brand_manager"
        ? "/vault"
        : membership.role === "reviewer"
          ? "/review"
          : "/workspace"
    );
  }

  const { notice } = await searchParams;

  return (
    <OnboardingView initialNotice={notice} userEmail={user.email ?? ""} />
  );
}
