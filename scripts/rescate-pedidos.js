#!/usr/bin/env node
// Rescate de pedidos de colegas que se quedaron sin DM (Juan, 2026-10-20).
//
//   node scripts/rescate-pedidos.js [--horas 24] [--solo id1,id2] [--salida <dir>]   (prueba en seco)
//   node scripts/rescate-pedidos.js --horas 24 --aplicar                            (envia de verdad)
//
// Contra produccion, desde el checkout principal:
//   railway run --service diamond node ../diamond-rescate/scripts/rescate-pedidos.js --horas 24
// Los require son relativos a ESTE archivo; el .env que carga src/config.js es
// el del directorio desde donde se corre, y bajo `railway run` las variables
// inyectadas mandan sobre el (ver la nota en src/config.js).
//
// QUE HACE, pedido por pedido:
//   1. Toma las señales de demanda de las ultimas N horas sin respuesta y sin
//      que el colega le haya escrito a Sofi.
//   2. Junta el mismo pedido del mismo colega publicado en dos grupos con menos
//      de 15 min de diferencia: sale UN DM y se marcan las dos señales.
//   3. Vuelve a cruzar el pedido contra el inventario con el motor ACTUAL
//      (match.cruzar, el mismo del radar): los matches guardados son de antes
//      de los arreglos y no traen precio_texto_en_margen.
//   4. Lo que Sofi ya descarto (por algo que no sea "es de aliado") no sale; su
//      veredicto guardado se imprime al lado para que Juan lo vea. No se le
//      vuelve a preguntar a Sofi: el lote es determinista.
//   5. Compuerta de calidad con aclaracion (publicable.filtrar, conAclaracion,
//      umbral normal), link de Wasi que abra, carril de arriendo, solo llamada
//      y no reenviar lo que el colega ya recibio en 7 dias.
//   6. Arma los mensajes con redactar.mensajesAlColega, igual que el DM
//      automatico, y los imprime TAL CUAL saldrian.
//
// Con --aplicar, ademas: una sola sesion activa de la linea, horario L-S
// 8 a. m.-8 p. m. Bogota, cuota de WhatsApp < 80 % (si no se puede leer, NO
// envia), tope diario de la linea; 20-40 s entre colegas; para en el primer
// error de WAHA. Cada señal queda marcada como el automatico (marcarRespondida
// modo 'auto') con politica_motivo 'dm_con_aclaracion' u 'ok'.

const fs = require("node:fs");
const path = require("node:path");

const VENTANA_DUPLICADO_MS = 15 * 60 * 1000;
const PAUSA_MIN_MS = 20000;
const PAUSA_RANGO_MS = 20000;
const CODIGO_PROVISIONAL = "XXXX";

// ── Utilidades puras ──

function parsearArgs(argv) {
  const out = { horas: 24, aplicar: false, solo: null, salida: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--aplicar") out.aplicar = true;
    else if (a === "--horas") out.horas = Number(argv[++i]) || 24;
    else if (a === "--solo") out.solo = String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--salida") out.salida = argv[++i] || null;
  }
  return out;
}

const digitos = (v) => String(v || "").replace(/\D/g, "");

function enmascarar(v) {
  const d = digitos(v);
  return d ? `…${d.slice(-4)}` : null;
}

