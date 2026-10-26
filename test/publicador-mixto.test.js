// Publicador mixto (spec docs/superpowers/specs/2026-10-26-publicador-mixto-design.md):
// categoria arriendos, encaje con el perfil del grupo, dos franjas y orden.
const { test } = require("node:test");
const assert = require("node:assert");

const publicador = require("../src/groups/publicador");
const { perfilDe } = require("../src/groups/perfil-grupo");

const MANANA = new Date("2026-10-19T15:00:00Z"); // lunes 10:00 a. m. Bogota
const MEDIODIA = new Date("2026-10-19T17:30:00Z"); // 12:30
const TARDE = new Date("2026-10-19T20:00:00Z"); // 3:00 p. m.
const MIN = 60000;
const hace = (m, base = MANANA) => new Date(base.getTime() - m * MIN).toISOString();

function arriendo(ref, extra = {}) {
  return {
    ref, disponible: true, link: `https://info.wasi.co/x/${ref}`, images: ["a.jpg"], operacion: "Arriendo",
    tipo: "Apartamento", zona: "El Poblado", titulo: "Apartamento en El Poblado", descripcion: "", caracteristicas: "",
    precio: "$3.500.000", periodo_precio: "mensual", ...extra,
  };
}
function venta(ref, extra = {}) {
  return {
    ref, disponible: true, link: `https://info.wasi.co/x/${ref}`, images: ["a.jpg"], operacion: "Venta",
    tipo: "Apartamento", zona: "Envigado", titulo: "Apartamento en Envigado", descripcion: "", caracteristicas: "",
    precio: "$450.000.000", area: "80 m2", ...extra,
  };
}

const GO = { id: "go", jid: "o@g.us", nombre: "Ofertas generales", publica: "ofertas" };
const GSUR = { id: "gs", jid: "s@g.us", nombre: "OFERTAS SUR POB ENV SAB", publica: "ofertas" };
const GPOB = { id: "gp", jid: "p@g.us", nombre: "Ofertas Poblado", publica: "ofertas" };

// --- aptaPara arriendos ---

test("arriendos: acepta un arriendo mensual sin amoblar y rechaza noche, finca y sin zona", () => {
  assert.equal(publicador.aptaPara(arriendo("1"), "arriendos"), true);
  assert.equal(publicador.aptaPara(arriendo("1", { periodo_precio: "diario" }), "arriendos"), false);
  assert.equal(publicador.aptaPara(arriendo("1", { descripcion: "valor por noche", periodo_precio: "" }), "arriendos"), false);
  assert.equal(publicador.aptaPara(arriendo("1", { tipo: "Finca" }), "arriendos"), false);
  assert.equal(publicador.aptaPara(arriendo("1", { zona: "" }), "arriendos"), false);
  assert.equal(publicador.aptaPara(venta("2"), "arriendos"), false);
});

test("ofertas acepta el arriendo sin amoblar", () => {
  assert.equal(publicador.aptaPara(arriendo("1"), "ofertas"), true);
});

// --- aptaParaGrupo ---

test("aptaParaGrupo: grupo con zonas da exacta, vecina o null", () => {
  const perfil = perfilDe(GSUR);
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "El Poblado" }), GSUR, perfil), "exacta");
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "Envigado" }), GSUR, perfil), "exacta");
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "Bello" }), GSUR, perfil), null);
  const pob = perfilDe(GPOB);
  assert.deepEqual(pob.zonas, ["El Poblado"]);
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "Envigado" }), GPOB, pob), "vecina");
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "Laureles" }), GPOB, pob), null);
});

