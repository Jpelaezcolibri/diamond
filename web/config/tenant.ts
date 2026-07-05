import { TenantConfigSchema, type TenantConfig } from "./tenant-schema";
import { tenants } from "./tenants";

let cached: TenantConfig | null = null;

/**
 * Config del tenant activo, resuelta por TENANT_ID (default "diamond") y
 * validada con Zod una sola vez por proceso. Una config invalida lanza en
 * build/arranque — nunca llega a produccion.
 */
export function getTenantConfig(): TenantConfig {
  if (cached) return cached;

  const id = process.env.TENANT_ID ?? "diamond";
  const raw = tenants[id];
  if (!raw) {
    throw new Error(
      `[REF] TENANT_ID="${id}" no existe. Tenants registrados: ${Object.keys(tenants).join(", ")}`
    );
  }

  const parsed = TenantConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`[REF] Config del tenant "${id}" invalida:\n${parsed.error.toString()}`);
  }

  cached = parsed.data;
  return cached;
}
