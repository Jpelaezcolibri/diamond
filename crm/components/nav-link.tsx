"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-[#c9a24b]/15 text-[#c9a24b]" : "text-slate-300 hover:text-[#c9a24b]"
      }`}
    >
      {children}
    </Link>
  );
}
