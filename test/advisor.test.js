const { test } = require("node:test");
const assert = require("node:assert");
const { buildClientLink, buildAdvisorAlert, buildAllyClientMatchAlert } = require("../src/notifications/advisor");

const org = { name: "Diamond" };
const ventaAdvisor = { name: "Asesor Ventas", phone: "573028536489", especialidad: "venta" };

// --- buildClientLink ---

test("VENDEDOR: el link dice que quiere vender, NO 'interesado en esta propiedad'", () => {
  // Bug real: un vendedor entro por una publicacion de venta (property_ref_origen)
  // y el link lo mandaba como comprador interesado en ESE inmueble.
  const lead = {
    nombre: "Juan Carlos Pelaez",
    intencion: "vender",
    property_ref_origen: "8616297",
  };
  const link = buildClientLink(ventaAdvisor, lead);
  const texto = decodeURIComponent(link.split("text=")[1]);
  assert.match(texto, /quiero vender mi propiedad/i);
  assert.doesNotMatch(texto, /interesado en esta propiedad/i);
  assert.doesNotMatch(texto, /8616297/);
  assert.match(texto, /Juan Carlos Pelaez/);
});

test("COMPRADOR: el link mantiene el interes en la propiedad de origen", () => {
  const lead = { intencion: "comprar", property_ref_origen: "https://info.wasi.co/x/9702941" };
  const texto = decodeURIComponent(buildClientLink(ventaAdvisor, lead).split("text=")[1]);
  assert.match(texto, /interesado en esta propiedad/i);
  assert.match(texto, /9702941/);
});

test("VEHICULOS: el link es de vehiculos", () => {
  const lead = { intencion: "vehiculos" };
  const advisor = { phone: "573000000003", especialidad: "vehiculos" };
  const texto = decodeURIComponent(buildClientLink(advisor, lead).split("text=")[1]);
  assert.match(texto, /vehiculo/i);
});

test("CON CITA: el link confirma la visita con dia y hora, NO 'interesado en la propiedad'", () => {
  // Pedido explicito del usuario: si el cliente ya agendo, el mensaje debe ser
  // "quiero confirmar la visita para el dia ... a la hora ...".
  const lead = { nombre: "Ana Gomez", intencion: "comprar", property_ref_origen: "9702941" };
  const cita = { descripcion: "el jueves a las 8", tipo: "visita", fecha_hora: "2026-07-09T08:00:00-05:00" };
  const texto = decodeURIComponent(buildClientLink(ventaAdvisor, lead, null, cita).split("text=")[1]);
  assert.match(texto, /quiero confirmar la visita/i);
  assert.match(texto, /9 de julio/); // dia legible en espanol (zona America/Bogota)
  assert.match(texto, /8:00/); // hora local Colombia
  assert.doesNotMatch(texto, /interesado en esta propiedad/i);
});

test("CON CITA sin fecha parseable: el link usa la descripcion del cliente", () => {
  const lead = { nombre: "Ana" };
  const cita = { descripcion: "manana en la manana", tipo: "llamada", fecha_hora: null };
  const texto = decodeURIComponent(buildClientLink(ventaAdvisor, lead, null, cita).split("text=")[1]);
  assert.match(texto, /quiero confirmar la llamada: manana en la manana/i);
});

test("CON CITA en lead.cita (persistida): tambien confirma sin pasarla explicita", () => {
  const lead = {
    nombre: "Ana",
    cita: { descripcion: "viernes 3pm", tipo: "visita", fecha_hora: "2026-07-10T15:00:00-05:00" },
  };
  const texto = decodeURIComponent(buildClientLink(ventaAdvisor, lead).split("text=")[1]);
  assert.match(texto, /quiero confirmar la visita/i);
});

// --- buildAdvisorAlert ---

