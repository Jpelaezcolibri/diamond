// construir() del aviso que recibe la asesora cuando Sofi aprueba una
// oportunidad de grupo (src/groups/alerta-asesor.js). Es una funcion pura
// (sin IO): no hace falta mockear nada, solo prender/apagar
// CONTACT_WHATSAPP_NUMBER por caso, igual que aviso-cercano.js.
//
// CAMBIO DE POLITICA (Juan, 2026-08-22): "que se notifique al celular de
// natalia todo para que ella lo responda directamente desde su numero" — el
// bug real que motivo esta suite: `senal.autor_telefono` es un @lid (14-17
// digitos), no un telefono real (medido en produccion: 12 de 12 eran LID), y
// el aviso terminaba diciendo "respondele en el grupo" el 100% de las veces —
// justo lo opuesto a la norma. Ahora `construir` recibe aparte el telefono ya
// resuelto por src/groups/directorio.js.

const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const { construir } = require("../src/groups/alerta-asesor");

function senal(extra = {}) {
  return {
    grupo_nombre: "Inmobiliarias Medellin",
    autor_nombre: "Patricia Gomez",
    autor_telefono: "141746805670125", // @lid tipico que llega de WhatsApp, no marcable
    texto_original: "Busco apartamento en Laureles, 3 alcobas",
    ...extra,
  };
}

const VEREDICTO = {
  es_pedido_real: true,
  sirve_alguna: true,
  refs_utiles: ["AP004"],
  por_que: "Es exactamente lo que pide: zona, alcobas y presupuesto calzan.",
};

function matchUtil(extra = {}) {
  return {
    ref: "AP004",
    titulo: "Apartamento en Venta Envigado",
    zona: "Centro, Envigado",
    precio: "$395.000.000",
    habitaciones: 2,
    area: "62m2",
    link: "https://diamondinmobiliaria.com/propiedades/ap004",
    ...extra,
  };
}

beforeEach(() => {
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("con telefono resuelto por el directorio, el aviso trae el link directo al privado", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/);
});

test("sin telefono resuelto, NO dice 'respondele en el grupo' -- dice que toque el nombre del colega", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], null);
  assert.doesNotMatch(texto, /respondele en el grupo/i);
  assert.match(texto, /tocá el nombre de Patricia Gomez en el grupo/);
});

test("sin pasar el cuarto parametro (llamador viejo), sigue funcionando igual que sin telefono", () => {
  // La firma nueva es aditiva: quien llame a construir(senal, veredicto,
  // matches) sin el cuarto argumento no se rompe.
  const texto = construir(senal(), VEREDICTO, [matchUtil()]);
  assert.doesNotMatch(texto, /respondele en el grupo/i);
  assert.match(texto, /tocá el nombre/);
});

test("sin telefono resuelto por el directorio, pero con autor_telefono marcable (@c.us), lo usa como ultimo intento", () => {
  // Revision 2026-08-24: WhatsApp a veces entrega el participante como @c.us
  // -numero visible, no LID- y el aviso decia "no se pudo resolver el
  // numero" TENIENDO el numero a mano en senal.autor_telefono.
  const texto = construir(senal({ autor_telefono: "573009998877" }), VEREDICTO, [matchUtil()], null);
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573009998877/);
  assert.doesNotMatch(texto, /tocá el nombre/);
});

test("el telefono YA RESUELTO por el directorio gana sobre autor_telefono", () => {
  const texto = construir(
    senal({ autor_telefono: "573000000009" }),
    VEREDICTO,
    [matchUtil()],
    "573001234567"
  );
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/);
  assert.doesNotMatch(texto, /573000000009/);
});

test("un @lid pasado por error como telefonoColega no arma un link roto", () => {
  // linkWhatsapp ya filtra esto, pero la ruta completa (directorio -> aca)
  // tiene que degradar igual de bien si algun dia llega un LID sin resolver.
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "141746805670125");
  assert.doesNotMatch(texto, /wa\.me\/141746805670125/);
  assert.match(texto, /tocá el nombre/);
});

