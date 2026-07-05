import { describe, expect, it } from "vitest";
import { PublicationService } from "../../src/services/publication.service.js";

/** Fakes en memoria: el servicio no debe tocar la red en estos tests. */
function makeFakes(initialStatus: string | null) {
  let status = initialStatus;
  const events: unknown[] = [];
  return {
    statusPort: {
      async getStatus() {
        return status as never;
      },
      async updateStatus(_id: string, to: string) {
        status = to;
      }
    },
    eventsPort: {
      async record(input: unknown) {
        events.push(input);
      }
    },
    getEvents: () => events,
    getStatus: () => status
  };
}

describe("PublicationService.transition", () => {
  it("aplica una transicion valida y registra un evento", async () => {
    const fakes = makeFakes("draft");
    const service = new PublicationService(fakes.statusPort, fakes.eventsPort);

    const result = await service.transition("pub-1", "org-1", "approved", "user:abc");

    expect(result).toEqual({ from: "draft", to: "approved" });
    expect(fakes.getStatus()).toBe("approved");
    expect(fakes.getEvents()).toEqual([
      {
        publication_id: "pub-1",
        org_id: "org-1",
        from_status: "draft",
        to_status: "approved",
        actor: "user:abc",
        detail: undefined
      }
    ]);
  });

  it("rechaza una transicion invalida y no escribe evento", async () => {
    const fakes = makeFakes("draft");
    const service = new PublicationService(fakes.statusPort, fakes.eventsPort);

    await expect(service.transition("pub-1", "org-1", "published", "user:abc")).rejects.toThrow(/Transicion invalida/);
    expect(fakes.getStatus()).toBe("draft");
    expect(fakes.getEvents()).toHaveLength(0);
  });

  it("rechaza si la publicacion no existe", async () => {
    const fakes = makeFakes(null);
    const service = new PublicationService(fakes.statusPort, fakes.eventsPort);

    await expect(service.transition("pub-inexistente", "org-1", "approved", "user:abc")).rejects.toThrow(/no existe/);
  });

  it("es el unico camino: dos transiciones consecutivas mantienen la auditoria completa", async () => {
    const fakes = makeFakes("draft");
    const service = new PublicationService(fakes.statusPort, fakes.eventsPort);

    await service.transition("pub-1", "org-1", "approved", "user:abc");
    await service.transition("pub-1", "org-1", "scheduled", "user:abc");

    expect(fakes.getStatus()).toBe("scheduled");
    expect(fakes.getEvents()).toHaveLength(2);
  });
});
