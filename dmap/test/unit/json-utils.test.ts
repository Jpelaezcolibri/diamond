import { describe, expect, it } from "vitest";
import { tryParseJSON } from "../../src/ai/json-utils.js";

describe("tryParseJSON", () => {
  it("parsea JSON limpio", () => {
    expect(tryParseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it("extrae JSON envuelto en fences de markdown", () => {
    const text = "Aqui esta:\n```json\n{\"a\":1}\n```\nListo.";
    expect(tryParseJSON(text)).toEqual({ a: 1 });
  });

  it("extrae el primer bloque {...} balanceado si hay texto alrededor sin fences", () => {
    const text = 'Claro, aqui va: {"a":1} — espero que sirva';
    expect(tryParseJSON(text)).toEqual({ a: 1 });
  });

  it("lanza si no hay JSON valido en ningun lado", () => {
    expect(() => tryParseJSON("esto no es json de ninguna forma")).toThrow();
  });
});
