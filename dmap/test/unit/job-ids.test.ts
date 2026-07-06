import { describe, expect, it } from "vitest";
import { jobIds } from "../../src/queue/queues.js";

/**
 * BullMQ (Job.validateOptions) rechaza cualquier jobId personalizado que
 * contenga ":" a menos que tenga EXACTAMENTE 3 partes al separarlo por ":"
 * (compatibilidad con el formato legado de repeatables) — ver
 * node_modules/bullmq/dist/cjs/classes/job.js. Bug real 2026-07-06:
 * jobIds.publish() en el primer intento (attempt=0) tenia solo 2 partes y
 * tumbaba el primer intento de "Aprobar"/"Publicar ahora" con
 * "Custom Id cannot contain :" — los reintentos (3 partes) no fallaban,
 * lo que oculto el bug hasta que un usuario probo el flujo por primera vez.
 */
function assertValidBullMqJobId(id: string) {
  if (id.includes(":")) {
    expect(id.split(":").length, `jobId "${id}" debe tener 0 o exactamente 3 partes separadas por ":"`).toBe(3);
  }
}

describe("jobIds — formato valido para BullMQ", () => {
  it("publish: attempt 0 (primer intento, el caso que rompio en produccion)", () => {
    const id = jobIds.publish("target-uuid");
    assertValidBullMqJobId(id);
  });

  it("publish: reintentos (attempt > 0)", () => {
    assertValidBullMqJobId(jobIds.publish("target-uuid", 1));
    assertValidBullMqJobId(jobIds.publish("target-uuid", 4));
  });

  it("publish: distintos targetId no colisionan y siguen siendo validos", () => {
    const a = jobIds.publish("11111111-1111-1111-1111-111111111111");
    const b = jobIds.publish("22222222-2222-2222-2222-222222222222");
    expect(a).not.toBe(b);
    assertValidBullMqJobId(a);
    assertValidBullMqJobId(b);
  });

  it("generate, sync, metrics, tokenRefresh producen ids validos", () => {
    assertValidBullMqJobId(jobIds.generate("prop-uuid", "lujo"));
    assertValidBullMqJobId(jobIds.sync("org-uuid"));
    assertValidBullMqJobId(jobIds.metrics("org-uuid"));
    assertValidBullMqJobId(jobIds.tokenRefresh("org-uuid"));
  });
});
