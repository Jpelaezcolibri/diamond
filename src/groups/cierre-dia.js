// El cierre del dia: UN mensaje que le pregunta a la asesora en que quedaron
// LAS PROPIEDADES que se movieron hoy.
//
// POR QUE EXISTE (Juan, 2026-09-06). El recordatorio por pedido
// (src/scheduler/radar-recordatorio.js) le citaba a Natalia el texto que
// escribio el colega en el grupo: "¿en que quedo el pedido de 'Buenas tardes
// Quién tiene lotes para construir bodega en zona franca Rionegro...'?".
// Juan: "el asesor no sabe de que propiedad estan hablando". Es exacto. La
// asesora no gestiona pedidos ajenos — gestiona SUS propiedades, y las
// reconoce por referencia, no por el texto de un tercero.
//
// Ademas cobraba solo la mitad del trabajo: los pedidos que Sofi ya le habia
// mandado sola al colega nunca entraban al pool (pendientesDeAviso exige
// respondida_at null). En septiembre salieron 54 mensajes y quedo 1 solo
// resultado registrado.
//
// ESTE MODULO NO TOCA LA BASE NI MANDA NADA. Recibe señales y devuelve el
// texto y la numeracion; quien consulta, reclama y envia es
// src/scheduler/cierre-dia.js. Asi el armado del mensaje —lo unico que la
// asesora ve— se puede probar entero sin base de datos ni WhatsApp.

// Un mensaje de WhatsApp con veinte renglones no se lee. Las que no entran hoy
// vuelven mañana: siguen sin resultado, asi que siguen siendo candidatas.
const TOPE = 10;

const LARGO_TITULO = 46;

function primerNombre(advisor) {
  const nombre = String((advisor && advisor.name) || "").trim();
  return nombre ? nombre.split(/\s+/)[0] : null;
}

// DE QUE PROPIEDAD HABLAMOS, en orden de cercania a lo que de verdad paso:
//
//   1. respuesta_refs — lo que SALIO en el DM al colega. Es el dato mas fuerte
//      que hay: preguntar por otra seria preguntar por algo que nadie ofrecio.
//   2. refs_utiles    — lo que Sofi aprobo cuando el aviso fue a la asesora.
//   3. refs_dudosas   — el caso mas comun del camino asistido: no habia
//      ninguna limpia, y la dudosa ES la gestion que se le pidio.
//   4. el match de mayor puntaje, como ultimo recurso.
//
// Devuelve null si no hay ninguna. Una señal sin referencia NO entra al
// cierre: preguntar por una propiedad que no podemos nombrar es volver al bug
// que este modulo arregla.
function refDeLaSeñal(señal) {
  const candidatas = [
    señal.respuesta_refs,
    señal.revalidacion && señal.revalidacion.refs_utiles,
    señal.revalidacion && señal.revalidacion.refs_dudosas,
  ];
  for (const lista of candidatas) {
    if (Array.isArray(lista) && lista.length && lista[0]) return String(lista[0]);
  }
  const matches = Array.isArray(señal.matches) ? señal.matches : [];
  const mejor = matches.filter((m) => m && m.ref).sort((a, b) => (b.puntaje || 0) - (a.puntaje || 0))[0];
  return mejor ? String(mejor.ref) : null;
}

// Recorta en el ultimo espacio, nunca a mitad de palabra. En el ensayo con
// datos reales del 2026-09-05 el corte crudo dejaba renglones como
// "Apartamento en Venta en Otraparte, Envigado -...", que se lee como un error
// del sistema y no como el titulo de una propiedad.
function recortar(texto, largo) {
  if (texto.length <= largo) return texto;
  const cortado = texto.slice(0, largo);
  const ultimoEspacio = cortado.lastIndexOf(" ");
  const base = ultimoEspacio > largo / 2 ? cortado.slice(0, ultimoEspacio) : cortado;
  return `${base.replace(/[\s,.;:—-]+$/, "")}...`;
}

// El titulo sale del inventario (matches). NO se reescribe ni se resume con
// otras palabras: lo que la asesora ve en el CRM es lo que tiene que ver aca,
// o deja de reconocerlo. Lo unico que se hace es recortarlo.
function tituloDeLaRef(señal, ref) {
  const matches = Array.isArray(señal.matches) ? señal.matches : [];
  const m = matches.find((x) => x && String(x.ref) === ref);
  if (!m) return null;
  const crudo = String(m.titulo || "").replace(/\s+/g, " ").trim();
  const corto = recortar(crudo, LARGO_TITULO);
  const zona = String(m.zona || "").trim();
  // La zona solo se agrega si el titulo no la nombra ya. Repetirla gasta el
  // ancho del renglon en un dato que ya esta.
  if (corto && zona && !crudo.toLowerCase().includes(zona.toLowerCase())) return `${corto} · ${zona}`;
  return corto || zona || null;
}