test("VENDEDOR: la alerta marca que quiere VENDER y no muestra 'propiedad de interes'", () => {
  const lead = {
    nombre: "Juan Carlos Pelaez",
    phone: "573001112233",
    intencion: "vender",
    property_ref_origen: "8616297",
    score: 70,
  };
  const alert = buildAdvisorAlert(org, lead, "Quiere vender", null, "venta");
  assert.match(alert, /QUIERE VENDER su propiedad/);
  assert.doesNotMatch(alert, /Propiedad de interes/);
  assert.match(alert, /Entro por la publicacion: 8616297/); // contexto, no interes
});

test("La cita (dia y hora) llega al asesor en la alerta", () => {
  const lead = { nombre: "Juan Carlos", phone: "573001112233", intencion: "vender", score: 70 };
  const cita = { descripcion: "manana a las 8 am", tipo: "asesoria", fecha_hora: "2026-07-05T08:00:00-05:00" };
  const alert = buildAdvisorAlert(org, lead, "Quiere vender", null, "venta", cita);
  assert.match(alert, /Cita solicitada: manana a las 8 am \(asesoria\)/);
});

test("CON CITA con fecha: la alerta incluye link de Google Calendar para el asesor", () => {
  const lead = { nombre: "Ana Gomez", phone: "573001112233", score: 80 };
  const cita = { descripcion: "jueves 8am", tipo: "visita", fecha_hora: "2026-07-09T08:00:00-05:00" };
  const alert = buildAdvisorAlert(org, lead, "Calificado", null, "venta", cita);
  assert.match(alert, /Agendar en tu calendario: https:\/\/calendar\.google\.com\/calendar\/render/);
  assert.match(alert, /20260709T130000Z/); // 8am Bogota = 13:00 UTC (inicio del evento)
});

test("CON CITA sin fecha parseable: la alerta NO incluye link de calendario", () => {
  const lead = { nombre: "Ana", phone: "573001112233", score: 80 };
  const cita = { descripcion: "algun dia de estos", tipo: "llamada", fecha_hora: null };
  const alert = buildAdvisorAlert(org, lead, "Calificado", null, "venta", cita);
  assert.doesNotMatch(alert, /calendar\.google\.com/);
  assert.match(alert, /Cita solicitada: algun dia de estos/);
});

test("COMPRADOR con propiedad de interes: la alerta la muestra", () => {
  const lead = { nombre: "Ana", phone: "573009998877", intencion: "comprar", score: 80 };
  const prop = { ref: "9702941", link: "https://info.wasi.co/x/9702941" };
  const alert = buildAdvisorAlert(org, lead, "Calificado", prop, "venta");
  assert.match(alert, /Propiedad de interes: 9702941/);
  assert.doesNotMatch(alert, /QUIERE VENDER/);
});

// --- buildAllyClientMatchAlert ---

test("buildAllyClientMatchAlert: incluye colega, propiedad y quien pregunto", () => {
  const allyProperty = {
    tipo: "Apartamento",
    zona: "Laureles",
    precio: "$1.800.000",
    ref: "10128030",
    contacto_nombre: "Andrea Restrepo",
    inmobiliaria_origen: "Century21",
  };
  const lead = { nombre: "Marta Gomez", phone: "573001112233" };
  const alert = buildAllyClientMatchAlert(allyProperty, lead);
  assert.match(alert, /Andrea Restrepo/);
  assert.match(alert, /Century21/);
  assert.match(alert, /Laureles/);
  assert.match(alert, /Marta Gomez/);
  assert.match(alert, /573001112233/);
  assert.match(alert, /[Vv]alida disponibilidad/);
});

test("buildAllyClientMatchAlert: campos opcionales ausentes no rompen el mensaje", () => {
  const allyProperty = { contacto_nombre: "Andrea" };
  const lead = { phone: "573001112233" };
  const alert = buildAllyClientMatchAlert(allyProperty, lead);
  assert.match(alert, /Andrea/);
  assert.match(alert, /Un cliente/);
  assert.doesNotMatch(alert, /undefined/);
  assert.doesNotMatch(alert, /null/);
});
