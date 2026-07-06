import { describe, expect, it } from "vitest";
import { hasSemanticChange } from "../../src/cognitive/application/invalidation.service.js";
import type { ChangeEvent } from "../../src/sync/diff.js";

function event(changeType: ChangeEvent["changeType"]): ChangeEvent {
  return { changeType, oldValue: null, newValue: null };
}

describe("hasSemanticChange", () => {
  it("precio, descripcion y fotos invalidan el contexto", () => {
    expect(hasSemanticChange([event("price_changed")])).toBe(true);
    expect(hasSemanticChange([event("description_changed")])).toBe(true);
    expect(hasSemanticChange([event("photos_changed")])).toBe(true);
  });

  it("disponibilidad NO invalida (no cambia a quien le sirve la propiedad)", () => {
    expect(hasSemanticChange([event("status_changed")])).toBe(false);
  });

  it("mezcla: basta un cambio semantico entre varios triviales", () => {
    expect(hasSemanticChange([event("status_changed"), event("price_changed")])).toBe(true);
    expect(hasSemanticChange([])).toBe(false);
  });
});
