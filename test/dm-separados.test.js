// El DM al colega sale partido: un mensaje para el colega y una ficha por
// propiedad, cada una con su link de Wasi (Juan, 2026-09-10, spec
// docs/superpowers/specs/2026-09-10-dm-separados-y-recordatorio-design.md).
//
// EL CASO QUE LO CIERRA (2026-09-13, inbox de la linea): un colega recibio un
// DM con varias opciones y respondio "Enviame de a una propiedad Link Que se
// pueda pasar al posible cliente", despues "Enviame link solo Opción 2" y
// "Valor administración de la opción 2 .. Cuál es?". Lo que el colega hace
// con el DM es reenviarle cada propiedad a su cliente.
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const RUTA = (m) => require.resolve(path.join("..", "src", m));
const redactar = require("../src/groups/redactar");
const envioColega = require("../src/groups/envio-colega");
const alertaAsesor = require("../src/groups/alerta-asesor");

const PROP = (ref, extra = {}) => ({
  ref,
  titulo: `Apartamento ${ref}`,
  operacion: "Venta",
  zona: "Envigado",
  area: "80m2",
  habitaciones: 3,
  banos: 2,
  precio: "$450.000.000",
  linkWasi: `https://info.wasi.co/apartamento-venta-envigado/${ref}`,
  ...extra,
});

// ── Los mensajes ─────────────────────────────────────────────────────────

test("primero un mensaje para el colega, despues una ficha limpia por propiedad", () => {
  const r = redactar.mensajesAlColega({ autor_nombre: "Mateo" }, [PROP("A"), PROP("B")], {
    pedido: { tipo: "apartamento", zonas: ["Envigado"] },
  });
  assert.strictEqual(r.mensajes.length, 3);
  assert.deepStrictEqual(r.refs, ["A", "B"]);
  assert.deepStrictEqual(r.mensajes.map((m) => m.ref), [null, "A", "B"]);

  const [primero, f1, f2] = r.mensajes.map((m) => m.texto);
  assert.match(primero, /Hola Mateo, te respondo tu pedido de apartamento en Envigado\./);
  assert.match(primero, /2 opciones que pueden servirte, cada una en un mensaje aparte/);
  assert.match(primero, /Comision compartida/);
  assert.match(primero, /Sofi, asistente virtual/);
  assert.doesNotMatch(primero, /info\.wasi\.co/, "el primer mensaje no lleva propiedades");

  for (const f of [f1, f2]) {
    // Se reenvia TAL CUAL al cliente del colega: ni saludo, ni firma, ni Diamond.
    assert.doesNotMatch(f, /Hola|Comision|Sofi|Diamond/i);
    // Un link por mensaje: WhatsApp arma la vista previa (la foto) con el primero.
    assert.strictEqual((f.match(/https?:\/\//g) || []).length, 1);
  }
  assert.match(f1, /^1\) Apartamento A/, "numeradas, para que el colega pueda decir 'la opcion 2'");
  assert.match(f2, /^2\) Apartamento B/);
  assert.match(f2, /https:\/\/info\.wasi\.co\/apartamento-venta-envigado\/B/);
});

test("con una sola propiedad: el mensaje para el colega y la ficha, aparte", () => {
  const r = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A")], {});
  assert.strictEqual(r.mensajes.length, 2);
  assert.match(r.mensajes[0].texto, /Te paso una opción que puede servirte en el mensaje de abajo/);
  assert.match(r.mensajes[1].texto, /^1\) /);
});

test("hasta 3 por DM; si Sofi aprobo mas, el primer mensaje lo dice", () => {
  const r = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A"), PROP("B"), PROP("C"), PROP("D"), PROP("E")], {});
  assert.strictEqual(r.mensajes.length, 4, "el mensaje para el colega + 3 fichas");
  assert.deepStrictEqual(r.refs, ["A", "B", "C"]);
  assert.strictEqual(r.restantes, 2);
  assert.match(r.mensajes[0].texto, /Tengo 2 opciones más para este pedido; si querés verlas/);
});

