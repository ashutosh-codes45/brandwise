import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/auth/current-member";
import { createClient } from "@/lib/supabase/server";

export const instant = false;

export default async function Home() {
  const member = await getCurrentMember();

  if (member) {
    redirect(member.role === "brand_manager" ? "/vault" : "/workspace");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error(error.message);
  }

  if (user) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      throw new Error(signOutError.message);
    }
  }

  redirect("/login");
}
