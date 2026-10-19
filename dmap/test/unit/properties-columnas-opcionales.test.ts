import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetColumnasAusentes, columnaFaltanteDe, conColumnasOpcionales } from "../../src/repositories/properties.repo.js";

// Sin la migracion 2026-10-19_periodo_precio.sql la base no conoce la
// columna. El sync tiene que seguir funcionando igual que antes.
const ERROR_POSTGREST = "Could not find the 'periodo_precio' column of 'properties' in the schema cache";

describe("conColumnasOpcionales", () => {
  beforeEach(() => _resetColumnasAusentes());

  it("reconoce el error de columna faltante", () => {
    expect(columnaFaltanteDe(ERROR_POSTGREST)).toBe("periodo_precio");
    expect(columnaFaltanteDe('column "periodo_precio" of relation "properties" does not exist')).toBe("periodo_precio");
    expect(columnaFaltanteDe("duplicate key value")).toBeNull();
  });

  it("sin la columna reintenta sin ella y despues ya no la manda", async () => {
    const escribir = vi.fn(async (p: Record<string, unknown>) =>
      "periodo_precio" in p ? { error: { message: ERROR_POSTGREST } } : { data: "ok", error: null }
    );
    const r = await conColumnasOpcionales({ zona: "Laureles", periodo_precio: "mensual" }, escribir);
    expect(r.error).toBeNull();
    expect(escribir).toHaveBeenCalledTimes(2);
    expect(escribir.mock.calls[1][0]).toEqual({ zona: "Laureles" });

    await conColumnasOpcionales({ zona: "Belén", periodo_precio: "diario" }, escribir);
    expect(escribir).toHaveBeenCalledTimes(3);
    expect(escribir.mock.calls[2][0]).toEqual({ zona: "Belén" });
  });

  it("con la columna escribe una sola vez; otro error se devuelve tal cual", async () => {
    const ok = vi.fn(async () => ({ error: null }));
    await conColumnasOpcionales({ periodo_precio: "mensual" }, ok);
    expect(ok).toHaveBeenCalledTimes(1);
    const falla = vi.fn(async () => ({ error: { message: "duplicate key value" } }));
    const r = await conColumnasOpcionales({ periodo_precio: "mensual" }, falla);
    expect(r.error?.message).toBe("duplicate key value");
    expect(falla).toHaveBeenCalledTimes(1);
  });
});