test("aptaParaGrupo: sin zonas siempre exacta; operacion y tipos filtran", () => {
  const sin = perfilDe(GO);
  assert.equal(publicador.aptaParaGrupo(arriendo("1", { zona: "Bello" }), GO, sin), "exacta");
  const soloVenta = { zonas: [], operacion: "venta", tipos: [], pedidos: [] };
  assert.equal(publicador.aptaParaGrupo(arriendo("1"), GO, soloVenta), null);
  assert.equal(publicador.aptaParaGrupo(venta("2"), GO, soloVenta), "exacta");
  const soloCasa = { zonas: [], operacion: null, tipos: ["Casa"], pedidos: [] };
  assert.equal(publicador.aptaParaGrupo(venta("3"), GO, soloCasa), null);
  assert.equal(publicador.aptaParaGrupo(venta("4", { tipo: "Casa" }), GO, soloCasa), "exacta");
  const soloApto = { zonas: [], operacion: null, tipos: ["Apartamento"], pedidos: [] };
  assert.equal(publicador.aptaParaGrupo(venta("5", { tipo: "Duplex" }), GO, soloApto), "exacta");
});

// --- franjaDe ---

test("franjaDe: manana 0, tarde 1, fuera null, domingo null", () => {
  assert.equal(publicador.franjaDe(new Date("2026-10-19T14:00:00Z")), 0); // 9:00
  assert.equal(publicador.franjaDe(MEDIODIA), null);
  assert.equal(publicador.franjaDe(TARDE), 1);
  assert.equal(publicador.franjaDe(new Date("2026-10-19T23:00:00Z")), null); // 18:00
  assert.equal(publicador.franjaDe(new Date("2026-10-18T15:00:00Z")), null); // domingo
});

// --- elegir: dos franjas ---

const base = { grupos: [GO], propiedades: [venta("1"), venta("2")], maxDia: 8 };
const post = (ref, cuando) => ({ group_id: "go", property_ref: ref, estado: "enviado", created_at: cuando });

test("porGrupo 2: manana, con 0 posts hoy es candidato y con 1 no", () => {
  assert.equal(publicador.elegir({ ...base, historial: [], ahora: MANANA, porGrupo: 2 }).grupo.id, "go");
  const r = publicador.elegir({ ...base, historial: [post("1", hace(30))], ahora: MANANA, porGrupo: 2 });
  assert.equal(r.motivo, "nada_que_publicar");
});

test("porGrupo 2: tarde, con 1 post hoy es candidato y con 2 no; con 0 (manana perdida) tambien", () => {
  const uno = [post("1", hace(300, TARDE))];
  assert.equal(publicador.elegir({ ...base, historial: uno, ahora: TARDE, porGrupo: 2 }).grupo.id, "go");
  const dos = [post("1", hace(300, TARDE)), post("2", hace(200, TARDE))];
  assert.equal(publicador.elegir({ ...base, historial: dos, ahora: TARDE, porGrupo: 2 }).motivo, "nada_que_publicar");
  // Si la manana no publico nada, la tarde si puede.
  assert.equal(publicador.elegir({ ...base, historial: [], ahora: TARDE, porGrupo: 2 }).grupo.id, "go");
});

test("porGrupo 2: un post de hoy dentro de la misma franja la cierra; de la otra, no", () => {
  const TARDE2 = new Date("2026-10-19T20:30:00Z"); // 3:30 p. m.
  const manana = [post("1", new Date("2026-10-19T14:00:00Z").toISOString())]; // 9:00
  assert.equal(publicador.elegir({ ...base, historial: manana, ahora: TARDE, porGrupo: 2 }).grupo.id, "go");
  const tarde = [post("1", new Date("2026-10-19T19:30:00Z").toISOString())]; // 2:30 p. m.
  assert.equal(publicador.elegir({ ...base, historial: tarde, ahora: TARDE2, porGrupo: 2 }).motivo, "nada_que_publicar");
});

