// Un aviso nunca muestra como telefono algo que no es un telefono.
//
// EL INCIDENTE (2026-09-05). Los avisos que salieron esos dias decian cosas
// como "Contacto del colega: ++573002701862", "Contacto del colega: +Carolina
// Fleisman +573002701862" y "Contacto del colega: +null". Medido contra
// produccion ese dia: de 129 ofertas, 88 tenian el NOMBRE del colega guardado
// en la columna contacto_telefono y otras el string literal "null".
//
// DOS CAUSAS, las dos arregladas aca:
//
// 1. La escritura usaba `esMarcable`, que solo mide un TECHO de longitud
//    (<=13 digitos). Un nombre tiene 0 digitos, asi que pasaba el filtro. El
//    validador estricto —esCelularColombiano, que ya existia en el mismo
//    modulo para el camino que le escribe al colega— es el que corresponde.
//
// 2. La redaccion hacia `+${telefono}` a pelo sobre lo que hubiera guardado.
//    Aunque el dato traiga un telefono valido adentro ("Carolina Fleisman
//    +573002701862"), imprimir la cadena cruda mete el nombre y duplica el +.
//    Ahora se imprime el numero NORMALIZADO, o no se imprime.
//
// Juan, 2026-09-05: "si pasa que se alerte al asesor pero que no se envie
// informacion inventada".
const { test } = require("node:test");
const assert = require("node:assert");
const { buildAllyOfferMatchAlert } = require("../src/notifications/advisor");
const { esCelularColombiano, telefonoNormalizado } = require("../src/lib/contacto");

const LEAD = { nombre: "Sara", phone: "573001112233", coincide_en: ["zona"] };
const base = (tel) => ({
  tipo: "apartamento",
  zona: "Loma de los Bernal",
  precio: "$790.000.000",
  contacto_nombre: "Diana Tobón",
  contacto_telefono: tel,
});

test("un NOMBRE en la columna telefono no se imprime como telefono", () => {
  const t = buildAllyOfferMatchAlert(base("Diana Tobón"), LEAD);
  assert.ok(!/\+\s*Diana/.test(t), `imprimio el nombre como telefono:\n${t}`);
  assert.match(t, /tocá el nombre de Diana Tobón en el grupo/);
});

test('el string literal "null" tampoco', () => {
  const t = buildAllyOfferMatchAlert(base("null"), LEAD);
  assert.ok(!/\+null/.test(t), `imprimio "+null":\n${t}`);
  assert.match(t, /tocá el nombre/);
});

test("un telefono que ya trae + no produce ++", () => {
  const t = buildAllyOfferMatchAlert(base("+573053336871"), LEAD);
  assert.ok(!t.includes("++"), `salio con ++:\n${t}`);
  assert.match(t, /Contacto del colega: \+573053336871\./);
});

test("nombre y numero pegados: sale el numero solo, sin el nombre", () => {
  const t = buildAllyOfferMatchAlert(base("Carolina Fleisman +573002701862"), LEAD);
  assert.match(t, /Contacto del colega: \+573002701862\./);
  assert.ok(!/\+Carolina/.test(t), `metio el nombre en el telefono:\n${t}`);
});

test("un telefono limpio sigue saliendo igual que siempre", () => {
  const t = buildAllyOfferMatchAlert(base("573053336871"), LEAD);
  assert.match(t, /Contacto del colega: \+573053336871\./);
});

test("un LID de WhatsApp no es un telefono marcable", () => {
  const t = buildAllyOfferMatchAlert(base("123456789012345"), LEAD);
  assert.ok(!/\+123456789012345/.test(t), `imprimio un LID como telefono:\n${t}`);
  assert.match(t, /tocá el nombre/);
});

// ── El helper compartido ──────────────────────────────────────────────────
test("telefonoNormalizado devuelve solo digitos, o null", () => {
  assert.strictEqual(telefonoNormalizado("+573053336871"), "573053336871");
  assert.strictEqual(telefonoNormalizado("Carolina Fleisman +573002701862"), "573002701862");
  assert.strictEqual(telefonoNormalizado("573053336871"), "573053336871");
  assert.strictEqual(telefonoNormalizado("Diana Tobón"), null);
  assert.strictEqual(telefonoNormalizado("null"), null);
  assert.strictEqual(telefonoNormalizado(""), null);
  assert.strictEqual(telefonoNormalizado(null), null);
  assert.strictEqual(telefonoNormalizado("123456789012345"), null, "un LID no");
});

// ── La escritura: que la columna deje de ensuciarse ───────────────────────
test("guardarOferta no escribe un nombre en la columna telefono", async () => {
  const ofertas = require("../src/groups/ofertas");
  const allyProperties = require("../src/data/ally-properties");
  const original = allyProperties.create;
  const escritas = [];
  allyProperties.create = async (orgId, row) => {
    escritas.push(row);
    return { id: "ally-1", ...row };
  };
  try {
    await ofertas.guardarOferta({ id: "org-1" }, {
      tipo: "apartamento", operacion: "venta", precio_max: 790000000,
      mensaje: { autor: "Diana Tobón", autorTelefono: "Diana Tobón", texto: "vendo apto" },
    });
    await ofertas.guardarOferta({ id: "org-1" }, {
      tipo: "apartamento", operacion: "venta", precio_max: 500000000,
      mensaje: { autor: "Monica", autorTelefono: "+573053336871", texto: "vendo apto" },
    });
  } finally {
    allyProperties.create = original;
  }
  assert.strictEqual(escritas[0].contacto_telefono, null, "guardo un nombre como telefono");
  assert.strictEqual(escritas[1].contacto_telefono, "573053336871", "no normalizo el telefono bueno");
});

test("esCelularColombiano sigue siendo el criterio, no se duplico logica", () => {
  assert.strictEqual(esCelularColombiano("573053336871"), true);
  assert.strictEqual(esCelularColombiano("Diana Tobón"), false);
});
