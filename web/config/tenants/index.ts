import type { TenantConfigInput } from "../tenant-schema";
import { diamond } from "./diamond";
import { demo } from "./demo";

/** Registro de tenants disponibles. La clave es el valor valido de TENANT_ID. */
export const tenants: Record<string, TenantConfigInput> = {
  diamond,
  demo,
};
