// Resumen de pedidos para la asesora (Juan, 2026-10-17: "dale con el
// resumen"). Dos veces al dia (12 m. y 5 p. m.) le llega a Daiana la lista de
// pedidos de colegas que NO se contestaron solos y donde SI tenemos una ficha
// que ofrecer: quien, que pidio, que ofrecerle, que confirmar, su contacto y
// el texto listo para copiar. Sin pendientes no sale nada.

const { test } = require("node:test");
const assert = require("node:assert");
const resumen = require("../src/scheduler/resumen-pedidos");

const match = (extra = {}) => ({
  ref: "10383517", fuente: "diamond", titulo: "Amoblado en El Poblado", operacion: "Arriendo",
  zona: "El Poblado", precio: "$6.800.000", habitaciones: 2, banos: 2, garajes: 1, area: "55 m²",
  puntaje: 100, ubicacion: "exacta", linkWasi: "https://info.wasi.co/apartamento-alquiler-el-poblado-medellin/10383517",
  link: "https://diamondinmobiliaria.com/propiedades/x-10383517", ...extra,
});
const señal = (extra = {}) => ({
  id: "sig-1", autor_nombre: "‎Clara Segura", grupo: "Arriendos F y A amoblados", created_at: "2026-10-17T13:18:00Z",
  texto_original: "BUSCO apartamento para renta amoblado por 6 meses a 1 año Poblado 2 habitaciones $7.000.000",
  respuesta_modo: null, respondida_at: null, telefono: "573014521622", ...extra,
});

test("un pedido con ficha publicable entra con contacto y texto listo para copiar", () => {
  const r = resumen.armar([{ señal: señal(), matches: [match()] }]);
  assert.strictEqual(r.items.length, 1);
  const m = r.mensajes.join("\n");
  assert.match(m, /Clara Segura/);
  assert.match(m, /Arriendos F y A amoblados/);
  assert.match(m, /wa\.me\/573014521622/);
  assert.match(m, /10383517/);
  assert.match(m, /info\.wasi\.co/);
  assert.match(m, /Hola Clara/);
});

test("una ficha frenada por un dato (parqueadero sin cargar) entra con lo que hay que confirmar", () => {
  const r = resumen.armar([{ señal: señal(), matches: [match({ garajes_sin_dato: true })] }]);
  assert.strictEqual(r.items.length, 1);
  assert.match(r.mensajes.join("\n"), /parqueadero/i);
});

test("una ficha que nunca se ofrece (ref bloqueada) no entra y el pedido cuenta como sin ficha", () => {
  const prev = process.env.GRUPOS_REFS_BLOQUEADAS;
  process.env.GRUPOS_REFS_BLOQUEADAS = "10383517";
  try {
    const r = resumen.armar([{ señal: señal(), matches: [match()] }], { refsBloqueadas: new Set(["10383517"]) });
    assert.strictEqual(r.items.length, 0);
    assert.strictEqual(r.sinFicha, 1);
  } finally {
    if (prev === undefined) delete process.env.GRUPOS_REFS_BLOQUEADAS; else process.env.GRUPOS_REFS_BLOQUEADAS = prev;
  }
});

test("las propiedades de aliados no entran: solo inventario propio", () => {
  const r = resumen.armar([{ señal: señal(), matches: [match({ fuente: "aliado" })] }]);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.sinFicha, 1);
});

test("un pedido que ya se contesto solo (o a mano) no se repite", () => {
  const r = resumen.armar([
    { señal: señal({ respuesta_modo: "auto" }), matches: [match()] },
    { señal: señal({ id: "sig-2", respondida_at: "2026-10-17T14:00:00Z" }), matches: [match()] },
  ]);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.sinFicha, 0);
});

test("sin numero del colega, dice que le escriba desde el grupo", () => {
  const r = resumen.armar([{ señal: señal({ telefono: null }), matches: [match()] }]);
  assert.match(r.mensajes.join("\n"), /desde el grupo/i);
});

test("sin pedidos con ficha no hay mensajes", () => {
  const r = resumen.armar([{ señal: señal(), matches: [] }]);
  assert.deepStrictEqual(r.mensajes, []);
  assert.strictEqual(r.sinFicha, 1);
});

test("la ventana de las 12 arranca a las 5 p. m. de ayer y la de las 5 a las 12", () => {
  const doce = resumen.ventana(new Date("2026-10-17T17:05:00Z")); // 12:05 Bogota
  assert.strictEqual(doce.desde.toISOString(), "2026-10-16T22:00:00.000Z");
  const cinco = resumen.ventana(new Date("2026-10-17T22:05:00Z")); // 17:05 Bogota
  assert.strictEqual(cinco.desde.toISOString(), "2026-10-17T17:00:00.000Z");
});

