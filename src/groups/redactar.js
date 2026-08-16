// Redacta el mensaje que Sofi publica dentro del grupo gremial.
//
// Vive en el servidor, no en el CRM: el borrador de crm/components/senales-grupos.tsx
// se escribio para que un humano lo copiara y lo corrigiera de paso. Aca no hay
// humano corrigiendo, asi que cada campo pasa por src/lib/formato.js y ninguna
// propiedad llega sin pasar por src/groups/publicable.js.
//
// Decisiones de contenido, todas con motivo:
//   · Maximo 3 propiedades. Seis bloques de cuatro lineas son un muro en un
//     grupo activo, y el cuarto match ya suele ser relleno.
//   · Ref visible. Sin ella el colega no puede referenciar la propiedad ni
//     cruzarla contra lo que ya vio en otro grupo.
//   · Operacion explicita. Hoy el inventario es 100% venta, pero el dia que
//     entre arriendo un "$2.200.000" sin la palabra arriendo se lee como una
//     venta absurda.
//   · Link a la landing propia, nunca a Wasi: mandar al colega a Wasi es
//     regalarle la marca. La compuerta lo verifica ademas.
//   · Se firma como Diamond y se avisa que es automatico. En un grupo de 80
//     colegas el disfraz se descubre, y descubrirlo cuesta mas que declararlo.

const formato = require("../lib/formato");

const MAX_PROPIEDADES = 3;

function primerNombre(nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) return null;
  // Los nombres de WhatsApp traen emojis y adornos; si no queda nada usable, se
  // saluda sin nombre antes que saludar a "🏠🔥".
  const palabra = limpio.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]/gu, "");
  if (palabra.length < 2) return null;
  // Se normaliza la capitalizacion: en la base la asesora esta como "katherine
  // Uribe" (minuscula), y los nombres de WhatsApp vienen en MAYUSCULAS a menudo.
  return palabra.charAt(0).toLocaleUpperCase("es-CO") + palabra.slice(1).toLocaleLowerCase("es-CO");
}

// Algunos titulos de Wasi son una sola palabra generica —"Apartamento", "Casa"—
// porque el asesor no llenó el campo. Publicado en un grupo, "1) Apartamento" no
// le dice nada a nadie y se lee como un volcado automatico. Cuando pasa, se
// compone con la zona, que es el dato que el colega esta buscando.
const TITULOS_GENERICOS = new Set([
  "apartamento", "casa", "local", "oficina", "lote", "finca", "bodega", "apartaestudio", "consultorio",
]);

function tituloUtil(match) {
  const titulo = formato.normalizarTitulo(match.titulo);
  if (!titulo) return null;
  const zona = String(match.zona || "").trim();
  if (zona && TITULOS_GENERICOS.has(titulo.toLocaleLowerCase("es-CO"))) {
    return `${titulo} en ${zona}`;
  }
  return titulo;
}

// Una propiedad, en cuatro lineas: titulo / ref+operacion+zona / medidas+precio / link.
function ficha(match, indice) {
  const titulo = tituloUtil(match);
  const operacion = String(match.operacion || "").trim();
  const zona = String(match.zona || "").trim();

  const identidad = [`Ref ${match.ref}`, operacion || null, zona || null].filter(Boolean).join(" · ");

  const medidas = [
    formato.formatearArea(match.area),
    formato.pluralizar(match.habitaciones, "alcoba"),
    formato.formatearPrecio(match.precio),
  ]
    .filter(Boolean)
    .join(" · ");

  return [`${indice}) ${titulo}`, `   ${identidad}`, `   ${medidas}`, `   ${match.link}`].join("\n");
}

// Devuelve el texto listo para publicar, o null si no hay nada que decir.
// `asesor` es la persona a la que se deriva (hoy Catherine, unica en rotacion de
// venta): se resuelve afuera con src/data/advisors.js y se pasa entero para que
// este modulo siga siendo puro y testeable.
function mensajeGrupo(senal, publicables, { asesor = null, maxPropiedades = MAX_PROPIEDADES } = {}) {
  const props = (publicables || []).slice(0, maxPropiedades);
  if (props.length === 0) return null;

  const nombre = primerNombre(senal && senal.autor_nombre);
  const saludo = nombre ? `Hola ${nombre}, vi tu solicitud.` : "Hola, vi tu solicitud.";
  const encabezado =
    props.length === 1
      ? `${saludo} Tengo esta opcion que puede servirte:`
      : `${saludo} Tengo ${props.length} opciones que pueden servirte:`;

  const bloques = props.map((m, i) => ficha(m, i + 1));

  const cierre = [];
  if (asesor && asesor.phone) {
    const quien = primerNombre(asesor.name) || "nuestra asesora";
    cierre.push(`Mas informacion con ${quien}: https://wa.me/${String(asesor.phone).replace(/\D/g, "")}`);
  }
  cierre.push("Comision compartida.");
  cierre.push("— Diamond Inmobiliaria (respuesta automatica)");

  return [encabezado, "", bloques.join("\n\n"), "", cierre.join("\n")].join("\n");
}

module.exports = { mensajeGrupo, ficha, primerNombre, tituloUtil, MAX_PROPIEDADES };
