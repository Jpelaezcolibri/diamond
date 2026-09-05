// Lo que buscar_propiedades le manda al modelo se REENVIA entero en cada
// vuelta del tool loop de engine.js. Un campo de mas aca no se paga una vez:
// se paga por iteracion, en cada busqueda, para siempre. Nada mas falla si
// alguien lo vuelve a meter — solo sube la factura en silencio.
const test = require("node:test");
const assert = require("node:assert");

const { executeTool } = require("../src/agent/tools");
const properties = require("../src/data/properties");

const org = { id: "org-1", name: "Diamond", landing_base_url: "https://diamondinmobiliaria.com" };

function propiedad(extra = {}) {
  return {
    id: "prop-1", org_id: "org-1", ref: "9702941", titulo: "Apartamento en Envigado",
    zona: "Loma del Esmeraldal", ciudad: "Envigado", precio: 720000000, area: 95,
    habitaciones: 3, banos: 2, garaje: 1, estrato: 5, operacion: "venta", tipo: "apartamento",
    disponible: true, descripcion: "Amplio y luminoso.", link: "https://wasi.co/p/9702941",
    images: ["https://cdn.wasi.co/1.jpg", "https://cdn.wasi.co/2.jpg", "https://cdn.wasi.co/3.jpg"],
    ...extra,
  };
}

function ctxDe() {
  return { org, lead: { id: "lead-1", categoria: "compra" }, colega: true };
}

test("el resultado NO lleva las URLs de las imagenes", async (t) => {
  t.mock.method(properties, "search", async () => [propiedad()]);
  const salida = await executeTool("buscar_propiedades", { zona: "Envigado" }, ctxDe());
  assert.ok(!salida.includes("cdn.wasi.co"), "las URLs de imagenes no pueden viajar al modelo");
  assert.ok(!salida.includes('"images"'), "el campo images no puede viajar al modelo");
});

test("pero SI lleva todo lo que Sofi necesita para armar la ficha", async (t) => {
  t.mock.method(properties, "search", async () => [propiedad()]);
  const salida = await executeTool("buscar_propiedades", { zona: "Envigado" }, ctxDe());
  // La regla 16 del prompt exige poder decidir sin volver a preguntar.
  for (const campo of ["ref", "titulo", "zona", "precio", "area", "habitaciones", "banos", "garaje", "estrato", "descripcion", "link"]) {
    assert.ok(salida.includes(`"${campo}"`), `falta ${campo}: la ficha queda incompleta`);
  }
  // El link de la landing es lo que la ficha usa como "Ver fotos".
  assert.ok(salida.includes("9702941"), "la ref tiene que llegar entera");
});

test("el recorte no toca la propiedad que se guarda como interes del lead", async (t) => {
  t.mock.method(properties, "search", async () => [propiedad()]);
  const ctx = ctxDe();
  await executeTool("buscar_propiedades", { zona: "Envigado" }, ctx);
  assert.ok(ctx.propertyInteres, "se sigue registrando la propiedad de interes");
  assert.deepStrictEqual(
    ctx.propertyInteres.images,
    ["https://cdn.wasi.co/1.jpg", "https://cdn.wasi.co/2.jpg", "https://cdn.wasi.co/3.jpg"],
    "el resto del sistema sigue viendo la fila COMPLETA"
  );
});
