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
//
// CAMBIO DELIBERADO (Juan, 2026-08-18) — "MENSAJE BLANQUEADO":
//
// Hasta esta fecha el mensaje llevaba el link a la landing propia y cerraba
// derivando a la asesora ("Mas informacion con Catherine: wa.me/...") firmado
// como "Sofi, asistente de Diamond Inmobiliaria". Juan pidio explicitamente
// lo contrario: el colega reenvia este mensaje TAL CUAL a su propio cliente
// final, asi que no puede llevar nada que identifique a Diamond — ni el link
// propio, ni el contacto de la asesora, ni "Diamond" en la firma.
//
//   · Link: linkWasi (el original de Wasi, ver withLandingLink en
//     src/data/properties.js), NO `link` (la landing propia). Es lo opuesto
//     de la regla de siempre para cualquier OTRO mensaje del sistema — sigue
//     valiendo en todos lados menos aca.
//   · Sin derivar a la asesora: el colega identifica con quien hablar por el
//     numero de WhatsApp que publico el mensaje en el grupo, no por un link
//     en el texto.
//   · Firma "Sofi, asistente virtual" — sin "de Diamond Inmobiliaria".
//
// Juan lo pidio con el riesgo explicito sobre la mesa: sin mencion a Diamond
// en el mensaje, no queda gancho de comision compartida si el colega cierra
// el negocio por su cuenta. Decision de negocio, no un descuido.
//
// AJUSTE (Juan, 2026-08-20): la firma "Sofi, asistente virtual" ahora lleva
// una invitacion a escribirle a la linea oficial de Sofi. No es un retroceso
// del blanqueado: el texto sigue sin decir "Diamond" en ningun lado, solo abre
// un canal directo con el asistente para quien quiera seguir la conversacion.
//
// CORRECCION (Juan, 2026-08-24): este mismo texto se reusa TAL CUAL para el DM
// directo al colega (ver src/groups/vivo.js#textoParaColega) porque es "el
// mismo mensaje que antes iba al grupo". Antes de esta fecha, vivo.js le
// agregaba UN SEGUNDO renglon con otro link a Sofi encima del que ya ponia
// esta funcion -- el colega recibia dos invitaciones seguidas a escribirle a
// la misma linea, una debajo de la otra, que se lee como descuido. Se deja
// UN SOLO renglon, armado aca, y se quita la duplicacion en vivo.js.
//
// El numero ya NO se declara con un default hardcodeado (rompia multi-tenant:
// otra organizacion heredaria el numero de Diamond). Se resuelve con
// linkContactoOficial(org) -- org por columna, env como fallback, sin link a
// medias si no hay numero configurado por ningun lado (ver src/lib/contacto.js).
//
// Sin ?text= (Juan, 2026-08-20): el mensaje precargado hacia el link larguisimo
// e ilegible en el chat. Se prefiere el wa.me limpio, sin abrir con un texto.
//
// SALVEDAD DE DATOS NO CONFIRMADOS (Juan, 2026-08-24): caso real, colega
// pidio apto en Envigado con terraza y max 6 años de antiguedad; teniamos 3
// propiedades con match del 100% en zona/alcobas/precio que Sofi descarto
// solo porque el inventario no registra terraza ni antiguedad -- el colega
// nunca supo que existian. `sin_confirmar` (ver src/groups/revalidar.js) es
// lo que evita perder ESE tipo de oportunidad: una linea honesta sobre lo que
// no se pudo verificar, nunca una afirmacion inventada. Respeta la regla que
// protege esta compuerta desde julio (ver publicable.js): decir "esto no lo
// tengo confirmado" no es presentar un dato falso como verdadero, es la
// diferencia entre mentir y ser honesto sobre un hueco.

const formato = require("../lib/formato");
const { linkContactoOficial } = require("../lib/contacto");
// Solo para ubicacionCoincide (ver gradoDeZona): la definicion de "misma
// zona" vive en el motor y aca no se reimplementa. Se importa del modulo
// hoja ./ubicacion.js y NO de ./match.js: match.js esta en un ciclo de
// require con vivo.js y los tests de asistido lo pisan entero en
// require.cache, asi que desde aca llegaba vacio.
const ubicacion = require("./ubicacion");

// SIN TOPE (Juan, 2026-08-20): "que no se restrinja a 3, que se envien los
// que tengan un scoring alto" — se manda TODO lo que ya paso la compuerta de
// calidad de src/groups/publicable.js (puntaje >= umbral, zona exacta o
// vecina, datos limpios). Esa compuerta es la que de verdad decide "esto es
// bueno", no un limite fijo de cantidad. Se deja el parametro por si algun
// dia hace falta acotar de nuevo, pero el default ya no trunca.
const MAX_PROPIEDADES = Infinity;

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

