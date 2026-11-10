// La fila del Excel para un pendiente (spec 2026-10-30 §5; Juan, 2026-11-07,
// caso Andrea Strauch: "cada fila debe traer TODO lo necesario para que la
// asesora se comunique"): quien es, celular y link, por que y desde cuando,
// que pidio (literal), que se le ofrecio (con link de Wasi), sus peticiones
// especiales y lo ultimo que se dijo, con fecha.
const { POR_QUE } = require("./sin-respuesta");

// Columnas de informacion del Excel, en el orden en que se ven en el celular:
// [encabezado, clave del caso, ancho]. Las que llena la asesora viven en
// pendientes-excel.js (LLENAR).
const COLUMNAS_CASO = [
  ["Código", "codigo", 9], ["Nombre", "nombre", 20], ["Celular", "celular", 17], ["WhatsApp", "whatsapp", 22],
  ["Colega / cliente", "tipo", 9], ["Por qué", "porQue", 30], ["Desde cuándo", "desde", 26],
  ["Qué pidió", "pidio", 48], ["Qué se le ofreció", "ofrecido", 48], ["Peticiones especiales", "especial", 34],
  ["Lo último que dijo", "ultimoSuyo", 42], ["Lo último de Sofi", "ultimoSofi", 42], ["Chat CRM", "chatUrl", 12],
];

const LARGO_TEXTO = 1200;
const recorte = (s, n = LARGO_TEXTO) => { const x = String(s || "").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const unaLinea = (s, n) => recorte(String(s || "").replace(/\s+/g, " "), n);
// properties.precio es texto ("$700.000.000", "700000000"): se lee con el mismo
// parser del motor de match.
const pesos = (t) => {
  const n = require("./formato").parsearPrecio(t);
  return n > 0 ? `$${Math.round(n).toLocaleString("es-CO")}` : null;
};

// "5 nov, 8:22 a. m." en hora de Bogota.
function fechaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const f = d.toLocaleDateString("es-CO", { timeZone: "America/Bogota", day: "numeric", month: "short" }).replace(/\./g, "").replace(/\s+de\s+/, " ");
  const h = d.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit", hour12: true }).replace(/[  ]/g, " ");
  return `${f}, ${h}`;
}
const conFecha = (m, n) => (m ? `${fechaCorta(m.created_at)}: ${recorte(m.content, n)}`.replace(/^: /, "") : "");

// +57 301 452 1622 (celulares colombianos); otros numeros, con + y tal cual.
function celularLegible(tel) {
  const t = String(tel || "");
  if (!/^\d{8,15}$/.test(t)) return null;
  const m = /^57(3\d{2})(\d{3})(\d{4})$/.exec(t);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : `+${t}`;
}

