import { describe, expect, it } from "vitest";
import {
  canTransition,
  deriveStatusFromTargets,
  PUBLICATION_STATUSES,
  VALID_TRANSITIONS
} from "../../src/domain/publication-status.js";

describe("canTransition", () => {
  it("permite el camino feliz completo", () => {
    expect(canTransition("draft", "approved")).toBe(true);
    expect(canTransition("approved", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "publishing")).toBe(true);
    expect(canTransition("publishing", "published")).toBe(true);
  });

  it("permite editar/regenerar sin salir de draft", () => {
    expect(canTransition("draft", "draft")).toBe(true);
  });

  it("permite publicar directo desde approved (publicar ahora)", () => {
    expect(canTransition("approved", "publishing")).toBe(true);
  });

  it("permite reintentar desde failed y partially_published", () => {
    expect(canTransition("failed", "publishing")).toBe(true);
    expect(canTransition("partially_published", "publishing")).toBe(true);
  });

  it("rechaza saltarse estados", () => {
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("draft", "scheduled")).toBe(false);
    expect(canTransition("draft", "publishing")).toBe(false);
  });

  it("rechaza transiciones desde estados terminales", () => {
    expect(canTransition("published", "draft")).toBe(false);
    expect(canTransition("published", "archived")).toBe(false);
    expect(canTransition("archived", "draft")).toBe(false);
  });

  it("rechaza retroceder de un estado avanzado a uno anterior", () => {
    expect(canTransition("scheduled", "draft")).toBe(false);
    expect(canTransition("approved", "draft")).toBe(false);
  });

  it("todo estado tiene una entrada en VALID_TRANSITIONS", () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe("deriveStatusFromTargets", () => {
  it("published cuando todos los targets publicaron", () => {
    expect(deriveStatusFromTargets(["published", "published"])).toBe("published");
  });

  it("failed cuando todos fallaron", () => {
    expect(deriveStatusFromTargets(["failed", "failed"])).toBe("failed");
  });

  it("partially_published en un mix de exito y falla", () => {
    expect(deriveStatusFromTargets(["published", "failed"])).toBe("partially_published");
  });

  it("publishing mientras algun target sigue pendiente", () => {
    expect(deriveStatusFromTargets(["published", "pending"])).toBe("publishing");
    expect(deriveStatusFromTargets(["publishing", "failed"])).toBe("publishing");
  });

  it("lanza si no hay targets", () => {
    expect(() => deriveStatusFromTargets([])).toThrow();
  });
});
