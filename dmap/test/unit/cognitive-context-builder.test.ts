import { describe, expect, it, vi } from "vitest";
import {
  buildPropertyContext,
  computeSourceHash,
  CONTEXT_PROMPT_VERSION,
  estimateCostUsd
} from "../../src/cognitive/application/context-builder.service.js";
import type { PropertyContextRow } from "../../src/cognitive/repositories/property-context.repo.js";
import {
  audienceAnalysisFixture,
  narrativeDirectionFixture,
  propertyContextFixture,
  propertyFixture
} from "../fixtures/property-context.js";

const ORG = propertyFixture.org_id;

function makeDeps(overrides: Record<string, unknown> = {}) {
  const upserted: unknown[] = [];
  const deps = {
    caller: vi
      .fn()
      .mockResolvedValueOnce({ text: JSON.stringify(audienceAnalysisFixture), tokensIn: 1000, tokensOut: 800 })
      .mockResolvedValueOnce({ text: JSON.stringify(narrativeDirectionFixture), tokensIn: 1500, tokensOut: 1200 }),
    getProperty: vi.fn().mockResolvedValue(propertyFixture),
    resolveBrand: vi.fn().mockResolvedValue({ id: null, name: "Diamond" }),
    upsertContext: vi.fn().mockImplementation(async (input: unknown) => {
      upserted.push(input);
      return { ...(input as object), id: "ctx-1", schema_version: 1, created_at: "", updated_at: "" } as PropertyContextRow;
    }),
    getExisting: vi.fn().mockResolvedValue(null),
    recordGeneration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
  return { deps, upserted };
}

describe("buildPropertyContext", () => {
  it("encadena las 2 llamadas, valida el schema y persiste 'ready' con tokens sumados", async () => {
    const { deps, upserted } = makeDeps();

    const row = await buildPropertyContext(ORG, propertyFixture.id, deps);

    expect(deps.caller).toHaveBeenCalledTimes(2);
    // La llamada #2 recibe el analisis de la #1 (chain-of-thought auditable).
    const secondPrompt = (deps.caller as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(secondPrompt).toContain("familia_consolidacion");

    expect(row.status).toBe("ready");
    const saved = upserted[0] as Record<string, unknown>;
    expect(saved.status).toBe("ready");
    expect(saved.prompt_version).toBe(CONTEXT_PROMPT_VERSION);
    expect(saved.input_tokens).toBe(2500);
    expect(saved.output_tokens).toBe(2000);
    expect(saved.context).toEqual(propertyContextFixture);
    expect(deps.recordGeneration).toHaveBeenCalledWith(expect.objectContaining({ kind: "property_context" }));
  });

  it("si no habia contexto previo y Claude falla, persiste 'failed' con el error y relanza", async () => {
    const { deps, upserted } = makeDeps({
      caller: vi.fn().mockResolvedValue({ text: "no es json", tokensIn: 1, tokensOut: 1 })
    });

    await expect(buildPropertyContext(ORG, propertyFixture.id, deps)).rejects.toThrow(/analisis de audiencia/);

    const saved = upserted[0] as Record<string, unknown>;
    expect(saved.status).toBe("failed");
    expect(saved.context).toEqual({});
    expect(saved.error).toMatch(/analisis de audiencia/);
  });

  it("NUNCA pisa un contexto previo utilizable: ante fallo queda 'stale' con el contexto viejo", async () => {
    const existing = {
      prompt_version: "vieja",
      source_hash: "hash-viejo",
      context: propertyContextFixture,
      model: "claude-sonnet-4-5",
      input_tokens: 10,
      output_tokens: 10,
      cost_usd: 0.01
    } as unknown as PropertyContextRow;
    const { deps, upserted } = makeDeps({
      caller: vi.fn().mockResolvedValue({ text: "no es json", tokensIn: 1, tokensOut: 1 }),
      getExisting: vi.fn().mockResolvedValue(existing)
    });

    await expect(buildPropertyContext(ORG, propertyFixture.id, deps)).rejects.toThrow();

    const saved = upserted[0] as Record<string, unknown>;
    expect(saved.status).toBe("stale");
    expect(saved.context).toEqual(propertyContextFixture);
    expect(saved.prompt_version).toBe("vieja");
  });

  it("rechaza una propiedad de otra org", async () => {
    const { deps } = makeDeps({
      getProperty: vi.fn().mockResolvedValue({ ...propertyFixture, org_id: "33333333-3333-3333-3333-333333333333" })
    });
    await expect(buildPropertyContext(ORG, propertyFixture.id, deps)).rejects.toThrow(/no pertenece/);
  });

  it("reintenta una vez por llamada si el JSON no parsea", async () => {
    const { deps } = makeDeps({
      caller: vi
        .fn()
        .mockResolvedValueOnce({ text: "roto", tokensIn: 10, tokensOut: 5 })
        .mockResolvedValueOnce({ text: JSON.stringify(audienceAnalysisFixture), tokensIn: 1000, tokensOut: 800 })
        .mockResolvedValueOnce({ text: JSON.stringify(narrativeDirectionFixture), tokensIn: 1500, tokensOut: 1200 })
    });

    const row = await buildPropertyContext(ORG, propertyFixture.id, deps);
    expect(row.status).toBe("ready");
    expect(deps.caller).toHaveBeenCalledTimes(3);
  });
});

describe("computeSourceHash", () => {
  it("es determinista y cambia con contenido semantico o fotos", () => {
    const base = computeSourceHash(propertyFixture);
    expect(computeSourceHash({ ...propertyFixture })).toBe(base);
    expect(computeSourceHash({ ...propertyFixture, precio: "$470.000.000" })).not.toBe(base);
    expect(computeSourceHash({ ...propertyFixture, images: ["https://cdn.example.com/3.jpg"] })).not.toBe(base);
  });
});

describe("estimateCostUsd", () => {
  it("estima con las tarifas de Sonnet", () => {
    // 1M in ($3) + 1M out ($15)
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBe(18);
    expect(estimateCostUsd(2500, 2000)).toBeCloseTo(0.0375, 4);
  });
});
