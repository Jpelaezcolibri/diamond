// Limites del DM directo al colega (src/groups/politica.js#decidirDm): cuantos
// DMs recibio HOY ese colega puntual, y cuantos mando la linea en total.
//
// Las dos consultas comparten un criterio deliberado: cuentan filas con
// respuesta_modo='auto', el MISMO valor que ya usa el camino que publica
// DENTRO del grupo (no se agrega un valor nuevo a la columna — evita otra
// migracion sobre el check de db/migrations/2026-08-16_radar_vivo.sql). Ver
// la nota completa junto a las funciones en src/data/group-signals.js.

const { test } = require("node:test");
const assert = require("node:assert");

// src/data/supabase.js NO crea el cliente real bajo test (guard 2026-08-24).
// Sin supabase, este modulo cae a su rama de memoria — que es la que se
// prueba primero, sin necesitar ningun doble.
const groupSignals = require("../src/data/group-signals");

test("dmsHoyPorColega sin supabase (modo memoria/test) devuelve 0, no null -- mismo criterio que respuestasDesde", async () => {
  const n = await groupSignals.dmsHoyPorColega("org-1", "573001234567", new Date().toISOString());
  assert.strictEqual(n, 0);
});

test("dmsHoyPorColega sin telefono no tiene nada que contar", async () => {
  const n = await groupSignals.dmsHoyPorColega("org-1", null, new Date().toISOString());
  assert.strictEqual(n, null);
});

test("dmsHoyLinea sin supabase (modo memoria/test) devuelve 0", async () => {
  const n = await groupSignals.dmsHoyLinea("org-1", new Date().toISOString());
  assert.strictEqual(n, 0);
});

// ── Con un doble de supabase: se verifica el filtro exacto de la consulta ──
//
// Mismo patron que test/signal-events.test.js: se inyecta un doble en el cache
// del modulo ANTES de cargar group-signals.js, porque src/data/supabase.js
// exporta null bajo test.

function construirQuery(resultado) {
  const llamadas = [];
  const q = {};
  for (const metodo of ["select", "eq", "gte", "order", "limit", "update", "or"]) {
    q[metodo] = (...args) => { llamadas.push([metodo, ...args]); return q; };
  }
  q.maybeSingle = () => Promise.resolve(resultado);
  // El builder real de supabase-js es "thenable": awaitarlo dispara la query.
  q.then = (resolve) => resolve(resultado);
  return { q, llamadas };
}

function instalarConSupabase(resultado) {
  const supabasePath = require.resolve("../src/data/supabase");
  const groupSignalsPath = require.resolve("../src/data/group-signals");
  const llamadasPorTabla = [];
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: (tabla) => {
        const { q, llamadas } = construirQuery(resultado);
        llamadasPorTabla.push({ tabla, llamadas });
        return q;
      },
    },
  };
  delete require.cache[groupSignalsPath];
  const mod = require("../src/data/group-signals");
  return { mod, llamadasPorTabla };
}

test("dmsHoyPorColega filtra por org, por el telefono/lid del colega, por respuesta_modo=auto y por la fecha", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: [{ id: "s1" }, { id: "s2" }], error: null });

  const n = await mod.dmsHoyPorColega("org-9", "141746805670125", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, 2);

  assert.strictEqual(llamadasPorTabla.length, 1);
  assert.strictEqual(llamadasPorTabla[0].tabla, "group_signals");
  const filtros = llamadasPorTabla[0].llamadas.filter(([m]) => m === "eq" || m === "gte");
  assert.deepStrictEqual(filtros, [
    ["eq", "org_id", "org-9"],
    ["eq", "autor_telefono", "141746805670125"],
    ["eq", "respuesta_modo", "auto"],
    ["gte", "respondida_at", "2026-08-24T00:00:00.000Z"],
  ]);
});

test("dmsHoyLinea filtra por org y respuesta_modo=auto, sin acotar por colega", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: [{ id: "s1" }], error: null });

  const n = await mod.dmsHoyLinea("org-9", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, 1);

  const filtros = llamadasPorTabla[0].llamadas.filter(([m]) => m === "eq" || m === "gte");
  assert.deepStrictEqual(filtros, [
    ["eq", "org_id", "org-9"],
    ["eq", "respuesta_modo", "auto"],
    ["gte", "respondida_at", "2026-08-24T00:00:00.000Z"],
  ]);
});

test("dmsHoyPorColega: si la migracion no corrio (columna faltante), devuelve null -- ante la duda, no se envia", async () => {
  const { mod } = instalarConSupabase({ data: null, error: { code: "PGRST204", message: "columna faltante" } });
  const n = await mod.dmsHoyPorColega("org-9", "573001234567", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, null);
});