// Los colegas del gremio firman con el oficio pegado al nombre ("Esteban
// Higuita Consultor Profesional Inmobiliario"). Lo que ubica la gestion es el
// nombre; el resto solo hace largo el renglon.
function nombreCorto(nombre) {
  const limpio = String(nombre || "").replace(/\s+/g, " ").trim();
  if (!limpio) return null;
  const palabras = limpio.split(" ");
  let corto = palabras[0];
  if (palabras[1] && `${corto} ${palabras[1]}`.length <= 24) corto = `${corto} ${palabras[1]}`;
  return corto;
}

// Hasta dos colegas por renglon. Con mas, se cuentan: la asesora necesita saber
// que hubo varios, no la lista entera.
function colegasDelItem(colegas) {
  if (colegas.length === 0) return null;
  if (colegas.length <= 2) return colegas.join(" y ");
  return `${colegas.slice(0, 2).join(", ")} y ${colegas.length - 2} más`;
}

function renglon(item) {
  // El nombre del colega ubica la gestion ("ah, la que me pidio Adriana").
  // Sin nombre no se deja el guion colgando: se corta el renglon.
  const cola = item.colega ? ` — ${item.colega}` : "";
  const medio = item.titulo ? ` · ${item.titulo}` : "";
  return `${item.n}) ${item.ref}${medio}${cola}`;
}

/**
 * Arma el cierre del dia de UNA asesora.
 *
 * @param señales  las que se movieron hoy y no tienen resultado todavia
 * @param advisor  quien lo recibe — el saludo sale de aca, nunca hardcodeado
 *                 (bug real del 2026-09-04: el recordatorio decia "Cathe,"
 *                 fijo y le llego a Natalia con el nombre de otra persona)
 * @returns { items, texto } o null si no hay nada nombrable que preguntar
 */
function armar(señales, advisor = null) {
  const lista = Array.isArray(señales) ? señales : [];

  // UNA PROPIEDAD, UN NUMERO (defecto visto en el ensayo con datos reales del
  // 2026-09-05: la casa de La Mota, ref 10012896, aparecia dos veces porque dos
  // señales distintas la ofrecieron). Pedirle a la asesora que responda dos
  // veces por la misma propiedad es justo lo que hace que no responda. Se
  // agrupa por referencia y el item se queda con TODAS sus señales: contestar
  // ese numero cierra las dos.
  const porRef = new Map();
  for (const señal of lista) {
    const ref = refDeLaSeñal(señal);
    if (!ref) continue;
    const previo = porRef.get(ref);
    const colega = nombreCorto(señal.autor_nombre);
    if (previo) {
      previo.signal_ids.push(señal.id);
      if (colega && !previo.colegas.includes(colega)) previo.colegas.push(colega);
      continue;
    }
    if (porRef.size >= TOPE) continue;
    porRef.set(ref, {
      signal_ids: [señal.id],
      ref,
      titulo: tituloDeLaRef(señal, ref),
      colegas: colega ? [colega] : [],
    });
  }

  if (porRef.size === 0) return null;

  const nombrables = [...porRef.values()].map((item, i) => ({
    n: i + 1,
    signal_ids: item.signal_ids,
    ref: item.ref,
    titulo: item.titulo,
    colega: colegasDelItem(item.colegas),
  }));

  // Lo que quedo afuera son SEÑALES sin listar, no propiedades: se cuentan las
  // que no entraron en ningun item.
  const listadas = new Set(nombrables.flatMap((i) => i.signal_ids));
  const sobran = lista.filter((s) => !listadas.has(s.id) && refDeLaSeñal(s)).length;
  const saludo = primerNombre(advisor);
  const encabezado =
    nombrables.length === 1
      ? `${saludo ? `${saludo}, c` : "C"}ierre del día. Esta propiedad tuya se movió hoy:`
      : `${saludo ? `${saludo}, c` : "C"}ierre del día. Estas ${nombrables.length} propiedades tuyas se movieron hoy:`;

  const partes = [encabezado, nombrables.map(renglon).join("\n")];

  // Solo se nombra el sobrante cuando de verdad quedaron afuera por el tope.
  // Un "y 0 más" es ruido, y peor: hace dudar de la lista que si esta.
  if (sobran > 0) partes.push(`(y ${sobran} más que te paso mañana, para no hacerte un mensaje eterno)`);

  partes.push(
    `Respondeme con el número y en qué quedó.\nEjemplo: "1 no servía, 3 hubo visita"`,
    `Con eso el radar aprende cuáles vale la pena volver a ofrecer.`
  );

  return { items: nombrables, texto: partes.join("\n\n") };
}

module.exports = { armar, refDeLaSeñal, TOPE };