test("con CONTACT_WHATSAPP_NUMBER definida, agrega el renglon listo para copiar hacia Sofi", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /escribirle a Sofi/);
  assert.match(texto, /https:\/\/wa\.me\/573000000001/);
});

test("el numero de la organizacion (multi-tenant, org.contact_whatsapp_number) gana sobre el env", () => {
  // Revision 2026-08-24: sin esto, una organizacion B le estaria ofreciendo
  // al colega la linea oficial de Diamond (ver db/migrations/2026-08-24_contact_whatsapp_number.sql).
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001"; // linea de Diamond
  const orgB = { id: "org-b", contact_whatsapp_number: "573000000009" };
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567", orgB);
  assert.match(texto, /https:\/\/wa\.me\/573000000009/);
  assert.doesNotMatch(texto, /573000000001/);
});

test("sin CONTACT_WHATSAPP_NUMBER, el aviso sale SIN el renglon de Sofi -- nunca un link a medias", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /escribirle a Sofi/);
  assert.doesNotMatch(texto, /YOUR_CONTACT_LINK/);
});

test("conserva lo que ya funcionaba: grupo, colega, pedido, refs, Sofi dice y el cierre", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /Inmobiliarias Medellin/);
  assert.match(texto, /Patricia Gomez/);
  assert.match(texto, /Busco apartamento en Laureles, 3 alcobas/);
  assert.match(texto, /Ref AP004/);
  assert.match(texto, /Sofi dice: Es exactamente lo que pide/);
  assert.match(texto, /Contame en qué quedó/);
});

test("sin refs utiles, no hay nada que avisar", () => {
  assert.strictEqual(construir(senal(), { ...VEREDICTO, refs_utiles: [] }, [matchUtil()], "573001234567"), null);
});

// AGREGADO (Juan, 2026-09-01) — "cuando no se puede responder al colega y la
// propiedad cumple, mandar el mensaje a Natalia/Catherine con una alerta que
// lo manden al colega inmediatamente, con la info del colega del grupo y de
// la propiedad": sin telefono resuelto, el aviso a la asesora hoy solo
// describe las propiedades -- no le entrega el texto ya armado (con nombre del
// colega y salvedades) para reenviar. Reusa src/groups/redactar.js#mensajeGrupo,
// el mismo texto "blanqueado" que ya se manda por DM cuando SI hay telefono.
test("sin telefono resuelto, el aviso incluye el mensaje listo para reenviar al colega, con urgencia", () => {
  const veredictoConSalvedad = { ...VEREDICTO, sin_confirmar: ["vista", "balcón"] };
  const texto = construir(
    senal(),
    veredictoConSalvedad,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null
  );
  assert.match(texto, /mandale ESTO YA/i);
  // El mensaje listo saluda por el nombre del colega (redactar.js#primerNombre)
  // y trae la salvedad de lo que no se pudo confirmar -- es el mismo contrato
  // que ya prueba redactar.test.js, aca solo se verifica que llegue armado.
  assert.match(texto, /Hola Patricia, vi tu solicitud/);
  assert.match(texto, /No tengo confirmado si tiene vista ni balcón/);
  assert.match(texto, /https:\/\/info\.wasi\.co\/apartamento-venta-ap004\/9744456/);
});

test("sin telefono resuelto pero sin ninguna propiedad con linkWasi (todas de un aliado), no agrega el bloque listo para copiar", () => {
  // El mensaje "blanqueado" depende de linkWasi (ver la nota de diseño en
  // redactar.js): una propiedad de un colega (fuente "aliado") no lo tiene, y
  // armar el bloque igual imprimiria un link vacio. Se omite entero, no a medias.
  const texto = construir(senal(), VEREDICTO, [matchUtil({ linkWasi: null })], null);
  assert.doesNotMatch(texto, /mandale ESTO YA/i);
});

