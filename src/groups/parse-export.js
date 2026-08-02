// Parser de exports de chat de WhatsApp (opcion "Sin archivos").
//
// Soporta los dos formatos que produce la app segun la plataforma:
//   Android:  5/07/2026, 10:32 a. m. - Autor: texto
//   iOS:     [5/07/2026, 10:32:15 a. m.] Autor: texto
//
// Y las tres cosas que rompen un parser ingenuo:
//   1. Mensajes multilinea — las lineas siguientes NO llevan timestamp.
//   2. Mensajes de sistema — no tienen "Autor:", los emite WhatsApp.
//   3. Espacios raros — WhatsApp mete U+202F (narrow nbsp) antes de "a. m."
//      y marcas de direccion U+200E al inicio de lineas de sistema/adjuntos.
//      Sin normalizarlos, ninguna expresion regular con \s los captura.
//
// Los caracteres invisibles van SIEMPRE como escapes \u: escritos literales,
// el archivo se vuelve imposible de editar por busqueda de texto.

// Marcas de direccion (invisibles) que WhatsApp intercala. Se eliminan.
const MARCAS_DIRECCION = /[‎‏‪-‮]/g;
// Variantes de espacio que rompen \s+ literal en algunas locales.
const ESPACIOS_RAROS = /[  ]/g;
// Diacriticos sueltos tras normalizar en NFD.
const DIACRITICOS = /[̀-ͯ]/g;

// Cabecera de mensaje. La fecha es d/m/aa o d/m/aaaa (es-CO); la hora admite
// segundos (iOS) y sufijo a. m./p. m. con o sin puntos y espacios.
const FECHA = String.raw`(\d{1,2}\/\d{1,2}\/\d{2,4})`;
const HORA = String.raw`(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?\s*m\.?)?)`;
const CABECERA_ANDROID = new RegExp(String.raw`^${FECHA},?\s+${HORA}\s+-\s+([\s\S]*)$`, "i");
const CABECERA_IOS = new RegExp(String.raw`^\[${FECHA},?\s+${HORA}\]\s*([\s\S]*)$`, "i");

// Separa "Autor: texto". El limite de 60 caracteres evita tragarse mensajes de
// sistema con dos puntos ("Fulano cambio el asunto del grupo a: Ventas") como
// si el nombre del autor fuera la frase entera.
const AUTOR = /^([^:\n]{1,60}):\s?([\s\S]*)$/;

// Frases con las que WhatsApp abre sus propios mensajes. No pretende ser
// exhaustiva: un mensaje de sistema mal clasificado cae igual en el prefiltro
// por no tener senal inmobiliaria, asi que el costo de un fallo es ~cero.
const MARCADORES_SISTEMA = [
  "los mensajes y las llamadas est", // "estan cifrados de extremo a extremo"
  "messages and calls are end-to-end",
  "anadio a", "agrego a",
  "salio del grupo",
  "elimino a",
  "cambio el asunto",
  "cambio el icono",
  "cambio la descripcion",
  "creo el grupo",
  "se unio usando el enlace",
  "ahora es administrador",
  "cambio su numero",
  "mensajes temporales",
  "se elimino este mensaje",
  "added", "left", "removed", "changed the subject", "created group", "joined using",
];

// Marcadores de adjunto sin texto util.
const MARCADORES_MULTIMEDIA = [
  "<multimedia omitido>", "<media omitted>",
  "imagen omitida", "image omitted",
  "video omitido", "video omitted",
  "audio omitido", "audio omitted",
  "sticker omitido", "sticker omitted",
  "gif omitido", "gif omitted",
  "documento omitido", "document omitted",
  "<adjunto:", "<attached:",
];

function normalizar(linea) {
  return linea.replace(MARCAS_DIRECCION, "").replace(ESPACIOS_RAROS, " ");
}

// Sin acentos y en minusculas, para comparar contra los marcadores sin que un
// export acentuado y otro sin acentos den resultados distintos.
function plano(texto) {
  return texto.toLowerCase().normalize("NFD").replace(DIACRITICOS, "");
}

function esSistema(contenido) {
  const t = plano(contenido);
  return MARCADORES_SISTEMA.some((m) => t.includes(m));
}

function esMultimedia(texto) {
  const t = plano(texto);
  return MARCADORES_MULTIMEDIA.some((m) => t.includes(m));
}

// Devuelve {fecha, hora, contenido} si la linea abre un mensaje, o null si es
// continuacion del anterior.
function parseCabecera(linea) {
  const m = CABECERA_IOS.exec(linea) || CABECERA_ANDROID.exec(linea);
  if (!m) return null;
  return { fecha: m[1], hora: m[2], contenido: m[3] };
}

