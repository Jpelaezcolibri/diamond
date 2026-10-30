// La fila del Excel para un pendiente (spec 2026-10-30 §5): quien es, como
// contactarlo, por que, que pidio y que se le ofrecio (con link de Wasi).
const { POR_QUE } = require("./sin-respuesta");

const recorte = (s, n) => { const x = String(s || "").replace(/\s+/g, " ").trim(); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
const pesos = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString("es-CO")}` : null);

function refsDe(textos) {
  const out = [];
  for (const t of textos || []) for (const m of String(t || "").matchAll(/\b(\d{7,8})\b/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function depsPorDefecto() {
  const codigoColega = require("../groups/codigo-colega");
  return {
    pedido: (orgId, codigo) => codigoColega.resolver(orgId, codigo),
    ficha: (org, ref) => require("../data/properties").findByRef(org, ref),
    nombreColega: async (orgId, tel) => ((await require("../data/colegas").porTelefono(orgId, tel)) || {}).nombre || null,
  };
}

async function armarCaso({ org, pendiente, lead, mensajes, crmUrl = null, deps = null }) {
  const d = { ...depsPorDefecto(), ...(deps || {}) };
  const { leerCodigo } = require("../groups/codigo-colega");
  const deLaPersona = (mensajes || []).filter((m) => m.role === "user");
  const deSofi = (mensajes || []).filter((m) => m.role === "assistant");
  const nombre = lead.nombre || (lead.source === "colega" ? await d.nombreColega(org.id, lead.phone).catch(() => null) : null);

  let pidio = "";
  const codigo = deLaPersona.map((m) => leerCodigo(m.content)).filter(Boolean).pop();
  if (codigo) {
    const senal = await d.pedido(org.id, codigo).catch(() => null);
    if (senal && senal.texto_original) pidio = recorte(senal.texto_original, 300);
  }
  if (!pidio && deLaPersona.length) pidio = recorte(deLaPersona.map((m) => m.content).join(" · "), 300);

  const fichas = [];
  for (const ref of refsDe(deSofi.map((m) => m.content)).slice(0, 4)) {
    const p = await d.ficha(org, ref).catch(() => null);
    fichas.push(p ? [`Ref ${ref}`, p.tipo, p.zona, pesos(p.precio), p.linkWasi].filter(Boolean).join(" · ") : `Ref ${ref}`);
  }
  const tel = String(lead.phone || "");
  return {
    codigo: pendiente.codigo,
    nombre: recorte(nombre, 60) || "(sin nombre)",
    tipo: lead.source === "colega" ? "colega" : "cliente",
    whatsapp: /^\d{8,15}$/.test(tel) ? `wa.me/${tel}` : "sin número: escríbele desde el CRM",
    porQue: POR_QUE[pendiente.motivo] || "no le contestó a Sofi",
    pidio,
    ofrecido: fichas.join("\n"),
    ultimoSuyo: recorte(deLaPersona.length ? deLaPersona[deLaPersona.length - 1].content : "", 200),
    ultimoSofi: recorte(deSofi.length ? deSofi[deSofi.length - 1].content : "", 250),
    chatUrl: crmUrl && pendiente.conversation_id ? `${crmUrl}/inbox/${pendiente.conversation_id}` : null,
  };
}

module.exports = { armarCaso, refsDe };
