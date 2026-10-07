// Notificaciones de la App de asesores (2026-10-07): la fila para la campana
// del CRM y el push al celular. Nunca tumba el flujo que la dispara.
const { test } = require("node:test");
const assert = require("node:assert");
const { notificar } = require("../src/notifications/notificar");

const ADV = { id: "a2", org_id: "org-1", name: "Claudia" };
const base = { orgId: "org-1", advisor: ADV, tipo: "cita_por_confirmar", titulo: "Nueva visita por confirmar", cuerpo: "Ref 10012722", link: "/calendario", leadId: "l1" };

function deps(over = {}) {
  const log = { insert: [], push: [], borradas: [] };
  return {
    log,
    d: {
      insertar: async (fila) => { log.insert.push(fila); return { ok: true }; },
      suscripciones: async () => [
        { id: "p1", endpoint: "https://push/1", p256dh: "k1", auth: "a1" },
        { id: "p2", endpoint: "https://push/2", p256dh: "k2", auth: "a2" },
      ],
      enviarPush: async (sub, payload) => { log.push.push({ sub: sub.id, payload: JSON.parse(payload) }); return { ok: true }; },
      borrarSuscripcion: async (id) => log.borradas.push(id),
      vapid: true,
      ...over,
    },
  };
}

test("inserta la notificación y manda push a cada suscripción", async () => {
  const { log, d } = deps();
  const r = await notificar(base, d);
  assert.deepStrictEqual(r, { ok: true, push: 2 });
  assert.deepStrictEqual(log.insert[0], { org_id: "org-1", advisor_id: "a2", tipo: "cita_por_confirmar", titulo: "Nueva visita por confirmar", cuerpo: "Ref 10012722", link: "/calendario", lead_id: "l1" });
  assert.deepStrictEqual(log.push[0].payload, { titulo: "Nueva visita por confirmar", cuerpo: "Ref 10012722", link: "/calendario" });
});

test("una suscripción vencida (410) se borra", async () => {
  const { log, d } = deps({
    enviarPush: async (sub) => (sub.id === "p2" ? { ok: false, statusCode: 410 } : { ok: true }),
  });
  const r = await notificar(base, d);
  assert.strictEqual(r.push, 1);
  assert.deepStrictEqual(log.borradas, ["p2"]);
});

test("sin claves VAPID solo inserta", async () => {
  const { log, d } = deps({ vapid: false });
  const r = await notificar(base, d);
  assert.deepStrictEqual(r, { ok: true, push: 0 });
  assert.strictEqual(log.push.length, 0);
});

test("si el insert falla no lanza", async () => {
  const { d } = deps({ insertar: async () => { throw new Error("tabla no existe"); } });
  const r = await notificar(base, d);
  assert.strictEqual(r.ok, false);
});

test("sin asesor no hace nada", async () => {
  const { log, d } = deps();
  assert.deepStrictEqual(await notificar({ ...base, advisor: null }, d), { ok: false, push: 0 });
  assert.strictEqual(log.insert.length, 0);
});
