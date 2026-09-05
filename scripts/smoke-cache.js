#!/usr/bin/env node
// Prueba de humo del prompt caching contra la API REAL. Dos llamadas chicas:
// la primera escribe el cache, la segunda lo lee.
//
// Existe porque `ttl: "1h"` no se puede verificar con tests: o la API lo
// acepta o devuelve 400 en TODAS las llamadas y el bot queda mudo. Correr
// esto UNA vez antes de desplegar el cambio de TTL.
//
//   railway run --service diamond node scripts/smoke-cache.js
//
// `railway run` inyecta las variables del servicio, asi que corre con la
// clave de PRODUCCION sin copiarla a ningun lado ni dejarla en el disco.
// Sin `railway run` usa la del .env local.
//
// Gasta menos de un centavo. No toca la base de datos ni le escribe a nadie.

// La clave se captura ANTES de requerir nada de src/: src/config.js corre
// dotenv con `override: true`, que pisaria la clave inyectada por
// `railway run` con la del .env local — que es justamente la que no sirve.
const CLAVE_INYECTADA = process.env.ANTHROPIC_API_KEY;

const Anthropic = require("@anthropic-ai/sdk");
const { CACHE_ESTABLE } = require("../src/lib/anthropic");

const clave = CLAVE_INYECTADA || process.env.ANTHROPIC_API_KEY;
const getClient = () => new Anthropic({ apiKey: clave, timeout: 60 * 1000 });

// Suficientemente largo para superar el minimo cacheable de Sonnet (1.024
// tokens). El contenido da igual: solo tiene que ser identico en las dos.
const RELLENO = "Regla de prueba sin efecto, solo para ocupar tokens. ".repeat(220);

(async () => {
  if (!clave) {
    console.error("No hay ANTHROPIC_API_KEY. Corré con: railway run --service diamond node scripts/smoke-cache.js");
    process.exit(1);
  }
  const origen = CLAVE_INYECTADA ? "inyectada por railway run" : ".env local";
  console.log(`TTL configurado: ${CACHE_ESTABLE.ttl}`);
  console.log(`Clave: ...${clave.slice(-6)} — origen: ${origen}\n`);
  const cliente = getClient();
  const peticion = {
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    max_tokens: 16,
    system: [{ type: "text", text: RELLENO, cache_control: CACHE_ESTABLE }],
    messages: [{ role: "user", content: "Responde solo: ok" }],
  };

  let leidoAlFinal = 0;
  for (const etiqueta of ["1a (deberia ESCRIBIR el cache)", "2a (deberia LEERLO)"]) {
    const r = await cliente.messages.create(peticion);
    const u = r.usage || {};
    leidoAlFinal = u.cache_read_input_tokens || 0;
    console.log(
      `${etiqueta}\n  escrito=${u.cache_creation_input_tokens || 0} leido=${leidoAlFinal} fresco=${u.input_tokens || 0}`
    );
  }

  if (leidoAlFinal > 0) {
    console.log(`\n✅ La API acepta ttl="${CACHE_ESTABLE.ttl}" y el cache pega. Se puede desplegar.`);
    process.exit(0);
  }
  console.log("\n⚠️  La segunda llamada no leyo nada del cache.");
  console.log("   El TTL no rompe nada (no hubo error), pero el ahorro no se esta dando.");
  process.exit(1);
})().catch((e) => {
  console.error(`\n❌ FALLO (${e.status || "sin status"}): ${e.message}`);
  if (String(e.message).includes("credit balance")) {
    console.error("   La clave de ANTHROPIC_API_KEY no tiene saldo. No dice nada sobre el TTL.");
  } else if (e.status === 400) {
    console.error('   NO DESPLEGAR. Poner ANTHROPIC_CACHE_TTL=5m en Railway y volver a probar.');
  }
  process.exit(1);
});
