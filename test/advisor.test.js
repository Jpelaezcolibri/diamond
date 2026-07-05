const { test } = require("node:test");
const assert = require("node:assert");
const { buildClientLink, buildAdvisorAlert } = require("../src/notifications/advisor");

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

test("COMPRADOR con propiedad de interes: la alerta la muestra", () => {
  const lead = { nombre: "Ana", phone: "573009998877", intencion: "comprar", score: 80 };
  const prop = { ref: "9702941", link: "https://info.wasi.co/x/9702941" };
  const alert = buildAdvisorAlert(org, lead, "Calificado", prop, "venta");
  assert.match(alert, /Propiedad de interes: 9702941/);
  assert.doesNotMatch(alert, /QUIERE VENDER/);
});
