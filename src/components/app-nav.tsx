import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import type { MemberRole } from "@/lib/auth/roles";

export function AppNav({
  member,
}: {
  member: { email: string; role: MemberRole };
}) {
  const links =
    member.role === "brand_manager"
      ? [
          { href: "/vault", label: "Vault" },
          { href: "/review", label: "Review queue" },
          { href: "/workspace", label: "Workspace" },
        ]
      : member.role === "reviewer"
        ? [
            { href: "/review", label: "Review queue" },
            { href: "/workspace", label: "Workspace" },
          ]
        : [{ href: "/workspace", label: "Workspace" }];

  return (
    <nav className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link className="font-semibold tracking-tight text-zinc-900" href="/">
          BrandWise
        </Link>
        {links.map((link) => (
          <Link
            className="text-sm font-medium text-zinc-600 hover:text-indigo-700"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-zinc-500 sm:inline">
          {member.email} · {member.role.replace("_", " ")}
        </span>
        <form action={signOut}>
          <button className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
