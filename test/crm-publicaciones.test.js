// Logica pura de la pestaña Publicaciones del CRM (spec
// 2026-10-20-publicaciones-y-respuestas §6). Node importa el .ts directo,
// como test/crm-amoblados.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const lib = require("../crm/lib/publicaciones.ts");

const AHORA = new Date("2026-10-20T22:00:00Z").getTime();
const hace = (h) => new Date(AHORA - h * 3600e3).toISOString();

const post = (id, ref, group_id, h, extra = {}) => ({ id, property_ref: ref, group_id, estado: "enviado", origen: "auto", created_at: hace(h), ...extra });
const resp = (id, ref, via, clave, h, extra = {}) => ({ id, property_ref: ref, via, colega_clave: clave, primer_at: hace(h), group_id: null, ...extra });

test("estadoDe: atendida manda sobre todo", () => {
  const r = resp("r1", "1", "linea", "a", 5, { atendida_at: hace(1), seguimiento_at: hace(1), puente_at: hace(2) });
  assert.equal(lib.estadoDe(r, AHORA, true), "atendida");
});

test("estadoDe: seguimiento > link_sofi > recordatorio > sin_atender", () => {
  const base = resp("r1", "1", "linea", "a", 5);
  assert.equal(lib.estadoDe({ ...base, seguimiento_at: hace(1), puente_at: hace(2), recordatorio_at: hace(3) }, AHORA), "seguimiento");
  assert.equal(lib.estadoDe({ ...base, puente_at: hace(2), recordatorio_at: hace(3) }, AHORA), "link_sofi");
  assert.equal(lib.estadoDe({ ...base, recordatorio_at: hace(3) }, AHORA), "recordatorio");
  assert.equal(lib.estadoDe(base, AHORA), "sin_atender");
});

test("estadoDe: dentro de las 2 h es 'nueva'; con visita es 'visita'", () => {
  assert.equal(lib.estadoDe(resp("r1", "1", "grupo", "a", 1), AHORA), "nueva");
  assert.equal(lib.estadoDe(resp("r1", "1", "grupo", "a", 5, { puente_at: hace(1) }), AHORA, true), "visita");
});

test("resumen: posts enviados, respuestas, colegas distintos, % de refs con respuesta, por via", () => {
  const posts = [
    post("p1", "10505566", "g1", 6),
    post("p2", "10505566", "g2", 5),
    post("p3", "10392197", "g1", 4),
    post("p4", "10488373", "g3", 4),
    post("p5", "10383517", "g3", 4, { estado: "fallo" }),
  ];
  const respuestas = [
    resp("r1", "10505566", "sofi", "lidA", 3, { atendida_at: hace(3) }),
    resp("r2", "10505566", "linea", "lidB", 3),
    resp("r3", "10392197", "grupo", "lidA", 1),
  ];
  const r = lib.resumen(posts, respuestas, [], { ahora: AHORA });
  assert.equal(r.posts, 4);
  assert.equal(r.grupos, 3);
  assert.equal(r.fichas, 3);
  assert.equal(r.respuestas, 3);
  assert.equal(r.colegas, 2);
  assert.equal(r.pctConRespuesta, 67); // 2 de 3 refs
  assert.deepEqual(r.porVia, { sofi: 1, linea: 1, grupo: 1 });
  assert.equal(r.sinAtender, 1); // r2: linea, 3 h, sin atender. r3 tiene 1 h; r1 es Sofi y atendida.
});

test("resumen: sinAtender ignora Sofi y las atendidas", () => {
  const respuestas = [
    resp("r1", "1", "sofi", "a", 5),
    resp("r2", "1", "grupo", "b", 5, { atendida_at: hace(4) }),
    resp("r3", "1", "grupo", "c", 5, { recordatorio_at: hace(3) }),
  ];
  assert.equal(lib.resumen([], respuestas, [], { ahora: AHORA }).sinAtender, 1);
});

test("resumen: visitas de la linea o por una ref publicada, sin canceladas ni viejas", () => {
  const posts = [post("p1", "10505566", "g1", 6)];
  const leads = [
    { id: "l1", cita: { origen: "linea_dm", estado: "propuesta", ref: "999" } },
    { id: "l2", cita: { estado: "confirmada", ref: "10505566" } },
    { id: "l3", cita: { estado: "cancelada", ref: "10505566" } },
    { id: "l4", cita: { estado: "confirmada", ref: "777" } },
    { id: "l5", cita: { origen: "linea_dm", ref: "10505566", creada_at: hace(24 * 40) } },
  ];
  const r = lib.resumen(posts, [], leads, { ahora: AHORA, desde: new Date(AHORA - 7 * 86400e3) });
  assert.equal(r.visitas, 2);
});

