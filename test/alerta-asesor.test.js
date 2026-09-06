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
  assert.strictEqual(invitacionesAlSofi, 1, `deberia aparecer una sola vez, aparecio ${invitacionesAlSofi} veces`);
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
  // 12 propiedades -- medido empiricamente (node -e reproduciendo este mismo
  // fixture): con 11 el mensaje SIN comprimir da 3968 caracteres (no dispara
  // la compresion, la prueba pasaria sin ejercer el branch); con 12 da 4274
  // (> 4000, SI dispara `armar(true)`) y el resultado final comprimido queda
  // en 2613. Sin este numero de propiedades, `assert.ok(texto.length <= 4096)`
  // pasa trivialmente sin haber corrido nunca la compresion -- que era
  // justo el hueco que encontro la revision de codigo.
  const muchasRefs = Array.from({ length: 12 }, (_, i) => `AP0${i}`);
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

  // Prueba positiva de que SI se comprimio (no solo que el resultado quedo
  // corto por casualidad): el renglon compacto de conteo esta presente...
  assert.match(texto, /Le pueden? servir \d+ propiedades? — el detalle completo/);
  // ...y el listado completo "Le pueden servir:\n▸ Ref ..." (la version SIN
  // comprimir de bloqueUtiles) no aparece en ningun lado.
  assert.doesNotMatch(texto, /Le pueden servir:\n▸/);
  assert.ok(texto.length <= 4096, `el texto tiene ${texto.length} caracteres, se paso del limite de Meta`);
  // Ninguna ref se pierde -- sigue estando, aunque sea solo dentro del
  // mensaje para reenviar (que siempre lista todas completas).
  for (const ref of muchasRefs) assert.match(texto, new RegExp(ref), `falta ${ref} en el aviso`);
});

// Caso real (Juan / revision post-review, 2026-09-01): la incidencia que
// origino todo este arreglo fue un aviso de 6 propiedades con datos de
// produccion (titulos completos, operacion, zona completa, banos/garajes/
// estrato, links largos de info.wasi.co) rechazado por Meta. Medido con este
// mismo fixture: sin comprimir da 4202 caracteres (> 4000, dispara
// `armar(true)`), comprimido queda en 3194. La suite de arriba usa
// propiedades "cortas" (matchUtil basico) que con 6 no alcanzan a pasar el
// tope -- por eso hace falta esta prueba aparte con la forma real de los
// datos, no solo con mas cantidad.
test("6 propiedades con datos de produccion (el caso real que motivo el fix) no pasan de 4096 caracteres", () => {
  function matchUtilProduccion(ref) {
    return {
      ref,
      titulo: "Apartamento en Venta Laureles Segunda Etapa",
      operacion: "Venta",
      zona: "Laureles, Medellin, cerca al Estadio",
      precio: "$450.000.000",
      habitaciones: 3,
      area: "85m2",
      banos: 3,
      garajes: 2,
      estrato: 5,
      link: `https://diamondinmobiliaria.com/propiedades/${ref}`,
      linkWasi: `https://info.wasi.co/apartamento-venta-laureles-segunda-etapa-${ref}/9744456`,
    };
  }
  const refs = Array.from({ length: 6 }, (_, i) => `AP0${i}`);
  const props = refs.map((ref) => matchUtilProduccion(ref));
  const leFalta = refs.map((ref) => ({
    ref,
    detalle: "no tiene balcón ni vista despejada, pero cumple el resto del pedido de zona y presupuesto",
  }));
  const veredictoRealista = {
    ...VEREDICTO,
    refs_utiles: refs,
    por_que:
      "Todas calzan en zona, alcobas y presupuesto; ninguna tiene el balcón exacto que pidió pero son la mejor opción disponible en el sector ahora mismo.",
    sin_confirmar: ["terraza", "antigüedad del edificio"],
    le_falta: leFalta,
  };
  // Sin telefono resuelto -- el camino que arma el mensaje para reenviar,
  // que es la fuente de la duplicacion que este tope existe para evitar.
  const texto = construir(senal(), veredictoRealista, props, null);
  assert.ok(texto.length <= 4096, `el texto tiene ${texto.length} caracteres, se paso del limite de Meta`);
  for (const ref of refs) assert.match(texto, new RegExp(ref), `falta ${ref} en el aviso`);
});

