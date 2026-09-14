const { test } = require("node:test");
const assert = require("node:assert");
const { _setClientForTests } = require("../src/lib/anthropic");
const { classify, armarLotes, formatearLote, costoDe, esReintentable, TAMANO_LOTE } = require("../src/groups/classify");

const msg = (n) => ({ id: `g#${n}`, grupo: "g", autor: "Colega", texto: `mensaje ${n}` });

// Cliente falso: nunca llama a la API real. Devuelve una clasificación por
// mensaje del lote y registra las peticiones para poder inspeccionarlas.
function mockClient({ respuesta, usage } = {}) {
  const llamadas = [];
  _setClientForTests({
    messages: {
      create: async (params) => {
        llamadas.push(params);
        if (respuesta) return respuesta(params, llamadas.length);
        const ids = [...params.messages[0].content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              mensajes: ids.map((id) => ({
                id, clase: "demanda", confianza: 0.9, operacion: "venta", tipo: "apartamento",
                zona: "Laureles", ciudad: "Medellín", precio_min: 0, precio_max: 400000000,
                habitaciones: 3, contacto: "", notas: "",
              })),
            }),
          }],
          usage: usage || { input_tokens: 1000, output_tokens: 500 },
        };
      },
    },
  });
  return llamadas;
}

test("los mensajes se agrupan en lotes de 20 — sin batching el costo se dispara", () => {
  assert.strictEqual(TAMANO_LOTE, 20);
  const lotes = armarLotes(Array.from({ length: 45 }, (_, i) => msg(i)));
  assert.deepStrictEqual(lotes.map((l) => l.length), [20, 20, 5]);
});

