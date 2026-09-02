const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mandatosData = require("../src/data/mandatos");
const mensajeAsesor = require("../src/lib/mensaje-asesor");
const canalWhatsapp = require("../src/channels/whatsapp");
const advisors = require("../src/data/advisors");
const directorio = require("../src/groups/directorio");
const { cruzarOfertaConMandatos } = require("../src/groups/avisar-mandato");
// El freno de ritmo vive en memoria del proceso (src/lib/ritmo-avisos.js):
// sin resetearlo, el segundo test del archivo veria "ya se le escribio hace
// poco" y encolaria el aviso en vez de mandarlo.
const ritmo = require("../src/lib/ritmo-avisos");

const ORG = { id: "org-1" };
const OFERTA = {
  tipo: "Apartamento", operacion: "Venta", zona: "El Poblado",
  precio: "$1.580.000.000", habitaciones: 4, area: 246, banos: 3, garajes: 2,
};

let enviados, plantillas;

beforeEach(() => {
  ritmo._reset();
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
  advisors.findAsesorPrincipalRadar = async () => ({ id: "adv-nat", name: "Natalia Velez", phone: "573001878024" });
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

test("el aviso va SIEMPRE al asesor PRINCIPAL del radar (Natalia), sin importar quien cargo el mandato", async () => {
  await unMandato({ advisor_id: "otro-asesor-cualquiera" });
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

test("sin asesor principal resuelto, no revienta: escala", async () => {
  advisors.findAsesorPrincipalRadar = async () => null;
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

// CAMBIO DE COMPORTAMIENTO (Juan, 2026-09-02): la segunda oferta seguida ya
// no sale como segundo WhatsApp. El tope diario sigue sin descartar nada —esa
// es la regla de producto que este test protege— pero el freno de ritmo
// (src/lib/ritmo-avisos.js) la deja registrada y sin entregar, para que la
// bandeja de salida la mande agrupada con las demas. El caso real: 18 ofertas
// del mismo mandato a Natalia en tres horas, cuatro rechazadas por WhatsApp
// con `pair rate limit hit`.
test("sin tope configurado NADA se descarta: la segunda queda en cola, no se pierde", async () => {
  await unMandato();
  const r1 = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  const r2 = await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });

  assert.strictEqual(enviados.length, 1, "solo la primera sale en el momento");
  assert.strictEqual(r1.resultado, "enviado");
  assert.strictEqual(r2.resultado, "en_cola", "la segunda no se descarta: espera a la bandeja");

  // Y queda registrada con su texto, lista para que la bandeja la agrupe.
  const pendientes = await mandatosData.pendientes(ORG.id);
  assert.strictEqual(pendientes.length, 1);
  assert.ok(pendientes[0].texto, "la alerta pendiente conserva el texto ya redactado");
});

test("pasada la ventana de ritmo, la siguiente vuelve a salir en el momento", async () => {
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  ritmo._reset(); // equivale a que pasaron los AVISOS_VENTANA_MIN minutos
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-2" });
  assert.strictEqual(enviados.length, 2);
});

// IMPORTANT: la ventana de 24h cerrada es el caso ESPERADO en este carril (se
// resuelve con la plantilla acto seguido) — enviarYRegistrar por defecto
// alerta al watchdog en cualquier fallo, y eso entrena a ignorarlo. El primer
// intento (texto libre) tiene que pedir que se silencie esa alerta porque, si
// falla, se reintenta con plantilla enseguida.
test("el intento de texto libre silencia la alerta al watchdog", async () => {
  const optsCapturados = [];
  mensajeAsesor.enviarYRegistrar = async (org, tel, texto, opts) => {
    optsCapturados.push(opts);
    return { ok: true, wamid: "wamid-1" };
  };
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  assert.strictEqual(optsCapturados.length, 1);
  assert.strictEqual(optsCapturados[0] && optsCapturados[0].silenciarAlertaWatchdog, true);
});

// El escalado a Catherine SI amerita la alerta: si eso tambien falla, no hay
// un cuarto canal, y el watchdog tiene que enterarse.
// Guardar el texto exacto del aviso (Juan, 2026-08-26): para poder
// reenviarlo IDENTICO a Catherine si hay que escalar por silencio, en vez de
// reconstruirlo.
test("marcarEntrega guarda el texto exacto del aviso que se le mando al asesor", async () => {
  const marcados = [];
  const original = mandatosData.marcarEntrega;
  mandatosData.marcarEntrega = async (orgId, alertaId, datos) => {
    marcados.push(datos);
    return original(orgId, alertaId, datos);
  };
  try {
    await unMandato();
    await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
    assert.strictEqual(marcados.length, 1);
    assert.strictEqual(marcados[0].texto, enviados[0].texto);
  } finally {
    mandatosData.marcarEntrega = original;
  }
});

test("el escalado a Catherine NO silencia la alerta al watchdog", async () => {
  const optsCapturados = [];
  mensajeAsesor.enviarYRegistrar = async (org, tel, texto, opts) => {
    optsCapturados.push({ tel, opts });
    return tel === "573028536489" ? { ok: false, error: "sin respuesta" } : { ok: false, error: "131047 more than 24 hours" };
  };
  canalWhatsapp.sendWhatsAppTemplate = async () => ({ ok: false, error: "template not approved" });
  await unMandato();
  await cruzarOfertaConMandatos(ORG, OFERTA, { allyPropertyId: "ally-1" });
  const llamadaEscalado = optsCapturados.find((c) => c.tel === "573028536489");
  assert.ok(llamadaEscalado, "Catherine tiene que recibir el intento de escalado");
  assert.ok(!llamadaEscalado.opts || !llamadaEscalado.opts.silenciarAlertaWatchdog);
});