test("dmsHoyLinea: un fallo de la base tambien devuelve null, no un cero optimista", async () => {
  const { mod } = instalarConSupabase({ data: null, error: { code: "500", message: "boom" } });
  const n = await mod.dmsHoyLinea("org-9", "2026-08-24T00:00:00.000Z");
  assert.strictEqual(n, null);
});

// AUDITORIA DEL DESTINATARIO (Juan, 2026-09-04). Sin esto, "a quien le
// escribimos" solo se podia reconstruir cruzando contra el directorio, que
// cambia con el tiempo -- o sea que no se podia reconstruir.
test("marcarRespondida guarda el telefono y el lid del destinatario", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: null, error: null });

  await mod.marcarRespondida("org-9", "sig-1", {
    texto: "hola", wamid: "wm-1", modo: "auto", refs: ["9944723"],
    destinoTelefono: "573001234567", destinoLid: "184564139970806",
  });

  const [, patch] = llamadasPorTabla[0].llamadas.find(([m]) => m === "update");
  assert.strictEqual(patch.respuesta_destino_telefono, "573001234567");
  assert.strictEqual(patch.respuesta_destino_lid, "184564139970806");
});

// Degradacion limpia: si la migracion no corrio, la respuesta se marca igual.
// Perder la marca de "ya respondido" duplicaria el DM al colega, que es MUCHO
// peor que perder el dato de auditoria.
test("sin la migracion corrida, se marca igual y sin los campos nuevos", async () => {
  // PGRST204 = PostgREST no encuentra la columna. Falla la primera vez y
  // acierta la segunda, que es como se comporta una migracion sin correr.
  let intentos = 0;
  const supabasePath = require.resolve("../src/data/supabase");
  const groupSignalsPath = require.resolve("../src/data/group-signals");
  const updates = [];
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: () => {
        const q = {};
        for (const m of ["select", "eq", "gte", "order", "limit", "update"]) {
          q[m] = (...args) => { if (m === "update") updates.push(args[0]); return q; };
        }
        q.then = (resolve) =>
          resolve(intentos++ === 0 ? { error: { code: "PGRST204", message: "respuesta_destino_lid" } } : { error: null });
        return q;
      },
    },
  };
  delete require.cache[groupSignalsPath];
  const mod = require("../src/data/group-signals");

  const ok = await mod.marcarRespondida("org-9", "sig-1", {
    texto: "hola", wamid: "wm-1", modo: "auto", destinoTelefono: "573001234567",
  });

  assert.strictEqual(ok, true, "la señal tiene que quedar marcada igual");
  assert.ok(updates[1].respondida_at, "el segundo intento sigue marcando la respuesta");
  assert.strictEqual(updates[1].respuesta_destino_telefono, undefined, "sin las columnas nuevas");
});

// LA DEGRADACION TIENE QUE SABER QUE COLUMNA FALTA (revision final,
// 2026-09-04). Con `esColumnaFaltante` a secas, un error por respuesta_refs
// entraba por el primer paso: imprimia "falta 2026-09-04_dm_destinatario.sql"
// (falso) y borraba respuesta_destino_telefono/lid, perdiendo auditoria que la
// base SI podia guardar, mas un update de mas.
function instalarConErroresEnCola(errores) {
  const supabasePath = require.resolve("../src/data/supabase");
  const groupSignalsPath = require.resolve("../src/data/group-signals");
  const updates = [];
  let i = 0;
  delete require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: {
      from: () => {
        const q = {};
        for (const m of ["select", "eq", "gte", "order", "limit", "update"]) {
          q[m] = (...args) => { if (m === "update") updates.push({ ...args[0] }); return q; };
        }
        q.then = (resolve) => resolve({ error: errores[i++] || null });
        return q;
      },
    },
  };
  delete require.cache[groupSignalsPath];
  return { mod: require("../src/data/group-signals"), updates };
}

test("si la columna que falta es respuesta_refs, los campos de destino NO se pierden", async () => {
  const { mod, updates } = instalarConErroresEnCola([
    { code: "PGRST204", message: "Could not find the 'respuesta_refs' column of 'group_signals'" },
  ]);

  const ok = await mod.marcarRespondida("org-9", "sig-1", {
    texto: "hola", modo: "auto", refs: ["9944723"],
    destinoTelefono: "573001234567", destinoLid: "184564139970806",
  });

  assert.strictEqual(ok, true);
  assert.strictEqual(updates.length, 2, "un solo reintento: el que suelta respuesta_refs");
  assert.strictEqual(updates[1].respuesta_refs, undefined, "la columna que falta si se suelta");
  assert.strictEqual(updates[1].respuesta_destino_telefono, "573001234567", "auditoria que si se podia guardar");
  assert.strictEqual(updates[1].respuesta_destino_lid, "184564139970806");
});

