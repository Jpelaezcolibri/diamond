// El LID es el camino PRINCIPAL para escribirle a un colega, no el respaldo.
//
// LA MEDICION QUE LO DECIDE (2026-09-05, contra produccion). Sobre 760 pedidos
// de colegas en grupos:
//   · 2 (0,3 %) traen un telefono real visible en WhatsApp
//   · 748 (98,4 %) llegan SOLO como @lid
// Por colega distinto: de 278, exactamente 2 se presentan con telefono. Y de
// los 276 que llegan como lid, el directorio resuelve 216 (78 %) — pero 60
// (22 %) son alcanzables UNICAMENTE por el lid.
//
// Y no va a mejorar: el calentamiento del directorio esta APAGADO desde el
// 2026-09-04 (WhatsApp respondia rate-overlimit y esa linea ya fue baneada una
// vez). El mapa lid->telefono quedo congelado en 2.261, asi que cada colega
// nuevo entra como lid y se queda como lid.
//
// Juan, 2026-09-05: "primero quiero que el principal camino de contacto sea el
// lid, si no hay lid debe de haber numero de telefono".
const { test } = require("node:test");
const assert = require("node:assert");
const politica = require("../src/groups/politica");
const { telefonoEnTexto } = require("../src/lib/contacto");

const BASE = {
  fechaMensajeIso: new Date().toISOString(),
  ahora: new Date(),
  dmsHoyColega: 0,
  dmsHoyLinea: 0,
};

test("con lid Y telefono, sale por el LID", () => {
  const d = politica.decidirDm({ ...BASE, telefono: "573001112233", lid: "219236806983774" });
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.via, "lid", "el lid tiene que ser el camino principal");
});

test("sin lid, cae al telefono", () => {
  const d = politica.decidirDm({ ...BASE, telefono: "573001112233", lid: null });
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.via, "telefono");
});

test("un lid demasiado corto no es destino: cae al telefono", () => {
  const d = politica.decidirDm({ ...BASE, telefono: "573001112233", lid: "12345" });
  assert.strictEqual(d.via, "telefono");
});

test("sin ninguno de los dos, no se envia", () => {
  const d = politica.decidirDm({ ...BASE, telefono: null, lid: null });
  assert.strictEqual(d.enviarDm, false);
  assert.strictEqual(d.motivo, "sin_telefono");
});

test("el caso real: 98 % de los colegas llegan solo con lid y SI se les escribe", () => {
  const d = politica.decidirDm({ ...BASE, telefono: null, lid: "164149388656659" });
  assert.strictEqual(d.enviarDm, true);
  assert.strictEqual(d.via, "lid");
});

// ── Leer el telefono que el colega escribio en su propio mensaje ──────────
//
// EL CASO REAL: Adriana Gutierrez publico "...Presupuesto hasta *$950 millones*
// con recursos propios / Adriana Gutierrez / 📲3172874669" y el aviso a la
// asesora decia "Contacto: no se pudo resolver el número". El numero estaba
// escrito en el mismo mensaje que se le mostraba debajo.
//
// Medido: 195 de 760 pedidos (25,7 %) traen un celular colombiano escrito en
// el texto. Como via de contacto aporta poco (el lid ya los cubre); su valor
// es que la asesora deje de leer "no se pudo resolver" con el numero a la
// vista, y que le quede un link para tocar.
test("saca el celular colombiano escrito en el texto", () => {
  assert.strictEqual(telefonoEnTexto("Adriana Gutierrez 📲3172874669"), "573172874669");
  assert.strictEqual(telefonoEnTexto("llamame al 300 123 4567"), "573001234567");
  assert.strictEqual(telefonoEnTexto("mi cel: 310-434-7904"), "573104347904");
  assert.strictEqual(telefonoEnTexto("escribime +57 320 555 4433"), "573205554433");
});

test("no confunde un precio con un telefono", () => {
  assert.strictEqual(telefonoEnTexto("Presupuesto hasta $950.000.000 con recursos propios"), null);
  assert.strictEqual(telefonoEnTexto("busco apto de 3 alcobas hasta 700 millones"), null);
  assert.strictEqual(telefonoEnTexto(""), null);
  assert.strictEqual(telefonoEnTexto(null), null);
});