// Segundo cinturon de seguridad (Important #2, revision post-review,
// 2026-09-01): `armar(true)` solo comprime el listado repetido de
// propiedades -- no toca `texto_original` (lo que escribio el colega, texto
// libre) ni `veredicto.por_que` (salida de la IA), ninguno de los dos con
// tope de longitud. Este caso fuerza ambos: un `texto_original` de 2200
// caracteres mas 12 propiedades (que ya dispara la compresion por si sola,
// ver la prueba de arriba) da un resultado comprimido que TODAVIA se pasa de
// 4096 -- exactamente el escenario que el clamp final existe para atajar.
test("con un texto_original larguisimo, el clamp final garantiza <= 4096 aunque la compresion no alcance", () => {
  const muchasRefs = Array.from({ length: 12 }, (_, i) => `AP0${i}`);
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
  const textoOriginalLarguisimo = "x".repeat(2200);
  const texto = construir(senal({ texto_original: textoOriginalLarguisimo }), veredictoConTodas, muchasProps, null);

  assert.ok(texto.length <= 4096, `el texto tiene ${texto.length} caracteres, el clamp no funciono`);
  assert.ok(
    texto.endsWith("(recortado — ver el pedido completo en el CRM)"),
    "el clamp deberia dejar el sufijo de recorte al final"
  );
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

// construirAvisoPostDm (Juan, 2026-09-01): cuando el DM directo al colega
// SI sale, pero el pedido tenia propiedades dudosas, la asesora se entera
// igual -- antes esto se perdia en silencio.

test("construirAvisoPostDm: sin refs_dudosas, devuelve null -- no hay nada pendiente que avisar", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, VEREDICTO, [matchUtil()], ["AP004"]);
  assert.strictEqual(texto, null);
});

test("construirAvisoPostDm: con refs_dudosas, dice que ya se mando y que queda pendiente", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" });
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredictoConDudosas, [matchUtil(), dudosa], ["AP004"]);

  assert.notStrictEqual(texto, null);
  assert.match(texto, /Ya le mandé por privado a Patricia Gomez/i);
  assert.match(texto, /AP004/, "menciona lo que ya se envio");
  assert.match(texto, /Ref AP009/, "lista la dudosa con el mismo formato que 'Para revisar'");
  assert.match(texto, /Sabaneta/);
});

test("construirAvisoPostDm: sin refsEnviadas (undefined), no revienta -- solo no menciona nada enviado", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009" });
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredictoConDudosas, [dudosa], undefined);
  assert.notStrictEqual(texto, null);
  assert.match(texto, /Ya le mandé por privado a Patricia Gomez/i);
});

// AGREGADO (Juan, 2026-09-01): "si la asesora ve que esa propiedad tambien
// se puede mandar, tiene que tener el nombre del colega, el usuario y el
// nombre del grupo con un link que lleve directo al DM del colega, si no se
// puede el link entonces con la mayor cantidad de informacion posible" -- sin
// esto, si decide que SI vale la pena mandar una dudosa, no tenia con que.

test("construirAvisoPostDm: con telefono resuelto, incluye el grupo y un link directo al DM del colega", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Apartamento en Sabaneta", zona: "Sabaneta" });
  const senalConGrupo = { autor_nombre: "Patricia Gomez", grupo_nombre: "Inmobiliarias Medellin", autor_telefono: "573009998877" };
  const texto = construirAvisoPostDm(senalConGrupo, veredictoConDudosas, [matchUtil(), dudosa], ["AP004"], "573001234567");

  assert.match(texto, /Grupo: Inmobiliarias Medellin/);
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/, "link directo al DM del colega, no al grupo");
});