test("la salvedad va en el primer mensaje y cada aclaracion dentro de SU ficha", () => {
  const r = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A"), PROP("B", { habitaciones: 2 })], {
    sinConfirmar: ["terraza"],
    leFalta: [{ ref: "A", detalle: "tiene 1 garaje y pediste 2" }],
    pedido: { habitaciones: 3, zonas: ["Envigado"] },
  });
  assert.match(r.mensajes[0].texto, /No tengo confirmado si tienen terraza/);
  assert.match(r.mensajes[1].texto, /Aclaración: tiene 1 garaje y pediste 2/);
  assert.doesNotMatch(r.mensajes[1].texto, /No tengo confirmado/, "la salvedad es del lote, no de una ficha");
  assert.match(r.mensajes[2].texto, /Aclaración: 2 alcobas y pediste 3/);
});

test("la ficha completa lleva la administracion cuando Wasi la tiene", () => {
  const r = redactar.mensajesAlColega({ autor_nombre: "Ana" }, [PROP("A", { administracion: "$280.000" })], {});
  assert.match(r.mensajes[1].texto, /administración \$280\.000/);
});

test("el borrador para humanos (mensajeGrupo) sigue siendo UN mensaje, con las mismas fichas", () => {
  const props = [PROP("A"), PROP("B", { habitaciones: 2 })];
  const opciones = { leFalta: [{ ref: "A", detalle: "tiene 1 garaje y pediste 2" }], pedido: { habitaciones: 3 } };
  const unico = redactar.mensajeGrupo({ autor_nombre: "Ana" }, props, opciones);
  const partido = redactar.mensajesAlColega({ autor_nombre: "Ana" }, props, opciones);
  for (const m of partido.mensajes.slice(1)) assert.ok(unico.includes(m.texto), `la ficha difiere entre formatos:\n${m.texto}`);
});

test("sin propiedades no hay nada que mandar", () => {
  assert.strictEqual(redactar.mensajesAlColega({ autor_nombre: "Ana" }, [], {}), null);
});

// ── El envio ─────────────────────────────────────────────────────────────

let pausas = [];
envioColega._setDormirParaTests(async (ms) => {
  pausas.push(ms);
});

function conWaha(responder) {
  const envios = [];
  require.cache[RUTA("lib/waha.js")] = {
    exports: {
      enviarDm: async (sesion, telefono, texto, opciones) => {
        envios.push({ sesion, telefono, texto, opciones });
        return responder(envios.length, opciones);
      },
    },
  };
  return envios;
}

afterEach(() => {
  delete require.cache[RUTA("lib/waha.js")];
  pausas = [];
});

const MENSAJES = [
  { texto: "hola colega", ref: null },
  { texto: "1) ficha A", ref: "A" },
  { texto: "2) ficha B", ref: "B" },
  { texto: "3) ficha C", ref: "C" },
];

test("salen todos, en orden, con una pausa entre uno y otro", async () => {
  const envios = conWaha((n) => ({ ok: true, wamid: `w${n}` }));
  const r = await envioColega.enviarAlColega({ sesion: "L1", orgId: "org-1", lid: "141746805670125", mensajes: MENSAJES });

  assert.deepStrictEqual(envios.map((e) => e.texto), MENSAJES.map((m) => m.texto));
  assert.ok(envios.every((e) => e.opciones.lid === "141746805670125" && e.opciones.orgId === "org-1"));
  assert.deepStrictEqual(pausas, [envioColega.PAUSA_MS, envioColega.PAUSA_MS, envioColega.PAUSA_MS]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.completo, true);
  assert.deepStrictEqual(r.refsEnviadas, ["A", "B", "C"]);
  assert.deepStrictEqual(r.faltantes, []);
  assert.strictEqual(r.wamid, "w1");
  assert.strictEqual(r.texto, MENSAJES.map((m) => m.texto).join(envioColega.SEPARADOR));
});

