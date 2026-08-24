// Numero marcable vs @lid (identificador interno de WhatsApp). Compartido
// entre alerta-asesor.js y radar-trazabilidad.js para que no diverjan sobre
// que cuenta como "se puede contactar" — bug real encontrado 2026-08-18:
// alerta-asesor.js armaba el link con CUALQUIER telefono, sin filtrar los
// @lid, mientras que radar-trazabilidad.js si los filtraba pero nunca
// exponia el numero (solo un booleano) — Sofi no tenia de donde sacar el
// link para el mensaje que le pidio Juan.

const { test } = require("node:test");
const assert = require("node:assert");
const { esMarcable, linkWhatsapp, linkContactoOficial, tocarNombreEnGrupo } = require("../src/lib/contacto");

test("un colombiano real (12 digitos con 57) es marcable", () => {
  assert.strictEqual(esMarcable("573001234567"), true);
  assert.strictEqual(linkWhatsapp("573001234567"), "https://wa.me/573001234567");
});

test("un @lid (14-15 digitos) NO es marcable — no arma un link roto", () => {
  assert.strictEqual(esMarcable("141746805670125"), false);
  assert.strictEqual(linkWhatsapp("141746805670125"), null);
});

test("sin telefono, ninguna de las dos truena", () => {
  assert.strictEqual(esMarcable(null), false);
  assert.strictEqual(esMarcable(undefined), false);
  assert.strictEqual(esMarcable(""), false);
  assert.strictEqual(linkWhatsapp(null), null);
});

test("limpia simbolos antes de armar el link (+, espacios, guiones)", () => {
  assert.strictEqual(linkWhatsapp("+57 300 123 4567"), "https://wa.me/573001234567");
});

// linkContactoOficial (src/lib/contacto.js): antes solo estaba cubierta de
// forma indirecta a traves de alerta-asesor.test.js / aviso-cercano.test.js.
// La lee en cada llamado (no la cachea) para que un test pueda prenderla y
// apagarla por caso — ver la nota junto a la funcion.
test("linkContactoOficial arma el link con CONTACT_WHATSAPP_NUMBER definida, y null sin ella", () => {
  const anterior = process.env.CONTACT_WHATSAPP_NUMBER;
  try {
    process.env.CONTACT_WHATSAPP_NUMBER = "573009998877";
    assert.strictEqual(linkContactoOficial(), "https://wa.me/573009998877");

    delete process.env.CONTACT_WHATSAPP_NUMBER;
    assert.strictEqual(linkContactoOficial(), null);
  } finally {
    if (anterior === undefined) delete process.env.CONTACT_WHATSAPP_NUMBER;
    else process.env.CONTACT_WHATSAPP_NUMBER = anterior;
  }
});

// tocarNombreEnGrupo (2026-08-24): la instruccion real para contactar a un
// colega sin telefono marcable, centralizada aca para que los seis avisos
// que la necesitan (alerta-asesor.js, aviso-cercano.js x2, resumen-equipo.js,
// advisor.js x2) compartan un solo texto — ver la nota junto a la funcion.
test("tocarNombreEnGrupo nombra a la persona y da la accion real (tocar el nombre), nunca 'responde en el grupo'", () => {
  const texto = tocarNombreEnGrupo("Natalia");
  assert.match(texto, /Natalia/);
  assert.match(texto, /tocá el nombre/i);
  assert.doesNotMatch(texto.normalize("NFD").replace(/[̀-ͯ]/g, ""), /responde\w*\s+en el grupo/i);
});
