// Reproduce conversaciones REALES de clientes con Sofi en dos modelos, para
// comparar antes de cambiar CLAUDE_MODEL. Corta cada conversacion en el
// ultimo mensaje del cliente y pide UNA respuesta: no ejecuta herramientas,
// no escribe en la base ni le manda nada a nadie. Gasta centavos.
//
//   railway run --service diamond node scripts/replay-sofi.js 12 claude-sonnet-4-5 claude-sonnet-5-5
//
// Deja el lado a lado en Claude outputs/replay-sofi-<fecha>.md.
const CLAVE = process.env.ANTHROPIC_API_KEY; // antes de src/config.js (dotenv override)
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

async function main() {
  const [nArg, ...modelos] = process.argv.slice(2);
  const N = Number(nArg || 12);
  if (modelos.length === 0) modelos.push("claude-sonnet-4-5", "claude-sonnet-5-5");
  const sb = require("../src/data/supabase");
  const { buildSystemPrompt } = require("../src/agent/prompts");
  const { TOOL_DEFINITIONS } = require("../src/agent/tools");
  const { isQualified } = require("../src/agent/qualification");
  const { paramsDeModelo } = require("../src/lib/anthropic");
  const client = new Anthropic({ apiKey: CLAVE, timeout: 120000 });

  const { data: org } = await sb.from("organizations").select("*").eq("name", "Diamond").single();
  const { data: leads } = await sb
    .from("leads")
    .select("*")
    .eq("org_id", org.id)
    .not("source", "in", "(asesor,colega)")
    .order("updated_at", { ascending: false })
    .limit(80);

  const casos = [];
  for (const lead of leads) {
    if (casos.length >= N) break;
    const { data: convs } = await sb.from("conversations").select("id").eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1);
    if (!convs || !convs[0]) continue;
    const { data: msgs } = await sb.from("messages").select("role, content, created_at").eq("conversation_id", convs[0].id).in("role", ["user", "assistant"]).order("created_at", { ascending: true }).limit(40);
    const limpios = (msgs || []).filter((m) => String(m.content || "").trim());
    let corte = -1;
    for (let i = limpios.length - 1; i >= 0; i--) if (limpios[i].role === "user") { corte = i; break; }
    if (corte < 2) continue; // al menos un ida y vuelta antes
    const historia = limpios.slice(Math.max(0, corte - 11), corte + 1).map((m) => ({ role: m.role, content: m.content }));
    while (historia.length && historia[0].role !== "user") historia.shift();
    casos.push({ lead, historia, real: limpios[corte + 1] && limpios[corte + 1].role === "assistant" ? limpios[corte + 1].content : null });
  }

  const ahora = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
  const salida = [`# Replay de Sofi — ${ahora}`, "", `Modelos: ${modelos.join(" vs ")} · ${casos.length} conversaciones reales, cortadas en el último mensaje del cliente. Sin ejecutar herramientas.`, ""];
  const totales = Object.fromEntries(modelos.map((m) => [m, { ms: [], usd: 0 }]));
  const PRECIO = { "claude-sonnet-4-5": [3, 15], "claude-sonnet-5-5": [2, 10] };

  for (const [i, c] of casos.entries()) {
    const system = buildSystemPrompt({ org, lead: c.lead, qualified: isQualified(c.lead), now: ahora });
    salida.push(`## ${i + 1}. ${c.lead.nombre || "(sin nombre)"} · ${c.lead.source || "?"}`, "");
    for (const m of c.historia.slice(-4)) salida.push(`> **${m.role === "user" ? "Cliente" : "Sofi"}:** ${String(m.content).replace(/\n+/g, " ").slice(0, 400)}`);
    salida.push("");
    for (const modelo of modelos) {
      const t0 = Date.now();
      let linea;
      try {
        const r = await client.messages.create({ ...paramsDeModelo(modelo, { maxTokens: 2048 }), system, messages: c.historia, tools: TOOL_DEFINITIONS });
        const ms = Date.now() - t0;
        totales[modelo].ms.push(ms);
        const u = r.usage || {};
        const [pi, po] = PRECIO[modelo] || [3, 15];
        totales[modelo].usd += ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) * 0.1 + (u.cache_creation_input_tokens || 0) * 2) / 1e6 * pi + (u.output_tokens || 0) / 1e6 * po;
        const texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
        const tools = r.content.filter((b) => b.type === "tool_use").map((b) => `${b.name}(${JSON.stringify(b.input).slice(0, 160)})`);
        linea = `**${modelo}** (${(ms / 1000).toFixed(1)} s, ${r.stop_reason}, salida ${u.output_tokens} tok): ${texto || "_(sin texto)_"}${tools.length ? `\n  - herramientas: ${tools.join(" · ")}` : ""}`;
      } catch (e) {
        linea = `**${modelo}**: ERROR ${e.status || ""} ${e.message}`;
      }
      salida.push(`- ${linea}`, "");
    }
  }
  salida.push("## Totales", "");
  for (const [m, t] of Object.entries(totales)) {
    const s = [...t.ms].sort((a, b) => a - b);
    salida.push(`- **${m}**: mediana ${(s[Math.floor(s.length / 2)] / 1000 || 0).toFixed(1)} s · p90 ${((s[Math.floor(s.length * 0.9)] || 0) / 1000).toFixed(1)} s · costo de la corrida US$${t.usd.toFixed(4)}`);
  }
  const destino = path.join(__dirname, "..", "Claude outputs", `replay-sofi-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(destino, salida.join("\n"));
  console.log(salida.slice(-3).join("\n"));
  console.log("Detalle:", destino);
}
main().catch((e) => { console.error("Fallo:", e.message); process.exit(1); });