test("construirAvisoPostDm: sin telefono resuelto, cae al mismo fallback que construir() -- tocar el nombre en el grupo", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009" });
  const senalSinTelefono = { autor_nombre: "Patricia Gomez", grupo_nombre: "Inmobiliarias Medellin" };
  const texto = construirAvisoPostDm(senalSinTelefono, veredictoConDudosas, [dudosa], ["AP004"], null);

  // Sin link no se pierde el lead: queda toda la info para ubicar al colega a mano.
  assert.match(texto, /Contacto: no se pudo resolver el número/);
  assert.match(texto, /tocá el nombre de Patricia Gomez en el grupo/);
});

test("construirAvisoPostDm: sin grupo_nombre, no revienta -- dice 'sin nombre' en vez de fallar", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredictoConDudosas = { ...VEREDICTO, refs_dudosas: ["AP009"] };
  const dudosa = matchUtil({ ref: "AP009" });
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredictoConDudosas, [dudosa], ["AP004"]);
  assert.match(texto, /Grupo: sin nombre/);
});


// ── Lo que Juan pidio el 2026-09-02 mirando un aviso real que le llego:
// "que la asesora entienda por que no se envio de manera automatica, que
// entienda que busca el colega, que tenga el contacto del colega y la
// informacion de la propiedad con su link de wasi, no es necesario enviar el
// de diamond si no cabe en los caracteres".

const senalCompleta = {
  grupo_nombre: "PEDIDOS - BUSCANDO",
  autor_nombre: "Lu Vallejo",
  autor_telefono: "198161251463188",
  texto_original: "Busco apartamento para remodelar en Laureles, presupuesto 620",
  operacion: "compra",
  tipo: "apartamento",
  zonas: ["Laureles", "Simon Bolivar", "Castellana"],
  zona: "Laureles",
  precio_max: 620000000,
  habitaciones: 3,
  flexible_habitaciones: true,
};

const matchWasi = {
  fuente: "diamond",
  ref: "10013037",
  titulo: "Vendo Apartamento en San Joaquin",
  zona: "San Joaquin",
  area: "101m2",
  habitaciones: 3,
  precio: "$480.000.000",
  link: "https://diamondinmobiliaria.com/propiedades/vendo-apartamento-10013037",
  linkWasi: "https://info.wasi.co/apartamento-venta-san-joaquin/10013037?shared=whatsapp",
};

const veredictoOk = {
  es_pedido_real: true,
  sirve_alguna: true,
  refs_utiles: ["10013037"],
  refs_dudosas: [],
  sin_confirmar: [],
  le_falta: [],
  por_que: "Calza en zona y presupuesto.",
  confianza: 0.9,
};

test("la ficha lleva el link de WASI, nunca el de la landing de Diamond", () => {
  const texto = construir(senalCompleta, veredictoOk, [matchWasi], "573001234567");
  assert.ok(texto.includes(matchWasi.linkWasi), "tiene que llevar el link de Wasi");
  assert.ok(
    !texto.includes("diamondinmobiliaria.com"),
    "el link de la landing no puede aparecer: el colega se lo reenvia a su cliente"
  );
});

test("dice POR QUE el bot no le escribio solo al colega", () => {
  const sinTel = construir(senalCompleta, veredictoOk, [matchWasi], null, null, "sin_telefono");
  assert.match(sinTel, /Por qué no salió solo:/);
  // Nombra las DOS vias (2026-09-06). Desde que el @lid es el canal principal,
  // "no pudimos resolver el número" hacia pensar que faltaba un teléfono, y de
  // ahí salió que se explicara un envío fallido por un número faltante cuando
  // el @lid alcanzaba de sobra.
  assert.match(sinTel, /ni número ni @lid/i);
  assert.match(sinTel, /no tenía por dónde escribirle/i);

  const vencido = construir(senalCompleta, veredictoOk, [matchWasi], "573001234567", null, "pedido_vencido");
  assert.match(vencido, /media hora/i, "el motivo tiene que ser el de ESE pedido, no uno generico");
});

test("sin motivo conocido no se inventa una explicacion", () => {
  const texto = construir(senalCompleta, veredictoOk, [matchWasi], "573001234567", null, "ok");
  assert.ok(!texto.includes("Por qué no salió solo"), "callar es mejor que inventar un motivo");
});

