// La vista unificada del recorrido de un pedido del radar — src/data/radar-trazabilidad.js.
//
// Bug real (Juan, 2026-08-19): esta consulta se armo entera para el camino
// asistido (aviso privado a la asesora) y nunca se actualizo cuando se sumo
// el modo auto. Sofi veia que el motor encontro candidatas, pero no que el
// bot YA le habia contestado al colega en el grupo, ni el texto exacto — al
// pedirle "el mensaje completo que respondio el bot", Sofi no tenia de donde
// sacarlo y terminaba pidiendole al admin que lo copiara a mano de WhatsApp.
// Estos tests protegen que el campo `respuesta` (separado de `aviso`) siempre
// viaje con el texto real.

const { test } = require("node:test");
const assert = require("node:assert");

const radarTrazabilidad = require("../src/data/radar-trazabilidad");
const supabase = require("../src/data/supabase");

const SCOPE_ADMIN = { orgId: "org-1", viewerUid: "admin-1", isAdmin: true };

// Mismo patron que test/signal-events.test.js: el cliente es real (hay
// SUPABASE_URL en .env), asi que se mockea `from` por nombre de tabla en vez
// de tocar la base.
function chain(resultado, onLimit) {
  const c = {
    select: () => c,
    eq: () => c,
    not: () => c,
    gte: () => c,
    order: () => c,
    limit: (n) => { if (onLimit) onLimit(n); return c; },
    in: () => c,
    then: (resolve) => resolve(resultado),
  };
  return c;
}

function mockPorTabla(tablas) {
  return (nombre) => chain(tablas[nombre] || { data: [], error: null });
}

const SEÑAL_BASE = {
  id: "sig-1", created_at: "2026-08-19T14:45:00Z", fecha_mensaje: null, clase: "demanda",
  texto_original: "busco apto en Belen", autor_nombre: "Julieth", autor_telefono: "573001112222",
  group_id: "grp-1", advisor_id: null, aviso_advisor_id: null, matches: [],
  revalidacion: null, enviado_at: null, estado: "nuevo", origen: "vivo",
  respondida_at: null, respuesta_texto: null, respuesta_modo: null, respuesta_refs: null,
};

test("una señal respondida en modo auto trae el texto EXACTO en respuesta.texto, no un resumen", async (t) => {
  t.mock.method(supabase, "from", mockPorTabla({
    group_signals: {
      data: [{
        ...SEÑAL_BASE,
        respondida_at: "2026-08-19T14:46:00Z",
        respuesta_modo: "auto",
        respuesta_texto: "Hola, vi tu solicitud...\n\n1) Apartamento en Belen\n   Ref AP1\n\nComision compartida.\n— Sofi, asistente virtual",
        respuesta_refs: ["AP1", "AP2"],
      }],
      error: null,
    },
  }));

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);

  assert.strictEqual(r.disponible, true);
  const s = r.señales[0];
  assert.strictEqual(s.respuesta.salio, true);
  assert.strictEqual(s.respuesta.modo, "auto");
  assert.match(s.respuesta.texto, /Comision compartida/);
  assert.deepStrictEqual(s.respuesta.refs, ["AP1", "AP2"]);
});

test("sin respondida_at, respuesta.salio es false — no se inventa un texto", async (t) => {
  t.mock.method(supabase, "from", mockPorTabla({
    group_signals: { data: [{ ...SEÑAL_BASE }], error: null },
  }));

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  assert.strictEqual(r.señales[0].respuesta.salio, false);
});

test("aviso (asistido) y respuesta (auto) son independientes: una señal puede tener uno sin el otro", async (t) => {
  t.mock.method(supabase, "from", mockPorTabla({
    group_signals: {
      data: [{
        ...SEÑAL_BASE,
        // Solo camino auto: nunca hubo aviso privado a una asesora.
        enviado_at: null,
        respondida_at: "2026-08-19T14:46:00Z",
        respuesta_modo: "auto",
        respuesta_texto: "texto publicado",
        respuesta_refs: ["AP1"],
      }],
      error: null,
    },
  }));

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  const s = r.señales[0];
  assert.strictEqual(s.aviso.salio, false);
  assert.strictEqual(s.respuesta.salio, true);
});

test("modo sombra: respuesta.salio es true pero el resumen NO lo cuenta como 'respondioBot' (no se publico)", async (t) => {
  t.mock.method(supabase, "from", mockPorTabla({
    group_signals: {
      data: [{
        ...SEÑAL_BASE,
        respondida_at: "2026-08-19T14:46:00Z",
        respuesta_modo: "sombra",
        respuesta_texto: "texto redactado, no publicado",
        respuesta_refs: ["AP1"],
      }],
      error: null,
    },
  }));

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  assert.strictEqual(r.señales[0].respuesta.salio, true);
  assert.strictEqual(r.resumen.respondioBot, 0);
});

test("el resumen cuenta respondioBot solo con modo auto de verdad publicado", async (t) => {
  t.mock.method(supabase, "from", mockPorTabla({
    group_signals: {
      data: [
        { ...SEÑAL_BASE, id: "s1", respondida_at: "2026-08-19T14:46:00Z", respuesta_modo: "auto", respuesta_texto: "x", respuesta_refs: ["AP1"] },
        { ...SEÑAL_BASE, id: "s2", respondida_at: "2026-08-19T14:47:00Z", respuesta_modo: "auto", respuesta_texto: "y", respuesta_refs: ["AP2"] },
        { ...SEÑAL_BASE, id: "s3" },
      ],
      error: null,
    },
  }));

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  assert.strictEqual(r.resumen.respondioBot, 2);
  assert.strictEqual(r.resumen.entraron, 3);
});

// Bug real 2026-08-19: el default era 20. En un grupo activo, una rafaga de
// pedidos sin match podia empujar fuera de la ventana un pedido puntual mas
// viejo que si tenia match y respuesta ya publicada.
test("sin 'limite', la consulta real pide 40 filas (MAX_FILAS), no 20", async (t) => {
  let pedidas = null;
  t.mock.method(supabase, "from", (tabla) => {
    if (tabla !== "group_signals") return chain({ data: [], error: null });
    return chain({ data: [], error: null }, (n) => { pedidas = n; });
  });

  await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  assert.strictEqual(pedidas, 40);
});

test("un 'limite' explicito mas chico se respeta", async (t) => {
  let pedidas = null;
  t.mock.method(supabase, "from", (tabla) => {
    if (tabla !== "group_signals") return chain({ data: [], error: null });
    return chain({ data: [], error: null }, (n) => { pedidas = n; });
  });

  await radarTrazabilidad.trazabilidad(SCOPE_ADMIN, { limite: 5 });
  assert.strictEqual(pedidas, 5);
});

test("si falta la migracion de aviso_advisor_id, el fallback SIGUE trayendo respuesta_texto", async (t) => {
  let intento = 0;
  t.mock.method(supabase, "from", (tabla) => {
    if (tabla !== "group_signals") return chain({ data: [], error: null });
    intento++;
    if (intento === 1) return chain({ data: null, error: { code: "42703", message: "column aviso_advisor_id does not exist" } });
    return chain({
      data: [{ ...SEÑAL_BASE, respondida_at: "2026-08-19T14:46:00Z", respuesta_modo: "auto", respuesta_texto: "texto de respaldo", respuesta_refs: [] }],
      error: null,
    });
  });

  const r = await radarTrazabilidad.trazabilidad(SCOPE_ADMIN);
  assert.strictEqual(r.disponible, true);
  assert.strictEqual(r.señales[0].respuesta.texto, "texto de respaldo");
});
