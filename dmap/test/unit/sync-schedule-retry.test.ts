import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POR QUE EXISTE ESTE TEST — incidente del 2026-08-22.
 *
 * El sync de Wasi de las 00:00 UTC fallo con un 502 transitorio
 * ("Wasi API respondio 502 en /property/search", murio en 7 segundos). El job
 * repetible se registraba SIN `attempts`, asi que BullMQ no reintento nada y el
 * proximo intento quedaba 24 h despues.
 *
 * Eso no se queda en "un sync que no corrio": a las 30 h del ultimo sync
 * exitoso (GRUPOS_SYNC_MAX_HORAS) el bot marca TODO el inventario como
 * `sync_viejo` (src/groups/publicable.js) y el radar de grupos deja de
 * responder — ese dia se callo ante tres pedidos con match, uno de ellos de
 * puntaje 99. Un 502 de siete segundos costo mas de nueve horas de radar mudo.
 *
 * La ventana de frescura (30 h) da 6 h de margen sobre la cadencia del sync
 * (24 h). Los reintentos tienen que caber ahi: si se agotan todos, el problema
 * ya es real y el watchdog avisa.
 */

interface JobFalso {
  id: string;
  data: { orgId: string };
  opts: { repeat?: unknown; attempts?: number };
  remove: ReturnType<typeof vi.fn>;
}

const addMock = vi.fn();
const getRepeatableJobsMock = vi.fn(async () => [] as { key: string; id: string; every: string }[]);
const removeRepeatableByKeyMock = vi.fn();
const getDelayedMock = vi.fn(async () => [] as JobFalso[]);

vi.mock("../../src/queue/queues.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/queue/queues.js")>();
  return {
    ...actual,
    getQueue: () => ({
      add: addMock,
      getRepeatableJobs: getRepeatableJobsMock,
      removeRepeatableByKey: removeRepeatableByKeyMock,
      getDelayed: getDelayedMock
    })
  };
});

/** Una iteracion ya encolada en Redis, como la dejo el codigo viejo. */
function jobDelayed(orgId: string, attempts?: number): JobFalso {
  return {
    id: `repeat:hash:${orgId}`,
    data: { orgId },
    opts: { repeat: { every: 86_400_000 }, attempts },
    remove: vi.fn()
  };
}

vi.mock("../../src/repositories/settings.repo.js", () => ({
  listOrgIdsWithMarketingEnabled: async () => ["org-diamond"],
  getOrgMarketingSettings: async () => ({ sync_interval_minutes: 1440 })
}));

const { reconcileSyncSchedules } = await import("../../src/scheduler/schedules.js");
const { SYNC_MAX_ATTEMPTS, SYNC_RETRY_BACKOFF_MS } = await import(
  "../../src/config/constants.js"
);
const { backoffForSyncAttempt } = await import("../../src/queue/queues.js");

/** Las opciones con las que quedo registrado el repetible de sync. */
async function opcionesDelRepetible() {
  addMock.mockClear();
  await reconcileSyncSchedules();
  expect(addMock).toHaveBeenCalled();
  return addMock.mock.calls[0][2] as {
    jobId: string;
    repeat: { every: number };
    attempts?: number;
    backoff?: { type: string };
  };
}

describe("reconcileSyncSchedules — un 502 transitorio no puede costar 24 h", () => {
  beforeEach(() => {
    addMock.mockClear();
    getRepeatableJobsMock.mockClear();
    removeRepeatableByKeyMock.mockClear();
    getDelayedMock.mockClear();
    getDelayedMock.mockResolvedValue([]);
  });

  it("registra el sync con reintentos (sin esto, el primer fallo espera la proxima corrida)", async () => {
    const opciones = await opcionesDelRepetible();
    expect(opciones.attempts).toBe(SYNC_MAX_ATTEMPTS);
    expect(opciones.attempts).toBeGreaterThan(1);
  });

  it("usa la estrategia de backoff custom, como publish", async () => {
    const opciones = await opcionesDelRepetible();
    expect(opciones.backoff).toEqual({ type: "custom" });
  });

  it("sigue respetando la cadencia configurada por la org", async () => {
    const opciones = await opcionesDelRepetible();
    expect(opciones.repeat.every).toBe(1440 * 60_000);
    expect(opciones.jobId).toBe("sync_org-diamond");
  });

  it("todos los reintentos caben en el margen entre la cadencia y la ventana de frescura", () => {
    // Diamond sincroniza cada 24 h (sync_interval_minutes = 1440) y el bot
    // confia en el inventario 30 h (GRUPOS_SYNC_MAX_HORAS): quedan 6 h de
    // margen. Si el ultimo reintento cayera despues, el radar se callaria
    // igual y los reintentos no habrian servido de nada.
    const totalMs = SYNC_RETRY_BACKOFF_MS.reduce((a, b) => a + b, 0);
    expect(totalMs).toBeLessThan(6 * 3600_000);
  });

  /**
   * Sin estas dos pruebas el fix seria cosmetico. El lua de BullMQ
   * (addStandardJob-9.lua:90) devuelve sin tocar nada cuando el jobId de la
   * proxima iteracion ya existe, y cada iteracion hereda las opciones de la
   * anterior: el `attempts` nuevo NO entraria nunca por si solo, ni con
   * redeploy. Hay que borrar la iteracion vieja para que se recree.
   */
  it("borra y recrea la iteracion ya encolada que quedo sin reintentos", async () => {
    const viejo = jobDelayed("org-diamond", undefined);
    getDelayedMock.mockResolvedValue([viejo]);

    await reconcileSyncSchedules();

    expect(viejo.remove).toHaveBeenCalledTimes(1);
    // Dos add: el primero no pudo sobrescribir al existente, el segundo lo crea
    // de nuevo ya con los reintentos.
    expect(addMock).toHaveBeenCalledTimes(2);
    expect((addMock.mock.calls[1][2] as { attempts?: number }).attempts).toBe(SYNC_MAX_ATTEMPTS);
  });

  it("no toca la iteracion encolada si ya tiene los reintentos vigentes", async () => {
    const alDia = jobDelayed("org-diamond", SYNC_MAX_ATTEMPTS);
    getDelayedMock.mockResolvedValue([alDia]);

    await reconcileSyncSchedules();

    expect(alDia.remove).not.toHaveBeenCalled();
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("no toca iteraciones de otra org", async () => {
    const otraOrg = jobDelayed("org-vecina", undefined);
    getDelayedMock.mockResolvedValue([otraOrg]);

    await reconcileSyncSchedules();

    expect(otraOrg.remove).not.toHaveBeenCalled();
  });

  it("el backoff crece y esta definido para cada intento", () => {
    for (let i = 0; i < SYNC_MAX_ATTEMPTS; i += 1) {
      expect(backoffForSyncAttempt(i)).toBeGreaterThan(0);
      if (i > 0) expect(backoffForSyncAttempt(i)).toBeGreaterThan(backoffForSyncAttempt(i - 1));
    }
    // Fuera de rango no debe devolver undefined/NaN: BullMQ lo interpretaria mal.
    expect(backoffForSyncAttempt(99)).toBeGreaterThan(0);
  });
});
