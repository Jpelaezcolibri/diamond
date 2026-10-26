// DM amplio (Juan, 2026-10-26): "necesito que hagamos todas las respuestas
// automaticas". Tres aperturas, cada una detras de su interruptor:
//   · RADAR_DM_ZONA_CERCANA: la zona vecina (y el barrio que la ficha nombra
//     distinto al pedido) sale con aclaracion SOLO si no hay ninguna exacta.
//   · Dentro de RADAR_DM_CON_ACLARACION: el precio por confirmar sale si el
//     precio de Wasi cabe aunque el de la descripcion no.
//   · RADAR_DM_DUDOSAS: las dudosas de Sofi pasan por la misma compuerta (ver
//     test/group-asistido.test.js).

const { test } = require("node:test");
const assert = require("node:assert");
const publicable = require("../src/groups/publicable");
const redactar = require("../src/groups/redactar");
const { evaluarCandidata } = require("../src/groups/match");

function ficha(extra = {}) {
  return {
    fuente: "diamond", ref: "AP1", titulo: "Apartamento en Venta Envigado",
    zona: "Envigado", precio: "$450.000.000", operacion: "Venta",
    link: "https://diamondinmobiliaria.com/propiedades/ap1",
    linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
    habitaciones: 3, area: "90m2", puntaje: 85, ubicacion: "exacta", ...extra,
  };
}

const ON = { umbral: 0, conAclaracion: true, zonaCercana: true };
const VOSEO = /necesitás|confirmame|decime|querés|podés|tenés|mirá|decidí|\bvos\b/i;

// ── Interruptores ──────────────────────────────────────────────────────────
test("los dos interruptores nuevos estan apagados por defecto y solo 'true' los enciende", () => {
  for (const [fn, nombre] of [
    [publicable.dmZonaCercanaActivo, "RADAR_DM_ZONA_CERCANA"],
    [publicable.dmDudosasActivo, "RADAR_DM_DUDOSAS"],
  ]) {
    assert.strictEqual(fn({}), false, nombre);
    assert.strictEqual(fn({ [nombre]: "1" }), false, nombre);
    assert.strictEqual(fn({ [nombre]: "false" }), false, nombre);
    assert.strictEqual(fn({ [nombre]: " TRUE " }), true, nombre);
  }
});

// ── Zona cercana ───────────────────────────────────────────────────────────
test("zona cercana: una vecina sale con aclaracion si no hay ninguna exacta", () => {
  const r = publicable.filtrar([ficha({ ref: "VEC", ubicacion: "vecina", zona: "Itagüí" })], ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["VEC"]);
  assert.deepStrictEqual(r.descartados, []);
  assert.strictEqual(r.aclaraciones.length, 1);
  assert.strictEqual(r.aclaraciones[0].ref, "VEC");
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);
  assert.deepStrictEqual(r.aclaraciones[0].motivos, ["zona_vecina"]);
});

test("zona cercana: con una exacta, la vecina NO sale", () => {
  const r = publicable.filtrar([ficha({ ref: "VEC", ubicacion: "vecina", puntaje: 99 }), ficha({ ref: "EXA", puntaje: 70 })], ON);
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["EXA"]);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "VEC", motivos: ["zona_vecina"] }]);
});

test("zona cercana: una aclarable de dato no cuenta como exacta; orden exactas, dato, cercanas", () => {
  const r = publicable.filtrar(
    [ficha({ ref: "VEC", ubicacion: "vecina", puntaje: 99 }), ficha({ ref: "PISO", piso_sin_confirmar: true, puntaje: 60 })],
    ON
  );
  assert.deepStrictEqual(r.publicables.map((m) => m.ref), ["PISO", "VEC"]);
  assert.deepStrictEqual(r.aclaraciones.map((a) => a.ref), ["PISO", "VEC"]);
});

test("zona cercana: vecina con un dato aclarable sale con las dos aclaraciones; con otro motivo no", () => {
  const ok = publicable.filtrar([ficha({ ubicacion: "vecina", piso_sin_confirmar: true })], ON);
  assert.strictEqual(ok.publicables.length, 1);
  assert.deepStrictEqual(ok.aclaraciones[0].motivos.sort(), ["piso_sin_confirmar", "zona_vecina"]);
  assert.match(ok.aclaraciones[0].detalle, /piso/);

  for (const extra of [{ amoblado_sin_confirmar: true }, { varios_pedidos: true }, { precio: "$0" }, { linkWasi: "" }, { fuente: "aliado" }]) {
    const r = publicable.filtrar([ficha({ ubicacion: "vecina", ...extra })], ON);
    assert.deepStrictEqual(r.publicables, [], JSON.stringify(extra));
  }
  // Sin la aclaracion de dato encendida, la vecina solo sale limpia.
  const sinDato = publicable.filtrar([ficha({ ubicacion: "vecina", piso_sin_confirmar: true })], { umbral: 0, zonaCercana: true });
  assert.deepStrictEqual(sinDato.publicables, []);
  const limpia = publicable.filtrar([ficha({ ubicacion: "vecina" })], { umbral: 0, zonaCercana: true });
  assert.strictEqual(limpia.publicables.length, 1);
});

