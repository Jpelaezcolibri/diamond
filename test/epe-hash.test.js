// Vectores fijos del hash del EPE.
//
// POR QUÉ EXISTE ESTE TEST: `idDeMensaje` alimenta el índice único
// `(org_id, group_id, wa_message_id)` de `group_signals`. Ese hash está
// PERSISTIDO en producción. Si cambia —por migrar de `node:crypto` a
// `crypto.subtle`, por tocar el orden de la semilla, por cambiar el prefijo—
// las filas existentes quedan huérfanas: cada mensaje ya visto vuelve a
// parecer nuevo, se reclasifica y se vuelve a pagar.
//
// Nada de eso falla ruidosamente. Simplemente se duplica todo y la factura
// sube. Por eso los valores de abajo NO se regeneran cuando el test falla: se
// investiga por qué cambiaron.
//
// Los hex fueron generados con la implementación VIEJA (`node:crypto`), antes
// de la migración. Son prueba de no-regresión, no autoconfirmación.

const { test } = require("node:test");
const assert = require("node:assert");
const nodeCrypto = require("node:crypto");
const { sha256Hex, idDeMensaje, huella } = require("../epe/core/hash");

const VECTORES = [
  {
    m: {
      grupo: "Gremio Laureles",
      instanteIso: "2026-08-01T08:12:00.000Z",
      autor: "Marcela Ruiz",
      texto: "Tengo cliente para apto 3 alcobas en Laureles hasta 600 millones",
    },
    id: "export:4db0d7ec67d69950ad4cd932baa6ff362131d69c",
    huella: "f7fe931b6e2626e05fe0def13c337cef45dd2e1dc9bfc8934ef656cd8a3ea998",
  },
  {
    m: {
      grupo: "Gremio",
      instanteIso: "2026-07-15T14:30:00.000Z",
      autor: "Andrés Gómez",
      texto: "Se vende casa en Belén, 850 palos",
    },
    id: "export:ffad7cbf1773f32769fb5ca11ccc8a128f832ff0",
    huella: "2a0a85713d828659854c96d947b7f1350ad309040c04c7c9776342a3eefd64d5",
  },
  {
    // Los tres campos que pueden venir vacíos de un export mal formado.
    m: { grupo: "G", instanteIso: null, autor: null, texto: "" },
    id: "export:ea28592d8acf801a20135303870bacbaa2fbb173",
    huella: "cbe5cfdf7c2118a9c3d78ef1d684f3afa089201352886449a06a6511cfef74a7",
  },
  {
    // Acentos, ñ y guion largo: si `plano()` se rompiera, estos cambian.
    m: {
      grupo: "Ñoño & Cía",
      instanteIso: "2026-01-01T00:00:00.000Z",
      autor: "José Ítalo",
      texto: "Itagüí — apartaestudio $1.200.000",
    },
    id: "export:000eaf98e9a4dd34747ddf34101df224bd4863ad",
    huella: "d293ce20364cf8a2ce1a01c7fe40bc347cb1c0448744e85056f59c11134dd71b",
  },
];

test("idDeMensaje da exactamente los hashes ya persistidos en producción", async () => {
  for (const v of VECTORES) {
    assert.strictEqual(
      await idDeMensaje(v.m),
      v.id,
      `El id cambió para ${JSON.stringify(v.m.texto).slice(0, 40)}. ` +
      `NO regeneres el vector: las filas de group_signals con el hash viejo ` +
      `quedarían huérfanas y cada mensaje se reprocesaría como nuevo.`
    );
  }
});

test("huella da exactamente los hashes de siempre", async () => {
  for (const v of VECTORES) {
    assert.strictEqual(await huella(v.m), v.huella);
  }
});

test("crypto.subtle produce el mismo SHA-256 que node:crypto", async () => {
  // La premisa de toda la migración, verificada y no asumida. Si esto fallara,
  // el EPE no puede correr en el navegador sin romper la persistencia.
  const casos = ["", "hola", "acentos: Belén Itagüí ñ", "x".repeat(5000), "a|b|c|d"];
  for (const s of casos) {
    const viejo = nodeCrypto.createHash("sha256").update(s).digest("hex");
    assert.strictEqual(await sha256Hex(s), viejo, `difiere para ${JSON.stringify(s.slice(0, 30))}`);
  }
});

test("la huella ignora el grupo — el mismo aviso en diez grupos es uno solo", async () => {
  // De 494 señales medidas en vivo, 312 eran repeticiones del mismo aviso
  // difundido en varios grupos. Es el mayor ahorro de IA después del prefiltro.
  const base = { instanteIso: "2026-08-01T10:00:00.000Z", autor: "Diana", texto: "Casa en Envigado 850 millones" };
  const a = await huella({ ...base, grupo: "Gremio A" });
  const b = await huella({ ...base, grupo: "Gremio B" });
  assert.strictEqual(a, b);
});

test("el id SÍ distingue el grupo — la misma oferta en dos grupos son dos filas", async () => {
  // Al revés que la huella: `group_signals` es por grupo, y saber en cuál se
  // vio es lo que le permite al asesor ir a responder ahí.
  const base = { instanteIso: "2026-08-01T10:00:00.000Z", autor: "Diana", texto: "Casa en Envigado" };
  const a = await idDeMensaje({ ...base, grupo: "Gremio A" });
  const b = await idDeMensaje({ ...base, grupo: "Gremio B" });
  assert.notStrictEqual(a, b);
});

test("el id distingue la hora — dos mensajes iguales del mismo día no colisionan", async () => {
  const base = { grupo: "G", autor: "Diana", texto: "sigue disponible" };
  const manana = await idDeMensaje({ ...base, instanteIso: "2026-08-01T08:00:00.000Z" });
  const tarde = await idDeMensaje({ ...base, instanteIso: "2026-08-01T17:00:00.000Z" });
  assert.notStrictEqual(manana, tarde);
});