test("con telefono resuelto, NO agrega el bloque de mensaje listo para copiar -- la asesora ya tiene el link directo", () => {
  const texto = construir(
    senal(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    "573001234567"
  );
  assert.doesNotMatch(texto, /mandale ESTO YA/i);
});

// "Para revisar" (Juan, 2026-09-01): refs_dudosas del veredicto (ver
// src/groups/revalidar.js) aparecen en el aviso al asesor, nunca en el DM
// al colega -- esa sigue siendo exclusiva de refs_utiles.

test("con refs_dudosas, el aviso agrega una seccion 'Para revisar' con esas propiedades", () => {
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const otraPropiedad = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" });
  const texto = construir(senal(), veredictoConDudosas, [matchUtil(), otraPropiedad], "573001234567");

  assert.match(texto, /Para revisar/i);
  assert.match(texto, /Ref AP009/);
  assert.match(texto, /Sabaneta/);
});

test("sin refs_dudosas (o vacio), no hay seccion 'Para revisar'", () => {
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /Para revisar/i);
});

test("un veredicto VIEJO sin refs_dudosas no revienta -- se trata como vacio", () => {
  const veredictoViejo = { ...VEREDICTO };
  delete veredictoViejo.refs_dudosas;
  const texto = construir(senal(), veredictoViejo, [matchUtil()], "573001234567");
  assert.doesNotMatch(texto, /Para revisar/i);
  assert.match(texto, /Ref AP004/, "el resto del aviso sigue funcionando igual");
});

// FIX (Juan, 2026-09-01) -- un veredicto con SOLO refs_dudosas (refs_utiles
// vacio) se estaba perdiendo por completo: exactamente el bug que
// refs_dudosas existe para evitar.
test("con SOLO refs_dudosas (refs_utiles vacio), el aviso SI se arma -- no se pierde", () => {
  const veredictoSoloDudosas = { ...VEREDICTO, refs_utiles: [], refs_dudosas: ["AP004"] };
  const texto = construir(senal(), veredictoSoloDudosas, [matchUtil()], "573001234567");
  assert.notStrictEqual(texto, null, "un veredicto solo-dudosas no puede devolver null");
  assert.match(texto, /Para revisar/i);
  assert.match(texto, /Ref AP004/);
});

test("con SOLO refs_dudosas, NO ofrece un mensaje listo para reenviar al colega (no hay nada confirmado que reenviar)", () => {
  const veredictoSoloDudosas = { ...VEREDICTO, refs_utiles: [], refs_dudosas: ["AP004"] };
  const texto = construir(
    senal(),
    veredictoSoloDudosas,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null // sin telefono resuelto -- el caso donde normalmente SI se arma el mensaje listo
  );
  assert.doesNotMatch(texto, /mandale ESTO YA/i);
});

test("sin ninguna ref (ni utiles ni dudosas), sigue devolviendo null", () => {
  const texto = construir(senal(), { ...VEREDICTO, refs_utiles: [], refs_dudosas: [] }, [matchUtil()], "573001234567");
  assert.strictEqual(texto, null);
});

test("las propiedades de 'Para revisar' NO llegan al mensaje listo para reenviar al colega", () => {
  // Cubre el constraint global: refs_dudosas nunca sale hacia el colega,
  // solo el asesor las ve. mensajeListoParaReenviar se arma con `utiles`
  // (refs_utiles), nunca con las dudosas -- esto lo confirma end-to-end
  // sobre el texto final, sin telefono resuelto (el caso donde SI se arma
  // ese mensaje).
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"], sin_confirmar: [] };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", linkWasi: "https://info.wasi.co/ap009" });
  const util = matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" });
  const texto = construir(senal(), veredictoConDudosas, [util, dudosa], null);

  // El bloque "mandale ESTO YA" es el mensaje blanqueado para el colega.
  const inicioMensajeListo = texto.indexOf("mandale ESTO YA");
  assert.notStrictEqual(inicioMensajeListo, -1);
  const mensajeListo = texto.slice(inicioMensajeListo);
  assert.doesNotMatch(mensajeListo, /AP009|Sabaneta/, "la dudosa no puede aparecer en el texto que se reenvia al colega");
});