test("si el primero no sale por el lid, reintenta y cae al telefono; los demas siguen por el telefono", async () => {
  const envios = conWaha((n, opciones) =>
    opciones.lid ? { ok: false, error: "session not found", previoAlEnvio: true } : { ok: true, wamid: `w${n}` }
  );
  const r = await envioColega.enviarAlColega({
    sesion: "L1", orgId: "org-1", lid: "141746805670125", respaldoTelefono: "573001234567", mensajes: MENSAJES.slice(0, 2),
  });

  assert.strictEqual(envios.filter((e) => e.opciones.lid).length, 2, "el intento y su reintento por el lid");
  const porTelefono = envios.filter((e) => !e.opciones.lid);
  assert.deepStrictEqual(porTelefono.map((e) => e.texto), ["hola colega", "1) ficha A"]);
  assert.ok(porTelefono.every((e) => e.telefono === "573001234567"));
  assert.strictEqual(r.via, "telefono");
  assert.strictEqual(r.completo, true);
});

test("un timeout en el primero no se reintenta: el estado es desconocido", async () => {
  const envios = conWaha(() => ({ ok: false, error: "timeout", previoAlEnvio: false }));
  const r = await envioColega.enviarAlColega({
    sesion: "L1", orgId: "org-1", lid: "141746805670125", respaldoTelefono: "573001234567", mensajes: MENSAJES,
  });
  assert.strictEqual(envios.length, 1, "duplicarle un mensaje al colega es peor que no mandarlo");
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.faltantes, ["A", "B", "C"]);
});

test("si uno del medio falla, se corta ahi y se devuelve lo que salio y lo que falto", async () => {
  const envios = conWaha((n) => (n === 3 ? { ok: false, error: "rate-overlimit", previoAlEnvio: true } : { ok: true, wamid: `w${n}` }));
  const r = await envioColega.enviarAlColega({ sesion: "L1", orgId: "org-1", telefono: "573001234567", mensajes: MENSAJES });

  assert.strictEqual(envios.length, 3, "no se reintenta ni se salta al siguiente");
  assert.strictEqual(r.ok, true, "el DM existe: el colega recibio el primero y la ficha A");
  assert.strictEqual(r.completo, false);
  assert.deepStrictEqual(r.refsEnviadas, ["A"]);
  assert.deepStrictEqual(r.faltantes, ["B", "C"]);
  assert.strictEqual(r.texto, ["hola colega", "1) ficha A"].join(envioColega.SEPARADOR), "solo se registra lo que salio");
  assert.strictEqual(r.error, "rate-overlimit");
});

// ── Lo que no llego, a la asesora ────────────────────────────────────────

test("el aviso post-DM lista lo que WhatsApp no alcanzo a entregar, aunque no haya dudosas", () => {
  const matches = [PROP("A"), PROP("B")];
  const t = alertaAsesor.construirAvisoPostDm(
    { autor_nombre: "Mateo", grupo_nombre: "Pedidos Poblado" },
    { refs_dudosas: [], por_que: "no aplica" },
    matches,
    ["A"],
    null,
    { refsFaltantes: ["B"] }
  );
  assert.match(t, /Ya le mandé por privado a Mateo: Ref A/);
  assert.match(t, /WhatsApp cortó el envío y estas no le llegaron — mandáselas vos:/);
  assert.match(t, /Ref B/);
  assert.doesNotMatch(t, /Por qué no se las mandé/, "el porque de Sofi habla de dudosas, y no hay");
});

test("si WhatsApp corto antes de las propiedades, el aviso lo dice de entrada", () => {
  const t = alertaAsesor.construirAvisoPostDm({ autor_nombre: "Mateo" }, { refs_dudosas: [] }, [PROP("A")], [], null, { refsFaltantes: ["A"] });
  assert.match(t, /^⚠️ Le escribí por privado a Mateo, pero WhatsApp cortó el envío antes de las propiedades\./);
});

test("sin faltantes ni dudosas no hay aviso post-DM", () => {
  assert.strictEqual(alertaAsesor.construirAvisoPostDm({ autor_nombre: "Mateo" }, { refs_dudosas: [] }, [PROP("A")], ["A"], null), null);
});