// Ficha completa (Juan, 2026-08-20): titulo / ref+operacion+zona /
// medidas+precio / banos+garajes+estrato (si el inventario los tiene) / link.
//
// El link es linkWasi (no `link`) — ver la nota de "MENSAJE BLANQUEADO" arriba.
// publicable.js ya garantizo que existe (motivo sin_link_wasi) antes de que
// una propiedad llegue hasta aca.
// `detalleFalta` (Juan, 2026-08-24, caso Edwin Ramirez): la aclaracion de lo
// que ESTA propiedad no cumple del pedido. Va DENTRO de la ficha y no en el
// encabezado —a diferencia de la salvedad de datos no confirmados— porque es
// un hecho de una propiedad puntual: en un mensaje con tres opciones, dos
// pueden tener los dos garajes y una no. Ponerlo arriba lo volveria una
// advertencia sobre el lote entero, que seria falso.
function ficha(match, indice, { detalleFalta = null } = {}) {
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

  // Solo si el inventario los tiene: un hueco de sync no se disfraza de "0
  // baños" o "estrato 0", que es peor que no decir nada (ver la misma regla
  // en las exigencias de match.js).
  const detalles = [
    formato.pluralizar(match.banos, "baño", "baños"),
    formato.pluralizar(match.garajes, "garaje"),
    formato.datoCargado(match.estrato) ? `estrato ${match.estrato}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lineas = [`${indice}) ${titulo}`, `   ${identidad}`, `   ${medidas}`];
  if (detalles) lineas.push(`   ${detalles}`);
  // Antes del link a proposito: el colega lee la aclaracion mientras todavia
  // esta mirando los datos de la propiedad, no despues de haberse ido al link.
  const falta = String(detalleFalta || "").trim();
  if (falta) lineas.push(`   Aclaración: ${falta}`);
  lineas.push(`   ${match.linkWasi}`);
  return lineas.join("\n");
}

// EL DESVIO ENTRE LO QUE PIDIO Y LO QUE LE MANDAMOS (Juan, 2026-09-05).
//
// EL CASO: Marsh Jaramillo pidio "2 alcobas sector Envigado" y recibio una
// propiedad en SABANETA con TRES alcobas, sin una palabra sobre ninguna de las
// dos cosas. Sofi lo sabia —el veredicto guardado decia "queda en Sabaneta
// (vecino a Envigado)... y tiene 3 alcobas (una mas de las pedidas)"— pero ese
// razonamiento moria en la base. El colega abre el mensaje, ve otra zona, y
// concluye que el bot no lee lo que le escriben. El dato no era falso; lo que
// quema la credibilidad es la omision.
//
// SE CALCULA, NO SE PREGUNTA. Sale de comparar el pedido con la ficha —dos
// datos que ya tenemos— en vez de confiar en que el modelo se acuerde de
// mencionarlo en `le_falta`: en los dos casos auditados `le_falta` vino vacio.
// Una regla que depende de que el modelo se acuerde no es una garantia.
//
// Solo habla de lo que puede comparar: sin zonas pedidas o sin habitaciones en
// el pedido, no dice nada — nunca inventa un desvio por falta de dato.
// LA ZONA LA JUZGA EL MOTOR, NO ESTA FUNCION (auditoria 2026-09-05, H5). La
// primera version comparaba por substring en los dos sentidos —el patron que
// match.js abandono en julio por 656 falsos positivos— y no sabia de subzonas
// ni de vecindad. Resultado medido: para San Joaquin pedido "Laureles" el
// motor decia EXACTA y esta funcion escribia "queda en San Joaquin, no en
// Laureles"; para Loma de los Balsos pedido "El Poblado", "no en El Poblado"
// siendo vecina. El colega recibia una objecion sobre una propiedad que
// estaba justo donde pidio.
//
// Ahora el grado sale de ubicacion.js#ubicacionCoincide (token exacto +
// subzona + vecindad), la misma funcion que usa el motor: se usa el grado que
// ya viaja en el match (`ubicacion`) y, si no viene
// —matches guardados antes de que existiera, fixtures viejos—, se recalcula
// con la misma funcion sobre los mismos datos. Una sola definicion de "misma
// zona" para el puntaje, para Sofi y para el mensaje.
const GRADOS = new Set(["exacta", "vecina", "otra_zona", "ciudad"]);

function gradoDeZona(match, pedido) {
  if (GRADOS.has(match.ubicacion)) return match.ubicacion;
  const zonas = (Array.isArray(pedido.zonas) ? pedido.zonas : [pedido.zona]).map((z) => String(z || "").trim()).filter(Boolean);
  if (!zonas.length) return null;
  const grado = ubicacion.ubicacionCoincide({ zona: match.zona || "", ciudad: match.ciudad || "" }, { zonas, zona: zonas[0] });
  return grado ? grado.grado : "otra_zona";
}

function desvios(match, pedido) {
  if (!pedido) return [];
  const salida = [];

  const zonasPedidas = (Array.isArray(pedido.zonas) ? pedido.zonas : [pedido.zona])
    .map((z) => String(z || "").trim())
    .filter(Boolean);
  const zonaProp = String(match.zona || "").trim();
  if (zonasPedidas.length > 0 && zonaProp) {
    const grado = gradoDeZona(match, pedido);
    const pedidas = zonasPedidas.join(" ni ");
    // "vecina" se dice como vecina: es verdad y es la razon por la que el
    // motor la dejo pasar. Solo "no en X" cuando de verdad esta en otro lado.
    if (grado === "vecina") salida.push(`queda en ${zonaProp}, vecina de ${zonasPedidas.join(" y ")}`);
    else if (grado !== "exacta") salida.push(`queda en ${zonaProp}, no en ${pedidas}`);
  }

  // SOBRAR NO ES FALLAR — la misma regla que el prompt de revalidar.js repite
  // en mayusculas. Solo se aclara lo que FALTA: quien pide 2 alcobas no se
  // queja de que haya 4, y decirselo se lee como una objecion. El caso que lo
  // destapo (Patricia Urreta, 2026-09-05): "Aclaración: 4 alcobas y pediste 2"
  // en un mensaje que le iba a un colega.
  const pedidas = Number(pedido.habitaciones) || 0;
  const tiene = Number(match.habitaciones) || 0;
  if (pedidas > 0 && tiene > 0 && tiene < pedidas) {
    salida.push(`${formato.pluralizar(tiene, "alcoba")} y pediste ${pedidas}`);
  }

  // EL AREA QUE SE QUEDA CORTA (Juan, 2026-09-05, caso Esteban Higuita). Pidio
  // "Area 80m2 en adelante" y la ref 9776631 tiene 77. Entra por el margen del
  // 10 % de match.js (MARGEN_AREA) y esta bien que entre — pero el colega
  // tiene que leerlo aca, no descubrirlo abriendo el link. Solo se avisa
  // cuando FALTA: que sobre area nunca es un problema para quien compra.
  const areaMin = Number(pedido.areaMin || pedido.area_min) || 0;
  const areaTiene = formato.parsearArea(match.area) || 0;
  if (areaMin > 0 && areaTiene > 0 && areaTiene < areaMin) {
    salida.push(`${areaTiene} m² y pediste desde ${areaMin}`);
  }

  return salida;
}

// Junta una lista de datos faltantes en una frase natural: "terraza",
// "terraza ni antigüedad", "terraza, antigüedad ni piso". Se conecta con "ni"
// (no "y") porque es una lista de cosas que NO se sabe, no de cosas que si
// se tienen -- "tiene terraza y antigüedad" leeria como una afirmacion.
function unirConNi(items) {
  const limpios = (items || []).map((s) => String(s || "").trim()).filter(Boolean);
  if (limpios.length === 0) return null;
  if (limpios.length === 1) return limpios[0];
  return `${limpios.slice(0, -1).join(", ")} ni ${limpios[limpios.length - 1]}`;
}

// La linea de salvedad (Juan, 2026-08-24, ver la nota de diseño arriba). Solo
// existe si `sinConfirmar` trae algo -- sin datos faltantes, no hay salvedad
// que escribir, y el mensaje sale exactamente igual que antes de este cambio
// (sin un renglon vacio ni un "no hay salvedades").
function lineaSalvedad(sinConfirmar, cantidadPropiedades) {
  const lista = unirConNi(sinConfirmar);
  if (!lista) return null;
  const verbo = cantidadPropiedades === 1 ? "tiene" : "tienen";
  return `No tengo confirmado si ${verbo} ${lista} — decime si querés que lo averigüe.`;
}

// Devuelve el texto listo para publicar, o null si no hay nada que decir.
//
// No recibe (ni deriva a) ningun asesor a proposito: es el mensaje
// "blanqueado" que el colega reenvia tal cual a su cliente, y no puede
// llevar nada que identifique a Diamond — ver la nota arriba.
//
// `org` (2026-08-24, opcional) es el registro de organizations, para que
// linkContactoOficial resuelva el numero multi-tenant (columna de la org,
// env como fallback). Sin org y sin env definida, el mensaje sale sin el
// renglon de invitacion a Sofi -- nunca con un link a medias.
//
// `sinConfirmar` (2026-08-24, opcional) es el array que devuelve el veredicto
// de Sofi (ver src/groups/revalidar.js) con lo que el pedido menciona y el
// inventario no registra para las propiedades que SI se mandan. No filtra
// nada -- solo agrega una linea honesta despues del encabezado.
//
// `leFalta` (2026-08-24, opcional) es el otro array del veredicto: [{ref,
// detalle}] con lo que una propiedad puntual NO cumple del pedido y si
// conocemos. Se indexa por ref y cada aclaracion se imprime dentro de SU
// ficha. Una ref que no esta en `publicables` simplemente no se usa; una
// propiedad sin entrada sale exactamente igual que antes de este cambio.
function mensajeGrupo(
  senal,
  publicables,
  { maxPropiedades = MAX_PROPIEDADES, org = null, sinConfirmar = [], leFalta = [], pedido = null } = {}
) {
  const props = (publicables || []).slice(0, maxPropiedades);
  if (props.length === 0) return null;

  const nombre = primerNombre(senal && senal.autor_nombre);
  const saludo = nombre ? `Hola ${nombre}, vi tu solicitud.` : "Hola, vi tu solicitud.";
  const encabezado =
    props.length === 1
      ? `${saludo} Tengo esta opcion que puede servirte:`
      : `${saludo} Tengo ${props.length} opciones que pueden servirte:`;
  const salvedad = lineaSalvedad(sinConfirmar, props.length);

  // Se indexa por ref (como string: la ref viaja como numero desde Wasi y
  // como string desde el veredicto de Sofi). Un veredicto guardado antes de
  // este cambio no trae `le_falta` y esto queda vacio, igual que si todas
  // cumplieran.
  const faltaPorRef = new Map(
    (Array.isArray(leFalta) ? leFalta : [])
      .filter((f) => f && f.ref && f.detalle)
      .map((f) => [String(f.ref), String(f.detalle)])
  );

  // El desvio calculado va PRIMERO en la aclaracion y la del modelo despues:
  // "queda en Sabaneta, no en Envigado · no tiene garaje registrado". Una sola
  // linea de Aclaración por ficha, no dos.
  const bloques = props.map((m, i) => {
    const delModelo = faltaPorRef.get(String(m.ref)) || null;
    // SIN REPETIR (2026-09-05). El modelo tambien puede haber escrito el mismo
    // desvio en 'le_falta', y la ficha salia con "113 m² y pediste desde 120 ·
    // tiene 113 m² y pediste mínimo 120". Si su texto ya menciona los mismos
    // numeros, el calculado sobra: el del modelo esta redactado para esa
    // propiedad puntual y se lee mejor.
    const numerosDelModelo = new Set(String(delModelo || "").match(/\d+/g) || []);
    const calculados = desvios(m, pedido).filter((d) => {
      const nums = d.match(/\d+/g) || [];
      return !(nums.length && nums.every((n) => numerosDelModelo.has(n)));
    });
    const detalle = [...calculados, delModelo].filter(Boolean).join(" · ");
    return ficha(m, i + 1, { detalleFalta: detalle || null });
  });

  const cierre = [
    "Comision compartida.",
    // "Sofi, asistente virtual" y nada mas: sin "de Diamond Inmobiliaria". El
    // colega identifica a quien responder por el numero de WhatsApp que
    // publico esto en el grupo, no por un nombre o link en el texto.
    "— Sofi, asistente virtual",
  ];

  const linkSofi = linkContactoOficial(org);
  if (linkSofi) {
    // Un solo renglon de invitacion (2026-08-24): la razon real de invitar a
    // escribirle a la linea oficial no es "mas informacion", es que ahi la
    // conversacion no corre el riesgo de baneo de una linea personal y queda
    // registrada en el CRM -- decirlo asi tambien es mejor copy para el DM
    // directo al colega, que reusa este mismo texto (ver vivo.js).
    cierre.push(
      "",
      "Para que la conversación quede en nuestro sistema, también podés escribirle directo a Sofi (nuestra línea oficial):",
      linkSofi
    );
  }

  // La salvedad va pegada al encabezado, antes del espacio en blanco que
  // separa las fichas: se lee como parte de la presentacion del pedido, no
  // como un aparte al final. Sin salvedad, esto es exactamente lo mismo que
  // antes de este cambio -- ni un renglon vacio de mas.
  const cabecera = salvedad ? [encabezado, salvedad] : [encabezado];

  return [...cabecera, "", bloques.join("\n\n"), "", cierre.join("\n")].join("\n");
}

module.exports = { mensajeGrupo, ficha, desvios, primerNombre, tituloUtil, lineaSalvedad, unirConNi, MAX_PROPIEDADES };