// d/m/aa o d/m/aaaa -> Date. WhatsApp usa el orden de la locale del telefono;
// en es-CO es dia/mes/ano. Un ano de dos digitos se asume 20xx.
function parseFecha(fecha) {
  const [d, m, a] = fecha.split("/").map((n) => parseInt(n, 10));
  if (!d || !m || !a) return null;
  const ano = a < 100 ? 2000 + a : a;
  const date = new Date(Date.UTC(ano, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

// "8:12 a. m." -> {h: 8, min: 12}. Devuelve null si no se puede leer.
//
// Hace falta para el import incremental: sin hora, todos los mensajes de un
// dia comparten instante y la marca de agua se come el resto de la jornada —
// justo el caso de exportar en la mañana y otra vez al mediodia.
function parseHora(hora) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m\.?)?$/i.exec(String(hora || "").trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const seg = m[3] ? parseInt(m[3], 10) : 0;
  const sufijo = m[4]?.toLowerCase();
  if (sufijo === "p" && h < 12) h += 12;   // 12 p.m. ya es 12
  if (sufijo === "a" && h === 12) h = 0;   // 12 a.m. es medianoche
  if (h > 23 || min > 59) return null;
  return { h, min, seg };
}

// Instante del mensaje, en la zona del telefono que exporto.
//
// Se guarda como UTC nominal —no se convierte de zona— porque el export no
// dice en que zona esta el telefono. Para lo unico que se usa es para ordenar
// y comparar mensajes del MISMO grupo entre si, y para eso alcanza: todos
// vienen del mismo telefono.
function parseInstante(fecha, hora) {
  const dia = parseFecha(fecha);
  if (!dia) return null;
  const t = parseHora(hora);
  if (!t) return dia; // sin hora legible, queda el arranque del dia
  return new Date(dia.getTime() + (t.h * 3600 + t.min * 60 + t.seg) * 1000);
}

// texto: contenido crudo del .txt. grupo: etiqueta para poder rastrear de que
// export salio cada mensaje cuando se procesan varios juntos.
function parseExport(texto, { grupo = "sin-nombre" } = {}) {
  const lineas = String(texto).split(/\r?\n/);
  const mensajes = [];
  let actual = null;

  const cerrar = () => {
    if (!actual) return;
    actual.texto = actual.texto.trim();
    actual.esMultimedia = esMultimedia(actual.texto);
    mensajes.push(actual);
    actual = null;
  };

  for (const cruda of lineas) {
    const linea = normalizar(cruda);
    const cabecera = parseCabecera(linea);

    if (!cabecera) {
      // Continuacion del mensaje anterior. Una linea suelta antes del primer
      // timestamp (cabecera del export) simplemente se ignora.
      if (actual) actual.texto += `\n${linea}`;
      continue;
    }

    cerrar();

    const { fecha, hora, contenido } = cabecera;
    const fechaDate = parseFecha(fecha);
    const instante = parseInstante(fecha, hora);
    const base = {
      id: `${grupo}#${mensajes.length}`,
      grupo,
      fecha,
      hora,
      // Solo el dia: es lo que se muestra y con lo que se cuenta el rango.
      fechaIso: fechaDate ? fechaDate.toISOString().slice(0, 10) : null,
      // Con hora: es la que ordena y la que usa la marca de agua del import.
      instanteIso: instante ? instante.toISOString() : null,
      esSistema: false,
      esMultimedia: false,
    };

    if (esSistema(contenido)) {
      actual = { ...base, autor: null, texto: contenido, esSistema: true };
      continue;
    }

    const autorMatch = AUTOR.exec(contenido);
    if (autorMatch) {
      actual = { ...base, autor: autorMatch[1].trim(), texto: autorMatch[2] };
    } else {
      // Cabecera valida sin "Autor:" y sin marcador conocido: es de sistema.
      actual = { ...base, autor: null, texto: contenido, esSistema: true };
    }
  }

  cerrar();
  return mensajes;
}

// Rango real del export. `dias` cuenta dias transcurridos (no dias con
// actividad): es lo que permite normalizar las metricas "por dia" del reporte
// sin inflarlas cuando el grupo estuvo quieto una semana.
function rangoDeFechas(mensajes) {
  const fechas = mensajes.map((m) => m.fechaIso).filter(Boolean).sort();
  if (fechas.length === 0) return { desde: null, hasta: null, dias: 0 };
  const desde = fechas[0];
  const hasta = fechas[fechas.length - 1];
  const ms = new Date(hasta).getTime() - new Date(desde).getTime();
  return { desde, hasta, dias: Math.max(1, Math.round(ms / 86400000) + 1) };
}

module.exports = { parseExport, rangoDeFechas, esSistema, esMultimedia, normalizar, plano, parseHora, parseInstante };