test("resume en una linea que busca el colega, sin repetir campos que no pidio", () => {
  const texto = construir(senalCompleta, veredictoOk, [matchWasi], "573001234567");
  assert.match(texto, /Busca: compra · apartamento · Laureles, Simon Bolivar, Castellana · hasta \$620/);
  assert.match(texto, /3 alcobas \(o una menos con estudio\)/);
  assert.ok(!/baños/.test(texto.split("Lo escribió así")[0]), "no lista lo que el pedido no menciono");
});

test("un pedido sin datos extraidos sale como antes, sin la linea de resumen", () => {
  const pelado = { grupo_nombre: "G", autor_nombre: "X", texto_original: "hola" };
  const texto = construir(pelado, veredictoOk, [matchWasi], "573001234567");
  assert.ok(!texto.includes("Busca:"));
  assert.match(texto, /Pidió:/);
});

test("con telefono resuelto, el contacto es el link directo al privado", () => {
  const texto = construir(senalCompleta, veredictoOk, [matchWasi], "573001234567");
  assert.match(texto, /Contacto: https:\/\/wa\.me\/573001234567/);
});

// QUE PIDIO Y POR QUE NO SE MANDARON (Juan, 2026-09-05). Aviso real a Natalia
// por el pedido de Projency Inmobiliaria: decia que ya se mandaron dos refs y
// que la 9472581 quedo sin mandar, pero no que buscaba el colega ni por que
// Sofi la dejo afuera. Ahora el post-DM lleva el mismo pedido que el aviso
// normal y la razon de Sofi.
test("construirAvisoPostDm: dice que busca el colega, como lo escribio, y por que las dudosas no salieron", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredicto = {
    ...VEREDICTO,
    refs_dudosas: ["AP009"],
    por_que: "La 9472581 es una casa lote y el colega pidió apartamento; el precio calza pero el producto no.",
  };
  const dudosa = matchUtil({ ref: "AP009", titulo: "Casa lote en Laureles", zona: "Laureles" });
  const senal = {
    autor_nombre: "Projency Inmobiliaria",
    grupo_nombre: "SOLO POBLADO 7am 8pm",
    texto_original: "Busco apto en Laureles, 3 alcobas, hasta 1.800 millones, con parqueadero",
    operacion: "venta",
    tipo: "apartamento",
    zonas: ["Laureles"],
    precio_max: 1800000000,
    habitaciones: 3,
    garajes: 1,
  };
  const texto = construirAvisoPostDm(senal, veredicto, [matchUtil(), dudosa], ["AP004"], "573108212294");

  assert.match(texto, /Busca: venta · apartamento · Laureles · hasta \$1\.800\.000\.000 · 3 alcobas · 1 garaje/);
  assert.match(texto, /Lo escribió así:\n"Busco apto en Laureles, 3 alcobas, hasta 1\.800 millones, con parqueadero"/);
  assert.match(texto, /Por qué no se las mandé: La 9472581 es una casa lote/);
  // El orden: contacto, pedido, lo que quedo sin mandar, la razon.
  assert.ok(texto.indexOf("Busca:") < texto.indexOf("quedó sin mandar"));
  assert.ok(texto.indexOf("quedó sin mandar") < texto.indexOf("Por qué no se las mandé"));
});

test("construirAvisoPostDm: sin campos del pedido ni por_que, sale como antes -- sin lineas vacias", () => {
  const { construirAvisoPostDm } = require("../src/groups/alerta-asesor");
  const veredicto = { ...VEREDICTO, refs_dudosas: ["AP009"], por_que: "" };
  const texto = construirAvisoPostDm({ autor_nombre: "Patricia Gomez" }, veredicto, [matchUtil({ ref: "AP009" })], ["AP004"]);
  assert.ok(!/Busca:/.test(texto));
  assert.ok(!/Pidió:/.test(texto));
  assert.ok(!/Por qué no se las mandé/.test(texto));
  assert.ok(!/\n\n\n/.test(texto), "sin renglones vacios de mas");
});
