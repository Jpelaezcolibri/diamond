// El puente del DM del radar a Sofi (spec 2026-10-07 §3). El DM sale por la
// linea de los grupos y casi todos los colegas los tenemos solo por lid (sin
// telefono), asi que cuando escribian a la linea oficial Sofi los trataba como
// clientes. Cada DM lleva un codigo corto en los links a Sofi; cuando el colega
// escribe con ese codigo, Sofi sabe que pedido es y le amarramos el telefono
// real a su ficha (colegas_grupos), para reconocerlo siempre despues.

const supabase = require("../data/supabase");
const memory = require("../data/memory");
const colegas = require("../data/colegas");
const { mismoTelefono } = require("../data/advisors");

// Sin 0/O ni 1/I: el codigo se lee y se dicta.
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const COLUMNAS =
  "id, autor_nombre, respuesta_destino_lid, respuesta_destino_telefono, texto_original, zona, tipo, operacion, created_at, matches, respuesta_refs, respondida_at, codigo_colega";

function generarCodigo(rand = Math.random) {
  let c = "";
  for (let i = 0; i < 4; i++) c += ALFABETO[Math.floor(rand() * ALFABETO.length)];
  return c;
}

function leerCodigo(texto) {
  const m = /c[oó]d\.?\s*([A-Za-z0-9]{4})\b/i.exec(String(texto || ""));
  if (!m) return null;
  const c = m[1].toUpperCase();
  return /^[A-HJ-NP-Z2-9]{4}$/.test(c) ? c : null;
}

async function asignarCodigo(orgId, signalId) {
  if (!orgId || !signalId) return null;
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (!s) return null;
    if (!s.codigo_colega) s.codigo_colega = generarCodigo();
    return s.codigo_colega;
  }
  try {
    const { data: actual } = await supabase
      .from("group_signals")
      .select("codigo_colega")
      .eq("org_id", orgId)
      .eq("id", signalId)
      .maybeSingle();
    if (actual && actual.codigo_colega) return actual.codigo_colega;
    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigo();
      const { error } = await supabase.from("group_signals").update({ codigo_colega: codigo }).eq("org_id", orgId).eq("id", signalId);
      if (!error) return codigo;
      if (error.code !== "23505") throw error; // 23505 = choque con el indice unico: probar otro codigo
    }
    return null;
  } catch (e) {
    // Falla abierta: el DM sale como antes, sin codigo.
    console.warn("[codigo-colega] No se pudo asignar codigo:", e.message);
    return null;
  }
}

async function resolver(orgId, codigo) {
  if (!orgId || !codigo) return null;
  if (!supabase) return memory.groupSignals.find((s) => s.org_id === orgId && s.codigo_colega === codigo) || null;
  const { data, error } = await supabase
    .from("group_signals")
    .select(COLUMNAS)
    .eq("org_id", orgId)
    .eq("codigo_colega", codigo)
    .maybeSingle();
  if (error) {
    console.warn("[codigo-colega] No se pudo resolver el codigo:", error.message);
    return null;
  }
  return data || null;
}

async function filaPorLid(orgId, lid) {
  if (!supabase) return memory.colegasGrupos.find((c) => c.org_id === orgId && c.lid === lid) || null;
  const { data } = await supabase.from("colegas_grupos").select("lid, telefono, nombre").eq("org_id", orgId).eq("lid", lid).maybeSingle();
  return data || null;
}

async function marcarEscribio(orgId, signalId) {
  const ahora = new Date().toISOString();
  if (!supabase) {
    const s = memory.groupSignals.find((x) => x.org_id === orgId && x.id === signalId);
    if (s && !s.colega_escribio_at) s.colega_escribio_at = ahora;
    return;
  }
  await supabase
    .from("group_signals")
    .update({ colega_escribio_at: ahora })
    .eq("org_id", orgId)
    .eq("id", signalId)
    .is("colega_escribio_at", null);
}

// Si el texto trae el codigo de un DM, devuelve { colega, senal } y amarra el
// telefono a la ficha del colega (solo si no tenia uno: si tenia otro, no se
// pisa — alguien pudo reenviar el link). null si no hay codigo o no existe.
async function reconocer(orgId, telefono, texto) {
  const codigo = leerCodigo(texto);
  if (!codigo) return null;
  const senal = await resolver(orgId, codigo);
  if (!senal) return null;
  const tel = String(telefono || "").replace(/\D/g, "");
  const lid = String(senal.respuesta_destino_lid || "").replace(/@.*$/, "").replace(/\D/g, "");
  let nombre = senal.autor_nombre || null;

  if (lid) {
    const fila = await filaPorLid(orgId, lid).catch(() => null);
    if (fila && fila.nombre) nombre = fila.nombre;
    if (fila && fila.telefono && !mismoTelefono(fila.telefono, tel)) {
      console.warn(`[codigo-colega] El colega del codigo ${codigo} ya tiene otro telefono; no se pisa.`);
    } else if (tel) {
      await colegas.upsert(orgId, { lid, telefono: tel, nombre });
    }
  }
  await marcarEscribio(orgId, senal.id).catch((e) => console.warn("[codigo-colega] No se pudo marcar colega_escribio_at:", e.message));
  return { colega: { lid: lid || null, telefono: tel, nombre }, senal };
}

module.exports = { generarCodigo, leerCodigo, asignarCodigo, resolver, reconocer };