test("zona cercana: una zona lejana nunca sale", () => {
  for (const ubicacion of ["otra_zona", "ciudad"]) {
    const r = publicable.filtrar([ficha({ ubicacion })], ON);
    assert.deepStrictEqual(r.publicables, [], ubicacion);
    assert.ok(r.descartados[0].motivos.includes("zona_no_publicable"));
  }
});

test("zona cercana apagada: la vecina sigue sin salir, como hoy", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "vecina" })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  assert.deepStrictEqual(r.aclaraciones, []);
  assert.deepStrictEqual(r.descartados, [{ ref: "AP1", motivos: ["zona_vecina"] }]);
});

test("zona cercana: la ficha lleva 'No es en ...: queda en ..., cerca' por delante, en tuteo, y la salvedad no la contradice", () => {
  const { publicables, aclaraciones } = publicable.filtrar([ficha({ ubicacion: "vecina", zona: "Itagüí", piso_sin_confirmar: true })], ON);
  const notas = publicable.notasParaDm({ sinConfirmar: ["barrio exacto", "terraza"], leFalta: [] }, aclaraciones, publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, publicables, {
    ...notas,
    pedido: { zonas: ["Envigado"], zona: "Envigado" },
  });
  const textoFicha = armado.mensajes[1].texto;
  assert.match(textoFicha, /Aclaración: No es en Envigado: queda en Itagüí, cerca · no tengo registrado en qué piso está/);
  assert.doesNotMatch(textoFicha, /vecina de/);
  assert.doesNotMatch(textoFicha, VOSEO);
  assert.doesNotMatch(armado.mensajes[0].texto, /barrio/, "la salvedad no habla de zona/barrio");
  assert.match(armado.mensajes[0].texto, /terraza/);
});

test("zona cercana: sin la marca, la vecina se describe como siempre (aviso a la asesora, grupo)", () => {
  const d = redactar.desvios(ficha({ ubicacion: "vecina", zona: "Itagüí" }), { zonas: ["Envigado"] });
  assert.deepStrictEqual(d, ["queda en Itagüí, vecina de Envigado"]);
});

test("zona cercana: el match original no se modifica (filtrar devuelve una copia marcada)", () => {
  const m = ficha({ ubicacion: "vecina" });
  const r = publicable.filtrar([m], ON);
  assert.notStrictEqual(r.publicables[0], m);
  assert.strictEqual(m.zona_cercana, undefined);
  assert.ok(r.publicables[0].zona_cercana);
});

// ── Barrio que la ficha nombra (sector_sin_confirmar + barrio_en_ficha) ────
test("barrio en la ficha: sale como zona cercana con el barrio nombrado, solo sin exactas", () => {
  const m = ficha({ ref: "10031500", ubicacion: "zona_general", titulo: "Vendo Apartamento Sector Campestre Via las Antillas Envigado", barrio_en_ficha: ["antillas"] });
  const r = publicable.filtrar([m], ON);
  assert.deepStrictEqual(r.publicables.map((x) => x.ref), ["10031500"]);
  assert.strictEqual(r.aclaraciones[0].zonaCercana, true);

  const notas = publicable.notasParaDm({ sinConfirmar: ["barrio exacto"], leFalta: [] }, r.aclaraciones, r.publicables);
  const armado = redactar.mensajesAlColega({ autor_nombre: "Ana" }, r.publicables, {
    ...notas,
    pedido: { zonas: ["Dorado", "La Paz"], zona: "Dorado" },
  });
  const t = armado.mensajes[1].texto;
  assert.match(t, /Aclaración: queda en Antillas, Envigado/);
  assert.doesNotMatch(t, /barrio exacto no lo tengo registrado/, "seria falso: la ficha nombra el barrio");
  assert.doesNotMatch(armado.mensajes[0].texto, /barrio/);

  const conExacta = publicable.filtrar([m, ficha({ ref: "EXA" })], ON);
  assert.deepStrictEqual(conExacta.publicables.map((x) => x.ref), ["EXA"]);
});

