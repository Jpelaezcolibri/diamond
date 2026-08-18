const supabase = require("./supabase");
const memory = require("./memory");

// Asesores que entran a la ROTACION de leads organicos de una especialidad:
// activos, de esa especialidad, y con recibe_transferencias !== false (los
// marcados en false — decision 2026-07-25 — solo reciben leads por propiedad
// marcada a su nombre via captador_id; sin la columna, undefined = true).
// Pura, exportada para tests.
function rotationCandidates(list, especialidad) {
  const esp = (especialidad || "").toLowerCase();
  return (list || []).filter((a) => a.activo && a.especialidad === esp && a.recibe_transferencias !== false);
}

// Round-robin uno a uno: dado el id del ULTIMO asesor que recibio un lead de
// la rotacion, devuelve el siguiente (orden estable por id para que el "peek"
// sea deterministico entre cita y transferencia del mismo lead). Pura,
// exportada para tests.
function nextInRotation(rotation, lastId) {
  if (!rotation.length) return null;
  const sorted = [...rotation].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const idx = sorted.findIndex((a) => a.id === lastId);
  return sorted[(idx + 1) % sorted.length];
}

// Ultimo asesor DE LA ROTACION que recibio una transferencia en esta org —
// el estado del round-robin vive en leads.transferido_advisor_id, sin
// contadores aparte (sobrevive reinicios y replicas). Best-effort: si las
// columnas transferido_* no existen, arranca del primero.
async function lastTransferredId(orgId, rotationIds) {
  try {
    if (!supabase) {
      const conTransfer = memory.leads
        .filter((l) => l.org_id === orgId && l.transferido_advisor_id && rotationIds.includes(l.transferido_advisor_id))
        .sort((a, b) => String(b.transferido_at || "").localeCompare(String(a.transferido_at || "")));
      return conTransfer[0]?.transferido_advisor_id || null;
    }
    const { data, error } = await supabase
      .from("leads")
      .select("transferido_advisor_id")
      .eq("org_id", orgId)
      .in("transferido_advisor_id", rotationIds)
      .order("transferido_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.transferido_advisor_id || null;
  } catch (e) {
    console.warn("[advisors] No se pudo leer el ultimo transferido (rotacion arranca del primero):", e.message);
    return null;
  }
}

// Las PERSONAS que pueden recibir algo. Devuelve personas, no filas — la
// distincion es el punto de esta funcion.
//
// Una misma persona puede tener varias filas en `advisors`, una por
// especialidad: Danna Ospina existe tres veces (arriendo, vehiculos, venta) y
// es un modelo legitimo, porque el enrutamiento de leads es por especialidad.
// Pero quien recibe un mensaje es una persona con un telefono, no un rol. Sin
// deduplicar, a Danna le llegaban tres digests identicos cada manana — la forma
// mas rapida de ensenarle a un asesor a ignorar el digest, y ademas se paga
// cada envio de plantilla.
//
// `especialidades` acota a que mercados se le manda. Hoy Diamond solo tiene
// inventario de venta: mandarle el digest al asesor de arriendo o al de
// vehiculos cuesta plata y no puede terminar en negocio, porque no hay con que
// cruzar.
//
// Mismo criterio de elegibilidad que la rotacion de transferencias (activo +
// recibe_transferencias): es la misma pregunta de negocio.
function elegiblesEnLista(list, especialidades = []) {
  const permitidas = especialidades.map((e) => String(e).toLowerCase());
  const elegibles = (list || []).filter(
    (a) =>
      a.activo &&
      a.recibe_transferencias !== false &&
      a.phone &&
      (permitidas.length === 0 || permitidas.includes(String(a.especialidad || "").toLowerCase()))
  );

  // Una fila por telefono. Gana la que tiene login del CRM —es la identidad
  // con la que esa persona actua sobre las señales— y si ninguna lo tiene, la
  // primera por id, para que el resultado no dependa del orden de la consulta.
  const porTelefono = new Map();
  for (const a of [...elegibles].sort((x, y) => String(x.id).localeCompare(String(y.id)))) {
    const previo = porTelefono.get(a.phone);
    if (!previo || (!previo.auth_user_id && a.auth_user_id)) porTelefono.set(a.phone, a);
  }
  return [...porTelefono.values()];
}

async function listElegibles(orgId, { especialidades = [] } = {}) {
  let list;
  if (!supabase) {
    list = memory.advisors.filter((a) => a.org_id === orgId);
  } else {
    const { data, error } = await supabase
      .from("advisors").select("*").eq("org_id", orgId).eq("activo", true);
    if (error) throw error;
    list = data || [];
  }
  return elegiblesEnLista(list, especialidades);
}

// Busca el asesor de la org que recibe ESTE lead organico: rotacion uno a uno
// entre los elegibles de la especialidad. Fallbacks: cualquier elegible activo
// de la org, y si no hay tabla poblada, el asesor por defecto de la
// organizacion.
async function findForTransfer(org, especialidad) {
  let list;
  if (!supabase) {
    list = memory.advisors.filter((a) => a.org_id === org.id && a.activo);
  } else {
    const { data, error } = await supabase
      .from("advisors")
      .select("*")
      .eq("org_id", org.id)
      .eq("activo", true);
    if (error) throw error;
    list = data || [];
  }
  const rotation = rotationCandidates(list, especialidad);
  if (rotation.length === 1) return rotation[0];
  if (rotation.length > 1) {
    const lastId = await lastTransferredId(org.id, rotation.map((a) => a.id));
    return nextInRotation(rotation, lastId);
  }
  // Sin elegibles de la especialidad: cualquier elegible activo (nunca uno
  // excluido de transferencias), y de ultimas el asesor de la organizacion.
  const fallback = list.find((a) => a.recibe_transferencias !== false);
  if (fallback) return fallback;
  return org.advisor_phone
    ? { name: org.advisor_name || "Asesor", phone: org.advisor_phone, especialidad: "general" }
    : null;
}

// Busca el asesor (fila de advisors) vinculado a un login del CRM
// (auth_user_id) — usado para dirigir el aviso de un match de aliado a quien
// registro esa propiedad, no al asesor de la especialidad.
async function findByAuthUserId(orgId, authUserId) {
  if (!authUserId) return null;
  if (!supabase) {
    return memory.advisors.find((a) => a.org_id === orgId && a.auth_user_id === authUserId) || null;
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Asesor por id (para resolver el captador de una propiedad).
async function findById(orgId, id) {
  if (!id) return null;
  if (!supabase) {
    return memory.advisors.find((a) => a.org_id === orgId && a.id === id) || null;
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ¿Este telefono es de un asesor nuestro?
//
// Sin esto Sofi trata a su propia companera como si fuera una clienta que vio
// un anuncio: Natalia le escribio "hola buenas tardes" y le respondio "¿que
// tipo de propiedad estas buscando hoy?". Ademas quedaba un lead falso en el
// CRM que ensucia el embudo.
//
// La comparacion es por los ultimos 10 digitos: la tabla guarda el numero en
// formatos distintos segun quien lo cargo ("573001878024", "+57 300 187 8024",
// "3001878024") y WhatsApp siempre entrega el internacional sin signos.
// Comparar los strings tal cual fallaria justo con los asesores mas viejos.
const cola = (v) => String(v || "").replace(/\D/g, "").slice(-10);

// Pura y exportada: es la regla que decide si Sofi le habla a alguien como
// cliente o como companero, y tiene que poder probarse sin tocar la base.
function mismoTelefono(a, b) {
  const x = cola(a);
  return x.length === 10 && x === cola(b);
}

// Incluye a los INACTIVOS a proposito: un asesor dado de baja tampoco es un
// cliente, y responderle con el discurso de ventas seria igual de raro.
//
// Si el mismo telefono matchea VARIAS filas, gana la ACTIVA. Bug real
// 2026-08-18: Catherine Uribe tenia dos filas con el mismo numero (una vieja
// sin recibe_transferencias, una nueva con login de CRM que es la que de
// verdad recibe los avisos del radar) y esto devolvia la primera que
// encontrara la consulta —sin ningun criterio—, asi que cuando ELLA le
// escribia a Sofi, ctx.advisor.id nunca coincidia con el id que quedaba
// guardado en los avisos: registrar_resultado_radar siempre decia que no
// tenia nada pendiente, aunque si tuviera.
function buscarEnLista(lista, phone) {
  const candidatos = (lista || []).filter((a) => mismoTelefono(a.phone, phone));
  if (candidatos.length === 0) return null;
  return candidatos.find((a) => a.activo !== false) || candidatos[0];
}

async function findByPhone(orgId, phone) {
  if (cola(phone).length < 10) return null;

  const lista = !supabase
    ? memory.advisors.filter((a) => a.org_id === orgId)
    : (await supabase.from("advisors").select("*").eq("org_id", orgId)).data || [];

  return buscarEnLista(lista, phone);
}

// Asesores activos cuyo nombre matchea (para "a nombre de Natalia" en
// Sofi-Comando). Devuelve todos los matches: el consumidor decide si con 0
// vuelve a preguntar y con >1 pide precisar.
async function searchByName(orgId, q) {
  const texto = String(q || "").trim();
  if (!texto) return [];
  if (!supabase) {
    return memory.advisors.filter(
      (a) => a.org_id === orgId && a.activo && a.name.toLowerCase().includes(texto.toLowerCase())
    );
  }
  const { data, error } = await supabase
    .from("advisors")
    .select("*")
    .eq("org_id", orgId)
    .eq("activo", true)
    .ilike("name", `%${texto}%`);
  if (error) throw error;
  return data || [];
}

module.exports = { findForTransfer, findByAuthUserId, findById, findByPhone, mismoTelefono, buscarEnLista, searchByName, rotationCandidates, nextInRotation, listElegibles, elegiblesEnLista };