// LIMITE DE META (Juan, 2026-09-01) -- un aviso real con 6 propiedades fue
// rechazado por WhatsApp ("Param text.body must be at most 4096 characters
// long."). Causa: dos invitaciones casi identicas a escribirle a Sofi (una
// dentro del mensaje para reenviar, otra aparte), mas la lista de
// propiedades repetida completa dos veces.

test("con mensaje para reenviar presente, NO se duplica la invitacion a escribirle a Sofi", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(
    senal(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null // sin telefono resuelto -- dispara el mensaje para reenviar
  );
  // Sin duplication: solo debe haber 1 bloque de invitacion a Sofi, dentro del mensaje
  // para reenviar. La invitacion separada NO se agrega cuando ya hay mensajeListo.
  const invitacionesAlSofi = (texto.match(/escribirle.*a Sofi/gi) || []).length;
  assert.ok(invitacionesAlSofi >= 1, `debe haber al menos 1 invitacion a Sofi`);
  // No debe haber un segundo bloque "Para que la conversación quede" fuera del reenvio:
  assert.match(texto, /mandale ESTO YA/, "debe estar el bloque para reenviar");
  // Pero NO debe haber otro bloque "Para que la conversación" separado que duplique la invitacion
  assert.doesNotMatch(texto, /Para que la conversación[\s\S]*Para que la conversación/,
    "no puede haber 2 bloques de 'Para que la conversacion' — eso seria duplicacion");
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("sin mensaje para reenviar (telefono resuelto), la invitacion a Sofi si aparece como antes", () => {
  process.env.CONTACT_WHATSAPP_NUMBER = "573000000001";
  const texto = construir(senal(), VEREDICTO, [matchUtil()], "573001234567");
  assert.match(texto, /escribirle a Sofi/i);
  delete process.env.CONTACT_WHATSAPP_NUMBER;
});

test("un pedido con muchas propiedades y mensaje para reenviar no pasa de 4096 caracteres, y no pierde ninguna ref", () => {
  // 8 propiedades, cada una con datos completos -- suficiente para reproducir
  // el caso real (6 propiedades ya alcanzaba a pasarse del limite).
  const muchasRefs = Array.from({ length: 8 }, (_, i) => `AP0${i}`);
  const muchasProps = muchasRefs.map((ref) =>
    matchUtil({
      ref,
      titulo: `Apartamento en Venta Laureles ${ref}`,
      zona: "Laureles",
      linkWasi: `https://info.wasi.co/apartamento-venta-laureles-${ref}`,
      link: `https://diamondinmobiliaria.com/propiedades/${ref}`,
    })
  );
  const veredictoConTodas = { ...VEREDICTO, refs_utiles: muchasRefs, por_que: "Todas calzan en zona, precio y alcobas." };
  const texto = construir(senal(), veredictoConTodas, muchasProps, null);

  assert.ok(texto.length <= 4096, `el texto tiene ${texto.length} caracteres, se paso del limite de Meta`);
  // Ninguna ref se pierde -- sigue estando, aunque sea solo dentro del
  // mensaje para reenviar (que siempre lista todas completas).
  for (const ref of muchasRefs) assert.match(texto, new RegExp(ref), `falta ${ref} en el aviso`);
});

test("con pocas propiedades (mensaje corto), el listado 'Le puede(n) servir' sigue completo, no se comprime", () => {
  const texto = construir(
    senal(),
    VEREDICTO,
    [matchUtil({ linkWasi: "https://info.wasi.co/apartamento-venta-ap004/9744456" })],
    null
  );
  assert.match(texto, /Le puede servir:\n▸ Ref AP004/, "con un mensaje corto, no hace falta comprimir nada");
});