test("barrio en la ficha: sin zona cercana sigue bloqueada (regla del rescate)", () => {
  const m = ficha({ ubicacion: "zona_general", barrio_en_ficha: ["antillas"] });
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

test("barrio desconocido (sin barrio_en_ficha) sigue siendo aclaracion de dato, no zona cercana", () => {
  const r = publicable.filtrar([ficha({ ubicacion: "zona_general" }), ficha({ ref: "EXA" })], ON);
  assert.deepStrictEqual(r.publicables.map((x) => x.ref), ["EXA", "AP1"]);
  assert.ok(!r.aclaraciones[0].zonaCercana);
});

// ── Precio: basta con que el de Wasi quepa ─────────────────────────────────
const pedidoPrecio = (extra = {}) => ({
  operacion: "venta", tipo: "apartamento", zona: "Envigado",
  precio_min: 0, precio_max: 450000000, habitaciones: 3,
  area_min: 0, banos: 0, garajes: 0, estrato: 0, ...extra,
});
const aptoPrecio = (precio, descripcion) => ({
  ref: "P1", titulo: "Apartamento en Envigado", tipo: "Apartamento",
  operacion: "Venta", precio, zona: "Envigado", ciudad: "Envigado",
  habitaciones: 3, banos: 2, garaje: 1, estrato: 5, area: "95 m²", descripcion,
  link: "https://diamondinmobiliaria.com/propiedades/p1",
  linkWasi: "https://info.wasi.co/apartamento-venta-envigado/10416693",
});

test("precio: Wasi en margen y descripcion fuera: sale con 'te confirmo el precio final'", () => {
  const m = evaluarCandidata(aptoPrecio("$450.000.000", "Precio de venta: $650.000.000"), pedidoPrecio(), "diamond");
  assert.strictEqual(m.precio_sin_confirmar, true);
  assert.strictEqual(m.precio_texto_en_margen, false);
  assert.strictEqual(m.precio_wasi_en_margen, true);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.strictEqual(r.publicables.length, 1);
  assert.match(r.aclaraciones[0].detalle, /te confirmo el precio final/);
});

test("precio: Wasi fuera del presupuesto: el motor la descarta, nunca sale", () => {
  assert.strictEqual(evaluarCandidata(aptoPrecio("$650.000.000", "Precio de venta: $450.000.000"), pedidoPrecio(), "diamond"), null);
  // Un match que dice que Wasi no cabe nunca sale, aunque quepa el del texto.
  const r = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: true, precio_wasi_en_margen: false })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
  // Un match guardado antes de la marca (sin el campo) decide como antes.
  const viejo = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: true })], { umbral: 0, conAclaracion: true });
  assert.strictEqual(viejo.publicables.length, 1);
  const ninguno = publicable.filtrar([ficha({ precio_sin_confirmar: true, precio_texto_en_margen: false, precio_wasi_en_margen: false })], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(ninguno.publicables, []);
});

test("precio: sin presupuesto en el pedido sigue bloqueada", () => {
  const m = evaluarCandidata(aptoPrecio("$450.000.000", "Precio de venta: $480.000.000"), pedidoPrecio({ precio_max: 0 }), "diamond");
  assert.strictEqual(m.precio_wasi_en_margen, false);
  const r = publicable.filtrar([m], { umbral: 0, conAclaracion: true });
  assert.deepStrictEqual(r.publicables, []);
});

// ── Dudosas: el texto de la aclaracion ────────────────────────────────────
test("dudosas: la razon de Sofi va como aclaracion de la ficha, en tuteo y sin datos del equipo", () => {
  const matches = [
    ficha({ ref: "D1", razones: ["Zona: Envigado", "2 alcobas (pediste 3)", "$470M — 4% sobre $450M, dentro del margen"] }),
    ficha({ ref: "D2", razones: ["Zona: Envigado"] }),
    ficha({ ref: "D3", ubicacion: "vecina", zona: "Sabaneta" }),
  ];
  const veredicto = {
    refs_utiles: [], refs_dudosas: ["D1", "D2", "D3", "NOESTA"],
    dudosas_motivo: [
      { ref: "D1", motivo: "dos_o_mas_incumplimientos_conocidos" },
      { ref: "D2", motivo: "de_fondo_dudoso" },
      { ref: "D3", motivo: "zona_vecina_y_colega_tajante" },
    ],
    le_falta: [{ ref: "D2", detalle: "es un dúplex y pediste apartamento" }],
    por_que: "Decidí vos: Daiana sabe si sirve, llamala al 3001234567",
  };
  const r = publicable.dudosasParaDm(veredicto, matches);
  // D3: el colega escribio "solo" esa zona y la ficha es vecina. Es un
  // requisito CONOCIDO que no cumple: no sale (el caso del 18-sep).
  assert.deepStrictEqual(r.matches.map((m) => m.ref), ["D1", "D2"]);
  const porRef = Object.fromEntries(r.leFalta.map((f) => [f.ref, f.detalle]));
  assert.match(porRef.D1, /2 alcobas y pediste 3/);
  assert.match(porRef.D1, /dentro del margen/);
  assert.match(porRef.D2, /es un dúplex y pediste apartamento/, "lo que Sofi escribio para esa ref va primero");
  assert.strictEqual(porRef.D3, undefined);
  for (const t of Object.values(porRef)) {
    assert.doesNotMatch(t, VOSEO);
    assert.doesNotMatch(t, /Daiana|Claudia|Catherine|\d{10}/, "el por_que de la asesora no se filtra al colega");
  }
});

test("dudosas: sin motivo tipado, igual lleva una aclaracion honesta", () => {
  const r = publicable.dudosasParaDm({ refs_dudosas: ["D1"] }, [ficha({ ref: "D1" })]);
  assert.strictEqual(r.leFalta.length, 1);
  assert.match(r.leFalta[0].detalle, /no calza en todo lo que pediste/);
});

test("dudosas: sin dudosas no devuelve nada", () => {
  assert.deepStrictEqual(publicable.dudosasParaDm({ refs_dudosas: [] }, [ficha()]), { matches: [], leFalta: [] });
  assert.deepStrictEqual(publicable.dudosasParaDm(null, [ficha()]), { matches: [], leFalta: [] });
});