function deps(extra = {}) {
  const llamadas = { enviados: [], plantillas: 0, avisos: 0 };
  return {
    llamadas,
    d: {
      orgs: async () => [{ id: "org-1", name: "Diamond" }],
      señales: async () => [{ señal: señal(), matches: [match()] }],
      asesor: async () => ({ id: "adv-daiana", phone: "573011880668" }),
      enviar: async (_org, tel, texto) => { llamadas.enviados.push({ tel, texto }); return { ok: true }; },
      plantilla: async () => { llamadas.plantillas += 1; return { ok: true }; },
      notificar: async () => { llamadas.avisos += 1; return { ok: true }; },
      ...extra,
    },
  };
}

test("a las 12:05 sale el resumen a la asesora y queda el aviso en la app", async () => {
  resumen._reset();
  const { d, llamadas } = deps();
  const r = await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  assert.strictEqual(r.enviados, 1);
  assert.ok(llamadas.enviados.length >= 2); // encabezado + pedido
  assert.strictEqual(llamadas.enviados[0].tel, "573011880668");
  assert.strictEqual(llamadas.avisos, 1);
});

test("el mismo turno no se manda dos veces", async () => {
  resumen._reset();
  const { d, llamadas } = deps();
  await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  const antes = llamadas.enviados.length;
  await resumen.runOnce({ ahora: new Date("2026-10-17T17:08:00Z"), deps: d });
  assert.strictEqual(llamadas.enviados.length, antes);
});

test("fuera de las 12 y las 5 no sale nada", async () => {
  resumen._reset();
  const { d, llamadas } = deps();
  const r = await resumen.runOnce({ ahora: new Date("2026-10-17T15:05:00Z"), deps: d }); // 10:05
  assert.strictEqual(r.enviados, 0);
  assert.strictEqual(llamadas.enviados.length, 0);
});

test("si WhatsApp no deja mandar texto (ventana de 24 h cerrada), sale la plantilla de aviso", async () => {
  resumen._reset();
  const { d, llamadas } = deps({ enviar: async () => ({ ok: false, error: "(#131047) Re-engagement message" }) });
  await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  assert.strictEqual(llamadas.plantillas, 1);
  assert.strictEqual(llamadas.avisos, 1);
});

test("con el interruptor apagado no sale nada", async (t) => {
  resumen._reset();
  process.env.RADAR_RESUMEN_PEDIDOS = "false";
  t.after(() => delete process.env.RADAR_RESUMEN_PEDIDOS);
  const { d, llamadas } = deps();
  await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  assert.strictEqual(llamadas.enviados.length, 0);
});

test("antes del primer turno del dia, la ventana es la del turno de las 5 de ayer", () => {
  const temprano = resumen.ventana(new Date("2026-10-17T15:05:00Z")); // 10:05 Bogota
  assert.strictEqual(temprano.desde.toISOString(), "2026-10-16T17:00:00.000Z"); // ayer 12 m.
});

test("una ficha frenada con puntaje bajo no entra (es ruido para la asesora)", () => {
  const r = resumen.armar([{ señal: señal(), matches: [match({ puntaje: 60, ubicacion: "vecina" })] }]);
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.sinFicha, 1);
});

test("la advertencia va pegada a la ficha que la tiene, no al pedido entero", () => {
  const r = resumen.armar([{ señal: señal(), matches: [match(), match({ ref: "10459832", garajes_sin_dato: true, puntaje: 90 })] }]);
  const m = r.mensajes.join("\n");
  assert.match(m, /⚠️ 10459832:/);
  assert.doesNotMatch(m, /⚠️ 10383517:/);
});

test("sin pedidos pero con respuestas sin atender, igual sale el resumen", async () => {
  resumen._reset();
  const { d, llamadas } = deps({
    señales: async () => [],
    sinAtender: async () => ({ total: 1, filas: [{ property_ref: "10505566", colega_nombre: "Laura Gómez", via: "linea", primer_texto: "Hola, sigue disponible?" }] }),
  });
  const r = await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  assert.strictEqual(r.enviados, 1);
  assert.strictEqual(llamadas.enviados.length, 1);
  assert.match(llamadas.enviados[0].texto, /Respuestas a nuestras publicaciones sin atender\* \(1\)/);
});

test("el encabezado de sin atender muestra el total real y lista hasta 20", async () => {
  resumen._reset();
  const filas = Array.from({ length: 20 }, (_, i) => ({ property_ref: String(10000000 + i), colega_nombre: "C" + i, via: "grupo", primer_texto: "info" }));
  const { d, llamadas } = deps({ señales: async () => [], sinAtender: async () => ({ total: 37, filas }) });
  await resumen.runOnce({ ahora: new Date("2026-10-17T17:05:00Z"), deps: d });
  const t = llamadas.enviados[0].texto;
  assert.match(t, /sin atender\* \(37\)/);
  assert.strictEqual((t.match(/^• Ref/gm) || []).length, 20);
  assert.match(t, /y 17 más/);
});
