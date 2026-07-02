"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-300 hover:border-[#c9a24b] hover:text-[#c9a24b]"
    >
      Salir
    </button>
  );
}