function refsDe(textos) {
  const out = [];
  for (const t of textos || []) for (const m of String(t || "").matchAll(/\b(\d{7,8})\b/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function depsPorDefecto() {
  const codigoColega = require("../groups/codigo-colega");
  const gs = require("../data/group-signals");
  const colegas = require("../data/colegas");
  return {
    pedido: (orgId, codigo) => codigoColega.resolver(orgId, codigo),
    // Los pedidos del colega en los grupos, por lid o telefono (el ultimo primero).
    pedidosDelColega: async (orgId, { lid, telefono }) => {
      const hist = await gs.historialColega(orgId, { lid, telefono }, 2);
      if (hist.length) return hist;
      const uno = await gs.buscarPorTelefono(orgId, telefono);
      return uno ? [uno] : [];
    },
    ficha: (org, ref) => require("../data/properties").findByRef(org, ref),
    colega: (orgId, tel) => colegas.porTelefono(orgId, tel),
    soloLlamada: (orgId, tel) => colegas.esSoloLlamada(orgId, { telefono: tel }),
  };
}

function peticionesEspeciales(lead, soloLlamada) {
  const out = [];
  if (soloLlamada) out.push("Prefiere LLAMADA, no WhatsApp");
  if (lead.presupuesto) out.push(`Presupuesto: ${unaLinea(lead.presupuesto, 80)}`);
  if (lead.zona_interes) out.push(`Zona: ${unaLinea(lead.zona_interes, 80)}`);
  if (lead.tipo_interes) out.push(`Busca: ${unaLinea(lead.tipo_interes, 80)}`);
  if (lead.urgencia) out.push(`Urgencia: ${unaLinea(lead.urgencia, 80)}`);
  const cita = lead.cita && typeof lead.cita === "object" ? lead.cita : null;
  if (cita && cita.fecha_hora) {
    const ref = cita.ref ? ` · ref ${cita.ref}` : "";
    const estado = cita.estado ? ` (${cita.estado})` : "";
    out.push(`Visita pedida: ${fechaCorta(cita.fecha_hora)}${ref}${estado}`);
  }
  const inm = lead.inmueble_ofrecido && typeof lead.inmueble_ofrecido === "object" ? lead.inmueble_ofrecido : null;
  if (inm) {
    const partes = [inm.tipo, inm.zona, inm.precio, inm.operacion].filter(Boolean).map((x) => unaLinea(x, 60));
    out.push(`Ofrece un inmueble: ${partes.join(" · ") || "sí (ver el chat)"}`);
  }
  return out.join("\n");
}

async function armarCaso({ org, pendiente, lead, mensajes, crmUrl = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const { leerCodigo } = require("../groups/codigo-colega");
  const deLaPersona = (mensajes || []).filter((m) => m.role === "user");
  const deSofi = (mensajes || []).filter((m) => m.role === "assistant");
  // El celular que dejó en el chat manda sobre el de su WhatsApp (caso Norha).
  const tel = require("./quien-lead").celularDe(lead) || String(lead.phone || "");
  const esColega = lead.source === "colega";
  const colega = esColega ? await d.colega(org.id, tel).catch(() => null) : null;
  const nombre = lead.nombre || (colega && colega.nombre) || null;

  // Que pidio: el pedido del grupo (por el codigo del DM, o por su lid o
  // telefono si escribio sin codigo, como Andrea), literal; si no, sus mensajes.
  let pidio = "";
  const refsDm = [];
  const codigo = deLaPersona.map((m) => leerCodigo(m.content)).filter(Boolean).pop();
  let senales = [];
  if (codigo) {
    const s = await d.pedido(org.id, codigo).catch(() => null);
    if (s) senales = [s];
  }
  if (senales.length === 0 && esColega) {
    senales = await d.pedidosDelColega(org.id, { lid: colega && colega.lid, telefono: tel }).catch(() => []);
  }
  const senal = senales[0];
  if (senal && senal.texto_original) {
    const resumen = [senal.tipo, senal.operacion, senal.zona].filter(Boolean).join(" · ");
    const fecha = fechaCorta(senal.created_at).split(",")[0];
    pidio = `Pedido${fecha ? ` del ${fecha}` : ""}${resumen ? ` (${resumen})` : ""}:\n${recorte(senal.texto_original)}`;
    for (const r of senal.respuesta_refs || []) if (!refsDm.includes(String(r))) refsDm.push(String(r));
  }
  if (!pidio && deLaPersona.length) pidio = recorte(deLaPersona.map((m) => conFecha(m, 300)).join("\n"));

  // Que se le ofrecio: las refs que Sofi nombro en el chat y las del DM del radar.
  const refs = [...refsDe(deSofi.map((m) => m.content))];
  for (const r of refsDm) if (!refs.includes(r)) refs.push(r);
  // Un numero de 7 u 8 cifras del chat que no es una ficha (un precio, un
  // celular partido) no sale; una ref del DM que ya no esta, se dice.
  const fichas = [];
  for (const ref of refs.slice(0, 5)) {
    const p = await d.ficha(org, ref).catch(() => null);
    if (p) fichas.push([`Ref ${ref}`, p.tipo, p.zona, pesos(p.precio), p.linkWasi].filter(Boolean).join(" · "));
    else if (refsDm.includes(ref)) fichas.push(`Ref ${ref} (ya no está en el inventario)`);
  }

  // La marca de "solo llamada" se busca por telefono para todos: colegas y clientes.
  const soloLlamada = /^\d{8,15}$/.test(tel) ? (await d.soloLlamada(org.id, tel).catch(() => false)) === true : false;
  const ultimoSuyo = deLaPersona.length ? deLaPersona[deLaPersona.length - 1] : null;
  const celular = celularLegible(tel);
  const desde = [
    pendiente.created_at ? `Pendiente desde el ${fechaCorta(pendiente.created_at)}` : "",
    ultimoSuyo ? `Su último mensaje: ${fechaCorta(ultimoSuyo.created_at)}` : "",
  ].filter(Boolean).join(" · ");

  return {
    codigo: pendiente.codigo,
    motivo: pendiente.motivo,
    nombre: unaLinea(nombre, 60) || "(sin nombre)",
    celular: celular || "sin número",
    tipo: esColega ? "colega" : "cliente",
    whatsapp: celular ? `wa.me/${tel}` : "escríbele desde el chat del CRM",
    porQue: POR_QUE[pendiente.motivo] || "no le contestó a Sofi",
    desde,
    pidio,
    ofrecido: fichas.join("\n"),
    especial: peticionesEspeciales(lead, soloLlamada),
    ultimoSuyo: conFecha(ultimoSuyo, 400),
    ultimoSofi: conFecha(deSofi.length ? deSofi[deSofi.length - 1] : null, 500),
    chatUrl: crmUrl && pendiente.conversation_id ? `${crmUrl}/inbox/${pendiente.conversation_id}` : null,
  };
}

module.exports = { armarCaso, refsDe, COLUMNAS_CASO, fechaCorta, celularLegible };