test("el prompt del lote lleva el id de cada mensaje para poder reunirlos después", () => {
  const texto = formatearLote([msg(0), msg(1)]);
  assert.match(texto, /\[g#0\]/);
  assert.match(texto, /\[g#1\]/);
});

test("classify une cada clasificación con su mensaje original", async () => {
  mockClient();
  const mensajes = [msg(0), msg(1)];
  const { clasificados } = await classify(mensajes);
  assert.strictEqual(clasificados.length, 2);
  assert.strictEqual(clasificados[0].mensaje.texto, "mensaje 0");
  assert.strictEqual(clasificados[0].clase, "demanda");
  _setClientForTests(null);
});

test("classify pide salida estructurada — el esquema lo fuerza la API, no el prompt", async () => {
  const llamadas = mockClient();
  await classify([msg(0)]);
  const formato = llamadas[0].output_config.format;
  assert.strictEqual(formato.type, "json_schema");
  assert.strictEqual(formato.schema.properties.mensajes.items.properties.clase.enum.join(","), "demanda,oferta,ruido");
  _setClientForTests(null);
});

test("classify NO manda 'effort' — Haiku 4.5 no acepta ese parámetro y devolvería error", async () => {
  const llamadas = mockClient();
  await classify([msg(0)]);
  assert.strictEqual(llamadas[0].output_config.effort, undefined);
  assert.strictEqual(llamadas[0].thinking, undefined);
  _setClientForTests(null);
});

test("classify acumula los tokens de cada lote — el costo se mide, no se estima", async () => {
  mockClient({ usage: { input_tokens: 1000, output_tokens: 500 } });
  const mensajes = Array.from({ length: 45 }, (_, i) => msg(i)); // 3 lotes
  const { uso, lotes } = await classify(mensajes);
  assert.strictEqual(lotes, 3);
  assert.strictEqual(uso.input_tokens, 3000);
  assert.strictEqual(uso.output_tokens, 1500);
  _setClientForTests(null);
});

test("un lote que falla no tumba la corrida, y queda contado", async () => {
  // Sin el conteo, un fallo masivo se leería como 'mucho ruido' en el reporte
  // y el proyecto se cancelaría por la razón equivocada.
  let n = 0;
  mockClient({
    respuesta: (params) => {
      n++;
      if (n === 1) throw new Error("500 del servidor");
      const ids = [...params.messages[0].content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      return {
        content: [{ type: "text", text: JSON.stringify({ mensajes: ids.map((id) => ({ id, clase: "ruido", confianza: 0.5, operacion: "", tipo: "", zona: "", ciudad: "", precio_min: 0, precio_max: 0, habitaciones: 0, contacto: "", notas: "" })) }) }],
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    },
  });
  const { clasificados, lotesFallidos } = await classify(Array.from({ length: 40 }, (_, i) => msg(i)));
  assert.strictEqual(lotesFallidos, 1);
  assert.strictEqual(clasificados.length, 20); // solo el lote que sí respondió
  _setClientForTests(null);
});

test("una respuesta con un id que no pedimos se descarta", async () => {
  mockClient({
    respuesta: () => ({
      content: [{ type: "text", text: JSON.stringify({ mensajes: [{ id: "inventado", clase: "demanda", confianza: 1, operacion: "", tipo: "", zona: "", ciudad: "", precio_min: 0, precio_max: 0, habitaciones: 0, contacto: "", notas: "" }] }) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });
  const { clasificados } = await classify([msg(0)]);
  assert.strictEqual(clasificados.length, 0);
  _setClientForTests(null);
});

test("el costo usa los precios de Haiku 4.5: 1 USD y 5 USD por millón", () => {
  // 1M de entrada + 1M de salida = 1 + 5 = 6 USD
  assert.strictEqual(costoDe({ input_tokens: 1e6, output_tokens: 1e6 }), 6);
  assert.strictEqual(costoDe({}), 0);
});

test("classify no llama a la API con una lista vacía", async () => {
  const llamadas = mockClient();
  const { clasificados, lotes } = await classify([]);
  assert.strictEqual(llamadas.length, 0);
  assert.strictEqual(lotes, 0);
  assert.strictEqual(clasificados.length, 0);
  _setClientForTests(null);
});

// ── Backoff ante límite de tasa ──────────────────────────────────────────
//
// Con la escucha en vivo llegaban lotes sueltos y esto no hacía falta. Un
// export manda cientos de lotes de golpe: sin reintentos, el 429 convierte la
// corrida entera en `lotesFallidos`, que en pantalla se ve igual que "no
// había nada" — el peor modo de fallo posible.

const errorCon = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

test("un 429 se reintenta y la segunda vez sale bien", async () => {
  let intentos = 0;
  mockClient({
    respuesta: (params) => {
      intentos++;
      if (intentos === 1) throw errorCon(429);
      const ids = [...params.messages[0].content.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      return {
        content: [{ type: "text", text: JSON.stringify({ mensajes: ids.map((id) => ({ id, clase: "demanda", confianza: 1, operacion: "", tipo: "", zona: "", ciudad: "", precio_min: 0, precio_max: 0, habitaciones: 0, contacto: "", notas: "" })) }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  });
  // Esperas de 1ms: el test verifica la lógica de reintento, no el reloj.
  const { clasificados, lotesFallidos, reintentos } = await classify([msg(0)], { reintentos: [1, 1, 1] });
  assert.strictEqual(intentos, 2);
  assert.strictEqual(clasificados.length, 1);
  assert.strictEqual(lotesFallidos, 0);
  assert.strictEqual(reintentos, 1);
  _setClientForTests(null);
});

test("si se agotan los reintentos el lote cuenta como fallido, sin tumbar la corrida", async () => {
  let intentos = 0;
  mockClient({ respuesta: () => { intentos++; throw errorCon(529); } });
  const { clasificados, lotesFallidos } = await classify([msg(0)], { reintentos: [1, 1] });
  assert.strictEqual(intentos, 3); // 1 inicial + 2 reintentos
  assert.strictEqual(lotesFallidos, 1);
  assert.strictEqual(clasificados.length, 0);
  _setClientForTests(null);
});

test("un 400 no se reintenta — fallaría igual las tres veces y solo retrasa", async () => {
  let intentos = 0;
  mockClient({ respuesta: () => { intentos++; throw errorCon(400); } });
  const { lotesFallidos } = await classify([msg(0)], { reintentos: [1, 1, 1] });
  assert.strictEqual(intentos, 1);
  assert.strictEqual(lotesFallidos, 1);
  _setClientForTests(null);
});

// ── Prompt caching ───────────────────────────────────────────────────────
//
// Medido el 2026-09-14: el clasificador corre de 820 a 1.300 veces por dia en
// vivo y es ~85% de la factura de la API. Sin cache, cada mensaje paga el
// prompt entero. Estos tests son lo unico que afirma ese ahorro: si el
// marcador se cae, nada falla, solo se paga de mas.
const { CACHE_ESTABLE } = require("../src/lib/anthropic");
const classifyMod = require("../src/groups/classify");

test("classify cachea su prompt de sistema con el TTL compartido", async () => {
  const llamadas = mockClient();
  await classify([msg(0)]);
  const system = llamadas[0].system;
  assert.ok(Array.isArray(system), "el system tiene que ir en bloques para poder cachearse");
  assert.strictEqual(system.length, 1);
  assert.deepStrictEqual(system[0].cache_control, CACHE_ESTABLE);
  assert.ok(!system[0].text.includes("mensaje 0"), "el mensaje del colega no puede entrar al prefijo cacheado");
  _setClientForTests(null);
});

test("el prefijo del clasificador supera el minimo cacheable de Haiku 4.5 (4.096 tokens)", () => {
  // Por debajo de 4.096 la API ignora el marcador SIN avisar. El prefijo es el
  // system mas el esquema (la API lo inyecta antes del marcador: revalidar lee
  // 5.107 de cache y count_tokens da 5.115 para su system+esquema). La razon
  // de chars por token se midio con count_tokens sobre este mismo prompt; se
  // exige un 5% de margen para que un recorte chico no lo tire abajo.
  const chars = classifyMod.SISTEMA.length + JSON.stringify(classifyMod.ESQUEMA).length;
  const tokens = chars / classifyMod.CHARS_POR_TOKEN;
  assert.ok(tokens >= 4096 * 1.05, `el prefijo quedo en ~${Math.round(tokens)} tokens: el cache no se aplicaria`);
});

test("classify deja en el log cuanto leyo del cache", async () => {
  mockClient({ usage: { input_tokens: 150, cache_read_input_tokens: 4300, cache_creation_input_tokens: 0, output_tokens: 160 } });
  const lineas = [];
  const original = console.log;
  console.log = (...a) => lineas.push(a.join(" "));
  try {
    await classify([msg(0)]);
  } finally {
    console.log = original;
  }
  assert.ok(lineas.some((l) => /\[uso\] classify .*cache_read=4300/.test(l)), "sin esta linea la ruta mas cara vuelve a ser invisible");
  _setClientForTests(null);
});

test("el costo de un import cuenta lo leido y lo escrito en el cache", async () => {
  mockClient({ usage: { input_tokens: 100, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0, output_tokens: 50 } });
  const { uso } = await classify([msg(0)]);
  assert.strictEqual(uso.cache_read_input_tokens, 4000);
  // 100 frescos a 1 USD + 4000 leidos a 0,1 USD + 50 de salida a 5 USD, por millon
  assert.ok(Math.abs(uso.costoUsd - (100 * 1 + 4000 * 0.1 + 50 * 5) / 1e6) < 1e-12);
  _setClientForTests(null);
});

test("esReintentable distingue saturación de error de programación", () => {
  assert.ok(esReintentable(errorCon(429)));
  assert.ok(esReintentable(errorCon(500)));
  assert.ok(esReintentable(errorCon(529)));
  assert.ok(esReintentable(new Error("fetch failed")));
  assert.ok(!esReintentable(errorCon(400)));
  assert.ok(!esReintentable(errorCon(401)));
  assert.ok(!esReintentable(new Error("JSON malformado")));
});