test("no devuelve un fijo ni un lid", () => {
  assert.strictEqual(telefonoEnTexto("oficina 604 444 5566"), null, "un fijo no es celular");
  assert.strictEqual(telefonoEnTexto("id 219236806983774"), null, "un lid no es telefono");
});

test("el caso literal de Adriana, con el pedido completo", () => {
  const texto =
    "📌Casa en unidad de Loma de los Bernal o La Mota, mínimo 3 alcobas, quiere el carro al frente " +
    "de la casa, puede ser remodelada o para remodelar . Presupuesto hasta *$950 millones* con " +
    "recursos propios\n\nAdriana Gutierrez\n📲3172874669";
  assert.strictEqual(telefonoEnTexto(texto), "573172874669");
});

// ── El aviso a la asesora tiene que alcanzarle para contactar al colega ────
//
// Juan, 2026-09-05: "si se envia un mensaje al asesor que lleve la informacion
// necesaria para que el asesor se contacte con el colega".
const alertaAsesor = require("../src/groups/alerta-asesor");

const SENAL_ADRIANA = {
  grupo_nombre: "PEDIDOS INMOBILIARIOS",
  autor_nombre: "Adriana Gutierrez",
  autor_telefono: "108139055697938", // un lid: no es marcable
  texto_original:
    "📌Casa en unidad de Loma de los Bernal o La Mota, mínimo 3 alcobas. " +
    "Presupuesto hasta *$950 millones*\n\nAdriana Gutierrez\n📲3172874669",
  zonas: ["Loma de los Bernal"],
  habitaciones: 3,
  operacion: "venta",
  tipo: "casa",
};
const MATCH = {
  ref: "10012896", titulo: "Casa Remodelada en Belen", operacion: "Venta", zona: "La Mota",
  area: "174m2", habitaciones: 3, precio: "$990.000.000",
  linkWasi: "https://info.wasi.co/casa-venta-la-mota-medellin/10012896?shared=whatsapp",
};

test("sin telefono resuelto pero con el numero en el texto: le da el link", () => {
  const t = alertaAsesor.construir(SENAL_ADRIANA, { refs_utiles: [], refs_dudosas: ["10012896"] }, [MATCH]);
  assert.match(t, /wa\.me\/573172874669/, `no le dio con que contactar:\n${t}`);
  assert.ok(!/no se pudo resolver el número/.test(t), "dijo que no pudo, con el numero a la vista");
});

test("dice de donde salio el numero — la asesora tiene que poder confiar en el", () => {
  const t = alertaAsesor.construir(SENAL_ADRIANA, { refs_utiles: [], refs_dudosas: ["10012896"] }, [MATCH]);
  const lineaContacto = t.split("\n").find((l) => l.startsWith("Contacto:"));
  assert.ok(lineaContacto, "no hay linea de Contacto");
  assert.match(lineaContacto, /lo escribió en su mensaje/i, "la linea de Contacto no aclara el origen");
  assert.match(lineaContacto, /confirmá/i, "no le pide a la asesora que lo confirme");
});

test("el telefono resuelto por el directorio manda sobre el del texto", () => {
  const t = alertaAsesor.construir(SENAL_ADRIANA, { refs_utiles: [], refs_dudosas: ["10012896"] }, [MATCH], "573001112233");
  assert.match(t, /wa\.me\/573001112233/);
});

test("sin telefono por ningun lado, sigue diciendo la verdad", () => {
  const senal = { ...SENAL_ADRIANA, texto_original: "Busco casa en Belén, presupuesto $950.000.000" };
  const t = alertaAsesor.construir(senal, { refs_utiles: [], refs_dudosas: ["10012896"] }, [MATCH]);
  assert.match(t, /tocá el nombre de Adriana Gutierrez en el grupo/);
});

// El respaldo por telefono (si el lid no entrega) se prueba donde se puede
// ejercitar de verdad, con el cableado completo de vivo.js:
// test/group-asistido.test.js -> "si el lid no entrega, el DM sale por el
// telefono resuelto". Un test aca solo podia llamar al stub y pasar sin
// ejercitar nada — el mismo error que dejo pasar el diluvio de septiembre.