const normTexto = (t) =>
  String(t || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function fechaDe(s) {
  return new Date(s.fecha_mensaje || s.created_at).getTime();
}

function seleccionar(senales, solo = null) {
  const ids = solo && solo.length ? new Set(solo) : null;
  return (senales || []).filter(
    (s) => s && s.clase === "demanda" && !s.respondida_at && !s.colega_escribio_at && (!ids || ids.has(s.id))
  );
}

// El mismo colega con el mismo pedido en dos grupos dentro de 15 min.
function agruparDuplicados(senales) {
  const orden = [...senales].sort((a, b) => fechaDe(a) - fechaDe(b));
  const grupos = [];
  for (const s of orden) {
    const colega = digitos(s.autor_telefono) || normTexto(s.autor_nombre);
    const g = grupos.find(
      (x) =>
        x.colega === colega &&
        colega &&
        fechaDe(s) - fechaDe(x.principal) <= VENTANA_DUPLICADO_MS &&
        (x.texto === normTexto(s.texto_original) || x.clave === claveCampos(s))
    );
    if (g) g.duplicados.push(s);
    else grupos.push({ colega, texto: normTexto(s.texto_original), clave: claveCampos(s), principal: s, duplicados: [] });
  }
  return grupos.map(({ principal, duplicados }) => ({ principal, duplicados }));
}

function claveCampos(s) {
  return [s.operacion, s.tipo, s.zona, s.precio_max, s.habitaciones].map((v) => String(v ?? "").trim().toLowerCase()).join("|");
}

// Lo que Sofi ya descarto, con su veredicto guardado. Solo cuenta para las refs
// que Sofi VIO (las de signal.matches): una que el motor encuentra hoy y antes
// no, Sofi nunca la juzgo. Un descarte que dice "aliado" no vale: el lote solo
// cruza inventario propio (caso ccdc2404, "las tres son de aliados").
function excluirPorSofi(rev, matchesVistos, candidatas) {
  if (!rev) return { quedan: candidatas, excluidas: [] };
  const vistas = new Set((matchesVistos || []).map((m) => String(m && m.ref)));
  const utiles = new Set((rev.refs_utiles || []).map(String));
  const dudosas = new Set((rev.refs_dudosas || []).map(String));
  const motivoDudosa = new Map((rev.dudosas_motivo || []).map((d) => [String(d.ref), d.motivo]));
  const diceAliado = /aliad/i.test(String(rev.por_que || ""));
  const quedan = [];
  const excluidas = [];
  for (const m of candidatas) {
    const ref = String(m.ref);
    if (!vistas.has(ref) || utiles.has(ref)) {
      quedan.push(m);
    } else if (dudosas.has(ref)) {
      const motivo = motivoDudosa.get(ref) || "sin_motivo";
      if (motivo === "aliado" || motivo === "dato_que_no_registramos") quedan.push(m);
      else excluidas.push({ ref, motivo: `sofi_dudosa:${motivo}` });
    } else if (diceAliado) {
      quedan.push(m);
    } else {
      excluidas.push({ ref, motivo: "sofi_descarto" });
    }
  }
  return { quedan, excluidas };
}

// ── Dependencias reales (se cargan solo al correr el script) ──

function depsReales() {
  const organizations = require("../src/data/organizations");
  const supabase = require("../src/data/supabase");
  const { cruzar } = require("../src/groups/match");
  const syncEstado = require("../src/data/sync-estado");
  const verificarLink = require("../src/groups/verificar-link");
  const vivo = require("../src/groups/vivo");
  const directorio = require("../src/groups/directorio");
  const colegas = require("../src/data/colegas");
  const codigoColega = require("../src/groups/codigo-colega");
  const whatsappGroups = require("../src/data/whatsapp-groups");
  const waha = require("../src/lib/waha");
  const groupSignals = require("../src/data/group-signals");
  const envioColega = require("../src/groups/envio-colega");

  return {
    org: () => organizations.getDefault(),
    leerSenales: async (org, { desdeIso, solo }) => {
      if (!supabase) throw new Error("Hace falta SUPABASE_URL y SUPABASE_SERVICE_KEY.");
      let q = supabase.from("group_signals").select("*").eq("org_id", org.id).eq("clase", "demanda");
      q = solo && solo.length ? q.in("id", solo) : q.gte("created_at", desdeIso);
      const { data, error } = await q.is("respondida_at", null).is("colega_escribio_at", null).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    cruzar: async (org, s) => {
      const r = await cruzar([{ ...s, clase: "demanda", mensaje: {} }], { org });
      return (r.demandas[0] && r.demandas[0].matches) || [];
    },
    estadoInventario: (org, ahora) => syncEstado.estadoDelInventario(org.id, { ahora }),
    verificarLinks: (ms) => verificarLink.verificar(ms),
    quitarYaEnviadas: (org, destino, ms, ahora) => vivo.quitarYaEnviadas(org, destino, ms, ahora),
    telefonoDe: (orgId, lid) => directorio.telefonoDe(orgId, lid, {}),
    esSoloLlamada: (orgId, datos) => colegas.esSoloLlamada(orgId, datos),
    // En seco no se escribe nada: el codigo que ya tenga la señal o uno
    // provisional (el real se asigna al enviar).
    codigo: (org, s, { aplicar }) => (aplicar ? codigoColega.asignarCodigo(org.id, s.id) : s.codigo_colega || null),
    sesionActiva: async (org) => {
      const activas = (await whatsappGroups.listSessions(org.id)).filter((s) => s.estado === "activa");
      return activas.length === 1 ? activas[0].nombre : null;
    },
    cuotaDeLinea: (sesion) => waha.cuotaDeLinea(sesion).catch(() => null),
    dmsHoyLinea: (orgId, desdeIso) => groupSignals.dmsHoyLinea(orgId, desdeIso),
    enviarAlColega: (args) => envioColega.enviarAlColega(args),
    marcarRespondida: (orgId, id, datos) => groupSignals.marcarRespondida(orgId, id, datos),
    guardarPolitica: (orgId, id, datos) => groupSignals.guardarPolitica(orgId, id, datos),
    dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
    rand: Math.random,
    ahora: () => new Date(),
    log: (...a) => console.log(...a),
    escribirJson: (archivo, datos) => {
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.writeFileSync(archivo, JSON.stringify(datos, null, 2), "utf8");
    },
  };
}

// ── Un pedido: decide si sale y arma los mensajes exactos ──

async function planificar(org, s, deps, { ahora, aplicar = false, yaPlaneadas = null } = {}) {
  const publicable = require("../src/groups/publicable");
  const redactar = require("../src/groups/redactar");
  const carrilArriendo = require("../src/groups/carril-arriendo");
  const codigoColega = require("../src/groups/codigo-colega");
  const { pedidoDe, notasDelVeredicto, refsConAclaracion } = require("../src/groups/vivo");

  const rev = s.revalidacion || null;
  const base = {
    id: s.id,
    fecha: s.fecha_mensaje || s.created_at,
    colega: (String(s.autor_nombre || "").trim().split(/\s+/)[0]) || null,
    pedido: [s.operacion, s.tipo, s.zona, s.precio_max ? `hasta $${Math.round(s.precio_max / 1e6)}M` : null].filter(Boolean).join(" · "),
    sofi: rev
      ? { refs_utiles: rev.refs_utiles || [], refs_dudosas: rev.refs_dudosas || [], dudosas_motivo: rev.dudosas_motivo || [], por_que: rev.por_que || null }
      : null,
  };
  const no = (motivo, extra = {}) => ({ ...base, sale: false, motivo, ...extra });

  // Un colega que le escribe a Sofi "mas opciones para mi PEDIDO (cod. XXXX)"
  // no es un pedido nuevo.
  if (codigoColega.leerCodigo(s.texto_original)) return no("pedido_a_sofi");

  const lid = digitos(s.autor_telefono).length >= 10 ? digitos(s.autor_telefono) : null;
  const telefono = s.autor_telefono ? await Promise.resolve(deps.telefonoDe(org.id, s.autor_telefono)).catch(() => null) : null;
  if (!lid && !telefono) return no("sin_destino");
  const via = lid ? "lid" : "telefono";
  const destino = via === "lid" ? `lid ${enmascarar(lid)}` : `tel ${enmascarar(telefono)}`;

  const soloLlamada = await Promise.resolve(deps.esSoloLlamada(org.id, { lid, telefono, textoPedido: s.texto_original })).catch(() => null);
  if (soloLlamada === true) return no("colega_solo_llamada", { destino });
  if (soloLlamada !== false) return no("solo_llamada_no_verificable", { destino });

  if (rev && rev.es_pedido_real === false) return no("sofi_no_es_pedido", { destino });
  const esArriendo = carrilArriendo.esDelCarril(s);
  if (esArriendo && !carrilArriendo.carrilActivo()) return no("carril_apagado", { destino });

  const frescas = (await deps.cruzar(org, s)) || [];
  if (!frescas.length) return no("sin_match", { destino });

  const { quedan, excluidas } = excluirPorSofi(rev, s.matches, frescas);
  const inventario = await deps.estadoInventario(org, ahora);
  const { publicables: candidatas, descartados, aclaraciones } = publicable.filtrar(quedan, {
    syncFresco: Boolean(inventario && inventario.fresco),
    conAclaracion: true,
  });
  const { verificadas, rotas } = await deps.verificarLinks(candidatas);
  for (const r of rotas || []) descartados.push({ ref: r.ref, motivos: ["link_no_abre"] });
  const extra = { destino, excluidasPorSofi: excluidas, descartadas: descartados };
  if (!verificadas.length) {
    const motivo = (descartados[0] && descartados[0].motivos && descartados[0].motivos[0]) || (excluidas.length ? "sofi_descarto" : "sin_publicables");
    return no(motivo, extra);
  }
  if (esArriendo && !carrilArriendo.puedeSalirSolo(verificadas)) return no("carril_umbral", extra);

  let { quedan: aEnviar, repetidas } = await deps.quitarYaEnviadas(org, { lid, telefono }, verificadas, ahora);
  // En la misma corrida, lo que ya se le planeo a este colega por otro pedido.
  if (yaPlaneadas) {
    const ya = yaPlaneadas.get(lid || telefono) || new Set();
    const dentro = aEnviar.filter((m) => ya.has(String(m.ref)));
    repetidas = [...repetidas, ...dentro.map((m) => String(m.ref))];
    aEnviar = aEnviar.filter((m) => !ya.has(String(m.ref)));
  }
  if (!aEnviar.length) return no("ya_se_le_mando", { ...extra, repetidas });

  const props = aEnviar.slice(0, redactar.MAX_POR_DM);
  const notas = notasDelVeredicto(rev, aclaraciones, props);
  const codigo = (await deps.codigo(org, s, { aplicar })) || (aplicar ? null : CODIGO_PROVISIONAL);
  const armado = redactar.mensajesAlColega({ autor_nombre: s.autor_nombre }, aEnviar, {
    org,
    codigo,
    sinConfirmar: notas.sinConfirmar,
    leFalta: notas.leFalta,
    pedido: pedidoDe(s),
    ahora,
  });
  if (!armado) return no("sin_texto", extra);

  const aclaradas = new Map(aclaraciones.map((a) => [String(a.ref), a.detalle]));
  const refs = props.map((m) => String(m.ref));
  return {
    ...base,
    ...extra,
    sale: true,
    motivo: null,
    via,
    lid,
    telefono,
    repetidas,
    codigoProvisional: !aplicar && codigo === CODIGO_PROVISIONAL,
    fichas: props.map((m) => ({
      ref: String(m.ref), zona: m.zona || null, precio: m.precio || null, puntaje: m.puntaje, aclaracion: aclaradas.get(String(m.ref)) || null,
    })),
    mensajes: armado.mensajes.map((m) => ({ ref: m.ref || null, texto: m.texto })),
    motivoPolitica: refsConAclaracion(aclaraciones, refs).length ? "dm_con_aclaracion" : "ok",
    aclaraciones,
  };
}

// ── Frenos de la linea antes de cada envio ──

async function frenoDeLinea(org, sesion, deps, ahora) {
  const { enHorarioHabil } = require("../src/scheduler/radar-callado");
  const politica = require("../src/groups/politica");
  const limites = politica.LIMITES_DM_DEFAULT;
  if (!enHorarioHabil(ahora)) return "fuera_de_horario";
  const cuota = await deps.cuotaDeLinea(sesion);
  if (!cuota) return "cuota_no_verificable";
  if (cuota.fraccion >= limites.fraccionCuotaMaxima) return "cuota_whatsapp_alta";
  const desdeIso = new Date(ahora.getTime() - 24 * 3600 * 1000).toISOString();
  const dms = await deps.dmsHoyLinea(org.id, desdeIso);
  if (dms === null || dms === undefined) return "limite_linea_no_verificable";
  if (dms >= limites.topeDiarioLinea) return "limite_linea_alcanzado";
  return null;
}

// ── Impresion ──

function imprimirPedido(p, log) {
  const cuando = String(p.fecha || "").replace("T", " ").slice(0, 16);
  log(`\n${"=".repeat(72)}\n${p.sale ? "SALE" : "NO SALE"} · ${p.id} · ${cuando} UTC · ${p.colega || "colega"} ${p.destino || ""}`);
  log(`  pedido: ${p.pedido || "(sin datos)"}`);
  if (p.sofi) {
    log(`  Sofi: útiles [${p.sofi.refs_utiles.join(", ")}] · dudosas [${p.sofi.refs_dudosas.join(", ")}]${p.sofi.por_que ? ` · "${p.sofi.por_que}"` : ""}`);
  } else {
    log("  Sofi: sin veredicto guardado");
  }
  for (const e of p.excluidasPorSofi || []) log(`  excluida por Sofi: ${e.ref} (${e.motivo})`);
  for (const d of p.descartadas || []) log(`  descartada: ${d.ref} (${(d.motivos || []).join(", ")})`);
  if (!p.sale) {
    log(`  motivo: ${p.motivo}`);
    return;
  }
  if (p.duplicados && p.duplicados.length) log(`  mismo pedido en otro grupo (se marca también): ${p.duplicados.join(", ")}`);
  if (p.repetidas && p.repetidas.length) log(`  no se repiten (ya las recibió): ${p.repetidas.join(", ")}`);
  for (const f of p.fichas) {
    log(`  ficha ${f.ref} · ${f.zona || "?"} · ${f.precio || "?"} · puntaje ${f.puntaje}${f.aclaracion ? ` · aclaración: ${f.aclaracion}` : ""}`);
  }
  log(`  motivo al marcar: ${p.motivoPolitica}${p.codigoProvisional ? " · código XXXX provisional (el real se asigna al enviar)" : ""}`);
  p.mensajes.forEach((m, i) => {
    log(`\n  --- mensaje ${i + 1}/${p.mensajes.length}${m.ref ? ` (ref ${m.ref})` : ""} ---`);
    log(m.texto);
  });
}

// Sin el lid ni el telefono crudos: el JSON queda en disco.
function paraJson(p) {
  const { lid, telefono, aclaraciones, ...resto } = p;
  return resto;
}

// ── Corrida ──

async function ejecutar(opciones, deps) {
  const { horas = 24, aplicar = false, solo = null } = opciones;
  const log = deps.log;
  const inicio = deps.ahora();
  const org = await deps.org();
  const desdeIso = new Date(inicio.getTime() - horas * 3600 * 1000).toISOString();
  const senales = seleccionar(await deps.leerSenales(org, { desdeIso, solo }), solo);
  const grupos = agruparDuplicados(senales);

  log(`${aplicar ? "ENVÍO REAL" : "PRUEBA EN SECO (no envía ni escribe nada)"} · ${senales.length} señal(es), ${grupos.length} pedido(s) distinto(s) desde ${desdeIso}`);

  const resultado = {
    fecha: inicio.toISOString(), aplicar, horas, desdeIso, salen: [], noSalen: [], enviados: [], detenido: null, sesion: null,
  };

  let sesion = null;
  if (aplicar) {
    sesion = await deps.sesionActiva(org);
    resultado.sesion = sesion;
    if (!sesion) resultado.detenido = { id: null, motivo: "sin_sesion_activa" };
  }

  const yaPlaneadas = new Map();
  let enviadosAntes = 0;
  for (const g of grupos) {
    if (resultado.detenido) break;
    const s = g.principal;
    const p = await planificar(org, s, deps, { ahora: deps.ahora(), aplicar, yaPlaneadas });
    p.duplicados = g.duplicados.map((d) => d.id);
    if (!p.sale) {
      resultado.noSalen.push(p);
      imprimirPedido(p, log);
      continue;
    }
    const llave = p.lid || p.telefono;
    if (!yaPlaneadas.has(llave)) yaPlaneadas.set(llave, new Set());
    for (const f of p.fichas) yaPlaneadas.get(llave).add(f.ref);
    resultado.salen.push(p);
    imprimirPedido(p, log);
    if (!aplicar) continue;

    const freno = await frenoDeLinea(org, sesion, deps, deps.ahora());
    if (freno) {
      resultado.detenido = { id: s.id, motivo: freno };
      break;
    }
    if (enviadosAntes > 0) await deps.dormir(PAUSA_MIN_MS + Math.round(deps.rand() * PAUSA_RANGO_MS));

    const porLid = p.via === "lid";
    const envio = await deps.enviarAlColega({
      sesion,
      orgId: org.id,
      telefono: p.telefono || null,
      lid: porLid ? p.lid : null,
      respaldoTelefono: porLid ? p.telefono || null : null,
      mensajes: p.mensajes,
    });
    if (!envio || !envio.ok) {
      resultado.detenido = { id: s.id, motivo: "error_waha", error: (envio && envio.error) || "sin_respuesta" };
      break;
    }
    enviadosAntes++;

    const { refsConAclaracion } = require("../src/groups/vivo");
    const aclaradas = refsConAclaracion(p.aclaraciones, envio.refsEnviadas);
    const motivo = !envio.completo ? "dm_parcial" : aclaradas.length ? "dm_con_aclaracion" : "ok";
    const trazaBase = [
      "rescate",
      `destino:${p.via}`,
      `refs:${(envio.refsEnviadas || []).join(",")}`,
      ...(aclaradas.length ? [`con_aclaracion:${aclaradas.join(",")}`] : []),
      ...(envio.completo ? [] : [`faltaron:${(envio.faltantes || []).join(",")}`, `error:${envio.error}`]),
    ];
    for (const id of [s.id, ...p.duplicados]) {
      await deps.marcarRespondida(org.id, id, {
        texto: envio.texto, wamid: envio.wamid, modo: "auto", refs: envio.refsEnviadas,
        destinoTelefono: p.telefono || null,
        destinoLid: porLid ? `${p.lid}@lid` : null,
      });
      await deps.guardarPolitica(org.id, id, { motivo, traza: id === s.id ? trazaBase : [...trazaBase, `duplicado_de:${s.id}`] });
    }
    resultado.enviados.push({ id: s.id, duplicados: p.duplicados, refs: envio.refsEnviadas, completo: Boolean(envio.completo), motivo });
    log(`  ENVIADO (${motivo})`);
    if (!envio.completo) {
      resultado.detenido = { id: s.id, motivo: "error_waha", error: envio.error || "dm_parcial" };
      break;
    }
  }

  log(`\n${"=".repeat(72)}\nSalen: ${resultado.salen.length} · No salen: ${resultado.noSalen.length}` +
    (aplicar ? ` · Enviados: ${resultado.enviados.length}` : "") +
    (resultado.detenido ? ` · DETENIDO: ${resultado.detenido.motivo}${resultado.detenido.error ? ` (${resultado.detenido.error})` : ""}` : ""));

  const dir = opciones.salida || path.join(process.cwd(), "Claude outputs");
  const archivo = path.join(dir, `rescate-pedidos-${diaBogota(inicio)}.json`);
  deps.escribirJson(archivo, { ...resultado, salen: resultado.salen.map(paraJson), noSalen: resultado.noSalen.map(paraJson) });
  log(`JSON: ${archivo}`);
  return resultado;
}

function diaBogota(fecha) {
  return new Date(fecha.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

module.exports = {
  parsearArgs, enmascarar, seleccionar, agruparDuplicados, excluirPorSofi, planificar, ejecutar, frenoDeLinea,
};

if (require.main === module) {
  ejecutar(parsearArgs(process.argv.slice(2)), depsReales())
    .then((r) => process.exit(r.detenido && r.aplicar ? 2 : 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
