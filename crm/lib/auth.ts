import type { User } from "@supabase/supabase-js";

export function isSuperAdmin(user: User | null | undefined): boolean {
  return (user?.app_metadata as { role?: string } | undefined)?.role === "super_admin";
}
