const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const canalWhatsapp = require("../src/channels/whatsapp");
const advisors = require("../src/data/advisors");
const directorio = require("../src/groups/directorio");
const { cruzarOfertaConMandatos } = require("../src/groups/avisar-mandato");

const ORG = { id: "org-1" };
const OFERTA = {
  tipo: "Apartamento", operacion: "Venta", zona: "El Poblado",
  precio: "$1.580.000.000", habitaciones: 4, area: 246, banos: 3, garajes: 2,
};

let enviados, plantillas;

beforeEach(() => {
  mandatosData._reset();
  enviados = [];
  plantillas = [];
  mensajeAsesor.enviarYRegistrar = async (org, tel, texto) => {
    enviados.push({ tel, texto });
    return { ok: true, wamid: "wamid-1" };
  };
  canalWhatsapp.sendWhatsAppTemplate = async (org, tel, opts) => {
    plantillas.push({ tel, opts });
    return { ok: true, wamid: "wamid-tpl" };
  };
  advisors.findById = async () => ({ id: "adv-nat", name: "Natalia Velez", phone: "573001878024" });
  directorio.telefonoDe = async () => "573244151819";
  process.env.RADAR_ESCALADO_PHONE = "573028536489"; // Catherine
});

async function unMandato(extra = {}) {
  return mandatosData.crear(ORG.id, {
    cliente_nombre: "Marcela Restrepo", advisor_id: "adv-nat",
    operacion: "venta", tipo: "apartamento", zonas: ["El Poblado"],
    precio_max: 2200000000, habitaciones: 4, area_min: 150,
    exigencias: ["balcón"], ...extra,
  });
}

test("el aviso va al advisor_id del mandato, no a un asesor cualquiera", async () => {
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.avisados.length, 1);
  assert.strictEqual(enviados.length, 1);
  assert.strictEqual(enviados[0].tel, "573001878024");
});

test("el aviso lleva el telefono del colega resuelto por el directorio", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1", colega: { lid: "129781211373754", nombre: "Glovi" } });
  assert.ok(enviados[0].texto.includes("573244151819"));
});

test("sin telefono resuelto NO aparece el lid como si fuera un numero", async () => {
  directorio.telefonoDe = async () => null;
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, {
    allyPropertyId: "ally-1", colega: { lid: "129781211373754", nombre: "Patricia Vivares" }, grupo: "SOLO POBLADO",
  });
  assert.ok(!enviados[0].texto.includes("129781211373754"), "el LID no es un telefono marcable");
  assert.ok(/Patricia Vivares/.test(enviados[0].texto));
});

test("el mismo par (mandato, propiedad) no avisa dos veces", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(enviados.length, 1, "un repost del colega no genera un segundo WhatsApp");
});

test("una oferta que no cruza ningun mandato no manda nada", async () => {
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, { ...OFERTA, operacion: "Arriendo" }, { allyPropertyId: "ally-2" });
  assert.strictEqual(r.matches, 0);
  assert.strictEqual(enviados.length, 0);
});

test("ventana cerrada: cae a la plantilla y NO escala a Catherine", async () => {
  mensajeAsesor.enviarYRegistrar = async () => ({ ok: false, error: "(#131047) Message failed to send because more than 24 hours have passed" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(plantillas.length, 1);
  assert.strictEqual(plantillas[0].opts.name, "radar_match_mandato");
  assert.strictEqual(plantillas[0].opts.bodyParams.length, 3);
  assert.strictEqual(r.resultado, "plantilla");
});

test("si tambien falla la plantilla, escala a Catherine", async () => {
  mensajeAsesor.enviarYRegistrar = async (org, tel) => {
    enviados.push({ tel });
    return { ok: false, error: "131047 more than 24 hours" };
  };
  canalWhatsapp.sendWhatsAppTemplate = async () => ({ ok: false, error: "template not approved" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.resultado, "escalado");
  assert.ok(enviados.some((e) => e.tel === "573028536489"), "Catherine tiene que recibirlo");
});

test("entregado bien: NO escala a Catherine", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.ok(!enviados.some((e) => e.tel === "573028536489"), "el mandato tiene dueño: si llego, es asunto de el");
});

test("un fallo que NO es de ventana cerrada escala sin gastar una plantilla", async () => {
  mensajeAsesor.enviarYRegistrar = async () => ({ ok: false, error: "invalid phone number" });
  await unMandato();
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(plantillas.length, 0, "la plantilla no arregla un numero invalido");
  assert.strictEqual(r.resultado, "escalado");
});

test("un mandato sin advisor_id no revienta: escala", async () => {
  advisors.findById = async () => null;
  await unMandato({ advisor_id: null });
  const r = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(r.resultado, "escalado");
});

test("con tope diario en 1, el segundo match del dia no se manda", async () => {
  process.env.RADAR_MANDATO_MAX_DIA = "1";
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });
  process.env.RADAR_MANDATO_MAX_DIA = "0";
  assert.strictEqual(enviados.length, 1);
});

test("sin tope configurado no se limita nada (default de producto)", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });
  assert.strictEqual(enviados.length, 2);
});
