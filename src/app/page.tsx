import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";

export const instant = false;

export default async function Home() {
  const { user, membership } = await getSessionContext();

  if (!user) {
    redirect("/login");
  }

  if (!membership) {
    redirect("/onboarding");
  }

  redirect(
    membership.role === "brand_manager"
      ? "/vault"
      : membership.role === "reviewer"
        ? "/review"
        : "/workspace"
  );
}