test("agrupar: una fila por ref con sus grupos, horas, origen y respuestas", () => {
  const posts = [
    post("p1", "10505566", "g1", 6, { origen: "manual" }),
    post("p2", "10505566", "g2", 4, { origen: "manual" }),
    post("p3", "10392197", "g1", 5),
    post("p4", "10392197", "g1", 2, { origen: "manual" }),
    post("p5", "1", "g9", 1, { estado: "fallo" }),
  ];
  const respuestas = [resp("r1", "10505566", "sofi", "a", 3), resp("r2", "10505566", "linea", "b", 2), resp("r3", "555", "grupo", "c", 1)];
  const props = [{ ref: "10505566", titulo: "Dúplex La Linde", tipo: "Apartamento", operacion: "Arriendo", precio: "$7.900.000", images: ["https://x/1.jpg"] }];
  const fichas = lib.agrupar(posts, respuestas, props, { g1: "RENTA AMOBLADOS/FINCAS", g2: "ARRIENDOS 7AM 8PM" });
  const duplex = fichas.find((f) => f.ref === "10505566");
  assert.deepEqual(duplex.grupos, ["RENTA AMOBLADOS/FINCAS", "ARRIENDOS 7AM 8PM"]);
  assert.equal(duplex.posts, 2);
  assert.equal(duplex.primera, hace(6));
  assert.equal(duplex.ultima, hace(4));
  assert.equal(duplex.origen, "manual");
  assert.equal(duplex.titulo, "Dúplex La Linde");
  assert.equal(duplex.foto, "https://x/1.jpg");
  assert.equal(duplex.categoria, "amoblado");
  assert.deepEqual(duplex.respuestas.map((r) => r.id), ["r2", "r1"]);
  assert.equal(fichas.find((f) => f.ref === "10392197").origen, "mixto");
  // La respuesta por un post de antes del periodo no se pierde.
  const vieja = fichas.find((f) => f.ref === "555");
  assert.equal(vieja.primera, null);
  assert.equal(vieja.respuestas.length, 1);
  assert.equal(fichas.find((f) => f.ref === "1"), undefined);
});

test("categoriaDe: finca gana a la operacion; venta; arriendo = amoblado", () => {
  assert.equal(lib.categoriaDe({ ref: "1", tipo: "Finca", operacion: "Arriendo" }), "finca");
  assert.equal(lib.categoriaDe({ ref: "1", titulo: "Casa Finca de Lujo", operacion: "Arriendo" }), "finca");
  assert.equal(lib.categoriaDe({ ref: "1", operacion: "Venta" }), "venta");
  assert.equal(lib.categoriaDe({ ref: "1", operacion: "Arriendo" }), "amoblado");
  assert.equal(lib.categoriaDe(undefined), "otro");
});

test("visitasPorRespuesta: por lead_id o por el telefono/lid del colega, con la misma ref", () => {
  const respuestas = [
    resp("r1", "10505566", "linea", "111@lid", 3, { colega_lid: "111@lid" }),
    resp("r2", "10505566", "sofi", "573001112233", 3, { colega_telefono: "573001112233", lead_id: "l2" }),
    resp("r3", "10392197", "linea", "222@lid", 3, { colega_lid: "222@lid" }),
    resp("r4", "10392197", "linea", "333@lid", 3, { colega_lid: "333@lid" }),
  ];
  const leads = [
    { id: "l1", phone: "111@lid", cita: { origen: "linea_dm", estado: "propuesta", ref: "10505566" } },
    { id: "l2", phone: "573001112233", cita: { estado: "confirmada", ref: null } },
    { id: "l3", phone: "222", cita: { estado: "confirmada", ref: "10505566" } }, // otra ref
    { id: "l4", phone: "333", cita: { estado: "cancelada", ref: "10392197" } },
  ];
  assert.deepEqual([...lib.visitasPorRespuesta(respuestas, leads)].sort(), ["r1", "r2"]);
});

test("gruposQueResponden: ranking y grupos con posts sin respuestas", () => {
  const posts = [post("p1", "1", "g1", 3), post("p2", "1", "g2", 3), post("p3", "2", "g3", 3)];
  const respuestas = [resp("r1", "1", "grupo", "a", 1, { group_id: "g2" }), resp("r2", "1", "linea", "b", 1, { group_id: "g2" }), resp("r3", "2", "linea", "c", 1, { group_id: "g1" })];
  const r = lib.gruposQueResponden(posts, respuestas, { g1: "FINCAS 2", g2: "OFERTAS", g3: "FINCAS NORTE" });
  assert.deepEqual(r.top, [{ nombre: "OFERTAS", n: 2 }, { nombre: "FINCAS 2", n: 1 }]);
  assert.deepEqual(r.sinRespuesta, ["FINCAS NORTE"]);
});

test("fotoDe: string o {url}, y nada si no hay", () => {
  assert.equal(lib.fotoDe({ ref: "1", images: [null, "https://a"] }), "https://a");
  assert.equal(lib.fotoDe({ ref: "1", images: [{ url: "https://b" }] }), "https://b");
  assert.equal(lib.fotoDe({ ref: "1", images: [] }), null);
  assert.equal(lib.fotoDe(undefined), null);
});