// El aviso es de migracion pendiente, no de esta llamada: repetirlo en cada DM
// tapa el log. El plan lo pide explicito ("se avisa una vez").
test("el aviso de migracion pendiente se emite UNA sola vez, no en cada DM", async () => {
  const faltaDestino = { code: "PGRST204", message: "Could not find the 'respuesta_destino_lid' column of 'group_signals'" };
  const { mod } = instalarConErroresEnCola([faltaDestino, null, faltaDestino, null, faltaDestino, null]);

  const original = console.warn;
  const avisos = [];
  console.warn = (m) => avisos.push(String(m));
  try {
    for (let i = 0; i < 3; i++) {
      await mod.marcarRespondida("org-9", `sig-${i}`, { texto: "hola", modo: "auto", destinoTelefono: "573001234567" });
    }
  } finally {
    console.warn = original;
  }

  const delDestino = avisos.filter((a) => a.includes("2026-09-04_dm_destinatario.sql"));
  assert.strictEqual(delDestino.length, 1, `se aviso ${delDestino.length} veces: ${avisos.join(" / ")}`);
});

// ── Atribuir la respuesta de un colega al DM que la origino (Juan, 2026-09-08) ──
//
// "Al DM mas reciente de ese colega", sin ventana de tiempo. El lid crudo
// (con sufijo) es lo que marcarRespondida guardo en respuesta_destino_lid.

test("buscarPorLid sin lid no consulta nada", async () => {
  assert.strictEqual(await groupSignals.buscarPorLid("org-1", null), null);
  assert.strictEqual(await groupSignals.buscarPorLid("org-1", ""), null);
});

test("buscarPorLid en memoria devuelve la señal MAS RECIENTE con ese respuesta_destino_lid", async () => {
  const memory = require("../src/data/memory");
  const antes = memory.groupSignals.length;
  memory.groupSignals.push(
    { id: "s-vieja", org_id: "org-1", clase: "demanda", respuesta_destino_lid: "276467766300904@lid", created_at: "2026-09-01T10:00:00Z" },
    { id: "s-nueva", org_id: "org-1", clase: "demanda", respuesta_destino_lid: "276467766300904@lid", created_at: "2026-09-08T10:00:00Z" },
    { id: "s-otro", org_id: "org-1", clase: "demanda", respuesta_destino_lid: "111@lid", created_at: "2026-09-09T10:00:00Z" }
  );
  try {
    const s = await groupSignals.buscarPorLid("org-1", "276467766300904@lid");
    assert.strictEqual(s.id, "s-nueva");
  } finally {
    memory.groupSignals.length = antes;
  }
});

test("buscarPorLid con supabase filtra por org y por respuesta_destino_lid, ordenado por created_at desc, limit 1", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: { id: "s-1", texto_original: "Busco apto" }, error: null });
  const s = await mod.buscarPorLid("org-9", "276467766300904@lid");
  assert.strictEqual(s.id, "s-1");
  const llamadas = llamadasPorTabla[0].llamadas;
  assert.deepStrictEqual(llamadas.filter(([m]) => m === "eq"), [
    ["eq", "org_id", "org-9"],
    ["eq", "respuesta_destino_lid", "276467766300904@lid"],
  ]);
  assert.ok(llamadas.some(([m, col, opts]) => m === "order" && col === "created_at" && opts && opts.ascending === false));
  assert.ok(llamadas.some(([m, n]) => m === "limit" && n === 1));
});

test("buscarPorTelefono tambien encuentra la señal por respuesta_destino_telefono (el colega publico con lid y contesta desde @c.us)", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: { id: "s-2" }, error: null });
  const s = await mod.buscarPorTelefono("org-9", "573205938640");
  assert.strictEqual(s.id, "s-2");
  const llamadas = llamadasPorTabla[0].llamadas;
  const or = llamadas.find(([m]) => m === "or");
  assert.ok(or, "tiene que usar .or() para mirar las dos columnas");
  assert.strictEqual(or[1], "autor_telefono.eq.573205938640,respuesta_destino_telefono.eq.573205938640");
});

// El filtro por clase protege a src/agent/engine.js:236, que usa esta misma
// funcion para meter `ultimoPedido` DENTRO del system prompt de Sofi: sin el,
// una OFERTA del colega entraria al prompt como si fuera un pedido suyo.
test("buscarPorTelefono sigue filtrando por clase=demanda -- una oferta nunca puede volverse 'el ultimo pedido'", async () => {
  const { mod, llamadasPorTabla } = instalarConSupabase({ data: { id: "s-2" }, error: null });
  await mod.buscarPorTelefono("org-9", "573205938640");
  const eqs = llamadasPorTabla[0].llamadas.filter(([m]) => m === "eq");
  assert.ok(
    eqs.some(([, col, val]) => col === "clase" && val === "demanda"),
    "el filtro por clase no se puede quitar: engine.js depende de el"
  );
});
