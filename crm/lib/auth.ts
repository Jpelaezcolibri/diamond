import type { User } from "@supabase/supabase-js";

export type Role = "admin" | "asesor_ventas" | "asesor_arrendamientos" | "asesor_vehiculos" | "asesor_otros";

export const ROLES: { value: Role; label: string; especialidad: string | null }[] = [
  { value: "admin", label: "Admin", especialidad: null },
  { value: "asesor_ventas", label: "Asesor de ventas", especialidad: "venta" },
  { value: "asesor_arrendamientos", label: "Asesor de arrendamientos", especialidad: "arriendo" },
  { value: "asesor_vehiculos", label: "Asesor de vehículos", especialidad: "vehiculos" },
  { value: "asesor_otros", label: "Asesor de otros", especialidad: "otro" },
];

function metaRole(user: User | null | undefined): string {
  return (user?.app_metadata as { role?: string } | undefined)?.role || "asesor_otros";
}

// "super_admin" se mantiene por compatibilidad con cuentas creadas antes de este cambio.
export function isAdmin(user: User | null | undefined): boolean {
  const role = metaRole(user);
  return role === "admin" || role === "super_admin";
}

export function userRole(user: User | null | undefined): Role {
  const role = metaRole(user);
  if (role === "super_admin") return "admin";
  if (ROLES.some((r) => r.value === role)) return role as Role;
  return "asesor_otros"; // cuentas legacy con role "asesor" sin especialidad
}

export function roleLabel(role: string): string {
  return ROLES.find((r) => r.value === role)?.label || role;
}

export function roleEspecialidad(role: string): string | null {
  return ROLES.find((r) => r.value === role)?.especialidad ?? null;
}

export function userNombre(user: User | null | undefined): string {
  return (user?.app_metadata as { nombre?: string } | undefined)?.nombre || user?.email || "Usuario";
}
