#!/usr/bin/env node
// Prueba en seco del Excel de pendientes (spec 2026-10-30 §9). Solo lee: no
// escribe en la base ni manda WhatsApp. Guarda un .xlsx por asesora en
// "Claude outputs/". Se corre desde la raiz:
//   railway run --service diamond node scripts/excel-pendientes-en-seco.js
const fs = require("fs");
const path = require("path");
const supabase = require("../src/data/supabase");
const cp = require("../src/data/contactos-pendientes");
const conversations = require("../src/data/conversations");
const { motivoEscalar } = require("../src/lib/sin-respuesta");
const { armarCaso } = require("../src/lib/caso-pendiente");
const { armarLibro } = require("../src/lib/pendientes-excel");

async function main() {
  const org = (await require("../src/data/organizations").listActive())[0];
  const ciclo = await require("../src/data/rotacion-citas").asesoresDelCiclo(org.id);
  let pendientes = (await cp.disponible()) ? await cp.abiertos(org.id) : [];
  if (pendientes.length === 0) {
    console.log("Sin pendientes en la tabla: uso los casos que el sistema pasaría hoy.");
    const { data } = await supabase.from("conversations").select("id, leads!inner(*)").eq("org_id", org.id).eq("estado", "activa")
      .gte("last_activity_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString()).neq("leads.source", "asesor").limit(200);
    let n = 0;
    for (const c of data || []) {
      const msgs = await conversations.getRecentMessages(c.id, 12);
      const u = [...msgs].reverse().find((m) => m.role === "user");
      const paso = motivoEscalar({ lead: { ...c.leads, seguimiento: { ...(c.leads.seguimiento || {}), asesor_at: null } }, ultimoUsuario: u, ultimoMensaje: msgs[msgs.length - 1] });
      if (paso) pendientes.push({ id: c.id, codigo: `C-${String(++n).padStart(4, "0")}`, lead_id: c.leads.id, conversation_id: c.id, motivo: paso.motivo, asesor_id: ciclo[0].id });
    }
  }
  const porAsesora = new Map();
  for (const p of pendientes) {
    const a = ciclo.find((x) => x.id === p.asesor_id) || ciclo[0];
    if (!porAsesora.has(a.id)) porAsesora.set(a.id, { a, filas: [] });
    porAsesora.get(a.id).filas.push(p);
  }
  for (const { a, filas } of porAsesora.values()) {
    const casos = [];
    for (const p of filas) {
      const lead = await require("../src/data/leads").findById(org.id, p.lead_id);
      casos.push(await armarCaso({ org, pendiente: p, lead, mensajes: await conversations.getRecentMessages(p.conversation_id, 16), crmUrl: process.env.CRM_PUBLIC_URL || null }));
    }
    const archivo = path.join(__dirname, "..", "Claude outputs", `pendientes-en-seco-${a.name.split(" ")[0]}.xlsx`);
    fs.writeFileSync(archivo, await armarLibro({ loteId: "EN-SECO", asesorId: a.id, casos }));
    console.log(`${a.name}: ${casos.length} pendientes -> ${archivo}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