test("porGrupo 1: amoblados sin zonas elige la ref que lleva mas tiempo sin salir", () => {
  const am = (ref) => arriendo(ref, { titulo: "Apartamento Amoblado en El Poblado" });
  const G = { id: "ga", jid: "a@g.us", nombre: "Arriendos amoblados", publica: "amoblados" };
  const otro = (ref, cuando) => ({ group_id: "otro", property_ref: ref, estado: "enviado", created_at: cuando });
  const hist = [otro("A", hace(60 * 24 * 3)), otro("B", hace(60 * 24 * 10))];
  const r = publicador.elegir({ grupos: [G], propiedades: [am("A"), am("B")], historial: hist, ahora: MANANA, maxDia: 8, porGrupo: 1 });
  assert.equal(r.propiedad.ref, "B");
});

test("arriendo de asesor con periodo mensual y area es apto para arriendos; sin area no", () => {
  const conArea = arriendo("1", { origen: "asesor", area: "70 m2" });
  assert.equal(publicador.aptaPara(conArea, "arriendos"), true);
  assert.equal(publicador.aptaPara(arriendo("1", { origen: "asesor", area: "" }), "arriendos"), false);
});

test("entre franjas: 12:30 con porGrupo 2 no publica; con porGrupo 1 si", () => {
  assert.equal(publicador.elegir({ ...base, historial: [], ahora: MEDIODIA, porGrupo: 2 }).motivo, "entre_franjas");
  assert.equal(publicador.elegir({ ...base, historial: [], ahora: MEDIODIA, porGrupo: 1 }).grupo.id, "go");
});

// --- mezcla ---

test("mezcla en ofertas: manana venta primero, tarde arriendo primero", () => {
  const props = [arriendo("A1"), venta("V1")];
  const m = publicador.elegir({ ...base, propiedades: props, historial: [], ahora: MANANA, porGrupo: 2 });
  assert.equal(m.propiedad.ref, "V1");
  const t = publicador.elegir({ ...base, propiedades: props, historial: [post("V1", hace(300, TARDE))], ahora: TARDE, porGrupo: 2 });
  assert.equal(t.propiedad.ref, "A1");
});

// --- calza ---

test("calza: gana la venta de Envigado a 450 M sobre la de 900 M y sobre la de Sabaneta", () => {
  const pedidos = [{ operacion: "venta", zonas: ["Envigado"], precio_max: 500000000 }];
  const perfiles = new Map([["go", { zonas: [], operacion: "venta", tipos: [], pedidos }]]);
  const props = [venta("S", { zona: "Sabaneta" }), venta("C", { precio: "$900.000.000" }), venta("B", { precio: "$450.000.000" })];
  const r = publicador.elegir({ ...base, propiedades: props, historial: [], ahora: MANANA, perfiles });
  assert.equal(r.propiedad.ref, "B");
});

test("ficha completa desempata con la misma calza", () => {
  const props = [venta("A", { administracion: "" }), venta("B", { administracion: "$500.000" })];
  const r = publicador.elegir({ ...base, propiedades: props, historial: [], ahora: MANANA });
  assert.equal(r.propiedad.ref, "B");
});

// --- exacta antes que vecina ---

test("exacta antes que vecina aunque la vecina calce mas pedidos", () => {
  const pedidos = [1, 2, 3].map(() => ({ operacion: "venta", zonas: ["Envigado"] }));
  const perfiles = new Map([["gp", { zonas: ["El Poblado"], operacion: null, tipos: [], pedidos }]]);
  const props = [venta("VEC", { zona: "Envigado" }), venta("EXA", { zona: "El Poblado" })];
  const args = { grupos: [GPOB], historial: [], ahora: MANANA, maxDia: 8, perfiles };
  assert.equal(publicador.elegir({ ...args, propiedades: props }).propiedad.ref, "EXA");
  assert.equal(publicador.elegir({ ...args, propiedades: [props[0]] }).propiedad.ref, "VEC");
  assert.equal(publicador.elegir({ ...args, propiedades: [venta("LEJ", { zona: "Bello" })] }).motivo, "nada_que_publicar");
});
